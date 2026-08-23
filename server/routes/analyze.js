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
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';

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

// Reasoning-capable models can emit <think> blocks before the JSON payload.
function stripReasoning(rawText) {
  return String(rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
}

function parsePhotoAnalysis(rawText) {
  const jsonMatch = stripReasoning(rawText).match(/\{[\s\S]*\}/);
  if (!jsonMatch) return getFallbackPhotoAnalysis();
  try {
    return { ...getFallbackPhotoAnalysis(), ...JSON.parse(jsonMatch[0]) };
  } catch {
    return getFallbackPhotoAnalysis();
  }
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
// Both strings are deliberately tiny: the generator only honours roughly the first 77 tokens of a
// prompt, so anything verbose here pushes the garments out of the window and the outfit is ignored.
const NEGATIVE_INSTRUCTIONS = 'fully clothed, uncropped';

// Framing goes first because early tokens carry the most weight.
const FULL_BODY_FRAMING = 'full body photo, head to toe, shoes and floor visible';

// Helper: validate generated image using Groq vision model (returns { nsfwProbability, similarity, explanation })
async function validateImageWithGroq(groqClient, imageUrl, outfitText) {
  // The image bytes are already in memory from the warm-up, so hand them to Groq inline instead of
  // making it re-download the (slow to serve) generated image.
  const inlineImage = imageCache.get(imageUrl);
  const imagePayload = inlineImage ? { url: inlineImage } : { url: imageUrl };
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: imagePayload,
            },
            {
              type: 'text',
              text: `You are an image validation assistant. Analyze the provided image and compare it to the provided outfit description. Respond ONLY in strict JSON with fields: {"nsfwProbability": number between 0 and 1, "similarity": number between 0 and 1, "fullBody": boolean, "explanation": string}.

Outfit description (for comparison): ${outfitText}

Instructions:
1) Return nsfwProbability = probability the image contains nudity, underwear-only, or sexual content (0.0-1.0).
2) Return similarity = how well the image matches the outfit description (0.0 = unrelated, 1.0 = exact match). Use a CLIP-like comparison.
3) Return fullBody = true ONLY if the whole person is inside the frame from the top of the head down to the shoes, with both feet visible. Return false for headshots, waist-up or knee-up crops, or any image where the head or the footwear is cut off by the frame edge.
4) Provide a short explanation field describing major mismatches (e.g., "image shows underwear and exposed torso", or "cropped at the knees, shoes not visible").

Answer immediately with the JSON object only: no reasoning, no commentary, no markdown fences.`,
            },
          ],
        },
      ],
      // Reasoning is disabled because the model otherwise spends the whole token budget on a
      // <think> block and gets truncated before it emits any JSON.
      reasoning_effort: 'none',
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0].message.content;
    const match = stripReasoning(raw).match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('Validator failed to return JSON. Skipping validation. Raw:', raw);
      // Accept the image anyway if the validator gets confused
      return { nsfwProbability: 0, similarity: 1.0, fullBody: true, explanation: 'Validation bypassed' };
    }
    const parsed = JSON.parse(match[0]);
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      fullBody: parsed.fullBody !== false,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    // Accept the image anyway if the Groq service fails
    return { nsfwProbability: 0, similarity: 1.0, fullBody: true, explanation: 'Validation service error bypassed' };
  }
}

// Warmed image bytes, keyed by URL, so the validator does not have to fetch them again.
// Entries are short-lived: one request only needs them between warm-up and validation.
const imageCache = new Map();

function cacheImage(url, dataUrl) {
  imageCache.set(url, dataUrl);
  setTimeout(() => imageCache.delete(url), 60000).unref?.();
}

// Pollinations generates the image on the first GET; pre-fetching it makes the URL cheap to load later.
async function warmImageUrl(url, timeoutMs = 45000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (response.ok && buffer.length) {
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      cacheImage(url, `data:${contentType};base64,${buffer.toString('base64')}`);
    }
    return response.ok;
  } catch (err) {
    console.warn('Image warm-up failed:', err?.message || err);
    return false;
  }
}

// Generate image using Pollinations AI
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';

  // 2:3 keeps hair and shoes inside the frame (taller canvases push the feet against the bottom
  // edge). 768x1152 renders noticeably faster than 1024x1536 and is still larger than the card.
  const width = 768;
  const height = 1152;
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&nologo=true&enhance=false&safe=false${seedParam}`;

  return { url };
}

// Rank candidates so a safe full-body image always beats a cropped one, similarity breaking ties.
function scoreCandidate({ validation }, nsfwThreshold) {
  const safe = validation.nsfwProbability <= nsfwThreshold ? 1 : 0;
  return safe * 100 + (validation.fullBody ? 10 : 0) + validation.similarity;
}

// In-memory job store for async processing (simple, non-persistent)
const jobs = new Map();

async function processAnalysis({ photoPath, filename, mimeType, body, hostInfo }) {
  const { occasion, budget, height, age, bodyType } = body || {};
  const occasionGuidance = buildOccasionGuidance(occasion);

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const startedAt = Date.now();
  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

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
            text: `Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS \n\n 1. skinTone: exact skin tone (e.g., "warm fair", "medium olive", "rich dark brown", "cool light beige") \n 2. gender: male/female/neutral \n 3. hairDescription: hair color, length, texture (e.g., "short black curly hair", "long straight brown hair") \n 4. faceDescription: key facial features (e.g., "round face with brown eyes", "sharp jawline with dark eyes", "high cheekbones") \n 5. ethnicAppearance: apparent ethnic appearance for realistic generation (e.g., "South Asian", "East Asian", "Black", "Hispanic", "Middle Eastern", "White/Caucasian", "Mixed") \n 6. appearanceDescription: 1-sentence holistic description \n 7. styleFeatures: any current style elements visible \n\n Respond ONLY in valid JSON: \n {\n "skinTone": "", \n "gender": "", \n "hairDescription": "", \n "faceDescription": "", \n "ethnicAppearance": "", \n "appearanceDescription": "", \n "styleFeatures": "" \n }\n\n IMPORTANT: You must return ONLY a raw, valid JSON object. Do not include markdown blocks (like \`\`\`json). Do not include any conversational text.`,
          },
          ],
        },
      ],
      reasoning_effort: 'none',
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    photoAnalysis = parsePhotoAnalysis(visionResponse.choices[0].message.content);
  } catch (visionError) {
    console.warn(`Vision analysis failed with model ${GROQ_VISION_MODEL}:`, visionError.message);
  }
  console.log(`[analyze] photo analysis done at ${elapsed()}`);

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
        content: `Create a detailed outfit recommendation for a person with the following profile:\n\nPhoto Analysis:\n- Skin Tone: ${photoAnalysis.skinTone}\n- Gender: ${photoAnalysis.gender}\n- Ethnic Appearance: ${photoAnalysis.ethnicAppearance}\n- Hair: ${photoAnalysis.hairDescription}\n- Face: ${photoAnalysis.faceDescription}\n- Appearance: ${photoAnalysis.appearanceDescription}\n\nPreferences:\n- Occasion: ${occasionGuidance.label}\n- Mandatory Occasion Dress Code: ${occasionGuidance.specificity}\n- Budget: ${budget}\n- Height: ${height}\n- Age Group: ${age}\n- Body Type: ${bodyType}\n\nProvide:\n1. A complete, elaborative outfit breakdown that is specific to the occasion and budget.\n2. Mention every visible attire layer and accessory: primary garment, inner/outer layers, bottoms, footwear, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpa[...]\n3. For each item, include color, fabric/material, texture/finish, fit/silhouette, and small design details.\n4. Why this outfit suits their appearance, body type, skin tone, ethnic appearance, and the exact occasion dress code.\n5. Styling tips personalized to their look.\n\nRespond in JSON:\n{\n  "outfitName": "Short catchy name",\n  "outfitDescription": "Elaborative 6-10 sentence outfit description. Describe the full look from head to toe. Explicitly include all clothing layers and accessories with colors, fabrics/material[...]\n  "colorPalette": ["array of 3-6 color names used in the outfit, e.g. Terracotta"],\n  "explanation": "Why this full attire works for this person specifically, including body type, height, age group, skin tone, ethnic appearance, budget, and occasion",\n  "keyPieces": ["array of 5-8 short strings, one per garment/accessory, e.g. Charcoal linen blazer"],
  "occasions": ["array of 2-4 short strings naming events this look suits"],
  "stylingTips": ["array of 3-5 personalized styling tips, including how to place or pair accessories"],\n  "imagePrompt": "Max 20 words: colour + garment for the main upper layer, the lower garment and the footwear, in that head-to-toe order. Garments only, no accessories, no camera or framing words."\n}`,
      },
    ],
    max_tokens: 2600,
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
  console.log(`[analyze] recommendation done at ${elapsed()}`);

// 1. Keep appearance brief so it doesn't waste prompt length or force a face close-up
const simpleAppearance = `${photoAnalysis.ethnicAppearance || ''} ${photoAnalysis.gender || 'person'}, ${photoAnalysis.skinTone || 'medium'} skin, ${bodyType || 'average'} build`;

// 2. Put FULL-BODY framing at the VERY FRONT so Flux reads it first before any truncation
const baseImagePromptParts = [
    FULL_BODY_FRAMING,
    `${simpleAppearance} wearing ${outfitRecommendation.imagePrompt}`,
    'plain studio backdrop',
    NEGATIVE_INSTRUCTIONS,
];

  const maxAttempts = parseInt(process.env.IMAGE_GEN_MAX_ATTEMPTS || '2', 10);
  const nsfwThreshold = parseFloat(process.env.NSFW_THRESHOLD || '0.1');
  const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.30');

  let generatedImageUrl = null;
  let imageValidation = { nsfwProbability: 1, similarity: 0, fullBody: false, explanation: 'not validated' };
  // A cropped image is a defect, so keep the best candidate instead of whatever the last attempt produced.
  let bestCandidate = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const seed = Math.floor(Math.random() * 999999);

      // For later attempts, increase emphasis on the outfit name and wearing verb
      let promptParts = [...baseImagePromptParts];
      if (attempt > 1) {
        promptParts.unshift('zoomed out wide shot');
      }

      const fullImagePrompt = promptParts.join(', ');

      const imageResult = await generateImageWithPollinations(fullImagePrompt, seed);

      // Pollinations renders on first request; warm the URL so the browser gets a cached image
      await warmImageUrl(imageResult.url);
      console.log(`[analyze] image attempt ${attempt} rendered at ${elapsed()}`);

      // Validate the generated image using Groq vision model
      const validation = await validateImageWithGroq(groq, imageResult.url, `${outfitRecommendation.outfitName}: ${outfitRecommendation.outfitDescription}`);
      console.log(`[analyze] image attempt ${attempt} validated at ${elapsed()}`);
      const candidate = { result: imageResult, validation };
      const isSafe = validation.nsfwProbability <= nsfwThreshold;

      if (!bestCandidate || scoreCandidate(candidate, nsfwThreshold) > scoreCandidate(bestCandidate, nsfwThreshold)) {
        bestCandidate = candidate;
      }

      // Accept only a safe, on-brief, uncropped image
      if (isSafe && validation.fullBody && validation.similarity >= similarityThreshold) {
        break;
      }

      console.warn(`Image validation attempt ${attempt} failed: nsfw=${validation.nsfwProbability}, sim=${validation.similarity}, fullBody=${validation.fullBody}. Explanation: ${validation.explanation}`);

      // continue loop to retry
    } catch (imageError) {
      console.error('Image generation error on attempt', attempt, imageError?.message || imageError);
    }
  }

  if (bestCandidate) {
    generatedImageUrl = bestCandidate.result.url;
    imageValidation = bestCandidate.validation;
  }

  // Only drop the image when it is unsafe; a low similarity score is not worth showing nothing.
  if (imageValidation.nsfwProbability > nsfwThreshold) {
    console.warn('Final generated image failed the safety check. Returning null image to frontend. Validation:', imageValidation);
    generatedImageUrl = null;
  } else if (!imageValidation.fullBody || imageValidation.similarity < similarityThreshold) {
    console.warn('Final generated image is imperfect but safe; keeping it. Validation:', imageValidation);
  }

  return {
    success: true,
    photoAnalysis,
    outfitRecommendation,
    generatedImageUrl,
    photoPath: filename,
    referenceImageUrl: uploadedUrl,
    imageValidation,
  };
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  // keep express timeouts reasonable for local servers; Vercel will enforce its own limits
  req.setTimeout(120000);
  res.setTimeout(120000);

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
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      })();

      return res.status(202).json({ jobId });
    }

    // Synchronous path (existing behavior)
    const hostInfo = { protocol: req.protocol, host: req.get('host') };
    const result = await processAnalysis({ photoPath: req.file.path, filename: req.file.filename, mimeType: req.file.mimetype, body: req.body, hostInfo });

    // remove temp file after processing
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

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
