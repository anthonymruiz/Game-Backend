import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { MazeMatchAuditState } from '../models/maze-match-audit-state.entity.js';

function isDuplicateSequenceError(error: unknown): boolean {
  const isSequenceConstraintViolation = (candidate: unknown): boolean => {
    if (typeof candidate !== 'object' || candidate === null ||
      !('code' in candidate) || candidate.code !== 'ER_DUP_ENTRY') return false;
    const message = 'sqlMessage' in candidate && typeof candidate.sqlMessage === 'string'
      ? candidate.sqlMessage
      : 'message' in candidate && typeof candidate.message === 'string'
        ? candidate.message
        : '';
    return message.includes('IDX_maze_audit_match_sequence');
  };

  return isSequenceConstraintViolation(error) ||
    (typeof error === 'object' && error !== null &&
      'driverError' in error && isSequenceConstraintViolation(error.driverError));
}

@singleton()
export class MazeAuditService {
  private readonly nextSequenceByMatch = new Map<string, number>();
  private readonly writeQueues = new Map<string, Promise<void>>();

  public recordState(matchId: string, event: string, snapshot: Record<string, unknown>): Promise<void> {
    const previousWrite = this.writeQueues.get(matchId) ?? Promise.resolve();
    const write = previousWrite.then(async () => {
      const repository = AppDataSource.getRepository(MazeMatchAuditState);
      while (true) {
        const latest = await repository.createQueryBuilder('state')
          .select('MAX(state.sequence)', 'sequence')
          .where('state.matchId = :matchId', { matchId })
          .getRawOne<{ sequence: number | string | null }>();
        const sequence = Math.max(
          this.nextSequenceByMatch.get(matchId) ?? 0,
          Number(latest?.sequence) || 0
        ) + 1;
        try {
          await repository.insert({ matchId, sequence, event, snapshot });
          this.nextSequenceByMatch.set(matchId, sequence);
          return;
        } catch (error) {
          if (!isDuplicateSequenceError(error)) throw error;
        }
      }
    });
    this.writeQueues.set(matchId, write.then(() => undefined, () => undefined));
    return write;
  }

  public async releaseMatch(matchId: string): Promise<void> {
    await this.writeQueues.get(matchId);
    this.writeQueues.delete(matchId);
    this.nextSequenceByMatch.delete(matchId);
  }

  public async getLatestMatchStates(): Promise<MazeMatchAuditState[]> {
    await Promise.all(this.writeQueues.values());
    return AppDataSource.getRepository(MazeMatchAuditState)
      .createQueryBuilder('audit')
      .innerJoin(
        queryBuilder => queryBuilder
          .select('MAX(state.sequence)', 'sequence')
          .addSelect('state.matchId', 'matchId')
          .from(MazeMatchAuditState, 'state')
          .groupBy('state.matchId'),
        'latest',
        'latest.matchId = audit.matchId AND latest.sequence = audit.sequence'
      )
      .getMany();
  }

  public async countFinishedMatches(): Promise<number> {
    await Promise.all(this.writeQueues.values());
    const row = await AppDataSource.getRepository(MazeMatchAuditState)
      .createQueryBuilder('audit')
      .select('COUNT(DISTINCT audit.matchId)', 'count')
      .where('audit.event = :event', { event: 'game_finished' })
      .getRawOne<{ count: string | number }>();
    return Number(row?.count ?? 0);
  }
}
