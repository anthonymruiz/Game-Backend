import { Board } from './board.js';
import { MazeBoard, type IMazeTrap, type MazeTrapType } from './maze-board.js';
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
type TimedBoostType = 'ghost' | 'killer_item' | 'exchange_item' | 'portal';

export const BOOST_MIN_DELAY_MS = 60_000;
export const BOOST_MAX_DELAY_MS = 120_000;
export const PLAYER_INACTIVITY_LIMIT_MS = 120_000;
export const LABYRINTH_GAME_DURATION_MS = 5 * 60_000;
export const LABYRINTH_IDLE_LIMIT_MS = 60_000;
export const LABYRINTH_RESHUFFLE_INTERVAL_MS = 30_000;
export const LABYRINTH_MIN_HUMAN_PLAYERS = 2;
export const LABYRINTH_GHOST_DURATION_MS = 5_000;
export const LABYRINTH_TRAP_COOLDOWN_MS = 60_000;
export const LABYRINTH_ICE_TRAP_DURATION_MS = 30_000;
export const LABYRINTH_SHIELD_DURATION_MS = 60_000;
const LABYRINTH_SHIELD_PICKUP_COUNT = 3;
const LABYRINTH_SHIELD_RESPAWN_MS = 30_000;
const LABYRINTH_PORTAL_JAM_DURATION_MS = 15_000;
const LABYRINTH_EXIT_SEAL_DURATION_MS = 15_000;
type MazeEndReason = 'capture' | 'timer' | 'inactivity' | 'escape' | 'surrender';

export function getRandomBoostDelayMs(random: () => number = Math.random): number {
  return BOOST_MIN_DELAY_MS
    + Math.floor(random() * (BOOST_MAX_DELAY_MS - BOOST_MIN_DELAY_MS + 1));
}

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
  public board: Board | MazeBoard;
  public playersList: string[] = [];
  public currentTurnIndex: number = 0;
  
  public state: 'waiting' | 'playing' | 'finished' = 'waiting';
  public winner: string | null = null;
  public startTime?: number;
  
  public turnTimeLimitSeconds: number;
  public maxStrikesBeforeKick: number;
  public hasSpawnedKillerItem: boolean = false;
  public hasSpawnedExchangeItem: boolean = false;
  public readonly impostorId: string | null;
  public readonly initialSabotageActions: number;
  public onPrivateStateChange: (playerId: string, event: string, data: unknown) => void = () => {};
  private readonly mazeMoveAt = new Map<string, number>();
  private readonly mazeActionsUsed = new Map<string, number>();
  private readonly mazePublicEvents: Array<{
    id: string;
    type: string;
    playerName?: string;
    targetName?: string;
    rescuerName?: string;
    pairNumber?: number;
    exitNumber?: number;
  }> = [];
  private readonly mazeWallUsed = new Set<string>();
  private readonly mazeBreakUsed = new Set<string>();
  private readonly mazeRescueUsed = new Set<string>();
  private readonly mazeExitOpenUsed = new Set<string>();
  private mazeSabotagesUsed = 0;
  private mazeGameTimer: NodeJS.Timeout | null = null;
  private mazeTimerInterval: NodeJS.Timeout | null = null;
  private mazeInactivityTimer: NodeJS.Timeout | null = null;
  private mazeLayoutChangedAt = 0;
  private mazeEndReason: MazeEndReason | null = null;
  private lastMazeGhostId: string | null = null;
  private mazeTrapCooldownUntil: Record<MazeTrapType, number> = { ice: 0, teleport: 0 };
  private mazeShieldRespawnTimers = new Set<NodeJS.Timeout>();

  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadlineAt: number | null = null;
  private pendingBoostDecision: IPendingBoostDecision | null = null;
  private timedBoostTimers = new Map<TimedBoostType, NodeJS.Timeout>();
  private playerLastActivityAt = new Map<string, number>();
  private playerInactivityTimers = new Map<string, NodeJS.Timeout>();
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
    this.board = mode === 'labyrinth' ? new MazeBoard(size) : new Board(size);
    
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
    if (mode === 'labyrinth') {
      const humanPlayers = roomPlayers.filter(player => !player.id.startsWith('bot_'));
      if (humanPlayers.length < 2) {
        throw new Error('Labyrinth requires at least two human players.');
      }
      this.impostorId = humanPlayers[Math.floor(Math.random() * humanPlayers.length)].id;
      this.initialSabotageActions = Math.max(0, humanPlayers.length - 1);
      this.getMazeBoard().generateRandomMazeWalls(undefined, Math.random, roomPlayers.length);
      this.getMazeBoard().spawnKeys(humanPlayers.length);
      this.getMazeBoard().spawnTeleports();
      this.getMazeBoard().spawnShieldPickups(LABYRINTH_SHIELD_PICKUP_COUNT);
    } else {
      this.impostorId = null;
      this.initialSabotageActions = 0;
    }
  }

  public start() {
    this.state = 'playing';
    this.startTime = Date.now();
    for (const playerId of this.playersList) {
      if (!playerId.startsWith('bot_')) this.recordPlayerActivity(playerId);
    }
    if (this.mode === 'labyrinth') {
      this.activateRandomMazeGhost();
      this.startMazeTimer();
    } else if (this.isFfaMode()) {
      this.board.spawnKillerItem();
      this.hasSpawnedKillerItem = true;
    } else {
      this.board.spawnFfaBoost('wall_pickup');
    }
    if (this.mode !== 'labyrinth') {
      this.board.spawnFfaBoost('portal');
      this.board.spawnExchangeItem();
      this.hasSpawnedExchangeItem = true;
      this.board.spawnGhostItem();
      this.startTimedBoostLifecycles();
    }
    if (this.mode !== 'labyrinth') this.startTurnTimer();
    this.onStateChange('gameStarted', {
      mode: this.mode,
      board: this.board.toDTO(this.getCurrentPlayer()),
      ...(this.mode === 'labyrinth'
        ? {
            gameTimeLimitSeconds: LABYRINTH_GAME_DURATION_MS / 1000,
            gameSecondsRemaining: LABYRINTH_GAME_DURATION_MS / 1000,
            mazeSecondsUntilChange: this.getMazeSecondsUntilChange(),
            serverTime: Date.now()
          }
        : {
            currentTurn: this.getCurrentPlayer(),
            turnTimeLimitSeconds: this.turnTimeLimitSeconds,
            turnSecondsRemaining: this.turnTimeLimitSeconds
          })
    });
    if (this.mode === 'labyrinth') this.emitPrivateMazeTrapState();
    if (this.mode !== 'labyrinth') this.checkTriggerBotTurn();
  }

  private isFfaMode(): boolean {
    return this.mode === '4-FFA' || this.mode === '6-FFA';
  }

  private isTimedBoostType(type: Boost['type']): type is TimedBoostType {
    return type === 'ghost' || type === 'killer_item' || type === 'exchange_item' || type === 'portal';
  }

  private startTimedBoostLifecycles(): void {
    const types: TimedBoostType[] = this.isFfaMode()
      ? ['ghost', 'killer_item', 'exchange_item', 'portal']
      : ['ghost', 'exchange_item', 'portal'];
    for (const type of types) {
      this.scheduleBoostLifecycle(type);
    }
  }

  private scheduleBoostLifecycle(type: TimedBoostType): void {
    if (this.board.boosts.some(boost => boost.type === type)) {
      this.scheduleTimedBoostExpiry(type);
    } else {
      this.scheduleTimedBoostRespawn(type);
    }
  }

  private scheduleTimedBoostExpiry(type: TimedBoostType): void {
    this.clearTimedBoostTimer(type);
    const timer = setTimeout(() => {
      this.timedBoostTimers.delete(type);
      if (this.state !== 'playing') return;
      if (this.board.removeBoostsOfType(type) > 0) this.broadcastBoostBoard();
      this.scheduleTimedBoostRespawn(type);
    }, getRandomBoostDelayMs());
    this.timedBoostTimers.set(type, timer);
    if (typeof timer.unref === 'function') timer.unref();
  }

  private scheduleTimedBoostRespawn(type: TimedBoostType): void {
    this.clearTimedBoostTimer(type);
    const timer = setTimeout(() => {
      this.timedBoostTimers.delete(type);
      if (this.state !== 'playing') return;
      if (this.spawnTimedBoost(type)) {
        this.broadcastBoostBoard();
        this.scheduleTimedBoostExpiry(type);
      } else {
        this.scheduleTimedBoostRespawn(type);
      }
    }, getRandomBoostDelayMs());
    this.timedBoostTimers.set(type, timer);
    if (typeof timer.unref === 'function') timer.unref();
  }

  private clearTimedBoostTimer(type: TimedBoostType): void {
    const timer = this.timedBoostTimers.get(type);
    if (timer) clearTimeout(timer);
    this.timedBoostTimers.delete(type);
  }

  private clearTimedBoostTimers(): void {
    for (const timer of this.timedBoostTimers.values()) clearTimeout(timer);
    this.timedBoostTimers.clear();
  }

  private spawnTimedBoost(type: TimedBoostType): boolean {
    switch (type) {
      case 'ghost':
        return this.board.spawnGhostItem();
      case 'killer_item':
        return this.board.spawnKillerItem();
      case 'exchange_item':
        return this.board.spawnExchangeItem();
      case 'portal':
        return this.board.spawnFfaBoost('portal');
    }
  }

  private broadcastBoostBoard(): void {
    const currentTurnPlayer = this.getCurrentPlayer();
    this.onStateChange('portalsRotated', {
      currentTurn: currentTurnPlayer,
      board: this.board.toDTO(currentTurnPlayer)
    });
  }

  private checkTriggerBotTurn() {
    if (this.mode === 'labyrinth') return;
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
    if (botPlayer?.hasReachedGoal) {
      if (botPlayer.wallsLeft > 0) {
        const action = this.board.getBotAction(botId, this.mode === '2v2');
        if (action?.type === 'wall') {
          const wallId = `wall_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          if (this.executeWall(botId, wallId, action.x, action.y, action.isHorizontal)) return;
        }
      }
      this.nextTurn();
      return;
    }
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
    this.clearPlayerInactivityTimers();
    this.clearTimedBoostTimers();
    this.clearMazeTimers();
    for (const timer of this.mazeShieldRespawnTimers) clearTimeout(timer);
    this.mazeShieldRespawnTimers.clear();
    this.state = 'finished';
  }

  private getMazeBoard(): MazeBoard {
    if (!(this.board instanceof MazeBoard)) {
      throw new Error('Labyrinth board is not available for this game mode.');
    }
    return this.board;
  }

  private startMazeTimer(): void {
    this.clearMazeTimers();
    this.scheduleMazeInactivityTimer();
    this.mazeGameTimer = setTimeout(() => {
      this.mazeGameTimer = null;
      if (this.state === 'playing') this.finishMazeGame(this.impostorId, 'timer');
    }, LABYRINTH_GAME_DURATION_MS);
    this.mazeGameTimer.unref();
    this.mazeTimerInterval = setInterval(() => {
      if (this.state !== 'playing') {
        this.clearMazeTimers();
        return;
      }
      this.onStateChange('mazeTimerUpdated', {
        gameSecondsRemaining: this.getMazeRemainingSeconds(),
        mazeSecondsUntilChange: this.getMazeSecondsUntilChange(),
        serverTime: Date.now()
      });
      const mazeStateExpired = this.expireMazePlayerEffects();
      if (mazeStateExpired) this.onStateChange('mazeStateChanged', this.getMazeStateData());
      this.emitPrivateMazeTrapState();
      this.expireMazeGhostModes();
    }, 1000);
    this.mazeTimerInterval.unref();
  }

  private clearMazeTimers(): void {
    if (this.mazeGameTimer) clearTimeout(this.mazeGameTimer);
    if (this.mazeTimerInterval) clearInterval(this.mazeTimerInterval);
    if (this.mazeInactivityTimer) clearTimeout(this.mazeInactivityTimer);
    this.mazeGameTimer = null;
    this.mazeTimerInterval = null;
    this.mazeInactivityTimer = null;
  }

  private scheduleMazeInactivityTimer(): void {
    if (this.mazeInactivityTimer) clearTimeout(this.mazeInactivityTimer);
    if (this.mode !== 'labyrinth' || this.state !== 'playing') return;
    this.mazeInactivityTimer = setTimeout(() => {
      this.mazeInactivityTimer = null;
      if (this.state === 'playing') this.finishMazeGame(this.impostorId, 'inactivity');
    }, LABYRINTH_IDLE_LIMIT_MS);
    this.mazeInactivityTimer.unref();
  }

  public getMazeRemainingSeconds(): number {
    if (!this.startTime) return LABYRINTH_GAME_DURATION_MS / 1000;
    return Math.max(0, Math.ceil((this.startTime + LABYRINTH_GAME_DURATION_MS - Date.now()) / 1000));
  }

  public getMazeGameTimeLimitSeconds(): number {
    return LABYRINTH_GAME_DURATION_MS / 1000;
  }

  public getMazeSecondsUntilChange(now: number = Date.now()): number {
    if (!this.mazeLayoutChangedAt) return 0;
    return Math.max(0, Math.ceil(
      (this.mazeLayoutChangedAt + LABYRINTH_RESHUFFLE_INTERVAL_MS - now) / 1000
    ));
  }

  public getPrivateMazeTrapState(playerId: string): {
    traps: IMazeTrap[];
    cooldowns: Record<MazeTrapType, number>;
  } | null {
    if (this.mode !== 'labyrinth' || playerId !== this.impostorId) return null;
    return {
      traps: this.getMazeBoard().traps.map(trap => ({ ...trap })),
      cooldowns: this.getMazeTrapCooldowns()
    };
  }

  private getMazeTrapCooldowns(now: number = Date.now()): Record<MazeTrapType, number> {
    return {
      ice: Math.max(0, Math.ceil((this.mazeTrapCooldownUntil.ice - now) / 1000)),
      teleport: Math.max(0, Math.ceil((this.mazeTrapCooldownUntil.teleport - now) / 1000))
    };
  }

  private emitPrivateMazeTrapState(): void {
    if (!this.impostorId) return;
    const state = this.getPrivateMazeTrapState(this.impostorId);
    if (state) this.onPrivateStateChange(this.impostorId, 'mazeTrapState', state);
  }

  private expireMazePlayerEffects(now: number = Date.now()): boolean {
    let expired = false;
    for (const player of this.board.players.values()) {
      if (player.mazeFrozenUntil > 0 && player.mazeFrozenUntil <= now) {
        player.mazeFrozenUntil = 0;
        expired = true;
      }
      if (player.mazeShieldExpiresAt > 0 && player.mazeShieldExpiresAt <= now) {
        player.mazeShieldExpiresAt = 0;
        expired = true;
      }
    }
    return expired;
  }

  private scheduleMazeShieldRespawn(): void {
    const timer = setTimeout(() => {
      this.mazeShieldRespawnTimers.delete(timer);
      if (this.state !== 'playing') return;
      this.getMazeBoard().spawnShieldPickups(LABYRINTH_SHIELD_PICKUP_COUNT);
      this.onStateChange('mazeStateChanged', this.getMazeStateData());
    }, LABYRINTH_SHIELD_RESPAWN_MS);
    timer.unref();
    this.mazeShieldRespawnTimers.add(timer);
  }

  public placeMazeTrap(playerId: string, type: MazeTrapType, x: number, y: number): boolean {
    const player = this.board.players.get(playerId);
    if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
        playerId !== this.impostorId || !player || player.isDead ||
        player.isInPrison || player.hasMazeEscaped ||
        (type !== 'ice' && type !== 'teleport') ||
        this.mazeTrapCooldownUntil[type] > Date.now() ||
        !this.getMazeBoard().canPlaceTrap(x, y)) return false;

    const trap: IMazeTrap = {
      id: `maze_trap_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      x,
      y
    };
    if (!this.getMazeBoard().placeTrap(trap)) return false;
    this.mazeTrapCooldownUntil[type] = Date.now() + LABYRINTH_TRAP_COOLDOWN_MS;
    this.recordPlayerActivity(playerId);
    this.emitPrivateMazeTrapState();
    return true;
  }

  private triggerMazeTrap(playerId: string, x: number, y: number): boolean {
    const player = this.board.players.get(playerId);
    const mazeBoard = this.getMazeBoard();
    if (!player || playerId === this.impostorId) return false;
    const trap = mazeBoard.removeTrapAt(x, y);
    if (!trap) return false;

    const shielded = player.mazeShieldExpiresAt > Date.now();
    if (shielded) player.mazeShieldExpiresAt = 0;
    if (!shielded && trap.type === 'ice') {
      player.mazeFrozenUntil = Date.now() + LABYRINTH_ICE_TRAP_DURATION_MS;
    } else if (!shielded && trap.type === 'teleport') {
      const fromX = player.x;
      const fromY = player.y;
      const destination = mazeBoard.teleportPlayerToRandomBorder(playerId);
      if (destination) {
        this.mazeMoveAt.set(playerId, Date.now());
        const newlyCaptured = this.updateMazePrisons();
        if (newlyCaptured.length) {
          this.resolveMazeCapture(this.impostorId || '', newlyCaptured);
        }
        this.onStateChange('playerMoved', {
          playerId,
          fromX,
          fromY,
          newX: destination.x,
          newY: destination.y,
          movementTrailId: player.movementTrailId,
          movementTrailIcon: player.movementTrailIcon,
          teleported: true
        });
      }
    }
    this.onStateChange('mazeTrapTriggered', {
      playerId,
      type: trap.type,
      shielded
    });
    this.emitPrivateMazeTrapState();
    return true;
  }

  public changeMazeLayout(playerId: string, random: () => number = Math.random): boolean {
    const player = this.board.players.get(playerId);
    if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
        playerId !== this.impostorId || !player || player.isDead ||
        player.isInPrison || player.hasMazeEscaped ||
        this.getMazeSecondsUntilChange() > 0) return false;
    const mazeBoard = this.getMazeBoard();
    mazeBoard.reshuffleMaze(random, true);
    this.mazeSabotagesUsed = 0;
    if (this.impostorId) {
      this.onPrivateStateChange(this.impostorId, 'mazeRole', this.getPrivateMazeRole(this.impostorId));
    }
    this.updateMazePrisons();
    this.mazeLayoutChangedAt = Date.now();
    this.recordPlayerActivity(playerId);
    this.emitMazePublicEvent('maze_changed');
    this.emitMazePublicEvent('maze_sabotages_recharged');
    this.activateRandomMazeGhost(random);
    this.onStateChange('mazeStateChanged', {
      ...this.getMazeStateData(),
      mazeSecondsUntilChange: this.getMazeSecondsUntilChange()
    });
    return true;
  }

  private handleTimeout() {
    if (this.mode === 'labyrinth') return;
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
      this.kickPlayer(pId, 'strikes');
    } else {
      this.nextTurn();
    }
  }

  public nextTurn() {
    if (this.mode === 'labyrinth' || this.playersList.length === 0 ||
        this.pendingBoostDecision || this.state !== 'playing') return;

    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.playersList.length;
      attempts++;
      const p = this.board.players.get(this.getCurrentPlayer());
      if (p && !p.isDead &&
          (this.mode !== '2v2' || !p.hasReachedGoal || p.wallsLeft > 0)) break;
    } while (attempts < this.playersList.length);

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);
    const canTakeTurn = alive.some(player =>
      this.mode !== '2v2' || !player.hasReachedGoal || player.wallsLeft > 0
    );
    if (!canTakeTurn && this.mode === '2v2') {
      this.endGame(true);
      return;
    }
    if (alive.length <= 1 && this.mode !== '2v2') {
      this.winner = alive[0]?.id || null;
      this.endGame();
      return;
    }

    this.startTurnTimer();
    if (!this.isFfaMode()) this.board.ensureMinWallPickups(2);

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
    return this.mode === 'labyrinth' ? '' : this.playersList[this.currentTurnIndex];
  }

  public getPrivateMazeRole(playerId: string): {
    role: 'impostor' | 'good';
    sabotageActionsRemaining: number;
    canBreakBlock: boolean;
    canPlaceWall: boolean;
    canRescue: boolean;
  } | null {
    if (this.mode !== 'labyrinth' || !this.playersList.includes(playerId) || playerId.startsWith('bot_')) {
      return null;
    }
    const isImpostor = playerId === this.impostorId;
    return {
      role: isImpostor ? 'impostor' : 'good',
      sabotageActionsRemaining: isImpostor
        ? Math.max(0, this.initialSabotageActions - this.mazeSabotagesUsed)
        : 0,
      canBreakBlock: !this.mazeBreakUsed.has(playerId),
      canPlaceWall: isImpostor
        ? this.mazeSabotagesUsed < this.initialSabotageActions
        : !this.mazeWallUsed.has(playerId),
      canRescue: !isImpostor && !this.mazeRescueUsed.has(playerId)
    };
  }

  public getMazeRescueStatus(): { capturedPlayers: string[]; availableRescuers: number } {
    const goodPlayers = this.playersList
      .filter(id => !id.startsWith('bot_') && id !== this.impostorId)
      .map(id => this.board.players.get(id))
      .filter((player): player is Player => !!player && !player.isDead && !player.hasMazeEscaped);
    return {
      capturedPlayers: goodPlayers.filter(player => player.isInPrison).map(player => player.id),
      availableRescuers: goodPlayers.filter(player =>
        !player.isInPrison && !this.mazeRescueUsed.has(player.id)
      ).length
    };
  }

  public getMazePublicActionCounts(): Record<string, number> {
    return Object.fromEntries(this.playersList
      .filter(playerId => !playerId.startsWith('bot_'))
      .map(playerId => [playerId, this.mazeActionsUsed.get(playerId) || 0]));
  }

  public getMazePublicEvents(): typeof this.mazePublicEvents {
    return this.mazePublicEvents.map(event => ({ ...event }));
  }

  public getMazeAuditSnapshot(): Record<string, unknown> {
    if (this.mode !== 'labyrinth' || !(this.board instanceof MazeBoard)) {
      throw new Error('Maze audit snapshots are only available for labyrinth games.');
    }
    return {
      matchId: this.id,
      mode: this.mode,
      state: this.state,
      winner: this.winner,
      impostorId: this.impostorId,
      endReason: this.mazeEndReason,
      startedAt: this.startTime ?? null,
      capturedAt: Date.now(),
      players: this.playersList.map(playerId => {
        const player = this.board.players.get(playerId);
        if (!player) throw new Error(`Maze audit player ${playerId} is missing from the board.`);
        return {
          id: player.id,
          username: player.username,
          role: player.id === this.impostorId ? 'impostor' : 'good',
          x: player.x,
          y: player.y,
          color: player.color,
          pawnColor: player.pawnColor ?? null,
          skinItemId: player.skinItemId ?? null,
          skinIcon: player.skinIcon ?? null,
          isInPrison: player.isInPrison,
          hasMazeKey: player.hasMazeKey,
          hasMazeKeyDelivered: player.hasMazeKeyDelivered,
          hasMazeEscaped: player.hasMazeEscaped,
          ghostModeExpiresAt: player.ghostModeExpiresAt
        };
      }),
      board: {
        size: this.board.size,
        extraction: this.board.extraction,
        walls: this.board.walls.map(wall => ({
          id: wall.id,
          ownerId: wall.ownerId,
          x: wall.x,
          y: wall.y,
          isHorizontal: wall.isHorizontal,
          isPrisonBlock: wall.isPrisonBlock,
          isSabotageWall: wall.isSabotageWall,
          isRescueWall: wall.isRescueWall
        })),
        keys: this.board.keys.map(key => ({ ...key })),
        exits: this.board.exits.map(exit => ({ ...exit })),
        teleports: this.board.teleports.map(teleport => ({ ...teleport }))
      },
      publicEvents: this.getMazePublicEvents(),
      publicActionCounts: this.getMazePublicActionCounts(),
      sabotageActionsUsed: this.mazeSabotagesUsed
    };
  }

  private recordMazeAction(playerId: string): void {
    this.mazeActionsUsed.set(playerId, (this.mazeActionsUsed.get(playerId) || 0) + 1);
  }

  private getMazeStateData(): {
    board: ReturnType<MazeBoard['toDTO']>;
    rescueStatus: ReturnType<GameInstance['getMazeRescueStatus']>;
    publicActionCounts: Record<string, number>;
    mazeSecondsUntilChange: number;
    mazeExitOpenUsedBy: string[];
  } {
    return {
      board: this.getMazeBoard().toDTO(),
      rescueStatus: this.getMazeRescueStatus(),
      publicActionCounts: this.getMazePublicActionCounts(),
      mazeSecondsUntilChange: this.getMazeSecondsUntilChange(),
      mazeExitOpenUsedBy: [...this.mazeExitOpenUsed]
    };
  }

  private emitMazePublicEvent(
    type: string,
    data: Omit<(typeof this.mazePublicEvents)[number], 'id' | 'type'> = {}
  ): void {
    const event = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      ...data
    };
    this.mazePublicEvents.push(event);
    this.onStateChange('mazePublicEvent', event);
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

  private kickPlayer(playerId: string, reason: 'strikes' | 'inactivity') {
    const kickedIndex = this.playersList.indexOf(playerId);
    if (kickedIndex < 0) return;
    const wasCurrentTurn = this.getCurrentPlayer() === playerId;
    if (this.pendingBoostDecision?.playerId === playerId) this.clearPendingBoostDecision();
    this.stopTrackingPlayerActivity(playerId);
    this.playersList.splice(kickedIndex, 1);
    this.board.players.delete(playerId);
    if (kickedIndex < this.currentTurnIndex) this.currentTurnIndex--;

    if (this.playersList.length <= 1 && this.mode === '2v2') {
      this.onStateChange('playerKicked', { playerId, reason });
      if (this.playersList.length === 0) {
        this.endGame(true);
      } else {
        this.currentTurnIndex = 0;
        this.nextTurn();
      }
    } else if (this.playersList.length <= 1) {
      this.onStateChange('playerKicked', { playerId, reason });
      this.winner = this.playersList[0] || null;
      this.endGame();
    } else if (wasCurrentTurn) {
      this.onStateChange('playerKicked', { playerId, reason });
      this.currentTurnIndex = (kickedIndex - 1 + this.playersList.length) % this.playersList.length;
      this.nextTurn();
    } else {
      if (this.currentTurnIndex >= this.playersList.length) this.currentTurnIndex = 0;
      const currentTurn = this.getCurrentPlayer();
      this.onStateChange('playerKicked', {
        playerId,
        reason,
        board: this.board.toDTO(currentTurn),
        ...(this.mode !== 'labyrinth'
          ? { currentTurn, turnSecondsRemaining: this.getRemainingTurnSeconds() }
          : {})
      });
    }
  }

  public recordPlayerActivity(playerId: string): void {
    if (this.state !== 'playing' || playerId.startsWith('bot_') ||
        !this.playersList.includes(playerId) ||
        (this.mode !== 'labyrinth' && this.board.players.get(playerId)?.isDead)) return;

    this.playerLastActivityAt.set(playerId, Date.now());
    if (this.mode === 'labyrinth') {
      this.scheduleMazeInactivityTimer();
      return;
    }
    this.schedulePlayerInactivityCheck(playerId);
  }

  public checkPlayerInactivity(playerId: string, now: number = Date.now()): void {
    const lastActivityAt = this.playerLastActivityAt.get(playerId);
    if (this.state !== 'playing' || lastActivityAt === undefined ||
        !this.playersList.includes(playerId)) return;

    if (now - lastActivityAt >= PLAYER_INACTIVITY_LIMIT_MS) {
      this.kickPlayer(playerId, 'inactivity');
      return;
    }

    this.schedulePlayerInactivityCheck(playerId);
  }

  private schedulePlayerInactivityCheck(playerId: string): void {
    this.clearPlayerInactivityTimer(playerId);
    const lastActivityAt = this.playerLastActivityAt.get(playerId);
    if (lastActivityAt === undefined || this.state !== 'playing') return;

    const timeout = setTimeout(() => {
      this.playerInactivityTimers.delete(playerId);
      this.checkPlayerInactivity(playerId);
    }, Math.max(0, lastActivityAt + PLAYER_INACTIVITY_LIMIT_MS - Date.now()));
    this.playerInactivityTimers.set(playerId, timeout);
    if (typeof timeout.unref === 'function') timeout.unref();
  }

  private clearPlayerInactivityTimer(playerId: string): void {
    const timer = this.playerInactivityTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.playerInactivityTimers.delete(playerId);
  }

  private stopTrackingPlayerActivity(playerId: string): void {
    this.clearPlayerInactivityTimer(playerId);
    this.playerLastActivityAt.delete(playerId);
  }

  private clearPlayerInactivityTimers(): void {
    for (const timer of this.playerInactivityTimers.values()) clearTimeout(timer);
    this.playerInactivityTimers.clear();
    this.playerLastActivityAt.clear();
  }

  public executeMove(playerId: string, newX: number, newY: number): boolean {
    if (this.mode === 'labyrinth') return this.executeMazeMove(playerId, newX, newY);
    const p = this.board.players.get(playerId);
    if (this.state !== 'playing' || this.pendingBoostDecision ||
        playerId !== this.getCurrentPlayer() || !p || p.isDead || p.hasReachedGoal) return false;
    const hadKillerItem = p.hasKillerItem;
    const hadExchangeItem = p.hasExchangeItem;
    const fromX = p.x;
    const fromY = p.y;
    const landedBoost = this.board.boosts.find(boost => boost.x === newX && boost.y === newY);
    const success = this.board.movePlayer(playerId, newX, newY);
    if (success) {
      this.onBadgeEvent(playerId, 'move_completed');
      if (landedBoost) {
        const boostEvents: Partial<Record<Boost['type'], BadgeEvent>> = {
          wall_pickup: 'boost_wall',
          extra_wall: 'boost_wall',
          killer_item: 'boost_killer',
          exchange_item: 'boost_exchange',
          portal: 'portal_used'
        };
        const badgeEvent = boostEvents[landedBoost.type];
        if (badgeEvent) this.onBadgeEvent(playerId, badgeEvent);
      }

      if (landedBoost && landedBoost.type !== 'portal' && this.isTimedBoostType(landedBoost.type)) {
        this.scheduleTimedBoostRespawn(landedBoost.type);
      }
      if (landedBoost?.type === 'ghost') {
        this.onStateChange('ghostModeActivated', {
          playerId,
          username: p.username,
          turns: 3,
          currentTurn: this.getCurrentPlayer(),
          board: this.board.toDTO(this.getCurrentPlayer())
        });
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

  private executeMazeMove(playerId: string, newX: number, newY: number): boolean {
        const player = this.board.players.get(playerId);
        const now = Date.now();
        const previousMoveAt = this.mazeMoveAt.get(playerId) ?? 0;
        if (
          this.state !== 'playing' ||
          playerId.startsWith('bot_') ||
          !player ||
          player.isDead ||
          now - previousMoveAt < 120
        ) return false;

        const fromX = player.x;
        const fromY = player.y;
        if (!this.getMazeBoard().moveMazePlayer(playerId, newX, newY)) return false;
        this.mazeMoveAt.set(playerId, now);
        this.recordPlayerActivity(playerId);
        this.updateMazePrisons();
        this.onStateChange('playerMoved', {
          playerId,
          fromX,
          fromY,
          newX,
          newY,
          movementTrailId: player.movementTrailId,
          movementTrailIcon: player.movementTrailIcon
        });
        const key = this.getMazeBoard().collectKey(playerId, newX, newY);
        if (key) {
          player.hasMazeKey = true;
          this.emitMazePublicEvent('key_collected', { playerName: player.username });
        }
        if (playerId !== this.impostorId &&
            player.mazeShieldExpiresAt <= Date.now() &&
            this.getMazeBoard().collectShieldPickupAt(player.x, player.y)) {
          player.mazeShieldExpiresAt = Date.now() + LABYRINTH_SHIELD_DURATION_MS;
          this.scheduleMazeShieldRespawn();
        }
        this.triggerMazeTrap(playerId, player.x, player.y);
        const extraction = this.getMazeBoard().extraction;
        if (player.x === extraction.x && player.y === extraction.y && player.hasMazeKey &&
            playerId === this.impostorId && !player.hasMazeKeyDelivered) {
          player.hasMazeKeyDelivered = true;
          this.emitMazePublicEvent('player_reached_extraction', { playerName: player.username });
        } else if (player.x === extraction.x && player.y === extraction.y &&
            playerId !== this.impostorId && this.getMazeBoard().deliverMazeKey(playerId)) {
          this.emitMazePublicEvent('player_reached_extraction', { playerName: player.username });
          const goodPlayers = this.playersList.filter(id =>
            !id.startsWith('bot_') && id !== this.impostorId
          );
          if (goodPlayers.every(id => this.board.players.get(id)?.hasMazeKeyDelivered)) {
            this.finishMazeGame('good', 'escape');
          }
        }
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public teleportMazePlayer(playerId: string, teleportId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' || !player ||
            playerId.startsWith('bot_')) return false;
        const fromX = player.x;
        const fromY = player.y;
        const destination = this.getMazeBoard().teleportPlayer(playerId, teleportId);
        if (!destination) return false;
        this.recordPlayerActivity(playerId);
        this.mazeMoveAt.set(playerId, Date.now());
        this.onStateChange('playerMoved', {
          playerId,
          fromX,
          fromY,
          newX: destination.x,
          newY: destination.y,
          movementTrailId: player.movementTrailId,
          movementTrailIcon: player.movementTrailIcon,
          teleported: true
        });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public jamMazeTeleport(playerId: string, teleportId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            playerId !== this.impostorId || !player || player.isInPrison ||
            player.isDead || player.hasMazeEscaped ||
            playerId.startsWith('bot_') ||
            this.mazeSabotagesUsed >= this.initialSabotageActions) return false;
        const pairNumber = this.getMazeBoard().jamTeleportPair(teleportId, LABYRINTH_PORTAL_JAM_DURATION_MS);
        if (pairNumber === null) return false;
        this.mazeSabotagesUsed++;
        this.recordMazeAction(playerId);
        this.recordPlayerActivity(playerId);
        this.onPrivateStateChange(playerId, 'mazeRole', this.getPrivateMazeRole(playerId));
        this.emitMazePublicEvent('impostor_portal_jammed', { pairNumber });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public sealMazeExit(playerId: string, exitId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            playerId !== this.impostorId || !player || player.isInPrison ||
            playerId.startsWith('bot_') ||
            this.mazeSabotagesUsed >= this.initialSabotageActions) return false;
        const exitNumber = this.getMazeBoard().sealMazeExit(exitId, LABYRINTH_EXIT_SEAL_DURATION_MS);
        if (exitNumber === null) return false;
        this.mazeSabotagesUsed++;
        this.recordMazeAction(playerId);
        this.recordPlayerActivity(playerId);
        this.onPrivateStateChange(playerId, 'mazeRole', this.getPrivateMazeRole(playerId));
        this.emitMazePublicEvent('impostor_exit_sealed', { exitNumber });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public openMazeExit(playerId: string, exitId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            !player || playerId === this.impostorId || playerId.startsWith('bot_') ||
            player.isDead || player.hasMazeEscaped || player.isInPrison ||
            this.mazeExitOpenUsed.has(playerId)) return false;
        const mazeBoard = this.getMazeBoard();
        if (!mazeBoard.canOpenMazeExitFrom(exitId, player.x, player.y)) return false;
        const exitNumber = mazeBoard.openMazeExit(exitId);
        if (exitNumber === null) return false;
        this.mazeExitOpenUsed.add(playerId);
        this.recordPlayerActivity(playerId);
        this.emitMazePublicEvent('maze_exit_opened', { exitNumber });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public placeMazeWall(playerId: string, x: number, y: number, isHorizontal: boolean, wallId: string): boolean {
        const player = this.board.players.get(playerId);
        const isImpostor = playerId === this.impostorId;
        if (this.mode !== 'labyrinth' || this.state !== 'playing' || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasMazeEscaped ||
            player.isInPrison) return false;
        if (isImpostor) {
          if (this.mazeSabotagesUsed >= this.initialSabotageActions) return false;
        } else if (this.mazeWallUsed.has(playerId)) {
          return false;
        }

        const wall = new Wall(
          wallId,
          playerId,
          x,
          y,
          isHorizontal,
          player.wallEffectId,
          player.wallEffectIcon,
          false,
          isImpostor
        );
        const mazeBoard = this.getMazeBoard();
        if (mazeBoard.wouldMakeUncollectedKeyUnreachable(wall)) return false;
        if (!isImpostor) {
          const activeGoodPlayers = [...this.board.players.values()].filter(candidate =>
            candidate.id !== this.impostorId &&
            !candidate.id.startsWith('bot_') &&
            !candidate.isDead &&
            !candidate.hasMazeEscaped &&
            !candidate.isInPrison
          );
          if (mazeBoard.wouldSeparatePlayersWithWall(wall, activeGoodPlayers.map(candidate => candidate.id)) ||
              activeGoodPlayers.some(candidate =>
                mazeBoard.wouldEnclosePlayerWithWall(wall, candidate.id)
              )) return false;
        }
        if (!mazeBoard.placeMazeWall(wall)) return false;
        this.recordPlayerActivity(playerId);
        if (isImpostor) {
          this.mazeSabotagesUsed++;
          this.onPrivateStateChange(playerId, 'mazeRole', this.getPrivateMazeRole(playerId));
        } else {
          this.mazeWallUsed.add(playerId);
        }
        this.recordMazeAction(playerId);

        const newlyCaptured = this.updateMazePrisons();
        if (isImpostor) this.emitMazePublicEvent('impostor_sabotage');
        else this.emitMazePublicEvent('player_wall_placed', { playerName: player.username });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        const capturedHumanIds = newlyCaptured.filter(id => !id.startsWith('bot_'));
        for (const capturedId of capturedHumanIds) {
          const capturedPlayer = this.board.players.get(capturedId);
          const eventType = capturedId === this.impostorId
            ? 'player_captured_impostor'
            : isImpostor ? 'impostor_captured_player' : 'player_captured_player';
          this.emitMazePublicEvent(eventType, { playerName: capturedPlayer?.username || capturedId });
        }
        if (capturedHumanIds.length > 0) this.resolveMazeCapture(playerId, capturedHumanIds);
        return true;
      }

      public breakMazeBlock(playerId: string, wallId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasMazeEscaped ||
            player.isInPrison || this.mazeBreakUsed.has(playerId)) return false;
        const mazeBoard = this.getMazeBoard();
        const target = [...this.board.players.values()].find(candidate =>
          candidate.isInPrison &&
          Math.abs(candidate.x - player.x) + Math.abs(candidate.y - player.y) <= 1 &&
          mazeBoard.getMazeReleaseWalls(candidate.id).some(wall => wall.id === wallId && wall.isSabotageWall)
        );
        if (!target) return false;
        const removedWall = mazeBoard.removeWallById(wallId);
        if (!removedWall) return false;
        this.mazeBreakUsed.add(playerId);
        this.recordMazeAction(playerId);
        this.recordPlayerActivity(playerId);
        this.updateMazePrisons();
        this.emitMazePublicEvent('player_broke_prison_wall', { playerName: player.username, targetName: target.username });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public rescueMazePlayer(rescuerId: string, targetId: string): boolean {
        const rescuer = this.board.players.get(rescuerId);
        const target = this.board.players.get(targetId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            !rescuer || !target || rescuerId === this.impostorId ||
            rescuerId.startsWith('bot_') || rescuer.isDead || rescuer.hasMazeEscaped || rescuer.isInPrison ||
            !target.isInPrison || this.mazeRescueUsed.has(rescuerId) ||
            Math.abs(target.x - rescuer.x) + Math.abs(target.y - rescuer.y) > 1) return false;

        const mazeBoard = this.getMazeBoard();
        const removedWall = mazeBoard.getMazeReleaseWalls(targetId)
          .find(wall => wall.isSabotageWall);
        if (removedWall) mazeBoard.removeWallById(removedWall.id);
        if (!removedWall) return false;

        this.mazeRescueUsed.add(rescuerId);
        this.recordMazeAction(rescuerId);
        this.recordPlayerActivity(rescuerId);
        this.updateMazePrisons();
        this.emitMazePublicEvent('player_rescued', { rescuerName: rescuer.username, playerName: target.username });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

  private activateRandomMazeGhost(random: () => number = Math.random): void {
    const players = this.playersList
      .filter(id => !id.startsWith('bot_'))
      .map(id => this.board.players.get(id))
      .filter((player): player is Player => !!player && !player.isDead && !player.hasMazeEscaped);
    if (!players.length) return;
    for (const player of players) player.ghostModeExpiresAt = 0;
    this.updateMazePrisons();
    const eligiblePlayers = players.length > 1
      ? players.filter(player => player.id !== this.lastMazeGhostId)
      : players;
    const ghost = eligiblePlayers[Math.floor(random() * eligiblePlayers.length)];
    ghost.ghostModeExpiresAt = Date.now() + LABYRINTH_GHOST_DURATION_MS;
    ghost.isInPrison = false;
    this.lastMazeGhostId = ghost.id;
    this.emitMazePublicEvent('maze_ghost_activated', { playerName: ghost.username });
    this.onStateChange('mazeStateChanged', this.getMazeStateData());
  }

  private expireMazeGhostModes(now: number = Date.now()): void {
    const expired = [...this.board.players.values()].filter(player =>
      player.ghostModeExpiresAt > 0 && player.ghostModeExpiresAt <= now
    );
    if (!expired.length) return;
    for (const player of expired) player.ghostModeExpiresAt = 0;
    this.updateMazePrisons();
    for (const player of expired) {
      this.emitMazePublicEvent('maze_ghost_ended', { playerName: player.username });
    }
    this.onStateChange('mazeStateChanged', this.getMazeStateData());
  }

  private updateMazePrisons(): string[] {
        const previouslyCaptured = new Set(
          [...this.board.players.values()].filter(player => player.isInPrison).map(player => player.id)
        );
        for (const wall of this.board.walls) wall.isPrisonBlock = false;
        for (const wall of this.board.walls) wall.isRescueWall = false;
        for (const player of this.board.players.values()) {
          if (player.id.startsWith('bot_')) {
            player.isInPrison = false;
            continue;
          }
          const mazeBoard = this.getMazeBoard();
          player.isInPrison = player.hasMazeEscaped || player.ghostModeExpiresAt > Date.now()
            ? false
            : mazeBoard.isMazePlayerEnclosed(player.id);
          if (player.isInPrison !== previouslyCaptured.has(player.id)) {
            const role = this.getPrivateMazeRole(player.id);
            this.onPrivateStateChange(player.id, 'mazeActionState', {
              canBreakBlock: role?.canBreakBlock === true,
              canPlaceWall: role?.canPlaceWall === true,
              canRescue: role?.canRescue === true,
              isInPrison: player.isInPrison
            });
          }
          if (player.isInPrison) {
            for (const wall of mazeBoard.getMazeCageWalls(player.id)) wall.isPrisonBlock = true;
            for (const wall of mazeBoard.getMazeReleaseWalls(player.id)) wall.isRescueWall = true;
          }
        }
        return [...this.board.players.values()]
          .filter(player => player.isInPrison && !previouslyCaptured.has(player.id))
          .map(player => player.id);
      }

      private resolveMazeCapture(placerId: string, capturedIds: string[]): void {
        if (this.state !== 'playing') return;
        const isImpostorPlacer = placerId === this.impostorId;
        if (!isImpostorPlacer) {
          if (capturedIds.includes(this.impostorId || '')) this.finishMazeGame('good', 'capture');
          else this.finishMazeGame(this.impostorId, 'capture');
          return;
        }
        const rescueStatus = this.getMazeRescueStatus();
        if (rescueStatus.capturedPlayers.length > rescueStatus.availableRescuers) {
          this.finishMazeGame(this.impostorId, 'capture');
        }
      }

  private finishMazeGame(winner: string | null, reason: MazeEndReason): void {
    this.winner = winner;
    this.mazeEndReason = reason;
    this.endGame();
  }

  public executeWall(playerId: string, wallId: string, x: number, y: number, isHorizontal: boolean): boolean {
    const p = this.board.players.get(playerId);
    if (this.state !== 'playing' || this.pendingBoostDecision ||
        playerId !== this.getCurrentPlayer() || !p || p.isDead || (p.wallsLeft ?? 0) <= 0) return false;
    
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
    if (!player || player.isDead) return false;

    if (this.rules.checkWinCondition(player, this.board)) {
      if (this.mode === '2v2') {
        player.hasReachedGoal = true;
        const teammates = Array.from(this.board.players.values())
          .filter(candidate => candidate.team === player.team);
        if (teammates.length !== 2 ||
            !teammates.every(teammate => teammate.hasReachedGoal && !teammate.isDead)) {
          return false;
        }
      }
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
    this.stopTrackingPlayerActivity(targetId);

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
    if (alive.length <= 1 && this.mode !== '2v2') {
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

    if (playerId.startsWith('bot_')) {
      this.pendingBoostDecision = {
        playerId,
        type,
        expiresAt: Date.now(),
        turnSecondsRemaining: 0,
        timeout: null
      };

      if (type === 'killer_item') {
        const target = this.chooseBotKillerTarget(player);
        return this.executeKillerItem(playerId, target?.id || 'discard');
      }
      const target = this.chooseBotExchangeTarget(player);
      return this.executeExchangeItem(playerId, target?.id || 'none');
    }

    if (type === 'exchange_item' && (this.mode === '1v1' || this.mode === 'vs_ai')) {
      const target = this.playersList
        .map(id => this.board.players.get(id))
        .find(candidate => candidate && candidate.id !== playerId && !candidate.isDead);
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

  private areTeammates(player: Player, candidate: Player): boolean {
    return this.mode === '2v2' && player.team !== undefined && candidate.team === player.team;
  }

  private chooseBotKillerTarget(bot: Player): Player | undefined {
    return Array.from(this.board.players.values())
      .filter(candidate => !candidate.isDead && candidate.id !== bot.id && !this.areTeammates(bot, candidate))
      .sort((a, b) => {
        const distanceDifference =
          this.board.getBotStrategicDistance(a.id, a.x, a.y) -
          this.board.getBotStrategicDistance(b.id, b.x, b.y);
        return distanceDifference || this.playersList.indexOf(a.id) - this.playersList.indexOf(b.id);
      })[0];
  }

  private chooseBotExchangeTarget(bot: Player): Player | undefined {
    return this.board.getBestBotExchangeTarget(bot.id, this.mode === '2v2')?.target;
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
    if (!target || target.isDead || target.id === playerId || this.areTeammates(exchanger, target)) return false;

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

  public surrender(surrenderingUserId: string): boolean {
    if (this.state !== 'playing' || this.pendingBoostDecision) return false;

    const surrenderingPlayer = this.board.players.get(surrenderingUserId);
    if (!surrenderingPlayer || surrenderingPlayer.isDead) return false;
    surrenderingPlayer.isDead = true;
    this.stopTrackingPlayerActivity(surrenderingUserId);

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);

    if (this.mode === 'labyrinth') {
      this.finishMazeGame(
        surrenderingUserId === this.impostorId ? 'good' : this.impostorId,
        'surrender'
      );
      return true;
    }

    if ((this.mode === '4-FFA' || this.mode === '6-FFA') &&
        !alive.some(player => !player.id.startsWith('bot_'))) {
      this.endGame(true);
      return true;
    }

    if (alive.length <= 1 && this.mode !== '2v2') {
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
    return true;
  }

  public abandon() {
    if (this.state !== 'playing' || this.pendingBoostDecision) return;
    this.endGame(true);
  }

  private endGame(abandoned: boolean = false) {
    this.state = 'finished';
    this.stopTurnTimer();
    this.clearPendingBoostDecision();
    this.clearPlayerInactivityTimers();
    this.clearTimedBoostTimers();
    this.clearMazeTimers();
    if (abandoned) this.winner = null;
    const durationSeconds = this.startTime ? Math.max(1, Math.round((Date.now() - this.startTime) / 1000)) : 0;
    this.onStateChange('gameFinished', {
      winner: this.winner,
      durationSeconds,
      abandoned,
      ...(this.mode === 'labyrinth'
        ? {
            mazeRevealedImpostorId: this.impostorId,
            mazeEndReason: this.mazeEndReason
          }
        : {})
    });
    if (!abandoned && this.mode !== 'labyrinth') this.botReactionManager.onGameFinished(this.winner);
  }
}
