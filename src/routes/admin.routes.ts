import { Router } from 'express';
import { container } from 'tsyringe';
import { AdminController } from '../controllers/admin.controller.js';
import { requireAuth, requireRoles } from '../middlewares/role.middleware.js';

export const adminRoutes = Router();
const adminController = container.resolve(AdminController);

adminRoutes.use(requireAuth);
adminRoutes.use(requireRoles(['admin', 'superadmin']));

adminRoutes.get('/metrics', (req, res) => adminController.getMetrics(req, res));
adminRoutes.get('/users', (req, res) => adminController.getUsers(req, res));
adminRoutes.post('/users/:id/ban', (req, res) => adminController.banUser(req, res));
adminRoutes.post('/admins', (req, res) => adminController.createAdmin(req, res));
