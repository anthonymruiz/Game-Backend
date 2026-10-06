import { Router } from 'express';
import { container } from 'tsyringe';
import { AdminController } from '../controllers/admin.controller.js';
import { StoreController } from '../controllers/store.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { BadgeController } from '../controllers/badge.controller.js';

export const adminRoutes: Router = Router();
let _controller: AdminController;
const getController = () => {
  if (!_controller) _controller = container.resolve(AdminController);
  return _controller;
};
const getStoreController = () => container.resolve(StoreController);
const getBadgeController = () => container.resolve(BadgeController);

adminRoutes.use(requireRole(['admin', 'superadmin']));

adminRoutes.get('/metrics', (req, res) => getController().getMetrics(req, res));
adminRoutes.get('/dashboard/analytics', (req, res) => getController().getDashboardAnalytics(req, res));
adminRoutes.get('/users', (req, res) => getController().getUsers(req, res));
adminRoutes.get('/transactions', (req, res) => getController().getTransactions(req, res));
adminRoutes.get('/active-users', (req, res) => getController().getActiveUsers(req, res));
adminRoutes.get('/reports', (req, res) => getController().getReports(req, res));
adminRoutes.put('/reports/:id/status', (req, res) => getController().updateReportStatus(req, res));
adminRoutes.delete('/reports/:id', (req, res) => getController().deleteReport(req, res));
adminRoutes.get('/matches/mode-distribution', (req, res) => getController().getMatchModeDistribution(req, res));
adminRoutes.get('/badges/options', (req, res) => getBadgeController().getOptions(req, res));
adminRoutes.get('/badges/summary', (req, res) => getBadgeController().getSummary(req, res));
adminRoutes.get('/badges', (req, res) => getBadgeController().getAdminBadges(req, res));
adminRoutes.post('/badges', (req, res) => getBadgeController().create(req, res));
adminRoutes.put('/badges/:id', (req, res) => getBadgeController().update(req, res));
adminRoutes.delete('/badges/:id', (req, res) => getBadgeController().delete(req, res));
adminRoutes.get('/matches/summary', (req, res) => getController().getMatchSummary(req, res));
adminRoutes.get('/level-progression', (req, res) => getController().getLevelProgressionConfig(req, res));
adminRoutes.put('/level-progression', (req, res) => getController().updateLevelProgressionConfig(req, res));
adminRoutes.get('/rewards-settings', (req, res) => getController().getRewardsSettings(req, res));
adminRoutes.put('/rewards-settings', (req, res) => getController().updateRewardsSettings(req, res));
adminRoutes.get('/ranks', (req, res) => getController().getRankTiers(req, res));
adminRoutes.put('/ranks', (req, res) => getController().replaceRankTiers(req, res));
adminRoutes.get('/store/point-packages', (req, res) => getController().getPointPackages(req, res));
adminRoutes.put('/store/point-packages', (req, res) => getController().updatePointPackages(req, res));
adminRoutes.get('/store/users/search', (req, res) => getStoreController().searchGiftRecipients(req, res));
adminRoutes.get('/store/items', (req, res) => getStoreController().getAdminItems(req, res));
adminRoutes.post('/store/items', (req, res) => getStoreController().createItem(req, res));
adminRoutes.put('/store/items/:id', (req, res) => getStoreController().updateItem(req, res));
adminRoutes.patch('/store/items/:id/status', (req, res) => getStoreController().updateItemStatus(req, res));
adminRoutes.post('/store/items/:id/gift', (req, res) => getStoreController().giftItem(req, res));
adminRoutes.post('/store/point-packages/:id/gift', requireRole(['superadmin']), (req, res) => getStoreController().giftPointPackage(req, res));
adminRoutes.get('/matches', (req, res) => getController().getMatches(req, res));
adminRoutes.get('/settings', (req, res) => getController().getSettings(req, res));
adminRoutes.put('/settings', (req, res) => getController().updateSettings(req, res));
adminRoutes.get('/users/:userId/reports', (req, res) => getController().getUserReports(req, res));
adminRoutes.post('/users/:id/ban', (req, res) => getController().banUser(req, res));
adminRoutes.post('/users/:id/unban', (req, res) => getController().unbanUser(req, res));
adminRoutes.put('/users/:id/role', requireRole(['superadmin']), (req, res) => getController().updateUserRole(req, res));
adminRoutes.post('/admins', (req, res) => getController().createAdmin(req, res));

export default adminRoutes;
