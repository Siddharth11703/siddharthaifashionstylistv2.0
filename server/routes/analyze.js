import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';

const GROQ_TEXT_MODEL =
  process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';

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
  return String(rawText || '').replace(
    /<think>[\s\S]*?<\/think>/gi,
    ''
  );
}

function parsePhotoAnalysis(rawText) {
  const jsonMatch = stripReasoning(rawText).match(
    /\{[\s\S]*\}/
  );

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
  const normalizedOccasion =
    normalizePreference(occasion);

  const key =
    normalizedOccasion.toLowerCase();

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
        'formal wedding guest attire, festive ceremonial clothing, elegant premium fabrics, dressy silhouettes, refined jewellery/accessories, polished shoes; absolutely not casual, loungewear, or gymwear',
    },

    {
      matches: [
        'party',
        'club',
        'birthday',
        'celebration',
      ],

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
      matches: [
        'date',
        'dinner',
        'romantic',
      ],

      guidance:
        'smart romantic dinner/date attire, flattering elevated pieces, tasteful accessories, and polished footwear; avoid gymwear and basic everyday clothing',
    },

    {
      matches: [
        'gym',
        'workout',
        'fitness',
        'sport',
      ],

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
    rule.matches.some((term) =>
      key.includes(term)
    )
  );

  const specificity = matchedRule
    ? matchedRule.guidance
    : `clearly ${
        normalizedOccasion || 'the requested occasion'
      }-appropriate styling with no generic casual outfit unless the occasion itself requires it`;

  return {
    label:
      normalizedOccasion ||
      'the requested occasion',

    specificity,
  };
}

// Strong negative instructions inserted into prompts.
const NEGATIVE_INSTRUCTIONS =
  'fully clothed, uncropped';

// Full-body framing.
const FULL_BODY_FRAMING =
  'full body, head to toe, shoes visible';

/*
 * Validate generated image using Groq vision.
 *
 * This validator checks:
 * - NSFW
 * - outfit similarity
 * - full-body framing
 * - age/body-profile match
 */
async function validateImageWithGroq(
  groqClient,
  imageUrl,
  outfitText,
  ageRequirement,
  bodyTypeRequirement
) {
  try {
    const response =
      await groqClient.chat.completions.create({
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

                text: `Check this generated fashion image.

Required age: ${ageRequirement || 'not specified'}
Required body type: ${
                  bodyTypeRequirement ||
                  'not specified'
                }

Outfit:
${outfitText}

Return ONLY JSON:
{
  "nsfwProbability": 0,
  "similarity": 0,
  "fullBody": true,
  "profileMatch": 0,
  "explanation": ""
}

Rules:
- profileMatch checks visible age and actual body shape.
- A young person is wrong for a 60-year-old request.
- A slim body is wrong for plus-size.
- A large/full body is wrong for slim or petite.
- Athletic means visibly toned or muscular.
- Judge body type from the actual physique, not the clothing.
- fullBody is true only when the complete person from head to both shoes is visible.
- similarity measures outfit matching.
- nsfwProbability measures nudity/underwear/sexual content.

No markdown.
No explanation outside JSON.`,
              },
            ],
          },
        ],

        reasoning_effort: 'none',

        max_tokens: 500,

        response_format: {
          type: 'json_object',
        },
      });

    const raw =
      response.choices?.[0]?.message?.content ||
      '';

    const match =
      stripReasoning(raw).match(
        /\{[\s\S]*\}/
      );

    if (!match) {
      console.warn(
        'Validator failed to return JSON. Raw:',
        raw
      );

      /*
       * Do not treat validation failure as a perfect match.
       */
      return {
        nsfwProbability: 0,
        similarity: 0,
        fullBody: false,
        profileMatch: 0,
        explanation:
          'Validation returned invalid JSON',
      };
    }

    const parsed =
      JSON.parse(match[0]);

    return {
      nsfwProbability:
        Number(
          parsed.nsfwProbability
        ) || 0,

      similarity:
        Number(
          parsed.similarity
        ) || 0,

      fullBody:
        parsed.fullBody !== false,

      profileMatch:
        Number(
          parsed.profileMatch
        ) || 0,

      explanation:
        String(
          parsed.explanation || ''
        ),
    };
  } catch (err) {
    console.warn(
      'Image validation failed:',
      err?.message || err
    );

    /*
     * Important:
     * Validation failure should NOT delete an otherwise
     * generated image later. The returned values simply
     * indicate that validation could not confirm quality.
     */
    return {
      nsfwProbability: 0,
      similarity: 0,
      fullBody: false,
      profileMatch: 0,
      explanation:
        'Validation service error',
    };
  }
}

// Pollinations generates the image on the first GET.
async function warmImageUrl(
  url,
  timeoutMs = 45000
) {
  try {
    const response = await fetch(url, {
      signal:
        AbortSignal.timeout(
          timeoutMs
        ),
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
async function generateImageWithPollinations(
  prompt,
  seed
) {
  const encodedPrompt =
    encodeURIComponent(prompt);

  const seedParam = seed
    ? `&seed=${seed}`
    : '';

  // 2:3 ratio for reliable full-body framing.
  const widths = [
    576,
    768,
    1024,
  ];

  const srcParts =
    widths.map((w) => {
      const h =
        Math.round(
          (w * 3) / 2
        );

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
    srcset:
      srcParts.join(', '),
  };
}

/*
 * Rank generated candidates.
 *
 * Safety is the highest priority.
 * Full body is next.
 * Profile match is strongly weighted.
 * Outfit similarity is also considered.
 */
function scoreCandidate(
  { validation },
  nsfwThreshold
) {
  const safe =
    validation.nsfwProbability <=
    nsfwThreshold
      ? 1
      : 0;

  return (
    safe * 100 +
    (validation.fullBody
      ? 10
      : 0) +
    ((validation.profileMatch || 0) *
      25) +
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
    buildOccasionGuidance(
      occasion
    );

  const groq =
    new Groq({
      apiKey:
        process.env.GROQ_API_KEY,
    });

  const photoData =
    fs.readFileSync(
      photoPath
    );

  const base64Photo =
    photoData.toString(
      'base64'
    );

  // Build publicly accessible URL.
  const uploadedUrl =
    `${hostInfo.protocol}://${hostInfo.host}/uploads/${filename}`;

  /*
   * ==========================================================
   * STEP 1: PHOTO ANALYSIS
   * ==========================================================
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

                text: `Carefully analyze this person's photo and extract physical appearance information for a hyper-realistic AI fashion image.

Return ONLY valid JSON:

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
Do not include conversational text.`,
              },
            ],
          },
        ],

        reasoning_effort: 'none',

        max_tokens: 500,

        response_format: {
          type: 'json_object',
        },
      });

    photoAnalysis =
      parsePhotoAnalysis(
        visionResponse
          .choices[0]
          .message
          .content
      );
  } catch (visionError) {
    console.warn(
      `Vision analysis failed with model ${GROQ_VISION_MODEL}:`,
      visionError.message
    );
  }

  /*
   * ==========================================================
   * STEP 2: OUTFIT RECOMMENDATION
   * ==========================================================
   */
  const textResponse =
    await groq.chat.completions.create({
      model: GROQ_TEXT_MODEL,

      messages: [
        {
          role: 'system',

          content:
            'You are a top professional fashion stylist. Create a hyper-personalized outfit recommendation. The requested occasion is mandatory.',
        },

        {
          role: 'user',

          content: `Create a detailed outfit recommendation for this person.

Photo Analysis:
- Skin Tone: ${photoAnalysis.skinTone}
- Gender: ${photoAnalysis.gender}
- Ethnic Appearance: ${photoAnalysis.ethnicAppearance}
- Hair: ${photoAnalysis.hairDescription}
- Face: ${photoAnalysis.faceDescription}
- Appearance: ${photoAnalysis.appearanceDescription}

Preferences:
- Occasion: ${occasionGuidance.label}
- Dress Code: ${occasionGuidance.specificity}
- Budget: ${budget}
- Height: ${height}
- Age Group: ${age}
- Body Type: ${bodyType}

The selected age and body type are mandatory visual requirements.

Create:
1. Complete outfit.
2. Garments and accessories.
3. Colors.
4. Fabric/material.
5. Fit and silhouette.
6. Why the look suits the person's age, body type, height, skin tone and occasion.
7. Styling tips.

Respond ONLY in JSON:

{
  "outfitName": "",
  "outfitDescription": "",
  "colorPalette": [],
  "explanation": "",
  "keyPieces": [],
  "occasions": [],
  "stylingTips": [],
  "imagePrompt": ""
}

IMPORTANT imagePrompt rule:
imagePrompt must be MAXIMUM 20 WORDS and contain ONLY:
main upper garment,
lower garment,
footwear.

No accessories.
No camera instructions.
No framing instructions.
No age.
No body type.`,
        },
      ],

      max_tokens: 1800,
    });

  let outfitRecommendation =
    null;

  try {
    const rawText =
      textResponse
        .choices[0]
        .message
        .content;

    const jsonMatch =
      rawText.match(
        /\{[\s\S]*\}/
      );

    outfitRecommendation =
      jsonMatch
        ? JSON.parse(
            jsonMatch[0]
          )
        : null;
  } catch (err) {
    console.warn(
      'Failed to parse outfit recommendation:',
      err?.message || err
    );

    outfitRecommendation =
      null;
  }

  if (!outfitRecommendation) {
    throw new Error(
      'Failed to generate outfit recommendation'
    );
  }

  /*
   * ==========================================================
   * STEP 3: NORMALIZE AGE
   * ==========================================================
   */
  const rawAge =
    String(age || '').trim();

  const agePrompt =
    rawAge
      ? /year|years|old/i.test(
          rawAge
        )
        ? rawAge
        : `${rawAge}-year-old`
      : 'adult';

  /*
   * ==========================================================
   * STEP 4: NORMALIZE BODY TYPE
   * ==========================================================
   */
  const rawBodyType =
    String(bodyType || '')
      .trim()
      .toLowerCase();

  const bodyPromptMap = {
    petite:
      'petite',

    'plus size':
      'plus-size',

    'plus-size':
      'plus-size',

    slim:
      'slim',

    athletic:
      'athletic',
  };

  const bodyPrompt =
    bodyPromptMap[
      rawBodyType
    ] ||
    'natural';

  const genderPrompt =
    photoAnalysis.gender ||
    'person';

  /*
   * ==========================================================
   * STEP 5: SHORT POLLINATIONS PROMPT
   * ==========================================================
   *
   * KEEP THIS SHORT.
   *
   * Age and body type come first because they are the most
   * important generation requirements.
   */
  const shortProfile =
    `${agePrompt} ${genderPrompt}, ${bodyPrompt} body`;

  const outfitImagePrompt =
    String(
      outfitRecommendation.imagePrompt ||
        ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  const baseImagePromptParts = [
    shortProfile,
    `wearing ${outfitImagePrompt}`,
    FULL_BODY_FRAMING,
    'studio background',
    NEGATIVE_INSTRUCTIONS,
  ];

  /*
   * This produces a short prompt such as:
   *
   * 60-year-old male, plus-size body, wearing navy blazer,
   * white shirt, beige trousers, brown loafers, full body,
   * head to toe, studio background, fully clothed
   */

  console.log(
    'Final Pollinations profile:',
    shortProfile
  );

  const maxAttempts =
    parseInt(
      process.env.IMAGE_GEN_MAX_ATTEMPTS ||
        '3',
      10
    );

  const nsfwThreshold =
    parseFloat(
      process.env.NSFW_THRESHOLD ||
        '0.1'
    );

  const similarityThreshold =
    parseFloat(
      process.env.SIMILARITY_THRESHOLD ||
        '0.30'
    );

  const profileMatchThreshold =
    parseFloat(
      process.env.PROFILE_MATCH_THRESHOLD ||
        '0.50'
    );

  let generatedImageUrl =
    null;

  let generatedImageSrcSet =
    null;

  let imageValidation = {
    nsfwProbability: 1,
    similarity: 0,
    fullBody: false,
    profileMatch: 0,
    explanation:
      'not validated',
  };

  let bestCandidate =
    null;

  /*
   * ==========================================================
   * STEP 6: IMAGE GENERATION
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
          Math.random() *
            999999
        );

      let promptParts =
        [...baseImagePromptParts];

      /*
       * Retry:
       * only add a short framing instruction.
       *
       * Do NOT add long age/body instructions again.
       */
      if (attempt > 1) {
        promptParts.unshift(
          'wide full-body shot'
        );
      }

      const fullImagePrompt =
        promptParts.join(
          ', '
        );

      console.log(
        `Generating Pollinations image attempt ${attempt}/${maxAttempts}`
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

      await warmImageUrl(
        imageResult.url
      );

      /*
       * ======================================================
       * VALIDATION
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
        result:
          imageResult,

        validation,
      };

      const isSafe =
        validation.nsfwProbability <=
        nsfwThreshold;

      /*
       * ALWAYS keep the best generated candidate.
       *
       * Profile match affects ranking.
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
        bestCandidate =
          candidate;
      }

      /*
       * Successful image condition.
       *
       * Notice:
       *
       * profileMatch is NOT a hard blocker.
       *
       * This prevents the frontend from getting null just
       * because the AI validator gave a lower profile score.
       */
      if (
        isSafe &&
        validation.fullBody &&
        validation.similarity >=
          similarityThreshold
      ) {
        console.log(
          `Image accepted on attempt ${attempt}`
        );

        break;
      }

      console.warn(
        `Attempt ${attempt} did not meet all quality criteria:`,
        {
          nsfw:
            validation.nsfwProbability,

          similarity:
            validation.similarity,

          profileMatch:
            validation.profileMatch,

          fullBody:
            validation.fullBody,

          explanation:
            validation.explanation,
        }
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
   * STEP 7: USE BEST IMAGE
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
   * STEP 8: SAFETY CHECK
   * ==========================================================
   *
   * IMPORTANT:
   *
   * We ONLY remove the image for an actual safety failure.
   *
   * We do NOT remove it merely because:
   * - profileMatch is low
   * - fullBody is imperfect
   * - similarity is imperfect
   *
   * This prevents "No image available".
   */
  if (
    imageValidation.nsfwProbability >
    nsfwThreshold
  ) {
    console.warn(
      'Final generated image failed safety validation.'
    );

    generatedImageUrl =
      null;

    generatedImageSrcSet =
      null;
  }

  /*
   * Informational warnings only.
   */
  if (
    imageValidation.profileMatch <
    profileMatchThreshold
  ) {
    console.warn(
      `Profile match is below preferred threshold: ` +
        `age=${agePrompt}, ` +
        `body=${bodyPrompt}, ` +
        `profileMatch=${imageValidation.profileMatch}`
    );

    /*
     * IMPORTANT:
     * Keep generatedImageUrl.
     */
  }

  if (
    !imageValidation.fullBody
  ) {
    console.warn(
      'Best image may not be perfectly full body.'
    );
  }

  if (
    imageValidation.similarity <
    similarityThreshold
  ) {
    console.warn(
      'Best image may not perfectly match outfit.'
    );
  }

  /*
   * ==========================================================
   * STEP 9: RETURN RESPONSE
   * ==========================================================
   *
   * Multiple aliases are returned so the frontend can safely
   * use:
   *
   * response.generatedImageUrl
   * response.imageUrl
   * response.url
   */
  return {
    success: true,

    photoAnalysis,

    outfitRecommendation,

    generatedImageUrl,

    imageUrl:
      generatedImageUrl,

    url:
      generatedImageUrl,

    generatedImageSrcSet,

    photoPath:
      filename,

    referenceImageUrl:
      uploadedUrl,

    imageValidation,

    requestedProfile: {
      age:
        agePrompt,

      bodyType:
        bodyPrompt,

      gender:
        genderPrompt,
    },
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
    req.setTimeout(
      120000
    );

    res.setTimeout(
      120000
    );

    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            'No photo uploaded',
        });
      }

      /*
       * ======================================================
       * ASYNC MODE
       * ======================================================
       */
      if (
        process.env.ASYNC_ANALYZE ===
        'true'
      ) {
        const jobId =
          uuidv4();

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
          createdAt:
            Date.now(),
        });

        (async () => {
          try {
            const hostInfo = {
              protocol:
                req.protocol,

              host:
                req.get('host'),
            };

            const result =
              await processAnalysis({
                photoPath:
                  filePath,

                filename,

                mimeType,

                body,

                hostInfo,
              });

            jobs.set(jobId, {
              status:
                'completed',

              result,

              completedAt:
                Date.now(),
            });
          } catch (err) {
            console.error(
              'Async job failed:',
              err?.message ||
                err
            );

            jobs.set(jobId, {
              status:
                'failed',

              error:
                err?.message ||
                String(err),

              completedAt:
                Date.now(),
            });
          }

          /*
           * Cleanup job after 30 minutes.
           */
          setTimeout(
            () =>
              jobs.delete(
                jobId
              ),

            1000 *
              60 *
              30
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

        return res
          .status(202)
          .json({
            jobId,
          });
      }

      /*
       * ======================================================
       * SYNCHRONOUS MODE
       * ======================================================
       */
      const hostInfo = {
        protocol:
          req.protocol,

        host:
          req.get('host'),
      };

      const result =
        await processAnalysis({
          photoPath:
            req.file.path,

          filename:
            req.file.filename,

          mimeType:
            req.file.mimetype,

          body:
            req.body,

          hostInfo,
        });

      /*
       * Remove uploaded temporary file.
       */
      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {
        // Ignore cleanup errors.
      }

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        'Analysis error:',
        error
      );

      return res
        .status(500)
        .json({
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
        error:
          'Job not found',
      });
    }

    if (
      job.status ===
      'pending'
    ) {
      return res.json({
        status:
          'pending',
      });
    }

    if (
      job.status ===
      'failed'
    ) {
      return res.json({
        status:
          'failed',

        error:
          job.error,
      });
    }

    return res.json({
      status:
        'completed',

      result:
        job.result,
    });
  }
);

export default router;
