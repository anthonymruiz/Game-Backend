import { Board } from './board.js';
import { Player, Wall } from './models.js';
import { GameMode } from '../../services/matchmaking.service.js';
import { IRoomPlayer } from '../../services/room.service.js';
import { GameModeRegistry, IGameModeRules } from './game-modes.js';

export interface IGameInstanceOptions {
  turnTimeLimitSeconds?: number;
  maxStrikesBeforeKick?: number;
}

export class GameInstance {
  public id: string;
  public mode: GameMode;
  public rules: IGameModeRules;
  public board: Board;
  public playersList: string[] = [];
  public currentTurnIndex: number = 0;
  
  public state: 'waiting' | 'playing' | 'finished' = 'waiting';
  public winner: string | null = null;
  
  public turnTimeLimitSeconds: number = 30;
  public maxStrikesBeforeKick: number = 3;

  private turnTimer: NodeJS.Timeout | null = null;
  public onStateChange: (event: string, data: any) => void;

  constructor(
    id: string, 
    mode: GameMode, 
    roomPlayers: IRoomPlayer[], 
    onStateChange: (event: string, data: any) => void,
    options?: IGameInstanceOptions
  ) {
    this.id = id;
    this.mode = mode;
    this.onStateChange = onStateChange;
    this.rules = GameModeRegistry.get(mode);

    if (options?.turnTimeLimitSeconds && options.turnTimeLimitSeconds >= 10 && options.turnTimeLimitSeconds <= 60) {
      this.turnTimeLimitSeconds = options.turnTimeLimitSeconds;
    }
    if (options?.maxStrikesBeforeKick && options.maxStrikesBeforeKick >= 1) {
      this.maxStrikesBeforeKick = options.maxStrikesBeforeKick;
    }

    const size = this.rules.boardSize;
    this.board = new Board(size);
    
    roomPlayers.forEach((p, idx) => {
      this.playersList.push(p.id);

      const startCfg = this.rules.getPlayerStartConfig(idx, roomPlayers.length, size, p.team);
      const playerObj = new Player(
        p.id,
        p.username,
        p.isGuest,
        startCfg.startX,
        startCfg.startY,
        startCfg.targetY,
        startCfg.targetX,
        this.rules.wallsPerPlayer,
        0,
        p.color,
        p.team || startCfg.team,
        startCfg.startX,
        startCfg.startY,
        p.avatarUrl,
        p.provider
      );
      this.board.addPlayer(playerObj);
    });
  }

  public start() {
    this.state = 'playing';
    this.startTurnTimer();
    this.onStateChange('gameStarted', { currentTurn: this.getCurrentPlayer(), board: this.board.toDTO(this.getCurrentPlayer()) });
    this.checkTriggerBotTurn();
  }

  private checkTriggerBotTurn() {
    const currentId = this.getCurrentPlayer();
    if (currentId && currentId.startsWith('bot_')) {
      setTimeout(() => {
        this.executeBotTurn();
      }, 500);
    }
  }

  private executeBotTurn() {
    if (this.state !== 'playing') return;
    const botId = this.getCurrentPlayer();
    if (!botId || !botId.startsWith('bot_')) return;

    const action = this.board.getBotAction(botId);
    if (action) {
      if (action.type === 'move') {
        this.executeMove(botId, action.x, action.y);
      } else if (action.type === 'wall') {
        const wallId = `wall_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.executeWall(botId, wallId, action.x, action.y, action.isHorizontal);
      }
    } else {
      const bestMove = this.board.getBestMove(botId);
      if (bestMove) {
        this.executeMove(botId, bestMove.x, bestMove.y);
      }
    }
  }

  private startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    
    const timeoutMs = this.turnTimeLimitSeconds * 1000;
    this.turnTimer = setTimeout(() => {
      this.handleTimeout();
    }, timeoutMs);
    if (this.turnTimer && typeof this.turnTimer.unref === 'function') {
      this.turnTimer.unref();
    }
  }

  public stopTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  public destroy() {
    this.stopTurnTimer();
    this.state = 'finished';
  }

  private handleTimeout() {
    const pId = this.getCurrentPlayer();
    const player = this.board.players.get(pId);
    if (!player) {
      this.nextTurn();
      return;
    }
    
    player.strikes++;
    this.onStateChange('playerStrike', { playerId: pId, strikes: player.strikes });

    if (player.strikes >= this.maxStrikesBeforeKick) {
      this.kickPlayer(pId);
    } else {
      this.nextTurn();
    }
  }

  public nextTurn() {
    if (this.playersList.length === 0) return;
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.playersList.length;
    this.startTurnTimer();
    
    if (Math.random() < 0.1) {
      this.board.spawnRandomBoost();
    }

    this.onStateChange('turnChanged', { currentTurn: this.getCurrentPlayer(), board: this.board.toDTO(this.getCurrentPlayer()) });
    this.checkTriggerBotTurn();
  }

  public getCurrentPlayer() {
    return this.playersList[this.currentTurnIndex];
  }

  private kickPlayer(playerId: string) {
    this.playersList = this.playersList.filter(id => id !== playerId);
    this.board.players.delete(playerId);
    
    this.onStateChange('playerKicked', { playerId });

    if (this.playersList.length <= 1) {
      this.winner = this.playersList[0] || null;
      this.endGame();
    } else {
      if (this.currentTurnIndex >= this.playersList.length) {
        this.currentTurnIndex = 0;
      }
      this.nextTurn();
    }
  }

  public executeMove(playerId: string, newX: number, newY: number): boolean {
    if (this.state !== 'playing' || playerId !== this.getCurrentPlayer()) return false;
    
    const success = this.board.movePlayer(playerId, newX, newY);
    if (success) {
      this.onStateChange('playerMoved', { playerId, newX, newY });
      this.checkWinCondition(playerId);
      if (this.state === 'playing') this.nextTurn();
    }
    return success;
  }

  public executeWall(playerId: string, wallId: string, x: number, y: number, isHorizontal: boolean): boolean {
    if (this.state !== 'playing' || playerId !== this.getCurrentPlayer()) return false;
    
    const wall = new Wall(wallId, playerId, x, y, isHorizontal);
    const success = this.board.placeWall(wall);
    
    if (success) {
      this.onStateChange('wallPlaced', { wall });
      this.nextTurn();
    }
    return success;
  }

  private checkWinCondition(playerId: string) {
    const player = this.board.players.get(playerId);
    if (!player) return;

    if (this.rules.checkWinCondition(player, this.board)) {
      this.winner = playerId;
      this.endGame();
    }
  }

  public surrender(surrenderingUserId: string) {
    if (this.state !== 'playing') return;

    const remaining = this.playersList.filter(id => id !== surrenderingUserId);
    this.winner = remaining[0] || null;
    this.state = 'finished';
    if (this.turnTimer) clearTimeout(this.turnTimer);

    this.onStateChange('gameFinished', { winner: this.winner, surrenderedBy: surrenderingUserId });
  }

  private endGame() {
    this.state = 'finished';
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.onStateChange('gameFinished', { winner: this.winner });
  }
}
