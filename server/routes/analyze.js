import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import express from 'express';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const parseVisionAnalysis = (rawText) => {
  const defaultFacts = {
    gender: 'person',
    skinTone: 'average',
    hairColor: '',
    hairType: '',
    faceShape: 'oval',
    bodyType: 'average',
    styleFeatures: ''
  };

  if (!rawText) return defaultFacts;

  try {
    const cleanedText = rawText
      .replace(/```[a-zA-Z]*\n/g, '')
      .replace(/```/g, '')
      .trim();

    const parsedData = JSON.parse(cleanedText);

    return {
      ...defaultFacts,
      ...parsedData
    };
  } catch (error) {
    console.error('Error parsing vision analysis:', error);
    return defaultFacts;
  }
};

const extractJson = (text) => {
  if (!text) return null;

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1) return null;

    const jsonString = text.substring(start, end + 1);

    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error extracting JSON:', error);
    return null;
  }
};

const stripAIThinking = (text = '') => {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
};

const upload = multer({
  storage: multer.memoryStorage()
});

/*
|--------------------------------------------------------------------------
| Groq
|--------------------------------------------------------------------------
*/

const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';

console.log(
  'GROQ_API_KEY present:',
  !!process.env.GROQ_API_KEY
);

async function createGroqChatCompletion(payload) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const response = await fetch(
    GROQ_CHAT_COMPLETIONS_URL,
    {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify(payload)
    }
  );

  const responseText = await response.text();

  let responseBody;

  try {
    responseBody = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    throw new Error(
      `Groq returned a non-JSON response (${response.status}): ${responseText}`
    );
  }

  if (!response.ok) {
    const message =
      responseBody.error?.message ||
      responseBody.message ||
      responseText ||
      'Unknown Groq API error';

    throw new Error(
      `Groq API ${response.status}: ${message}`
    );
  }

  return responseBody;
}

/*
|--------------------------------------------------------------------------
| Pollinations
|--------------------------------------------------------------------------
*/

const POLLINATIONS_IMAGE_EDIT_URL =
  'https://gen.pollinations.ai/v1/images/edits';

const POLLINATIONS_MEDIA_UPLOAD_URL =
  'https://media.pollinations.ai/upload';

async function createPollinationsImageEdit({
  imageBuffer,
  imageMimeType,
  prompt
}) {
  if (!process.env.POLLINATIONS_API_KEY) {
    throw new Error(
      'POLLINATIONS_API_KEY is not configured'
    );
  }

  /*
   * Native FormData / Blob are available in Node 18+.
   */
  const formData = new FormData();

  const imageBlob = new Blob(
    [imageBuffer],
    {
      type: imageMimeType || 'image/jpeg'
    }
  );

  formData.append(
    'image',
    imageBlob,
    `reference-image.${getFileExtension(imageMimeType)}`
  );

  formData.append(
    'prompt',
    prompt
  );

  formData.append(
    'model',
    'kontext'
  );

  formData.append(
    'size',
    '1024x1536'
  );

  const response = await fetch(
    POLLINATIONS_IMAGE_EDIT_URL,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${process.env.POLLINATIONS_API_KEY}`
      },

      body: formData
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Pollinations returned invalid JSON (${response.status}): ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Pollinations image edit failed (${response.status}): ${
        data.error?.message ||
        data.message ||
        text
      }`
    );
  }

  return data;
}

function getFileExtension(mimeType = '') {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };

  return map[mimeType] || 'jpg';
}

/*
 * If Pollinations returns a base64 image, upload it to
 * Pollinations Media Storage so the frontend gets a
 * normal https://media.pollinations.ai/... URL.
 */
async function uploadGeneratedImageToPollinations(
  imageBuffer,
  mimeType = 'image/png'
) {
  if (!process.env.POLLINATIONS_API_KEY) {
    throw new Error(
      'POLLINATIONS_API_KEY is not configured'
    );
  }

  const formData = new FormData();

  const imageBlob = new Blob(
    [imageBuffer],
    {
      type: mimeType
    }
  );

  formData.append(
    'file',
    imageBlob,
    `generated-outfit.${getFileExtension(mimeType)}`
  );

  const response = await fetch(
    POLLINATIONS_MEDIA_UPLOAD_URL,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${process.env.POLLINATIONS_API_KEY}`
      },

      body: formData
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Pollinations media upload returned invalid JSON (${response.status}): ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Pollinations media upload failed (${response.status}): ${
        data.error?.message ||
        data.message ||
        text
      }`
    );
  }

  return (
    data.url ||
    data.mediaUrl ||
    data.location ||
    data.id
  );
}

/*
 * Converts Pollinations' image response into a frontend-
 * usable URL.
 */
async function normalizePollinationsImageResponse(
  pollinationsResponse
) {
  const firstImage =
    pollinationsResponse?.data?.[0] ||
    pollinationsResponse?.images?.[0] ||
    {};

  /*
   * Case 1:
   * Pollinations directly returns a URL.
   */
  if (firstImage.url) {
    return firstImage.url;
  }

  /*
   * Case 2:
   * Pollinations returns base64.
   */
  if (firstImage.b64_json) {
    const mimeType =
      firstImage.mime_type ||
      'image/png';

    const imageBuffer =
      Buffer.from(
        firstImage.b64_json,
        'base64'
      );

    return await uploadGeneratedImageToPollinations(
      imageBuffer,
      mimeType
    );
  }

  /*
   * Case 3:
   * Some response formats may put the image
   * directly in an output field.
   */
  if (pollinationsResponse?.url) {
    return pollinationsResponse.url;
  }

  throw new Error(
    'Pollinations returned no usable generated image'
  );
}

/*
|--------------------------------------------------------------------------
| Main analysis endpoint
|--------------------------------------------------------------------------
*/

router.post(
  '/analyze',
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({
          error: 'GROQ_API_KEY is not configured'
        });
      }

      if (!process.env.POLLINATIONS_API_KEY) {
        return res.status(500).json({
          error:
            'POLLINATIONS_API_KEY is not configured'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No photo provided'
        });
      }

      const preferences = req.body.preferences
        ? JSON.parse(req.body.preferences)
        : {
            occasion: req.body.occasion,
            budget: req.body.budget,
            height: req.body.height,
            age: req.body.age,
            bodyType: req.body.bodyType
          };

      if (!Object.values(preferences).some(Boolean)) {
        return res.status(400).json({
          error: 'No preferences provided'
        });
      }

      /*
       * Convert uploaded image to base64 for Groq Vision.
       */
      const base64Image =
        req.file.buffer.toString('base64');

      const imageMediaType =
        req.file.mimetype;

      console.log(
        '🔍 Analyzing photo...'
      );

      console.log(
        '📋 Preferences:',
        preferences
      );

      /*
      |--------------------------------------------------------------------------
      | STEP 1 — Vision analysis
      |--------------------------------------------------------------------------
      */

      let analysisResponse;

      try {
        analysisResponse =
          await createGroqChatCompletion({
            model: 'qwen/qwen3.6-27b',

            max_completion_tokens: 1024,

            messages: [
              {
                role: 'user',

                content: [
                  {
                    type: 'image_url',

                    image_url: {
                      url:
                        `data:${imageMediaType};base64,${base64Image}`
                    }
                  },

                  {
                    type: 'text',

                    text: `
Analyze this person's photograph for fashion styling.

Return ONLY valid JSON.

Use exactly these keys:

{
  "gender": "Male | Female | Other",
  "skinTone": "fair | medium | dark | olive | other",
  "hairType": "straight | wavy | curly | short | long | bald | other",
  "hairColor": "black | brown | blonde | gray | other",
  "bodyType": "petite | slim | average | athletic | broad | plus-size | other",
  "faceShape": "round | oval | square | oblong | heart | diamond | other",
  "styleFeatures": "visible features such as glasses, beard, moustache, tattoos, etc."
}

Be factual.

Do NOT recommend clothing.

Do NOT describe the outfit.

Your job is only to identify visible characteristics that can help preserve the person's appearance.
`
                  }
                ]
              }
            ]
          });
      } catch (err) {
        console.error(
          'Groq vision API error:',
          err
        );

        return res.status(502).json({
          error: 'Vision provider error',
          details:
            err.message || String(err)
        });
      }

      const photoAnalysis =
        stripAIThinking(
          analysisResponse
            .choices?.[0]
            ?.message
            ?.content || ''
        );

      const visionFacts =
        parseVisionAnalysis(
          photoAnalysis
        );

      console.log(
        '✅ Photo analysis complete'
      );

      /*
      |--------------------------------------------------------------------------
      | STEP 2 — Generate structured outfit
      |--------------------------------------------------------------------------
      */

      const preferencesText =
        Object.entries(preferences)
          .filter(
            ([, value]) =>
              value !== undefined &&
              value !== null &&
              value !== ''
          )
          .map(
            ([key, value]) =>
              `${key}: ${value}`
          )
          .join(', ');

      const outfitPrompt = `
You are a professional personal stylist.

Create ONE exact outfit recommendation.

The image-generation model will use your JSON directly.

Therefore, EVERY garment must be explicit.

PERSON PROFILE:
- Gender: ${visionFacts.gender}
- Skin tone: ${visionFacts.skinTone}
- Hair: ${visionFacts.hairColor} ${visionFacts.hairType}
- Body type: ${
        preferences?.bodyType ||
        visionFacts.bodyType
      }
- Face shape: ${
        visionFacts.faceShape
      }
- Height: ${
        preferences?.height || 'not specified'
      }
- Age: ${
        preferences?.age || 'not specified'
      }
- Occasion: ${
        preferences?.occasion || 'not specified'
      }
- Budget: ${
        preferences?.budget || 'not specified'
      }
- Visible features: ${
        visionFacts.styleFeatures ||
        'none'
      }

USER PREFERENCES:
${preferencesText}

OUTFIT RULES:

1. Choose exactly ONE outfit.
2. Make it realistic and wearable.
3. Respect the stated budget.
4. Respect the occasion.
5. Respect the user's body type.
6. Do not give alternatives.
7. Do not say "for example".
8. Do not include multiple choices.
9. Specify the exact top.
10. Specify the exact bottom.
11. Specify the exact footwear.
12. Specify outerwear if required.
13. Specify accessories.
14. Specify colors.
15. Specify fabric.
16. Specify fit.
17. The final visual description must describe ONLY the exact outfit.

Return ONLY valid JSON.

Use exactly this schema:

{
  "outfitName": "professional outfit name",

  "top": "exact top including garment type, color, fabric, fit and details",

  "bottom": "exact bottom including garment type, color, fabric, fit and details",

  "outerwear": "exact outerwear or 'none'",

  "footwear": "exact shoes including type, color, material and style",

  "accessories": [
    "exact accessory 1",
    "exact accessory 2",
    "exact accessory 3"
  ],

  "colors": [
    "color 1",
    "color 2",
    "color 3"
  ],

  "fit": "overall silhouette and fit",

  "fabric": "main fabrics used",

  "fullVisualDescription": "ONE exact visual description containing ONLY the clothing, colors, fabrics, fit, footwear and accessories",

  "explanation": "why this exact outfit suits the user",

  "stylingTips": [
    "tip 1",
    "tip 2",
    "tip 3"
  ],

  "occasions": [
    "occasion 1",
    "occasion 2"
  ]
}
`;

      let outfitResponse;

      try {
        outfitResponse =
          await createGroqChatCompletion({
            model:
              'openai/gpt-oss-120b',

            max_completion_tokens:
              2048,

            messages: [
              {
                role: 'user',
                content: outfitPrompt
              }
            ]
          });
      } catch (err) {
        console.error(
          'Groq outfit API error:',
          err
        );

        return res.status(502).json({
          error:
            'Outfit provider error',
          details:
            err.message || String(err)
        });
      }

      const outfitText =
        stripAIThinking(
          outfitResponse
            .choices?.[0]
            ?.message
            ?.content || ''
        );

      let outfitRecommendation =
        extractJson(outfitText);

      if (!outfitRecommendation) {
        console.warn(
          '⚠️ Could not parse outfit JSON'
        );

        outfitRecommendation = {
          outfitName:
            'Personalized Outfit',

          top: outfitText,

          bottom:
            'Clean tailored trousers',

          outerwear:
            'none',

          footwear:
            'Clean minimal shoes',

          accessories: [],

          colors: [
            'Navy',
            'White',
            'Black'
          ],

          fit:
            'Balanced tailored fit',

          fabric:
            'High-quality wearable fabrics',

          fullVisualDescription:
            outfitText,

          explanation:
            'Personalized according to the supplied profile.',

          stylingTips: [],

          occasions: [
            preferences.occasion ||
              'Selected occasion'
          ]
        };
      }

      console.log(
        '✅ Structured outfit generated'
      );

      /*
      |--------------------------------------------------------------------------
      | STEP 3 — Build AUTHORITATIVE image prompt
      |--------------------------------------------------------------------------
      */

      const bodyTypeFinal =
        preferences?.bodyType ||
        visionFacts.bodyType ||
        'average';

      const heightFinal =
        preferences?.height ||
        'height according to reference photo';

      const ageFinal =
        preferences?.age ||
        'adult';

      const occasionFinal =
        preferences?.occasion ||
        'fashionable occasion';

      const imagePrompt = `
EDIT THE PROVIDED REFERENCE PHOTO.

The uploaded photo is the PRIMARY IDENTITY REFERENCE.

Preserve the person's recognizable identity.

IDENTITY PRESERVATION:
- Preserve the same person.
- Preserve facial identity.
- Preserve face structure.
- Preserve skin appearance.
- Preserve hairstyle and hair color.
- Preserve recognizable facial features.
- Preserve body proportions from the reference.
- Preserve natural body shape.
- Do not replace the person with a different person.
- Do not create a generic model.

PERSON:
- Age: ${ageFinal}
- Height: ${heightFinal}
- Body type: ${bodyTypeFinal}

OUTFIT — AUTHORITATIVE AND LOCKED:

TOP:
${outfitRecommendation.top}

BOTTOM:
${outfitRecommendation.bottom}

OUTERWEAR:
${outfitRecommendation.outerwear}

FOOTWEAR:
${outfitRecommendation.footwear}

ACCESSORIES:
${Array.isArray(outfitRecommendation.accessories)
  ? outfitRecommendation.accessories.join('; ')
  : outfitRecommendation.accessories}

COLORS:
${Array.isArray(outfitRecommendation.colors)
  ? outfitRecommendation.colors.join(', ')
  : outfitRecommendation.colors}

FIT:
${outfitRecommendation.fit}

FABRIC:
${outfitRecommendation.fabric}

AUTHORITATIVE OUTFIT DESCRIPTION:
${outfitRecommendation.fullVisualDescription}

STRICT OUTFIT RULES:

The clothing above is the ONLY clothing allowed.

Do not substitute garments.

Do not add garments.

Do not remove garments.

Do not change garment colors.

Do not change garment type.

Do not change the footwear.

Do not change accessories.

Do not add hats unless explicitly listed.

Do not add jackets unless explicitly listed.

Do not add shirts, pants, skirts, dresses or other pieces that are not explicitly listed above.

Do not invent additional fashion details.

The generated clothing must visually correspond to the exact outfit specification above.

COMPOSITION:

Create a realistic full-body fashion photograph.

The complete person must be visible from the top of the hair to the bottoms of both shoes.

The head must be completely visible.

The face must be completely visible.

Hair must be completely visible.

Both shoulders must be visible.

Both arms must be visible.

Both hands should be visible where naturally possible.

The entire torso must be visible.

The hips must be visible.

Both legs must be completely visible.

Both feet must be completely visible.

Both shoes must be completely visible.

Do not crop the head.

Do not crop the face.

Do not crop the legs.

Do not crop the feet.

Do not crop the shoes.

Keep the person centered.

Use a vertical portrait composition with enough empty space around the entire body to prevent cropping.

FULL-BODY FASHION PHOTOGRAPHY:

Standing naturally.

Camera positioned far enough away to capture the complete figure.

Straight-on camera angle.

Neutral confident posture.

Studio fashion photography.

Clean background.

Realistic anatomy.

Realistic hands.

Realistic feet.

Sharp clothing details.

Accurate garment proportions.

Photorealistic skin.

Photorealistic fabric.

Photorealistic footwear.

Do not use a close-up composition.

Do not use a waist-up composition.

Do not use a half-body composition.

Do not hide the face.

Do not hide the shoes.

Do not crop any part of the body.

OCCASION:
${occasionFinal}

The final image must look like the SAME PERSON from the uploaded photo wearing the EXACT outfit specified above.
`;

      console.log(
        '🎨 Sending original photo + locked outfit to Pollinations...'
      );

      /*
      |--------------------------------------------------------------------------
      | STEP 4 — Pollinations IMAGE EDIT
      |--------------------------------------------------------------------------
      */

      let pollinationsResponse;

      try {
        pollinationsResponse =
          await createPollinationsImageEdit({
            imageBuffer:
              req.file.buffer,

            imageMimeType:
              req.file.mimetype,

            prompt:
              imagePrompt
          });
      } catch (err) {
        console.error(
          'Pollinations image generation error:',
          err
        );

        return res.status(502).json({
          error:
            'Image generation provider error',

          details:
            err.message || String(err)
        });
      }

      /*
      |--------------------------------------------------------------------------
      | STEP 5 — Normalize Pollinations response
      |--------------------------------------------------------------------------
      */

      const generatedImageUrl =
        await normalizePollinationsImageResponse(
          pollinationsResponse
        );

      console.log(
        '✅ Image generated:',
        generatedImageUrl
      );

      /*
      |--------------------------------------------------------------------------
      | RESPONSE
      |--------------------------------------------------------------------------
      */

      return res.json({
        success: true,

        photoAnalysis,

        visionFacts,

        outfitRecommendation,

        imagePrompt,

        generatedImageUrl
      });

    } catch (error) {
      console.error(
        '❌ Error during analysis:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to analyze photo and generate recommendation',

        details:
          error.message
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Outfit history
|--------------------------------------------------------------------------
*/

router.get(
  '/outfits',
  async (req, res) => {
    try {
      const outfits = db
        .prepare(
          'SELECT * FROM saved_outfits ORDER BY created_at DESC'
        )
        .all();

      res.json(outfits);

    } catch (error) {
      console.error(
        'Error fetching outfits:',
        error
      );

      res.status(500).json({
        error:
          'Failed to fetch outfits'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Save outfit
|--------------------------------------------------------------------------
*/

router.post(
  '/save-outfit',
  async (req, res) => {
    try {
      const {
        userId,
        outfitName,
        recommendation,
        imageUrl
      } = req.body;

      if (
        !userId ||
        !outfitName ||
        !recommendation
      ) {
        return res.status(400).json({
          error:
            'Missing required fields'
        });
      }

      const outfitId =
        uuidv4();

      const createdAt =
        new Date().toISOString();

      db.prepare(
        `
        INSERT INTO saved_outfits
        (
          id,
          user_id,
          outfit_name,
          recommendation,
          image_url,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(
        outfitId,
        userId,
        outfitName,
        JSON.stringify(
          recommendation
        ),
        imageUrl,
        createdAt
      );

      res.json({
        success: true,

        outfitId,

        message:
          'Outfit saved successfully'
      });

    } catch (error) {
      console.error(
        'Error saving outfit:',
        error
      );

      res.status(500).json({
        error:
          'Failed to save outfit'
      });
    }
  }
);

export default router;
