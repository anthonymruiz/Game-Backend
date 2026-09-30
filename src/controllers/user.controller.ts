import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { UserService } from '../services/user.service.js';
import { AuthService } from '../services/auth.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { Preferences } from '../models/preferences.entity.js';

@injectable()
export class UserController {
  private userService: UserService;
  private authService: AuthService;
  private userRepository: UserRepository;

  constructor() {
    this.userService = container.resolve(UserService);
    this.authService = container.resolve(AuthService);
    this.userRepository = container.resolve(UserRepository);
  }

  public updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { username, avatarUrl } = req.body;
      const user = await this.userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (username && username.trim() !== user.username) {
        await this.userService.checkUsernameAvailability(username);
        user.username = username.trim();
        user.hasUsernameSet = true;
      }

      if (avatarUrl !== undefined) {
        user.avatarUrl = avatarUrl;
      }

      const savedUser = await this.userRepository.save(user);
      const newToken = this.authService.generateJwt(savedUser);

      res.status(200).json({
        message: 'Profile updated successfully',
        token: newToken,
        user: {
          id: savedUser.id,
          username: savedUser.username,
          email: savedUser.email,
          role: savedUser.role,
          avatarUrl: savedUser.avatarUrl,
          hasUsernameSet: savedUser.hasUsernameSet
        }
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public updatePreferences = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await this.userRepository.findWithPreferences(userId);
      if (user) {
        if (!user.preferences) {
          user.preferences = new Preferences();
        }
        user.preferences.language = req.body.language || user.preferences.language;
        user.preferences.theme = req.body.theme || user.preferences.theme;
        if (req.body.fcmToken) {
          user.preferences.fcmToken = req.body.fcmToken;
        }
        await this.userRepository.save(user);
        res.status(200).json({ success: true, preferences: user.preferences });
        return;
      }
      res.status(404).json({ error: 'User not found' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  public getLeaderboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Number(req.query.limit) || 100;
      const leaderboard = await this.userService.getLeaderboard(limit);
      res.status(200).json({ leaderboard });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
