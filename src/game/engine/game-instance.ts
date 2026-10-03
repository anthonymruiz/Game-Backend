import { Board } from './board.js';
import { Player, Wall } from './models.js';
import { GameMode } from '../../services/matchmaking.service.js';
import { IRoomPlayer } from '../../services/room.service.js';
import { GameModeRegistry, IGameModeRules } from './game-modes.js';
import { BotReactionManager } from './bot-reaction.manager.js';

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
  public startTime?: number;
  
  public turnTimeLimitSeconds: number = 30;
  public maxStrikesBeforeKick: number = 3;
  public hasSpawnedKillerItem: boolean = false;

  private turnTimer: NodeJS.Timeout | null = null;
  private portalTimer: NodeJS.Timeout | null = null;
  public onStateChange: (event: string, data: any) => void;
  public botReactionManager: BotReactionManager;

  public isPrivate: boolean = false;

  constructor(
    id: string, 
    mode: GameMode, 
    roomPlayers: IRoomPlayer[], 
    onStateChange: (event: string, data: any) => void,
    options?: IGameInstanceOptions,
    isPrivate: boolean = false
  ) {
    this.id = id;
    this.mode = mode;
    this.isPrivate = isPrivate;
    this.onStateChange = onStateChange;
    this.rules = GameModeRegistry.get(mode);
    this.botReactionManager = new BotReactionManager(this);

    if (options?.turnTimeLimitSeconds && options.turnTimeLimitSeconds >= 10 && options.turnTimeLimitSeconds <= 60) {
      this.turnTimeLimitSeconds = options.turnTimeLimitSeconds;
    }
    if (options?.maxStrikesBeforeKick && options.maxStrikesBeforeKick >= 1) {
      this.maxStrikesBeforeKick = options.maxStrikesBeforeKick;
    }

    const size = this.rules.boardSize;
    this.board = new Board(size);
    
    const teamCounts: { [team: number]: number } = { 1: 0, 2: 0 };

    roomPlayers.forEach((p, idx) => {
      this.playersList.push(p.id);

      const playerTeam = p.team !== undefined ? p.team : (idx % 2 === 0 ? 1 : 2);
      const teamMemberIndex = teamCounts[playerTeam] || 0;
      teamCounts[playerTeam] = teamMemberIndex + 1;

      const startCfg = this.rules.getPlayerStartConfig(idx, roomPlayers.length, size, playerTeam, teamMemberIndex);
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
    this.startTime = Date.now();
    if ((this.mode === '4-FFA' || this.mode === '6-FFA') && !this.hasSpawnedKillerItem) {
      this.board.spawnKillerItem();
      this.hasSpawnedKillerItem = true;
    } else {
      this.board.spawnSingleRandomBoost();
    }
    this.startTurnTimer();
    this.startBoostTimer();
    this.onStateChange('gameStarted', { currentTurn: this.getCurrentPlayer(), board: this.board.toDTO(this.getCurrentPlayer()) });
    this.botReactionManager.onTurnStarted(this.getCurrentPlayer());
    this.checkTriggerBotTurn();
  }

  private startBoostTimer() {
    if (this.portalTimer) clearInterval(this.portalTimer);
    // Every 1 minute (60,000 ms), clear active boost and spawn 1 random boost
    this.portalTimer = setInterval(() => {
      if (this.state === 'playing') {
        if ((this.mode === '4-FFA' || this.mode === '6-FFA') && !this.hasSpawnedKillerItem) {
          this.board.spawnKillerItem();
          this.hasSpawnedKillerItem = true;
        } else {
          this.board.spawnSingleRandomBoost();
        }
        const currentTurnPlayer = this.getCurrentPlayer();
        this.onStateChange('portalsRotated', {
          currentTurn: currentTurnPlayer,
          board: this.board.toDTO(currentTurnPlayer)
        });
      }
    }, 60000);
    if (this.portalTimer && typeof this.portalTimer.unref === 'function') {
      this.portalTimer.unref();
    }
  }

  private checkTriggerBotTurn() {
    const currentId = this.getCurrentPlayer();
    if (currentId && currentId.startsWith('bot_')) {
      const thinkDelay = 400 + Math.floor(Math.random() * 500);
      setTimeout(() => {
        this.executeBotTurn();
      }, thinkDelay);
    }
  }

  private executeBotTurn() {
    if (this.state !== 'playing') return;
    const botId = this.getCurrentPlayer();
    if (!botId || !botId.startsWith('bot_')) return;

    const botPlayer = this.board.players.get(botId);
    if (botPlayer && botPlayer.hasKillerItem) {
      const opponents = Array.from(this.board.players.values()).filter(p => p.id !== botId && !p.isDead);
      if (opponents.length > 0) {
        const target = opponents[Math.floor(Math.random() * opponents.length)];
        this.executeKillerItem(botId, target.id);
        return;
      }
    }

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
    if (this.portalTimer) {
      clearInterval(this.portalTimer);
      this.portalTimer = null;
    }
    this.botReactionManager.stop();
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

    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.playersList.length;
      attempts++;
      const p = this.board.players.get(this.getCurrentPlayer());
      if (p && !p.isDead) break;
    } while (attempts < this.playersList.length);

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);
    if (alive.length <= 1) {
      this.winner = alive[0]?.id || null;
      this.endGame();
      return;
    }

    this.startTurnTimer();
    this.board.ensureMinWallPickups(2);

    const currentTurnPlayer = this.getCurrentPlayer();
    this.onStateChange('turnChanged', { currentTurn: currentTurnPlayer, board: this.board.toDTO(currentTurnPlayer) });
    this.botReactionManager.onTurnStarted(currentTurnPlayer);
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
    const p = this.board.players.get(playerId);
    if (this.state !== 'playing' || playerId !== this.getCurrentPlayer() || p?.isDead) return false;
    
    const success = this.board.movePlayer(playerId, newX, newY);
    if (success) {
      this.onStateChange('playerMoved', { playerId, newX, newY });
      this.botReactionManager.onPlayerMoved(playerId, newX, newY);
      this.checkWinCondition(playerId);
      if (this.state === 'playing') this.nextTurn();
    }
    return success;
  }

  public executeWall(playerId: string, wallId: string, x: number, y: number, isHorizontal: boolean): boolean {
    const p = this.board.players.get(playerId);
    if (this.state !== 'playing' || playerId !== this.getCurrentPlayer() || p?.isDead) return false;
    
    const pathLengthsBefore = new Map<string, number>();
    for (const p of this.board.players.values()) {
      pathLengthsBefore.set(p.id, this.board.getShortestPathLength(p.x, p.y, p.targetY, p.targetX, p.id));
    }

    const wall = new Wall(wallId, playerId, x, y, isHorizontal);
    const success = this.board.placeWall(wall);
    
    if (success) {
      this.onStateChange('wallPlaced', { wall });

      const pathChanges = new Map<string, { before: number; after: number }>();
      for (const p of this.board.players.values()) {
        const before = pathLengthsBefore.get(p.id) || 0;
        const after = this.board.getShortestPathLength(p.x, p.y, p.targetY, p.targetX, p.id);
        pathChanges.set(p.id, { before, after });
      }
      this.botReactionManager.onWallPlaced(playerId, pathChanges);

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

  public executeKillerItem(killerId: string, targetId: string): boolean {
    if (this.state !== 'playing') return false;
    const killer = this.board.players.get(killerId);
    if (!killer || !killer.hasKillerItem) return false;

    killer.hasKillerItem = false;

    if (!targetId || targetId === 'discard' || targetId === 'none') {
      const currentTurn = this.getCurrentPlayer();
      this.onStateChange('killerItemDiscarded', {
        killerId,
        killerUsername: killer.username,
        board: this.board.toDTO(currentTurn)
      });
      return true;
    }

    const target = this.board.players.get(targetId);
    if (!target || target.isDead || target.id === killerId) return false;

    killer.hasKillerItem = false;
    target.isDead = true;

    if (this.board.grid[target.y]?.[target.x]) {
      this.board.grid[target.y][target.x].hasPlayer = null;
    }

    const currentTurn = this.getCurrentPlayer();
    this.onStateChange('playerKilled', {
      killerId,
      killerUsername: killer.username,
      targetId,
      targetUsername: target.username,
      board: this.board.toDTO(currentTurn)
    });

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);
    if (alive.length <= 1) {
      this.winner = alive[0]?.id || null;
      this.endGame();
    } else {
      if (currentTurn === targetId) {
        this.nextTurn();
      } else {
        this.onStateChange('turnChanged', { currentTurn, board: this.board.toDTO(currentTurn) });
      }
    }
    return true;
  }

  public surrender(surrenderingUserId: string) {
    if (this.state !== 'playing') return;

    const surrenderingPlayer = this.board.players.get(surrenderingUserId);
    if (surrenderingPlayer) {
      surrenderingPlayer.isDead = true;
    }

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);

    if (alive.length <= 1) {
      this.winner = alive[0]?.id || null;
      this.endGame();
    } else {
      if (this.getCurrentPlayer() === surrenderingUserId) {
        this.nextTurn();
      } else {
        const currentTurn = this.getCurrentPlayer();
        this.onStateChange('turnChanged', { currentTurn, board: this.board.toDTO(currentTurn) });
      }
    }
  }

  private endGame() {
    this.state = 'finished';
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const durationSeconds = this.startTime ? Math.max(1, Math.round((Date.now() - this.startTime) / 1000)) : 0;
    this.onStateChange('gameFinished', { winner: this.winner, durationSeconds });
    this.botReactionManager.onGameFinished(this.winner);
  }
}

