import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { MatchHistory } from '../models/match-history.entity.js';
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

  public async save(entity: MatchHistory): Promise<MatchHistory> {
    return this.ormRepository.save(entity);
  }

  public async getPaginatedMatches(
    modeFilter?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<MatchHistory>> {
    const queryBuilder = this.ormRepository.createQueryBuilder('match')
      .leftJoinAndSelect('match.user', 'user')
      .select([
        'match.id',
        'match.matchId',
        'match.result',
        'match.mode',
        'match.opponentUsername',
        'match.eloChange',
        'match.durationSeconds',
        'match.createdAt',
        'user.id',
        'user.username'
      ]);

    if (modeFilter && modeFilter !== 'all') {
      queryBuilder.andWhere('match.mode = :mode', { mode: modeFilter });
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
