import { Router } from 'express';
import { container } from 'tsyringe';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';
import { BadgeController } from '../controllers/badge.controller.js';

export const userRoutes: Router = Router();
let _controller: UserController;
const getController = () => {
  if (!_controller) _controller = container.resolve(UserController);
  return _controller;
};
const getBadgeController = () => container.resolve(BadgeController);

userRoutes.put('/profile', requireAuth, (req, res) => getController().updateProfile(req, res));
userRoutes.put('/preferences', requireAuth, (req, res) => getController().updatePreferences(req, res));
userRoutes.get('/me/preferences', requireAuth, (req, res) => getController().getMyPreferences(req, res));
userRoutes.get('/leaderboard', (req, res) => getController().getLeaderboard(req, res));
userRoutes.get('/ranks', (req, res) => getController().getPublicRankTiers(req, res));
userRoutes.get('/rewards/settings', (req, res) => getController().getPublicRewardsSettings(req, res));
userRoutes.get('/me/stats', requireAuth, (req, res) => getController().getUserStats(req, res));
userRoutes.get('/me/info', requireAuth, (req, res) => getController().getUserInfo(req, res));
userRoutes.get('/me/daily-reward', requireAuth, (req, res) => getController().getDailyRewardStatus(req, res));
userRoutes.post('/me/daily-reward', requireAuth, (req, res) => getController().claimDailyReward(req, res));
userRoutes.get('/:userId/stats', (req, res) => getController().getUserStats(req, res));
userRoutes.get('/:userId/badges', (req, res) => getBadgeController().getUserBadges(req, res));
userRoutes.get('/me/devices', requireAuth, (req, res) => getController().getDevices(req, res));
userRoutes.delete('/me/devices/others', requireAuth, (req, res) => getController().revokeOtherDevices(req, res));
userRoutes.delete('/me/devices/:sessionId', requireAuth, (req, res) => getController().revokeDevice(req, res));
userRoutes.delete('/account', requireAuth, (req, res) => getController().deleteAccount(req, res));
userRoutes.delete('/me', requireAuth, (req, res) => getController().deleteAccount(req, res));

export default userRoutes;
