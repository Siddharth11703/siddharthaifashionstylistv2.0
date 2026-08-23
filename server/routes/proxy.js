import express from 'express';
import https from 'https';
import http from 'http';

const router = express.Router();

// Proxy endpoint to fetch images from Pollinations AI
// This solves CORS issues by routing through the backend
router.get('/proxy-image', async (req, res) => {
  try {
    let { prompt, width = 768, height = 1024, model = 'flux', nologo = 'true', enhance = 'true', seed } = req.query;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt parameter is required' });
    }

    // Normalize prompt so we don't double-encode:
    // If the incoming prompt is already percent-encoded, decode it first,
    // then re-encode exactly once to build the target URL.
    let rawPrompt = prompt;
    try {
      rawPrompt = decodeURIComponent(prompt);
    } catch {
      // ignore decode errors and fall back to the original prompt
      rawPrompt = prompt;
    }

    // Truncate and simplify the prompt
    if (rawPrompt.length > 1000) {
      rawPrompt = rawPrompt.substring(0, 1000);
      console.log('[proxy-image] truncated long prompt to 1000 chars');
    }

    rawPrompt = rawPrompt
      .replace(/[<>{}[\]]/g, '') // Remove brackets and braces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    const encodedPrompt = encodeURIComponent(rawPrompt);
    const seedParam = seed ? `&seed=${seed}` : '';
    const pollUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=${nologo}&enhance=${enhance}${seedParam}&cachebust=${Date.now()}`;

    console.log('[proxy-image] proxying to:', pollUrl);

    // Follow a small chain of redirects (Pollinations may redirect to a CDN)
    const maxRedirects = 5;

    function doRequest(url, redirectsLeft) {
      try {
        const client = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const options = {
          protocol: urlObj.protocol,
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          headers: {
            'User-Agent': 'SiddharthAI-Proxy/1.0',
            Accept: 'image/*, */*',
          },
          timeout: 15000, // 15s outgoing timeout
        };

        const req = client.get(options, (apiRes) => {
          // follow redirect
          if (apiRes.statusCode >= 300 && apiRes.statusCode < 400 && apiRes.headers.location && redirectsLeft > 0) {
            const location = apiRes.headers.location.startsWith('http')
              ? apiRes.headers.location
              : new URL(apiRes.headers.location, url).href;
            apiRes.resume(); // drain
            return doRequest(location, redirectsLeft - 1);
          }

          if (apiRes.statusCode !== 200) {
            const chunks = [];
            apiRes.on('data', (c) => chunks.push(c));
            apiRes.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              console.error(`[proxy-image] pollinations status ${apiRes.statusCode}`, body);
              if (!res.headersSent) {
                return res.status(502).json({
                  error: 'Pollinations API returned non-200 status',
                  status: apiRes.statusCode,
                  body,
                });
              }
            });
            return;
          }

          // Success: set headers and stream image to client
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', apiRes.headers['content-type'] || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');

          apiRes.pipe(res);
        });

        req.on('timeout', () => {
          console.error('[proxy-image] request timeout for', url);
          req.destroy();
          if (!res.headersSent) res.status(504).json({ error: 'Timeout fetching image from Pollinations' });
        });

        req.on('error', (error) => {
          console.error('[proxy-image] request error:', error);
          if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch image from Pollinations AI', details: error.message });
        });
      } catch (err) {
        console.error('[proxy-image] doRequest unexpected error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Proxy internal error', details: err.message });
      }
    }

    doRequest(pollUrl, maxRedirects);
  } catch (error) {
    console.error('[proxy-image] unexpected error:', error);
    res.status(500).json({ error: 'Proxy error: ' + (error.message || String(error)) });
  }
});

export default router;
