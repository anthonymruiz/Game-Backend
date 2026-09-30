import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { AuthService } from '../services/auth.service.js';

@injectable()
export class AuthController {
  constructor(private authService: AuthService) {}

  public register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, username, password } = req.body;
      const user = await this.authService.register(email, username, password, 'local');
      res.status(201).json({ message: 'User registered successfully', user: { id: user.id, username: user.username, email: user.email } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;
      const result = await this.authService.login(email, password);
      res.status(200).json({ 
        message: 'Login successful', 
        token: result.token, 
        user: { id: result.user.id, username: result.user.username, email: result.user.email } 
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  };

  public socialLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, token } = req.body;
      const result = await this.authService.loginWithSocialProvider(provider, token);
      res.status(200).json({ 
        message: 'Social login successful', 
        token: result.jwtToken, 
        user: { id: result.user.id, username: result.user.username, email: result.user.email } 
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  };

  public guestLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { username } = req.body;
      const email = `guest_${Date.now()}@wallrush.local`; // Dummy email for guest uniqueness
      const user = await this.authService.register(email, username, undefined, 'guest');
      const result = await this.authService.login(user.email, undefined);
      res.status(200).json({ 
        message: 'Guest login successful', 
        token: result.token, 
        user: { id: result.user.id, username: result.user.username, role: result.user.role } 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
