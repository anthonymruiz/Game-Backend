import { injectable } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Badge } from '../models/badge.entity.js';
import { UserBadge } from '../models/user-badge.entity.js';

@injectable()
export class BadgeRepository {
  public get badges() {
    return AppDataSource.getRepository(Badge);
  }

  public get userBadges() {
    return AppDataSource.getRepository(UserBadge);
  }

  public list(): Promise<Badge[]> {
    return this.badges.find({ order: { createdAt: 'DESC', id: 'DESC' } });
  }

  public async listForUser(userId: string): Promise<UserBadge[]> {
    return this.userBadges.find({
      where: { userId },
      relations: { badge: true },
      order: { unlockedAt: 'ASC', createdAt: 'ASC' }
    });
  }

  public async countUnlockedUsers(badgeId: string): Promise<number> {
    return this.userBadges.createQueryBuilder('userBadge')
      .where('userBadge.badgeId = :badgeId', { badgeId })
      .andWhere('userBadge.unlockedAt IS NOT NULL')
      .getCount();
  }

  public async getSummary(): Promise<{
    totalBadges: number;
    activeBadges: number;
    unlockedCount: number;
    usersWithBadges: number;
  }> {
    const unlockedCountResult = await this.userBadges.createQueryBuilder('userBadge')
      .where('userBadge.unlockedAt IS NOT NULL')
      .getCount();
    const usersWithBadgesResult = await this.userBadges.createQueryBuilder('userBadge')
      .select('COUNT(DISTINCT userBadge.userId)', 'count')
      .where('userBadge.unlockedAt IS NOT NULL')
      .getRawOne<{ count: string }>();
    const [totalBadges, activeBadges, unlockedCount, usersWithBadges] = await Promise.all([
      this.badges.count(),
      this.badges.countBy({ isActive: true }),
      Promise.resolve(unlockedCountResult),
      Promise.resolve(usersWithBadgesResult)
    ]);

    return {
      totalBadges,
      activeBadges,
      unlockedCount,
      usersWithBadges: Number(usersWithBadges?.count || 0)
    };
  }
}
