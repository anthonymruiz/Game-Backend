import { Board } from './board.js';
import { Player, Wall } from './models.js';
import { GameMode } from '../../services/matchmaking.service.js';
import { IRoomPlayer } from '../../services/room.service.js';

export class GameInstance {
  public id: string;
  public mode: GameMode;
  public board: Board;
  public playersList: string[] = [];
  public currentTurnIndex: number = 0;
  
  public state: 'waiting' | 'playing' | 'finished' = 'waiting';
  public winner: string | null = null;
  
  private turnTimer: NodeJS.Timeout | null = null;
  public onStateChange: (event: string, data: any) => void;

  constructor(id: string, mode: GameMode, roomPlayers: IRoomPlayer[], onStateChange: (event: string, data: any) => void) {
    this.id = id;
    this.mode = mode;
    this.onStateChange = onStateChange;

    const size = (mode === '1v1' || mode === 'vs_ai' || roomPlayers.length <= 2) ? 9 : 11;
    this.board = new Board(size);
    const mid = Math.floor(size / 2);
    
    roomPlayers.forEach((p, idx) => {
      this.playersList.push(p.id);

      let startX = mid;
      let startY = 0;
      let targetY: number | undefined;
      let targetX: number | undefined;

      if (idx === 0) {
        // Player 1 (Host/Human) -> Bottom side, target Top row
        startX = mid; startY = size - 1; targetY = 0;
      } else if (idx === 1) {
        // Player 2 (Opponent/Bot) -> Top side, target Bottom row
        startX = mid; startY = 0; targetY = size - 1;
      } else if (idx === 2) {
        // Left side -> Target Right
        startX = 0; startY = mid; targetX = size - 1;
      } else if (idx === 3) {
        // Right side -> Target Left
        startX = size - 1; startY = mid; targetX = 0;
      } else if (idx === 4) {
        // Top-Left corner -> Target Bottom-Right
        startX = 0; startY = 0; targetY = size - 1;
      } else if (idx === 5) {
        // Bottom-Right corner -> Target Top-Left
        startX = size - 1; startY = size - 1; targetY = 0;
      }
      
      const walls = (mode === '1v1' || mode === 'vs_ai' || roomPlayers.length <= 2) ? 10 : 5;
      const playerObj = new Player(
        p.id,
        p.username,
        p.isGuest,
        startX,
        startY,
        targetY,
        targetX,
        walls,
        0,
        p.color,
        p.team
      );
      this.board.addPlayer(playerObj);
    });
  }

  public start() {
    this.state = 'playing';
    this.startTurnTimer();
    this.onStateChange('gameStarted', { currentTurn: this.getCurrentPlayer(), board: this.board });
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

    const bestMove = this.board.getBestMove(botId);
    if (bestMove) {
      this.executeMove(botId, bestMove.x, bestMove.y);
    } else {
      const p = this.board.players.get(botId);
      if (p) {
        const neighbors = [
          { x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }
        ];
        for (const n of neighbors) {
          if (this.executeMove(botId, n.x, n.y)) break;
        }
      }
    }
  }

  private startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    
    this.turnTimer = setTimeout(() => {
      this.handleTimeout();
    }, 30000); // 30 seconds turn limit
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

    if (player.strikes >= 3) {
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

    this.onStateChange('turnChanged', { currentTurn: this.getCurrentPlayer(), board: this.board });
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

    let isWin = false;
    if (player.targetY !== undefined && player.y === player.targetY) isWin = true;
    if (player.targetX !== undefined && player.x === player.targetX) isWin = true;

    if (isWin) {
      this.winner = playerId;
      this.endGame();
    }
  }

  private endGame() {
    this.state = 'finished';
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.onStateChange('gameFinished', { winner: this.winner });
  }
}
