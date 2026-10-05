import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';
import { NotificationService } from './notification.service.js';
import { container } from 'tsyringe';
import { IRoomPlayer } from './room.service.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';

export interface IMatchRewards {
  points: number;
  xp: number;
}

@singleton()
export class GameLogService {
  public async logGameEnd(
    matchId: string, 
    winnerId: string | null, 
    allPlayers: (string | IRoomPlayer)[], 
    mode: string = '1v1',
    durationSeconds?: number,
    isRanked: boolean = false
  ): Promise<Record<string, IMatchRewards>> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const notificationsToSend: Array<{ userId: string; type: string; titleKey: any; msgKey: any }> = [];
    const rewardsByPlayer: Record<string, IMatchRewards> = {};

    try {
      const progressionConfig = await queryRunner.manager.findOne(LevelProgressionConfig, {
        where: { singletonKey: 1 }
      });
      if (!progressionConfig) {
        throw new Error('Level progression configuration has not been seeded.');
      }

      const roomPlayers: IRoomPlayer[] = allPlayers.map(p => {
        if (typeof p === 'string') {
          return { id: p, username: p, isGuest: p.startsWith('guest_') || p.startsWith('bot_'), color: '#000000' };
        }
        return p;
      });

      const hasBot = roomPlayers.some(p => 
        p.id.startsWith('bot_') || 
        (p as any).isBot === true || 
        (p.username && p.username.toLowerCase().startsWith('bot'))
      );

      // Find winning team if 2v2
      let winningTeam: number | undefined = undefined;
      if (mode === '2v2' && winnerId) {
        const winnerPlayer = roomPlayers.find(p => p.id === winnerId);
        if (winnerPlayer) {
          winningTeam = winnerPlayer.team;
        }
      }

      for (const player of roomPlayers) {
        const playerId = player.id;
        if (!playerId || playerId.startsWith('bot_') || playerId.startsWith('guest_')) {
          continue;
        }

        const user = await queryRunner.manager.findOne(User, { 
          where: { id: playerId },
          relations: { stats: true }
        });

        if (!user || user.role === ('guest' as any) || user.provider === 'guest') continue;

        let stats = user.stats;
        if (!stats) {
          stats = new Stats();
          await queryRunner.manager.save(stats);
          user.stats = stats;
          await queryRunner.manager.save(user);
        }

        // Determine opponent username string
        let opponentUsername = '';
        if (mode === '2v2') {
          const opponents = roomPlayers.filter(p => p.team !== player.team);
          opponentUsername = opponents.map(p => p.username).filter(Boolean).join(', ') || 'Equipo Rival';
        } else {
          const opponents = roomPlayers.filter(p => p.id !== playerId);
          opponentUsername = opponents.map(p => p.username).filter(Boolean).join(', ') || 'Oponente';
        }

        const history = new MatchHistory();
        history.user = user;
        history.userId = user.id;
        history.matchId = matchId;
        history.mode = mode || '1v1';
        history.opponentUsername = opponentUsername;
        if (durationSeconds !== undefined) {
          history.durationSeconds = durationSeconds;
        }

        let isWin = false;
        let isDraw = false;

        if (winnerId === null) {
          isDraw = true;
        } else if (mode === '2v2' && winningTeam !== undefined && player.team !== undefined) {
          isWin = player.team === winningTeam;
        } else {
          isWin = winnerId === playerId;
        }

        if (isWin) {
          history.result = 'win';
          stats.wins = (stats.wins || 0) + 1;
          if (!hasBot) {
            const pointsAwarded = isRanked
              ? progressionConfig.rankedPointsPerMatch
              : progressionConfig.pointsPerMatch;
            stats.points = (stats.points || 0) + pointsAwarded;
            stats.xp = (stats.xp || 0) + progressionConfig.baseXpPerLevel;
            rewardsByPlayer[user.id] = {
              points: pointsAwarded,
              xp: progressionConfig.baseXpPerLevel
            };
          } else {
            rewardsByPlayer[user.id] = { points: 0, xp: 0 };
          }
          notificationsToSend.push({ userId: user.id, type: 'MATCH', titleKey: 'MATCH_WON_TITLE', msgKey: 'MATCH_WON_MSG' });
        } else if (isDraw) {
          history.result = 'draw';
          stats.draws = (stats.draws || 0) + 1;
          rewardsByPlayer[user.id] = { points: 0, xp: 0 };
        } else {
          history.result = 'loss';
          stats.losses = (stats.losses || 0) + 1;
          rewardsByPlayer[user.id] = { points: 0, xp: 0 };
          notificationsToSend.push({ userId: user.id, type: 'MATCH', titleKey: 'MATCH_LOST_TITLE', msgKey: 'MATCH_LOST_MSG' });
        }

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
      return rewardsByPlayer;
    } catch (err) {
      console.error('Error logging game end:', err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
