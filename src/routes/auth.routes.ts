import { Router } from 'express';
import { container } from 'tsyringe';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const authRouter: Router = Router();
let _controller: AuthController;
const getController = () => {
  if (!_controller) _controller = container.resolve(AuthController);
  return _controller;
};

authRouter.post('/register', (req, res) => getController().register(req, res));
authRouter.post('/login', (req, res) => getController().login(req, res));
authRouter.post('/social', (req, res) => getController().socialLogin(req, res));
authRouter.post('/guest', (req, res) => getController().guestLogin(req, res));
authRouter.post('/set-username', requireAuth, (req, res) => getController().setUsername(req, res));
authRouter.get('/google', (req, res) => getController().redirectToGoogle(req, res));
authRouter.get('/facebook', (req, res) => getController().redirectToFacebook(req, res));

export default authRouter;
