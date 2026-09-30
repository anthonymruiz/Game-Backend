import { Router } from 'express';
import { container } from 'tsyringe';
import { AdminController } from '../controllers/admin.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';

export const adminRoutes: Router = Router();
const adminController = container.resolve(AdminController);

adminRoutes.use(requireRole(['admin', 'superadmin']));

adminRoutes.get('/metrics', adminController.getMetrics);
adminRoutes.get('/users', adminController.getUsers);
adminRoutes.get('/active-users', adminController.getActiveUsers);
adminRoutes.get('/reports', adminController.getReports);
adminRoutes.get('/matches', adminController.getMatches);
adminRoutes.get('/settings', adminController.getSettings);
adminRoutes.put('/settings', adminController.updateSettings);
adminRoutes.get('/users/:userId/reports', adminController.getUserReports);
adminRoutes.post('/users/:id/ban', adminController.banUser);
adminRoutes.post('/users/:id/unban', adminController.unbanUser);
adminRoutes.post('/admins', adminController.createAdmin);

export default adminRoutes;
