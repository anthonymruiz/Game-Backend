import { injectable } from 'tsyringe';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../models/user.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { paginateQueryBuilder, IPaginationOptions, IPaginatedResult } from '../utils/pagination.util.js';
import { UserRole } from '../models/user-role.enum.js';
import { PresenceStatus } from '../models/presence.enum.js';

@injectable()
export class UserRepository {
  private ormRepository: Repository<User>;

  constructor() {
    this.ormRepository = AppDataSource.getRepository(User);
  }

  public async findById(id: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { id } });
  }

  public async findWithPreferences(id: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { id }, relations: { preferences: true } });
  }

  public async findByUsername(username: string): Promise<User | null> {
    return this.ormRepository.findOne({ where: { username } });
  }

  public async getTopPlayers(limit: number = 100): Promise<User[]> {
    return this.ormRepository.find({
      relations: { stats: true },
      order: {
        stats: {
          wins: 'DESC',
          elo: 'DESC'
        }
      },
      take: limit
    });
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
}
