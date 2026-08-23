import express from 'express';
import db from '../db.js';

const router = express.Router();

// Register or login user (upsert by email)
router.post('/register', (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (existing) {
      // Update name/phone if they changed
      db.prepare('UPDATE users SET name = ?, phone = ? WHERE email = ?').run(name, phone, email);
      const updated = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      return res.json({ success: true, user: updated, isNew: false });
    }

    const result = db.prepare('INSERT INTO users (name, email, phone) VALUES (?, ?, ?)').run(name, email, phone);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, user, isNew: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save outfit
router.post('/save-outfit', (req, res) => {
  try {
    const {
      userId, occasion, budget, height, age, bodyType,
      skinTone, outfitDescription, outfitExplanation, outfitImageUrl, userPhotoPath
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = db.prepare(`
      INSERT INTO saved_outfits (
        user_id, occasion, budget, height, age, body_type,
        skin_tone, outfit_description, outfit_explanation,
        outfit_image_url, user_photo_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, occasion, budget, height, age, bodyType,
      skinTone, outfitDescription, outfitExplanation, outfitImageUrl, userPhotoPath
    );

    res.json({ success: true, outfitId: result.lastInsertRowid });
  } catch (error) {
    console.error('Save outfit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's saved outfits
router.get('/outfits/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const outfits = db.prepare(`
      SELECT * FROM saved_outfits WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId);

    res.json({ success: true, outfits });
  } catch (error) {
    console.error('Get outfits error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete saved outfit
router.delete('/outfits/:outfitId', (req, res) => {
  try {
    const { outfitId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const result = db.prepare('DELETE FROM saved_outfits WHERE id = ? AND user_id = ?').run(outfitId, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Saved outfit not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Delete outfit endpoint
router.delete('/delete-outfit/:outfitId', async (req, res) => {
  try {
    const { outfitId } = req.params;
    const { userId } = req.body;

    if (!outfitId || !userId) {
      return res.status(400).json({ error: 'Missing outfitId or userId' });
    }

    // Optional: Check if the outfit belongs to the user before deleting
    const outfit = db.prepare('SELECT * FROM saved_outfits WHERE id = ? AND user_id = ?').get(outfitId, userId);
    
    if (!outfit) {
        return res.status(404).json({ error: 'Outfit not found or unauthorized' });
    }

    db.prepare('DELETE FROM saved_outfits WHERE id = ? AND user_id = ?').run(outfitId, userId);

    res.json({
      success: true,
      message: 'Outfit deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting outfit:', error);
    res.status(500).json({ error: 'Failed to delete outfit' });
  }
});

export default router;
