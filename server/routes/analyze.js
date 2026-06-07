import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

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

const escapeXml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const wrapText = (value = '', maxChars = 48, maxLines = 4) => {
  const words = String(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    if (lines.length >= maxLines) return;
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current && lines.length < maxLines) lines.push(current);
  return lines;
};

const svgToDataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function buildFallbackOutfitImage(outfitRecommendation, photoAnalysis, occasion) {
  const title = escapeXml(outfitRecommendation.outfitName || 'Personalized Outfit');
  const descriptionLines = wrapText(outfitRecommendation.outfitDescription || '', 54, 5);
  const paletteLines = wrapText(outfitRecommendation.colorPalette || '', 48, 3);
  const skinTone = escapeXml(photoAnalysis.skinTone || 'your skin tone');
  const look = escapeXml(photoAnalysis.ethnicAppearance || 'your look');
  const occasionLabel = escapeXml(occasion || 'your occasion');

  const descriptionSvg = descriptionLines.map((line, index) => (
    `<text x="92" y="620" dy="${index * 30}" class="body">${escapeXml(line)}</text>`
  )).join('');
  const paletteSvg = paletteLines.map((line, index) => (
    `<text x="92" y="820" dy="${index * 26}" class="small">${escapeXml(line)}</text>`
  )).join('');

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024" role="img" aria-label="Generated outfit preview">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15091f"/>
      <stop offset="0.45" stop-color="#32134f"/>
      <stop offset="1" stop-color="#0f0f0f"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9333ea"/>
      <stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
    <style>
      .label { font: 700 20px Inter, Arial, sans-serif; fill: #c084fc; letter-spacing: 2px; text-transform: uppercase; }
      .title { font: 800 48px Inter, Arial, sans-serif; fill: #ffffff; }
      .subtitle { font: 500 24px Inter, Arial, sans-serif; fill: rgba(255,255,255,0.72); }
      .body { font: 500 23px Inter, Arial, sans-serif; fill: rgba(255,255,255,0.88); }
      .small { font: 500 20px Inter, Arial, sans-serif; fill: rgba(255,255,255,0.68); }
      .chip { font: 700 18px Inter, Arial, sans-serif; fill: #ffffff; }
    </style>
  </defs>
  <rect width="768" height="1024" fill="url(#bg)"/>
  <circle cx="660" cy="120" r="180" fill="#9333ea" opacity="0.18"/>
  <circle cx="80" cy="900" r="220" fill="#ec4899" opacity="0.16"/>

  <rect x="56" y="56" width="656" height="912" rx="42" fill="url(#card)" stroke="rgba(255,255,255,0.18)" filter="url(#shadow)"/>
  <text x="92" y="132" class="label">AI Fashion Preview</text>
  <text x="92" y="196" class="title">${title}</text>
  <text x="92" y="238" class="subtitle">Styled for ${skinTone} · ${look}</text>

  <g transform="translate(234 292)">
    <ellipse cx="150" cy="592" rx="126" ry="24" fill="#000" opacity="0.28"/>
    <circle cx="150" cy="72" r="52" fill="#b9825b"/>
    <path d="M104 69c12-58 80-70 111-22 14 22 8 47-4 66-15-34-44-45-83-41-7 16-14 27-24 35-8-14-9-25 0-38z" fill="#22140f"/>
    <path d="M94 156c22-34 91-50 112-2l24 168H69l25-166z" fill="url(#accent)"/>
    <path d="M86 165c-36 46-54 103-63 170l44 8c10-55 25-101 52-139z" fill="#7c3aed"/>
    <path d="M214 165c36 46 54 103 63 170l-44 8c-10-55-25-101-52-139z" fill="#ec4899"/>
    <path d="M73 333h154l-23 244h-54l-17-169-18 169H62z" fill="#151827"/>
    <path d="M43 574h88v36H38c-16 0-21-25 5-36z" fill="#f8fafc"/>
    <path d="M151 574h88c26 11 21 36 5 36h-93z" fill="#f8fafc"/>
    <rect x="68" y="316" width="164" height="24" rx="12" fill="#fbbf24"/>
    <circle cx="150" cy="328" r="10" fill="#111827" opacity="0.75"/>
  </g>

  <rect x="92" y="520" width="584" height="2" fill="url(#accent)" opacity="0.65"/>
  <text x="92" y="574" class="label">Complete Outfit</text>
  ${descriptionSvg}

  <g transform="translate(92 744)">
    <rect width="170" height="46" rx="23" fill="#9333ea" opacity="0.82"/>
    <text x="85" y="30" text-anchor="middle" class="chip">${occasionLabel}</text>
    <rect x="190" width="134" height="46" rx="23" fill="#ec4899" opacity="0.82"/>
    <text x="257" y="30" text-anchor="middle" class="chip">Head-to-toe</text>
    <rect x="344" width="154" height="46" rx="23" fill="#f59e0b" opacity="0.82"/>
    <text x="421" y="30" text-anchor="middle" class="chip">Color matched</text>
  </g>

  <text x="92" y="800" class="label">Palette Notes</text>
  ${paletteSvg}
  <text x="92" y="930" class="small">Fallback preview shown because the live image provider did not return an image.</text>
</svg>`;

  return svgToDataUrl(svg);
}

// Generate image using Pollinations AI and convert it to a data URL so the UI
// does not depend on the browser loading a third-party image URL directly.
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1024&model=flux&nologo=true&enhance=true${seedParam}`;
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(45000) });

  if (!response.ok) {
    throw new Error(`Pollinations returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Pollinations returned ${contentType || 'an unknown content type'}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  return {
    sourceUrl: imageUrl,
    dataUrl: `data:${contentType};base64,${imageBuffer.toString('base64')}`,
  };
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  req.setTimeout(60000);
  res.setTimeout(60000);

  try {
    const { occasion, budget, height, age, bodyType } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const photoPath = req.file.path;
    const photoData = fs.readFileSync(photoPath);
    const base64Photo = photoData.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1: Deep photo analysis — extract appearance details to replicate the person
    const visionResponse = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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

    let photoAnalysis;
    try {
      const rawText = visionResponse.choices[0].message.content;
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      photoAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        skinTone: 'medium',
        gender: 'neutral',
        hairDescription: 'dark hair',
        faceDescription: 'neutral facial features',
        ethnicAppearance: 'South Asian',
        appearanceDescription: 'person with medium build',
        styleFeatures: 'casual style',
      };
    } catch {
      photoAnalysis = {
        skinTone: 'medium',
        gender: 'neutral',
        hairDescription: 'dark hair',
        faceDescription: 'neutral facial features',
        ethnicAppearance: 'South Asian',
        appearanceDescription: 'stylish individual',
        styleFeatures: 'casual style',
      };
    }

    // Step 2: Generate outfit recommendation text with persona-aware styling
    const textResponse = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. Always factor in the person\'s exact ethnic appearance, skin tone, and physical features when choosing colors and styles.',
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
- Occasion: ${occasion}
- Budget: ${budget}
- Height: ${height}
- Age Group: ${age}
- Body Type: ${bodyType}

Provide:
1. Specific outfit items with colors that complement their exact skin tone and ethnic features
2. Why this outfit suits their appearance, body type, and occasion
3. Styling tips personalized to their look

Respond in JSON:
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
      max_tokens: 1200,
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
      `wearing ${outfitRecommendation.imagePrompt}`,
      `complete outfit visible from head to toe including shoes, socks if applicable, belt, watch, jewellery, bag and all accessories`,
      `shoes clearly detailed — leather texture, sole, laces or straps fully visible`,
      `entire body in frame: head, torso, arms, legs, feet — nothing cropped`,
      `clean white seamless studio background, professional fashion editorial lighting, sharp crisp details throughout`,
      `ultra high resolution 4K, magazine cover quality, photorealistic skin and fabric textures`,
      `the model looks like a real ${photoAnalysis.ethnicAppearance} person`,
      `camera angle: straight on, full-length shot, neutral expression`,
    ].join(', ');

    let generatedImageUrl = null;
    let generatedImageSourceUrl = null;
    let generatedImageFallback = false;
    let generatedImageError = null;

    try {
      const seed = Math.floor(Math.random() * 999999);
      const generatedImage = await generateImageWithPollinations(fullImagePrompt, seed);
      generatedImageUrl = generatedImage.dataUrl;
      generatedImageSourceUrl = generatedImage.sourceUrl;
    } catch (imageError) {
      console.error('Image generation error:', imageError.message);
      generatedImageFallback = true;
      generatedImageError = imageError.message;
      generatedImageUrl = buildFallbackOutfitImage(outfitRecommendation, photoAnalysis, occasion);
    }

    res.json({
      success: true,
      photoAnalysis,
      outfitRecommendation,
      generatedImageUrl,
      generatedImageSourceUrl,
      generatedImageFallback,
      generatedImageError,
      photoPath: req.file.filename,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

export default router;
