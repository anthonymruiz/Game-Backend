import { singleton, inject, container } from 'tsyringe';
import { GameInstance, IMPOSTOR_MIN_HUMAN_PLAYERS } from '../game/engine/game-instance.js';
import { BadgeService } from './badge.service.js';
import { GameMode, GROUP_GAME_MODES } from './matchmaking.service.js';
import type { BadgeEvent } from '../models/badge.enum.js';
import { IRoomPlayer } from './room.service.js';
import { Server } from 'socket.io';
import { GameLogService, hasBotPlayers } from './game-log.service.js';
import { SystemSettingsService } from './system-settings.service.js';
import { ImpostorAuditService } from './impostor-audit.service.js';

@singleton()
export class GameService {
  private activeGames: Map<string, GameInstance> = new Map();
  private io!: Server;

  constructor(
    @inject(GameLogService) private gameLogService: GameLogService,
    @inject(SystemSettingsService) private systemSettingsService: SystemSettingsService,
    @inject(ImpostorAuditService) private impostorAuditService: ImpostorAuditService
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  public async createGame(
    matchId: string,
    mode: GameMode,
    roomPlayers: IRoomPlayer[],
    isPrivate: boolean = false,
    roomName?: string,
    isRanked: boolean = false,
    startImmediately: boolean = true
  ) {
    const humanPlayerCount = roomPlayers.filter(player => !player.id.startsWith('bot_')).length;
    if (mode === 'impostor' && humanPlayerCount < IMPOSTOR_MIN_HUMAN_PLAYERS) {
      throw new Error(`Impostor requires at least ${IMPOSTOR_MIN_HUMAN_PLAYERS} human players.`);
    }
    if (mode === 'infection' && roomPlayers.length < 3) {
      throw new Error('Infection requires at least three participants.');
    }
    const playerIds = roomPlayers.map(p => p.id);
    const settings = await this.systemSettingsService.getSettings();

    const game = new GameInstance(
      matchId, 
      mode, 
      roomPlayers, 
      (event, data) => {
        if (event === 'gameFinished') {
          void this.handleGameFinished(matchId, mode, roomPlayers, playerIds, isPrivate, roomName, isRanked, game, data)
            .catch(error => console.error(`Failed to finish match ${matchId}:`, error));
        } else {
          if (mode === 'infection' && (event === 'gameStarted' || event === 'impostorStateChanged')) {
            const namespace = this.io.of('/game');
            const hiddenViewPlayerId = game.playersList.find(playerId =>
              game.board.players.get(playerId)?.isInfected
            ) || '';
            const personalizedData = (playerId: string) => event === 'gameStarted'
              ? { ...data, board: game.board.toDTO(playerId) }
              : game.getImpostorStateDataForPlayer(playerId);
            namespace.to(matchId).except(game.playersList).emit(event, personalizedData(hiddenViewPlayerId));
            for (const playerId of game.playersList) {
              if (playerId.startsWith('bot_')) continue;
              namespace.to(playerId).emit(event, personalizedData(playerId));
            }
            return;
          }
          if (mode === 'impostor' && (event === 'gameStarted' || event === 'impostorStateChanged')) {
            void this.impostorAuditService.recordState(matchId, event, game.getImpostorAuditSnapshot())
              .catch(error => console.error(`Failed to save Impostor audit state for ${matchId}:`, error));
            const namespace = this.io.of('/game');
            const personalizedData = (playerId: string) => event === 'gameStarted'
              ? {
                  ...data,
                  board: game.board.toDTO(playerId, playerId === game.impostorId)
                }
              : game.getImpostorStateDataForPlayer(playerId);
            if (typeof (namespace.to(matchId) as any).except === 'function') {
              (namespace.to(matchId) as any).except(game.playersList).emit(event, personalizedData(''));
            }
            for (const playerId of game.playersList) {
              if (playerId.startsWith('bot_')) continue;
              namespace.to(playerId).emit(event, personalizedData(playerId));
            }
            return;
          }
          if (mode === 'infection' && event === 'playerMoved' &&
              game.isInfectionPlayerInvisible(data.playerId)) {
            for (const viewerId of game.playersList) {
              if (viewerId.startsWith('bot_') ||
                  !game.canViewerSeeInfectionPlayer(viewerId, data.playerId)) continue;
              this.io.of('/game').to(viewerId).emit(event, data);
            }
            return;
          }
          if (mode === 'impostor' && (event === 'gameStarted' || event === 'impostorStateChanged')) {
            void this.impostorAuditService.recordState(matchId, event, game.getImpostorAuditSnapshot())
              .catch(error => console.error(`Failed to save Impostor audit state for ${matchId}:`, error));
          }
          this.io.of('/game').to(matchId).emit(event, data);
        }
      },
      {
        turnTimeLimitSeconds: settings.turnTimeLimitSeconds,
        maxStrikesBeforeKick: settings.maxStrikesBeforeKick
      },
      isPrivate
    );
    game.onBadgeEvent = (playerId, event, amount, operation) => {
      if (playerId.startsWith('bot_') || playerId.startsWith('guest_')) return;
      try {
        void container.resolve(BadgeService).recordEvent(playerId, event, amount, operation)
          .catch(error => console.error(`Failed to record ${event} badge event for ${playerId}:`, error));
      } catch (error) {
        console.error(`Could not initialize badge tracking for ${event} event from ${playerId}:`, error);
      }
    };
    game.onPrivateStateChange = (playerId, event, data) => {
      this.io.of('/game').to(playerId).emit(event, data);
    };

    this.activeGames.set(matchId, game);
    if (mode === 'impostor') {
      void this.impostorAuditService.recordState(matchId, 'game_created', game.getImpostorAuditSnapshot())
        .catch(error => console.error(`Failed to save initial Impostor audit state for ${matchId}:`, error));
    }
    if (startImmediately) await this.startGame(matchId);
  }

  public async startGame(matchId: string): Promise<void> {
    const game = this.activeGames.get(matchId);
    if (!game) throw new Error(`Game ${matchId} has not been prepared.`);
    if (game.state === 'playing') return;
    if (game.state !== 'waiting') throw new Error(`Game ${matchId} cannot be started from ${game.state}.`);

    try {
      game.start();
    } catch (error) {
      this.activeGames.delete(matchId);
      game.destroy();
      if (game.mode === 'impostor') await this.impostorAuditService.releaseMatch(matchId);
      throw error;
    }
  }

  public async discardPreparedGame(matchId: string): Promise<void> {
    const game = this.activeGames.get(matchId);
    if (!game || game.state !== 'waiting') return;
    this.activeGames.delete(matchId);
    game.destroy();
    if (game.mode === 'impostor') await this.impostorAuditService.releaseMatch(matchId);
  }

  private async handleGameFinished(
    matchId: string,
    mode: GameMode,
    roomPlayers: IRoomPlayer[],
    playerIds: string[],
    isPrivate: boolean,
    roomName: string | undefined,
    isRanked: boolean,
    game: GameInstance,
    data: any
  ): Promise<void> {
    await this.recordModeBadgeProgress(matchId, mode, game, data);
    if (mode === 'impostor') {
      await this.impostorAuditService.recordState(matchId, 'game_finished', game.getImpostorAuditSnapshot())
        .catch(error => console.error(`Failed to save final Impostor audit state for ${matchId}:`, error));
      await this.impostorAuditService.releaseMatch(matchId)
        .catch(error => console.error(`Failed to release Impostor audit state for ${matchId}:`, error));
    }
    data.isRanked = isRanked;
    const matchIncludesBots = hasBotPlayers(roomPlayers);
    let persistAiRewardsInBackground = false;
    if (mode === 'impostor' || mode === 'infection') {
      data.rewardsByPlayer = {};
    } else if (data.abandoned && !matchIncludesBots) {
      data.rewardsByPlayer = {};
    } else if (mode === 'vs_ai' && data.abandoned) {
      data.rewardsByPlayer = {};
      persistAiRewardsInBackground = true;
    } else {
      try {
        data.rewardsByPlayer = await this.gameLogService.logGameEnd(
          matchId,
          data.winner,
          roomPlayers,
          mode,
          data.durationSeconds,
          isRanked,
          Boolean(data.abandoned)
        );
      } catch (error) {
        console.error('Failed to persist match rewards:', error);
        data.rewardsByPlayer = {};
        data.rewardsPersistenceFailed = true;
      }
    }

    try {
      const { RoomService } = await import('./room.service.js');
      const { container } = await import('tsyringe');
      const roomService = container.resolve(RoomService);
      const oldRoom = roomService.getRoom(matchId);
      roomService.deleteRoom(matchId);

      const roomIsPrivate = isPrivate || game.isPrivate || oldRoom?.isPrivate || false;
      const humanPlayers = roomPlayers.filter(player => player?.id && !player.id.startsWith('bot_'));
      const isGroupMode = mode === '2v2' || mode === 'FFA' ||
        mode === 'impostor' || mode === 'infection';
      const matchmakingNamespace = this.io.of('/matchmaking');

      if ((!data.abandoned || mode === 'impostor' || mode === 'infection') &&
          isGroupMode && roomIsPrivate && humanPlayers.length >= 2) {
        const previousRoom: any = oldRoom || {
          id: matchId,
          code: '',
          name: roomName || 'Partida Privada',
          mode,
          isPrivate: roomIsPrivate,
          hostId: playerIds[0],
          players: roomPlayers,
          maxPlayers: mode === 'FFA' || mode === 'impostor' || mode === 'infection' ? 6 : 4,
          status: 'WAITING',
          createdAt: new Date()
        };
        const newRoom = roomService.recreatePrivateLobbyRoom(previousRoom, roomPlayers);

        if (newRoom) {
          data.autoReturnToLobby = true;
          data.newRoomId = newRoom.id;
          data.newRoom = newRoom;
          matchmakingNamespace.emit('publicRooms', roomService.getPublicRooms());

          const humanIds = new Set(newRoom.players.filter(player => player?.id && !player.id.startsWith('bot_')).map(player => player.id));
          for (const userId of humanIds) {
            matchmakingNamespace.to(userId).emit('myActiveRoom', newRoom);
            matchmakingNamespace.to(userId).emit('roomUpdated', newRoom);
          }
          matchmakingNamespace.to(newRoom.id).emit('roomUpdated', newRoom);
        }
      }

      if (!data.autoReturnToLobby) {
        data.autoReturnToLobby = false;
        data.newRoomId = undefined;
        data.newRoom = undefined;
        matchmakingNamespace.emit('publicRooms', roomService.getPublicRooms());
        for (const player of humanPlayers) {
          matchmakingNamespace.to(player.id).emit('myActiveRoom', null);
        }
      }
    } catch (error) {
      console.error('Error cleaning up room after gameFinished:', error);
      data.autoReturnToLobby = false;
    }

    const matchmakingNamespace = this.io.of('/matchmaking');
    for (const player of roomPlayers) {
      if (player?.id && !player.id.startsWith('bot_')) {
        matchmakingNamespace.to(player.id).emit('roomCompleted', { roomId: matchId });
      }
    }

    this.io.of('/game').to(matchId).emit('gameFinished', data);
    this.activeGames.delete(matchId);

    if (persistAiRewardsInBackground) {
      void this.gameLogService.logGameEnd(
        matchId,
        data.winner,
        roomPlayers,
        mode,
        data.durationSeconds,
        isRanked,
        Boolean(data.abandoned)
      ).catch(error => console.error(`Failed to persist AI match rewards for ${matchId}:`, error));
    }

    try {
      const [{ AppDataSource }, { User }, { PresenceStatus }] = await Promise.all([
        import('../config/database.config.js'),
        import('../models/user.entity.js'),
        import('../models/presence.enum.js')
      ]);
      await Promise.all(playerIds
        .filter(id => id && !id.startsWith('guest_') && !id.startsWith('bot_'))
        .map(id => AppDataSource.getRepository(User).update(id, { presenceStatus: PresenceStatus.ONLINE })));
    } catch (error) {
      console.error('Error updating player presence after gameFinished:', error);
    }
  }

  private async recordModeBadgeProgress(
    matchId: string,
    mode: GameMode,
    game: GameInstance,
    data: { winner?: string | null; abandoned?: boolean }
  ): Promise<void> {
    if (data.abandoned) return;
    const awards: Array<{ playerId: string; event: BadgeEvent }> = [];
    const isEligibleUser = (playerId: string | null | undefined): playerId is string =>
      !!playerId && !playerId.startsWith('bot_') && !playerId.startsWith('guest_');

    if (mode === 'impostor' && data.winner === game.impostorId &&
        isEligibleUser(game.impostorId)) {
      awards.push({ playerId: game.impostorId, event: 'impostor_win' });
    } else if (mode === 'infection' && data.winner === 'survivors') {
      for (const playerId of game.playersList) {
        const player = game.board.players.get(playerId);
        if (isEligibleUser(playerId) && player && !player.isDead && !player.isInfected) {
          awards.push({ playerId, event: 'infection_survivor_win' });
        }
      }
    } else if (mode === 'infection' && data.winner === 'infected' &&
        isEligibleUser(game.impostorId)) {
      awards.push({ playerId: game.impostorId, event: 'infection_infector_win' });
    }

    if (!awards.length) return;
    let badgeService: BadgeService;
    try {
      badgeService = container.resolve(BadgeService);
    } catch (error) {
      console.error(`Could not initialize badge tracking for match ${matchId}:`, error);
      return;
    }
    await Promise.all(awards.map(async ({ playerId, event }) => {
      try {
        await badgeService.recordEventOnce(playerId, event, matchId);
      } catch (error) {
        console.error(`Failed to record ${event} badge event for ${playerId} in match ${matchId}:`, error);
      }
    }));
  }

  public getGame(matchId: string): GameInstance | undefined {
    return this.activeGames.get(matchId);
  }

  public getActiveGameCountsByMode(): { mode: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const game of this.activeGames.values()) {
      if (game.state === 'playing') {
        counts.set(game.mode, (counts.get(game.mode) ?? 0) + 1);
      }
    }
    return [...counts].map(([mode, count]) => ({ mode, count }));
  }

  public getGameByPlayerId(playerId: string): GameInstance | undefined {
    for (const game of this.activeGames.values()) {
      if (game.state === 'playing' && game.playersList.includes(playerId)) {
        return game;
      }
    }
    return undefined;
  }
}
