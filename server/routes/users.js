import express from 'express';
import db from '../db.js';

const router = express.Router();

// Register or login user (upsert by email)
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existing = await db.findUserByEmail(email);

    if (existing) {
      // Update name/phone if they changed
      const updated = await db.updateUserByEmail(email, { name, phone });
      return res.json({ success: true, user: updated, isNew: false });
    }

    const user = await db.createUser({ name, email, phone });

    res.json({ success: true, user, isNew: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save outfit
router.post('/save-outfit', async (req, res) => {
  try {
    const {
      userId, occasion, budget, height, age, bodyType,
      skinTone, outfitDescription, outfitExplanation, outfitImageUrl, userPhotoPath
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const user = await db.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const outfit = await db.createSavedOutfit({
      user_id: userId,
      occasion,
      budget,
      height,
      age,
      body_type: bodyType,
      skin_tone: skinTone,
      outfit_description: outfitDescription,
      outfit_explanation: outfitExplanation,
      outfit_image_url: outfitImageUrl,
      user_photo_path: userPhotoPath,
    });

    res.json({ success: true, outfitId: outfit.id });
  } catch (error) {
    console.error('Save outfit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's saved outfits
router.get('/outfits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const outfits = await db.getSavedOutfitsByUser(userId);

    res.json({ success: true, outfits });
  } catch (error) {
    console.error('Get outfits error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete saved outfit
router.delete('/outfits/:outfitId', async (req, res) => {
  try {
    const { outfitId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const deletedCount = await db.deleteSavedOutfit(outfitId, userId);

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'Saved outfit not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
