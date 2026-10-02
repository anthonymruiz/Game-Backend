import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';
import { NotificationService } from './notification.service.js';
import { container } from 'tsyringe';

@singleton()
export class GameLogService {
  public async logGameEnd(matchId: string, winnerId: string | null, allPlayers: string[]): Promise<void> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const notificationsToSend: Array<{ userId: string; type: string; titleKey: any; msgKey: any }> = [];

    try {
      for (const playerId of allPlayers) {
        if (!playerId || playerId.startsWith('bot_') || playerId.startsWith('guest_')) {
          continue;
        }

        const user = await queryRunner.manager.findOne(User, { 
          where: { id: playerId },
          relations: { stats: true }
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
        history.userId = user.id;
        history.matchId = matchId;

        let eloChange = 0;
        if (winnerId === playerId) {
          history.result = 'win';
          stats.wins = (stats.wins || 0) + 1;
          eloChange = 15;
          notificationsToSend.push({ userId: user.id, type: 'MATCH', titleKey: 'MATCH_WON_TITLE', msgKey: 'MATCH_WON_MSG' });
        } else if (winnerId === null) {
          history.result = 'draw';
          stats.draws = (stats.draws || 0) + 1;
          eloChange = 0;
        } else {
          history.result = 'loss';
          stats.losses = (stats.losses || 0) + 1;
          eloChange = -10;
          notificationsToSend.push({ userId: user.id, type: 'MATCH', titleKey: 'MATCH_LOST_TITLE', msgKey: 'MATCH_LOST_MSG' });
        }

        stats.elo = Math.max(0, (stats.elo || 1000) + eloChange);
        history.eloChange = eloChange;

        await queryRunner.manager.save(stats);
        await queryRunner.manager.save(history);
      }

      await queryRunner.commitTransaction();

      // Dispatch notifications outside transaction
      const notifService = container.resolve(NotificationService);
      for (const n of notificationsToSend) {
        try {
          await notifService.sendNotification(n.userId, n.type, n.titleKey, n.msgKey);
        } catch (nErr) {
          console.error('Error sending notification post-game:', nErr);
        }
      }
    } catch (err) {
      console.error('Error logging game end:', err);
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  }
}
