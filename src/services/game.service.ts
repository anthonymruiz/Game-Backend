import { singleton, inject } from 'tsyringe';
import { GameInstance } from '../game/engine/game-instance.js';
import { GameMode } from './matchmaking.service.js';
import { IRoomPlayer } from './room.service.js';
import { Server } from 'socket.io';
import { GameLogService } from './game-log.service.js';

@singleton()
export class GameService {
  private activeGames: Map<string, GameInstance> = new Map();
  private io!: Server;

  constructor(@inject(GameLogService) private gameLogService: GameLogService) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  public createGame(matchId: string, mode: GameMode, roomPlayers: IRoomPlayer[]) {
    const playerIds = roomPlayers.map(p => p.id);
    const game = new GameInstance(matchId, mode, roomPlayers, (event, data) => {
      this.io.of('/game').to(matchId).emit(event, data);

      if (event === 'gameFinished') {
        this.gameLogService.logGameEnd(matchId, data.winner, playerIds);
        this.activeGames.delete(matchId);
      }
    });

    this.activeGames.set(matchId, game);
    game.start();
  }

  public getGame(matchId: string): GameInstance | undefined {
    return this.activeGames.get(matchId);
  }
}
