import { injectable } from 'tsyringe';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { paginateQueryBuilder, IPaginationOptions, IPaginatedResult } from '../utils/pagination.util.js';
import { UserRole } from '../models/user-role.enum.js';
import { PresenceStatus } from '../models/presence.enum.js';

@injectable()
export class UserRepository {
  private get ormRepository(): Repository<User> {
    return AppDataSource.getRepository(User);
  }

  public async findById(id: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { id } });
  }

  public async findWithStats(id: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { id }, relations: { stats: true } });
  }

  public async findWithPreferences(id: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { id }, relations: { preferences: true } });
  }

  public async findByUsername(username: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { username } });
  }

  public async getTopPlayers(
    limit: number = 100,
    minXp?: number,
    maxXpExclusive?: number
  ): Promise<User[]> {
    const query = this.ormRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.stats', 'stats')
      .where('user.role NOT IN (:...excludedRoles)', {
        excludedRoles: [UserRole.GUEST, UserRole.BANNED]
      })
      .andWhere('(user.provider IS NULL OR user.provider != :guestProvider)', { guestProvider: 'guest' })
      .orderBy('stats.xp', 'DESC')
      .addOrderBy('stats.wins', 'DESC')
      .addOrderBy('stats.points', 'DESC')
      .addOrderBy('user.username', 'ASC')
      .take(Math.min(Math.max(1, Math.floor(limit)), 100));

    if (minXp !== undefined) {
      query.andWhere('COALESCE(stats.xp, 0) >= :minXp', { minXp });
    }
    if (maxXpExclusive !== undefined) {
      query.andWhere('COALESCE(stats.xp, 0) < :maxXpExclusive', { maxXpExclusive });
    }
    return query.getMany();
  }

  public async getTopPlayersByWins(
    limit: number = 100,
    minXp?: number,
    maxXpExclusive?: number,
    playedAfter?: Date,
    playedBefore?: Date
  ): Promise<Array<{
    userId: string;
    username: string;
    avatarUrl: string | null;
    wins: number;
    losses: number;
    draws: number;
    totalGames: number;
    lifetimeWins: number;
    points: number;
    xp: number;
  }>> {
    const query = AppDataSource.getRepository(MatchHistory).createQueryBuilder('history')
      .innerJoin(User, 'user', 'user.id = history.userId')
      .leftJoin('user.stats', 'stats')
      .select('history.userId', 'userId')
      .addSelect('MAX(user.username)', 'username')
      .addSelect('MAX(user.avatarUrl)', 'avatarUrl')
      .addSelect('COUNT(DISTINCT history.matchId)', 'totalGames')
      .addSelect('COUNT(DISTINCT CASE WHEN history.result = :winResult THEN history.matchId END)', 'wins')
      .addSelect('COUNT(DISTINCT CASE WHEN history.result = :lossResult THEN history.matchId END)', 'losses')
      .addSelect('COUNT(DISTINCT CASE WHEN history.result = :drawResult THEN history.matchId END)', 'draws')
      .addSelect('MAX(stats.wins)', 'lifetimeWins')
      .addSelect('MAX(stats.points)', 'points')
      .addSelect('MAX(stats.xp)', 'xp')
      .where('history.result IN (:...countedResults)', {
        countedResults: ['win', 'loss', 'draw']
      })
      .andWhere('user.role NOT IN (:...excludedRoles)', {
        excludedRoles: [UserRole.GUEST, UserRole.BANNED]
      })
      .andWhere('(user.provider IS NULL OR user.provider != :guestProvider)', { guestProvider: 'guest' })
      .setParameters({ winResult: 'win', lossResult: 'loss', drawResult: 'draw' })
      .groupBy('history.userId')
      .orderBy('wins', 'DESC')
      .addOrderBy('lifetimeWins', 'DESC')
      .addOrderBy('totalGames', 'DESC')
      .addOrderBy('xp', 'DESC')
      .addOrderBy('username', 'ASC')
      .take(Math.min(Math.max(1, Math.floor(limit)), 100));

    if (minXp !== undefined) {
      query.andWhere('COALESCE(stats.xp, 0) >= :minXp', { minXp });
    }
    if (maxXpExclusive !== undefined) {
      query.andWhere('COALESCE(stats.xp, 0) < :maxXpExclusive', { maxXpExclusive });
    }
    if (playedAfter !== undefined) {
      query.andWhere('history.createdAt >= :playedAfter', { playedAfter });
    }
    if (playedBefore !== undefined) {
      query.andWhere('history.createdAt < :playedBefore', { playedBefore });
    }

    const rows = await query.getRawMany<{
      userId: string;
      username: string;
      avatarUrl: string | null;
      wins: string | number;
      losses: string | number;
      draws: string | number;
      totalGames: string | number;
      lifetimeWins: string | number | null;
      points: string | number | null;
      xp: string | number | null;
    }>();
    return rows.map(row => ({
      userId: row.userId,
      username: row.username,
      avatarUrl: row.avatarUrl,
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0,
      draws: Number(row.draws) || 0,
      totalGames: Number(row.totalGames) || 0,
      lifetimeWins: Number(row.lifetimeWins) || 0,
      points: Number(row.points) || 0,
      xp: Number(row.xp) || 0
    }));
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { email } });
  }

  public async save(user: User): Promise<User> {
    return this.ormRepository.save(user);
  }

  public async countTotal(): Promise<number> {
    return this.ormRepository.count();
  }

  public async countOnline(): Promise<number> {
    return this.ormRepository.count({ where: { isOnline: true } });
  }

  public async findActiveUsers(): Promise<User[]> {
    return this.ormRepository.find({
      where: [
        { presenceStatus: PresenceStatus.PLAYING },
        { presenceStatus: PresenceStatus.ONLINE },
        { isOnline: true }
      ],
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        presenceStatus: true,
        isOnline: true,
        lastSeen: true
      }
    });
  }

  public async getPaginatedUsers(
    currentUserRole: string,
    filterRole?: string,
    filterPresence?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<User>> {
    const queryBuilder = this.ormRepository.createQueryBuilder('user')
      .select([
        'user.id',
        'user.username',
        'user.email',
        'user.role',
        'user.isOnline',
        'user.presenceStatus',
        'user.lastSeen',
        'user.createdAt'
      ]);

    // Role isolation rule: Admins can ONLY see normal users
    if (currentUserRole === UserRole.ADMIN) {
      queryBuilder.andWhere('user.role = :userRole', { userRole: UserRole.USER });
    } else if (currentUserRole === UserRole.SUPERADMIN) {
      if (filterRole && filterRole !== 'all') {
        queryBuilder.andWhere('user.role = :selectedRole', { selectedRole: filterRole });
      } else {
        queryBuilder.andWhere('user.role != :superRole', { superRole: UserRole.SUPERADMIN });
      }
    }

    if (filterPresence && filterPresence !== 'all') {
      queryBuilder.andWhere('user.presenceStatus = :presenceStatus', { presenceStatus: filterPresence });
    }

    return paginateQueryBuilder(queryBuilder, {
      page: options?.page || 1,
      limit: options?.limit || 10,
      search: options?.search,
      searchFields: ['user.username', 'user.email'],
      sortBy: options?.sortBy ? `user.${options.sortBy}` : 'user.createdAt',
      sortOrder: options?.sortOrder || 'DESC'
    });
  }

  public async updatePresence(userId: string, isOnline: boolean, status: PresenceStatus): Promise<void> {
    await this.ormRepository.update(userId, {
      isOnline,
      presenceStatus: status,
      lastSeen: new Date()
    });
  }

  public async deleteUser(user: User): Promise<void> {
    await this.ormRepository.remove(user);
  }
}
