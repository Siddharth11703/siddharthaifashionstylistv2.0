import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import analyzeRoutes from './routes/analyze.js';
import userRoutes from './routes/users.js';
import proxyRoutes from './routes/proxy.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.use('/api', analyzeRoutes);
app.use('/api/users', userRoutes);
app.use('/api', proxyRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 Siddharth AI Fashion Stylist Server running on http://localhost:${PORT}`);
    console.log('📦 Database initialized');
    console.log(`🔑 Groq API: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log('🎨 Pollinations AI: ✅ Ready (no key needed)\n');
  });
  server.timeout = 60000;
}

export default app;
