import { Router } from 'express';
import { container } from 'tsyringe';
import { AuthController } from '../controllers/auth.controller.js';

const authRouter = Router();
const authController = container.resolve(AuthController);

authRouter.post('/register', authController.register);
authRouter.post('/login', authController.login);
authRouter.post('/social', authController.socialLogin);
authRouter.post('/guest', authController.guestLogin);

export default authRouter;
