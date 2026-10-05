import { injectable } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { StoreItem } from '../models/store-item.entity.js';
import { StoreItemStatus } from '../models/store-item.enum.js';

export interface IRewardsSettings {
  pointsPerWin: number;
  rankedPointsPerWin: number;
  dailyRewardPoints: number;
  pointsPerLevelUp: number;
  pointsPerRankUp: number;
  pointsPerBadge: number;
  weeklyFirstPlacePoints: number;
  weeklySecondPlacePoints: number;
  weeklyThirdPlacePoints: number;
  weeklyMysteryGiftItemId: string | null;
}

export const DEFAULT_REWARDS_SETTINGS: IRewardsSettings = {
  pointsPerWin: 10,
  rankedPointsPerWin: 10,
  dailyRewardPoints: 10,
  pointsPerLevelUp: 10,
  pointsPerRankUp: 10,
  pointsPerBadge: 10,
  weeklyFirstPlacePoints: 500,
  weeklySecondPlacePoints: 300,
  weeklyThirdPlacePoints: 100,
  weeklyMysteryGiftItemId: null
};

@injectable()
export class RewardsSettingsService {
  private get repository() {
    return AppDataSource.getRepository(RewardsSettings);
  }

  public async getConfiguration(): Promise<IRewardsSettings> {
    const record = await this.repository.findOne({ where: { singletonKey: 1 } });
    if (!record) throw new Error('Rewards configuration has not been seeded.');
    return this.toConfiguration(record);
  }

  public async updateConfiguration(input: Partial<IRewardsSettings>): Promise<IRewardsSettings> {
    const record = await this.repository.findOne({ where: { singletonKey: 1 } });
    if (!record) throw new Error('Rewards configuration has not been seeded.');

    record.pointsPerWin = this.validateInteger(input.pointsPerWin, record.pointsPerWin, 'pointsPerWin');
    record.rankedPointsPerWin = this.validateInteger(input.rankedPointsPerWin, record.rankedPointsPerWin, 'rankedPointsPerWin');
    record.dailyRewardPoints = this.validateInteger(input.dailyRewardPoints, record.dailyRewardPoints, 'dailyRewardPoints');
    record.pointsPerLevelUp = this.validateInteger(input.pointsPerLevelUp, record.pointsPerLevelUp, 'pointsPerLevelUp');
    record.pointsPerRankUp = this.validateInteger(input.pointsPerRankUp, record.pointsPerRankUp, 'pointsPerRankUp');
    record.pointsPerBadge = this.validateInteger(input.pointsPerBadge, record.pointsPerBadge, 'pointsPerBadge');
    record.weeklyFirstPlacePoints = this.validateInteger(input.weeklyFirstPlacePoints, record.weeklyFirstPlacePoints, 'weeklyFirstPlacePoints');
    record.weeklySecondPlacePoints = this.validateInteger(input.weeklySecondPlacePoints, record.weeklySecondPlacePoints, 'weeklySecondPlacePoints');
    record.weeklyThirdPlacePoints = this.validateInteger(input.weeklyThirdPlacePoints, record.weeklyThirdPlacePoints, 'weeklyThirdPlacePoints');
    const giftItemId = input.weeklyMysteryGiftItemId === undefined
      ? record.weeklyMysteryGiftItemId
      : input.weeklyMysteryGiftItemId;
    if (giftItemId === null) {
      record.weeklyMysteryGiftItemId = null;
    } else {
      if (typeof giftItemId !== 'string' || !giftItemId.trim()) {
        throw new Error('weeklyMysteryGiftItemId must be null or an available store item.');
      }
      const giftItem = await AppDataSource.getRepository(StoreItem).findOne({
        where: { id: giftItemId, status: StoreItemStatus.AVAILABLE }
      });
      if (!giftItem) throw new Error('weeklyMysteryGiftItemId must be an available store item.');
      record.weeklyMysteryGiftItemId = giftItem.id;
    }

    return this.toConfiguration(await this.repository.save(record));
  }

  private validateInteger(value: unknown, current: number, name: string): number {
    if (value === undefined) return current;
    if (value === null) throw new Error(`${name} must be an integer between 1 and 1000000.`);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
      throw new Error(`${name} must be an integer between 1 and 1000000.`);
    }
    return parsed;
  }

  private toConfiguration(record: RewardsSettings): IRewardsSettings {
    return {
      pointsPerWin: record.pointsPerWin,
      rankedPointsPerWin: record.rankedPointsPerWin,
      dailyRewardPoints: record.dailyRewardPoints,
      pointsPerLevelUp: record.pointsPerLevelUp,
      pointsPerRankUp: record.pointsPerRankUp,
      pointsPerBadge: record.pointsPerBadge,
      weeklyFirstPlacePoints: record.weeklyFirstPlacePoints,
      weeklySecondPlacePoints: record.weeklySecondPlacePoints,
      weeklyThirdPlacePoints: record.weeklyThirdPlacePoints,
      weeklyMysteryGiftItemId: record.weeklyMysteryGiftItemId
    };
  }
}
