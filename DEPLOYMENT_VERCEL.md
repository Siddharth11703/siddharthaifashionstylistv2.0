# Vercel Free Hosting + Custom Domain Setup

This project supports hosting on Vercel with API routes and frontend in the same deployment.

## 1) Deploy on Vercel (free plan)
1. Push this repository to GitHub.
2. In Vercel, click **Add New Project** and import this repo.
3. Framework preset: **Vite**.
4. Keep build command as `npm run build`.
5. Deploy.

## 2) Set required environment variables
In Vercel project settings, open **Environment Variables** and add:

- `GROQ_API_KEY` = your Groq API key
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key

Before redeploying, run `server/schema.sql` in your Supabase project's SQL editor. Then redeploy.

## 3) Add your custom domain
1. In Vercel project dashboard → **Settings** → **Domains**.
2. Add your domain, for example `style.yourdomain.com`.
3. In your DNS provider, create the record Vercel asks for:
   - Usually **CNAME** for subdomain (`style`) to `cname.vercel-dns.com`
   - Or **A record** for apex/root domain to Vercel IP if prompted
4. Wait for DNS verification (often 5–30 minutes, may take up to 24 hours).

## 4) SSL certificate
Vercel automatically issues free HTTPS certificates after DNS verification.

## 5) Common issue checks
If `/api/analyze` fails:
- Confirm `GROQ_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel and redeployed.
- Check Vercel Functions logs for runtime errors.
- Ensure uploaded images are under 10MB.

## Notes
- This repo already includes `vercel.json` routing `/api/*` to the serverless function.
- Outfit/user data is stored in Supabase.
- On Vercel, uploads are stored in `/tmp/uploads` during request execution.
