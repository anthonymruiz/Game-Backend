import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { UserService } from '../services/user.service.js';
import { AuthService } from '../services/auth.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { Preferences } from '../models/preferences.entity.js';
import { DailyRewardService } from '../services/daily-reward.service.js';
import { RankTierService } from '../services/rank-tier.service.js';

@injectable()
export class UserController {
  private userService: UserService;
  private authService: AuthService;
  private userRepository: UserRepository;
  private dailyRewardService: DailyRewardService;

  constructor() {
    this.userService = container.resolve(UserService);
    this.authService = container.resolve(AuthService);
    this.userRepository = container.resolve(UserRepository);
    this.dailyRewardService = container.resolve(DailyRewardService);
  }

  public getDailyRewardStatus = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      res.status(200).json(await this.dailyRewardService.getStatus(userId));
    } catch (error) {
      this.respondDailyRewardError(error, res);
    }
  };

  public claimDailyReward = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      res.status(200).json(await this.dailyRewardService.claim(userId));
    } catch (error) {
      this.respondDailyRewardError(error, res);
    }
  };

  private respondDailyRewardError(error: unknown, res: Response): void {
    const code = error instanceof Error ? error.message : 'DAILY_REWARD_FAILED';
    if (code === 'USER_NOT_FOUND') {
      res.status(404).json({ error: code });
      return;
    }
    if (code === 'DAILY_REWARD_ALREADY_CLAIMED') {
      res.status(409).json({ error: code });
      return;
    }
    if (code === 'DAILY_REWARD_NOT_ELIGIBLE') {
      res.status(403).json({ error: code });
      return;
    }
    if (code === 'PROGRESSION_CONFIG_NOT_FOUND') {
      res.status(503).json({ error: code });
      return;
    }
    console.error('Daily reward request failed:', error);
    res.status(500).json({ error: 'DAILY_REWARD_FAILED' });
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
      const rankKey = typeof req.query.rankKey === 'string' && req.query.rankKey !== 'all'
        ? req.query.rankKey
        : undefined;
      const period = typeof req.query.period === 'string' ? req.query.period : 'history';
      if (period !== 'today' && period !== 'history') {
        res.status(400).json({ error: 'INVALID_LEADERBOARD_PERIOD' });
        return;
      }
      const leaderboard = await this.userService.getLeaderboard(100, rankKey, period);
      const ranks = await container.resolve(RankTierService).getRanks();
      res.status(200).json({
        leaderboard,
        ranks: ranks.map(({ key, emoji, badgeBg, textColor, configuration, minXp, maxXp }) => ({
          key,
          emoji,
          badgeBg,
          textColor,
          configuration,
          minXp,
          maxXp
        }))
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'INVALID_RANK_KEY') {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === 'INVALID_LEADERBOARD_PERIOD') {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  };

  public getUserStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const targetUserId = req.params.userId || req.user?.sub || req.user?.id;
      if (!targetUserId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }
      const stats = await this.userService.getUserStats(targetUserId);
      res.status(200).json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public getUserInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const targetUserId = req.params.userId || req.user?.sub || req.user?.id;
      if (!targetUserId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }
      const info = await this.userService.getUserInfo(targetUserId);
      res.status(200).json(info);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  };

  public deleteAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const user = await this.userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await this.userRepository.deleteUser(user);
      res.status(200).json({ message: 'Account deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public getDevices = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { DeviceSessionService } = await import('../services/device-session.service.js');
      const deviceSessionService = container.resolve(DeviceSessionService);
      const rawHeader = req.headers['x-device-id'];
      const currentDeviceId = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) || (req.query.deviceId as string) || undefined;
      const devices = await deviceSessionService.getUserSessions(userId, currentDeviceId);
      res.status(200).json({ devices });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public revokeDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { DeviceSessionService } = await import('../services/device-session.service.js');
      const deviceSessionService = container.resolve(DeviceSessionService);
      const sessionId = String(req.params.sessionId);
      const result = await deviceSessionService.revokeSession(userId, sessionId);
      if (result.success) {
        if (result.revokedDeviceId) {
          const { SocketManager } = await import('../socket/socket.manager.js');
          const socketManager = container.resolve(SocketManager);
          socketManager.emitSessionRevoked(userId, [result.revokedDeviceId]);
        }
        res.status(200).json({ message: 'Session revoked successfully' });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  public revokeOtherDevices = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { DeviceSessionService } = await import('../services/device-session.service.js');
      const deviceSessionService = container.resolve(DeviceSessionService);
      const rawHeader = req.headers['x-device-id'];
      const currentDeviceId = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) || (req.body?.deviceId as string) || undefined;
      if (!currentDeviceId) {
        res.status(400).json({ error: 'Current device ID is required' });
        return;
      }
      const result = await deviceSessionService.revokeOtherSessions(userId, currentDeviceId);
      if (result.revokedDeviceIds.length > 0) {
        const { SocketManager } = await import('../socket/socket.manager.js');
        const socketManager = container.resolve(SocketManager);
        socketManager.emitSessionRevoked(userId, result.revokedDeviceIds);
      }
      res.status(200).json({ message: 'Other sessions revoked successfully', revokedCount: result.revokedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
