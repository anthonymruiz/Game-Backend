import { singleton, inject } from 'tsyringe';
import { GameInstance } from '../game/engine/game-instance.js';
import { GameMode } from './matchmaking.service.js';
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

  public async createGame(matchId: string, mode: GameMode, roomPlayers: IRoomPlayer[]) {
    const playerIds = roomPlayers.map(p => p.id);
    const settings = await this.systemSettingsService.getSettings();

    const game = new GameInstance(
      matchId, 
      mode, 
      roomPlayers, 
      (event, data) => {
        this.io.of('/game').to(matchId).emit(event, data);

        if (event === 'gameFinished') {
          this.gameLogService.logGameEnd(matchId, data.winner, playerIds);
          this.activeGames.delete(matchId);
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
        }
      },
      {
        turnTimeLimitSeconds: settings.turnTimeLimitSeconds,
        maxStrikesBeforeKick: settings.maxStrikesBeforeKick
      }
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
