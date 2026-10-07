import { Board } from './board.js';
import { MazeBoard, type IMazeTrap, type MazeTrapType } from './maze-board.js';
import { InfectionBoard } from './infection-board.js';
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
export const LABYRINTH_GAME_DURATION_MS = 10 * 60_000;
export const LABYRINTH_IDLE_LIMIT_MS = 60_000;
export const LABYRINTH_RESHUFFLE_INTERVAL_MS = 10_000;
export const LABYRINTH_MIN_HUMAN_PLAYERS = 1;
export const LABYRINTH_GHOST_DURATION_MS = 5_000;
export const LABYRINTH_TRAP_COOLDOWN_MS = 60_000;
export const LABYRINTH_EXIT_SEAL_COOLDOWN_MS = 60_000;
export const LABYRINTH_WALL_PLACEMENT_COOLDOWN_MS = 2_000;
export const LABYRINTH_ICE_TRAP_DURATION_MS = 30_000;
export const LABYRINTH_TELEPORT_ANIMATION_MS = 1_400;
export const INFECTION_HUNT_DELAY_MS = 10_000;
export const INFECTION_SAFE_ZONE_DURATION_MS = 10_000;
export const INFECTION_SAFE_ZONE_COOLDOWN_MS = 60_000;
export const INFECTION_SAFE_ZONE_RED_DURATION_MS = INFECTION_SAFE_ZONE_COOLDOWN_MS;
export const INFECTION_MOVE_INTERVAL_MS = 80;
export const INFECTION_MIN_PLAYERS = 3;
export const INFECTION_MAX_PLAYERS = 6;
export const INFECTION_ICE_TRAP_DURATION_MS = 15_000;
export const INFECTION_RESHUFFLE_INTERVAL_MS = 60_000;
export const INFECTION_WALL_LIFETIME_MS = 15_000;
export const INFECTION_GHOST_PICKUP_COUNT = 3;
export const INFECTION_INVISIBLE_PICKUP_COUNT = 3;
export const INFECTION_INVISIBLE_DURATION_MS = 15_000;
export const INFECTION_SHIELD_PICKUP_COUNT = 3;
export const INFECTION_SHIELD_DURATION_MS = 15_000;
const LABYRINTH_SHIELD_PICKUP_COUNT = 3;
const LABYRINTH_SHIELD_RESPAWN_MS = 30_000;
type MazeEndReason = 'capture' | 'timer' | 'inactivity' | 'escape' | 'surrender' | 'infection';

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
  public onPrivateStateChange: (playerId: string, event: string, data: unknown) => void = () => {};
  private readonly mazeMoveAt = new Map<string, number>();
  private readonly mazeActionsUsed = new Map<string, number>();
  private readonly mazePublicEvents: Array<{
    id: string;
    type: string;
    playerId?: string;
    playerName?: string;
    wallX?: number;
    wallY?: number;
    wallIsHorizontal?: boolean;
    trapType?: MazeTrapType;
    shielded?: boolean;
    targetName?: string;
    rescuerName?: string;
    pairNumber?: number;
    exitNumber?: number;
  }> = [];
  private readonly mazeExitOpenUsed = new Set<string>();
  private mazeKeysDelivered = 0;
  private mazeGoodKeysDelivered = 0;
  private mazeGameTimer: NodeJS.Timeout | null = null;
  private mazeTimerInterval: NodeJS.Timeout | null = null;
  private mazeInactivityTimer: NodeJS.Timeout | null = null;
  private mazeLayoutChangedAt = 0;
  private mazeEndReason: MazeEndReason | null = null;
  private lastMazeGhostId: string | null = null;
  private mazeGhostPickupCount = 0;
  private mazeTrapCooldownUntil: Record<MazeTrapType, number> = { ice: 0, teleport: 0 };
  private readonly infectionTrapCooldownUntil = new Map<string, Record<MazeTrapType, number>>();
  private mazeWallPlacementCooldownUntil = new Map<string, number>();
  private mazeExitSealCooldownUntil = 0;
  private mazeShieldRespawnTimers = new Set<NodeJS.Timeout>();
  private readonly infectedPlayerIds = new Set<string>();
  private readonly infectionSafeZoneEnteredAt = new Map<string, number>();
  private readonly infectionSafeZoneCooldownUntil = new Map<string, number>();
  private readonly infectionSafeZoneTimers = new Map<string, NodeJS.Timeout>();
  private readonly infectionWallTimers = new Map<string, NodeJS.Timeout>();
  private infectionLastSurvivorAlertSent = false;
  private infectionHuntStarted = false;

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
    const isMazeBoardMode = mode === 'labyrinth' || mode === 'infection';
    this.board = mode === 'infection'
      ? new InfectionBoard(size)
      : mode === 'labyrinth' ? new MazeBoard(size) : new Board(size);
    
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
    if (isMazeBoardMode) {
      const humanPlayers = roomPlayers.filter(player => !player.id.startsWith('bot_'));
      if (humanPlayers.length < 1) {
        throw new Error('Labyrinth requires at least one human player.');
      }
      if (mode === 'infection' &&
          (roomPlayers.length < INFECTION_MIN_PLAYERS || roomPlayers.length > INFECTION_MAX_PLAYERS)) {
        throw new Error(`Infection requires ${INFECTION_MIN_PLAYERS}-${INFECTION_MAX_PLAYERS} participants.`);
      }
      if (mode === 'infection') {
        this.impostorId = humanPlayers[Math.floor(Math.random() * humanPlayers.length)].id;
      } else if (humanPlayers.length === 1) {
        const isImpostor = Math.random() < 0.5;
        this.impostorId = isImpostor ? humanPlayers[0].id : null;
      } else {
        this.impostorId = humanPlayers[Math.floor(Math.random() * humanPlayers.length)].id;
      }
      const goodHumanCount = humanPlayers.filter(p => p.id !== this.impostorId).length;
      if (mode === 'infection' && this.impostorId) {
        this.infectedPlayerIds.add(this.impostorId);
        const initialInfected = this.board.players.get(this.impostorId);
        if (initialInfected) initialInfected.isInfected = true;
        this.getInfectionBoard().placePlayerAtSouthEdge(this.impostorId);
      }

      this.getMazeBoard().generateRandomMazeWalls(undefined, Math.random, roomPlayers.length);
      if (mode === 'infection') {
        this.getMazeBoard().spawnTeleports();
        this.getInfectionBoard().respawnInfectionPowerups(
          INFECTION_GHOST_PICKUP_COUNT,
          INFECTION_INVISIBLE_PICKUP_COUNT,
          INFECTION_SHIELD_PICKUP_COUNT
        );
      }
      if (mode === 'labyrinth') {
        this.getMazeBoard().spawnKeys(humanPlayers.length);
        this.getMazeBoard().spawnTeleports();
        this.getMazeBoard().spawnShieldPickups(LABYRINTH_SHIELD_PICKUP_COUNT);
        this.mazeGhostPickupCount = Math.max(1, goodHumanCount);
        this.getMazeBoard().spawnGhostPickups(this.mazeGhostPickupCount);
      }
    } else {
      this.impostorId = null;
    }
  }

  public start() {
    this.state = 'playing';
    this.startTime = Date.now();
    for (const playerId of this.playersList) {
      if (!playerId.startsWith('bot_')) this.recordPlayerActivity(playerId);
    }
    if (this.isMazeBoardMode()) {
      this.startMazeTimer();
    } else if (this.isFfaMode()) {
      this.board.spawnKillerItem();
      this.hasSpawnedKillerItem = true;
    } else {
      this.board.spawnFfaBoost('wall_pickup');
    }
    if (!this.isMazeBoardMode()) {
      this.board.spawnFfaBoost('portal', this.getPortalSpawnExclusions());
      this.board.spawnExchangeItem();
      this.hasSpawnedExchangeItem = true;
      this.board.spawnGhostItem();
      this.startTimedBoostLifecycles();
    }
    if (!this.isMazeBoardMode()) this.startTurnTimer();
    this.onStateChange('gameStarted', {
      mode: this.mode,
      board: this.board.toDTO(this.getCurrentPlayer()),
      ...(this.isMazeBoardMode()
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
    if (this.isMazeBoardMode()) {
      this.onStateChange('mazeStateChanged', this.getMazeStateData());
    }
    if (this.isMazeBoardMode()) {
      this.emitPrivateMazeTrapState();
      if (this.mode === 'labyrinth' || this.mode === 'infection') this.emitMazeGhostPickups();
      if (this.mode === 'infection') {
        this.initializeInfectionSafeZones();
        this.emitInfectionState();
      }
    }
    if (!this.isMazeBoardMode()) this.checkTriggerBotTurn();
  }

  private isFfaMode(): boolean {
    return this.mode === '4-FFA' || this.mode === '6-FFA';
  }

  private isMazeBoardMode(): boolean {
    return this.mode === 'labyrinth' || this.mode === 'infection';
  }

  private getPortalSpawnExclusions(): { x: number; y: number }[] {
    if (this.mode !== '1v1' && this.mode !== 'vs_ai' && this.mode !== '2v2') return [];

    const lastCoordinate = this.board.size - 1;
    const excluded = new Map<string, { x: number; y: number }>();
    for (const player of this.board.players.values()) {
      if (player.targetY !== undefined) {
        for (const x of [0, lastCoordinate]) {
          excluded.set(`${x},${player.targetY}`, { x, y: player.targetY });
        }
      }
      if (player.targetX !== undefined) {
        for (const y of [0, lastCoordinate]) {
          excluded.set(`${player.targetX},${y}`, { x: player.targetX, y });
        }
      }
    }
    return Array.from(excluded.values());
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
        return this.board.spawnFfaBoost('portal', this.getPortalSpawnExclusions());
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
    if (this.isMazeBoardMode()) return;
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
    for (const timer of this.infectionSafeZoneTimers.values()) clearTimeout(timer);
    this.infectionSafeZoneTimers.clear();
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

  private getInfectionBoard(): InfectionBoard {
    if (!(this.board instanceof InfectionBoard)) {
      throw new Error('Infection board is not available for this game mode.');
    }
    return this.board;
  }

  private startMazeTimer(): void {
    this.clearMazeTimers();
    this.scheduleMazeInactivityTimer();
    this.mazeGameTimer = setTimeout(() => {
      this.mazeGameTimer = null;
      if (this.state !== 'playing') return;
      if (this.mode === 'infection') {
        this.finishMazeGame(
          this.getInfectionSurvivorIds().length > 0 ? 'survivors' : 'infected',
          'timer'
        );
      } else {
        this.finishMazeGame(this.impostorId, 'timer');
      }
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
      if (mazeStateExpired && this.mode === 'infection') this.resolveInfectionContact();
      this.emitPrivateMazeTrapState();
      this.expireMazeGhostModes();
      this.emitPrivateMazeActionStates();
      if (this.mode === 'infection') {
        if (!this.infectionHuntStarted && this.startTime &&
            Date.now() >= this.startTime + INFECTION_HUNT_DELAY_MS) {
          this.infectionHuntStarted = true;
          this.emitMazePublicEvent('infection_hunt_started');
        }
        this.processInfectionSafeZones();
        this.emitInfectionState();
      }
    }, 1000);
    this.mazeTimerInterval.unref();
  }

  private clearMazeTimers(): void {
    if (this.mazeGameTimer) clearTimeout(this.mazeGameTimer);
    if (this.mazeTimerInterval) clearInterval(this.mazeTimerInterval);
    if (this.mazeInactivityTimer) clearTimeout(this.mazeInactivityTimer);
    for (const timer of this.infectionWallTimers.values()) clearTimeout(timer);
    this.infectionWallTimers.clear();
    this.mazeGameTimer = null;
    this.mazeTimerInterval = null;
    this.mazeInactivityTimer = null;
  }

  private scheduleMazeInactivityTimer(): void {
    if (this.mazeInactivityTimer) clearTimeout(this.mazeInactivityTimer);
    if (!this.isMazeBoardMode() || this.state !== 'playing') return;
    this.mazeInactivityTimer = setTimeout(() => {
      this.mazeInactivityTimer = null;
      if (this.state === 'playing') {
        this.finishMazeGame(this.mode === 'infection' ? 'infected' : this.impostorId, 'inactivity');
      }
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
    const interval = this.mode === 'infection'
      ? INFECTION_RESHUFFLE_INTERVAL_MS
      : LABYRINTH_RESHUFFLE_INTERVAL_MS;
    return Math.max(0, Math.ceil(
      (this.mazeLayoutChangedAt + interval - now) / 1000
    ));
  }

  public getPrivateMazeTrapState(playerId: string): {
    traps: IMazeTrap[];
    cooldowns: Record<MazeTrapType, number>;
  } | null {
    const mayViewTraps = this.mode === 'labyrinth'
      ? playerId === this.impostorId
      : this.mode === 'infection' && !this.isInfected(playerId);
    if (!this.isMazeBoardMode() || !mayViewTraps) return null;
    return {
      traps: this.getMazeBoard().traps.map(trap => ({ ...trap })),
      cooldowns: this.getMazeTrapCooldowns(playerId)
    };
  }

  private getMazeTrapCooldowns(playerId?: string, now: number = Date.now()): Record<MazeTrapType, number> {
    const cooldownUntil = this.mode === 'infection' && playerId
      ? this.infectionTrapCooldownUntil.get(playerId) ?? { ice: 0, teleport: 0 }
      : this.mazeTrapCooldownUntil;
    return {
      ice: Math.max(0, Math.ceil((cooldownUntil.ice - now) / 1000)),
      teleport: Math.max(0, Math.ceil((cooldownUntil.teleport - now) / 1000))
    };
  }

  private emitPrivateMazeTrapState(): void {
    if (this.mode === 'labyrinth') {
      if (!this.impostorId) return;
      const state = this.getPrivateMazeTrapState(this.impostorId);
      if (state) this.onPrivateStateChange(this.impostorId, 'mazeTrapState', state);
      return;
    }
    if (this.mode === 'infection') {
      for (const playerId of this.getInfectionSurvivorIds()) {
        const state = this.getPrivateMazeTrapState(playerId);
        if (state) this.onPrivateStateChange(playerId, 'mazeTrapState', state);
      }
    }
  }

  private emitPrivateMazeActionStates(): void {
    if (!this.isMazeBoardMode()) return;
    for (const playerId of this.playersList) {
      const role = this.getPrivateMazeRole(playerId);
      const player = this.board.players.get(playerId);
      if (!role || !player) continue;
      this.onPrivateStateChange(playerId, 'mazeActionState', {
        canBreakBlock: role.canBreakBlock,
        canPlaceWall: role.canPlaceWall,
        canRescue: role.canRescue,
        isInPrison: player.isInPrison,
        wallPlacementCooldownUntil: role.wallPlacementCooldownUntil
      });
    }
    }

  private initializeInfectionSafeZones(): void {
    if (this.mode !== 'infection' || !this.startTime) return;
    for (const playerId of this.getInfectionSurvivorIds()) {
      const player = this.board.players.get(playerId);
      if (player && this.getInfectionBoard().isSafeZoneCell(player.x, player.y)) {
        this.infectionSafeZoneEnteredAt.set(playerId, this.startTime);
        this.scheduleInfectionSafeZoneExpiry(playerId, this.startTime);
      }
    }
  }

  private processInfectionSafeZones(now: number = Date.now()): void {
    if (this.mode !== 'infection' || this.state !== 'playing') return;
    const mazeBoard = this.getInfectionBoard();
    let boardChanged = false;

    for (const playerId of this.getInfectionSurvivorIds()) {
      const player = this.board.players.get(playerId);
      if (!player) continue;
      const isInside = mazeBoard.isSafeZoneCell(player.x, player.y);
      const enteredAt = this.infectionSafeZoneEnteredAt.get(playerId);

      if (!isInside) {
        if (enteredAt !== undefined) {
          this.clearInfectionSafeZoneExpiry(playerId);
          this.infectionSafeZoneEnteredAt.delete(playerId);
          this.activateInfectionSafeZoneCooldown(playerId, now);
        }
        continue;
      }
      if (enteredAt === undefined) {
        this.infectionSafeZoneEnteredAt.set(playerId, now);
        this.scheduleInfectionSafeZoneExpiry(playerId, now);
        continue;
      }
      if (now < enteredAt + INFECTION_SAFE_ZONE_DURATION_MS) continue;

      const fromX = player.x;
      const fromY = player.y;
      const destination = mazeBoard.ejectPlayerFromSafeZone(playerId);
      if (!destination) {
        console.error(`Could not eject Infection player ${playerId} to the edge of the safe zone.`);
        continue;
      }
      this.infectionSafeZoneEnteredAt.delete(playerId);
      this.clearInfectionSafeZoneExpiry(playerId);
      this.activateInfectionSafeZoneCooldown(playerId, now);
      this.onStateChange('playerMoved', {
        playerId,
        fromX,
        fromY,
        newX: destination.x,
        newY: destination.y,
        teleported: true
      });
      boardChanged = true;
    }

    if (boardChanged) this.onStateChange('mazeStateChanged', this.getMazeStateData());
  }

  private scheduleInfectionSafeZoneExpiry(playerId: string, enteredAt: number): void {
    this.clearInfectionSafeZoneExpiry(playerId);
    const timer = setTimeout(() => {
      this.infectionSafeZoneTimers.delete(playerId);
      if (this.state !== 'playing' ||
          this.infectionSafeZoneEnteredAt.get(playerId) !== enteredAt) return;
      this.processInfectionSafeZones(Date.now());
      this.emitInfectionState();
    }, Math.max(0, enteredAt + INFECTION_SAFE_ZONE_DURATION_MS - Date.now()));
    timer.unref();
    this.infectionSafeZoneTimers.set(playerId, timer);
  }

  private clearInfectionSafeZoneExpiry(playerId: string): void {
    const timer = this.infectionSafeZoneTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.infectionSafeZoneTimers.delete(playerId);
  }

  private activateInfectionSafeZoneCooldown(playerId: string, now: number): void {
    this.infectionSafeZoneCooldownUntil.set(
      playerId,
      now + INFECTION_SAFE_ZONE_COOLDOWN_MS
    );
  }

  private trackInfectionSafeZoneTransition(
    playerId: string,
    wasInside: boolean,
    isInside: boolean,
    now: number
  ): void {
    if (this.mode !== 'infection' || this.isInfected(playerId) || wasInside === isInside) return;
    if (isInside) {
      this.infectionSafeZoneEnteredAt.set(playerId, now);
      this.scheduleInfectionSafeZoneExpiry(playerId, now);
    } else if (this.infectionSafeZoneEnteredAt.delete(playerId)) {
      this.clearInfectionSafeZoneExpiry(playerId);
      this.activateInfectionSafeZoneCooldown(playerId, now);
    }
  }

  private getInfectionSurvivorIds(): string[] {
      return this.playersList.filter(playerId =>
        !this.isInfected(playerId) &&
        !this.board.players.get(playerId)?.isDead
      );
    }

  private getActiveInfectionIds(): string[] {
      return this.playersList.filter(playerId =>
        this.isInfected(playerId) &&
        !this.board.players.get(playerId)?.isDead
      );
    }

  private isInfected(playerId: string): boolean {
      return this.infectedPlayerIds.has(playerId);
    }

  public getPrivateInfectionState(playerId: string): {
      safeZoneRedUntil: number;
      safeZoneSecondsRemaining: number;
      safeZoneCooldownSecondsRemaining: number;
      huntSecondsRemaining: number;
      infectedCount: number;
      playerCount: number;
    } | null {
      if (this.mode !== 'infection' || !this.playersList.includes(playerId)) return null;
      const players = [...this.board.players.values()];
      return {
        safeZoneRedUntil: Math.max(0, this.infectionSafeZoneCooldownUntil.get(playerId) ?? 0),
        safeZoneSecondsRemaining: this.infectionSafeZoneEnteredAt.has(playerId)
          ? Math.max(0, Math.ceil((
            (this.infectionSafeZoneEnteredAt.get(playerId) ?? Date.now()) +
            INFECTION_SAFE_ZONE_DURATION_MS - Date.now()
          ) / 1000))
          : 0,
        safeZoneCooldownSecondsRemaining: Math.max(0, Math.ceil((
          (this.infectionSafeZoneCooldownUntil.get(playerId) ?? 0) - Date.now()
        ) / 1000)),
        huntSecondsRemaining: playerId === this.impostorId && this.startTime
          ? Math.max(0, Math.ceil((this.startTime + INFECTION_HUNT_DELAY_MS - Date.now()) / 1000))
          : 0,
        infectedCount: players.filter(player => player.isInfected && !player.isDead).length,
        playerCount: players.filter(player => !player.isDead).length
      };
    }

  private emitInfectionState(): void {
      if (this.mode !== 'infection') return;
      for (const playerId of this.playersList) {
        if (playerId.startsWith('bot_')) continue;
        const state = this.getPrivateInfectionState(playerId);
        if (state) this.onPrivateStateChange(playerId, 'infectionState', state);
      }
    }

    private expireMazePlayerEffects(now: number = Date.now()): boolean {
    let expired = false;
    for (const player of this.board.players.values()) {
      if (player.mazeFrozenUntil > 0 && player.mazeFrozenUntil <= now) {
        player.mazeFrozenUntil = 0;
        expired = true;
      }
      if (player.mazeTeleportingUntil > 0 && player.mazeTeleportingUntil <= now) {
        player.mazeTeleportingUntil = 0;
        expired = true;
      }
      if (player.invisibleUntil > 0 && player.invisibleUntil <= now) {
        player.invisibleUntil = 0;
        expired = true;
      }
      if (player.mazeShieldExpiresAt > 0 && player.mazeShieldExpiresAt <= now) {
        player.mazeShieldExpiresAt = 0;
        player.mazeShieldActive = false;
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
    const canPlaceTrap = this.mode === 'labyrinth'
      ? playerId === this.impostorId
      : this.mode === 'infection' && !this.isInfected(playerId);
    if (!this.isMazeBoardMode() || this.state !== 'playing' ||
        !canPlaceTrap || !player || player.isDead ||
        player.isInPrison || player.hasMazeEscaped ||
        (type !== 'ice' && type !== 'teleport') ||
        (this.mode === 'infection'
          ? (this.infectionTrapCooldownUntil.get(playerId)?.[type] ?? 0)
          : this.mazeTrapCooldownUntil[type]) > Date.now() ||
        !this.getMazeBoard().canPlaceTrap(x, y)) return false;

    const trap: IMazeTrap = {
      id: `maze_trap_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      x,
      y
    };
    if (!this.getMazeBoard().placeTrap(trap)) return false;
    if (this.mode === 'infection') {
      const cooldowns = this.infectionTrapCooldownUntil.get(playerId) ?? { ice: 0, teleport: 0 };
      this.infectionTrapCooldownUntil.set(playerId, {
        ...cooldowns,
        [type]: Date.now() + LABYRINTH_TRAP_COOLDOWN_MS
      });
    } else {
      this.mazeTrapCooldownUntil[type] = Date.now() + LABYRINTH_TRAP_COOLDOWN_MS;
    }
    this.recordPlayerActivity(playerId);
    this.emitPrivateMazeTrapState();
    return true;
  }

  private triggerMazeTrap(playerId: string, x: number, y: number): boolean {
    const player = this.board.players.get(playerId);
    const mazeBoard = this.getMazeBoard();
    if (!player || (this.mode === 'labyrinth' && playerId === this.impostorId) ||
        (this.mode === 'infection' && !this.isInfected(playerId))) return false;
    const trap = mazeBoard.removeTrapAt(x, y);
    if (!trap) return false;

    const shielded = player.mazeShieldActive &&
      (this.mode !== 'infection' || player.mazeShieldExpiresAt > Date.now());
    if (player.mazeShieldActive && !shielded) {
      player.mazeShieldActive = false;
      player.mazeShieldExpiresAt = 0;
    }
    if (shielded) {
      player.mazeShieldActive = false;
      player.mazeShieldExpiresAt = 0;
    }
    if (!shielded && trap.type === 'ice') {
      const freezeDuration = this.mode === 'infection'
        ? INFECTION_ICE_TRAP_DURATION_MS
        : LABYRINTH_ICE_TRAP_DURATION_MS;
      player.mazeFrozenUntil = Date.now() + freezeDuration;
    } else if (!shielded && trap.type === 'teleport') {
      const fromX = player.x;
      const fromY = player.y;
      const destination = mazeBoard.teleportPlayerToRandomBorder(playerId);
      if (destination) {
        player.mazeTeleportingUntil = Date.now() + LABYRINTH_TELEPORT_ANIMATION_MS;
        this.mazeMoveAt.set(playerId, Date.now());
        const newlyCaptured = this.updateMazePrisons();
        this.emitMazeCaptureEvents(this.getMazeCaptureOwner(newlyCaptured), newlyCaptured);
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
    if (this.mode === 'infection') {
      this.emitMazePublicEvent('infection_trap_triggered', {
        playerId,
        playerName: player.username,
        trapType: trap.type,
        shielded
      });
    }
    this.emitPrivateMazeTrapState();
    return true;
  }

  public changeMazeLayout(playerId: string, random: () => number = Math.random): boolean {
    const player = this.board.players.get(playerId);
    const canChange = this.mode === 'labyrinth'
      ? playerId === this.impostorId
      : this.mode === 'infection' && !this.isInfected(playerId);
    if (!this.isMazeBoardMode() || this.state !== 'playing' ||
        !canChange || !player || player.isDead ||
        player.isInPrison || player.hasMazeEscaped ||
        this.getMazeSecondsUntilChange() > 0) return false;
    const mazeBoard = this.getMazeBoard();
    mazeBoard.reshuffleMaze(random, true);
    if (this.mode === 'infection') {
      for (const timer of this.infectionWallTimers.values()) clearTimeout(timer);
      this.infectionWallTimers.clear();
      this.getInfectionBoard().respawnInfectionPowerups(
        INFECTION_GHOST_PICKUP_COUNT,
        INFECTION_INVISIBLE_PICKUP_COUNT,
        INFECTION_SHIELD_PICKUP_COUNT,
        random
      );
    }
    if (this.mode === 'labyrinth' && this.impostorId) {
      this.onPrivateStateChange(this.impostorId, 'mazeRole', this.getPrivateMazeRole(this.impostorId));
    }
    if (this.mode === 'infection') this.emitPrivateMazeActionStates();
    this.updateMazePrisons();
    this.mazeLayoutChangedAt = Date.now();
    this.recordPlayerActivity(playerId);
    this.emitMazePublicEvent('maze_changed');
    if (this.mode === 'labyrinth') mazeBoard.spawnGhostPickups(this.mazeGhostPickupCount, random);
    this.onStateChange('mazeStateChanged', {
      ...this.getMazeStateData(),
      mazeSecondsUntilChange: this.getMazeSecondsUntilChange()
    });
    this.emitMazeGhostPickups();
    return true;
  }

  private handleTimeout() {
    if (this.isMazeBoardMode()) return;
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
    if (this.isMazeBoardMode() || this.playersList.length === 0 ||
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
    return this.isMazeBoardMode() ? '' : this.playersList[this.currentTurnIndex];
  }

  public getPrivateMazeRole(playerId: string): {
    role: 'impostor' | 'good' | 'infected';
    canBreakBlock: boolean;
    canPlaceWall: boolean;
    canRescue: boolean;
    exitSealCooldownUntil: number;
    wallPlacementCooldownUntil: number;
  } | null {
    if (!this.isMazeBoardMode() || !this.playersList.includes(playerId) || playerId.startsWith('bot_')) {
      return null;
    }
    const isInfection = this.mode === 'infection';
    const isImpostor = !isInfection && playerId === this.impostorId;
    const isInfected = isInfection && this.isInfected(playerId);
    const player = this.board.players.get(playerId);
    const canAct = !!player && !player.isDead && !player.hasMazeEscaped && !player.isInPrison;
    const wallPlacementCooldownUntil = this.mazeWallPlacementCooldownUntil.get(playerId) ?? 0;
    return {
      role: isInfection ? (isInfected ? 'infected' : 'good') : (isImpostor ? 'impostor' : 'good'),
      canBreakBlock: canAct,
      canPlaceWall: canAct && (!isInfection || !isInfected) && wallPlacementCooldownUntil <= Date.now(),
      canRescue: canAct && !isInfection,
      exitSealCooldownUntil: isImpostor ? this.mazeExitSealCooldownUntil : 0,
      wallPlacementCooldownUntil
    };
  }

  public getMazeRescueStatus(): { capturedPlayers: string[]; availableRescuers: number } {
    const humanPlayers = this.playersList
      .filter(id => !id.startsWith('bot_'))
      .map(id => this.board.players.get(id))
      .filter((player): player is Player => !!player && !player.isDead && !player.hasMazeEscaped);
    return {
      capturedPlayers: humanPlayers.filter(player => player.isInPrison).map(player => player.id),
      availableRescuers: humanPlayers.filter(player => !player.isInPrison).length
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
    mazeKeysDelivered: number;
  } {
    return {
      board: this.getMazeBoard().toDTO(),
      rescueStatus: this.getMazeRescueStatus(),
      publicActionCounts: this.getMazePublicActionCounts(),
      mazeSecondsUntilChange: this.getMazeSecondsUntilChange(),
      mazeExitOpenUsedBy: [...this.mazeExitOpenUsed],
      mazeKeysDelivered: this.mazeKeysDelivered
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
        ...(!this.isMazeBoardMode()
          ? { currentTurn, turnSecondsRemaining: this.getRemainingTurnSeconds() }
          : {})
      });
    }
  }

  public recordPlayerActivity(playerId: string): void {
    if (this.state !== 'playing' || playerId.startsWith('bot_') ||
        !this.playersList.includes(playerId) ||
        (!this.isMazeBoardMode() && this.board.players.get(playerId)?.isDead)) return;

    this.playerLastActivityAt.set(playerId, Date.now());
    if (this.isMazeBoardMode()) {
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
    if (this.isMazeBoardMode()) return this.executeMazeMove(playerId, newX, newY);
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
          (this.mode === 'infection' && playerId === this.impostorId &&
            now < (this.startTime ?? 0) + INFECTION_HUNT_DELAY_MS) ||
          now - previousMoveAt < (this.mode === 'infection' && this.isInfected(playerId)
            ? INFECTION_MOVE_INTERVAL_MS
            : 120)
        ) return false;

        const fromX = player.x;
        const fromY = player.y;
        const infectionBoard = this.mode === 'infection' ? this.getInfectionBoard() : null;
        const wasInSafeZone = infectionBoard?.isSafeZoneCell(fromX, fromY) === true;
        const movesIntoSafeZone = infectionBoard?.isSafeZoneCell(newX, newY) === true && !wasInSafeZone;
        if (infectionBoard && movesIntoSafeZone &&
            (this.isInfected(playerId) ||
             (this.infectionSafeZoneCooldownUntil.get(playerId) ?? 0) > now)) return false;
        if (!this.getMazeBoard().moveMazePlayer(playerId, newX, newY)) return false;
        this.trackInfectionSafeZoneTransition(
          playerId,
          wasInSafeZone,
          infectionBoard?.isSafeZoneCell(newX, newY) === true,
          now
        );
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
        const key = this.mode === 'labyrinth'
          ? this.getMazeBoard().collectKey(playerId, newX, newY)
          : null;
        if (key) {
          player.hasMazeKey = true;
          this.emitMazePublicEvent('key_collected', { playerName: player.username });
        }
        if (this.mode === 'labyrinth' && playerId !== this.impostorId &&
            !player.mazeShieldActive &&
            this.getMazeBoard().collectShieldPickupAt(player.x, player.y)) {
          player.mazeShieldActive = true;
          this.scheduleMazeShieldRespawn();
        }
        if (this.mode === 'labyrinth' && playerId !== this.impostorId &&
            this.getMazeBoard().collectGhostPickupAt(player.x, player.y)) {
          player.ghostModeExpiresAt = Date.now() + LABYRINTH_GHOST_DURATION_MS;
          player.isInPrison = false;
          this.updateMazePrisons();
          this.emitMazePublicEvent('maze_ghost_activated', { playerName: player.username });
        }
        this.triggerMazeTrap(playerId, player.x, player.y);
        if (this.mode === 'infection' && !this.isInfected(playerId)) {
          const now = Date.now();
          const hasActivePowerup =
            player.ghostModeExpiresAt > now ||
            player.invisibleUntil > now ||
            (player.mazeShieldActive && player.mazeShieldExpiresAt > now);
          const powerup = this.getInfectionBoard().collectInfectionPowerupAt(
            player.x, player.y, Math.random, hasActivePowerup
          );
          if (powerup === 'ghost') {
            player.ghostModeExpiresAt = Date.now() + LABYRINTH_GHOST_DURATION_MS;
            this.updateMazePrisons();
          } else if (powerup === 'invisible') {
            player.invisibleUntil = Date.now() + INFECTION_INVISIBLE_DURATION_MS;
          } else if (powerup === 'shield') {
            player.mazeShieldActive = true;
            player.mazeShieldExpiresAt = Date.now() + INFECTION_SHIELD_DURATION_MS;
          }
          if (powerup) this.emitMazeGhostPickups();
        }
        const extraction = this.getMazeBoard().extraction;
        if (this.mode === 'labyrinth' && player.x === extraction.x && player.y === extraction.y &&
            this.getMazeBoard().deliverMazeKey(playerId)) {
          this.mazeKeysDelivered++;
          if (playerId !== this.impostorId) this.mazeGoodKeysDelivered++;
          this.emitMazePublicEvent('player_reached_extraction', { playerName: player.username });
          const goodPlayers = this.playersList.filter(id =>
            !id.startsWith('bot_') && id !== this.impostorId
          );
          if (goodPlayers.length > 0 && this.mazeGoodKeysDelivered >= goodPlayers.length) {
            this.finishMazeGame('good', 'escape');
          }
        }
        if (this.mode === 'infection') this.resolveInfectionContact();
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        if (this.mode === 'infection') this.emitInfectionState();
        if (this.mode === 'labyrinth') this.emitMazeGhostPickups();
        return true;
      }

  private resolveInfectionContact(): void {
    if (this.mode !== 'infection' || this.state !== 'playing') return;
    const mazeBoard = this.getMazeBoard();
    const newlyInfected: Player[] = [];
    const infectedPlayers = [...this.infectedPlayerIds]
      .map(playerId => this.board.players.get(playerId))
      .filter((player): player is Player =>
        !!player && !player.isDead && player.mazeFrozenUntil <= Date.now()
      );
    for (const playerId of this.getInfectionSurvivorIds()) {
      const player = this.board.players.get(playerId);
      if (!player || player.isDead ||
          (player.mazeShieldActive && player.mazeShieldExpiresAt > Date.now()) ||
          mazeBoard.isSafeZoneCell(player.x, player.y)) continue;
      const isAdjacentToInfected = infectedPlayers.some(infected =>
        Math.abs(infected.x - player.x) + Math.abs(infected.y - player.y) === 1 &&
        !mazeBoard.isSeparatedByWall(infected.x, infected.y, player.x, player.y)
      );
      if (!isAdjacentToInfected) continue;
      player.isInfected = true;
      player.invisibleUntil = 0;
      player.ghostModeExpiresAt = 0;
      this.infectedPlayerIds.add(playerId);
      newlyInfected.push(player);
    }
    for (const player of newlyInfected) {
      this.onPrivateStateChange(player.id, 'mazeRole', this.getPrivateMazeRole(player.id));
      this.onPrivateStateChange(player.id, 'mazeActionState', {
        canBreakBlock: false,
        canPlaceWall: false,
        canRescue: false,
        isInPrison: player.isInPrison,
        wallPlacementCooldownUntil: this.mazeWallPlacementCooldownUntil.get(player.id) ?? 0
      });
      this.onPrivateStateChange(player.id, 'mazeTrapState', {
        traps: [],
        cooldowns: this.getMazeTrapCooldowns(player.id)
      });
      this.emitMazePublicEvent('player_infected', { playerId: player.id, playerName: player.username });
    }
    if (newlyInfected.length) {
      this.emitPrivateMazeTrapState();
      this.emitPrivateMazeActionStates();
      this.emitMazeGhostPickups();
      this.announceInfectionLastSurvivor();
      this.emitInfectionState();
      if (this.getInfectionSurvivorIds().length === 0) {
        this.finishMazeGame('infected', 'infection');
      }
    }
  }

  private announceInfectionLastSurvivor(): void {
    if (this.mode !== 'infection' || this.infectionLastSurvivorAlertSent) return;
    const survivors = this.getInfectionSurvivorIds();
    if (survivors.length !== 1) return;

    this.infectionLastSurvivorAlertSent = true;
    const survivorId = survivors[0];
    const survivor = this.board.players.get(survivorId);
    if (!survivor) return;
    this.emitMazePublicEvent('infection_last_survivor', {
      playerId: survivor.id,
      playerName: survivor.username
    });
    if (!survivorId.startsWith('bot_')) {
      this.onPrivateStateChange(survivorId, 'infectionLastSurvivor', { playerId: survivorId });
    }
  }

  public getMazeGhostPickupsForPlayer(playerId: string): { id: string; x: number; y: number }[] {
    if (this.mode === 'labyrinth') {
      if (playerId === this.impostorId) return [];
      return this.getMazeBoard().ghostPickups.map(pickup => ({ ...pickup }));
    }
    if (this.mode !== 'infection' || this.isInfected(playerId)) return [];
    return this.getInfectionBoard().ghostPickups.map(pickup => ({ ...pickup }));
  }

  public getInfectionInvisiblePickupsForPlayer(playerId: string): { id: string; x: number; y: number }[] {
    if (this.mode !== 'infection' || this.isInfected(playerId)) return [];
    return this.getInfectionBoard().invisiblePickups.map(pickup => ({ ...pickup }));
  }

  public isInfectionPlayerInvisible(playerId: string): boolean {
    return this.mode === 'infection' &&
      (this.board.players.get(playerId)?.invisibleUntil ?? 0) > Date.now();
  }

  public canViewerSeeInfectionPlayer(viewerId: string, targetId: string): boolean {
    return !this.isInfectionPlayerInvisible(targetId) || !this.isInfected(viewerId);
  }

  public getMazeStateDataForPlayer(playerId: string) {
    const state = this.getMazeStateData();
    const hiddenPlayerIds = this.mode === 'infection' && this.isInfected(playerId)
      ? new Set(this.playersList.filter(id => this.isInfectionPlayerInvisible(id)))
      : null;
    return {
      ...state,
      rescueStatus: hiddenPlayerIds
        ? {
            ...state.rescueStatus,
            capturedPlayers: state.rescueStatus.capturedPlayers.filter(id => !hiddenPlayerIds.has(id))
          }
        : state.rescueStatus,
      board: this.getMazeBoard().toDTO(playerId)
    };
  }

  private emitMazeGhostPickups(): void {
    if (this.mode !== 'labyrinth' && this.mode !== 'infection') return;
    for (const playerId of this.playersList) {
      if (playerId.startsWith('bot_')) continue;
      if (this.mode !== 'labyrinth' || playerId !== this.impostorId) {
        this.onPrivateStateChange(
          playerId,
          'mazeGhostPickups',
          this.getMazeGhostPickupsForPlayer(playerId)
        );
      }
      if (this.mode === 'infection') {
        this.onPrivateStateChange(
          playerId,
          'infectionInvisiblePickups',
          this.getInfectionInvisiblePickupsForPlayer(playerId)
        );
      }
    }
  }

  public teleportMazePlayer(playerId: string, teleportId: string): boolean {
    const player = this.board.players.get(playerId);
    if (!this.isMazeBoardMode() || this.state !== 'playing' || !player ||
        playerId.startsWith('bot_') || player.isDead || player.isInPrison ||
        player.hasMazeEscaped || player.mazeFrozenUntil > Date.now() ||
        player.mazeTeleportingUntil > Date.now() ||
        (this.mode === 'infection' && this.isInfected(playerId))) return false;
        const fromX = player.x;
        const fromY = player.y;
        const destination = this.getMazeBoard().teleportPlayer(playerId, teleportId);
        if (!destination) return false;
        if (this.mode === 'infection') {
          const teleports = this.getMazeBoard().teleports;
          const previousPositions = teleports.map(({ x, y }) => ({ x, y }));
          const pairCount = new Set(teleports.map(({ pairId }) => pairId)).size;
          this.getMazeBoard().spawnTeleports(Math.random, previousPositions, pairCount);
        }
        player.mazeTeleportingUntil = Date.now() + LABYRINTH_TELEPORT_ANIMATION_MS;
        this.recordPlayerActivity(playerId);
        this.mazeMoveAt.set(playerId, Date.now());
        const newlyCaptured = this.updateMazePrisons();
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
        this.emitMazeCaptureEvents(this.getMazeCaptureOwner(newlyCaptured), newlyCaptured);
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public sealMazeExit(playerId: string, exitId: string): boolean {
        const player = this.board.players.get(playerId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            playerId !== this.impostorId || !player || player.isInPrison ||
            player.isDead || player.hasMazeEscaped || playerId.startsWith('bot_') ||
            this.mazeExitSealCooldownUntil > Date.now()) return false;
        const exitNumber = this.getMazeBoard().sealMazeExit(exitId);
        if (exitNumber === null) return false;
        this.mazeExitSealCooldownUntil = Date.now() + LABYRINTH_EXIT_SEAL_COOLDOWN_MS;
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
            !player || playerId.startsWith('bot_') ||
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
        if (!this.isMazeBoardMode() || this.state !== 'playing' || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasMazeEscaped ||
            player.isInPrison || !this.getPrivateMazeRole(playerId)?.canPlaceWall) return false;
        const isImpostor = this.mode === 'labyrinth' && playerId === this.impostorId;

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
        if (!mazeBoard.placeMazeWall(wall)) return false;
        this.mazeWallPlacementCooldownUntil.set(playerId, Date.now() + LABYRINTH_WALL_PLACEMENT_COOLDOWN_MS);
        if (this.mode === 'infection') this.scheduleInfectionWallExpiry(wall.id);
        this.recordPlayerActivity(playerId);

        const newlyCaptured = this.updateMazePrisons();
        this.emitPrivateMazeActionStates();
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        this.emitMazeCaptureEvents(playerId, newlyCaptured);
        return true;
      }

      private scheduleInfectionWallExpiry(wallId: string): void {
        const timer = setTimeout(() => {
          this.infectionWallTimers.delete(wallId);
          if (this.state !== 'playing') return;
          if (!this.getInfectionBoard().removeWallById(wallId)) return;
          this.updateMazePrisons();
          this.onStateChange('mazeStateChanged', this.getMazeStateData());
        }, INFECTION_WALL_LIFETIME_MS);
        timer.unref();
        this.infectionWallTimers.set(wallId, timer);
      }

      public breakMazeBlock(playerId: string, wallId: string): boolean {
        const player = this.board.players.get(playerId);
        if (!this.isMazeBoardMode() || this.state !== 'playing' || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasMazeEscaped ||
            player.isInPrison) return false;
        const mazeBoard = this.getMazeBoard();
        const wall = mazeBoard.walls.find(candidate =>
          candidate.id === wallId &&
          mazeBoard.isPlayerPlacedMazeWall(candidate) &&
          mazeBoard.isPlayerAdjacentToWall(playerId, candidate)
        );
        if (!wall) return false;
        const removedWall = mazeBoard.removeWallById(wallId);
        if (!removedWall) return false;
        const wallTimer = this.infectionWallTimers.get(wallId);
        if (wallTimer) {
          clearTimeout(wallTimer);
          this.infectionWallTimers.delete(wallId);
        }
        this.recordPlayerActivity(playerId);
        this.updateMazePrisons();
        if (!this.isInfectionPlayerInvisible(playerId)) {
          this.emitMazePublicEvent(this.mode === 'infection'
            ? 'player_broke_wall'
            : 'player_broke_prison_wall', {
            playerId,
            playerName: player.username,
            wallX: wall.x,
            wallY: wall.y,
            wallIsHorizontal: wall.isHorizontal
          });
        }
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

      public rescueMazePlayer(rescuerId: string, targetId: string): boolean {
        const rescuer = this.board.players.get(rescuerId);
        const target = this.board.players.get(targetId);
        if (this.mode !== 'labyrinth' || this.state !== 'playing' ||
            !rescuer || !target ||
            rescuerId.startsWith('bot_') || rescuer.isDead || rescuer.hasMazeEscaped || rescuer.isInPrison ||
            target.isDead || target.hasMazeEscaped || !target.isInPrison ||
            Math.abs(target.x - rescuer.x) + Math.abs(target.y - rescuer.y) > 1) return false;

        const mazeBoard = this.getMazeBoard();
        const removedWall = mazeBoard.getMazeReleaseWalls(targetId)[0];
        if (removedWall) mazeBoard.removeWallById(removedWall.id);
        if (!removedWall) return false;

        this.recordPlayerActivity(rescuerId);
        this.updateMazePrisons();
        this.emitMazePublicEvent('player_rescued', { rescuerName: rescuer.username, playerName: target.username });
        this.onStateChange('mazeStateChanged', this.getMazeStateData());
        return true;
      }

  private expireMazeGhostModes(now: number = Date.now()): void {
    const expired = [...this.board.players.values()].filter(player =>
      player.ghostModeExpiresAt > 0 && player.ghostModeExpiresAt <= now
    );
    if (!expired.length) return;
    for (const player of expired) player.ghostModeExpiresAt = 0;
    const newlyCaptured = this.updateMazePrisons();
    for (const player of expired) {
      if (!this.isInfectionPlayerInvisible(player.id)) {
        this.emitMazePublicEvent('maze_ghost_ended', { playerName: player.username });
      }
    }
    this.emitMazeCaptureEvents(this.getMazeCaptureOwner(newlyCaptured), newlyCaptured);
    this.onStateChange('mazeStateChanged', this.getMazeStateData());
  }

  private getMazeCaptureOwner(capturedIds: string[]): string {
    const mazeBoard = this.getMazeBoard();
    return capturedIds.some(playerId =>
      mazeBoard.getMazeCageWalls(playerId).some(wall => wall.isSabotageWall)
    ) ? this.impostorId || '' : '';
  }

  private emitMazeCaptureEvents(placerId: string, capturedIds: string[]): void {
    const capturedHumanIds = capturedIds.filter(id => !id.startsWith('bot_'));
    for (const capturedId of capturedHumanIds) {
      if (this.isInfectionPlayerInvisible(capturedId)) continue;
      const capturedPlayer = this.board.players.get(capturedId);
      const eventType = capturedId === this.impostorId
        ? 'player_captured_impostor'
        : placerId === this.impostorId ? 'impostor_captured_player' : 'player_captured_player';
      this.emitMazePublicEvent(eventType, { playerName: capturedPlayer?.username || capturedId });
    }
    if (capturedHumanIds.length > 0) this.resolveMazeCapture(capturedHumanIds);
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

      private resolveMazeCapture(capturedIds: string[]): void {
            if (this.mode !== 'labyrinth') return;
        if (this.state !== 'playing') return;
        if (capturedIds.includes(this.impostorId || '')) {
          this.finishMazeGame('good', 'capture');
          return;
        }
        if (capturedIds.length === 0) return;
        const newlyCapturedByImpostor = capturedIds.some(playerId =>
          this.getMazeBoard().getMazeCageWalls(playerId).some(wall => wall.isSabotageWall)
        );
        if (!newlyCapturedByImpostor) return;

        const goodPlayers = this.playersList
          .filter(playerId => !playerId.startsWith('bot_') && playerId !== this.impostorId)
          .map(playerId => this.board.players.get(playerId));
        if (goodPlayers.length > 0 && goodPlayers.every(player =>
          !!player?.isInPrison &&
          this.getMazeBoard().getMazeCageWalls(player.id).some(wall => wall.isSabotageWall)
        )) {
          this.finishMazeGame(this.impostorId, 'capture');
        }
      }

  private finishMazeGame(winner: string | null, reason: MazeEndReason): void {
    if (this.mode === 'infection') {
      for (const player of this.board.players.values()) player.invisibleUntil = 0;
      this.onStateChange('mazeStateChanged', this.getMazeStateData());
    }
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

    if (this.isMazeBoardMode()) {
      if (this.mode === 'infection') {
        this.emitInfectionState();
        this.announceInfectionLastSurvivor();
        if (this.getInfectionSurvivorIds().length === 0) {
          this.finishMazeGame('infected', 'surrender');
        } else if (this.getActiveInfectionIds().length === 0) {
          this.finishMazeGame('survivors', 'surrender');
        }
        return true;
      }
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
        : this.mode === 'infection'
          ? {
              infectionOutcome: this.winner,
              infectionCount: this.infectedPlayerIds.size
            }
        : {})
    });
    if (!abandoned && !this.isMazeBoardMode()) this.botReactionManager.onGameFinished(this.winner);
  }
}
