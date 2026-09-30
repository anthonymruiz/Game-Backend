import { Router } from 'express';
import { container } from 'tsyringe';
import { AuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const authRouter: Router = Router();
const authController = container.resolve(AuthController);

authRouter.post('/register', authController.register);
authRouter.post('/login', authController.login);
authRouter.post('/social', authController.socialLogin);
authRouter.post('/guest', authController.guestLogin);
authRouter.post('/set-username', requireAuth, authController.setUsername);

export default authRouter;
