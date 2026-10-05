import { injectable } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { DailyRewardClaim } from '../models/daily-reward-claim.entity.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';

export interface IDailyRewardStatus {
  points: number;
  claimedToday: boolean;
}

export interface IDailyRewardClaim extends IDailyRewardStatus {
  awardedPoints: number;
}

@injectable()
export class DailyRewardService {
  public async getStatus(userId: string): Promise<IDailyRewardStatus> {
    const [user, config, claimedToday] = await Promise.all([
      AppDataSource.getRepository(User).findOne({ where: { id: userId } }),
      AppDataSource.getRepository(RewardsSettings).findOne({ where: { singletonKey: 1 } }),
      AppDataSource.getRepository(DailyRewardClaim).exists({
        where: { userId, claimDate: this.getUtcDate() }
      })
    ]);
    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.provider === 'guest' || user.id.startsWith('guest_')) throw new Error('DAILY_REWARD_NOT_ELIGIBLE');
    if (!config) throw new Error('REWARDS_CONFIGURATION_NOT_FOUND');

    return {
      points: config.dailyRewardPoints,
      claimedToday
    };
  }

  public async claim(userId: string): Promise<IDailyRewardClaim> {
    return AppDataSource.transaction(async manager => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        relations: { stats: true }
      });
      if (!user) throw new Error('USER_NOT_FOUND');
      if (user.provider === 'guest' || user.id.startsWith('guest_')) throw new Error('DAILY_REWARD_NOT_ELIGIBLE');

      const today = this.getUtcDate();
      const config = await manager.findOne(RewardsSettings, {
        where: { singletonKey: 1 }
      });
      if (!config) throw new Error('REWARDS_CONFIGURATION_NOT_FOUND');

      try {
        await manager.insert(DailyRewardClaim, { userId, claimDate: today });
      } catch (error) {
        if (this.isDuplicateClaimError(error)) throw new Error('DAILY_REWARD_ALREADY_CLAIMED');
        throw error;
      }

      let stats = user.stats as Stats | null;
      if (!stats) {
        stats = new Stats();
        await manager.save(stats);
        user.stats = stats;
        await manager.save(user);
      }
      await manager.increment(Stats, { id: stats.id }, 'points', config.dailyRewardPoints);
      const updatedStats = await manager.findOneByOrFail(Stats, { id: stats.id });

      return {
        awardedPoints: config.dailyRewardPoints,
        points: updatedStats.points,
        claimedToday: true
      };
    });
  }

  private getUtcDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private isDuplicateClaimError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const queryError = error as { code?: string; driverError?: { code?: string } };
    return queryError.code === 'ER_DUP_ENTRY' || queryError.driverError?.code === 'ER_DUP_ENTRY';
  }
}
