import { Router } from 'express';
import { container } from 'tsyringe';
import { RoomController } from '../controllers/room.controller.js';
import { optionalAuth, requireAuth } from '../middlewares/role.middleware.js';

export const roomRouter: Router = Router();
let _controller: RoomController;
const getController = () => {
  if (!_controller) _controller = container.resolve(RoomController);
  return _controller;
};

roomRouter.get('/', optionalAuth, (req, res) => getController().getPublicRooms(req, res));
roomRouter.get('/code/:code', (req, res) => getController().getRoomByCode(req, res));
roomRouter.get('/:id', (req, res) => getController().getRoomById(req, res));
roomRouter.post('/', requireAuth, (req, res) => getController().createRoom(req, res));
roomRouter.post('/:id/join', requireAuth, (req, res) => getController().joinRoom(req, res));
roomRouter.post('/:id/privacy', requireAuth, (req, res) => getController().togglePrivacy(req, res));
roomRouter.delete('/:id', requireAuth, (req, res) => getController().cancelRoom(req, res));

export default roomRouter;
