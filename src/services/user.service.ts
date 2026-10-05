import { injectable, container } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { isValidUsernameFormat, isValidEmailFormat } from '../utils/regex.util.js';
import { getLevelProgress, LevelProgressionService } from './level-progression.service.js';
import { RankTierService } from './rank-tier.service.js';

@injectable()
export class UserService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = container.resolve(UserRepository);
  }

  public async checkUsernameAvailability(username: string): Promise<boolean> {
    if (!username || !isValidUsernameFormat(username)) {
      throw new Error('Username must be 3 to 20 alphanumeric characters with no spaces or special characters.');
    }

    const existingUser = await this.userRepository.findByUsername(username);
    if (existingUser) {
      throw new Error('Username is already taken.');
    }

    return true;
  }

  public async checkEmailAvailability(email: string): Promise<boolean> {
    if (!email || !isValidEmailFormat(email)) {
      throw new Error('Invalid email format.');
    }

    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new Error('Email is already in use.');
    }

    return true;
  }

  public async setUsername(userId: string, username: string): Promise<User> {
    await this.checkUsernameAvailability(username);

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.username = username.trim();
    user.hasUsernameSet = true;
    return this.userRepository.save(user);
  }

  public async getUserStats(userId: string) {
    const user = await this.userRepository.findWithStats(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    const stats = user.stats || { wins: 0, losses: 0, draws: 0, points: 0, xp: 0 };
    const wins = Number(stats.wins) || 0;
    const losses = Number(stats.losses) || 0;
    const draws = Number(stats.draws) || 0;
    const points = Number(stats.points) || 0;
    const xp = Number(stats.xp) || 0;
    const totalGames = wins + losses + draws;
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

    let dailyStreak = 0;
    try {
      const matchHistoryRepo = AppDataSource.getRepository(MatchHistory);
      const matches = await matchHistoryRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 50
      });

      if (matches.length > 0) {
        const uniqueDays = new Set<string>();
        for (const m of matches) {
          if (m.createdAt) {
            const dateStr = new Date(m.createdAt).toISOString().split('T')[0];
            uniqueDays.add(dateStr);
          }
        }
        dailyStreak = uniqueDays.size;
      }
    } catch (e) {
      dailyStreak = 0;
    }

    const rankInfo = await container.resolve(RankTierService).getRankInfo(xp);
    const levelProgress = getLevelProgress(xp, await container.resolve(LevelProgressionService).getConfiguration());

    return {
      userId: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl || null,
      totalGames,
      wins,
      losses,
      draws,
      winRate,
      points: points,
      level: levelProgress.level,
      rankInfo,
      rankKey: rankInfo.rankKey,
      nextRankKey: rankInfo.nextRankKey,
      targetXp: rankInfo.targetXp,
      xpToNextRank: rankInfo.xpToNextRank,
      progressPercent: rankInfo.progressPercent,
      xp,
      currentLevelXp: levelProgress.currentLevelXp,
      nextLevelXp: levelProgress.nextLevelXp,
      xpToNextLevel: levelProgress.xpToNextLevel,
      levelProgressPercent: levelProgress.levelProgressPercent,
      isMaxLevel: levelProgress.isMaxLevel,
      dailyStreak
    };
  }

  public async getLeaderboard(
    limit: number = 100,
    rankKey?: string,
    period: 'today' | 'history' = 'history'
  ) {
    const rankTierService = container.resolve(RankTierService);
    const ranks = await rankTierService.getRanks();
    const selectedRankIndex = rankKey ? ranks.findIndex(rank => rank.key === rankKey) : -1;
    if (rankKey && selectedRankIndex < 0) throw new Error('INVALID_RANK_KEY');
    if (period !== 'today' && period !== 'history') throw new Error('INVALID_LEADERBOARD_PERIOD');
    const selectedRank = selectedRankIndex >= 0 ? ranks[selectedRankIndex] : undefined;
    const nextRank = selectedRankIndex >= 0 ? ranks[selectedRankIndex + 1] : undefined;
    let playedAfter: Date | undefined;
    let playedBefore: Date | undefined;
    if (period === 'today') {
      const now = new Date();
      playedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      playedBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }
    const users = await this.userRepository.getTopPlayersByWins(
      limit,
      selectedRank?.minXp,
      nextRank?.minXp,
      playedAfter,
      playedBefore
    );
    const levelProgressionService = container.resolve(LevelProgressionService);
    const levelConfiguration = await levelProgressionService.getConfiguration();
    let gameService: any = null;
    try {
      const { GameService } = await import('./game.service.js');
      gameService = container.resolve(GameService);
    } catch (e) {}

    return Promise.all(users.map(async (user, index) => {
      const wins = user.wins;
      const losses = user.losses;
      const draws = user.draws;
      const totalGames = wins + losses + draws;
      const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
      const points = user.points;
      const xp = user.xp;
      const rankInfo = await rankTierService.getRankInfo(xp, ranks);
      let tier = 'BRONZE';
      if (winRate >= 75 && totalGames >= 5) tier = 'DIAMOND';
      else if (winRate >= 60) tier = 'GOLD';
      else if (winRate >= 40) tier = 'SILVER';
      const level = getLevelProgress(xp, levelConfiguration).level;

      const activeGame = gameService ? gameService.getGameByPlayerId(user.userId) : null;

      return {
        rank: index + 1,
        id: user.userId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        wins,
        losses,
        draws,
        totalGames,
        winRate,
        points,
        xp,
        tier,
        rankInfo,
        level,
        isPlaying: !!activeGame,
        activeMatchId: activeGame ? activeGame.id : null
      };
    }));
  }

  public async getUserInfo(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found.');
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl || null,
      provider: user.provider || 'local',
      hasUsernameSet: user.hasUsernameSet
    };
  }
}
