import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';

@singleton()
export class GameLogService {
  public async logGameEnd(matchId: string, winnerId: string | null, allPlayers: string[]): Promise<void> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const playerId of allPlayers) {
        const user = await queryRunner.manager.findOne(User, { 
          where: { id: playerId },
          relations: ['stats']
        });

        if (!user) continue;

        let stats = user.stats;
        if (!stats) {
          stats = new Stats();
          await queryRunner.manager.save(stats);
          user.stats = stats;
          await queryRunner.manager.save(user);
        }

        const history = new MatchHistory();
        history.user = user;
        history.matchId = matchId;
        
        let eloChange = 0;
        if (winnerId === playerId) {
          history.result = 'win';
          stats.wins++;
          eloChange = 15;
        } else if (winnerId === null) {
          history.result = 'draw';
          stats.draws++;
          eloChange = 0;
        } else {
          history.result = 'loss';
          stats.losses++;
          eloChange = -10;
        }

        stats.elo += eloChange;
        history.eloChange = eloChange;

        await queryRunner.manager.save(stats);
        await queryRunner.manager.save(history);
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      console.error('Error logging game end:', err);
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  }
}
