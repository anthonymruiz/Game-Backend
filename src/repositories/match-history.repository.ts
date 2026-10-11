import { injectable } from 'tsyringe';
import { Repository, SelectQueryBuilder } from 'typeorm';
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
      .select(
        `CASE
          WHEN match.mode = 'vs_ai' OR (
            match.mode = '1v1' AND LOWER(COALESCE(match.opponentUsername, '')) LIKE 'bot%'
          ) THEN 'vs_ai'
          WHEN match.mode = '2v2' THEN '2v2'
          WHEN match.mode = 'impostor' THEN 'impostor'
          WHEN match.mode = 'infection' THEN 'infection'
          WHEN match.mode = 'FFA' THEN 'FFA'
          WHEN match.mode = '1v1' OR match.mode IS NULL THEN '1v1'
          ELSE match.mode
        END`,
        'mode'
      )
      .addSelect('COUNT(DISTINCT match.matchId)', 'count')
      .groupBy('mode')
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
    return paginateQueryBuilder(this.createMatchesQuery(modeFilter, options?.search), {
      page: options?.page,
      limit: options?.limit,
      sortBy: options?.sortBy ? `match.${options.sortBy}` : 'match.createdAt',
      sortOrder: options?.sortOrder || 'DESC'
    });
  }

  public async getMatchesWindow(
    modeFilter: string | undefined,
    options: IPaginationOptions | undefined,
    skip: number,
    take: number
  ): Promise<{ data: MatchHistory[]; totalItems: number }> {
    const queryBuilder = this.createMatchesQuery(modeFilter, options?.search)
      .orderBy('match.createdAt', 'DESC')
      .skip(skip)
      .take(take);
    const [data, totalItems] = await queryBuilder.getManyAndCount();
    return { data, totalItems };
  }

  private createMatchesQuery(
    modeFilter?: string,
    search?: string
  ): SelectQueryBuilder<MatchHistory> {
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
      const normalized = modeFilter.toLowerCase();
      if (normalized === '1v1') {
        queryBuilder.andWhere(
          '(match.mode = :mode OR match.mode IS NULL) AND LOWER(COALESCE(match.opponentUsername, \'\')) NOT LIKE :botPrefix',
          { mode: '1v1', botPrefix: 'bot%' }
        );
      } else if (normalized === 'vs_ai') {
        queryBuilder.andWhere(
          '(match.mode = :mode OR (match.mode = :legacyMode AND LOWER(COALESCE(match.opponentUsername, \'\')) LIKE :botPrefix))',
          { mode: 'vs_ai', legacyMode: '1v1', botPrefix: 'bot%' }
        );
      } else if (normalized === 'ffa') {
        queryBuilder.andWhere('match.mode = :mode', { mode: 'FFA' });
      } else if (normalized === '2v2') {
        queryBuilder.andWhere('match.mode = :mode', { mode: '2v2' });
      } else if (normalized === 'impostor') {
        queryBuilder.andWhere('match.mode = :mode', { mode: 'impostor' });
      } else if (normalized === 'infection') {
        queryBuilder.andWhere('match.mode = :mode', { mode: 'infection' });
      } else {
        queryBuilder.andWhere('match.mode = :mode', { mode: modeFilter });
      }
    }

    if (search) {
      const searchTerm = `%${search.trim()}%`;
      queryBuilder.andWhere(
        '(match.matchId LIKE :search OR user.username LIKE :search OR match.opponentUsername LIKE :search)',
        { search: searchTerm }
      );
    }

    return queryBuilder;
  }
}
