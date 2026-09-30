import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';

@injectable()
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService
  ) {}

  public register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, username, password } = req.body;
      const user = await this.authService.register(email, username, password, 'local');
      const token = this.authService.generateJwt(user);
      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          hasUsernameSet: user.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, login, username, password } = req.body;
      const identifier = login || email || username;
      const result = await this.authService.login(identifier, password);
      res.status(200).json({ 
        message: 'Login successful', 
        token: result.token, 
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.user.role,
          hasUsernameSet: result.user.hasUsernameSet
        }
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
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.user.role,
          hasUsernameSet: result.user.hasUsernameSet
        },
        isNewUser: result.isNewUser
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  };

  public setUsername = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { username } = req.body;
      const updatedUser = await this.userService.setUsername(userId, username);
      const newToken = this.authService.generateJwt(updatedUser);

      res.status(200).json({
        message: 'Username updated successfully',
        token: newToken,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role,
          hasUsernameSet: updatedUser.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public guestLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const { username } = req.body;
      const email = `guest_${Date.now()}@game.local`;
      const user = await this.authService.register(email, username, undefined, 'guest');
      const result = await this.authService.login(user.email, undefined);
      res.status(200).json({ 
        message: 'Guest login successful', 
        token: result.token, 
        user: {
          id: result.user.id,
          username: result.user.username,
          role: result.user.role,
          hasUsernameSet: result.user.hasUsernameSet
        } 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}
