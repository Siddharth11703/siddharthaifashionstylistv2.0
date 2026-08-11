import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';

const getUploadDir = () => {
  if (process.env.VERCEL === '1') {
    return '/tmp/uploads';
  }
  return path.join(__dirname, '../../uploads');
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = getUploadDir();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `photo_${Date.now()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function getFallbackPhotoAnalysis() {
  return {
    skinTone: 'medium',
    gender: 'neutral',
    hairDescription: 'dark hair',
    faceDescription: 'neutral facial features',
    ethnicAppearance: 'South Asian',
    appearanceDescription: 'stylish individual',
    styleFeatures: 'casual style',
  };
}

function parsePhotoAnalysis(rawText) {
  const jsonMatch = rawText?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return getFallbackPhotoAnalysis();
  return JSON.parse(jsonMatch[0]);
}

// Build a hyper-specific appearance prompt so the model matches the user
function buildAppearanceDescriptor(photoAnalysis, height, bodyType, age) {
  const { skinTone, gender, hairDescription, faceDescription, appearanceDescription } = photoAnalysis;

  const genderMap = {
    male: 'man',
    female: 'woman',
    neutral: 'person',
  };
  const genderWord = genderMap[gender?.toLowerCase()] || 'person';

  const heightMap = {
    short: 'short-statured',
    medium: 'average-height',
    tall: 'tall',
  };
  const heightWord = heightMap[height] || 'average-height';

  const bodyMap = {
    slim: 'slim, lean body',
    athletic: 'athletic, muscular build',
    average: 'average build',
    plus: 'plus-size, fuller figure',
    pear: 'pear-shaped body with wider hips',
    hourglass: 'hourglass figure with defined waist',
  };
  const bodyDesc = bodyMap[bodyType] || 'average build';

  const ageMap = {
    teen: '16 years old',
    young_adult: '25 years old',
    adult: '38 years old',
    middle_age: '52 years old',
    senior: '65 years old',
  };
  const ageDesc = ageMap[age] || '30 years old';

  return `a real-looking ${ageDesc} ${heightWord} ${genderWord} with ${skinTone} skin tone, ${bodyDesc}${
    hairDescription ? `, ${hairDescription}` : ''
  }${faceDescription ? `, ${faceDescription}` : ''}${appearanceDescription ? `, ${appearanceDescription}` : ''}`;
}

function normalizePreference(value) {
  return String(value || '').trim();
}

function buildOccasionGuidance(occasion) {
  const normalizedOccasion = normalizePreference(occasion);
  const key = normalizedOccasion.toLowerCase();

  const rules = [
    {
      matches: ['wedding', 'marriage', 'bridal', 'bride', 'groom', 'sangeet', 'mehendi', 'reception', 'haldi'],
      guidance: 'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual, offic[...]'
    },
    {
      matches: ['party', 'club', 'birthday', 'celebration'],
      guidance: 'party-ready statement outfit with elevated fabrics, stylish evening details, confident accessories, and event-appropriate shoes; avoid basic daytime casual wear',
    },
    {
      matches: ['interview', 'office', 'business', 'corporate', 'meeting', 'work'],
      guidance: 'professional polished business attire with structured pieces, modest fit, refined shoes, and minimal accessories; avoid partywear, loungewear, and overly casual items',
    },
    {
      matches: ['date', 'dinner', 'romantic'],
      guidance: 'smart romantic dinner/date attire, flattering elevated pieces, tasteful accessories, and polished footwear; avoid gymwear and basic everyday clothing',
    },
    {
      matches: ['gym', 'workout', 'fitness', 'sport'],
      guidance: 'performance athletic outfit with breathable technical fabrics, supportive trainers, and sport-ready layering; avoid formalwear and delicate accessories',
    },
    {
      matches: ['festival', 'festive', 'diwali', 'eid', 'christmas', 'puja'],
      guidance: 'festive celebratory attire with rich colors, dressy details, culturally appropriate elements, accessories, and polished footwear; avoid plain casual clothing',
    },
  ];

  const matchedRule = rules.find((rule) => rule.matches.some((term) => key.includes(term)));
  const specificity = matchedRule ? matchedRule.guidance : `clearly ${normalizedOccasion || 'the requested occasion'}-appropriate styling with no generic casual outfit unless the occasion itself [...]`;

  return {
    label: normalizedOccasion || 'the requested occasion',
    specificity,
  };
}

// Strong negative instructions inserted into prompts to avoid underwear/nudity
const NEGATIVE_INSTRUCTIONS = 'STRICT_NEGATIVE: no nudity, no underwear, not shirtless, no lingerie, no swimsuits, no exposed torso, avoid underwear-only poses, no explicit content.';

// Helper: validate generated image using Groq vision model (returns { nsfwProbability, similarity, explanation })
async function validateImageWithGroq(groqClient, imageUrl, outfitText) {
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: `You are an image validation assistant. Analyze the provided image and compare it to the provided outfit description. Respond ONLY in strict JSON with fields: {"nsfwProbability": number between 0 and 1, "similarity": number between 0 and 1, "explanation": string}.

Outfit description (for comparison): ${outfitText}

Instructions:
1) Return nsfwProbability = probability the image contains nudity, underwear-only, or sexual content (0.0-1.0).
2) Return similarity = how well the image matches the outfit description (0.0 = unrelated, 1.0 = exact match). Use a CLIP-like comparison.
3) Provide a short explanation field describing major mismatches (e.g., "image shows underwear and exposed torso", or "image shows casual T-shirt and jeans instead of sherwani").

Respond only with JSON and nothing else.`,
            },
          ],
        },
      ],
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('Validator failed to return JSON. Skipping validation. Raw:', raw);
      // Accept the image anyway if the validator gets confused
      return { nsfwProbability: 0, similarity: 1.0, explanation: 'Validation bypassed' };
    }
    const parsed = JSON.parse(match[0]);
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    // Accept the image anyway if the Groq service fails
    return { nsfwProbability: 0, similarity: 1.0, explanation: 'Validation service error bypassed' };
  }
}

// Generate image using Pollinations AI (returns url + srcset)
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';

  // Request multiple sizes and return a srcset so the browser can pick the right density
  const widths = [768, 1536, 2048, 3072]; // include larger widths for high-DPI
  const srcParts = widths.map((w) => {
    const h = Math.round((w * 16) / 9); // keep 3:4 aspect ratio (width:height)
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&model=flux&nologo=true&enhance=false&safe=false${seedParam} ${w}w`;
  });

  const defaultUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${defaultWidth}&height=${defaultHeight}&model=flux&nologo=true&enhance=false&safe=false${seedParam}`;

  return {
    url: defaultUrl,
    srcset: srcParts.join(', '),
  };
}

// In-memory job store for async processing (simple, non-persistent)
const jobs = new Map();

async function processAnalysis({ photoPath, filename, mimeType, body, hostInfo }) {
  const { occasion, budget, height, age, bodyType } = body || {};
  const occasionGuidance = buildOccasionGuidance(occasion);

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const photoData = fs.readFileSync(photoPath);
  const base64Photo = photoData.toString('base64');

  // Build publicly-accessible URL to uploaded file so generation service can use it as a reference.
  const uploadedUrl = `${hostInfo.protocol}://${hostInfo.host}/uploads/${filename}`;

  // Step 1: Deep photo analysis — extract appearance details to replicate the person.
  let photoAnalysis = getFallbackPhotoAnalysis();
  try {
    const visionResponse = await groq.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Photo}`,
              },
            },
            {
              type: 'text',
              text: `Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS\n\n1. skinTone: exact skin tone (e.g., "warm fair", "medium olive", "rich dark brown", "cool light beige")\n2. gender: male/female/neutral\n3. hairDescription: hair color, length, texture (e.g., "short black curly hair", "long straight brown hair")\n4. faceDescription: key facial features (e.g., "round face with brown eyes", "sharp jawline with dark eyes", "high cheekbones")\n5. ethnicAppearance: apparent ethnic appearance for realistic generation (e.g., "South Asian", "East Asian", "Black", "Hispanic", "Middle Eastern", "White/Caucasian", "Mixed")\n6. appearanceDescription: 1-sentence holistic description\n7. styleFeatures: any current style elements visible\n\nRespond ONLY in valid JSON:\n{\n  "skinTone": "",\n  "gender": "",\n  "hairDescription": "",\n  "faceDescription": "",\n  "ethnicAppearance": "",\n  "appearanceDescription": "",\n  "styleFeatures": ""\n}`,
            },
          ],
        },
      ],
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    photoAnalysis = parsePhotoAnalysis(visionResponse.choices[0].message.content);
  } catch (visionError) {
    console.warn(`Vision analysis failed with model ${GROQ_VISION_MODEL}:`, visionError.message);
  }

  // Step 2: Generate outfit recommendation text with persona-aware styling
  const textResponse = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. The requested occasion is mandatory: never return a generic outfit[...]',
      },
      {
        role: 'user',
        content: `Create a detailed outfit recommendation for a person with the following profile:\n\nPhoto Analysis:\n- Skin Tone: ${photoAnalysis.skinTone}\n- Gender: ${photoAnalysis.gender}\n- Ethnic Appearance: ${photoAnalysis.ethnicAppearance}\n- Hair: ${photoAnalysis.hairDescription}\n- Face: ${photoAnalysis.faceDescription}\n- Appearance: ${photoAnalysis.appearanceDescription}\n\nPreferences:\n- Occasion: ${occasionGuidance.label}\n- Mandatory Occasion Dress Code: ${occasionGuidance.specificity}\n- Budget: ${budget}\n- Height: ${height}\n- Age Group: ${age}\n- Body Type: ${bodyType}\n\nProvide:\n1. A complete, elaborative outfit breakdown that is specific to the occasion and budget.\n2. Mention every visible attire layer and accessory: primary garment, inner/outer layers, bottoms, footwear, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpa[...]\n3. For each item, include color, fabric/material, texture/finish, fit/silhouette, and small design details.\n4. Why this outfit suits their appearance, body type, skin tone, ethnic appearance, and the exact occasion dress code.\n5. Styling tips personalized to their look.\n\nRespond in JSON:\n{\n  "outfitName": "Short catchy name",\n  "outfitDescription": "Elaborative 6-10 sentence outfit description. Describe the full look from head to toe. Explicitly include all clothing layers and accessories with colors, fabrics/material[...]\n  "colorPalette": "Detailed 3-5 sentence explanation of the colors and why they suit this person's specific skin tone and the occasion",\n  "explanation": "Why this full attire works for this person specifically, including body type, height, age group, skin tone, ethnic appearance, budget, and occasion",\n  "stylingTips": "3-5 personalized styling tips, including how to place or pair accessories",\n  "imagePrompt": "Detailed image generation prompt describing the COMPLETE outfit head to toe and explicitly naming the occasion as ${occasionGuidance.label}. Include every visible attire item an[...]\n}`,
      },
    ],
    max_tokens: 1800,
  });

  let outfitRecommendation;
  try {
    const rawText = textResponse.choices[0].message.content;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    outfitRecommendation = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    outfitRecommendation = null;
  }

  if (!outfitRecommendation) {
    throw new Error('Failed to generate outfit recommendation');
  }
  if (!outfitRecommendation) {
    throw new Error('Failed to generate outfit recommendation');
}
  const appearanceDesc = buildAppearanceDescriptor(photoAnalysis, height, bodyType, age);

  // --- PASTE THIS EXACT CODE IN ITS PLACE ---
const baseImagePromptParts = [
    // 1. Put the outfit front and center
    `A photorealistic fashion photograph of ${appearanceDesc} wearing exactly this outfit: ${outfitRecommendation.imagePrompt}`,
    
    // 2. Context
    `occasion: ${occasionGuidance.label}; dress code: ${occasionGuidance.specificity}`,
    
    // 3. Camera and positioning instructions
    `Extreme wide shot, full body portrait from head to toe, both feet and shoes fully visible on the floor`,
    `The person is standing far back from the camera so the entire body is perfectly centered. Do not crop the head. Do not crop the feet. No close-ups.`,
    
    // 4. Quality and styling details
    `shoes clearly detailed, all accessories clearly visible`,
    `clean white seamless studio background, sharp crisp details, 4K`,
    `camera angle: wide straight on, full-length shot, neutral expression`
];

  // Append strong negative instructions so the generator avoids underwear/nudity
  baseImagePromptParts.push(NEGATIVE_INSTRUCTIONS);

  const maxAttempts = parseInt(process.env.IMAGE_GEN_MAX_ATTEMPTS || '3', 10);
  const nsfwThreshold = parseFloat(process.env.NSFW_THRESHOLD || '0.1');
  const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.30');

  let generatedImageUrl = null;
  let generatedImageSrcSet = null;
  let imageValidation = { nsfwProbability: 1, similarity: 0, explanation: 'not validated' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const seed = Math.floor(Math.random() * 999999);

      // For later attempts, increase emphasis on the outfit name and wearing verb
      let promptParts = [...baseImagePromptParts];
      if (attempt > 1) {
        promptParts.unshift(`The subject is clearly wearing: ${outfitRecommendation.outfitName}`);
        promptParts.push('Emphasize: full outfit clearly visible and distinct from underwear or casual wear');
      }

      const fullImagePrompt = promptParts.join(', ');

      const imageResult = await generateImageWithPollinations(fullImagePrompt, seed);
      generatedImageUrl = imageResult.url;
      generatedImageSrcSet = imageResult.srcset;

      // Validate the generated image using Groq vision model
      imageValidation = await validateImageWithGroq(groq, generatedImageUrl, `${outfitRecommendation.outfitName}: ${outfitRecommendation.outfitDescription}`);

      // Accept if passes thresholds
      if (imageValidation.nsfwProbability <= nsfwThreshold && imageValidation.similarity >= similarityThreshold) {
        break; // good image
      }

      // Otherwise log and retry (unless last attempt)
      console.warn(`Image validation attempt ${attempt} failed: nsfw=${imageValidation.nsfwProbability}, sim=${imageValidation.similarity}. Explanation: ${imageValidation.explanation}`);

      // continue loop to retry
    } catch (imageError) {
      console.error('Image generation error on attempt', attempt, imageError?.message || imageError);
    }
  }

  // If final image still fails, set generatedImageUrl to null so frontend can show fallback
  if (imageValidation.nsfwProbability > nsfwThreshold || imageValidation.similarity < similarityThreshold) {
    console.warn('Final generated image did not pass validation. Returning null image to frontend. Validation:', imageValidation);
    generatedImageUrl = null;
    generatedImageSrcSet = null;
  }

  return {
    success: true,
    photoAnalysis,
    outfitRecommendation,
    generatedImageUrl,
    generatedImageSrcSet,
    photoPath: filename,
    referenceImageUrl: uploadedUrl,
    imageValidation,
  };
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  // keep express timeouts reasonable for local servers; Vercel will enforce its own limits
  req.setTimeout(60000);
  res.setTimeout(60000);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    // If ASYNC_ANALYZE is enabled, enqueue a job and return 202 + jobId immediately.
    if (process.env.ASYNC_ANALYZE === 'true') {
      const jobId = uuidv4();
      const filePath = req.file.path;
      const filename = req.file.filename;
      const mimeType = req.file.mimetype;
      const body = req.body;

      jobs.set(jobId, { status: 'pending', createdAt: Date.now() });

      // background processing (fire-and-forget)
      (async () => {
        try {
          const hostInfo = { protocol: req.protocol, host: req.get('host') };
          const result = await processAnalysis({ photoPath: filePath, filename, mimeType, body, hostInfo });
          jobs.set(jobId, { status: 'completed', result, completedAt: Date.now() });
        } catch (err) {
          console.error('Async job failed:', err?.message || err);
          jobs.set(jobId, { status: 'failed', error: err?.message || String(err), completedAt: Date.now() });
        }

        // schedule cleanup after 30 minutes
        setTimeout(() => jobs.delete(jobId), 1000 * 60 * 30);

        // remove temp file
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      })();

      return res.status(202).json({ jobId });
    }

    // Synchronous path (existing behavior)
    const hostInfo = { protocol: req.protocol, host: req.get('host') };
    const result = await processAnalysis({ photoPath: req.file.path, filename: req.file.filename, mimeType: req.file.mimetype, body: req.body, hostInfo });

    // remove temp file after processing
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

// Status endpoint for async jobs
router.get('/analyze/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'pending') return res.json({ status: 'pending' });
  if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
  return res.json({ status: 'completed', result: job.result });
});

export default router;
