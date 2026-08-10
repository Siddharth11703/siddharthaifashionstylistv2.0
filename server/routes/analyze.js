import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';

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
      guidance: 'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual, officewear, or gymwear',
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
  const specificity = matchedRule ? matchedRule.guidance : `clearly ${normalizedOccasion || 'the requested occasion'}-appropriate styling with no generic casual outfit unless the occasion itself is casual`;

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

Respond only with JSON and nothing else.
`,
            },
          ],
        },
      ],
      max_tokens: 400,
    });

    const raw = response.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { nsfwProbability: 1.0, similarity: 0.0, explanation: 'No JSON response from validator' };
    const parsed = JSON.parse(match[0]);
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    return { nsfwProbability: 1.0, similarity: 0.0, explanation: 'Validation service error' };
  }
}

// Generate image using Pollinations AI (returns url + srcset)
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';

  // Request multiple sizes and return a srcset so the browser can pick the right density
  const widths = [768, 1536, 2048, 3072]; // include larger widths for high-DPI
  const srcParts = widths.map((w) => {
    const h = Math.round((w * 4) / 3); // keep 3:4 aspect ratio (width:height)
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&model=flux&nologo=true&enhance=true${seedParam} ${w}w`;
  });

  const defaultWidth = 1536;
  const defaultHeight = Math.round((defaultWidth * 4) / 3);
  const defaultUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${defaultWidth}&height=${defaultHeight}&model=flux&nologo=true&enhance=true${seedParam}`;

  return {
    url: defaultUrl,
    srcset: srcParts.join(', '),
  };
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  req.setTimeout(60000);
  res.setTimeout(60000);

  try {
    const { occasion, budget, height, age, bodyType } = req.body;
    const occasionGuidance = buildOccasionGuidance(occasion);

    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const photoPath = req.file.path;
    const photoData = fs.readFileSync(photoPath);
    const base64Photo = photoData.toString('base64');
    const mimeType = req.file.mimetype;

    // Build publicly-accessible URL to uploaded file so generation service can use it as a reference.
    // Note: in production behind a different host you may need to build the absolute URL differently.
    const uploadedUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

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
                text: `Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS. Return ONLY valid JSON with the fields listed below.

1. skinTone: exact skin tone (e.g., "warm fair", "medium olive", "rich dark brown", "cool light beige")
2. gender: male/female/neutral
3. hairDescription: hair color, length, texture (e.g., "short black curly hair", "long straight brown hair")
4. faceDescription: key facial features (e.g., "round face with brown eyes", "sharp jawline with dark eyes", "high cheekbones")
5. ethnicAppearance: apparent ethnic appearance for realistic generation (e.g., "South Asian", "East Asian", "Black", "Hispanic", "Middle Eastern", "White/Caucasian", "Mixed")
6. appearanceDescription: 1-sentence holistic description
7. styleFeatures: any current style elements visible

Respond ONLY in valid JSON:
{
  "skinTone": "",
  "gender": "",
  "hairDescription": "",
  "faceDescription": "",
  "ethnicAppearance": "",
  "appearanceDescription": "",
  "styleFeatures": ""
}`,
              },
            ],
          },
        ],
        max_tokens: 600,
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
          content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. The requested occasion is mandatory: never return a generic outfit. Always include specific fabric, color, fit, accessories and explain why it suits the person.',
        },
        {
          role: 'user',
          content: `Create a detailed outfit recommendation for a person with the following profile:

Photo Analysis:
- Skin Tone: ${photoAnalysis.skinTone}
- Gender: ${photoAnalysis.gender}
- Ethnic Appearance: ${photoAnalysis.ethnicAppearance}
- Hair: ${photoAnalysis.hairDescription}
- Face: ${photoAnalysis.faceDescription}
- Appearance: ${photoAnalysis.appearanceDescription}

Preferences:
- Occasion: ${occasionGuidance.label}
- Mandatory Occasion Dress Code: ${occasionGuidance.specificity}
- Budget: ${budget}
- Height: ${height}
- Age Group: ${age}
- Body Type: ${bodyType}

Provide:
1. A complete, elaborative outfit breakdown that is specific to the occasion and budget.
2. Mention every visible attire layer and accessory: primary garment, inner/outer layers, bottoms, footwear, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpack, hair accessory, and headwear when applicable.
3. For each item, include color, fabric/material, texture/finish, fit/silhouette, and small design details.
4. Why this outfit suits their appearance, body type, skin tone, ethnic appearance, and the exact occasion dress code.
5. Styling tips personalized to their look.

Respond in JSON:
{
  "outfitName": "Short catchy name",
  "outfitDescription": "Elaborative 6-10 sentence outfit description. Describe the full look from head to toe. Explicitly include all clothing layers and accessories with colors, fabrics/materials and trims.",
  "colorPalette": "Detailed 3-5 sentence explanation of the colors and why they suit this person's specific skin tone and the occasion",
  "explanation": "Why this full attire works for this person specifically, including body type, height, age group, skin tone, ethnic appearance, budget, and occasion",
  "stylingTips": "3-5 personalized styling tips, including how to place or pair accessories",
  "imagePrompt": "Detailed image generation prompt describing the COMPLETE outfit head to toe and explicitly naming the occasion as ${occasionGuidance.label}. Include every visible attire item and accessory and finish with clear photographic instructions.",
}
`,
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
      return res.status(500).json({ error: 'Failed to generate outfit recommendation' });
    }

    // Step 3: Build a person-matching image prompt for Pollinations AI
    const appearanceDesc = buildAppearanceDescriptor(photoAnalysis, height, bodyType, age);

    // Prepend the reference image line and add strict instructions to preserve face identity
    const baseImagePromptParts = [
      `REFERENCE_IMAGE: ${uploadedUrl}`, // explicit reference image
      `A full-length photorealistic fashion photograph of ${appearanceDesc}`,
      `standing upright in a confident natural pose, feet flat on ground, both feet and shoes fully visible`,
      `MANDATORY OCCASION: ${occasionGuidance.label}; dress code must be ${occasionGuidance.specificity}`,
      `wearing this exact elaborative outfit: ${outfitRecommendation.outfitDescription}`,
      `visible accessories must be included exactly as described: jewellery, watch, belt or waist detail, bag or clutch, scarf, dupatta, tie, pocket square, headwear or hair accessory when present`,
      `image detail prompt: ${outfitRecommendation.imagePrompt}`,
      `STRICT INSTRUCTIONS: Use the face in REFERENCE_IMAGE exactly — preserve identity, facial proportions, hairline, skin tone and eyes. Full body must be visible from head to toes; do NOT crop.`,
      `the outfit must visually communicate ${occasionGuidance.label} immediately; avoid generic casual clothing, plain t-shirts, basic jeans, gymwear, or office wear unless explicitly requested`,
      `complete outfit visible from head to toe including shoes, socks if applicable, belt, watch, jewellery, bag and all accessories`,
      `shoes clearly detailed — leather texture, sole, laces or straps fully visible`,
      `entire body in frame: head, torso, arms, legs, feet — nothing cropped`,
      `clean white seamless studio background, professional fashion editorial lighting, sharp crisp details throughout`,
      `ultra high resolution 4K, magazine cover quality, photorealistic skin and fabric textures`,
      `the model looks like a real ${photoAnalysis.ethnicAppearance} person`,
      `camera angle: straight on, full-length shot, neutral expression`,
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

    res.json({
      success: true,
      photoAnalysis,
      outfitRecommendation,
      generatedImageUrl,
      generatedImageSrcSet,
      photoPath: req.file.filename,
      referenceImageUrl: uploadedUrl,
      imageValidation,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

export default router;
