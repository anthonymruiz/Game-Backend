import { Board } from './board.js';
import { Player, Wall, type Boost } from './models.js';
import { GameMode } from '../../services/matchmaking.service.js';
import { IRoomPlayer } from '../../services/room.service.js';
import { GameModeRegistry, IGameModeRules } from './game-modes.js';
import { BotReactionManager } from './bot-reaction.manager.js';
import type { BadgeEvent } from '../../models/badge.enum.js';

export interface IGameInstanceOptions {
  turnTimeLimitSeconds: number;
  maxStrikesBeforeKick: number;
}

type BoostDecisionType = 'killer_item' | 'exchange_item';

interface IPendingBoostDecision {
  playerId: string;
  type: BoostDecisionType;
  expiresAt: number;
  turnSecondsRemaining: number;
  timeout: NodeJS.Timeout | null;
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
  
  public turnTimeLimitSeconds: number;
  public maxStrikesBeforeKick: number;
  public hasSpawnedKillerItem: boolean = false;
  public hasSpawnedExchangeItem: boolean = false;

  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadlineAt: number | null = null;
  private pendingBoostDecision: IPendingBoostDecision | null = null;
  private portalTimer: NodeJS.Timeout | null = null;
  public onStateChange: (event: string, data: any) => void;
  public botReactionManager: BotReactionManager;
  public onBadgeEvent: (
    playerId: string,
    event: BadgeEvent,
    amount?: number,
    operation?: 'increment' | 'max' | 'set'
  ) => void = () => {};

  public isPrivate: boolean = false;

  constructor(
    id: string, 
    mode: GameMode, 
    roomPlayers: IRoomPlayer[], 
    onStateChange: (event: string, data: any) => void,
    options: IGameInstanceOptions,
    isPrivate: boolean = false
  ) {
    this.id = id;
    this.mode = mode;
    this.isPrivate = isPrivate;
    this.onStateChange = onStateChange;
    this.rules = GameModeRegistry.get(mode);
    this.botReactionManager = new BotReactionManager(this);

    if (!Number.isInteger(options.turnTimeLimitSeconds) ||
        options.turnTimeLimitSeconds < 10 || options.turnTimeLimitSeconds > 60) {
      throw new Error('A valid system turn time limit is required to start a game.');
    }
    if (!Number.isInteger(options.maxStrikesBeforeKick) || options.maxStrikesBeforeKick < 1) {
      throw new Error('A valid system strike limit is required to start a game.');
    }
    this.turnTimeLimitSeconds = options.turnTimeLimitSeconds;
    this.maxStrikesBeforeKick = options.maxStrikesBeforeKick;

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
        p.provider,
        p.pawnColor,
        p.pawnColorItemId,
        p.skinItemId,
        p.skinIcon,
        p.skinAllowsColor,
        p.movementTrailId,
        p.movementTrailIcon,
        p.wallEffectId,
        p.wallEffectIcon
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
    if (!this.hasSpawnedExchangeItem) {
      this.board.spawnExchangeItem();
      this.hasSpawnedExchangeItem = true;
    }
    this.startTurnTimer();
    this.startBoostTimer();
    this.onStateChange('gameStarted', {
      currentTurn: this.getCurrentPlayer(),
      board: this.board.toDTO(this.getCurrentPlayer()),
      turnTimeLimitSeconds: this.turnTimeLimitSeconds,
      turnSecondsRemaining: this.turnTimeLimitSeconds
    });
    this.checkTriggerBotTurn();
  }

  private startBoostTimer() {
    if (this.portalTimer) clearInterval(this.portalTimer);
    // Every 1 minute (60,000 ms), clear active boost and spawn 1 random boost
    this.portalTimer = setInterval(() => {
      if (this.state === 'playing' && !this.pendingBoostDecision) {
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
      this.beginBoostDecision(botId, 'killer_item');
      return;
    }
    if (botPlayer && botPlayer.hasExchangeItem) {
      this.beginBoostDecision(botId, 'exchange_item');
      return;
    }

    const isTeamMode = this.mode === '2v2';
    const action = this.board.getBotAction(botId, isTeamMode);
    if (action) {
      if (action.type === 'move') {
        this.executeMove(botId, action.x, action.y);
      } else if (action.type === 'wall') {
        const wallId = `wall_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.executeWall(botId, wallId, action.x, action.y, action.isHorizontal);
      }
    } else {
      const bestMove = this.board.getBestMove(botId, isTeamMode);
      if (bestMove) {
        this.executeMove(botId, bestMove.x, bestMove.y);
      }
    }
  }

  private startTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.pendingBoostDecision || this.state !== 'playing') return;
    
    const timeoutMs = this.turnTimeLimitSeconds * 1000;
    this.turnDeadlineAt = Date.now() + timeoutMs;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.turnDeadlineAt = null;
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
    this.turnDeadlineAt = null;
  }

  public destroy() {
    this.stopTurnTimer();
    this.clearPendingBoostDecision();
    if (this.portalTimer) {
      clearInterval(this.portalTimer);
      this.portalTimer = null;
    }
    this.state = 'finished';
  }

  private handleTimeout() {
    if (this.pendingBoostDecision) return;
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
    if (this.playersList.length === 0 || this.pendingBoostDecision || this.state !== 'playing') return;

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
    this.onStateChange('turnChanged', {
      currentTurn: currentTurnPlayer,
      board: this.board.toDTO(currentTurnPlayer),
      turnTimeLimitSeconds: this.turnTimeLimitSeconds,
      turnSecondsRemaining: this.turnTimeLimitSeconds
    });
    this.checkTriggerBotTurn();
  }

  public getCurrentPlayer() {
    return this.playersList[this.currentTurnIndex];
  }

  public getRemainingTurnSeconds(): number {
    if (this.turnDeadlineAt === null) return this.turnTimeLimitSeconds;
    return Math.max(0, Math.ceil((this.turnDeadlineAt - Date.now()) / 1000));
  }

  public getPendingBoostDecision(): Omit<IPendingBoostDecision, 'timeout'> | null {
    if (!this.pendingBoostDecision) return null;
    const { timeout: _timeout, ...decision } = this.pendingBoostDecision;
    return decision;
  }

  public hasBots(): boolean {
    return this.playersList.some(playerId => playerId.startsWith('bot_'));
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
    if (this.state !== 'playing' || this.pendingBoostDecision ||
        playerId !== this.getCurrentPlayer() || !p || p.isDead) return false;
    const hadKillerItem = p.hasKillerItem;
    const hadExchangeItem = p.hasExchangeItem;
    const fromX = p.x;
    const fromY = p.y;
    const landedBoost = this.board.boosts.find(boost => boost.x === newX && boost.y === newY);
    const success = this.board.movePlayer(playerId, newX, newY);
    if (success) {
      this.onBadgeEvent(playerId, 'move_completed');
      if (landedBoost) {
        const boostEvents: Record<Boost['type'], BadgeEvent> = {
          wall_pickup: 'boost_wall',
          extra_wall: 'boost_wall',
          killer_item: 'boost_killer',
          exchange_item: 'boost_exchange',
          portal: 'portal_used'
        };
        this.onBadgeEvent(playerId, boostEvents[landedBoost.type]);
      }
      this.onStateChange('playerMoved', {
        playerId,
        fromX,
        fromY,
        newX: p.x,
        newY: p.y,
        movementTrailId: p.movementTrailId,
        movementTrailIcon: p.movementTrailIcon
      });
      this.botReactionManager.onPlayerMoved(playerId, newX, newY);
      this.checkWinCondition(playerId);
      if (this.state === 'playing') {
        if (!hadKillerItem && p.hasKillerItem) {
          this.beginBoostDecision(playerId, 'killer_item');
        } else if (!hadExchangeItem && p.hasExchangeItem) {
          this.beginBoostDecision(playerId, 'exchange_item');
        } else {
          this.nextTurn();
        }
      }
    }
    return success;
  }

  public executeWall(playerId: string, wallId: string, x: number, y: number, isHorizontal: boolean): boolean {
    const p = this.board.players.get(playerId);
    if (this.state !== 'playing' || this.pendingBoostDecision ||
        playerId !== this.getCurrentPlayer() || p?.isDead) return false;
    
    const pathLengthsBefore = new Map<string, number>();
    for (const p of this.board.players.values()) {
      pathLengthsBefore.set(p.id, this.board.getShortestPathLength(p.x, p.y, p.targetY, p.targetX, p.id));
    }

    const wall = new Wall(wallId, playerId, x, y, isHorizontal, p?.wallEffectId, p?.wallEffectIcon);
    const success = this.board.placeWall(wall);
    
    if (success) {
      this.onBadgeEvent(playerId, 'wall_placed');
      this.onStateChange('wallPlaced', { wall, wallEffectId: p?.wallEffectId });

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

  public setPlayerCosmetic(playerId: string, category: string, itemId: string | null, icon?: string): void {
    const player = this.board.players.get(playerId);
    if (!player) throw new Error('Player not found in game');
    if (category === 'MOVEMENT_TRAIL') {
      player.movementTrailId = itemId || undefined;
      player.movementTrailIcon = itemId ? icon : undefined;
    } else if (category === 'WALL_EFFECT') {
      player.wallEffectId = itemId || undefined;
      player.wallEffectIcon = itemId ? icon : undefined;
    }
    else throw new Error('Unsupported in-game cosmetic category');
  }

  private checkWinCondition(playerId: string): boolean {
    const player = this.board.players.get(playerId);
    if (!player) return false;

    if (this.rules.checkWinCondition(player, this.board)) {
      this.winner = playerId;
      if (!this.board.walls.some(wall => wall.ownerId === playerId)) {
        this.onBadgeEvent(playerId, 'win_without_walls');
      }
      this.endGame();
      return true;
    }
    return false;
  }

  public executeKillerItem(killerId: string, targetId: string): boolean {
    const decision = this.pendingBoostDecision;
    if (this.state !== 'playing' || !decision || decision.playerId !== killerId ||
        decision.type !== 'killer_item') return false;
    const killer = this.board.players.get(killerId);
    if (!killer || !killer.hasKillerItem) return false;

    if (!targetId || targetId === 'discard' || targetId === 'none') {
      killer.hasKillerItem = false;
      this.clearPendingBoostDecision();
      this.onStateChange('killerItemDiscarded', {
        killerId,
        killerUsername: killer.username,
        board: this.board.toDTO(this.getCurrentPlayer())
      });
      this.finishBoostDecision(killerId, 'killer_item', 'discarded');
      this.continueAfterBoostDecision(killerId);
      return true;
    }

    const target = this.board.players.get(targetId);
    if (!target || target.isDead || target.id === killerId) return false;

    killer.hasKillerItem = false;
    target.isDead = true;

    if (this.board.grid[target.y]?.[target.x]) {
      this.board.grid[target.y][target.x].hasPlayer = null;
    }

    this.clearPendingBoostDecision();
    this.onStateChange('playerKilled', {
      killerId,
      killerUsername: killer.username,
      targetId,
      targetUsername: target.username,
      board: this.board.toDTO(this.getCurrentPlayer())
    });
    this.finishBoostDecision(killerId, 'killer_item', 'used');

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);
    if (alive.length <= 1) {
      this.winner = alive[0]?.id || null;
      this.endGame();
    } else {
      this.continueAfterBoostDecision(killerId);
    }
    return true;
  }

  public beginBoostDecision(playerId: string, type: BoostDecisionType): boolean {
    if (this.state !== 'playing' || this.pendingBoostDecision ||
        playerId !== this.getCurrentPlayer()) return false;
    const player = this.board.players.get(playerId);
    if (!player || player.isDead ||
        (type === 'killer_item' && !player.hasKillerItem) ||
        (type === 'exchange_item' && !player.hasExchangeItem)) return false;

    if (type === 'exchange_item' && (this.mode === '1v1' || this.mode === 'vs_ai')) {
      const target = this.playersList
        .map(id => this.board.players.get(id))
        .find(candidate => candidate && candidate.id !== playerId && !candidate.isDead);
      return this.executeExchangeItem(playerId, target?.id || 'none');
    }

    if (playerId.startsWith('bot_')) {
      this.pendingBoostDecision = {
        playerId,
        type,
        expiresAt: Date.now(),
        turnSecondsRemaining: 0,
        timeout: null
      };
      const targets = Array.from(this.board.players.values())
        .filter(candidate => candidate.id !== playerId && !candidate.isDead);
      if (type === 'killer_item') {
        const target = targets[Math.floor(Math.random() * targets.length)];
        return this.executeKillerItem(playerId, target?.id || 'discard');
      }
      const target = targets[Math.floor(Math.random() * targets.length)];
      return this.executeExchangeItem(playerId, target?.id || 'none');
    }

    const remainingTurnMs = this.turnDeadlineAt === null
      ? this.turnTimeLimitSeconds * 1000
      : Math.max(0, this.turnDeadlineAt - Date.now());
    const turnSecondsRemaining = Math.ceil(remainingTurnMs / 1000);
    this.stopTurnTimer();
    const expiresAt = Date.now() + 10_000;
    const timeout = setTimeout(() => this.expireBoostDecision(), 10_000);
    if (typeof timeout.unref === 'function') timeout.unref();
    this.pendingBoostDecision = { playerId, type, expiresAt, turnSecondsRemaining, timeout };
    this.onStateChange('boostDecisionStarted', {
      playerId,
      type,
      expiresAt,
      turnSecondsRemaining,
      currentTurn: this.getCurrentPlayer(),
      board: this.board.toDTO(this.getCurrentPlayer())
    });
    return true;
  }

  public executeExchangeItem(playerId: string, targetId: string): boolean {
    const decision = this.pendingBoostDecision;
    const isAutomaticDuelExchange = !decision &&
      (this.mode === '1v1' || this.mode === 'vs_ai') &&
      playerId === this.getCurrentPlayer();
    if (this.state !== 'playing' || (!isAutomaticDuelExchange &&
        (!decision || decision.playerId !== playerId || decision.type !== 'exchange_item'))) return false;
    const exchanger = this.board.players.get(playerId);
    if (!exchanger || exchanger.isDead || !exchanger.hasExchangeItem) return false;

    if (!targetId || targetId === 'none' || targetId === 'discard') {
      exchanger.hasExchangeItem = false;
      this.clearPendingBoostDecision();
      if (decision) this.finishBoostDecision(playerId, 'exchange_item', 'discarded');
      this.continueAfterBoostDecision(playerId);
      return true;
    }

    const target = this.board.players.get(targetId);
    if (!target || target.isDead || target.id === playerId) return false;

    const exchangerFrom = { x: exchanger.x, y: exchanger.y };
    const targetFrom = { x: target.x, y: target.y };
    const exchangerCell = this.board.grid[exchangerFrom.y]?.[exchangerFrom.x];
    const targetCell = this.board.grid[targetFrom.y]?.[targetFrom.x];
    if (!exchangerCell || !targetCell ||
        exchangerCell.hasPlayer !== exchanger.id || targetCell.hasPlayer !== target.id) return false;

    exchangerCell.hasPlayer = target.id;
    targetCell.hasPlayer = exchanger.id;
    exchanger.x = targetFrom.x;
    exchanger.y = targetFrom.y;
    target.x = exchangerFrom.x;
    target.y = exchangerFrom.y;
    exchanger.hasExchangeItem = false;
    this.clearPendingBoostDecision();
    this.onStateChange('playersExchanged', {
      exchangerId: playerId,
      exchangerUsername: exchanger.username,
      targetId,
      targetUsername: target.username,
      board: this.board.toDTO(this.getCurrentPlayer())
    });
    if (decision) this.finishBoostDecision(playerId, 'exchange_item', 'used');

    if (this.checkWinCondition(playerId) || this.state !== 'playing') return true;
    if (this.checkWinCondition(targetId) || this.state !== 'playing') return true;
    this.continueAfterBoostDecision(playerId);
    return true;
  }

  private clearPendingBoostDecision(): void {
    if (this.pendingBoostDecision) {
      if (this.pendingBoostDecision.timeout) clearTimeout(this.pendingBoostDecision.timeout);
      this.pendingBoostDecision = null;
    }
  }

  private finishBoostDecision(
    playerId: string,
    type: BoostDecisionType,
    outcome: 'used' | 'discarded' | 'expired'
  ): void {
    this.onStateChange('boostDecisionResolved', {
      playerId,
      type,
      outcome,
      currentTurn: this.getCurrentPlayer(),
      board: this.board.toDTO(this.getCurrentPlayer())
    });
    if (outcome === 'expired') {
      this.onStateChange('boostDecisionExpired', { playerId, type });
    }
  }

  private expireBoostDecision(): void {
    const decision = this.pendingBoostDecision;
    if (!decision || this.state !== 'playing') return;
    const player = this.board.players.get(decision.playerId);
    if (player) {
      if (decision.type === 'killer_item') player.hasKillerItem = false;
      else player.hasExchangeItem = false;
    }
    this.pendingBoostDecision = null;
    if (decision.type === 'killer_item' && player) {
      this.onStateChange('killerItemDiscarded', {
        killerId: player.id,
        killerUsername: player.username,
        board: this.board.toDTO(this.getCurrentPlayer()),
        timedOut: true
      });
    }
    this.finishBoostDecision(decision.playerId, decision.type, 'expired');
    this.continueAfterBoostDecision(decision.playerId);
  }

  private continueAfterBoostDecision(playerId: string): void {
    if (this.state !== 'playing') return;
    const player = this.board.players.get(playerId);
    if (player && !player.isDead) {
      if (player.hasKillerItem) {
        this.beginBoostDecision(playerId, 'killer_item');
        return;
      }
      if (player.hasExchangeItem) {
        this.beginBoostDecision(playerId, 'exchange_item');
        return;
      }
    }
    this.nextTurn();
  }

  public surrender(surrenderingUserId: string) {
    if (this.state !== 'playing' || this.pendingBoostDecision) return;

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

  public abandon() {
    if (this.state !== 'playing' || this.pendingBoostDecision) return;
    this.endGame(true);
  }

  private endGame(abandoned: boolean = false) {
    this.state = 'finished';
    this.stopTurnTimer();
    this.clearPendingBoostDecision();
    if (this.portalTimer) clearInterval(this.portalTimer);
    if (abandoned) this.winner = null;
    const durationSeconds = this.startTime ? Math.max(1, Math.round((Date.now() - this.startTime) / 1000)) : 0;
    this.onStateChange('gameFinished', { winner: this.winner, durationSeconds, abandoned });
    if (!abandoned) this.botReactionManager.onGameFinished(this.winner);
  }
}
