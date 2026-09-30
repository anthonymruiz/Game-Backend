import { Router } from 'express';
import { container } from 'tsyringe';
import { AdminController } from '../controllers/admin.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';

export const adminRoutes: Router = Router();
let _controller: AdminController;
const getController = () => {
  if (!_controller) _controller = container.resolve(AdminController);
  return _controller;
};

adminRoutes.use(requireRole(['admin', 'superadmin']));

adminRoutes.get('/metrics', (req, res) => getController().getMetrics(req, res));
adminRoutes.get('/users', (req, res) => getController().getUsers(req, res));
adminRoutes.get('/active-users', (req, res) => getController().getActiveUsers(req, res));
adminRoutes.get('/reports', (req, res) => getController().getReports(req, res));
adminRoutes.get('/matches', (req, res) => getController().getMatches(req, res));
adminRoutes.get('/settings', (req, res) => getController().getSettings(req, res));
adminRoutes.put('/settings', (req, res) => getController().updateSettings(req, res));
adminRoutes.get('/users/:userId/reports', (req, res) => getController().getUserReports(req, res));
adminRoutes.post('/users/:id/ban', (req, res) => getController().banUser(req, res));
adminRoutes.post('/users/:id/unban', (req, res) => getController().unbanUser(req, res));
adminRoutes.post('/admins', (req, res) => getController().createAdmin(req, res));

export default adminRoutes;
