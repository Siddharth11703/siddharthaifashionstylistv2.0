// Generate image using Pollinations AI via backend proxy
async function generateImageWithPollinations(prompt, seed) {
  // The proxy will normalize encoding (it decodes any incoming prompt then re-encodes it exactly once),
  // so it's safe to include an encoded prompt here. We still use encodeURIComponent when building the URL
  // to ensure the query string is valid.
  const seedParam = seed ? `&seed=${seed}` : '';
  const imageUrl = `/api/proxy-image?prompt=${encodeURIComponent(prompt)}&width=768&height=1024&model=flux&nologo=true&enhance=true${seedParam}`;
  return imageUrl;
}
