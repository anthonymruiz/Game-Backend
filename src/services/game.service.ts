import { singleton, inject, container } from 'tsyringe';
import { GameInstance } from '../game/engine/game-instance.js';
import { BadgeService } from './badge.service.js';
import { GameMode, GROUP_GAME_MODES } from './matchmaking.service.js';
import { IRoomPlayer } from './room.service.js';
import { Server } from 'socket.io';
import { GameLogService, hasBotPlayers } from './game-log.service.js';
import { SystemSettingsService } from './system-settings.service.js';

@singleton()
export class GameService {
  private activeGames: Map<string, GameInstance> = new Map();
  private io!: Server;

  constructor(
    @inject(GameLogService) private gameLogService: GameLogService,
    @inject(SystemSettingsService) private systemSettingsService: SystemSettingsService
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
    isRanked: boolean = false
  ) {
    const playerIds = roomPlayers.map(p => p.id);
    const settings = await this.systemSettingsService.getSettings();

    const game = new GameInstance(
      matchId, 
      mode, 
      roomPlayers, 
      (event, data) => {
        if (event === 'gameFinished') {
          void this.handleGameFinished(matchId, mode, roomPlayers, playerIds, isPrivate, roomName, isRanked, game, data);
        } else {
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
    game.start();
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
    this.activeGames.delete(matchId);
    data.isRanked = isRanked;
    const matchIncludesBots = hasBotPlayers(roomPlayers);
    if (mode === 'labyrinth') {
      data.rewardsByPlayer = {};
    } else if (data.abandoned && !matchIncludesBots) {
      data.rewardsByPlayer = {};
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
      const isGroupMode = mode === '2v2' || mode === '4-FFA' || mode === '6-FFA' || mode === 'labyrinth';
      const matchmakingNamespace = this.io.of('/matchmaking');

      if (!data.abandoned && isGroupMode && roomIsPrivate && humanPlayers.length >= 2) {
        const previousRoom: any = oldRoom || {
          id: matchId,
          code: '',
          name: roomName || 'Partida Privada',
          mode,
          isPrivate: roomIsPrivate,
          hostId: playerIds[0],
          players: roomPlayers,
          maxPlayers: mode === '6-FFA' || mode === 'labyrinth' ? 6 : 4,
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
