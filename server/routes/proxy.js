import express from 'express';
import https from 'https';
import http from 'http';

const router = express.Router();

// Proxy endpoint to fetch images from Pollinations AI
// This solves CORS issues by routing through the backend
router.get('/proxy-image', async (req, res) => {
  try {
    const { prompt, width, height, model, nologo, enhance, seed } = req.query;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt parameter is required' });
    }

    // Build the Pollinations API URL
    const encodedPrompt = encodeURIComponent(prompt);
    const seedParam = seed ? `&seed=${seed}` : '';
    const pollUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width || 768}&height=${height || 1024}&model=${model || 'flux'}&nologo=${nologo || 'true'}&enhance=${enhance || 'true'}${seedParam}&cachebust=${Date.now()}`;

    // Fetch from Pollinations API
    https.get(pollUrl, (apiRes) => {
      // Set appropriate CORS and content headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', apiRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      // Pipe the image response
      apiRes.pipe(res);
    }).on('error', (error) => {
      console.error('Pollinations API error:', error);
      res.status(502).json({ error: 'Failed to fetch image from Pollinations AI' });
    });
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy error: ' + error.message });
  }
});

export default router;
