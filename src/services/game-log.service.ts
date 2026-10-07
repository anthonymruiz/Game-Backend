import { container, singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import type { BadgeEvent } from '../models/badge.enum.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';
import { IRoomPlayer } from './room.service.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { RankTier } from '../models/rank-tier.entity.js';
import { getLevelProgress, getTotalXpForLevel } from './level-progression.service.js';
import type { IRewardsSettings } from './rewards-settings.service.js';
import type { IBadgeEvent } from './badge.service.js';

export interface IMatchRewards {
  points: number;
  xp: number;
  winPoints?: number;
  levelsGained?: number;
  level?: number;
  levelUpPoints?: number;
  ranksGained?: number;
  rankUpPoints?: number;
}

interface IProgressionRewardBreakdown {
  levelsGained: number;
  level: number;
  levelUpPoints: number;
  ranksGained: number;
  rankUpPoints: number;
}

export function calculateProgressionRewardBreakdown(
  previousXp: number,
  updatedXp: number,
  progressionConfig: Pick<LevelProgressionConfig, 'baseXpPerLevel' | 'exponentialMultiplier' | 'maxLevel'>,
  rewardsConfig: Pick<IRewardsSettings, 'pointsPerLevelUp' | 'pointsPerRankUp'>,
  rankCount: number
): IProgressionRewardBreakdown {
  const levelConfig = {
    baseXpPerLevel: progressionConfig.baseXpPerLevel,
    exponentialMultiplier: Number(progressionConfig.exponentialMultiplier),
    maxLevel: progressionConfig.maxLevel
  };
  const previousLevel = getLevelProgress(previousXp, levelConfig).level;
  const updatedLevel = getLevelProgress(updatedXp, levelConfig).level;
  const levelsGained = updatedLevel - previousLevel;
  let ranksGained = 0;

  if (rewardsConfig.pointsPerRankUp <= 0 || rankCount < 2) {
    return {
      levelsGained,
      level: updatedLevel,
      levelUpPoints: levelsGained * rewardsConfig.pointsPerLevelUp,
      ranksGained,
      rankUpPoints: 0
    };
  }

  const xpPerRank = getTotalXpForLevel(levelConfig.maxLevel, levelConfig) / rankCount;
  const rankIndexForXp = (xp: number): number => {
    let index = 0;
    for (let candidate = 1; candidate < rankCount; candidate++) {
      if (xp < Math.round(candidate * xpPerRank)) break;
      index = candidate;
    }
    return index;
  };
  ranksGained = Math.max(0, rankIndexForXp(updatedXp) - rankIndexForXp(previousXp));
  return {
    levelsGained,
    level: updatedLevel,
    levelUpPoints: levelsGained * rewardsConfig.pointsPerLevelUp,
    ranksGained,
    rankUpPoints: ranksGained * rewardsConfig.pointsPerRankUp
  };
}

export function calculateProgressionRewardPoints(
  previousXp: number,
  updatedXp: number,
  progressionConfig: Pick<LevelProgressionConfig, 'baseXpPerLevel' | 'exponentialMultiplier' | 'maxLevel'>,
  rewardsConfig: Pick<IRewardsSettings, 'pointsPerLevelUp' | 'pointsPerRankUp'>,
  rankCount: number
): number {
  const breakdown = calculateProgressionRewardBreakdown(
    previousXp,
    updatedXp,
    progressionConfig,
    rewardsConfig,
    rankCount
  );
  return breakdown.levelUpPoints + breakdown.rankUpPoints;
}

export function hasBotPlayers(players: (string | IRoomPlayer)[]): boolean {
  return players.some(player => {
    if (typeof player === 'string') return player.startsWith('bot_');
    return player.isBot === true ||
      player.id.startsWith('bot_') ||
      player.username.toLowerCase().startsWith('bot');
  });
}

@singleton()
export class GameLogService {
  public async logGameEnd(
    matchId: string, 
    winnerId: string | null, 
    allPlayers: (string | IRoomPlayer)[], 
    mode: string = '1v1',
    durationSeconds?: number,
    isRanked: boolean = false,
    abandoned: boolean = false
  ): Promise<Record<string, IMatchRewards>> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const rewardsByPlayer: Record<string, IMatchRewards> = {};
    const badgeEventsByPlayer = new Map<string, IBadgeEvent[]>();

    try {
      const roomPlayers: IRoomPlayer[] = allPlayers.map(p => {
        if (typeof p === 'string') {
          return { id: p, username: p, isGuest: p.startsWith('guest_') || p.startsWith('bot_'), color: '#000000' };
        }
        return p;
      });

      const hasBot = hasBotPlayers(roomPlayers);
      let progressionConfig: LevelProgressionConfig | null = null;
      let rewardsConfig: RewardsSettings | null = null;
      let rankTiers: RankTier[] = [];
      if (!hasBot) {
        progressionConfig = await queryRunner.manager.findOne(LevelProgressionConfig, {
          where: { singletonKey: 1 }
        });
        rewardsConfig = await queryRunner.manager.findOne(RewardsSettings, {
          where: { singletonKey: 1 }
        });
        if (!progressionConfig) {
          throw new Error('Level progression configuration has not been seeded.');
        }
        if (!rewardsConfig) {
          throw new Error('Rewards configuration has not been seeded.');
        }
        rankTiers = rewardsConfig.pointsPerRankUp > 0
          ? await queryRunner.manager.find(RankTier, { order: { level: 'ASC' } })
          : [];
      }

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
        history.xpAwarded = 0;
        history.opponentUsername = opponentUsername;
        if (durationSeconds !== undefined) {
          history.durationSeconds = durationSeconds;
        }

        let isWin = false;
        if (!abandoned && winnerId !== null) {
          if (mode === '2v2' && winningTeam !== undefined && player.team !== undefined) {
            isWin = player.team === winningTeam;
          } else {
            isWin = winnerId === playerId;
          }
        }

        const badgeEvents: IBadgeEvent[] = abandoned || hasBot ? [] : [{ event: 'match_played' }];
        if (isWin) {
          if (hasBot) badgeEvents.push({ event: 'bot_win' });
          else badgeEvents.push({ event: 'match_win' });
          const modeWinEvents: Record<string, BadgeEvent> = {
            '1v1': 'win_1v1',
            '2v2': 'win_2v2',
            '4-FFA': 'win_4ffa',
            '6-FFA': 'win_6ffa'
          };
          if (modeWinEvents[mode] && (!hasBot || mode !== '1v1')) {
            badgeEvents.push({ event: modeWinEvents[mode] });
          }
        }
        badgeEventsByPlayer.set(user.id, badgeEvents);

        if (hasBot) {
          history.result = isWin ? 'win' : abandoned || winnerId !== null ? 'loss' : 'draw';
          await queryRunner.manager.save(history);
          rewardsByPlayer[user.id] = { points: 0, xp: 0 };
          continue;
        }

        if (!progressionConfig || !rewardsConfig) {
          throw new Error('Match statistics configuration is unavailable.');
        }
        let stats = user.stats;
        if (!stats) {
          stats = new Stats();
          await queryRunner.manager.save(stats);
          user.stats = stats;
          await queryRunner.manager.save(user);
        }
        let isDraw = false;

        if (abandoned || winnerId === null) {
          isDraw = true;
        }

        if (isWin) {
          history.result = 'win';
          stats.wins = (stats.wins || 0) + 1;
          if (!hasBot) {
            const pointsForWin = isRanked
              ? rewardsConfig.rankedPointsPerWin
              : rewardsConfig.pointsPerWin;
            const previousXp = Math.max(0, stats.xp || 0);
            const awardedXp = progressionConfig.baseXpPerLevel;
            history.xpAwarded = awardedXp;
            const updatedXp = previousXp + awardedXp;
            const progressionReward = calculateProgressionRewardBreakdown(
              previousXp,
              updatedXp,
              progressionConfig,
              rewardsConfig,
              rankTiers.length
            );
            const pointsAwarded = pointsForWin +
              progressionReward.levelUpPoints +
              progressionReward.rankUpPoints;
            stats.points = (stats.points || 0) + pointsAwarded;
            stats.xp = updatedXp;
            rewardsByPlayer[user.id] = {
              points: pointsAwarded,
              xp: awardedXp,
              winPoints: pointsForWin,
              ...progressionReward
            };
          } else {
            rewardsByPlayer[user.id] = { points: 0, xp: 0 };
          }
        } else if (isDraw) {
          history.result = 'draw';
          stats.draws = (stats.draws || 0) + 1;
          rewardsByPlayer[user.id] = { points: 0, xp: 0 };
        } else {
          history.result = 'loss';
          stats.losses = (stats.losses || 0) + 1;
          rewardsByPlayer[user.id] = { points: 0, xp: 0 };
        }

        if (progressionConfig) {
          badgeEvents.push({
            event: 'level_reached',
            amount: getLevelProgress(stats.xp || 0, progressionConfig).level,
            operation: 'max'
          });
        }
        await queryRunner.manager.save(stats);
        await queryRunner.manager.save(history);
      }

      await queryRunner.commitTransaction();

      try {
        await this.recordMatchBadges(badgeEventsByPlayer, roomPlayers);
      } catch (error) {
        console.error(`Failed to record badge events for match ${matchId}:`, error);
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

  private async recordMatchBadges(
    eventsByPlayer: Map<string, IBadgeEvent[]>,
    roomPlayers: IRoomPlayer[]
  ): Promise<void> {
    if (!eventsByPlayer.size) return;
    const [{ Badge }, { Friendship }, { FriendshipStatus }, { BadgeService }] = await Promise.all([
      import('../models/badge.entity.js'),
      import('../models/friendship.entity.js'),
      import('../models/friendship-status.enum.js'),
      import('./badge.service.js')
    ]);
    const badgeService = container.resolve(BadgeService);
    const historyRepository = AppDataSource.getRepository(MatchHistory);
    const friendshipRepository = AppDataSource.getRepository(Friendship);
    const maxStreakBadge = await AppDataSource.getRepository(Badge).findOne({
      where: { event: 'win_streak', isActive: true },
      order: { target: 'DESC' }
    });

    for (const [userId, events] of eventsByPlayer) {
      try {
        const opponents = roomPlayers.filter(player => player.id !== userId).map(player => player.id);
        if (opponents.length) {
          const friendshipFilters = opponents.flatMap(opponentId => [
            {
              requester: { id: userId },
              addressee: { id: opponentId },
              status: FriendshipStatus.ACCEPTED
            },
            {
              requester: { id: opponentId },
              addressee: { id: userId },
              status: FriendshipStatus.ACCEPTED
            }
          ]);
          if (await friendshipRepository.findOne({ where: friendshipFilters })) {
            events.push({ event: 'friend_match' });
          }
        }

        if (events.some(activity => activity.event === 'match_win' || activity.event === 'bot_win') && maxStreakBadge) {
          const recentMatches = await historyRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
            take: maxStreakBadge.target
          });
          let streak = 0;
          for (const match of recentMatches) {
            if (match.result !== 'win') break;
            streak++;
          }
          events.push({ event: 'win_streak', amount: streak, operation: 'max' });
        }

        await badgeService.recordEvents(userId, events);
      } catch (error) {
        console.error(`Failed to record badge progress for player ${userId}:`, error);
      }
    }
  }
}
