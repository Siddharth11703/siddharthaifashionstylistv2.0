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
  
  // REMOVED the 500 character truncation block here so the full outfit details reach the AI
  
  const seedParam = seed ? `&seed=${seed}` : '';
  
  // CHANGED enhance=true to enhance=false so Pollinations doesn't override our strict framing
  const imageUrl = `/api/proxy-image?prompt=${encodeURIComponent(simplifiedPrompt)}&width=768&height=1024&model=flux&nologo=true&enhance=false${seedParam}`;
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
Create a modern, trending, realistic outfit recommendation that strictly adheres to their specified budget level. Do not suggest overly extravagant luxury pieces if they asked for a tight budget. Focus on current fashion trends (e.g., streetwear, smart casual, quiet luxury) suitable for their occasion.

Important constraints for the "imagePrompt":
1. FACE MATCHING: You MUST start the imagePrompt with a highly detailed physical description of the person using EXACT details from the appearance analysis (skin tone, exact hair color and style, face shape, facial hair, glasses, etc.).
2. BODY: Explicitly include the user's Body Type and Age.
3. TREND & BUDGET: Describe the outfit in rich detail, specifying modern, realistic fabrics, tailoring, and colors that fit the budget.
4. Do not use generic terms like "model" or "person." Use specific terms like "a 25-year-old fair-skinned man with short curly black hair and a styled beard..."

Return ONLY valid JSON with these keys:
{
  "outfitName": "catchy professional title",
  "outfitDescription": "2-3 concise sentences describing the complete outfit from top to shoes/accessories",
  "explanation": "2-3 concise sentences explaining why it fits the user's appearance, occasion, budget, height, age, and body type",
  "colorPalette": ["3-4 color names"],
  "keyPieces": ["5-7 specific garments/accessories"],
  "stylingTips": ["3-5 concise styling tips"],
  "occasions": ["2-4 suitable occasions"],
  "imagePrompt": "[Insert exact facial/physical description from analysis], wearing [Insert highly detailed trending outfit with realistic fabrics]. Full-length shot, head to shoes fully visible."
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
const basePrompt = outfitRecommendation.imagePrompt || `A person wearing ${outfitRecommendation.outfitDescription || outfitRecommendation.outfitName || 'a stylish outfit'}.`;

// Restructured to use specific photography lenses and framing keywords that Flux respects for full-body shots
const imagePromptText = `Full-length portrait from head to feet, wide shot, subject standing in center frame with clear space above head and below shoes, shot with 35mm lens. ${basePrompt}, fashion editorial photography, natural lighting, sharp focus, 8k resolution, photorealistic.`;

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
