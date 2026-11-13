import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';
// Flux on image.pollinations.ai now returns HTTP 402 Payment Required.
// `sana` is the Pollinations model that still generates an image with no API key.
const POLLINATIONS_FREE_MODEL = 'sana';

const getUploadDir = () => {
  if (process.env.VERCEL === '1') return '/tmp/uploads';
  return path.join(__dirname, '../../uploads');
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = getUploadDir();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `photo_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function getFallbackPhotoAnalysis() {
  return {
    skinTone: 'medium',
    gender: '',
    hairDescription: 'dark hair',
    faceDescription: '',
    ethnicAppearance: 'South Asian',
    appearanceDescription: '',
    styleFeatures: '',
  };
}

function stripReasoning(rawText) {
  return String(rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
}

function parseJsonObject(rawText) {
  const match = stripReasoning(rawText).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function parsePhotoAnalysis(rawText) {
  const parsed = parseJsonObject(rawText);
  if (!parsed) return getFallbackPhotoAnalysis();
  return { ...getFallbackPhotoAnalysis(), ...parsed };
}

function normalizePreference(value) {
  return String(value || '').trim();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  }
  return '';
}

// Word boundaries so "female" is not "male" and "woman" is not "man".
// Negated phrases ("not a woman", "no beard") are removed before matching.
function parseGender(value) {
  if (value === true || value === false) return '';
  const raw = lower(value);
  if (!raw) return '';
  if (raw === 'm' || raw === '1') return 'man';
  if (raw === 'f' || raw === 'w' || raw === '0') return 'woman';
  if (/^(male|man|boy|men|masculine|gentleman)$/.test(raw)) return 'man';
  if (/^(female|woman|girl|lady|women|feminine)$/.test(raw)) return 'woman';

  const stripped = raw
    .replace(/\b(?:not|no|non|never|without|n't)\s+(?:a\s+|an\s+)?(?:fe)?male\b/g, ' ')
    .replace(/\b(?:not|no|non|never|without|n't)\s+(?:a\s+|an\s+)?(?:wo)?man\b/g, ' ')
    .replace(/\b(?:not|no|non|never|without|n't)\s+(?:a\s+|an\s+)?(?:boy|girl|woman|women|lady|feminine|masculine|gentleman)\b/g, ' ');

  const woman = /\b(?:female|woman|girl|lady|women|feminine)\b/.test(stripped);
  const man = /\b(?:male|man|boy|men|masculine|gentleman)\b/.test(stripped);
  if (man && !woman) return 'man';
  if (woman && !man) return 'woman';
  if (man && woman) {
    const lastMan = Math.max(
      stripped.lastIndexOf('male'),
      stripped.lastIndexOf('man'),
      stripped.lastIndexOf('boy'),
    );
    const lastWoman = Math.max(
      stripped.lastIndexOf('female'),
      stripped.lastIndexOf('woman'),
      stripped.lastIndexOf('girl'),
    );
    if (lastMan > lastWoman) return 'man';
    if (lastWoman > lastMan) return 'woman';
  }
  return '';
}

function hasVisibleFacialHair(value) {
  const raw = lower(value);
  if (!raw || /^(none|no|clean|absent|unclear|unknown|n\/a|na)$/.test(raw)) return false;
  if (/\b(?:no|not|none|without|absent|clean[ -]?shaven|lacks?)\b/.test(raw)) return false;
  return /\b(?:stubble|moustache|mustache|beard|goatee|sideburns)\b/.test(raw);
}

// Positive = man, negative = woman. Facial hair only counts when it is present,
// never when the model says "no beard".
function scoreGenderCues(parsed = {}) {
  let score = 0;
  const reasons = [];
  if (hasVisibleFacialHair(parsed.facialHair || parsed.facial_hair || parsed.beard)) {
    score += 6;
    reasons.push('facial-hair');
  }
  const apple = lower(parsed.adamsApple || parsed.adams_apple || parsed.adam);
  if (apple === 'yes' || apple === 'true' || apple === 'visible') {
    score += 3;
    reasons.push('adams-apple');
  }
  const jaw = lower(parsed.jaw);
  if (jaw === 'angular' || jaw === 'square') score += 1;
  if (jaw === 'soft' || jaw === 'round') score -= 1;
  const brow = lower(parsed.browRidge || parsed.brow || parsed.brow_ridge);
  if (brow === 'prominent' || brow === 'heavy') score += 1;
  if (brow === 'soft' || brow === 'light') score -= 1;
  const label = parseGender(parsed.gender || parsed.sex || parsed.label);
  if (label === 'man') {
    score += 3;
    reasons.push('label-man');
  }
  if (label === 'woman') {
    score -= 3;
    reasons.push('label-woman');
  }
  let gender = '';
  if (score >= 3) gender = 'man';
  else if (score <= -3) gender = 'woman';
  else gender = label;
  return { gender, score, reasons, label };
}

function inferGenderFromCues(photoAnalysis) {
  const cues = scoreGenderCues({
    facialHair: photoAnalysis?.facialHair,
    gender: photoAnalysis?.gender,
    jaw: photoAnalysis?.jaw,
    browRidge: photoAnalysis?.browRidge,
  });
  if (cues.gender) return cues.gender;
  const blob = lower(
    `${photoAnalysis?.faceDescription || ''} ${photoAnalysis?.appearanceDescription || ''}`,
  ).replace(/\b(?:no|not|without|absent|clean[ -]?shaven|lacks?)\b[^.]{0,48}/g, ' ');
  if (hasVisibleFacialHair(blob)) return 'man';
  return parseGender(photoAnalysis?.gender);
}

function readUserInputs(body = {}) {
  return {
    occasion: body.occasion || body.event || '',
    budget: body.budget || body.budgetRange || '',
    height: body.height || body.heightGroup || '',
    age: body.age || body.ageGroup || body.age_group || '',
    bodyType: body.bodyType || body.body_type || body.bodyShape || body.body_shape || '',
    gender: parseGender(body.gender || body.sex || ''),
  };
}

function mapAgeGroup(age) {
  const raw = lower(age);
  if (!raw) return { years: null, label: '', phrase: '' };

  if (raw.includes('teen') || raw.includes('13-19') || raw.includes('13–19')) {
    return { years: 17, label: 'Teen 13-19', phrase: '17-year-old teenager' };
  }
  if (raw.includes('young adult') || raw.includes('20-30') || raw.includes('20–30')) {
    return { years: 25, label: 'Young Adult 20-30', phrase: '25-year-old young adult' };
  }
  if (raw.includes('middle') || raw.includes('46-60') || raw.includes('46–60')) {
    return { years: 52, label: 'Middle Age 46-60', phrase: '52-year-old middle-aged' };
  }
  if (raw.includes('senior') || raw.includes('60+') || raw.includes('elderly')) {
    return { years: 65, label: 'Senior 60+', phrase: '65-year-old senior' };
  }
  if (raw.includes('adult') || raw.includes('31-45') || raw.includes('31–45')) {
    return { years: 38, label: 'Adult 31-45', phrase: '38-year-old adult' };
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
  return { years: null, label: normalizePreference(age), phrase: normalizePreference(age) };
}

function mapHeight(height) {
  const raw = lower(height);
  if (raw.includes('short') || raw.includes('under')) {
    return { label: 'Short under 5\'4"', phrase: 'short' };
  }
  if (raw.includes('tall') || raw.includes('above')) {
    return { label: 'Tall above 5\'9"', phrase: 'tall' };
  }
  if (raw) return { label: 'Medium 5\'4"-5\'9"', phrase: 'medium height' };
  return { label: '', phrase: '' };
}

function mapBudget(budget) {
  const raw = lower(budget);
  if (raw.includes('luxury') || raw.includes('25,000') || raw.includes('25000')) {
    return { label: 'Luxury ₹25,000+', guidance: 'high-quality realistic pieces, not couture costume' };
  }
  if (raw.includes('premium') || raw.includes('8,000') || raw.includes('8000')) {
    return { label: 'Premium ₹8,000–₹25,000', guidance: 'good quality branded wearable pieces' };
  }
  if (raw.includes('mid')) {
    return { label: 'Mid-range ₹2,000–₹8,000', guidance: 'common high-street outfit' };
  }
  return { label: 'Budget under ₹2,000', guidance: 'simple affordable commonly worn pieces' };
}

function mapBodyType(bodyType, gender = '') {
  const raw = lower(bodyType);
  const label = normalizePreference(bodyType);
  const noun = gender === 'man' ? 'man' : gender === 'woman' ? 'woman' : 'person';

  if (raw.includes('pear')) {
    return { kind: 'pear', label: label || 'Pear Shape', phrase: `pear-shaped ${noun}`, fit: `pear-shaped ${noun}` };
  }
  if (raw.includes('hourglass')) {
    return { kind: 'hourglass', label: label || 'Hourglass', phrase: `hourglass ${noun}`, fit: `hourglass ${noun}` };
  }
  if (raw.includes('plus') || raw.includes('fuller') || raw.includes('overweight')) {
    return { kind: 'plus', label: label || 'Plus Size', phrase: `plus-size ${noun}`, fit: `plus-size ${noun}` };
  }
  if (raw.includes('athletic') || raw.includes('muscular') || raw.includes('toned')) {
    return { kind: 'athletic', label: label || 'Athletic', phrase: `athletic ${noun}`, fit: `athletic ${noun}` };
  }
  if (raw.includes('slim') || raw.includes('lean') || raw.includes('slender') || raw.includes('skinny')) {
    return {
      kind: 'slim',
      label: label || 'Slim',
      phrase: gender === 'man' ? 'slim thin man' : gender === 'woman' ? 'slim woman' : 'slim person',
      fit: `slim ${noun}`,
    };
  }
  if (raw.includes('average') || raw.includes('balanced') || raw.includes('regular')) {
    return { kind: 'average', label: label || 'Average', phrase: `average ${noun}`, fit: `average ${noun}` };
  }
  if (label) return { kind: 'other', label, phrase: `${label} ${noun}`, fit: `${label} ${noun}` };
  return { kind: '', label: '', phrase: noun, fit: noun };
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

function buildPersonPrompt({ age, bodyType, height, photoAnalysis, gender }) {
  const ageLook = mapAgeGroup(age);
  const bodyLook = mapBodyType(bodyType, gender);
  const heightLook = mapHeight(height);
  const hair = ageAdjustHair(photoAnalysis?.hairDescription, ageLook);
  const skin = photoAnalysis?.skinTone ? `${photoAnalysis.skinTone} skin` : '';
  const ethnicity = photoAnalysis?.ethnicAppearance || '';

  // FIX: Dynamically assign boy/girl for teens instead of man/woman to prevent AI confusion
  let genderNoun = gender;
  if (ageLook.years && ageLook.years <= 19) {
    if (gender === 'man') genderNoun = 'teenage boy';
    if (gender === 'woman') genderNoun = 'teenage girl';
  }

  return {
    gender,
    noun: genderNoun || (gender === 'man' ? 'man' : gender === 'woman' ? 'woman' : 'person'),
    subject: [ageLook.phrase, genderNoun].filter(Boolean).join(' '),
    bodyShort: bodyLook.phrase,
    heightShort: heightLook.phrase,
    hair,
    skin,
    ethnicity,
    kind: bodyLook.kind,
    expectedAgeLabel: ageLook.label,
    expectedBodyLabel: bodyLook.label,
    expectedGender: gender,
  };
}

function buildOccasionGuidance(occasion) {
  const normalizedOccasion = normalizePreference(occasion);
  const key = lower(normalizedOccasion);
  const rules = [
    { matches: ['wedding', 'marriage', 'bridal', 'bride', 'groom', 'sangeet', 'mehendi', 'mehndi', 'reception', 'haldi'], guidance: 'wedding-guest clothing people actually wear: dressy ethnic or formal, real shoes. Not jeans, not gymwear.' },
    { matches: ['party', 'club', 'birthday', 'celebration', 'night out'], guidance: 'a common party outfit: one nice top, normal bottom, real shoes. Not a red-carpet look.' },
    { matches: ['interview', 'office', 'business', 'corporate', 'meeting', 'work'], guidance: 'normal office clothes: shirt or blouse, trousers or formal bottom, clean shoes.' },
    { matches: ['date', 'dinner', 'romantic'], guidance: 'smart casual date clothes, common pieces, real shoes.' },
    { matches: ['gym', 'workout', 'fitness', 'sport'], guidance: 'normal gym clothes: t-shirt, joggers or shorts, trainers.' },
    { matches: ['beach', 'vacation', 'holiday', 'travel'], guidance: 'common vacation clothes: breathable separates, sandals or trainers.' },
    { matches: ['festival', 'festive', 'diwali', 'eid', 'christmas', 'puja', 'navratri', 'onam', 'pongal'], guidance: 'common festive clothes for this budget: dressy ethnic or smart festive western.' },
    { matches: ['casual', 'daily', 'everyday', 'college', 'campus'], guidance: 'everyday casual: jeans or simple bottom, plain top, sneakers.' },
  ];
  const matched = rules.find((rule) => rule.matches.some((term) => key.includes(term)));
  return {
    label: normalizedOccasion || 'everyday',
    specificity: matched ? matched.guidance : `a realistic commonly worn outfit for ${normalizedOccasion || 'the occasion'}`,
  };
}

function itemsToLine(items) {
  return (items || [])
    .map((item) => {
      if (typeof item === 'string') return item.replace(/["']/g, '').trim();
      if (item && typeof item === 'object') {
        return [item.color, item.item || item.name || item.garment].filter(Boolean).join(' ').trim();
      }
      return '';
    })
    .filter(Boolean);
}

async function extractGarmentsForImage(groq, rec) {
  const fallback = itemsToLine(rec?.keyPieces);
  try {
    const response = await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Extract clothing. Return JSON only. No marketing language.',
        },
        {
          role: 'user',
          content: `List EVERY visible garment this person wears, with color. Include every layer, bottom, and shoes. Any clothing type.

Outfit text:
${rec?.outfitDescription || ''}

keyPieces: ${(rec?.keyPieces || []).join('; ')}

JSON: {"items":["color + garment","color + garment","color + bottom","color + shoes"]}`,
        },
      ],
      max_tokens: 250,
      response_format: { type: 'json_object' },
    });
    const parsed = parseJsonObject(messageText(response.choices[0].message)) || {};
    const extracted = itemsToLine(parsed.items || parsed.garments || parsed.keyPieces);
    if (extracted.length >= 3) return extracted;
  } catch (err) {
    console.warn('Garment extract failed:', err?.message || err);
  }
  if (fallback.length) return fallback;
  const fromPrompt = String(rec?.imagePrompt || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromPrompt.length ? fromPrompt : ['simple shirt', 'trousers', 'shoes'];
}

function visualOutfitSpec(items) {
  const pieces = itemsToLine(items);
  const pieceLine = pieces.join(', ');
  const andLine = pieces.join(' and ');
  return { pieces, pieceLine, andLine, wearing: pieceLine };
}

function buildFluxPrompt(person, spec) {
  const g = person.noun || (person.gender === 'woman' ? 'woman' : person.gender === 'man' ? 'man' : 'person');
  const opposite =
    person.gender === 'woman' ? 'a woman, not a man' : person.gender === 'man' ? 'a man, not a woman' : 'one person';

  return [
    `photorealistic full-body studio photo of one ${g}`,
    opposite,
    person.subject,
    person.bodyShort,
    person.heightShort,
    `${g} wearing ${spec.pieceLine}`,
    'entire body in the frame, top of the head visible, face visible, both shoes visible, standing straight, arms relaxed at the sides, two normal arms, both hands visible, anatomically correct, camera far enough to show head to toe, not cropped, not a close-up, not a fashion editorial',
    person.hair,
    person.skin,
    person.ethnicity,
    'plain light gray backdrop, fully clothed, natural skin, real fabric',
  ]
    .filter(Boolean)
    .join(', ');
}

async function groqVision(groq, content, maxTokens) {
  const base = {
    model: GROQ_VISION_MODEL,
    messages: [{ role: 'user', content }],
    max_tokens: maxTokens,
    temperature: 0,
    response_format: { type: 'json_object' },
  };
  try {
    const response = await groq.chat.completions.create({ ...base, reasoning_effort: 'none' });
    return messageText(response.choices[0].message);
  } catch (err) {
    const message = String(err?.message || err);
    if (!/reasoning_effort|unknown parameter|unsupported/i.test(message)) throw err;
    const response = await groq.chat.completions.create(base);
    return messageText(response.choices[0].message);
  }
}

async function detectGenderFromPhoto(groq, dataUrl) {
  const ask = async (strict) => {
    const text = strict
      ? `Look again at the FACE and NECK only. Ignore hair length, clothes, makeup, and jewelry. A man can have long hair. A woman can have short hair.

Return JSON only with these exact values:
{"facialHair":"none|stubble|moustache|beard","adamsApple":"yes|no|unclear","jaw":"angular|soft|unclear","browRidge":"prominent|soft|unclear","gender":"male|female"}

facialHair is "none" unless hair is actually visible on the lip, chin, or cheeks. gender must be "male" or "female".`
      : `Look at the FACE and NECK in this photo for a clothing app. Ignore hairstyle, clothes, jewelry, and makeup. Long hair does not mean female. Short hair does not mean male. Slim does not mean female.

Return JSON only:
{"facialHair":"none|stubble|moustache|beard","adamsApple":"yes|no|unclear","jaw":"angular|soft|unclear","browRidge":"prominent|soft|unclear","gender":"male|female"}

Rules:
- facialHair is "none" unless you can see hair on the upper lip, chin, or cheeks. "Clean shaven" is "none".
- gender is your face-only judgement and must be exactly "male" or "female".
- This is a safe fashion app. Do not refuse teenagers or young adults.`;

    const raw = await groqVision(
      groq,
      [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text },
      ],
      400,
    );
    const parsed = parseJsonObject(raw) || {};
    const decision = scoreGenderCues(parsed);
    return { ...decision, raw: parsed };
  };

  try {
    const first = await ask(false);
    if (first.gender && Math.abs(first.score) >= 3) return first;
    const second = await ask(true);
    if (second.gender && (!first.gender || Math.abs(second.score) >= Math.abs(first.score))) return second;
    return first.gender ? first : second;
  } catch (err) {
    console.warn('Gender detection failed:', err?.message || err);
    return { gender: '', score: 0, reasons: ['error'], raw: {} };
  }
}

async function detectAppearance(groq, dataUrl) {
  try {
    const raw = await groqVision(
      groq,
      [
        { type: 'image_url', image_url: { url: dataUrl } },
        {
          type: 'text',
          text: `Describe this person for a lookalike fashion photo. Do not decide gender from hair length or clothing. JSON only:
{"gender":"male or female","facialHair":"none|stubble|moustache|beard","skinTone":"","hairDescription":"color length texture","faceDescription":"jaw brow eyes only, do not mention beard unless one is visible","ethnicAppearance":"South Asian/East Asian/Black/Hispanic/Middle Eastern/White/Mixed","appearanceDescription":"one sentence without the words man or woman","styleFeatures":""}`,
        },
      ],
      500,
    );
    return parsePhotoAnalysis(raw);
  } catch (err) {
    console.warn('Appearance analysis failed:', err?.message || err);
    return getFallbackPhotoAnalysis();
  }
}

async function validateImageWithGroq(groqClient, imageUrl, garmentList, person = {}) {
  const expectedGender = person.expectedGender || '';
  const expectedAge = person.expectedAgeLabel || '';
  const expectedBody = person.expectedBodyLabel || '';
  try {
    const raw = await groqVision(
      groqClient,
      [
        { type: 'image_url', image_url: { url: imageUrl } },
        {
          type: 'text',
          text: `Validate this fashion photo. JSON only:
{"nsfwProbability":number,"fullBody":boolean,"headVisible":boolean,"feetVisible":boolean,"genderMatch":boolean,"ageMatch":boolean,"bodyTypeMatch":boolean,"outfitMatch":boolean,"similarity":number,"explanation":string}

Required gender: ${expectedGender || 'any'}
Required age: ${expectedAge || 'any'}
Required body: ${expectedBody || 'any'}
Required clothes: ${garmentList}

Rules:
- headVisible: true ONLY if the face and top of the head are inside the frame. Cropped at neck/chest = false.
- feetVisible: true ONLY if both shoes/feet are inside the frame.
- fullBody: true ONLY if headVisible AND feetVisible. A headless or knee-up crop is false.
- genderMatch: the FACE must match ${expectedGender || 'required gender'}. If the head is cropped, genderMatch is false. A slim woman is FALSE if required is man. Long hair on a man is still a man.
- outfitMatch: visible clothes match: ${garmentList}
JSON only.`,
        },
      ],
      400,
    );
    const parsed = parseJsonObject(raw);
    if (!parsed) {
      return { nsfwProbability: 0, similarity: 1, fullBody: true, ageMatch: true, bodyTypeMatch: true, genderMatch: true, outfitMatch: true, explanation: 'Validation bypassed' };
    }
    const headVisible = parsed.headVisible === true;
    const feetVisible = parsed.feetVisible === true;
    const fullBody = parsed.fullBody === true && headVisible && feetVisible;
    return {
      nsfwProbability: Number(parsed.nsfwProbability) || 0,
      similarity: Number(parsed.similarity) || 0,
      fullBody,
      headVisible,
      feetVisible,
      ageMatch: expectedAge ? parsed.ageMatch === true : true,
      bodyTypeMatch: expectedBody ? parsed.bodyTypeMatch === true : true,
      genderMatch: expectedGender ? parsed.genderMatch === true : true,
      outfitMatch: parsed.outfitMatch === true,
      explanation: String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn('Image validation failed:', err?.message || err);
    return { nsfwProbability: 0, similarity: 1, fullBody: true, headVisible: true, feetVisible: true, ageMatch: true, bodyTypeMatch: true, genderMatch: true, outfitMatch: true, explanation: 'Validation service error bypassed' };
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
  const seedValue = seed || Math.floor(Math.random() * 999999);
  // `flux` now answers HTTP 402. `sana` is the Pollinations model that still
  // generates with no API key. One portrait URL: the free tier is about one
  // image a minute per IP, and this exact URL is cached after the first fetch.
  const width = 1024;
  const height = 1536;
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${POLLINATIONS_FREE_MODEL}&nologo=true&enhance=false&safe=false&seed=${seedValue}`;
  return { url, srcset: `${url} ${width}w` };
}

function scoreCandidate({ validation }, nsfwThreshold) {
  const safe = validation.nsfwProbability <= nsfwThreshold ? 1 : 0;
  return (
    safe * 100 +
    (validation.fullBody ? 50 : 0) +
    (validation.genderMatch ? 40 : 0) +
    (validation.outfitMatch ? 25 : 0) +
    (validation.bodyTypeMatch ? 15 : 0) +
    (validation.ageMatch ? 15 : 0) +
    validation.similarity
  );
}

async function generateAndValidateCandidate(groq, prompt, seed, garmentList, person, nsfwThreshold) {
  const imageResult = await generateImageWithPollinations(prompt, seed);
  let validationImage = imageResult.url;
  try {
    validationImage = await fetchImageAsDataUrl(imageResult.url, 30000);
  } catch (err) {
    console.warn('Image fetch/warm failed:', err?.message || err);
  }
  const validation = await validateImageWithGroq(groq, validationImage, garmentList, person);
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

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const photoData = fs.readFileSync(photoPath);
  const dataUrl = `data:${mimeType};base64,${photoData.toString('base64')}`;
  const uploadedUrl = `${hostInfo.protocol}://${hostInfo.host}/uploads/${filename}`;

  const [genderRead, appearance] = await Promise.all([
    detectGenderFromPhoto(groq, dataUrl),
    detectAppearance(groq, dataUrl),
  ]);

  let photoAnalysis = appearance || getFallbackPhotoAnalysis();
  const photoGender = genderRead?.gender || '';
  let gender = inputs.gender || photoGender;
  let genderSource = inputs.gender ? 'user' : photoGender ? 'photo' : '';

  if (!gender) {
    const fromAppearance = inferGenderFromCues(photoAnalysis);
    if (fromAppearance) {
      gender = fromAppearance;
      genderSource = 'photo';
    }
  }
  if (!gender) {
    console.warn('Gender still unresolved after face cues; not guessing a default.');
    genderSource = 'unresolved';
  } else if (genderSource === 'photo') {
    console.warn(
      `Photo gender=${gender} score=${genderRead?.score ?? 'n/a'} cues=${(genderRead?.reasons || []).join(',')}`,
    );
  }

  photoAnalysis.gender = gender;

  const personPrompt = buildPersonPrompt({ age, bodyType, height, photoAnalysis, gender });
  const bodyInfo = mapBodyType(bodyType, gender);

  const genderClothes =
    gender === 'man'
      ? 'This person is a MAN. Menswear only: shirt, t-shirt, kurta, trousers, jeans, chinos, jacket, sneakers or formal shoes. Never a dress, saree, lehenga, skirt, blouse, or heels.'
      : gender === 'woman'
        ? 'This person is a WOMAN. Womenswear for the occasion (western or ethnic). Never mens-only styling that ignores that this is a woman.'
        : 'Gender was not confirmed. Recommend one unisex outfit only: a shirt or plain kurta, trousers, and closed shoes. Do not guess a dress, saree, lehenga, skirt, blouse, or heels.';

  const textResponse = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a practical stylist. Recommend one COMMON real-world outfit.

${genderClothes}

The photo will be generated from outfitDescription + keyPieces. They must be the SAME outfit.

Rules:
- Occasion and budget are mandatory.
- Describe a complete real outfit: every visible layer, bottom, and shoes, each with a color.
- This applies to ANY clothing (shirt, jeans, dress, blazer, kurta, sneakers, heels, etc.). Do not drop layers.
- keyPieces: 4-6 items, each starting with a color, covering every garment in the description.
- outfitDescription: 5-7 sentences, head to toe, using ONLY those garments. Do not add or omit items.
- colorPalette: the same colors used on those garments.
- imagePrompt: one head-to-toe sentence listing every garment and color from the description.`,
      },
      {
        role: 'user',
        content: `Outfit for:
Gender: ${gender || 'unknown'}
Occasion: ${occasionGuidance.label} — ${occasionGuidance.specificity}
Budget: ${budgetInfo.label}. ${budgetInfo.guidance}
Height: ${heightInfo.label}
Age: ${ageInfo.label}
Body type: ${bodyInfo.label}
Skin: ${photoAnalysis.skinTone}
Ethnicity: ${photoAnalysis.ethnicAppearance}

JSON:
{
  "outfitName": "short name",
  "outfitDescription": "5-7 sentences using the same garments as keyPieces, head to toe",
  "colorPalette": ["3-5 colors"],
  "explanation": "why this common outfit fits gender, age, body, budget, occasion",
  "keyPieces": ["color + garment", "color + garment", "color + bottom", "color + shoes"],
  "occasions": ["2-3 events"],
  "stylingTips": ["3 tips"],
  "imagePrompt": "one sentence, every garment and color from the description, head to toe"
}`,
      },
    ],
    max_tokens: 1400,
  });

  let outfitRecommendation = parseJsonObject(messageText(textResponse.choices[0].message));
  if (!outfitRecommendation) {
    throw new Error('Failed to generate outfit recommendation');
  }

  const garmentItems = await extractGarmentsForImage(groq, outfitRecommendation);
  const spec = visualOutfitSpec(garmentItems);
  outfitRecommendation.imagePrompt = spec.pieceLine;
  if (!Array.isArray(outfitRecommendation.keyPieces) || outfitRecommendation.keyPieces.length < 3) {
    outfitRecommendation.keyPieces = spec.pieces;
  }
  const garmentList = spec.pieceLine;

  const nsfwThreshold = parseFloat(process.env.NSFW_THRESHOLD || '0.1');
  // Free Pollinations allows roughly one generation per minute per IP.
  // A second prompt returns HTTP 402, so only one image is requested.
  const promptA = buildFluxPrompt(personPrompt, spec);

  const tasks = [
    generateAndValidateCandidate(groq, promptA, Math.floor(Math.random() * 999999), garmentList, personPrompt, nsfwThreshold),
  ];

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
      `Picked image: fullBody=${imageValidation.fullBody} head=${imageValidation.headVisible} feet=${imageValidation.feetVisible} gender=${imageValidation.genderMatch} outfit=${imageValidation.outfitMatch}. ${imageValidation.explanation}`,
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
      genderSource,
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
