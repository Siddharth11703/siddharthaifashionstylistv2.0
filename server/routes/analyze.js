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

  return `a real-looking ${ageDesc} ${heightWord} ${genderWord} with ${skinTone} skin tone, ${bodyDesc}${hairDescription ? `, ${hairDescription}` : ''}${faceDescription ? `, ${faceDescription}` : ''}, ${appearanceDescription || ''}`.trim();
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
      guidance: 'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual, office, streetwear, gym, or plain everyday clothing',
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

    // Step 1: Deep photo analysis — extract appearance details to replicate the person.
    // If the configured vision model is unavailable in production, continue with a
    // safe fallback instead of failing the whole /analyze request.
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
                text: `Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS specific person. Provide:

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
          content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. The requested occasion is mandatory: never return a generic outfit when a formal, festive, wedding, business, party, date, athletic, or other specific occasion is provided. Always factor in the person\'s exact ethnic appearance, skin tone, and physical features when choosing colors and styles.',
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
2. Mention every visible attire layer and accessory: primary garment, inner/outer layers, bottoms, footwear, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpack, hair accessory/headwear, scarf/dupatta/tie/pocket square when relevant, and any culturally appropriate occasion pieces.
3. For each item, include color, fabric/material, texture/finish, fit/silhouette, and small design details.
4. Why this outfit suits their appearance, body type, skin tone, ethnic appearance, and the exact occasion dress code.
5. Styling tips personalized to their look.

Respond in JSON:
{
  "outfitName": "Short catchy name",
  "outfitDescription": "Elaborative 6-10 sentence outfit description. Describe the full look from head to toe. Explicitly include all clothing layers and accessories with colors, fabrics/materials, texture/finish, fit, shoes, and occasion-specific details. Do not be brief.",
  "colorPalette": "Detailed 3-5 sentence explanation of the colors and why they suit this person's specific skin tone and the occasion",
  "explanation": "Why this full attire works for this person specifically, including body type, height, age group, skin tone, ethnic appearance, budget, and occasion",
  "stylingTips": "3-5 personalized styling tips, including how to place or pair accessories",
  "imagePrompt": "Detailed image generation prompt describing the COMPLETE outfit head to toe and explicitly naming the occasion as ${occasionGuidance.label}. Include every visible attire item and accessory from outfitDescription: primary garment, inner/outer layers, bottoms, shoes, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpack, hair accessory/headwear, scarf/dupatta/tie/pocket square when relevant, and culturally appropriate occasion pieces. Include fabric textures, colors, fit details, and a phrase that says this is not casual everyday clothing unless the requested occasion is casual. Do NOT describe the person's face or body."
}`,
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

    const fullImagePrompt = [
      `Photorealistic full body fashion photography of ${appearanceDesc}`,
      `standing upright in a confident natural pose, feet flat on ground, both feet and shoes fully visible`,
      `MANDATORY OCCASION: ${occasionGuidance.label}; dress code must be ${occasionGuidance.specificity}`,
      `wearing this exact elaborative outfit: ${outfitRecommendation.outfitDescription}`,
      `visible accessories must be included exactly as described: jewellery, watch, belt or waist detail, bag or clutch, scarf, dupatta, tie, pocket square, headwear or hair accessory when present`,
      `image detail prompt: ${outfitRecommendation.imagePrompt}`,
      `the outfit must visually communicate ${occasionGuidance.label} immediately; avoid generic casual clothing, plain t-shirts, basic jeans, gymwear, or office wear unless explicitly requested`,
      `complete outfit visible from head to toe including shoes, socks if applicable, belt, watch, jewellery, bag and all accessories`,
      `shoes clearly detailed — leather texture, sole, laces or straps fully visible`,
      `entire body in frame: head, torso, arms, legs, feet — nothing cropped`,
      `clean white seamless studio background, professional fashion editorial lighting, sharp crisp details throughout`,
      `ultra high resolution 4K, magazine cover quality, photorealistic skin and fabric textures`,
      `the model looks like a real ${photoAnalysis.ethnicAppearance} person`,
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
      photoAnalysis,
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
