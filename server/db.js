import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  // In serverless hosts (like Vercel), the deployment filesystem is read-only.
  // Use /tmp so sign-in and saved outfits can write successfully.
  if (process.env.VERCEL === '1') {
    const dataDir = path.join(os.tmpdir(), 'styleai-data');
    fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, 'styleai.db');
  }

  return path.join(__dirname, '..', 'styleai.db');
}

const dbPath = resolveDbPath();
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS saved_outfits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    occasion TEXT,
    budget TEXT,
    height TEXT,
    age TEXT,
    body_type TEXT,
    skin_tone TEXT,
    outfit_description TEXT,
    outfit_explanation TEXT,
    outfit_image_url TEXT,
    user_photo_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

export default db;
