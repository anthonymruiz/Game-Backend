import { Board } from './board.js';
import { Player, Wall } from './models.js';
import { GameMode } from '../../services/matchmaking.service.js';

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

  constructor(id: string, mode: GameMode, players: string[], onStateChange: (event: string, data: any) => void) {
    this.id = id;
    this.mode = mode;
    this.onStateChange = onStateChange;

    const size = mode === '1v1' ? 11 : 11;
    this.board = new Board(size);
    
    players.forEach((p, idx) => {
      this.playersList.push(p);
      const isTop = idx % 2 === 0;
      const startY = isTop ? 0 : size - 1;
      const targetY = isTop ? size - 1 : 0;
      const startX = Math.floor(size / 2);
      
      const walls = mode === '1v1' ? 10 : 5;
      const playerObj = new Player(p, `Player ${idx+1}`, startX, startY, targetY, walls, 0);
      this.board.addPlayer(playerObj);
    });
  }

  public start() {
    this.state = 'playing';
    this.startTurnTimer();
    this.onStateChange('gameStarted', { currentTurn: this.getCurrentPlayer(), board: this.board });
  }

  private startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    
    this.turnTimer = setTimeout(() => {
      this.handleTimeout();
    }, 30000); // 30 seconds turn limit
  }

  private handleTimeout() {
    const pId = this.getCurrentPlayer();
    const player = this.board.players.get(pId)!;
    
    player.strikes++;
    this.onStateChange('playerStrike', { playerId: pId, strikes: player.strikes });

    if (player.strikes >= 3) {
      this.kickPlayer(pId);
    } else {
      this.nextTurn();
    }
  }

  public nextTurn() {
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.playersList.length;
    this.startTurnTimer();
    
    // Spawn boost randomly occasionally
    if (Math.random() < 0.1) {
      this.board.spawnRandomBoost();
    }

    this.onStateChange('turnChanged', { currentTurn: this.getCurrentPlayer(), board: this.board });
  }

  private getCurrentPlayer() {
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
    const player = this.board.players.get(playerId)!;
    if (player.y === player.targetY) {
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
