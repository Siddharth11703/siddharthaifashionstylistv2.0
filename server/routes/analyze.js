import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import express from 'express';
// Helper function to clean and parse the vision AI output
// Helper function to clean and parse the vision AI output
const parseVisionAnalysis = (rawText) => {
  // Safe defaults in case the AI fails to generate specific keys
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
    // Remove markdown code blocks and parse into a real JSON object
    const cleanedText = rawText.replace(/```[a-zA-Z]*\n/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanedText);
    
    // Merge the AI's data with our defaults to guarantee no 'undefined' values
    return { ...defaultFacts, ...parsedData };
  } catch (error) {
    console.error("Error parsing vision analysis:", error);
    return defaultFacts;
  }
};
const router = express.Router();
// Helper function to safely extract and parse JSON from the LLM output
const extractJson = (text) => {
  if (!text) return null;
  try {
    // Find the first '{' and the last '}' to strip out any conversational filler
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    
    const jsonString = text.substring(start, end + 1);
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Error extracting JSON:", error);
    return null;
  }
};

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
  const imageUrl = `/api/proxy-image?prompt=${encodeURIComponent(simplifiedPrompt)}&width=832&height=1216&model=flux&nologo=true&enhance=false${seedParam}`;
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
                  text: `Analyze this photo for fashion styling. Return ONLY valid JSON (no markdown fences, no commentary) with exactly these keys:
{
  "gender": "Male | Female | Other",
  "skinTone": "e.g. fair, medium, dark, olive",
  "hairType": "e.g. straight, wavy, curly, short, bald",
  "hairColor": "e.g. black, brown, blonde, gray",
  "bodyType": "from clothing fit, e.g. petite, average, athletic, plus-size",
  "faceShape": "e.g. round, oval, square, oblong",
  "styleFeatures": "notable visible details e.g. glasses, beard, tattoos, accessories, or empty string if none"
}
Be concise and factual. Estimate gender only from visual presentation for styling purposes.`,
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
    // Structured, trustworthy facts used internally for prompt-building —
    // keeps `photoAnalysis` itself unchanged (raw string) for API compatibility.
    const visionFacts = parseVisionAnalysis(photoAnalysis);
    console.log('✅ Photo analysis complete');

   // Step 2: Generate outfit recommendation based on analysis and preferences
const preferencesText = Object.entries(preferences)
  .map(([key, value]) => `${key}: ${value}`)
  .join(', ');

const outfitPrompt = `Person profile (for tailoring the outfit only — do NOT restate or re-describe the person in your output):
- Gender: ${visionFacts.gender}
- Skin tone: ${visionFacts.skinTone}
- Hair: ${visionFacts.hairColor} ${visionFacts.hairType}
- Body type: ${visionFacts.bodyType}
- Face shape: ${visionFacts.faceShape}
- Notable features: ${visionFacts.styleFeatures || 'none'}
 
Style preferences: ${preferencesText}
 
Create ONE modern, currently-trending, realistic outfit recommendation for this person's occasion and budget. Requirements:
1. TREND-DRIVEN: Reference real current fashion movements relevant to the occasion (e.g., quiet luxury, elevated streetwear, smart casual, old money aesthetic, minimalist tailoring) — not generic or dated combinations.
2. CLASSY, NEVER VULGAR: The outfit must be tasteful, well-covered, and appropriate for the stated occasion. No overly revealing, suggestive, or provocative pieces under any circumstances, regardless of body type or gender.
3. BUDGET-ACCURATE: Strictly match the stated budget level — no extravagant/luxury pieces for a tight budget, no cheap-looking pieces for a luxury budget.
4. FLATTERING: Choose silhouettes, fabrics, and colors that suit the stated body type, skin tone, and face shape.
5. Do NOT include any physical description of the person (no skin tone, hair, face, gender wording) anywhere in your output — only describe the clothing, fabrics, colors, fit, and accessories.
 
Return ONLY valid JSON, no markdown fences, no commentary, with exactly these keys:
{
  "outfitName": "catchy professional title",
  "outfitDescription": "2-3 concise sentences describing the complete outfit from top to shoes/accessories",
  "explanation": "2-3 concise sentences explaining why it fits the occasion, budget, height, age, and body type",
  "colorPalette": ["3-4 color names"],
  "keyPieces": ["5-7 specific garments/accessories"],
  "stylingTips": ["3-5 concise styling tips"],
  "occasions": ["2-4 suitable occasions"],
  "outfitVisualDescription": "one dense sentence describing ONLY the garments/fabrics/colors/fit/accessories in rich visual detail, suitable for an image generator — no mention of the person wearing them"
}`;

    let outfitResponse;
    try {
      outfitResponse = await createGroqChatCompletion({
        model: 'openai/gpt-oss-120b',
        max_completion_tokens: 2048,
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
    const parsedOutfit = extractJson(outfitText);
    if (parsedOutfit) {
      outfitRecommendation = parsedOutfit;
    } else {
      // Fallback still gets a usable, occasion-appropriate description
      // instead of a raw truncated dump — quality degrades gracefully.
      console.warn('⚠️ Could not parse outfit JSON, using fallback. Raw text:', outfitText.slice(0, 300));
      outfitRecommendation = {
        outfitName: 'Personalized Outfit',
        outfitDescription: outfitText,
        explanation: 'This recommendation is based on your uploaded photo and selected preferences.',
        colorPalette: ['Navy', 'White', 'Gold'],
        keyPieces: outfitText.split('\n').filter(Boolean).slice(0, 7),
        stylingTips: ['Keep the fit balanced and comfortable.', 'Match accessories to the main color palette.'],
        occasions: [preferences.occasion || 'Selected occasion', 'Smart casual settings'],
        outfitVisualDescription: outfitText.replace(/\{|\}/g, '').slice(0, 400),
      };
    }

    console.log('✅ Outfit recommendation generated');

   // Step 3: Generate image prompt for outfit visualization
    const outfitVisual = outfitRecommendation.outfitVisualDescription || outfitRecommendation.outfitDescription || outfitRecommendation.outfitName || 'a stylish outfit';

    const physicalDescription = `A ${preferences.height || 'average height'} ${preferences.age || 'adult'} with a ${preferences.bodyType || 'average'} build`;
    const basePrompt = `${physicalDescription}, wearing ${outfitVisual}`;

    // Pollinations AI (SDXL/Flux) responds best to comma-separated keywords, not sentences. 
    // Keywords for framing MUST be at the very front of the prompt.
    const imagePromptText = `Full body shot, extreme wide shot, standing at a distance, head to toe visible, shoes visible. ${basePrompt}, fashion editorial photography, Vogue magazine, 8k resolution, highly detailed, photorealistic, masterpiece.`;

    // Ensure the prompt is URL encoded
    const encodedPrompt = encodeURIComponent(imagePromptText);

    // Pollinations AI documentation recommends passing specific query parameters for portrait aspect ratio and quality.
    // &width=768&height=1024 forces a vertical portrait, &nologo=true removes the watermark, &enhance=false prevents Pollinations from overwriting our prompt.
    const generatedImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1024&nologo=true&enhance=false`;
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
