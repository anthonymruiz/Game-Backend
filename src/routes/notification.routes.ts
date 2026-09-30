import { Router } from 'express';
import { container } from 'tsyringe';
import { NotificationController } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const notificationRoutes = Router();
const controller = container.resolve(NotificationController);

notificationRoutes.use(requireAuth);
notificationRoutes.get('/', (req, res) => controller.getAll(req, res));
notificationRoutes.put('/:id/read', (req, res) => controller.markRead(req, res));
notificationRoutes.delete('/:id', (req, res) => controller.delete(req, res));
