import { singleton, inject } from 'tsyringe';
import { GameInstance } from '../game/engine/game-instance.js';
import { GameMode } from './matchmaking.service.js';
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

  public createGame(matchId: string, mode: GameMode, players: string[]) {
    const game = new GameInstance(matchId, mode, players, (event, data) => {
      this.io.of('/game').to(matchId).emit(event, data);

      if (event === 'gameFinished') {
        this.gameLogService.logGameEnd(matchId, data.winner, players);
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
