# Siddharth AI Fashion Stylist

AI-powered outfit recommendations built with React, Vite, Express, Groq, Pollinations AI, and Supabase.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project and run `server/schema.sql` in the Supabase SQL editor.

3. Create a `.env` file with:

   ```bash
   GROQ_API_KEY=your-groq-api-key
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

   `SUPABASE_ANON_KEY` can be used as a fallback for local development if your Row Level Security policies allow the server operations.

4. Run the app and API server:

   ```bash
   npm run dev:all
   ```

## Build

```bash
npm run build
```

## Vercel custom domain (free)

See detailed setup: `DEPLOYMENT_VERCEL.md`.
