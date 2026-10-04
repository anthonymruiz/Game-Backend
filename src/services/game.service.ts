import { singleton, inject } from 'tsyringe';
import { GameInstance } from '../game/engine/game-instance.js';
import { GameMode, GROUP_GAME_MODES } from './matchmaking.service.js';
import { IRoomPlayer } from './room.service.js';
import { Server } from 'socket.io';
import { GameLogService } from './game-log.service.js';
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

  public async createGame(matchId: string, mode: GameMode, roomPlayers: IRoomPlayer[], isPrivate: boolean = false, roomName?: string) {
    const playerIds = roomPlayers.map(p => p.id);
    const settings = await this.systemSettingsService.getSettings();

    const game = new GameInstance(
      matchId, 
      mode, 
      roomPlayers, 
      (event, data) => {
        if (event === 'gameFinished') {
          this.gameLogService.logGameEnd(matchId, data.winner, roomPlayers, mode, data.durationSeconds);
          this.activeGames.delete(matchId);

          import('./room.service.js').then(({ RoomService }) => {
            import('tsyringe').then(({ container }) => {
              try {
                const roomService = container.resolve(RoomService);
                const oldRoom = roomService.getRoom(matchId);

                // Clean up finished room from RoomService
                if (matchId) {
                  roomService.deleteRoom(matchId);
                }

                const roomIsPrivate = isPrivate || game.isPrivate || oldRoom?.isPrivate || false;
                const humanPlayers = roomPlayers.filter(p => p && p.id && !p.id.startsWith('bot_'));
                const humanCount = humanPlayers.length;
                const isGroupMode = mode === '2v2' || mode === '4-FFA' || mode === '6-FFA';

                const mmNs = this.io.of('/matchmaking');

                // Recreate private room ONLY for group modes (2v2, 4-FFA, 6-FFA) with >= 2 human players
                if (isGroupMode && roomIsPrivate && humanCount >= 2) {
                  const dummyOldRoom: any = oldRoom || {
                    id: matchId,
                    code: '',
                    name: roomName || 'Partida Privada',
                    mode,
                    isPrivate: roomIsPrivate,
                    hostId: playerIds[0],
                    players: roomPlayers,
                    maxPlayers: mode === '2v2' || mode === '4-FFA' ? 4 : 6,
                    status: 'WAITING',
                    createdAt: new Date()
                  };

                  const newRoom = roomService.recreatePrivateLobbyRoom(dummyOldRoom, roomPlayers);

                  if (newRoom) {
                    data.autoReturnToLobby = true;
                    data.newRoomId = newRoom.id;
                    data.newRoom = newRoom;

                    mmNs.emit('publicRooms', roomService.getPublicRooms());

                    const humanIds = new Set(newRoom.players.filter(p => p && p.id && !p.id.startsWith('bot_')).map(p => p.id));
                    for (const uId of humanIds) {
                      mmNs.to(uId).emit('myActiveRoom', newRoom);
                      mmNs.to(uId).emit('roomUpdated', newRoom);
                    }
                    mmNs.to(newRoom.id).emit('roomUpdated', newRoom);
                    return;
                  }
                }

                // For 1v1 matches, public matches, or matches with < 2 humans: clear active room state for all human players
                data.autoReturnToLobby = false;
                data.newRoomId = undefined;
                data.newRoom = undefined;
                mmNs.emit('publicRooms', roomService.getPublicRooms());

                const humanIds = new Set(roomPlayers.filter(p => p && p.id && !p.id.startsWith('bot_')).map(p => p.id));
                for (const uId of humanIds) {
                  mmNs.to(uId).emit('myActiveRoom', null);
                }
              } catch (recreateErr) {
                console.error('Error recreating private room on gameFinished:', recreateErr);
              }

              this.io.of('/game').to(matchId).emit(event, data);

              import('../config/database.config.js').then(({ AppDataSource }) => {
                import('../models/user.entity.js').then(({ User }) => {
                  import('../models/presence.enum.js').then(({ PresenceStatus }) => {
                    const userRepo = AppDataSource.getRepository(User);
                    playerIds.forEach(pId => {
                      if (pId && !pId.startsWith('guest_') && !pId.startsWith('bot_')) {
                        userRepo.update(pId, { presenceStatus: PresenceStatus.ONLINE }).catch(() => {});
                      }
                    });
                  });
                });
              });
            });
          });
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

    this.activeGames.set(matchId, game);
    game.start();
  }

  public getGame(matchId: string): GameInstance | undefined {
    return this.activeGames.get(matchId);
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
