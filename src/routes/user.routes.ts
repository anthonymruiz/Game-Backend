import { Router } from 'express';
import { container } from 'tsyringe';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const userRoutes: Router = Router();
const userController = container.resolve(UserController);

userRoutes.put('/profile', requireAuth, userController.updateProfile);
userRoutes.put('/preferences', requireAuth, userController.updatePreferences);
userRoutes.get('/leaderboard', userController.getLeaderboard);

export default userRoutes;
