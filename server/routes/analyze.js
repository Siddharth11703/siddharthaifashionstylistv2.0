import https from 'https';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { Groq } from 'groq-sdk';
import { router as userRouter, db } from './users.js';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Generate image using Pollinations AI via backend proxy
async function generateImageWithPollinations(prompt, seed) {
  // ✅ CRITICAL FIX: Simplify and shorten the prompt
  // Keep prompts under 500 chars to avoid Pollinations AI errors
  let simplifiedPrompt = prompt;
  
  if (simplifiedPrompt.length > 500) {
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
    if (!req.file) {
      return res.status(400).json({ error: 'No photo provided' });
    }

    const { preferences } = req.body;

    if (!preferences) {
      return res.status(400).json({ error: 'No preferences provided' });
    }

    // Convert image to base64
    const base64Image = req.file.buffer.toString('base64');
    const imageMediaType = req.file.mimetype;

    console.log('🔍 Analyzing photo...');
    console.log('📋 Preferences:', preferences);

    // Step 1: Analyze photo using Groq with Vision
    const analysisResponse = await groq.messages.create({
      model: 'llama-3.2-90b-vision-preview',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Analyze this photo and provide:
1. Skin tone (e.g., fair, medium, dark, olive)
2. Hair type and color
3. Body type (e.g., petite, average, athletic, plus-size)
4. Face shape (e.g., round, oval, square, oblong)
5. Notable features (e.g., glasses, tattoos, scars - just mention if visible)

Keep it concise and factual.`,
            },
          ],
        },
      ],
    });

    const photoAnalysis = analysisResponse.content[0].type === 'text' ? analysisResponse.content[0].text : '';
    console.log('✅ Photo analysis complete');

    // Step 2: Generate outfit recommendation based on analysis and preferences
    const preferencesText = Object.entries(preferences)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const outfitPrompt = `Based on this person's appearance:\n${photoAnalysis}\n\nAnd their style preferences:\n${preferencesText}\n\nProvide a personalized outfit recommendation including:
1. Outfit name (catchy, professional title)
2. Color palette (3-4 colors)
3. Key pieces (5-7 items)
4. Styling tips
5. Occasions suitable for this outfit

Format as JSON with keys: outfitName, colorPalette, keyPieces, stylingTips, occasions`;

    const outfitResponse = await groq.messages.create({
      model: 'mixtral-8x7b-32768',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: outfitPrompt,
        },
      ],
    });

    const outfitText = outfitResponse.content[0].type === 'text' ? outfitResponse.content[0].text : '';

    // Parse outfit recommendation
    let outfitRecommendation = {};
    try {
      // Try to extract JSON from the response
      const jsonMatch = outfitText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        outfitRecommendation = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback if no JSON found
        outfitRecommendation = {
          outfitName: 'Personalized Outfit',
          colorPalette: ['Navy', 'White', 'Gold'],
          keyPieces: outfitText.split('\n').slice(0, 7),
          stylingTips: 'Style according to your preferences',
          occasions: 'Perfect for any occasion',
        };
      }
    } catch (e) {
      outfitRecommendation = {
        outfitName: 'Personalized Outfit',
        colorPalette: ['Navy', 'White', 'Gold'],
        keyPieces: outfitText.split('\n').slice(0, 7),
        stylingTips: 'Style according to your preferences',
        occasions: 'Perfect for any occasion',
      };
    }

    console.log('✅ Outfit recommendation generated');

    // Step 3: Generate image prompt for outfit visualization
    const imagePromptText = `Professional fashion model wearing ${outfitRecommendation.outfitName || 'a stylish outfit'} with ${(outfitRecommendation.colorPalette || []).join(' and ')} colors. Studio lighting, full body, elegant pose, high quality`;

    const generatedImageUrl = await generateImageWithPollinations(imagePromptText, Math.floor(Math.random() * 1000000));
    console.log('🎨 Image generation initiated');

    res.json({
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
