import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { MatchHistory } from '../models/match-history.entity.js';
import { User } from '../models/user.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { paginateQueryBuilder, IPaginationOptions, IPaginatedResult } from '../utils/pagination.util.js';

@injectable()
export class MatchHistoryRepository {
  private get ormRepository(): Repository<MatchHistory> {
    return AppDataSource.getRepository(MatchHistory);
  }

  public async countTotal(): Promise<number> {
    return this.ormRepository.count();
  }

  public async getModeDistribution(): Promise<{ mode: string; count: number }[]> {
    const rows = await this.ormRepository.createQueryBuilder('match')
      .select('match.mode', 'mode')
      .addSelect('COUNT(DISTINCT match.matchId)', 'count')
      .groupBy('match.mode')
      .getRawMany<{ mode: string; count: string }>();

    return rows.map(row => ({
      mode: row.mode,
      count: Number(row.count)
    }));
  }

  public async getTotalDistinctMatchCount(): Promise<number> {
    const result = await this.ormRepository.createQueryBuilder('match')
      .select('COUNT(DISTINCT match.matchId)', 'count')
      .getRawOne<{ count: string | number }>();

    return Number(result?.count ?? 0);
  }

  public async save(entity: MatchHistory): Promise<MatchHistory> {
    return this.ormRepository.save(entity);
  }

  public async getPaginatedMatches(
    modeFilter?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<MatchHistory>> {
    const queryBuilder = this.ormRepository.createQueryBuilder('match')
      .leftJoinAndSelect('match.user', 'user')
      .leftJoinAndMapOne('match.opponent', User, 'opponent', 'opponent.username = match.opponentUsername')
      .select([
        'match.id',
        'match.matchId',
        'match.result',
        'match.mode',
        'match.opponentUsername',
        'match.durationSeconds',
        'match.createdAt',
        'user.id',
        'user.username',
        'user.avatarUrl',
        'opponent.id',
        'opponent.username',
        'opponent.avatarUrl'
      ]);

    if (modeFilter && modeFilter !== 'all') {
      if (modeFilter === '4-FFA' || modeFilter === '4way') {
        queryBuilder.andWhere('match.mode IN (:...modes)', { modes: ['4-FFA', '4way'] });
      } else if (modeFilter === '6-FFA' || modeFilter === '6way') {
        queryBuilder.andWhere('match.mode IN (:...modes)', { modes: ['6-FFA', '6way'] });
      } else if (modeFilter === '1v1') {
        queryBuilder.andWhere('(match.mode = :mode OR match.mode IS NULL)', { mode: modeFilter });
      } else {
        queryBuilder.andWhere('match.mode = :mode', { mode: modeFilter });
      }
    }

    return paginateQueryBuilder(queryBuilder, {
      page: options?.page || 1,
      limit: options?.limit || 10,
      search: options?.search,
      searchFields: ['match.matchId', 'user.username', 'match.opponentUsername'],
      sortBy: options?.sortBy ? `match.${options.sortBy}` : 'match.createdAt',
      sortOrder: options?.sortOrder || 'DESC'
    });
  }
}
