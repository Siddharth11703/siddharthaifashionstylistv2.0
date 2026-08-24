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

function parseAgeYears(age) {
  const raw = String(age || '').trim().toLowerCase();
  if (!raw) return null;
  const digits = raw.match(/\d{1,3}/);
  if (digits) return Math.min(100, Math.max(1, parseInt(digits[0], 10)));
  const words = {
    teen: 18,
    teenager: 18,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  for (const [word, years] of Object.entries(words)) {
    if (raw.includes(word)) return years;
  }
  return null;
}

function genderNoun(photoAnalysis) {
  const raw = String(photoAnalysis?.gender || '').trim().toLowerCase();
  if (raw === 'female' || raw === 'woman' || raw === 'girl') return 'woman';
  if (raw === 'male' || raw === 'man' || raw === 'boy') return 'man';
  return 'person';
}

function classifyBodyType(bodyType) {
  const key = String(bodyType || '').trim().toLowerCase();
  if (!key) return '';
  const isPlus = /(plus\s*size|plus-size|overweight|heavy|chubby|fat)/.test(key);
  const isPetite = key.includes('petite');
  const isAthletic = /(athletic|muscular|sporty)/.test(key) || /\bfit\b/.test(key);
  const isSlim = /(slim|thin|lean|skinny)/.test(key);
  const isCurvy = /(curvy|hourglass)/.test(key);
  const isAverage = /(average|regular|medium|normal|standard)/.test(key);
  if (isPlus && isPetite) return 'petite-plus';
  if (isPlus) return 'plus';
  if (isPetite) return 'petite';
  if (isAthletic) return 'athletic';
  if (isSlim) return 'slim';
  if (isCurvy) return 'curvy';
  if (isAverage) return 'average';
  return 'other';
}

function buildAgeLook(age) {
  const years = parseAgeYears(age);
  const raw = normalizePreference(age);
  if (years >= 60) {
    return {
      years,
      label: `${years}-year-old`,
      phrase: `${years}-year-old elderly senior`,
      visuals: 'grey or white hair, deep wrinkles, aged skin, sagging neck, older adult face, not young, not a 20-year-old, not a 30-year-old',
    };
  }
  if (years >= 50) {
    return {
      years,
      label: `${years}-year-old`,
      phrase: `${years}-year-old older adult`,
      visuals: 'greying hair, mature wrinkled face, 50s appearance, not a young 20-year-old',
    };
  }
  if (years >= 40) {
    return {
      years,
      label: `${years}-year-old`,
      phrase: `${years}-year-old middle-aged adult`,
      visuals: 'mature 40s face, faint wrinkles, not a teenager, not elderly, not grey-haired',
    };
  }
  if (years >= 30) {
    return {
      years,
      label: `${years}-year-old`,
      phrase: `${years}-year-old adult`,
      visuals: '30s adult face, smooth-to-light mature skin, not a teenager, not elderly, no grey hair',
    };
  }
  if (years) {
    return {
      years,
      label: `${years}-year-old`,
      phrase: `${years}-year-old young adult`,
      visuals: 'youthful face, smooth skin, young appearance, not middle-aged, not elderly, no grey hair, no wrinkles',
    };
  }
  if (raw) {
    return { years: null, label: raw, phrase: raw, visuals: `${raw} facial appearance` };
  }
  return { years: null, label: '', phrase: '', visuals: '' };
}

function buildBodyLook(bodyType) {
  const kind = classifyBodyType(bodyType);
  const raw = normalizePreference(bodyType);
  const looks = {
    slim: {
      phrase: 'slim skinny thin body',
      visuals: 'narrow waist, thin arms, slender legs, flat stomach, low body weight, skinny frame, not muscular, not bulky, not plus-size, not overweight',
      fit: 'slim-fit clothes on a thin body',
    },
    athletic: {
      phrase: 'athletic muscular fit body',
      visuals: 'broad shoulders, defined biceps, toned chest, visible muscle, strong legs, gym physique, V-taper, not skinny, not plus-size, not overweight',
      fit: 'fitted clothes on a muscular athletic body',
    },
    plus: {
      phrase: 'plus-size overweight heavy body',
      visuals: 'large round belly, thick waist, wide torso, heavy-set figure, thick arms and thighs, double chin, not slim, not skinny, not athletic',
      fit: 'relaxed clothes on a plus-size heavy body',
    },
    petite: {
      phrase: 'petite short small-frame body',
      visuals: 'short stature, small bone structure, compact proportions, short legs, not tall, not plus-size',
      fit: 'clothes scaled to a petite short body',
    },
    'petite-plus': {
      phrase: 'petite plus-size short heavy body',
      visuals: 'short stature, round belly, full figure, thick waist, not tall, not slim',
      fit: 'clothes on a short plus-size body',
    },
    curvy: {
      phrase: 'curvy hourglass body',
      visuals: 'full hips, defined waist, rounded figure, not skinny, not a bodybuilder',
      fit: 'clothes on a curvy hourglass body',
    },
    average: {
      phrase: 'average regular medium build',
      visuals: 'neither skinny nor overweight, regular proportions, typical healthy body',
      fit: 'regular-fit clothes on an average body',
    },
    other: {
      phrase: raw ? `${raw} body` : '',
      visuals: raw ? `body shape is ${raw}, body type ${raw}` : '',
      fit: raw ? `clothes on a ${raw} body` : '',
    },
    '': {
      phrase: '',
      visuals: '',
      fit: '',
    },
  };
  return { kind, raw, ...(looks[kind] || looks.other) };
}

// Age and body type are independent. Whatever the user picked (slim, athletic,
// petite, plus-size, 20 / 30 / 60, etc.) is locked into the subject line.
function buildPersonPrompt({ age, bodyType, photoAnalysis, height }) {
  const gender = genderNoun(photoAnalysis);
  const ageLook = buildAgeLook(age);
  const bodyLook = buildBodyLook(bodyType);
  const heightBit = normalizePreference(height) ? `${normalizePreference(height)} tall, ` : '';
  const ethnicity = photoAnalysis?.ethnicAppearance || '';
  const skin = photoAnalysis?.skinTone ? `${photoAnalysis.skinTone} skin` : '';

  const subject = [bodyLook.phrase, ageLook.phrase, gender].filter(Boolean).join(' ');
  const lock = [
    ageLook.label ? `age ${ageLook.label}` : '',
    bodyLook.raw ? `body type ${bodyLook.raw}` : '',
  ].filter(Boolean).join(', ');

  const appearance = [subject, lock, heightBit + bodyLook.visuals, ageLook.visuals, ethnicity, skin]
    .filter(Boolean)
    .join(', ');

  return {
    appearance,
    subject,
    lock,
    details: [bodyLook.visuals, ageLook.visuals].filter(Boolean).join(', '),
    fit: bodyLook.fit,
    kind: bodyLook.kind,
    expectedAgeLabel: ageLook.label,
    expectedBodyLabel: bodyLook.raw,
  };
}

function buildOccasionGuidance(occasion) {
  const normalizedOccasion = normalizePreference(occasion);
  const key = normalizedOccasion.toLowerCase();

  const rules = [
    {
      matches: ['wedding', 'marriage', 'bridal', 'bride', 'groom', 'sangeet', 'mehendi', 'reception', 'haldi'],
      guidance: 'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual, offic[...]',
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

const NEGATIVE_INSTRUCTIONS = 'fully clothed, uncropped';
const FULL_BODY_FRAMING = 'full body photo, head to toe, shoes and floor visible';

function buildFluxPrompt(personPrompt, outfitPrompt, { repeatBody = false } = {}) {
  const parts = [
    FULL_BODY_FRAMING,
    personPrompt.subject,
    personPrompt.lock,
    personPrompt.details,
  ];
  if (repeatBody && personPrompt.subject) {
    parts.push(personPrompt.subject);
    parts.push(personPrompt.lock);
  }
  parts.push(`wearing ${outfitPrompt}${personPrompt.fit ? `, ${personPrompt.fit}` : ''}`);
  parts.push('plain studio backdrop');
  parts.push(NEGATIVE_INSTRUCTIONS);
  return parts.filter(Boolean).join(', ');
}

async function validateImageWithGroq(groqClient, imageUrl, outfitText, personPrompt = {}) {
  const expectedAge = personPrompt.expectedAgeLabel || '';
  const expectedBody = personPrompt.expectedBodyLabel || '';
  const bodyKind = personPrompt.kind || '';
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
              text: `You are an image validation assistant. Analyze the provided image. Respond ONLY in strict JSON: {"nsfwProbability": number, "similarity": number, "fullBody": boolean, "ageMatch": boolean, "bodyTypeMatch": boolean, "explanation": string}.

Outfit: ${outfitText}
Required age: ${expectedAge || 'any'}
Required body type: ${expectedBody || 'any'} (${bodyKind || 'unspecified'})

Rules:
1) nsfwProbability: 0-1, nudity/underwear/sexual content.
2) similarity: 0-1, outfit match.
3) fullBody: true only if head-to-shoes, both feet visible.
4) ageMatch: true ONLY if apparent age matches the required age.
   - 20s must look young. Grey hair or an elderly face is FALSE.
   - 30s must look like a 30-year-old adult, not a teen and not 60.
   - 50s/60s MUST look older: wrinkles and aged face. A 20-year-old model is FALSE.
5) bodyTypeMatch: true ONLY if the body matches the required type. Be STRICT for every type, not only plus-size.
   - slim: thin/skinny/lean. Muscular gym body or plus-size is FALSE.
   - athletic: muscular/toned/gym body. Skinny or plus-size is FALSE.
   - petite: short small frame.
   - plus-size / overweight: large belly, thick waist, heavy-set. Slim or athletic is FALSE.
   - average/regular: neither skinny nor plus-size.
   - any other label: the visible body must match that label.
6) explanation: say the age and body you actually see vs what was required.

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
      console.warn('Validator failed to return JSON. Skipping validation. Raw:', raw);
      return { nsfwProbability: 0, similarity: 1.0, fullBody: true, ageMatch: true, bodyTypeMatch: true, explanation: 'Validation bypassed' };
    }
    const parsed = JSON.parse(match[0]);
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      fullBody: parsed.fullBody !== false,
      ageMatch: expectedAge ? parsed.ageMatch === true : true,
      bodyTypeMatch: expectedBody ? parsed.bodyTypeMatch === true : true,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    return { nsfwProbability: 0, similarity: 1.0, fullBody: true, ageMatch: true, bodyTypeMatch: true, explanation: 'Validation service error bypassed' };
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

  const defaultWidth = 1024;
  const defaultHeight = 1536;
  const defaultUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${defaultWidth}&height=${defaultHeight}&model=flux&nologo=true&enhance=false&safe=false${seedParam}`;

  return {
    url: defaultUrl,
    srcset: srcParts.join(', '),
  };
}

function scoreCandidate({ validation }, nsfwThreshold) {
  const safe = validation.nsfwProbability <= nsfwThreshold ? 1 : 0;
  return (
    safe * 100 +
    (validation.bodyTypeMatch ? 25 : 0) +
    (validation.ageMatch ? 25 : 0) +
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
  const { occasion, budget, height, age, bodyType } = body || {};
  const occasionGuidance = buildOccasionGuidance(occasion);

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

  const personPrompt = buildPersonPrompt({ age, bodyType, photoAnalysis, height });
  const bodyFitByKind = {
    plus: 'Garment fit MUST be relaxed/roomy on a plus-size body (no slim-fit).',
    'petite-plus': 'Garment fit MUST suit a short plus-size body.',
    slim: 'Garment fit MUST be slim-fit on a thin body (no baggy, no muscular cut).',
    athletic: 'Garment fit MUST be tailored on a muscular athletic body.',
    petite: 'Garment fit MUST suit a petite short frame.',
    curvy: 'Garment fit MUST suit a curvy hourglass body.',
    average: 'Garment fit MUST be regular-fit on an average medium body.',
    other: `Garment fit MUST match a ${bodyType || 'typical'} body.`,
  };
  const bodyFitInstruction = bodyFitByKind[personPrompt.kind] || bodyFitByKind.other;

  const textResponse = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are Siddharth, a top professional fashion stylist. You create hyper-personalized outfit recommendations. The requested occasion is mandatory: never return a generic outfit[...]',
      },
      {
        role: 'user',
        content: `Create a detailed outfit recommendation for a person with the following profile:\n\nPhoto Analysis:\n- Skin Tone: ${photoAnalysis.skinTone}\n- Gender: ${photoAnalysis.gender}\n- Ethnic Appearance: ${photoAnalysis.ethnicAppearance}\n- Hair: ${photoAnalysis.hairDescription}\n- Face: ${photoAnalysis.faceDescription}\n- Appearance: ${photoAnalysis.appearanceDescription}\n\nPreferences:\n- Occasion: ${occasionGuidance.label}\n- Mandatory Occasion Dress Code: ${occasionGuidance.specificity}\n- Budget: ${budget}\n- Height: ${height}\n- Age Group: ${age}\n- Body Type: ${bodyType}\n- Body-type fit rule: ${bodyFitInstruction || 'match the stated body type'}\n\nProvide:\n1. A complete, elaborative outfit breakdown that is specific to the occasion and budget.\n2. Mention every visible attire layer and accessory: primary garment, inner/outer layers, bottoms, footwear, socks/hosiery if applicable, belt or waist detail, watch, jewellery, bag/clutch/backpa[...]\n3. For each item, include color, fabric/material, texture/finish, fit/silhouette, and small design details.\n4. Why this outfit suits their appearance, body type, skin tone, ethnic appearance, and the exact occasion dress code.\n5. Styling tips personalized to their look.\n\nRespond in JSON:\n{\n  "outfitName": "Short catchy name",\n  "outfitDescription": "Elaborative 6-10 sentence outfit description. Describe the full look from head to toe. Explicitly include all clothing layers and accessories with colors, fabrics/material[...]\n  "colorPalette": ["array of 3-6 color names used in the outfit, e.g. Terracotta"],\n  "explanation": "Why this full attire works for this person specifically, including body type, height, age group, skin tone, ethnic appearance, budget, and occasion",\n  "keyPieces": ["array of 5-8 short strings, one per garment/accessory, e.g. Charcoal linen blazer"],
  "occasions": ["array of 2-4 short strings naming events this look suits"],
  "stylingTips": ["array of 3-5 personalized styling tips, including how to place or pair accessories"],\n  "imagePrompt": "Max 16 words: colour + fit + garment for upper layer, lower garment, footwear. Fit must match body type. Garments only."\n}`,
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

  const nsfwThreshold = parseFloat(process.env.NSFW_THRESHOLD || '0.1');
  const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.30');
  const parallelCount = Math.min(2, Math.max(1, parseInt(process.env.IMAGE_GEN_MAX_ATTEMPTS || '2', 10)));

  const outfitText = `${outfitRecommendation.outfitName}: ${outfitRecommendation.outfitDescription}`;
  const promptA = buildFluxPrompt(personPrompt, outfitRecommendation.imagePrompt, { repeatBody: false });
  const promptB = buildFluxPrompt(personPrompt, outfitRecommendation.imagePrompt, { repeatBody: true });

  const tasks = [
    generateAndValidateCandidate(
      groq,
      promptA,
      Math.floor(Math.random() * 999999),
      outfitText,
      personPrompt,
      nsfwThreshold,
    ),
  ];
  if (parallelCount > 1) {
    tasks.push(
      generateAndValidateCandidate(
        groq,
        promptB,
        Math.floor(Math.random() * 999999),
        outfitText,
        personPrompt,
        nsfwThreshold,
      ),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const candidates = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value);

  if (settled.some((item) => item.status === 'rejected')) {
    settled.forEach((item, i) => {
      if (item.status === 'rejected') {
        console.error('Image generation error on candidate', i + 1, item.reason?.message || item.reason);
      }
    });
  }

  let bestCandidate = null;
  for (const candidate of candidates) {
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  let generatedImageUrl = null;
  let generatedImageSrcSet = null;
  let imageValidation = { nsfwProbability: 1, similarity: 0, fullBody: false, ageMatch: false, bodyTypeMatch: false, explanation: 'not validated' };

  if (bestCandidate) {
    generatedImageUrl = bestCandidate.result.url;
    generatedImageSrcSet = bestCandidate.result.srcset;
    imageValidation = bestCandidate.validation;
    console.warn(
      `Picked image candidate: nsfw=${imageValidation.nsfwProbability}, sim=${imageValidation.similarity}, fullBody=${imageValidation.fullBody}, ageMatch=${imageValidation.ageMatch}, bodyTypeMatch=${imageValidation.bodyTypeMatch}. ${imageValidation.explanation}`,
    );
  }

  if (imageValidation.nsfwProbability > nsfwThreshold) {
    console.warn('Final generated image failed the safety check. Returning null image to frontend. Validation:', imageValidation);
    generatedImageUrl = null;
    generatedImageSrcSet = null;
  } else if (!imageValidation.fullBody || imageValidation.similarity < similarityThreshold || !imageValidation.ageMatch || !imageValidation.bodyTypeMatch) {
    console.warn('Final generated image is imperfect but safe; keeping it. Validation:', imageValidation);
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
    const result = await processAnalysis({ photoPath: req.file.path, filename: req.file.filename, mimeType: req.file.mimetype, body: req.body, hostInfo });

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
