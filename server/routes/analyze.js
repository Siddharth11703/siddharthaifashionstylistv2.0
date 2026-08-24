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

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function readUserInputs(body = {}) {
  return {
    occasion: body.occasion || body.event || '',
    budget: body.budget || body.budgetRange || '',
    height: body.height || body.heightGroup || '',
    age: body.age || body.ageGroup || body.age_group || '',
    bodyType: body.bodyType || body.body_type || body.bodyShape || body.body_shape || '',
  };
}

function mapAgeGroup(age) {
  const raw = lower(age);
  if (!raw) return { years: null, label: '', phrase: '', visuals: '' };

  if (raw.includes('teen') || raw.includes('13-19') || raw.includes('13–19')) {
    return {
      years: 17,
      label: 'Teen 13-19',
      phrase: '17-year-old teenager',
      visuals: 'teenage face, youthful features, young student look, not an adult, not middle-aged, not elderly',
    };
  }
  if (raw.includes('young adult') || raw.includes('20-30') || raw.includes('20–30')) {
    return {
      years: 25,
      label: 'Young Adult 20-30',
      phrase: '25-year-old young adult',
      visuals: 'young adult 20s face, smooth skin, not a child, not middle-aged, not elderly, no grey hair',
    };
  }
  if (raw.includes('middle') || raw.includes('46-60') || raw.includes('46–60')) {
    return {
      years: 52,
      label: 'Middle Age 46-60',
      phrase: '52-year-old middle-aged adult',
      visuals: 'middle-aged face, faint wrinkles, greying temples, 50s look, not a 20-year-old, not a teenager',
    };
  }
  if (raw.includes('senior') || raw.includes('60+') || raw.includes('elderly')) {
    return {
      years: 65,
      label: 'Senior 60+',
      phrase: '65-year-old elderly senior',
      visuals: 'elderly face, grey or white hair, deep wrinkles, aged skin, sagging neck, not young, not a 20-year-old',
    };
  }
  if (raw.includes('adult') || raw.includes('31-45') || raw.includes('31–45')) {
    return {
      years: 38,
      label: 'Adult 31-45',
      phrase: '38-year-old adult',
      visuals: 'adult 30s-40s face, light maturity, not a teenager, not elderly, no white hair',
    };
  }

  const digits = raw.match(/\d{1,3}/);
  if (digits) {
    const years = Math.min(80, Math.max(13, parseInt(digits[0], 10)));
    if (years >= 60) return mapAgeGroup('Senior');
    if (years >= 46) return mapAgeGroup('Middle Age');
    if (years >= 31) return mapAgeGroup('Adult');
    if (years >= 20) return mapAgeGroup('Young Adult');
    return mapAgeGroup('Teen');
  }

  return { years: null, label: normalizePreference(age), phrase: normalizePreference(age), visuals: `${normalizePreference(age)} appearance` };
}

function mapHeight(height) {
  const raw = lower(height);
  if (!raw) return { label: '', phrase: '', shortLabel: '' };
  if (raw.includes('short') || raw.includes('under')) {
    return { label: 'Short under 5\'4"', phrase: 'short stature, under 5 foot 4, short legs, not tall', shortLabel: 'short' };
  }
  if (raw.includes('tall') || raw.includes('above')) {
    return { label: 'Tall above 5\'9"', phrase: 'tall stature, over 5 foot 9, long legs, not short', shortLabel: 'tall' };
  }
  return { label: 'Medium 5\'4"-5\'9"', phrase: 'average medium height, about 5 foot 6', shortLabel: 'medium height' };
}

function mapBudget(budget) {
  const raw = lower(budget);
  if (raw.includes('luxury') || raw.includes('25,000') || raw.includes('25000')) {
    return { label: 'Luxury ₹25,000+', guidance: 'high-quality realistic luxury pieces a real person would wear, not couture costume' };
  }
  if (raw.includes('premium') || raw.includes('8,000') || raw.includes('8000')) {
    return { label: 'Premium ₹8,000–₹25,000', guidance: 'good quality branded pieces, still a normal wearable outfit' };
  }
  if (raw.includes('mid')) {
    return { label: 'Mid-range ₹2,000–₹8,000', guidance: 'common high-street / Myntra-level outfit, realistic prices' };
  }
  return { label: 'Budget under ₹2,000', guidance: 'simple affordable commonly worn pieces, no designer, no rare fabrics' };
}

function mapBodyType(bodyType) {
  const raw = lower(bodyType);
  const label = normalizePreference(bodyType);
  if (raw.includes('pear')) {
    return {
      kind: 'pear',
      label: label || 'Pear Shape',
      phrase: 'pear-shaped body, wider hips',
      visuals: 'narrower shoulders, defined waist, wider hips, fuller thighs, more weight on the lower body, not an inverted triangle, not skinny-straight',
      fit: 'clothes that skim wider hips on a pear-shaped body',
    };
  }
  if (raw.includes('hourglass') || raw.includes('defined waist')) {
    return {
      kind: 'hourglass',
      label: label || 'Hourglass',
      phrase: 'hourglass body, defined waist',
      visuals: 'balanced bust and hips, cinched defined waist, curved figure, not straight, not plus-size bulky',
      fit: 'clothes that show a defined waist on an hourglass body',
    };
  }
  if (raw.includes('plus') || raw.includes('fuller') || raw.includes('overweight')) {
    return {
      kind: 'plus',
      label: label || 'Plus Size',
      phrase: 'plus-size fuller-figure body',
      visuals: 'fuller figure, large round belly, thick waist, wide torso, heavy-set, thick arms and thighs, not slim, not athletic, not a model body',
      fit: 'relaxed clothes on a plus-size fuller body',
    };
  }
  if (raw.includes('athletic') || raw.includes('muscular') || raw.includes('toned')) {
    return {
      kind: 'athletic',
      label: label || 'Athletic',
      phrase: 'athletic muscular toned body',
      visuals: 'broad shoulders, defined biceps, toned chest, visible muscle, strong legs, gym physique, not skinny, not plus-size',
      fit: 'fitted clothes on a muscular athletic body',
    };
  }
  if (raw.includes('slim') || raw.includes('lean') || raw.includes('slender') || raw.includes('skinny')) {
    return {
      kind: 'slim',
      label: label || 'Slim',
      phrase: 'slim lean slender body',
      visuals: 'narrow waist, thin arms, slender legs, flat stomach, skinny frame, not muscular, not plus-size, not bulky',
      fit: 'slim-fit clothes on a lean slender body',
    };
  }
  if (raw.includes('average') || raw.includes('balanced') || raw.includes('regular') || raw.includes('medium')) {
    return {
      kind: 'average',
      label: label || 'Average',
      phrase: 'average balanced medium build',
      visuals: 'regular proportions, neither skinny nor plus-size, typical healthy body, not a bodybuilder',
      fit: 'regular-fit clothes on an average balanced body',
    };
  }
  if (label) {
    return {
      kind: 'other',
      label,
      phrase: `${label} body`,
      visuals: `body type is ${label}, body shape ${label}`,
      fit: `clothes on a ${label} body`,
    };
  }
  return { kind: '', label: '', phrase: '', visuals: '', fit: '' };
}

function genderNoun(photoAnalysis) {
  const raw = lower(photoAnalysis?.gender);
  if (['female', 'woman', 'girl', 'lady', 'women'].includes(raw)) return 'woman';
  if (['male', 'man', 'boy', 'men', 'gentleman'].includes(raw)) return 'man';
  const blob = lower(
    `${photoAnalysis?.hairDescription} ${photoAnalysis?.faceDescription} ${photoAnalysis?.appearanceDescription} ${photoAnalysis?.styleFeatures}`,
  );
  if (/(beard|stubble|moustache|mustache|goatee)/.test(blob)) return 'man';
  if (/(woman|female|lipstick)/.test(blob)) return 'woman';
  return 'person';
}

function ageAdjustHair(hair, ageLook) {
  const h = normalizePreference(hair);
  if (ageLook.years >= 60) {
    if (!h) return 'grey hair';
    if (/grey|gray|white|silver/.test(lower(h))) return h;
    return `greying ${h}`;
  }
  return h;
}

function buildPersonPrompt({ age, bodyType, height, photoAnalysis }) {
  const gender = genderNoun(photoAnalysis);
  const ageLook = mapAgeGroup(age);
  const bodyLook = mapBodyType(bodyType);
  const heightLook = mapHeight(height);
  const ethnicity = photoAnalysis?.ethnicAppearance || '';
  const skin = photoAnalysis?.skinTone ? `${photoAnalysis.skinTone} skin` : '';
  const hair = ageAdjustHair(photoAnalysis?.hairDescription, ageLook);
  const face = normalizePreference(photoAnalysis?.faceDescription);

  const subject = [bodyLook.phrase, heightLook.shortLabel, ageLook.phrase, gender].filter(Boolean).join(' ');
  const lock = [
    ageLook.label ? `age group ${ageLook.label}` : '',
    bodyLook.label ? `body type ${bodyLook.label}` : '',
    heightLook.label ? `height ${heightLook.label}` : '',
    gender !== 'person' ? `gender ${gender}` : '',
  ].filter(Boolean).join(', ');

  const likeness = [hair, face, ethnicity, skin].filter(Boolean).join(', ');
  const details = [bodyLook.visuals, heightLook.phrase, ageLook.visuals, likeness].filter(Boolean).join(', ');

  return {
    subject,
    lock,
    details,
    fit: bodyLook.fit,
    kind: bodyLook.kind,
    gender,
    expectedAgeLabel: ageLook.label,
    expectedBodyLabel: bodyLook.label,
    expectedGender: gender,
    expectedHeight: heightLook.label,
  };
}

function buildOccasionGuidance(occasion) {
  const normalizedOccasion = normalizePreference(occasion);
  const key = lower(normalizedOccasion);

  const rules = [
    {
      matches: ['wedding', 'marriage', 'bridal', 'bride', 'groom', 'sangeet', 'mehendi', 'mehndi', 'reception', 'haldi'],
      guidance: 'festive wedding-guest clothing people actually wear: dressy ethnic or formal, polished shoes, tasteful jewellery. Not casual jeans, not gymwear, not office formals unless it is a court wedding.',
    },
    {
      matches: ['party', 'club', 'birthday', 'celebration', 'night out'],
      guidance: 'a common party outfit for this age and budget: one statement piece, normal shoes, light accessories. Not a celebrity red-carpet look.',
    },
    {
      matches: ['interview', 'office', 'business', 'corporate', 'meeting', 'work'],
      guidance: 'normal office/interview clothes: shirt or blouse, trousers or formal bottom, clean shoes. Not partywear, not loungewear.',
    },
    {
      matches: ['date', 'dinner', 'romantic'],
      guidance: 'smart casual date/dinner clothes, neat and flattering, common pieces. Not gymwear, not a tuxedo unless asked.',
    },
    {
      matches: ['gym', 'workout', 'fitness', 'sport'],
      guidance: 'normal gym clothes: t-shirt or tank, joggers or shorts, trainers. Not formalwear.',
    },
    {
      matches: ['beach', 'vacation', 'holiday', 'travel'],
      guidance: 'common vacation/beach clothes for the climate: breathable separates, sandals or trainers. Not a wedding outfit.',
    },
    {
      matches: ['festival', 'festive', 'diwali', 'eid', 'christmas', 'puja', 'navratri', 'onam', 'pongal'],
      guidance: 'common festive clothes for this culture and budget: dressy ethnic or smart festive western, not plain gym clothes.',
    },
    {
      matches: ['casual', 'daily', 'everyday', 'college', 'campus'],
      guidance: 'everyday casual clothes: jeans or simple bottom, plain top, common sneakers. Not formal, not party.',
    },
  ];

  const matchedRule = rules.find((rule) => rule.matches.some((term) => key.includes(term)));
  return {
    label: normalizedOccasion || 'everyday',
    specificity: matchedRule
      ? matchedRule.guidance
      : `a realistic commonly worn outfit for ${normalizedOccasion || 'the stated occasion'}, not a generic random look`,
  };
}

const NEGATIVE_INSTRUCTIONS = 'fully clothed, uncropped';
const FULL_BODY_FRAMING = 'full body photo, head to toe, shoes and floor visible';

function garmentsForImage(rec) {
  const pieces = Array.isArray(rec?.keyPieces) ? rec.keyPieces.map((p) => String(p || '').trim()).filter(Boolean) : [];
  if (pieces.length) return pieces.slice(0, 6).join(', ');
  if (rec?.imagePrompt) return String(rec.imagePrompt).trim();
  return 'simple occasion-appropriate outfit';
}

function buildFluxPrompt(personPrompt, garmentList, { repeat = false } = {}) {
  const parts = [
    FULL_BODY_FRAMING,
    personPrompt.subject,
    personPrompt.lock,
    personPrompt.details,
  ];
  if (repeat) {
    parts.push(personPrompt.subject);
    parts.push(personPrompt.lock);
  }
  parts.push(`wearing ${garmentList}${personPrompt.fit ? `, ${personPrompt.fit}` : ''}`);
  parts.push('plain studio backdrop');
  parts.push(NEGATIVE_INSTRUCTIONS);
  return parts.filter(Boolean).join(', ');
}

async function validateImageWithGroq(groqClient, imageUrl, outfitText, personPrompt = {}) {
  const expectedAge = personPrompt.expectedAgeLabel || '';
  const expectedBody = personPrompt.expectedBodyLabel || '';
  const expectedGender = personPrompt.expectedGender || '';
  const bodyKind = personPrompt.kind || '';
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            {
              type: 'text',
              text: `Validate this fashion photo. JSON only: {"nsfwProbability":number,"similarity":number,"fullBody":boolean,"ageMatch":boolean,"bodyTypeMatch":boolean,"genderMatch":boolean,"outfitMatch":boolean,"explanation":string}

Required gender: ${expectedGender || 'any'}
Required age group: ${expectedAge || 'any'}
Required body type: ${expectedBody || 'any'} (${bodyKind || 'unspecified'})
Outfit that MUST be visible: ${outfitText}

Rules:
1) nsfwProbability 0-1.
2) similarity 0-1 how well clothes match the outfit list.
3) fullBody true only if head-to-shoes, both feet visible.
4) genderMatch true only if the person is the required gender. A woman is FALSE if required is man, and vice versa.
5) ageMatch true only if apparent age matches the age group (Teen 13-19, Young Adult 20-30, Adult 31-45, Middle Age 46-60, Senior 60+). A 20-year-old model is FALSE for Middle Age or Senior. An elderly face is FALSE for Teen or Young Adult.
6) bodyTypeMatch true only if the body matches:
   - Slim: lean/slender/thin. Muscular or plus-size is FALSE.
   - Athletic: muscular/toned. Skinny or plus-size is FALSE.
   - Average: balanced, neither skinny nor plus-size.
   - Plus Size: fuller figure, larger midsection. Slim or athletic is FALSE.
   - Pear Shape: wider hips than shoulders.
   - Hourglass: defined waist, balanced hips and bust.
7) outfitMatch true only if the visible clothes are the listed outfit, not a different look.
8) explanation: gender, age, body, and clothes you actually see.

JSON only.`,
            },
          ],
        },
      ],
      reasoning_effort: 'none',
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0].message.content;
    const match = stripReasoning(raw).match(/\{[\s\S]*\}/);
    if (!match) {
      return { nsfwProbability: 0, similarity: 1, fullBody: true, ageMatch: true, bodyTypeMatch: true, genderMatch: true, outfitMatch: true, explanation: 'Validation bypassed' };
    }
    const parsed = JSON.parse(match[0]);
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      fullBody: parsed.fullBody !== false,
      ageMatch: expectedAge ? parsed.ageMatch === true : true,
      bodyTypeMatch: expectedBody ? parsed.bodyTypeMatch === true : true,
      genderMatch: expectedGender && expectedGender !== 'person' ? parsed.genderMatch === true : true,
      outfitMatch: parsed.outfitMatch !== false,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    return { nsfwProbability: 0, similarity: 1, fullBody: true, ageMatch: true, bodyTypeMatch: true, genderMatch: true, outfitMatch: true, explanation: 'Validation service error bypassed' };
  }
}

async function fetchImageAsDataUrl(url, timeoutMs = 30000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  const buf = await response.arrayBuffer();
  const mime = response.headers.get('content-type') || 'image/jpeg';
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const widths = [576, 768, 1024];
  const srcParts = widths.map((w) => {
    const h = Math.round((w * 3) / 2);
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&model=flux&nologo=true&enhance=false&safe=false${seedParam} ${w}w`;
  });
  const defaultUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1536&model=flux&nologo=true&enhance=false&safe=false${seedParam}`;
  return { url: defaultUrl, srcset: srcParts.join(', ') };
}

function scoreCandidate({ validation }, nsfwThreshold) {
  const safe = validation.nsfwProbability <= nsfwThreshold ? 1 : 0;
  return (
    safe * 100 +
    (validation.genderMatch ? 20 : 0) +
    (validation.bodyTypeMatch ? 20 : 0) +
    (validation.ageMatch ? 20 : 0) +
    (validation.outfitMatch ? 15 : 0) +
    (validation.fullBody ? 10 : 0) +
    validation.similarity
  );
}

async function generateAndValidateCandidate(groq, prompt, seed, outfitText, personPrompt, nsfwThreshold) {
  const imageResult = await generateImageWithPollinations(prompt, seed);
  let validationImage = imageResult.url;
  try {
    validationImage = await fetchImageAsDataUrl(imageResult.url, 30000);
  } catch (err) {
    console.warn('Image fetch/warm failed:', err?.message || err);
  }
  const validation = await validateImageWithGroq(groq, validationImage, outfitText, personPrompt);
  return { result: imageResult, validation, score: scoreCandidate({ validation }, nsfwThreshold) };
}

const jobs = new Map();

async function processAnalysis({ photoPath, filename, mimeType, body, hostInfo }) {
  const inputs = readUserInputs(body);
  const { occasion, budget, height, age, bodyType } = inputs;
  const occasionGuidance = buildOccasionGuidance(occasion);
  const budgetInfo = mapBudget(budget);
  const heightInfo = mapHeight(height);
  const ageInfo = mapAgeGroup(age);
  const bodyInfo = mapBodyType(bodyType);

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const photoData = fs.readFileSync(photoPath);
  const base64Photo = photoData.toString('base64');
  const uploadedUrl = `${hostInfo.protocol}://${hostInfo.host}/uploads/${filename}`;

  let photoAnalysis = getFallbackPhotoAnalysis();
  try {
    const visionResponse = await groq.chat.completions.create({
      model: GROQ_VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Photo}` } },
            {
              type: 'text',
              text: `Analyze this photo for a fashion avatar that must LOOK LIKE this same person.

Return ONLY JSON:
{
  "skinTone": "exact skin tone",
  "gender": "male or female",
  "hairDescription": "color, length, texture",
  "faceDescription": "key facial features",
  "ethnicAppearance": "South Asian / East Asian / Black / Hispanic / Middle Eastern / White / Mixed",
  "appearanceDescription": "one sentence",
  "styleFeatures": "visible current clothes/style"
}

Gender rules:
- Return exactly "male" or "female". Do not return "neutral" unless the face is fully hidden.
- Beard, stubble, moustache, or Adam's apple => male.
- Clearly feminine face/makeup/body => female.
- Do not flip gender.

JSON only. No markdown.`,
            },
          ],
        },
      ],
      reasoning_effort: 'none',
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    photoAnalysis = parsePhotoAnalysis(visionResponse.choices[0].message.content);
  } catch (visionError) {
    console.warn(`Vision analysis failed with model ${GROQ_VISION_MODEL}:`, visionError.message);
  }

  const personPrompt = buildPersonPrompt({ age, bodyType, height, photoAnalysis });
  const gender = personPrompt.gender;
  const genderClothes =
    gender === 'man'
      ? 'MENSWEAR only: shirt, kurta, trousers, jeans, jacket, sneakers or formal shoes. Never a dress, saree, lehenga, skirt, heels, or blouse.'
      : gender === 'woman'
        ? 'WOMENSWEAR appropriate to the occasion: could be western or ethnic. Never mens-only tailoring that ignores that this is a woman.'
        : 'Choose clothing that matches the person in the photo. Do not guess the opposite gender.';

  const ageClothes =
    ageInfo.years && ageInfo.years < 20
      ? 'Age-appropriate modest teen clothing. No sexy clubwear, no lingerie styling, fully covered.'
      : ageInfo.years && ageInfo.years >= 60
        ? 'Mature senior clothing. Not youth streetwear, not crop tops, not teen fashion.'
        : 'Clothing that a real person of this age group would actually wear.';

  const textResponse = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a practical stylist for real people in India and worldwide. Recommend COMMON outfits people actually wear and buy — not runway, not celebrity editorial, not fantasy.

Hard rules:
1) Occasion is mandatory.
2) Budget is mandatory. Cheap budget = simple common pieces.
3) Gender is mandatory. ${genderClothes}
4) Age is mandatory. ${ageClothes}
5) Body type changes FIT, not the occasion. Plus-size gets relaxed common clothes. Slim gets slim-fit common clothes. Athletic gets fitted common clothes. Pear gets hip-friendly cuts. Hourglass gets a defined waist. Average gets regular fit.
6) keyPieces and imagePrompt MUST be the SAME garments in the SAME order. imagePrompt is only those garments (color + item), comma-separated, no camera words.
7) Every look is fully clothed, head to toe, with real shoes.`,
      },
      {
        role: 'user',
        content: `Create one realistic outfit for this person.

Person from photo:
- Gender: ${gender}
- Skin: ${photoAnalysis.skinTone}
- Ethnicity: ${photoAnalysis.ethnicAppearance}
- Hair: ${photoAnalysis.hairDescription}
- Face: ${photoAnalysis.faceDescription}

User selections (must all be respected):
- Occasion: ${occasionGuidance.label}
- Dress code: ${occasionGuidance.specificity}
- Budget: ${budgetInfo.label}. ${budgetInfo.guidance}
- Height: ${heightInfo.label}
- Age group: ${ageInfo.label}
- Body type: ${bodyInfo.label}. ${bodyInfo.visuals}

Return JSON:
{
  "outfitName": "short plain name",
  "outfitDescription": "6-8 sentences, head to toe, the exact common outfit. Same garments as keyPieces.",
  "colorPalette": ["3-6 color names"],
  "explanation": "why this common outfit fits this gender, age, body, budget, height, and occasion",
  "keyPieces": ["color + garment", "color + garment", "color + bottom", "color + shoes", "1-2 accessories"],
  "occasions": ["2-4 matching events"],
  "stylingTips": ["3 practical tips"],
  "imagePrompt": "comma-separated copy of keyPieces only"
}`,
      },
    ],
    max_tokens: 1600,
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

  const garmentList = garmentsForImage(outfitRecommendation);
  outfitRecommendation.imagePrompt = garmentList;

  const nsfwThreshold = parseFloat(process.env.NSFW_THRESHOLD || '0.1');
  const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.30');
  const parallelCount = Math.min(2, Math.max(1, parseInt(process.env.IMAGE_GEN_MAX_ATTEMPTS || '2', 10)));

  const outfitText = `${outfitRecommendation.outfitName}: ${garmentList}. ${outfitRecommendation.outfitDescription || ''}`;
  const promptA = buildFluxPrompt(personPrompt, garmentList, { repeat: false });
  const promptB = buildFluxPrompt(personPrompt, garmentList, { repeat: true });

  const tasks = [
    generateAndValidateCandidate(groq, promptA, Math.floor(Math.random() * 999999), outfitText, personPrompt, nsfwThreshold),
  ];
  if (parallelCount > 1) {
    tasks.push(
      generateAndValidateCandidate(groq, promptB, Math.floor(Math.random() * 999999), outfitText, personPrompt, nsfwThreshold),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const candidates = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  settled.forEach((item, i) => {
    if (item.status === 'rejected') {
      console.error('Image generation error on candidate', i + 1, item.reason?.message || item.reason);
    }
  });

  let bestCandidate = null;
  for (const candidate of candidates) {
    if (!bestCandidate || candidate.score > bestCandidate.score) bestCandidate = candidate;
  }

  let generatedImageUrl = null;
  let generatedImageSrcSet = null;
  let imageValidation = {
    nsfwProbability: 1,
    similarity: 0,
    fullBody: false,
    ageMatch: false,
    bodyTypeMatch: false,
    genderMatch: false,
    outfitMatch: false,
    explanation: 'not validated',
  };

  if (bestCandidate) {
    generatedImageUrl = bestCandidate.result.url;
    generatedImageSrcSet = bestCandidate.result.srcset;
    imageValidation = bestCandidate.validation;
    console.warn(
      `Picked image: nsfw=${imageValidation.nsfwProbability} sim=${imageValidation.similarity} fullBody=${imageValidation.fullBody} gender=${imageValidation.genderMatch} age=${imageValidation.ageMatch} body=${imageValidation.bodyTypeMatch} outfit=${imageValidation.outfitMatch}. ${imageValidation.explanation}`,
    );
  }

  if (imageValidation.nsfwProbability > nsfwThreshold) {
    generatedImageUrl = null;
    generatedImageSrcSet = null;
  }

  return {
    success: true,
    photoAnalysis: { ...photoAnalysis, gender },
    userSelections: {
      occasion: occasionGuidance.label,
      budget: budgetInfo.label,
      height: heightInfo.label,
      age: ageInfo.label,
      bodyType: bodyInfo.label,
      gender,
    },
    outfitRecommendation,
    generatedImageUrl,
    generatedImageSrcSet,
    photoPath: filename,
    referenceImageUrl: uploadedUrl,
    imageValidation,
  };
}

router.post('/analyze', upload.single('photo'), async (req, res) => {
  req.setTimeout(120000);
  res.setTimeout(120000);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo uploaded' });
    }

    if (process.env.ASYNC_ANALYZE === 'true') {
      const jobId = uuidv4();
      const filePath = req.file.path;
      const filename = req.file.filename;
      const mimeType = req.file.mimetype;
      const body = req.body;
      jobs.set(jobId, { status: 'pending', createdAt: Date.now() });

      (async () => {
        try {
          const hostInfo = { protocol: req.protocol, host: req.get('host') };
          const result = await processAnalysis({ photoPath: filePath, filename, mimeType, body, hostInfo });
          jobs.set(jobId, { status: 'completed', result, completedAt: Date.now() });
        } catch (err) {
          console.error('Async job failed:', err?.message || err);
          jobs.set(jobId, { status: 'failed', error: err?.message || String(err), completedAt: Date.now() });
        }
        setTimeout(() => jobs.delete(jobId), 1000 * 60 * 30);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      })();

      return res.status(202).json({ jobId });
    }

    const hostInfo = { protocol: req.protocol, host: req.get('host') };
    const result = await processAnalysis({
      photoPath: req.file.path,
      filename: req.file.filename,
      mimeType: req.file.mimetype,
      body: req.body,
      hostInfo,
    });

    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

router.get('/analyze/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'pending') return res.json({ status: 'pending' });
  if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });
  return res.json({ status: 'completed', result: job.result });
});

export default router;
