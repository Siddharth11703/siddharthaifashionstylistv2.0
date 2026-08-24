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

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `photo_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

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

  if (!jsonMatch) {
    return getFallbackPhotoAnalysis();
  }

  try {
    return {
      ...getFallbackPhotoAnalysis(),
      ...JSON.parse(jsonMatch[0]),
    };
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
      matches: [
        'wedding',
        'marriage',
        'bridal',
        'bride',
        'groom',
        'sangeet',
        'mehendi',
        'reception',
        'haldi',
      ],
      guidance:
        'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual',
    },

    {
      matches: ['party', 'club', 'birthday', 'celebration'],
      guidance:
        'party-ready statement outfit with elevated fabrics, stylish evening details, confident accessories, and event-appropriate shoes; avoid basic daytime casual wear',
    },

    {
      matches: [
        'interview',
        'office',
        'business',
        'corporate',
        'meeting',
        'work',
      ],
      guidance:
        'professional polished business attire with structured pieces, modest fit, refined shoes, and minimal accessories; avoid partywear, loungewear, and overly casual items',
    },

    {
      matches: ['date', 'dinner', 'romantic'],
      guidance:
        'smart romantic dinner/date attire, flattering elevated pieces, tasteful accessories, and polished footwear; avoid gymwear and basic everyday clothing',
    },

    {
      matches: ['gym', 'workout', 'fitness', 'sport'],
      guidance:
        'performance athletic outfit with breathable technical fabrics, supportive trainers, and sport-ready layering; avoid formalwear and delicate accessories',
    },

    {
      matches: [
        'festival',
        'festive',
        'diwali',
        'eid',
        'christmas',
        'puja',
      ],
      guidance:
        'festive celebratory attire with rich colors, dressy details, culturally appropriate elements, accessories, and polished footwear; avoid plain casual clothing',
    },
  ];

  const matchedRule = rules.find((rule) =>
    rule.matches.some((term) => key.includes(term))
  );

  const specificity = matchedRule
    ? matchedRule.guidance
    : `clearly ${
        normalizedOccasion || 'the requested occasion'
      }-appropriate styling with no generic casual outfit unless the occasion itself requires it`;

  return {
    label: normalizedOccasion || 'the requested occasion',
    specificity,
  };
}

// Strong negative instructions inserted into prompts to avoid underwear/nudity.
const NEGATIVE_INSTRUCTIONS = 'fully clothed, uncropped';

// Full-body framing.
const FULL_BODY_FRAMING =
  'full body photo, head to toe, shoes and floor visible';

/*
 * Validate the generated image using Groq vision.
 *
 * NEW:
 * - ageRequirement
 * - bodyTypeRequirement
 * - profileMatch
 *
 * The validator now checks whether the generated person actually
 * resembles the requested age and body type.
 */
async function validateImageWithGroq(
  groqClient,
  imageUrl,
  outfitText,
  ageRequirement,
  bodyTypeRequirement
) {
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_VISION_MODEL,

      messages: [
        {
          role: 'user',

          content: [
            {
              type: 'image_url',

              image_url: {
                url: imageUrl,
              },
            },

            {
              type: 'text',

              text: `You are an image validation assistant.

Analyze the generated image and compare it against the exact requested person profile and outfit.

Respond ONLY in strict JSON with these fields:

{
  "nsfwProbability": number between 0 and 1,
  "similarity": number between 0 and 1,
  "fullBody": boolean,
  "profileMatch": number between 0 and 1,
  "explanation": string
}

Required age:
${ageRequirement || 'not specified'}

Required body type:
${bodyTypeRequirement || 'not specified'}

Outfit description:
${outfitText}

Instructions:

1) Return nsfwProbability = probability the image contains nudity, underwear-only, or sexual content.

2) Return similarity = how well the image matches the outfit description.
0.0 = unrelated
1.0 = exact match

3) Return fullBody = true ONLY when the entire person is visible from the top of the head to the shoes, with both feet visible.

Return false for:
- headshots
- waist-up images
- knee-up images
- cropped heads
- cropped feet
- missing footwear

4) Return profileMatch = how closely the generated person's visible age and body shape match the requested profile.

0.0 = clear mismatch
1.0 = strong match

5) AGE CHECK:

A visibly young adult is a mismatch for an older requested age such as 60-year-old.

For example:
- requested 60-year-old → 20-30 year old person = mismatch
- requested 60-year-old → visibly mature older adult = match

Judge age from visible facial maturity, skin appearance, hair, facial structure, posture and overall physical appearance.

6) BODY TYPE CHECK:

Judge body type from the actual visible physique, NOT from clothing.

Examples:

- plus-size → visibly full, broad or large body frame
- slim → visibly lean and narrow frame
- petite → visibly small and compact frame
- athletic → visibly muscular, toned or physically fit frame

A slim or average body is a mismatch for plus-size.

A thin body is a mismatch for athletic.

A very large/full body is a mismatch for slim or petite.

7) The clothes must NOT influence the body-type decision.

For example, loose clothes on a slim person do NOT count as plus-size.

8) Provide a short explanation describing any important:
- age mismatch
- body-type mismatch
- outfit mismatch
- framing mismatch

Answer immediately with the JSON object only.
No reasoning.
No commentary.
No markdown fences.`,
            },
          ],
        },
      ],

      reasoning_effort: 'none',

      max_tokens: 800,

      response_format: {
        type: 'json_object',
      },
    });

    const raw = response.choices[0].message.content;

    const match = stripReasoning(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      console.warn(
        'Validator failed to return JSON. Raw response:',
        raw
      );

      /*
       * IMPORTANT:
       * Do NOT automatically accept an unvalidated image.
       */
      return {
        nsfwProbability: 0,
        similarity: 0,
        fullBody: false,
        profileMatch: 0,
        explanation: 'Validation bypassed',
      };
    }

    const parsed = JSON.parse(match[0]);

    return {
      nsfwProbability:
        Number(parsed.nsfwProbability) || 0,

      similarity:
        Number(parsed.similarity) || 0,

      fullBody:
        parsed.fullBody !== false,

      profileMatch:
        Number(parsed.profileMatch) || 0,

      explanation:
        String(parsed.explanation || ''),
    };
  } catch (err) {
    console.warn(
      'Image validation failed:',
      err?.message || err
    );

    /*
     * IMPORTANT:
     * If validation fails, do NOT treat the image as perfect.
     */
    return {
      nsfwProbability: 0,
      similarity: 0,
      fullBody: false,
      profileMatch: 0,
      explanation: 'Validation service error',
    };
  }
}

// Pollinations generates the image on the first GET.
// Pre-fetching the image makes the URL cheap to load later.
async function warmImageUrl(url, timeoutMs = 45000) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    await response.arrayBuffer();

    return response.ok;
  } catch (err) {
    console.warn(
      'Image warm-up failed:',
      err?.message || err
    );

    return false;
  }
}

// Generate image using Pollinations AI.
async function generateImageWithPollinations(prompt, seed) {
  const encodedPrompt = encodeURIComponent(prompt);

  const seedParam = seed
    ? `&seed=${seed}`
    : '';

  // 2:3 ratio for reliable full-body framing.
  const widths = [576, 768, 1024];

  const srcParts = widths.map((w) => {
    const h = Math.round((w * 3) / 2);

    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&model=flux&nologo=true&enhance=false&safe=false${seedParam} ${w}w`;
  });

  const defaultWidth = 1024;
  const defaultHeight = 1536;

  const defaultUrl =
    `https://image.pollinations.ai/prompt/${encodedPrompt}` +
    `?width=${defaultWidth}` +
    `&height=${defaultHeight}` +
    `&model=flux` +
    `&nologo=true` +
    `&enhance=false` +
    `&safe=false` +
    `${seedParam}`;

  return {
    url: defaultUrl,
    srcset: srcParts.join(', '),
  };
}

/*
 * Candidate ranking.
 *
 * NEW:
 * profileMatch gets a significant weight so that:
 *
 * 60-year-old + plus-size
 *
 * is preferred over:
 *
 * 20-year-old + slim
 */
function scoreCandidate(
  { validation },
  nsfwThreshold
) {
  const safe =
    validation.nsfwProbability <= nsfwThreshold
      ? 1
      : 0;

  return (
    safe * 100 +
    (validation.fullBody ? 10 : 0) +
    ((validation.profileMatch || 0) * 25) +
    validation.similarity
  );
}

// In-memory job store for async processing.
const jobs = new Map();

async function processAnalysis({
  photoPath,
  filename,
  mimeType,
  body,
  hostInfo,
}) {
  const {
    occasion,
    budget,
    height,
    age,
    bodyType,
  } = body || {};

  const occasionGuidance =
    buildOccasionGuidance(occasion);

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  const photoData =
    fs.readFileSync(photoPath);

  const base64Photo =
    photoData.toString('base64');

  // Public URL to uploaded photo.
  const uploadedUrl =
    `${hostInfo.protocol}://${hostInfo.host}/uploads/${filename}`;

  /*
   * STEP 1:
   * Analyze uploaded photo.
   */
  let photoAnalysis =
    getFallbackPhotoAnalysis();

  try {
    const visionResponse =
      await groq.chat.completions.create({
        model: GROQ_VISION_MODEL,

        messages: [
          {
            role: 'user',

            content: [
              {
                type: 'image_url',

                image_url: {
                  url:
                    `data:${mimeType};base64,${base64Photo}`,
                },
              },

              {
                type: 'text',

                text: `
Carefully analyze this person's photo and extract detailed physical appearance information to be used for generating a hyper-realistic AI fashion image that looks like THIS.

Return:

1. skinTone:
exact skin tone

2. gender:
male/female/neutral

3. hairDescription:
hair color, length, texture

4. faceDescription:
key facial features

5. ethnicAppearance:
apparent ethnic appearance

6. appearanceDescription:
one-sentence holistic description

7. styleFeatures:
current visible style elements

Respond ONLY in JSON:

{
  "skinTone": "",
  "gender": "",
  "hairDescription": "",
  "faceDescription": "",
  "ethnicAppearance": "",
  "appearanceDescription": "",
  "styleFeatures": ""
}

Do not include markdown.
Do not include conversational text.
`,
              },
            ],
          },
        ],

        reasoning_effort: 'none',

        max_tokens: 800,

        response_format: {
          type: 'json_object',
        },
      });

    photoAnalysis =
      parsePhotoAnalysis(
        visionResponse.choices[0].message.content
      );
  } catch (visionError) {
    console.warn(
      `Vision analysis failed with model ${GROQ_VISION_MODEL}:`,
      visionError.message
    );
  }

  /*
   * STEP 2:
   * Generate outfit recommendation.
   */
  const textResponse =
    await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,

      messages: [
        {
          role: 'system',

          content:
            'You are a top professional fashion stylist. You create hyper-personalized outfit recommendations. The requested occasion is mandatory: never return a generic outfit.',
        },

        {
          role: 'user',

          content: `
Create a detailed outfit recommendation for a person with the following profile:

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

IMPORTANT:

The selected AGE GROUP and BODY TYPE are mandatory requirements.

The final visual should represent the requested age and body type accurately.

For example:

If age is 60:
the person must visibly look like an older 60-year-old adult, NOT a young 20-30-year-old.

If body type is plus size:
the person must visibly have a fuller and broader plus-size physique.

If body type is slim:
the person must visibly have a lean/slim physique.

If body type is athletic:
the person must visibly have a muscular/toned athletic physique.

Provide:

1. Complete outfit breakdown.
2. All visible attire layers and accessories.
3. Colors.
4. Fabric/material.
5. Texture/finish.
6. Fit/silhouette.
7. Small design details.
8. Why this outfit suits the person's:
   - body type
   - height
   - age
   - skin tone
   - ethnic appearance
   - occasion
   - budget
9. Personalized styling tips.

Respond in JSON:

{
  "outfitName": "Short catchy name",
  "outfitDescription": "Detailed 6-10 sentence description.",
  "colorPalette": ["color1", "color2", "color3"],
  "explanation": "Why this outfit works for this exact person.",
  "keyPieces": [
    "piece 1",
    "piece 2",
    "piece 3"
  ],
  "occasions": [
    "occasion 1",
    "occasion 2"
  ],
  "stylingTips": [
    "tip 1",
    "tip 2",
    "tip 3"
  ],
  "imagePrompt": "Maximum 20 words: main upper garment, lower garment and footwear only."
}
`,
        },
      ],

      max_tokens: 2600,
    });

  let outfitRecommendation;

  try {
    const rawText =
      textResponse.choices[0].message.content;

    const jsonMatch =
      rawText.match(/\{[\s\S]*\}/);

    outfitRecommendation =
      jsonMatch
        ? JSON.parse(jsonMatch[0])
        : null;
  } catch {
    outfitRecommendation = null;
  }

  if (!outfitRecommendation) {
    throw new Error(
      'Failed to generate outfit recommendation'
    );
  }

  /*
   * ==========================================================
   * IMPORTANT AGE + BODY TYPE FIX
   * ==========================================================
   *
   * Normalize the age.
   *
   * This prevents:
   *
   * "60"            -> "60-year-old"
   * "60 year old"   -> "60 year old"
   * "60 years old"  -> "60 years old"
   *
   * from becoming:
   *
   * "60 year old-year-old"
   */
  const rawAge =
    String(age || '').trim();

  const agePrompt =
    rawAge
      ? (
          /year|years|old/i.test(rawAge)
            ? rawAge
            : `${rawAge}-year-old`
        )
      : 'adult';

  /*
   * Normalize body type.
   */
  const rawBodyType =
    String(bodyType || '')
      .trim()
      .toLowerCase();

  /*
   * Explicit body type descriptions.
   *
   * This is MUCH stronger than simply sending:
   *
   * "body type: plus size"
   *
   * because the generator gets a visual description.
   */
  const bodyPromptMap = {
    petite:
      'petite body type, visibly small and compact frame',

    'plus size':
      'plus-size body type, visibly full, broad and heavier body frame',

    'plus-size':
      'plus-size body type, visibly full, broad and heavier body frame',

    slim:
      'slim body type, visibly lean, narrow and slender frame',

    athletic:
      'athletic body type, visibly muscular, toned and fit frame',
  };

  const bodyPrompt =
    bodyPromptMap[rawBodyType] ||
    `${String(
      bodyType || 'natural'
    )} body type`;

  const genderPrompt =
    photoAnalysis.gender || 'person';

  const ethnicPrompt =
    photoAnalysis.ethnicAppearance || '';

  const skinPrompt =
    photoAnalysis.skinTone || 'medium';

  const simpleAppearance =
    `${agePrompt} ${genderPrompt}, ${bodyPrompt}, ${ethnicPrompt}, ${skinPrompt} skin`;

  /*
   * ==========================================================
   * MOST IMPORTANT PROMPT CHANGE
   * ==========================================================
   *
   * Age + body type are at the VERY BEGINNING.
   *
   * This means Pollinations/Flux sees:
   *
   * 60-year-old
   * plus-size
   *
   * BEFORE seeing:
   *
   * outfit
   * background
   * framing
   */
  const baseImagePromptParts = [
    `IMPORTANT PERSON PROFILE: ${agePrompt} ${genderPrompt}. ${bodyPrompt}. The person MUST visibly look approximately this age and MUST visibly have this body type. Do NOT make the person younger, slimmer, thinner, or a different body type.`,

    `AGE REQUIREMENT: ${agePrompt}. This is mandatory. The face and overall physical appearance must look consistent with this age.`,

    `BODY TYPE REQUIREMENT: ${bodyPrompt}. This is mandatory. The actual body proportions and physique must visibly match this body type.`,

    FULL_BODY_FRAMING,

    `wearing ${outfitRecommendation.imagePrompt}`,

    'plain studio backdrop',

    NEGATIVE_INSTRUCTIONS,
  ];

  const maxAttempts =
    parseInt(
      process.env.IMAGE_GEN_MAX_ATTEMPTS || '3',
      10
    );

  const nsfwThreshold =
    parseFloat(
      process.env.NSFW_THRESHOLD || '0.1'
    );

  const similarityThreshold =
    parseFloat(
      process.env.SIMILARITY_THRESHOLD || '0.30'
    );

  /*
   * NEW:
   * Minimum age/body profile match.
   */
  const profileMatchThreshold =
    parseFloat(
      process.env.PROFILE_MATCH_THRESHOLD || '0.65'
    );

  let generatedImageUrl = null;

  let generatedImageSrcSet = null;

  let imageValidation = {
    nsfwProbability: 1,
    similarity: 0,
    fullBody: false,
    profileMatch: 0,
    explanation: 'not validated',
  };

  /*
   * Keep the best candidate.
   */
  let bestCandidate = null;

  /*
   * ==========================================================
   * IMAGE GENERATION LOOP
   * ==========================================================
   */
  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      const seed =
        Math.floor(
          Math.random() * 999999
        );

      let promptParts =
        [...baseImagePromptParts];

      /*
       * Retry attempts get extra framing instructions.
       */
      if (attempt > 1) {
        promptParts.unshift(
          'zoomed out wide shot'
        );

        /*
         * Repeat the profile on retry so the image generator
         * does not drift toward a generic young/slim person.
         */
        promptParts.unshift(
          `STRICT PROFILE REPEAT: ${agePrompt}, ${bodyPrompt}`
        );
      }

      const fullImagePrompt =
        promptParts.join(', ');

      console.log(
        `Generating image attempt ${attempt}/${maxAttempts}`
      );

      console.log(
        'Pollinations prompt:',
        fullImagePrompt
      );

      const imageResult =
        await generateImageWithPollinations(
          fullImagePrompt,
          seed
        );

      /*
       * Warm image URL.
       */
      await warmImageUrl(
        imageResult.url
      );

      /*
       * ======================================================
       * VALIDATE IMAGE
       * ======================================================
       */
      const validation =
        await validateImageWithGroq(
          groq,
          imageResult.url,

          `${outfitRecommendation.outfitName}: ${outfitRecommendation.outfitDescription}`,

          agePrompt,

          bodyPrompt
        );

      console.log(
        'Image validation:',
        validation
      );

      const candidate = {
        result: imageResult,
        validation,
      };

      const isSafe =
        validation.nsfwProbability <=
        nsfwThreshold;

      /*
       * Keep the strongest candidate.
       */
      if (
        !bestCandidate ||
        scoreCandidate(
          candidate,
          nsfwThreshold
        ) >
          scoreCandidate(
            bestCandidate,
            nsfwThreshold
          )
      ) {
        bestCandidate = candidate;
      }

      /*
       * ======================================================
       * ACCEPT IMAGE ONLY IF:
       *
       * 1. Safe
       * 2. Full body
       * 3. Outfit matches
       * 4. Age/body profile matches
       * ======================================================
       */
      if (
        isSafe &&
        validation.fullBody &&
        validation.similarity >=
          similarityThreshold &&
        validation.profileMatch >=
          profileMatchThreshold
      ) {
        console.log(
          `Image accepted on attempt ${attempt}.`
        );

        break;
      }

      console.warn(
        `Image validation attempt ${attempt} failed: ` +
        `nsfw=${validation.nsfwProbability}, ` +
        `similarity=${validation.similarity}, ` +
        `profileMatch=${validation.profileMatch}, ` +
        `fullBody=${validation.fullBody}. ` +
        `Explanation=${validation.explanation}`
      );
    } catch (imageError) {
      console.error(
        'Image generation error on attempt',
        attempt,
        imageError?.message ||
          imageError
      );
    }
  }

  /*
   * ==========================================================
   * CHOOSE BEST CANDIDATE
   * ==========================================================
   */
  if (bestCandidate) {
    generatedImageUrl =
      bestCandidate.result.url;

    generatedImageSrcSet =
      bestCandidate.result.srcset;

    imageValidation =
      bestCandidate.validation;
  }

  /*
   * ==========================================================
   * FINAL SAFETY + PROFILE CHECK
   * ==========================================================
   *
   * IMPORTANT:
   *
   * Previously, your code could still show a safe but
   * incorrect image.
   *
   * For example:
   *
   * Requested:
   * 60-year-old + plus-size
   *
   * Generated:
   * 25-year-old + slim
   *
   * The image could still be returned.
   *
   * Now the image is removed if it fails age/body validation.
   */

  if (
    imageValidation.nsfwProbability >
    nsfwThreshold
  ) {
    console.warn(
      'Final generated image failed safety validation.'
    );

    generatedImageUrl = null;
    generatedImageSrcSet = null;
  }

  else if (
    !imageValidation.fullBody
  ) {
    console.warn(
      'Final generated image failed full-body validation.'
    );

    generatedImageUrl = null;
    generatedImageSrcSet = null;
  }

  else if (
    imageValidation.similarity <
    similarityThreshold
  ) {
    console.warn(
      'Final generated image failed outfit similarity validation.'
    );

    generatedImageUrl = null;
    generatedImageSrcSet = null;
  }

  else if (
    imageValidation.profileMatch <
    profileMatchThreshold
  ) {
    console.warn(
      `Final generated image failed age/body profile validation. ` +
      `Required age=${agePrompt}, ` +
      `required body=${bodyPrompt}, ` +
      `profileMatch=${imageValidation.profileMatch}`
    );

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

/*
 * ==========================================================
 * POST /analyze
 * ==========================================================
 */
router.post(
  '/analyze',
  upload.single('photo'),
  async (req, res) => {
    /*
     * Keep Express timeouts reasonable.
     * Vercel may enforce its own timeout.
     */
    req.setTimeout(120000);
    res.setTimeout(120000);

    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No photo uploaded',
        });
      }

      /*
       * ======================================================
       * ASYNC PROCESSING
       * ======================================================
       */
      if (
        process.env.ASYNC_ANALYZE ===
        'true'
      ) {
        const jobId = uuidv4();

        const filePath =
          req.file.path;

        const filename =
          req.file.filename;

        const mimeType =
          req.file.mimetype;

        const body =
          req.body;

        jobs.set(jobId, {
          status: 'pending',
          createdAt: Date.now(),
        });

        /*
         * Background processing.
         */
        (async () => {
          try {
            const hostInfo = {
              protocol: req.protocol,
              host: req.get('host'),
            };

            const result =
              await processAnalysis({
                photoPath: filePath,
                filename,
                mimeType,
                body,
                hostInfo,
              });

            jobs.set(jobId, {
              status: 'completed',
              result,
              completedAt: Date.now(),
            });
          } catch (err) {
            console.error(
              'Async job failed:',
              err?.message || err
            );

            jobs.set(jobId, {
              status: 'failed',
              error:
                err?.message ||
                String(err),

              completedAt: Date.now(),
            });
          }

          /*
           * Delete job after 30 minutes.
           */
          setTimeout(
            () =>
              jobs.delete(jobId),
            1000 * 60 * 30
          );

          /*
           * Remove temporary file.
           */
          try {
            fs.unlinkSync(
              filePath
            );
          } catch {
            // Ignore cleanup errors.
          }
        })();

        return res.status(202).json({
          jobId,
        });
      }

      /*
       * ======================================================
       * SYNCHRONOUS PROCESSING
       * ======================================================
       */
      const hostInfo = {
        protocol: req.protocol,
        host: req.get('host'),
      };

      const result =
        await processAnalysis({
          photoPath: req.file.path,
          filename: req.file.filename,
          mimeType: req.file.mimetype,
          body: req.body,
          hostInfo,
        });

      /*
       * Remove temporary upload.
       */
      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {
        // Ignore cleanup errors.
      }

      res.json(result);
    } catch (error) {
      console.error(
        'Analysis error:',
        error
      );

      res.status(500).json({
        error:
          error.message ||
          'Analysis failed',
      });
    }
  }
);

/*
 * ==========================================================
 * GET /analyze/status/:jobId
 * ==========================================================
 */
router.get(
  '/analyze/status/:jobId',
  (req, res) => {
    const job =
      jobs.get(
        req.params.jobId
      );

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    if (
      job.status ===
      'pending'
    ) {
      return res.json({
        status: 'pending',
      });
    }

    if (
      job.status ===
      'failed'
    ) {
      return res.json({
        status: 'failed',
        error: job.error,
      });
    }

    return res.json({
      status: 'completed',
      result: job.result,
    });
  }
);

export default router;
