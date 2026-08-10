import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Current GroqCloud model IDs. Keep these configurable so deprecated/removed
// models can be replaced from the environment without another deployment.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';

const isJsonValidationError = (error) => {
  const message = error?.message || '';
  const code = error?.error?.code || error?.code || '';
  return code === 'json_validate_failed' || message.includes('json_validate_failed');
};

const parseJsonObject = (rawText) => {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
};

const withJsonRetryMessage = (messages) => [
  ...messages,
  {
    role: 'user',
    content: 'Your previous response was not valid JSON. Return only one parseable JSON object that matches the requested keys. No markdown, no prose, no code fences.',
  },
];

async function createGroqJsonCompletion(groq, params, { forcePlainJson = false } = {}) {
  try {
    return await groq.chat.completions.create({
      ...params,
      temperature: 0.2,
      ...(forcePlainJson ? {} : { response_format: { type: 'json_object' } }),
    });
  } catch (error) {
    if (!isJsonValidationError(error)) {
      throw error;
    }

    console.warn(`Groq JSON mode validation failed for ${params.model}; retrying without response_format.`);
    return groq.chat.completions.create({
      ...params,
      temperature: 0,
    });
  }
}

async function createGroqParsedJsonCompletion(groq, params) {
  const firstResponse = await createGroqJsonCompletion(groq, params);
  const firstRawText = firstResponse.choices[0].message.content;
  const firstParsed = parseJsonObject(firstRawText);

  if (firstParsed) return firstParsed;

  console.warn(`Groq returned malformed JSON for ${params.model}; retrying with stricter JSON instructions.`);
  const retryResponse = await createGroqJsonCompletion(
    groq,
    {
      ...params,
      messages: withJsonRetryMessage(params.messages),
    },
    { forcePlainJson: true },
  );
  return parseJsonObject(retryResponse.choices[0].message.content);
}

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

// Build a hyper-specific appearance prompt so the model matches the user
function buildAppearanceDescriptor(resolvedPhotoAnalysis, height, bodyType, age) {
  const { skinTone, gender, hairDescription, faceDescription, appearanceDescription } = resolvedPhotoAnalysis;

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

  return `a real-looking ${ageDesc} ${heightWord} ${genderWord} with ${skinTone} skin tone, ${bodyDesc}${hairDescription ? `, ${hairDescription}` : ''}${faceDescription ? `, ${faceDescription}` : ''}, ${appearanceDescription || ''}`.trim();
}

// Generate image using Pollinations AI
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1024&model=flux&nologo=true&enhance=true${seedParam}`;
  return imageUrl;
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  req.setTimeout(60000);
  res.setTimeout(60000);

  try {
    const { occasion, budget, height, age, bodyType } = req.body || {};

    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const photoPath = req.file.path;
    const photoData = fs.readFileSync(photoPath);
    const base64Photo = photoData.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1: Deep photo analysis — extract appearance details to replicate the person
    const photoAnalysis = await createGroqParsedJsonCompletion(groq, {
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
              text: `Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS specific person. Provide:

1. skinTone: exact skin tone (e.g., "warm fair", "medium olive", "rich dark brown", "cool light beige")
2. gender: male/female/neutral
3. hairDescription: hair color, length, texture (e.g., "short black curly hair", "long straight brown hair")
4. faceDescription: key facial features (e.g., "round face with brown eyes", "sharp jawline with dark eyes", "high cheekbones")
5. ethnicAppearance: apparent ethnic appearance for realistic generation (e.g., "South Asian", "East Asian", "Black", "Hispanic", "Middle Eastern", "White/Caucasian", "Mixed")
6. appearanceDescription: 1-sentence holistic description
7. styleFeatures: any current style elements visible

Return exactly one valid JSON object. Do not include markdown, comments, trailing commas, or extra text. JSON schema:
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
      max_completion_tokens: 600,
    });


    if (!photoAnalysis) {
      console.warn('Groq vision response could not be parsed; using safe default photo analysis.');
    }

    const resolvedPhotoAnalysis = photoAnalysis || {
      skinTone: 'medium',
      gender: 'neutral',
      hairDescription: 'dark hair',
      faceDescription: 'neutral facial features',
      ethnicAppearance: 'South Asian',
      appearanceDescription: 'stylish individual',
      styleFeatures: 'casual style',
    };

    // Step 2: Generate outfit recommendation text with persona-aware styling
    const outfitRecommendation = await createGroqParsedJsonCompletion(groq, {
      model: GROQ_TEXT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. Always factor in the person\'s exact ethnic appearance, skin tone, and physical features when choosing colors and styles.',
        },
        {
          role: 'user',
          content: `Create a detailed outfit recommendation for a person with the following profile:

Photo Analysis:
- Skin Tone: ${resolvedPhotoAnalysis.skinTone}
- Gender: ${resolvedPhotoAnalysis.gender}
- Ethnic Appearance: ${resolvedPhotoAnalysis.ethnicAppearance}
- Hair: ${resolvedPhotoAnalysis.hairDescription}
- Face: ${resolvedPhotoAnalysis.faceDescription}
- Appearance: ${resolvedPhotoAnalysis.appearanceDescription}

Preferences:
- Occasion: ${occasion}
- Budget: ${budget}
- Height: ${height}
- Age Group: ${age}
- Body Type: ${bodyType}

Provide:
1. Specific outfit items with colors that complement their exact skin tone and ethnic features
2. Why this outfit suits their appearance, body type, and occasion
3. Styling tips personalized to their look

Return exactly one valid JSON object. Do not include markdown, comments, trailing commas, or extra text. JSON schema:
{
  "outfitName": "Short catchy name",
  "outfitDescription": "Detailed outfit description with exact items and colors",
  "colorPalette": "Colors and why they suit this person's specific skin tone",
  "explanation": "Why this outfit works for this person specifically",
  "stylingTips": "2-3 personalized styling tips",
  "imagePrompt": "Detailed image generation prompt describing the COMPLETE outfit head to toe — top, bottom or dress, specific shoes (type, color, material), socks if applicable, belt, watch, jewellery, bag or backpack, sunglasses if relevant, and all accessories. Include fabric textures, colors, and fit details. Do NOT describe the person's face or body."
}`,
        },
      ],
      max_completion_tokens: 1200,
    });

    if (!outfitRecommendation) {
      return res.status(500).json({ error: 'Failed to generate outfit recommendation' });
    }

    // Step 3: Build a person-matching image prompt for Pollinations AI
    const appearanceDesc = buildAppearanceDescriptor(resolvedPhotoAnalysis, height, bodyType, age);

    const fullImagePrompt = [
      `Photorealistic full body fashion photography of ${appearanceDesc}`,
      `standing upright in a confident natural pose, feet flat on ground, both feet and shoes fully visible`,
      `wearing ${outfitRecommendation.imagePrompt}`,
      `complete outfit visible from head to toe including shoes, socks if applicable, belt, watch, jewellery, bag and all accessories`,
      `shoes clearly detailed — leather texture, sole, laces or straps fully visible`,
      `entire body in frame: head, torso, arms, legs, feet — nothing cropped`,
      `clean white seamless studio background, professional fashion editorial lighting, sharp crisp details throughout`,
      `ultra high resolution 4K, magazine cover quality, photorealistic skin and fabric textures`,
      `the model looks like a real ${resolvedPhotoAnalysis.ethnicAppearance} person`,
      `camera angle: straight on, full-length shot, neutral expression`,
    ].join(', ');

    let generatedImageUrl = null;
    try {
      const seed = Math.floor(Math.random() * 999999);
      generatedImageUrl = await generateImageWithPollinations(fullImagePrompt, seed);
    } catch (imageError) {
      console.error('Image generation error:', imageError.message);
    }

    res.json({
      success: true,
      photoAnalysis: resolvedPhotoAnalysis,
      outfitRecommendation,
      generatedImageUrl,
      photoPath: req.file.filename,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

export default router;
