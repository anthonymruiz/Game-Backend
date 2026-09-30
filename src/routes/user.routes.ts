import { Router } from 'express';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const userRoutes = Router();

userRoutes.put('/preferences', requireAuth, async (req, res) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: req.user!.id }, relations: ['preferences'] });
    if (user && user.preferences) {
      user.preferences.language = req.body.language || user.preferences.language;
      if (req.body.fcmToken) {
        user.preferences.fcmToken = req.body.fcmToken;
      }
      await userRepo.save(user);
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});
