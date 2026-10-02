import { Router } from 'express';
import { container } from 'tsyringe';
import { NotificationController } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const notificationRoutes: Router = Router();
let _controller: NotificationController;
const getController = () => {
  if (!_controller) _controller = container.resolve(NotificationController);
  return _controller;
};

notificationRoutes.use(requireAuth);
notificationRoutes.get('/', (req, res) => getController().getAll(req, res));
notificationRoutes.delete('/', (req, res) => getController().deleteAll(req, res));
notificationRoutes.put('/:id/read', (req, res) => getController().markRead(req, res));
notificationRoutes.delete('/:id', (req, res) => getController().delete(req, res));
