import { injectable } from 'tsyringe';
import { In, Repository } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { StoreItem } from '../models/store-item.entity.js';

export interface IDashboardRankThreshold {
  key: string;
  minXp: number;
}

@injectable()
export class AdminDashboardRepository {
  private get userRepository(): Repository<User> {
    return AppDataSource.getRepository(User);
  }

  public async getUserGrowth(
    range: 'today' | '7d' | 'month' | 'year',
    start: Date,
    end: Date
  ): Promise<{ bucket: string; count: number }[]> {
    const bucketExpression = range === 'today'
      ? 'HOUR(user.createdAt)'
      : range === 'year'
        ? "DATE_FORMAT(user.createdAt, '%Y-%m')"
        : "DATE_FORMAT(user.createdAt, '%Y-%m-%d')";
    const rows = await this.userRepository.createQueryBuilder('user')
      .select(bucketExpression, 'bucket')
      .addSelect('COUNT(user.id)', 'count')
      .where('user.createdAt >= :start', { start })
      .andWhere('user.createdAt <= :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string | number; count: string | number }>();

    return rows.map(row => ({ bucket: String(row.bucket), count: Number(row.count) || 0 }));
  }

  public async getTopRedeemedItems(limit = 5): Promise<{
    id: string;
    icon: string;
    configuration: StoreItem['configuration'];
    count: number;
  }[]> {
    const rows = await AppDataSource.getRepository(UserStoreItem).createQueryBuilder('ownership')
      .select('ownership.storeItemId', 'itemId')
      .addSelect('COUNT(ownership.id)', 'count')
      .where('ownership.giftedByUserId IS NULL')
      .groupBy('ownership.storeItemId')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany<{ itemId: string; count: string | number }>();

    if (rows.length === 0) return [];
    const items = await AppDataSource.getRepository(StoreItem).findBy({
      id: In(rows.map(row => row.itemId))
    });
    const itemsById = new Map(items.map(item => [item.id, item]));
    return rows.flatMap(row => {
      const item = itemsById.get(row.itemId);
      return item ? [{
        id: item.id,
        icon: item.icon,
        configuration: item.configuration,
        count: Number(row.count) || 0
      }] : [];
    });
  }

  public async getUsersByRank(ranks: IDashboardRankThreshold[]): Promise<{ key: string; count: number }[]> {
    if (ranks.length === 0) return [];
    const parameters: Record<string, string | number> = {};
    const whenClauses = ranks.slice(1).map((rank, index) => {
      parameters[`rankXp${index}`] = rank.minXp;
      parameters[`rankKey${index}`] = ranks[index].key;
      return `WHEN COALESCE(stats.xp, 0) < :rankXp${index} THEN :rankKey${index}`;
    });
    parameters.lastRankKey = ranks[ranks.length - 1].key;
    const rankExpression = whenClauses.length
      ? `CASE ${whenClauses.join(' ')} ELSE :lastRankKey END`
      : ':lastRankKey';
    const rows = await this.userRepository.createQueryBuilder('user')
      .leftJoin('user.stats', 'stats')
      .select(rankExpression, 'rankKey')
      .addSelect('COUNT(user.id)', 'count')
      .groupBy('rankKey')
      .setParameters(parameters)
      .getRawMany<{ rankKey: string; count: string | number }>();
    return rows.map(row => ({ key: row.rankKey, count: Number(row.count) || 0 }));
  }
}
