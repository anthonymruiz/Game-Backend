import { Router } from 'express';
import { container } from 'tsyringe';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const userRoutes: Router = Router();
let _controller: UserController;
const getController = () => {
  if (!_controller) _controller = container.resolve(UserController);
  return _controller;
};

userRoutes.put('/profile', requireAuth, (req, res) => getController().updateProfile(req, res));
userRoutes.put('/preferences', requireAuth, (req, res) => getController().updatePreferences(req, res));
userRoutes.get('/leaderboard', (req, res) => getController().getLeaderboard(req, res));

export default userRoutes;
