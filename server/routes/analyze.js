import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import express from 'express';
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Log whether key present (temporary debug)
console.log('GROQ_API_KEY present:', !!process.env.GROQ_API_KEY);

async function createGroqChatCompletion(payload) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let responseBody;

  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`Groq returned a non-JSON response (${response.status}): ${responseText}`);
  }

  if (!response.ok) {
    const message = responseBody.error?.message || responseBody.message || responseText || 'Unknown Groq API error';
    throw new Error(`Groq API ${response.status}: ${message}`);
  }

  return responseBody;
}

function stripAIThinking(text = '') {
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Generate image using Pollinations AI via backend proxy
async function generateImageWithPollinations(prompt, seed) {
  let simplifiedPrompt = prompt;

  if (simplifiedPrompt && simplifiedPrompt.length > 500) {
    simplifiedPrompt = simplifiedPrompt.substring(0, 500);
    console.log('[generateImageWithPollinations] truncated prompt to 500 chars');
  }

  const seedParam = seed ? `&seed=${seed}` : '';
  const imageUrl = `/api/proxy-image?prompt=${encodeURIComponent(simplifiedPrompt)}&width=768&height=1024&model=flux&nologo=true&enhance=true${seedParam}`;
  return imageUrl;
}

// Main analysis endpoint
router.post('/analyze', upload.single('photo'), async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo provided' });
    }

    const preferences = req.body.preferences
      ? JSON.parse(req.body.preferences)
      : {
          occasion: req.body.occasion,
          budget: req.body.budget,
          height: req.body.height,
          age: req.body.age,
          bodyType: req.body.bodyType,
        };

    if (!Object.values(preferences).some(Boolean)) {
      return res.status(400).json({ error: 'No preferences provided' });
    }

    // Convert image to base64
    const base64Image = req.file.buffer.toString('base64');
    const imageMediaType = req.file.mimetype;

    console.log('🔍 Analyzing photo...');
    console.log('📋 Preferences:', preferences);

    // Step 1: Analyze photo using Groq with Vision
    let analysisResponse;
    try {
      analysisResponse = await createGroqChatCompletion({
        model: 'qwen/qwen3.6-27b',
        max_completion_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMediaType};base64,${base64Image}`,
                },
              },
              {
                  type: 'text',
                  text: `Analyze this photo for fashion styling. Provide concise factual details:
                  1. Estimated Gender (Male / Female / Other)
                  2. Skin tone (e.g., fair, medium, dark, olive)
                  3. Hair type and color
                  4. Body/build from clothing fit (e.g., petite, average, athletic, plus-size)
                  5. Face shape (e.g., round, oval, square, oblong)
                  6. Notable visible style features (e.g., glasses, beard, long hair, accessories)
                  Keep it concise and factual.`,
                },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('Groq vision API error:', err);
      return res.status(502).json({ error: 'Vision provider error', details: err.message || String(err) });
    }

    const photoAnalysis = stripAIThinking(analysisResponse.choices?.[0]?.message?.content || '');
    console.log('✅ Photo analysis complete');

   // Step 2: Generate outfit recommendation based on analysis and preferences
const preferencesText = Object.entries(preferences)
  .map(([key, value]) => `${key}: ${value}`)
  .join(', ');

const outfitPrompt = `Based on this person's appearance: ${photoAnalysis}
And their style preferences: ${preferencesText}
Create one highly creative, stylish, and fashion-forward outfit recommendation.

Important:
- You MUST explicitly include the user's Body Type (e.g., plus-size, curvy, athletic) and Age from the preferences/analysis in the imagePrompt so the image generator accurately reflects their body weight.
- Use the Estimated Gender from the photo analysis (e.g., man, woman) in the imagePrompt instead of neutral terms like "person" or "model".
- The written outfit and image prompt must describe the exact same highly creative clothes, colors, shoes, and accessories.
- Keep explanations practical and concise.

Return ONLY valid JSON with these keys:
{
  "outfitName": "catchy professional title",
  "outfitDescription": "2-3 concise sentences describing the complete outfit from top to shoes/accessories",
  "explanation": "2-3 concise sentences explaining why it fits the user's appearance, occasion, budget, height, age, and body type",
  "colorPalette": ["3-4 color names"],
  "keyPieces": ["5-7 specific garments/accessories that match the image prompt"],
  "stylingTips": ["3-5 concise styling tips"],
  "occasions": ["2-4 suitable occasions"],
  "imagePrompt": "photorealistic full-body head-to-toe shot, wide angle lens, standing far away from camera, feet and shoes visible in frame, matching outfitDescription, colorPalette, keyPieces, shoes, and accessories. Specify the gender, age, and body type explicitly (e.g. 'a 25-year-old plus-size handsome man wearing...')."
}`; 

    let outfitResponse;
    try {
      outfitResponse = await createGroqChatCompletion({
        model: 'openai/gpt-oss-120b',
        max_completion_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: outfitPrompt,
          },
        ],
      });
    } catch (err) {
      console.error('Groq outfit API error:', err);
      return res.status(502).json({ error: 'Outfit provider error', details: err.message || String(err) });
    }

    const outfitText = stripAIThinking(outfitResponse.choices?.[0]?.message?.content || '');

    // Parse outfit recommendation
    let outfitRecommendation = {};
    try {
      const jsonMatch = outfitText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        outfitRecommendation = JSON.parse(jsonMatch[0]);
      } else {
        outfitRecommendation = {
          outfitName: 'Personalized Outfit',
          outfitDescription: outfitText,
          explanation: 'This recommendation is based on your uploaded photo and selected preferences.',
          colorPalette: ['Navy', 'White', 'Gold'],
          keyPieces: outfitText.split('\n').slice(0, 7),
          stylingTips: ['Keep the fit balanced and comfortable.', 'Match accessories to the main color palette.'],
          occasions: ['Selected occasion', 'Smart casual settings'],
          imagePrompt: outfitText,
        };
      }
    } catch {
      outfitRecommendation = {
        outfitName: 'Personalized Outfit',
        outfitDescription: outfitText,
        explanation: 'This recommendation is based on your uploaded photo and selected preferences.',
        colorPalette: ['Navy', 'White', 'Gold'],
        keyPieces: outfitText.split('\n').slice(0, 7),
        stylingTips: ['Keep the fit balanced and comfortable.', 'Match accessories to the main color palette.'],
        occasions: ['Selected occasion', 'Smart casual settings'],
        imagePrompt: outfitText,
      };
    }

    console.log('✅ Outfit recommendation generated');

   // Step 3: Generate image prompt for outfit visualization
const basePrompt = outfitRecommendation.imagePrompt || `Photorealistic fashion image wearing ${outfitRecommendation.outfitDescription || outfitRecommendation.outfitName || 'a stylish outfit'}.`;

// Added aggressive keywords to force the AI to zoom out and include both head and feet
const imagePromptText = `Wide-angle environmental portrait, ultra-wide shot, full-length body. The entire person MUST be in frame from the top of the head and face to the bottom of the feet and shoes. Zoomed out, standing far back, full head-to-toe visibility, ${basePrompt}`;

const generatedImageUrl = await generateImageWithPollinations(imagePromptText, Math.floor(Math.random() * 1000000));
console.log('🎨 Image generation initiated'); 

    res.json({
      success: true,
      photoAnalysis,
      outfitRecommendation,
      generatedImageUrl,
    });
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    res.status(500).json({
      error: 'Failed to analyze photo and generate recommendation',
      details: error.message,
    });
  }
});

// Outfit history endpoint
router.get('/outfits', async (req, res) => {
  try {
    const outfits = db
      .prepare('SELECT * FROM saved_outfits ORDER BY created_at DESC')
      .all();
    res.json(outfits);
  } catch (error) {
    console.error('Error fetching outfits:', error);
    res.status(500).json({ error: 'Failed to fetch outfits' });
  }
});

// Save outfit endpoint
router.post('/save-outfit', async (req, res) => {
  try {
    const { userId, outfitName, recommendation, imageUrl } = req.body;

    if (!userId || !outfitName || !recommendation) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const outfitId = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare(
      'INSERT INTO saved_outfits (id, user_id, outfit_name, recommendation, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(outfitId, userId, outfitName, JSON.stringify(recommendation), imageUrl, createdAt);

    res.json({
      success: true,
      outfitId,
      message: 'Outfit saved successfully',
    });
  } catch (error) {
    console.error('Error saving outfit:', error);
    res.status(500).json({ error: 'Failed to save outfit' });
  }
});

export default router;
