import { Board } from './board.js';
import { ImpostorBoard, type IImpostorTrap, type ImpostorTrapType } from './impostor-board.js';
import { ImpostorBoardBase } from './impostor-board-base.js';
import { InfectionBoard } from './infection-board.js';
import { Player, Wall, type Boost, type ImpostorToolType } from './models.js';
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
export type InfectionLastSurvivorPower = 'ghost' | 'shield' | 'invisible' | 'teleport';

export const BOOST_MIN_DELAY_MS = 60_000;
export const BOOST_MAX_DELAY_MS = 120_000;
export const PLAYER_INACTIVITY_LIMIT_MS = 120_000;
export const IMPOSTOR_GAME_DURATION_MS = 10 * 60_000;
export const IMPOSTOR_IDLE_LIMIT_MS = 60_000;
export const IMPOSTOR_RESHUFFLE_INTERVAL_MS = 60_000;
export const IMPOSTOR_MIN_HUMAN_PLAYERS = 1;
export const IMPOSTOR_GHOST_DURATION_MS = 5_000;
export const IMPOSTOR_TRAP_COOLDOWN_MS = 15_000;
export const IMPOSTOR_EXIT_SEAL_COOLDOWN_MS = 60_000;
export const IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS = 10_000;
export const IMPOSTOR_GENERATOR_SABOTAGE_COOLDOWN_MS = 60_000;
export const IMPOSTOR_GENERATOR_REPAIR_DURATION_MS = 5_000;
export const IMPOSTOR_EMERGENCY_MEETING_COOLDOWN_MS = 3 * 60_000;
export const IMPOSTOR_EMERGENCY_MEETING_ANNOUNCEMENT_MS = 3_000;
export const IMPOSTOR_EMERGENCY_MEETING_VOTING_MS = 30_000;
export const IMPOSTOR_EMERGENCY_MEETING_RESULTS_MS = 7_000;
export const IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE = 5;
export const IMPOSTOR_ICE_TRAP_DURATION_MS = 30_000;
export const IMPOSTOR_TELEPORT_ANIMATION_MS = 1_400;
export const IMPOSTOR_RADAR_GRACE_PERIOD_MS = 30_000;
export const IMPOSTOR_RADAR_REQUEST_TIMEOUT_MS = 5_000;
export const INFECTION_HUNT_DELAY_MS = 10_000;
export const INFECTION_SAFE_ZONE_DURATION_MS = 10_000;
export const INFECTION_SAFE_ZONE_COOLDOWN_MS = 60_000;
export const INFECTION_SAFE_ZONE_RED_DURATION_MS = INFECTION_SAFE_ZONE_COOLDOWN_MS;
export const INFECTION_MOVE_INTERVAL_MS = 80;
export const INFECTION_MIN_PLAYERS = 3;
export const INFECTION_MAX_PLAYERS = 6;
export const INFECTION_LAST_SURVIVOR_POWER_COOLDOWN_MS = 20_000;
export const INFECTION_LAST_SURVIVOR_GENERAL_COOLDOWN_MS = 3_000;
export const INFECTION_LAST_SURVIVOR_TRAP_COOLDOWN_MS = 20_000;
export const INFECTION_LAST_SURVIVOR_POWER_DURATION_MS = 10_000;
export const INFECTION_LAST_SURVIVOR_HUNT_COUNTDOWN_MS = 5_000;
export const INFECTION_LAST_SURVIVOR_BURN_DURATION_MS = 4_000;
export const INFECTION_WALL_PLACEMENT_COOLDOWN_MS = 5_000;
export const INFECTION_ICE_TRAP_DURATION_MS = 10_000;
export const INFECTION_RESHUFFLE_INTERVAL_MS = 60_000;
export const INFECTION_GHOST_PICKUP_COUNT = 3;
export const INFECTION_GHOST_DURATION_MS = 15_000;
export const INFECTION_INVISIBLE_PICKUP_COUNT = 3;
export const INFECTION_INVISIBLE_DURATION_MS = 15_000;
export const INFECTION_SHIELD_PICKUP_COUNT = 3;
export const INFECTION_SHIELD_DURATION_MS = 15_000;
const IMPOSTOR_SHIELD_PICKUP_COUNT = 3;
const IMPOSTOR_SHIELD_RESPAWN_MS = 30_000;
type ImpostorEndReason = 'capture' | 'timer' | 'inactivity' | 'escape' | 'surrender' | 'infection' | 'emergency_meeting' | 'doors_sabotaged';

export type ImpostorEmergencyMeeting = {
  id: string;
  phase: 'announcement' | 'voting' | 'results';
  starterId: string;
  starterName: string;
  startedAt: number;
  phaseEndsAt: number;
  votesCast: number;
  voterCount: number;
  results?: {
    goodTeamWon: boolean;
    impostorId: string;
    ballots: Array<{
      voterId: string;
      voterName: string;
      targetId: string | null;
      targetName: string;
      targetWasImpostor: boolean;
    }>;
  };
};

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

interface IPendingImpostorToolRequest {
  requesterId: string;
  targetId: string;
  toolType: ImpostorToolType;
  timeout: NodeJS.Timeout;
}

export class GameInstance {
  public id: string;
  public mode: GameMode;
  public rules: IGameModeRules;
  public board: Board | ImpostorBoardBase;
  public playersList: string[] = [];
  public currentTurnIndex: number = 0;
  private completedRounds = 0;
  private readonly boostResetEveryRounds = 5;
  
  public state: 'waiting' | 'playing' | 'finished' = 'waiting';
  public winner: string | null = null;
  public startTime?: number;
  
  public turnTimeLimitSeconds: number;
  public maxStrikesBeforeKick: number;
  public hasSpawnedKillerItem: boolean = false;
  public hasSpawnedExchangeItem: boolean = false;
  public readonly impostorId: string | null;
  public onPrivateStateChange: (playerId: string, event: string, data: unknown) => void = () => {};
  private readonly impostorMoveAt = new Map<string, number>();
  private readonly impostorActionsUsed = new Map<string, number>();
  private readonly lastImpostorTrapStateByPlayer = new Map<string, string>();
  private readonly lastImpostorActionStateByPlayer = new Map<string, string>();
  private readonly lastImpostorFootprintsByPlayer = new Map<string, string>();
  private readonly impostorPublicEvents: Array<{
    id: string;
    type: string;
    playerId?: string;
    playerName?: string;
    wallX?: number;
    wallY?: number;
    wallIsHorizontal?: boolean;
    trapType?: ImpostorTrapType;
    shielded?: boolean;
    targetName?: string;
    rescuerName?: string;
    pairNumber?: number;
    exitNumber?: number;
    power?: InfectionLastSurvivorPower;
    generatorSector?: string;
    infectorId?: string;
    infectorName?: string;
  }> = [];
  private readonly impostorExitOpenUsed = new Set<string>();
  private impostorGoodPlayersReturned = 0;
  private impostorGameTimer: NodeJS.Timeout | null = null;
  private impostorTimerInterval: NodeJS.Timeout | null = null;
  private impostorInactivityTimer: NodeJS.Timeout | null = null;
  private impostorLayoutChangedAt = 0;
  private impostorLayoutChangeInProgress = false;
  private impostorGeneratorSabotageCooldownUntil = 0;
  private impostorEmergencyMeetingAvailableAt = 0;
  private impostorEmergencyMeeting: ImpostorEmergencyMeeting | null = null;
  private readonly impostorEmergencyMeetingVotes = new Map<string, string>();
  private impostorEmergencyMeetingTimers: NodeJS.Timeout[] = [];
  private impostorEmergencyMeetingPausedAt = 0;
  private impostorEmergencyMeetingGameRemainingMs = 0;
  private readonly impostorToolRequests = new Map<string, IPendingImpostorToolRequest>();
  private impostorToolRequestSequence = 0;
  private radarGraceUntil = 0;
  private impostorEndReason: ImpostorEndReason | null = null;
  private impostorSurrenderedPlayerId: string | null = null;
  private lastImpostorGhostId: string | null = null;
  private impostorGhostPickupCount = 0;
  private impostorFootprintStepCount = 0;
  private impostorTrapCooldownUntil: Record<ImpostorTrapType, number> = { ice: 0, teleport: 0 };
  private readonly impostorGeneratorRepairTimers = new Map<string, NodeJS.Timeout>();
  private readonly impostorDoorRepairTimers = new Map<string, { exitId: string; timer: NodeJS.Timeout }>();
  private readonly impostorTrapDeactivationTimers = new Map<string, NodeJS.Timeout>();
  private readonly infectionTrapCooldownUntil = new Map<string, Record<ImpostorTrapType, number>>();
  private impostorWallPlacementCooldownUntil = new Map<string, number>();
  private impostorExitSealCooldownUntil = 0;
  private impostorShieldRespawnTimers = new Set<NodeJS.Timeout>();
  private readonly infectedPlayerIds = new Set<string>();
  private readonly infectionSafeZoneEnteredAt = new Map<string, number>();
  private readonly infectionSafeZoneCooldownUntil = new Map<string, number>();
  private readonly infectionSafeZoneTimers = new Map<string, NodeJS.Timeout>();
  private readonly infectionLastSurvivorPowerCooldownUntil =
    new Map<string, Record<InfectionLastSurvivorPower, number>>();
  private readonly infectionLastSurvivorGeneralCooldownUntil = new Map<string, number>();
  private infectionLastSurvivorAlertSent = false;
  private infectionLastSurvivorCountdownUntil = 0;
  private infectionBurnUntil = 0;
  private infectionBurnTimer: NodeJS.Timeout | null = null;
  private infectionHuntStarted = false;

  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadlineAt: number | null = null;
  private pendingBoostDecision: IPendingBoostDecision | null = null;
  private timedBoostTimers = new Map<TimedBoostType, NodeJS.Timeout>();
  private readonly timedBoostRespawnRounds = new Map<TimedBoostType, number>();
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
  private surrenderedPlayerId: string | null = null;
  private surrenderedPlayerName: string | null = null;

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
    const isImpostorBoardMode = mode === 'impostor' || mode === 'infection';
    this.board = mode === 'infection'
      ? new InfectionBoard(size)
      : mode === 'impostor' ? new ImpostorBoard(size) : new Board(size);
    
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
    if (isImpostorBoardMode) {
      const humanPlayers = roomPlayers.filter(player => !player.id.startsWith('bot_'));
      if (humanPlayers.length < 1) {
        throw new Error('Impostor requires at least one human player.');
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
      if (mode === 'infection' && this.impostorId) {
        this.infectedPlayerIds.add(this.impostorId);
        const initialInfected = this.board.players.get(this.impostorId);
        if (initialInfected) initialInfected.isInfected = true;
        this.getInfectionBoard().placePlayerAtSouthEdge(this.impostorId);
      }

      if (mode === 'impostor') this.getImpostorBoard().spawnGenerators();
      this.getImpostorBoard().generateRandomImpostorWalls(undefined, Math.random, roomPlayers.length);
      if (mode === 'infection') {
        this.getImpostorBoard().spawnTeleports();
        this.getInfectionBoard().respawnInfectionPowerups(
          INFECTION_GHOST_PICKUP_COUNT,
          INFECTION_INVISIBLE_PICKUP_COUNT,
          INFECTION_SHIELD_PICKUP_COUNT
        );
      }
      if (mode === 'impostor') {
        const keyOwnerIds = humanPlayers.map(player => player.id);
        this.getImpostorBoard().spawnKeys(keyOwnerIds);
        this.getImpostorBoard().spawnTools();
      }
    } else {
      this.impostorId = null;
    }
  }

  public start() {
    this.state = 'playing';
    this.startTime = Date.now();
    if (this.mode === 'impostor') {
      this.impostorEmergencyMeetingAvailableAt =
        this.startTime + IMPOSTOR_EMERGENCY_MEETING_COOLDOWN_MS;
    }
    for (const playerId of this.playersList) {
      if (!playerId.startsWith('bot_')) this.recordPlayerActivity(playerId);
    }
    if (this.isImpostorBoardMode()) {
      this.startImpostorTimer();
    } else if (this.isFfaMode()) {
      this.hasSpawnedKillerItem = false;
      this.board.spawnFfaBoost('wall_pickup');
    } else {
      this.board.spawnFfaBoost('wall_pickup');
    }
    if (!this.isImpostorBoardMode()) {
      this.clearTimedBoostTimers();
      this.board.spawnFfaBoost('portal', this.getPortalSpawnExclusions());
      this.board.spawnExchangeItem();
      this.hasSpawnedExchangeItem = true;
      this.board.spawnGhostItem();
    }
    if (!this.isImpostorBoardMode()) this.startTurnTimer();
    this.onStateChange('gameStarted', {
      mode: this.mode,
      board: this.board.toDTO(this.getCurrentPlayer()),
      ...(this.isImpostorBoardMode()
        ? {
            gameTimeLimitSeconds: IMPOSTOR_GAME_DURATION_MS / 1000,
            gameSecondsRemaining: IMPOSTOR_GAME_DURATION_MS / 1000,
            impostorSecondsUntilChange: this.getImpostorSecondsUntilChange(),
            impostorGeneratorSabotageSecondsRemaining: this.getImpostorGeneratorSabotageCooldownSeconds(),
            impostorEmergencyMeeting: this.getImpostorEmergencyMeetingState(),
            impostorEmergencyMeetingSecondsRemaining: this.getImpostorEmergencyMeetingSecondsRemaining(),
            serverTime: Date.now()
          }
        : {
            currentTurn: this.getCurrentPlayer(),
            turnTimeLimitSeconds: this.turnTimeLimitSeconds,
            turnSecondsRemaining: this.turnTimeLimitSeconds
          })
    });
    if (this.isImpostorBoardMode()) {
      this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    }
    if (this.isImpostorBoardMode()) {
      this.emitPrivateImpostorActionStates();
      this.emitPrivateImpostorTrapState();
      this.emitPrivateImpostorFootprints();
      if (this.mode === 'infection') this.emitImpostorGhostPickups();
      if (this.mode === 'infection') {
        this.initializeInfectionSafeZones();
        this.emitInfectionState();
      }
    }
    if (!this.isImpostorBoardMode()) this.checkTriggerBotTurn();
  }

  private isFfaMode(): boolean {
    return this.mode === 'FFA';
  }

  private isImpostorBoardMode(): boolean {
    return this.mode === 'impostor' || this.mode === 'infection';
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

  private getRoundBasedBoostTypes(): TimedBoostType[] {
    return ['ghost', 'exchange_item', 'portal'];
  }

  private scheduleTimedBoostRespawn(type: TimedBoostType): void {
    if (this.isImpostorBoardMode() || this.state !== 'playing' || type === 'killer_item') return;
    this.clearTimedBoostTimer(type);
    this.timedBoostRespawnRounds.set(type, this.completedRounds + this.boostResetEveryRounds);
  }

  private applyScheduledBoostRespawns(): void {
    if (this.isImpostorBoardMode() || this.state !== 'playing') return;

    for (const [type, respawnAtRound] of [...this.timedBoostRespawnRounds.entries()]) {
      if (this.completedRounds < respawnAtRound || this.board.boosts.some(boost => boost.type === type)) {
        continue;
      }
      this.spawnTimedBoost(type);
      this.timedBoostRespawnRounds.delete(type);
    }
  }

  private handleRoundBasedBoostRotation(): void {
    if (this.isImpostorBoardMode() || this.state !== 'playing') return;
    if (this.completedRounds % this.boostResetEveryRounds !== 0) return;

    const shouldSpawnKiller = this.mode === 'FFA' &&
      this.completedRounds >= this.boostResetEveryRounds &&
      !this.hasSpawnedKillerItem;

    let changed = false;
    for (const type of this.getRoundBasedBoostTypes()) {
      if (this.board.removeBoostsOfType(type) > 0) changed = true;
    }
    if (shouldSpawnKiller && this.board.removeBoostsOfType('killer_item') > 0) changed = true;
    if (!changed && !shouldSpawnKiller) return;

    for (const type of this.getRoundBasedBoostTypes()) {
      if (this.spawnTimedBoost(type)) changed = true;
    }
    if (shouldSpawnKiller && !this.hasSpawnedKillerItem) {
      const killerSpawned = this.spawnTimedBoost('killer_item');
      this.hasSpawnedKillerItem = killerSpawned;
      if (killerSpawned) changed = true;
    }
    if (changed) this.broadcastBoostBoard();
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
    if (this.isImpostorBoardMode()) return;
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
    this.clearImpostorTimers();
    this.clearImpostorToolRequests();
    if (this.infectionBurnTimer) clearTimeout(this.infectionBurnTimer);
    this.infectionBurnTimer = null;
    for (const timer of this.infectionSafeZoneTimers.values()) clearTimeout(timer);
    this.infectionSafeZoneTimers.clear();
    for (const timer of this.impostorShieldRespawnTimers) clearTimeout(timer);
    this.impostorShieldRespawnTimers.clear();
    this.state = 'finished';
  }

  private getImpostorBoard(): ImpostorBoardBase {
    if (!(this.board instanceof ImpostorBoardBase)) {
      throw new Error('Impostor board is not available for this game mode.');
    }
    return this.board;
  }

  private getInfectionBoard(): InfectionBoard {
    if (!(this.board instanceof InfectionBoard)) {
      throw new Error('Infection board is not available for this game mode.');
    }
    return this.board;
  }

  private startImpostorTimer(gameDurationMs: number = IMPOSTOR_GAME_DURATION_MS): void {
    this.clearImpostorTimers();
    this.scheduleImpostorInactivityTimer();
    this.impostorGameTimer = setTimeout(() => {
      this.impostorGameTimer = null;
      if (this.state !== 'playing') return;
      if (this.mode === 'infection') {
        this.finishImpostorGame(
          this.getInfectionSurvivorIds().length > 0 ? 'survivors' : 'infected',
          'timer'
        );
      } else {
        this.finishImpostorGame(this.impostorId, 'timer');
      }
    }, gameDurationMs);
    this.impostorGameTimer.unref();
    this.impostorTimerInterval = setInterval(() => {
      if (this.state !== 'playing') {
        this.clearImpostorTimers();
        return;
      }
      this.onStateChange('impostorTimerUpdated', {
        gameSecondsRemaining: this.getImpostorRemainingSeconds(),
        impostorSecondsUntilChange: this.getImpostorSecondsUntilChange(),
        impostorGeneratorSabotageSecondsRemaining: this.getImpostorGeneratorSabotageCooldownSeconds(),
        impostorEmergencyMeetingSecondsRemaining: this.getImpostorEmergencyMeetingSecondsRemaining(),
        serverTime: Date.now()
      });
      const impostorStateExpired = this.expireImpostorPlayerEffects();
      if (impostorStateExpired) this.onStateChange('impostorStateChanged', this.getImpostorStateData());
      if (impostorStateExpired && this.mode === 'infection') this.resolveInfectionContact();
      this.emitPrivateImpostorTrapState();
      this.emitPrivateImpostorFootprints();
      this.expireImpostorGhostModes();
      this.emitPrivateImpostorActionStates();
      if (this.mode === 'infection') {
        if (!this.infectionHuntStarted && this.startTime &&
            Date.now() >= this.startTime + INFECTION_HUNT_DELAY_MS) {
          this.infectionHuntStarted = true;
          this.emitImpostorPublicEvent('infection_hunt_started');
        }
        this.processInfectionSafeZones();
        this.emitInfectionState();
      }
    }, 1000);
    this.impostorTimerInterval.unref();
  }

  private clearImpostorTimers(): void {
    if (this.impostorGameTimer) clearTimeout(this.impostorGameTimer);
    if (this.impostorTimerInterval) clearInterval(this.impostorTimerInterval);
    if (this.impostorInactivityTimer) clearTimeout(this.impostorInactivityTimer);
    this.impostorGameTimer = null;
    this.impostorTimerInterval = null;
    this.impostorInactivityTimer = null;
    for (const timer of this.impostorGeneratorRepairTimers.values()) clearTimeout(timer);
    this.impostorGeneratorRepairTimers.clear();
    for (const { timer } of this.impostorDoorRepairTimers.values()) clearTimeout(timer);
    this.impostorDoorRepairTimers.clear();
    for (const timer of this.impostorTrapDeactivationTimers.values()) clearTimeout(timer);
    this.impostorTrapDeactivationTimers.clear();
    for (const timer of this.impostorEmergencyMeetingTimers) clearTimeout(timer);
    this.impostorEmergencyMeetingTimers = [];
  }

  private isInfectionBurning(now: number = Date.now()): boolean {
    return this.mode === 'infection' && this.infectionBurnUntil > now;
  }

  private beginInfectionBurnSequence(): void {
    if (this.mode !== 'infection' || this.state !== 'playing' || this.isInfectionBurning()) return;

    this.infectionBurnUntil = Date.now() + INFECTION_LAST_SURVIVOR_BURN_DURATION_MS;
    this.emitImpostorPublicEvent('infection_final_survivor_burning');
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    this.emitInfectionState();
    this.infectionBurnTimer = setTimeout(() => {
      this.infectionBurnTimer = null;
      this.infectionBurnUntil = 0;
      if (this.state === 'playing' && this.getInfectionSurvivorIds().length === 0) {
        this.finishImpostorGame('infected', 'infection');
      } else {
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        this.emitInfectionState();
      }
    }, INFECTION_LAST_SURVIVOR_BURN_DURATION_MS);
    this.infectionBurnTimer.unref();
  }

  private scheduleImpostorInactivityTimer(): void {
    if (this.impostorInactivityTimer) clearTimeout(this.impostorInactivityTimer);
    if (!this.isImpostorBoardMode() || this.state !== 'playing' ||
        this.isImpostorEmergencyMeetingActive()) return;
    this.impostorInactivityTimer = setTimeout(() => {
      this.impostorInactivityTimer = null;
      if (this.state === 'playing' && !this.isImpostorEmergencyMeetingActive()) {
        this.finishImpostorGame(this.mode === 'infection' ? 'infected' : this.impostorId, 'inactivity');
      }
    }, IMPOSTOR_IDLE_LIMIT_MS);
    this.impostorInactivityTimer.unref();
  }

  public getImpostorRemainingSeconds(): number {
    if (this.isImpostorEmergencyMeetingActive()) {
      return Math.ceil(this.impostorEmergencyMeetingGameRemainingMs / 1000);
    }
    if (!this.startTime) return IMPOSTOR_GAME_DURATION_MS / 1000;
    return Math.max(0, Math.ceil((this.startTime + IMPOSTOR_GAME_DURATION_MS - Date.now()) / 1000));
  }

  public getImpostorGameTimeLimitSeconds(): number {
    return IMPOSTOR_GAME_DURATION_MS / 1000;
  }

  public getImpostorSecondsUntilChange(now: number = Date.now()): number {
    if (!this.impostorLayoutChangedAt) return 0;
    const interval = this.mode === 'infection'
      ? INFECTION_RESHUFFLE_INTERVAL_MS
      : IMPOSTOR_RESHUFFLE_INTERVAL_MS;
    return Math.max(0, Math.ceil(
      (this.impostorLayoutChangedAt + interval - now) / 1000
    ));
  }

  public getImpostorGeneratorSabotageCooldownSeconds(now: number = Date.now()): number {
    return Math.max(0, Math.ceil((this.impostorGeneratorSabotageCooldownUntil - now) / 1000));
  }

  public getImpostorExitSealCooldownSeconds(now: number = Date.now()): number {
    return Math.max(0, Math.ceil((this.impostorExitSealCooldownUntil - now) / 1000));
  }

  public getImpostorEmergencyMeetingSecondsRemaining(now: number = Date.now()): number {
    if (this.mode !== 'impostor' || !this.impostorEmergencyMeetingAvailableAt) return 0;
    const effectiveNow = this.isImpostorEmergencyMeetingActive() ? this.impostorEmergencyMeetingPausedAt : now;
    return Math.max(0, Math.ceil((this.impostorEmergencyMeetingAvailableAt - effectiveNow) / 1000));
  }

  public getImpostorEmergencyMeetingState(): ImpostorEmergencyMeeting | null {
    if (!this.impostorEmergencyMeeting) return null;
    return {
      ...this.impostorEmergencyMeeting,
      ...(this.impostorEmergencyMeeting.results
        ? { results: { ...this.impostorEmergencyMeeting.results,
            ballots: this.impostorEmergencyMeeting.results.ballots.map(ballot => ({ ...ballot })) } }
        : {})
    };
  }

  public getImpostorEmergencyMeetingVote(playerId: string): string | null {
    return this.impostorEmergencyMeetingVotes.get(playerId) ?? null;
  }

  private isImpostorEmergencyMeetingActive(): boolean {
    return this.mode === 'impostor' && this.impostorEmergencyMeeting !== null;
  }

  public callImpostorEmergencyMeeting(playerId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        this.getImpostorEmergencyMeetingSecondsRemaining() > 0 || !this.impostorId) return false;
    const caller = this.board.players.get(playerId);
    if (!caller || caller.id === this.impostorId || caller.isDead || caller.hasImpostorEscaped ||
        !this.getImpostorBoard().isSafeZoneCell(caller.x, caller.y)) return false;

    const activeVoters = this.playersList.filter(id => {
      const player = this.board.players.get(id);
      return !!player && !player.isDead && !id.startsWith('bot_');
    });
    const now = Date.now();
    this.impostorEmergencyMeetingAvailableAt = now + IMPOSTOR_EMERGENCY_MEETING_COOLDOWN_MS;
    this.impostorEmergencyMeetingPausedAt = now;
    this.impostorEmergencyMeetingGameRemainingMs = this.getImpostorRemainingSeconds() * 1000;
    if (this.impostorGameTimer) clearTimeout(this.impostorGameTimer);
    if (this.impostorTimerInterval) clearInterval(this.impostorTimerInterval);
    if (this.impostorInactivityTimer) clearTimeout(this.impostorInactivityTimer);
    this.impostorGameTimer = null;
    this.impostorTimerInterval = null;
    this.impostorInactivityTimer = null;
    for (const repairPlayerId of [...this.impostorGeneratorRepairTimers.keys()]) {
      this.cancelImpostorGeneratorRepair(repairPlayerId);
    }
    for (const repairPlayerId of [...this.impostorDoorRepairTimers.keys()]) {
      this.cancelImpostorDoorRepair(repairPlayerId);
    }
    this.impostorEmergencyMeetingVotes.clear();
    const meeting: ImpostorEmergencyMeeting = {
      id: `emergency_meeting_${now}`,
      phase: 'announcement',
      starterId: caller.id,
      starterName: caller.username,
      startedAt: now,
      phaseEndsAt: now + IMPOSTOR_EMERGENCY_MEETING_ANNOUNCEMENT_MS,
      votesCast: 0,
      voterCount: activeVoters.length
    };
    this.impostorEmergencyMeeting = meeting;
    this.emitImpostorState();
    this.impostorEmergencyMeetingTimers.push(setTimeout(() => {
      if (this.state !== 'playing' || this.impostorEmergencyMeeting?.id !== meeting.id) return;
      meeting.phase = 'voting';
      meeting.phaseEndsAt = Date.now() + IMPOSTOR_EMERGENCY_MEETING_VOTING_MS;
      meeting.votesCast = this.impostorEmergencyMeetingVotes.size;
      this.emitImpostorState();
      if (meeting.votesCast >= meeting.voterCount) {
        this.resolveImpostorEmergencyMeeting();
        return;
      }
      this.impostorEmergencyMeetingTimers.push(setTimeout(() => {
        if (this.impostorEmergencyMeeting?.id === meeting.id &&
            this.impostorEmergencyMeeting.phase === 'voting') {
          this.resolveImpostorEmergencyMeeting();
        }
      }, IMPOSTOR_EMERGENCY_MEETING_VOTING_MS));
      this.impostorEmergencyMeetingTimers[this.impostorEmergencyMeetingTimers.length - 1].unref();
    }, IMPOSTOR_EMERGENCY_MEETING_ANNOUNCEMENT_MS));
    this.impostorEmergencyMeetingTimers[0].unref();
    return true;
  }

  public voteImpostorEmergencyMeeting(playerId: string, targetId: string): boolean {
    const meeting = this.impostorEmergencyMeeting;
    if (this.mode !== 'impostor' || this.state !== 'playing' ||
        meeting?.phase !== 'voting' || playerId.startsWith('bot_') ||
        this.impostorEmergencyMeetingVotes.has(playerId)) return false;
    const voter = this.board.players.get(playerId);
    const target = this.board.players.get(targetId);
    if (!voter || voter.isDead || !target || target.isDead ||
        !this.playersList.includes(playerId) || !this.playersList.includes(targetId)) return false;
    this.impostorEmergencyMeetingVotes.set(playerId, targetId);
    meeting.votesCast = this.impostorEmergencyMeetingVotes.size;
    this.onPrivateStateChange(playerId, 'impostorEmergencyMeetingVoteRecorded', { targetId });
    this.emitImpostorState();
    if (meeting.votesCast >= meeting.voterCount) this.resolveImpostorEmergencyMeeting();
    return true;
  }

  private resolveImpostorEmergencyMeeting(): void {
    const meeting = this.impostorEmergencyMeeting;
    if (!meeting || meeting.phase !== 'voting' || !this.impostorId) return;
    for (const timer of this.impostorEmergencyMeetingTimers) clearTimeout(timer);
    this.impostorEmergencyMeetingTimers = [];
    const ballots: NonNullable<ImpostorEmergencyMeeting['results']>['ballots'] =
      [...this.impostorEmergencyMeetingVotes].map(([voterId, targetId]) => {
      const voter = this.board.players.get(voterId);
      const target = this.board.players.get(targetId);
      return {
        voterId,
        voterName: voter?.username ?? voterId,
        targetId,
        targetName: target?.username ?? targetId,
        targetWasImpostor: targetId === this.impostorId
      };
    });
    for (const voterId of this.playersList) {
      if (this.impostorEmergencyMeetingVotes.has(voterId)) continue;
      const voter = this.board.players.get(voterId);
      if (!voter || voter.isDead || voterId.startsWith('bot_')) continue;
      ballots.push({
        voterId,
        voterName: voter.username,
        targetId: null,
        targetName: '',
        targetWasImpostor: false
      });
    }
    const goodTeamWon = ballots.length > 0 && ballots.every(ballot => ballot.targetWasImpostor);
    meeting.phase = 'results';
    meeting.phaseEndsAt = Date.now() + IMPOSTOR_EMERGENCY_MEETING_RESULTS_MS;
    meeting.votesCast = ballots.length;
    meeting.results = { goodTeamWon, impostorId: this.impostorId, ballots };
    this.emitImpostorState();
    const resultsTimer = setTimeout(() => {
      if (this.impostorEmergencyMeeting?.id !== meeting.id || this.state !== 'playing') return;
      this.startTime = (this.startTime ?? Date.now()) +
        Math.max(0, Date.now() - this.impostorEmergencyMeetingPausedAt);
      this.impostorLayoutChangedAt += Math.max(0, Date.now() - this.impostorEmergencyMeetingPausedAt);
      this.impostorEmergencyMeetingAvailableAt +=
        Math.max(0, Date.now() - this.impostorEmergencyMeetingPausedAt);
      this.impostorEmergencyMeeting = null;
      this.impostorEmergencyMeetingVotes.clear();
      this.finishImpostorGame(goodTeamWon ? 'good' : this.impostorId, 'emergency_meeting');
    }, IMPOSTOR_EMERGENCY_MEETING_RESULTS_MS);
    resultsTimer.unref();
    this.impostorEmergencyMeetingTimers.push(resultsTimer);
  }

  public getPrivateImpostorTrapState(playerId: string): {
    traps: IImpostorTrap[];
    cooldowns: Record<ImpostorTrapType, number>;
  } | null {
    const player = this.board.players.get(playerId);
    const hasRevealedTraps = this.getImpostorBoard().traps.some(trap => trap.isRevealed);
    const mayViewTraps = this.mode === 'impostor'
      ? (playerId === this.impostorId || player?.impostorTool === 'magnifier' || hasRevealedTraps)
      : this.mode === 'infection' && !this.isInfected(playerId);
    if (!this.isImpostorBoardMode() || !mayViewTraps) return null;
    let traps = this.getImpostorBoard().traps.map(trap => ({ ...trap }));
    if (this.mode === 'impostor' && playerId !== this.impostorId && player?.impostorTool !== 'magnifier') {
      traps = traps.filter(trap => trap.isRevealed);
    }
    return {
      traps,
      cooldowns: this.getImpostorTrapCooldowns(playerId)
    };
  }

  private getImpostorTrapCooldowns(playerId?: string, now: number = Date.now()): Record<ImpostorTrapType, number> {
    const cooldownUntil = this.mode === 'infection' && playerId
      ? this.infectionTrapCooldownUntil.get(playerId) ?? { ice: 0, teleport: 0 }
      : this.impostorTrapCooldownUntil;
    return {
      ice: Math.max(0, Math.ceil((cooldownUntil.ice - now) / 1000)),
      teleport: Math.max(0, Math.ceil((cooldownUntil.teleport - now) / 1000))
    };
  }

  private emitPrivateImpostorTrapState(): void {
    if (this.mode === 'impostor') {
      for (const playerId of this.playersList) {
        const state = this.getPrivateImpostorTrapState(playerId);
        this.emitImpostorTrapStateIfChanged(
          playerId,
          state ?? { traps: [], cooldowns: { ice: 0, teleport: 0 } }
        );
      }
      return;
    }
    if (this.mode === 'infection') {
      for (const playerId of this.getInfectionSurvivorIds()) {
        const state = this.getPrivateImpostorTrapState(playerId);
        if (state) this.emitImpostorTrapStateIfChanged(playerId, state);
      }
    }
  }

  private emitImpostorTrapStateIfChanged(
    playerId: string,
    state: { traps: IImpostorTrap[]; cooldowns: Record<ImpostorTrapType, number> }
  ): void {
    const signature = JSON.stringify(state);
    if (this.lastImpostorTrapStateByPlayer.get(playerId) === signature) return;
    this.lastImpostorTrapStateByPlayer.set(playerId, signature);
    this.onPrivateStateChange(playerId, 'impostorTrapState', state);
  }

  public emitPrivateImpostorFootprints(): void {
    if (this.mode !== 'impostor') return;
    const now = Date.now();
    this.getImpostorBoard().cleanupExpiredFootprints(now);
    const impostor = this.impostorId ? this.board.players.get(this.impostorId) : null;
    const footprints = this.getImpostorBoard().footprints
      .filter(fp => {
        if (!impostor) return true;
        const distToImpostor = Math.max(Math.abs(impostor.x - fp.x), Math.abs(impostor.y - fp.y));
        return distToImpostor > 2;
      })
      .map(fp => ({ ...fp }));
    const footprintSignature = footprints
      .map(footprint => `${footprint.id}:${footprint.x}:${footprint.y}:${footprint.createdAt}`)
      .join('|');
    for (const playerId of this.playersList) {
      if (playerId.startsWith('bot_')) continue;
      const player = this.board.players.get(playerId);
      const visibleFootprints = player?.impostorTool === 'magnifier' ? footprints : [];
      const signature = player?.impostorTool === 'magnifier' ? footprintSignature : '';
      if (this.lastImpostorFootprintsByPlayer.get(playerId) === signature) continue;
      this.lastImpostorFootprintsByPlayer.set(playerId, signature);
      this.onPrivateStateChange(playerId, 'impostorFootprints', visibleFootprints);
    }
  }

  private emitPrivateImpostorActionStates(): void {
    if (!this.isImpostorBoardMode()) return;
    for (const playerId of this.playersList) {
      const role = this.getPrivateImpostorRole(playerId);
      const player = this.board.players.get(playerId);
      if (!role || !player) continue;
      const actionState = {
        canBreakBlock: role.canBreakBlock,
        canPlaceWall: role.canPlaceWall,
        canRescue: role.canRescue,
        isInPrison: player.isInPrison,
        wallPlacementCooldownUntil: role.wallPlacementCooldownUntil
      };
      const signature = JSON.stringify(actionState);
      if (this.lastImpostorActionStateByPlayer.get(playerId) === signature) continue;
      this.lastImpostorActionStateByPlayer.set(playerId, signature);
      this.onPrivateStateChange(playerId, 'impostorActionState', {
        ...actionState,
        serverTime: Date.now()
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
    const impostorBoard = this.getInfectionBoard();
    let boardChanged = false;

    for (const playerId of this.getInfectionSurvivorIds()) {
      const player = this.board.players.get(playerId);
      if (!player) continue;
      const isInside = impostorBoard.isSafeZoneCell(player.x, player.y);
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
      const destination = impostorBoard.ejectPlayerFromSafeZone(playerId);
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

    if (boardChanged) this.onStateChange('impostorStateChanged', this.getImpostorStateData());
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

  private isLastInfectionSurvivor(playerId: string): boolean {
    const survivors = this.getInfectionSurvivorIds();
    return survivors.length === 1 && survivors[0] === playerId;
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
      isLastSurvivor: boolean;
      lastSurvivorTeleportCooldownUntil: number;
      lastSurvivorPowerCooldowns: Record<InfectionLastSurvivorPower, number>;
      lastSurvivorCountdownUntil: number;
      burnUntil: number;
      serverTime: number;
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
        playerCount: players.filter(player => !player.isDead).length,
        isLastSurvivor: this.isLastInfectionSurvivor(playerId),
        lastSurvivorTeleportCooldownUntil:
          this.getInfectionLastSurvivorPowerCooldowns(playerId).teleport,
        lastSurvivorPowerCooldowns: this.getInfectionLastSurvivorPowerCooldowns(playerId),
        lastSurvivorCountdownUntil: this.infectionLastSurvivorCountdownUntil,
        burnUntil: this.infectionBurnUntil,
        serverTime: Date.now()
      };
    }

  private getInfectionLastSurvivorPowerCooldowns(
    playerId: string
  ): Record<InfectionLastSurvivorPower, number> {
    const cooldowns = this.infectionLastSurvivorPowerCooldownUntil.get(playerId);
    const generalCooldownUntil = this.infectionLastSurvivorGeneralCooldownUntil.get(playerId) ?? 0;
    return {
      ghost: Math.max(cooldowns?.ghost ?? 0, generalCooldownUntil),
      shield: Math.max(cooldowns?.shield ?? 0, generalCooldownUntil),
      invisible: Math.max(cooldowns?.invisible ?? 0, generalCooldownUntil),
      teleport: Math.max(cooldowns?.teleport ?? 0, generalCooldownUntil)
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

    private expireImpostorPlayerEffects(now: number = Date.now()): boolean {
    let expired = false;
    for (const player of this.board.players.values()) {
      if (player.impostorFrozenUntil > 0 && player.impostorFrozenUntil <= now) {
        player.impostorFrozenUntil = 0;
        expired = true;
      }
      if (player.impostorTeleportingUntil > 0 && player.impostorTeleportingUntil <= now) {
        player.impostorTeleportingUntil = 0;
        expired = true;
      }
      if (player.invisibleUntil > 0 && player.invisibleUntil <= now) {
        player.invisibleUntil = 0;
        expired = true;
      }
      if (player.impostorShieldExpiresAt > 0 && player.impostorShieldExpiresAt <= now) {
        player.impostorShieldExpiresAt = 0;
        player.impostorShieldActive = false;
        expired = true;
      }
    }
    return expired;
  }

  private scheduleImpostorShieldRespawn(): void {
    const timer = setTimeout(() => {
      this.impostorShieldRespawnTimers.delete(timer);
      if (this.state !== 'playing') return;
      this.getImpostorBoard().spawnShieldPickups(IMPOSTOR_SHIELD_PICKUP_COUNT);
      this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    }, IMPOSTOR_SHIELD_RESPAWN_MS);
    timer.unref();
    this.impostorShieldRespawnTimers.add(timer);
  }

  public placeImpostorTrap(playerId: string, type: ImpostorTrapType, x: number, y: number): boolean {
    const player = this.board.players.get(playerId);
    const canPlaceTrap = this.mode === 'impostor'
      ? playerId === this.impostorId
      : this.mode === 'infection' && !this.isInfected(playerId) &&
        !this.isLastInfectionSurvivor(playerId);
    if (!this.isImpostorBoardMode() || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        this.isInfectionBurning() ||
        !canPlaceTrap || !player || player.isDead ||
        player.isInPrison || player.hasImpostorEscaped ||
        (this.mode === 'infection' && (x !== player.x || y !== player.y)) ||
        (type !== 'ice' && type !== 'teleport') ||
        // Límite de 5 trampas por tipo comentado por ahora para permitir colocar todas las que quiera:
        // (this.mode === 'impostor' &&
        //   this.getImpostorBoard().traps.filter(trap => trap.type === type).length >= IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE) ||
        (this.mode === 'infection'
          ? (this.infectionTrapCooldownUntil.get(playerId)?.[type] ?? 0)
          : this.impostorTrapCooldownUntil[type]) > Date.now() ||
        !this.getImpostorBoard().canPlaceTrap(x, y, playerId)) return false;

    const trap: IImpostorTrap = {
      id: `impostor_trap_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      x,
      y
    };
    if (!this.getImpostorBoard().placeTrap(trap, playerId)) return false;
    if (this.mode === 'infection') {
      const cooldowns = this.infectionTrapCooldownUntil.get(playerId) ?? { ice: 0, teleport: 0 };
      const cooldownDuration = this.isLastInfectionSurvivor(playerId)
        ? INFECTION_LAST_SURVIVOR_TRAP_COOLDOWN_MS
        : IMPOSTOR_TRAP_COOLDOWN_MS;
      this.infectionTrapCooldownUntil.set(playerId, {
        ...cooldowns,
        [type]: Date.now() + cooldownDuration
      });
    } else {
      this.impostorTrapCooldownUntil[type] = Date.now() + IMPOSTOR_TRAP_COOLDOWN_MS;
    }
    this.recordPlayerActivity(playerId);
    this.emitPrivateImpostorTrapState();
    return true;
  }

  public removeImpostorTrap(_playerId: string, _trapId: string): boolean {
    // Funcionalidad de retiro manual de trampas por parte del impostor comentada por ahora
    return false;
    /*
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        playerId !== this.impostorId) return false;
    const player = this.board.players.get(playerId);
    const trap = this.getImpostorBoard().traps.find(item => item.id === trapId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped || !trap) return false;
    const removed = this.getImpostorBoard().removeTrapAt(trap.x, trap.y);
    if (!removed) return false;
    this.recordPlayerActivity(playerId);
    this.emitPrivateImpostorTrapState();
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    return true;
    */
  }

  public takeImpostorTool(playerId: string, toolId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive()) return false;
    const player = this.board.players.get(playerId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        !this.getImpostorBoard().takeTool(playerId, toolId)) return false;
    if (player.impostorTool === 'radar') {
      this.radarGraceUntil = Date.now() + IMPOSTOR_RADAR_GRACE_PERIOD_MS;
    }
    this.cancelImpostorGeneratorRepair(playerId);
    this.cancelImpostorDoorRepair(playerId);
    this.cancelImpostorTrapDeactivation(playerId);
    this.recordPlayerActivity(playerId);
    this.emitPrivateImpostorTrapState();
    this.emitPrivateImpostorFootprints();
    this.emitImpostorState();
    return true;
  }

  public dropImpostorTool(playerId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        !this.playersList.includes(playerId)) return false;
    const player = this.board.players.get(playerId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        !this.getImpostorBoard().dropTool(playerId)) return false;
    this.cancelImpostorGeneratorRepair(playerId);
    this.cancelImpostorDoorRepair(playerId);
    this.cancelImpostorTrapDeactivation(playerId);
    this.recordPlayerActivity(playerId);
    this.emitPrivateImpostorTrapState();
    this.emitPrivateImpostorFootprints();
    this.emitImpostorState();
    return true;
  }

  public requestImpostorTool(requesterId: string, targetId?: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' ||
        this.isImpostorEmergencyMeetingActive() || !this.playersList.includes(requesterId)) return false;
    const requester = this.getImpostorBoard().players.get(requesterId);
    if (!requester || requester.isDead || requester.isInPrison || requester.hasImpostorEscaped ||
        !this.getImpostorBoard().isSafeZoneCell(requester.x, requester.y) ||
        !this.getImpostorBoard().isAdjacentToToolTable(requester.x, requester.y)) return false;

    const radarTool = this.getImpostorBoard().tools.find(tool => tool.type === 'radar');
    const holderId = targetId || radarTool?.carriedBy;
    if (!holderId || holderId === requesterId) return false;
    const holder = this.getImpostorBoard().players.get(holderId);
    if (!holder || holder.impostorTool !== 'radar') return false;

    if (Date.now() < this.radarGraceUntil) return false;

    if ([...this.impostorToolRequests.values()].some(request =>
      request.requesterId === requesterId || request.targetId === holderId
    )) return false;

    const requestId = `${Date.now()}-${++this.impostorToolRequestSequence}`;
    const timeout = setTimeout(() => {
      const request = this.impostorToolRequests.get(requestId);
      if (!request) return;
      this.impostorToolRequests.delete(requestId);
      this.onPrivateStateChange(request.targetId, 'impostorToolRequestClosed', { requestId });
      const currentHolder = this.getImpostorBoard().players.get(request.targetId);
      const currentRequester = this.getImpostorBoard().players.get(request.requesterId);
      if (currentHolder?.impostorTool === 'radar' && currentRequester && !currentRequester.isDead &&
          !currentRequester.isInPrison && !currentRequester.hasImpostorEscaped &&
          this.getImpostorBoard().isSafeZoneCell(currentRequester.x, currentRequester.y)) {
        this.getImpostorBoard().transferTool(request.targetId, request.requesterId);
        this.radarGraceUntil = Date.now() + IMPOSTOR_RADAR_GRACE_PERIOD_MS;
        this.cancelImpostorGeneratorRepair(request.targetId);
        this.cancelImpostorGeneratorRepair(request.requesterId);
        this.cancelImpostorDoorRepair(request.targetId);
        this.cancelImpostorDoorRepair(request.requesterId);
        this.recordPlayerActivity(request.targetId);
        this.recordPlayerActivity(request.requesterId);
        this.emitPrivateImpostorTrapState();
        this.emitPrivateImpostorFootprints();
        this.emitImpostorState();
        this.onPrivateStateChange(request.requesterId, 'impostorToolRequestResult', {
          requestId,
          status: 'accepted',
          playerName: currentHolder.username,
          toolType: 'radar'
        });
      } else {
        this.onPrivateStateChange(request.requesterId, 'impostorToolRequestResult', {
          requestId,
          status: 'expired',
          playerName: currentHolder?.username,
          toolType: 'radar'
        });
      }
    }, IMPOSTOR_RADAR_REQUEST_TIMEOUT_MS);
    timeout.unref();
    this.impostorToolRequests.set(requestId, { requesterId, targetId: holderId, toolType: 'radar', timeout });
    this.onPrivateStateChange(holderId, 'impostorToolRequestReceived', {
      requestId,
      requesterId,
      requesterName: requester.username,
      toolType: 'radar',
      durationMs: IMPOSTOR_RADAR_REQUEST_TIMEOUT_MS
    });
    return true;
  }

  public respondToImpostorToolRequest(
    targetId: string,
    requestId: string,
    accepted: boolean
  ): boolean {
    const request = this.impostorToolRequests.get(requestId);
    if (!request || request.targetId !== targetId) return false;
    this.clearImpostorToolRequest(requestId);

    const holder = this.getImpostorBoard().players.get(targetId);
    const requester = this.getImpostorBoard().players.get(request.requesterId);
    if (!accepted) {
      this.onPrivateStateChange(request.requesterId, 'impostorToolRequestResult', {
        requestId,
        status: 'denied',
        playerName: holder?.username,
        toolType: request.toolType
      });
      return true;
    }

    const transferred = holder?.impostorTool === request.toolType &&
      requester && !requester.isDead && !requester.isInPrison && !requester.hasImpostorEscaped &&
      this.getImpostorBoard().transferTool(targetId, request.requesterId);
    if (!transferred) {
      this.onPrivateStateChange(request.requesterId, 'impostorToolRequestResult', {
        requestId,
        status: 'unavailable',
        playerName: holder?.username,
        toolType: request.toolType
      });
      return true;
    }

    this.radarGraceUntil = Date.now() + IMPOSTOR_RADAR_GRACE_PERIOD_MS;
    this.cancelImpostorGeneratorRepair(targetId);
    this.cancelImpostorGeneratorRepair(request.requesterId);
    this.cancelImpostorDoorRepair(targetId);
    this.cancelImpostorDoorRepair(request.requesterId);
    this.recordPlayerActivity(targetId);
    this.recordPlayerActivity(request.requesterId);
    this.emitPrivateImpostorTrapState();
    this.emitPrivateImpostorFootprints();
    this.emitImpostorState();
    this.onPrivateStateChange(request.requesterId, 'impostorToolRequestResult', {
      requestId,
      status: 'accepted',
      playerName: holder?.username,
      toolType: request.toolType
    });
    return true;
  }

  private arePlayersEligibleForToolTransfer(requesterId: string, targetId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' ||
        this.isImpostorEmergencyMeetingActive() || requesterId === targetId ||
        !this.playersList.includes(requesterId) || !this.playersList.includes(targetId)) return false;
    const requester = this.getImpostorBoard().players.get(requesterId);
    const target = this.getImpostorBoard().players.get(targetId);
    if (!requester || !target || requester.isDead || target.isDead ||
        requester.isInPrison || target.isInPrison ||
        requester.hasImpostorEscaped || target.hasImpostorEscaped ||
        !this.getImpostorBoard().isSafeZoneCell(requester.x, requester.y) ||
        !this.getImpostorBoard().isSafeZoneCell(target.x, target.y)) return false;
    return Math.max(Math.abs(requester.x - target.x), Math.abs(requester.y - target.y)) <= 1 &&
      (requester.x !== target.x || requester.y !== target.y);
  }

  private clearImpostorToolRequest(requestId: string): void {
    const request = this.impostorToolRequests.get(requestId);
    if (!request) return;
    clearTimeout(request.timeout);
    this.impostorToolRequests.delete(requestId);
  }

  private clearImpostorToolRequests(): void {
    for (const requestId of this.impostorToolRequests.keys()) {
      this.clearImpostorToolRequest(requestId);
    }
  }

  public damageImpostorGenerator(playerId: string, generatorId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        playerId !== this.impostorId) return false;
    const player = this.board.players.get(playerId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        this.getImpostorGeneratorSabotageCooldownSeconds() > 0) return false;
    const generator = this.getImpostorBoard().damageGenerator(generatorId);
    if (!generator) return false;
    this.impostorGeneratorSabotageCooldownUntil = Date.now() + IMPOSTOR_GENERATOR_SABOTAGE_COOLDOWN_MS;
    for (const [deactivatorId] of this.impostorTrapDeactivationTimers) {
      const p = this.board.players.get(deactivatorId);
      if (p && !this.getImpostorBoard().isCellPowered(p.x, p.y)) {
        this.cancelImpostorTrapDeactivation(deactivatorId);
      }
    }
    this.recordPlayerActivity(playerId);
    this.emitImpostorPublicEvent('generator_sabotaged', {
      generatorSector: generator.sector,
      playerName: player.username
    });
    this.emitImpostorState();
    return true;
  }

  public sabotageImpostorDoor(playerId: string, exitId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        playerId !== this.impostorId) return false;
    const player = this.board.players.get(playerId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        this.getImpostorExitSealCooldownSeconds() > 0) return false;
    const board = this.getImpostorBoard();
    const exitNumber = board.sealImpostorExit(exitId);
    if (exitNumber === null) return false;
    const now = Date.now();
    this.impostorExitSealCooldownUntil = now + IMPOSTOR_GENERATOR_SABOTAGE_COOLDOWN_MS;
    this.recordPlayerActivity(playerId);
    this.emitImpostorPublicEvent('impostor_exit_sealed', {
      exitNumber,
      playerName: player.username
    });
    this.onPrivateStateChange(this.impostorId, 'impostorRole', this.getPrivateImpostorRole(this.impostorId));
    this.emitImpostorState();
    if (board.exits.every(exit => exit.isSealed)) {
      this.finishImpostorGame(this.impostorId, 'doors_sabotaged');
    }
    return true;
  }

  public beginImpostorDoorRepair(playerId: string, exitId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive()) return false;
    const player = this.board.players.get(playerId);
    const board = this.getImpostorBoard();
    const exit = board.exits.find(item => item.id === exitId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        player.impostorTool !== 'wrench' || !exit?.isSealed ||
        !board.isAdjacentToImpostorExit(exit, player.x, player.y) ||
        this.impostorDoorRepairTimers.has(playerId)) return false;
    this.recordPlayerActivity(playerId);
    const exitNumber = board.exits.indexOf(exit) + 1;
    const timer = setTimeout(() => {
      this.impostorDoorRepairTimers.delete(playerId);
      this.onPrivateStateChange(playerId, 'impostorDoorRepairEnded', {});
      const currentPlayer = this.board.players.get(playerId);
      const currentExit = this.getImpostorBoard().exits.find(item => item.id === exitId);
      if (this.state !== 'playing' || !currentPlayer || currentPlayer.impostorTool !== 'wrench' ||
          currentPlayer.isDead || currentPlayer.isInPrison || currentPlayer.hasImpostorEscaped ||
          !currentExit?.isSealed ||
          !this.getImpostorBoard().isAdjacentToImpostorExit(currentExit, currentPlayer.x, currentPlayer.y)) return;
      if (this.getImpostorBoard().openImpostorExit(exitId) === null) return;
      this.emitImpostorPublicEvent('impostor_exit_opened', {
        exitNumber,
        playerName: currentPlayer.username
      });
      this.emitImpostorState();
    }, IMPOSTOR_GENERATOR_REPAIR_DURATION_MS);
    timer.unref();
    this.impostorDoorRepairTimers.set(playerId, { exitId, timer });
    this.onPrivateStateChange(playerId, 'impostorDoorRepairStarted', {
      exitId,
      exitNumber,
      durationMs: IMPOSTOR_GENERATOR_REPAIR_DURATION_MS,
      endsAt: Date.now() + IMPOSTOR_GENERATOR_REPAIR_DURATION_MS
    });
    return true;
  }

  private cancelImpostorDoorRepair(playerId: string): void {
    const repair = this.impostorDoorRepairTimers.get(playerId);
    if (!repair) return;
    clearTimeout(repair.timer);
    this.impostorDoorRepairTimers.delete(playerId);
    this.onPrivateStateChange(playerId, 'impostorDoorRepairEnded', {});
  }

  public beginImpostorGeneratorRepair(playerId: string, generatorId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive()) return false;
    const player = this.board.players.get(playerId);
    const generator = this.getImpostorBoard().generators.find(item => item.id === generatorId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        player.impostorTool !== 'wrench' || !generator?.isDamaged ||
        !this.getImpostorBoard().isAdjacentToGenerator(generator, player.x, player.y) ||
        this.impostorGeneratorRepairTimers.has(playerId)) return false;
    this.recordPlayerActivity(playerId);
    const timer = setTimeout(() => {
      this.impostorGeneratorRepairTimers.delete(playerId);
      this.onPrivateStateChange(playerId, 'impostorGeneratorRepairEnded', {});
      const currentPlayer = this.board.players.get(playerId);
      const currentGenerator = this.getImpostorBoard().generators.find(item => item.id === generatorId);
      if (this.state !== 'playing' || !currentPlayer || currentPlayer.impostorTool !== 'wrench' ||
          currentPlayer.isDead || currentPlayer.isInPrison || currentPlayer.hasImpostorEscaped ||
          !currentGenerator?.isDamaged ||
          !this.getImpostorBoard().isAdjacentToGenerator(currentGenerator, currentPlayer.x, currentPlayer.y)) {
        return;
      }
      const repaired = this.getImpostorBoard().repairGenerator(generatorId);
      if (!repaired) return;
      this.emitImpostorPublicEvent('generator_repaired', {
        generatorSector: repaired.sector,
        playerName: currentPlayer.username
      });
      this.emitImpostorState();
    }, IMPOSTOR_GENERATOR_REPAIR_DURATION_MS);
    timer.unref();
    this.impostorGeneratorRepairTimers.set(playerId, timer);
    this.onPrivateStateChange(playerId, 'impostorGeneratorRepairStarted', {
      generatorId,
      generatorSector: generator.sector,
      durationMs: IMPOSTOR_GENERATOR_REPAIR_DURATION_MS,
      endsAt: Date.now() + IMPOSTOR_GENERATOR_REPAIR_DURATION_MS
    });
    return true;
  }

  private cancelImpostorGeneratorRepair(playerId: string): void {
    const timer = this.impostorGeneratorRepairTimers.get(playerId);
    if (!timer) return;
    clearTimeout(timer);
    this.impostorGeneratorRepairTimers.delete(playerId);
    this.onPrivateStateChange(playerId, 'impostorGeneratorRepairEnded', {});
  }

  public revealImpostorTrap(playerId: string, trapId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive()) return false;
    const player = this.board.players.get(playerId);
    const trap = this.getImpostorBoard().traps.find(item => item.id === trapId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        player.impostorTool !== 'magnifier' || !trap || trap.isRevealed ||
        !this.getImpostorBoard().isCellPowered(player.x, player.y) ||
        !this.getImpostorBoard().isCellPowered(trap.x, trap.y) ||
        Math.max(Math.abs(player.x - trap.x), Math.abs(player.y - trap.y)) > 3) {
      return false;
    }
    trap.isRevealed = true;
    this.recordPlayerActivity(playerId);
    this.emitImpostorPublicEvent('trap_revealed', {
      trapType: trap.type,
      playerName: player.username
    });
    this.emitPrivateImpostorTrapState();
    this.emitImpostorState();
    return true;
  }

  public beginImpostorTrapDeactivation(playerId: string, trapId: string): boolean {
    if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive()) return false;
    const player = this.board.players.get(playerId);
    const trap = this.getImpostorBoard().traps.find(item => item.id === trapId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        player.impostorTool !== 'hammer' || !trap || !trap.isRevealed ||
        !this.getImpostorBoard().isCellPowered(player.x, player.y) ||
        !this.getImpostorBoard().isCellPowered(trap.x, trap.y) ||
        Math.max(Math.abs(player.x - trap.x), Math.abs(player.y - trap.y)) > 1 ||
        this.impostorTrapDeactivationTimers.has(playerId)) return false;
    this.recordPlayerActivity(playerId);
    const durationMs = 5000;
    const timer = setTimeout(() => {
      this.impostorTrapDeactivationTimers.delete(playerId);
      this.onPrivateStateChange(playerId, 'impostorTrapDeactivationEnded', {});
      const currentPlayer = this.board.players.get(playerId);
      const currentTrap = this.getImpostorBoard().traps.find(item => item.id === trapId);
      if (this.state !== 'playing' || !currentPlayer || currentPlayer.impostorTool !== 'hammer' ||
          currentPlayer.isDead || currentPlayer.isInPrison || currentPlayer.hasImpostorEscaped ||
          !currentTrap || !currentTrap.isRevealed ||
          Math.max(Math.abs(currentPlayer.x - currentTrap.x), Math.abs(currentPlayer.y - currentTrap.y)) > 1 ||
          !this.getImpostorBoard().isCellPowered(currentPlayer.x, currentPlayer.y) ||
          !this.getImpostorBoard().isCellPowered(currentTrap.x, currentTrap.y)) {
        return;
      }
      const removed = this.getImpostorBoard().removeTrapAt(currentTrap.x, currentTrap.y);
      if (!removed) return;
      this.emitImpostorPublicEvent('trap_deactivated', {
        trapType: removed.type,
        playerName: currentPlayer.username
      });
      this.emitPrivateImpostorTrapState();
      this.emitImpostorState();
    }, durationMs);
    timer.unref();
    this.impostorTrapDeactivationTimers.set(playerId, timer);
    this.onPrivateStateChange(playerId, 'impostorTrapDeactivationStarted', {
      trapId,
      trapType: trap.type,
      durationMs,
      endsAt: Date.now() + durationMs
    });
    return true;
  }

  public cancelImpostorTrapDeactivation(playerId: string): void {
    const timer = this.impostorTrapDeactivationTimers.get(playerId);
    if (!timer) return;
    clearTimeout(timer);
    this.impostorTrapDeactivationTimers.delete(playerId);
    this.onPrivateStateChange(playerId, 'impostorTrapDeactivationEnded', {});
  }

  private emitImpostorState(): void {
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
  }

  private triggerImpostorTrap(playerId: string, x: number, y: number): boolean {
    const player = this.board.players.get(playerId);
    const impostorBoard = this.getImpostorBoard();
    if (!player || (this.mode === 'impostor' && playerId === this.impostorId) ||
        (this.mode === 'infection' && !this.isInfected(playerId))) return false;
    const trap = impostorBoard.removeTrapAt(x, y);
    if (!trap) return false;

    const shielded = player.impostorShieldActive &&
      (this.mode !== 'infection' || player.impostorShieldExpiresAt > Date.now());
    if (player.impostorShieldActive && !shielded) {
      player.impostorShieldActive = false;
      player.impostorShieldExpiresAt = 0;
    }
    if (shielded) {
      player.impostorShieldActive = false;
      player.impostorShieldExpiresAt = 0;
    }
    if (!shielded && trap.type === 'ice') {
      const freezeDuration = this.mode === 'infection'
        ? INFECTION_ICE_TRAP_DURATION_MS
        : IMPOSTOR_ICE_TRAP_DURATION_MS;
      player.impostorFrozenUntil = Date.now() + freezeDuration;
    } else if (!shielded && trap.type === 'teleport') {
      const fromX = player.x;
      const fromY = player.y;
      const destination = impostorBoard.teleportPlayerToRandomBorder(playerId);
      if (destination) {
        player.impostorTeleportingUntil = Date.now() + IMPOSTOR_TELEPORT_ANIMATION_MS;
        this.impostorMoveAt.set(playerId, Date.now());
        const newlyCaptured = this.updateImpostorPrisons();
        this.emitImpostorCaptureEvents(this.getImpostorCaptureOwner(newlyCaptured), newlyCaptured);
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
    this.onStateChange('impostorTrapTriggered', {
      playerId,
      type: trap.type,
      shielded
    });
    if (this.mode === 'infection') {
      this.emitImpostorPublicEvent('infection_trap_triggered', {
        playerId,
        playerName: player.username,
        trapType: trap.type,
        shielded
      });
    } else {
      this.emitImpostorPublicEvent('impostor_trap_triggered', {
        playerId,
        playerName: player.username,
        trapType: trap.type,
        shielded
      });
    }
    this.emitPrivateImpostorTrapState();
    return true;
  }

  public beginImpostorLayoutChange(playerId: string): boolean {
    if (this.impostorLayoutChangeInProgress || !this.canChangeImpostorLayout(playerId)) return false;
    this.impostorLayoutChangeInProgress = true;
    return true;
  }

  public completeImpostorLayoutChange(playerId: string, random: () => number = Math.random): boolean {
    if (!this.impostorLayoutChangeInProgress) return false;
    try {
      if (!this.canChangeImpostorLayout(playerId)) return false;
      const impostorBoard = this.getImpostorBoard();
      impostorBoard.reshuffleImpostor(random, true, this.mode === 'impostor');
      if (this.mode === 'infection') {
        if (this.isLastInfectionSurvivor(playerId)) {
          this.getInfectionBoard().scatterAllPlayersRandomly(random);
          this.infectionSafeZoneEnteredAt.clear();
          for (const timer of this.infectionSafeZoneTimers.values()) clearTimeout(timer);
          this.infectionSafeZoneTimers.clear();
        }
        this.getInfectionBoard().respawnInfectionPowerups(
          INFECTION_GHOST_PICKUP_COUNT,
          INFECTION_INVISIBLE_PICKUP_COUNT,
          INFECTION_SHIELD_PICKUP_COUNT,
          random
        );
      }
      if (this.mode === 'impostor' && this.impostorId) {
        this.onPrivateStateChange(this.impostorId, 'impostorRole', this.getPrivateImpostorRole(this.impostorId));
      }
      if (this.mode === 'infection') this.emitPrivateImpostorActionStates();
      this.updateImpostorPrisons();
      this.impostorLayoutChangedAt = Date.now();
      this.recordPlayerActivity(playerId);
      const player = this.board.players.get(playerId);
      this.emitImpostorPublicEvent('impostor_changed', {
        playerId,
        playerName: player?.username
      });
      this.onStateChange('impostorStateChanged', {
        ...this.getImpostorStateData(),
        impostorSecondsUntilChange: this.getImpostorSecondsUntilChange()
      });
      if (this.mode === 'infection') this.emitImpostorGhostPickups();
      return true;
    } finally {
      this.impostorLayoutChangeInProgress = false;
    }
  }

  public changeImpostorLayout(playerId: string, random: () => number = Math.random): boolean {
    if (this.isImpostorEmergencyMeetingActive()) return false;
    if (!this.beginImpostorLayoutChange(playerId)) return false;
    return this.completeImpostorLayoutChange(playerId, random);
  }

  private canChangeImpostorLayout(playerId: string): boolean {
    const player = this.board.players.get(playerId);
    const canChange = this.mode === 'impostor'
      ? playerId === this.impostorId
      : this.mode === 'infection' && this.isLastInfectionSurvivor(playerId);
    return this.isImpostorBoardMode() && this.state === 'playing' && !this.isInfectionBurning() &&
      canChange && !!player && !player.isDead && !player.isInPrison && !player.hasImpostorEscaped &&
      this.getImpostorSecondsUntilChange() === 0;
  }

  private handleTimeout() {
    if (this.isImpostorBoardMode()) return;
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
    if (this.isImpostorBoardMode() || this.playersList.length === 0 ||
        this.pendingBoostDecision || this.state !== 'playing') return;

    const previousTurnIndex = this.currentTurnIndex;
    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.playersList.length;
      attempts++;
      const p = this.board.players.get(this.getCurrentPlayer());
      if (p && !p.isDead &&
          (this.mode !== '2v2' || !p.hasReachedGoal || p.wallsLeft > 0)) break;
    } while (attempts < this.playersList.length);

    if (previousTurnIndex === this.playersList.length - 1 && this.currentTurnIndex === 0) {
      this.completedRounds += 1;
      this.handleRoundBasedBoostRotation();
      this.applyScheduledBoostRespawns();
    }

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
    return this.isImpostorBoardMode() ? '' : this.playersList[this.currentTurnIndex];
  }

  public getPrivateImpostorRole(playerId: string): {
    role: 'impostor' | 'good' | 'infected';
    canBreakBlock: boolean;
    canPlaceWall: boolean;
    canRescue: boolean;
    exitSealCooldownUntil: number;
    wallPlacementCooldownUntil: number;
  } | null {
    if (!this.isImpostorBoardMode() || !this.playersList.includes(playerId) || playerId.startsWith('bot_')) {
      return null;
    }
    const isInfection = this.mode === 'infection';
    const isImpostor = !isInfection && playerId === this.impostorId;
    const isInfected = isInfection && this.isInfected(playerId);
    const player = this.board.players.get(playerId);
    const canAct = !!player && !player.isDead && !player.hasImpostorEscaped && !player.isInPrison;
    const wallPlacementCooldownUntil = this.impostorWallPlacementCooldownUntil.get(playerId) ?? 0;
    return {
      role: isInfection ? (isInfected ? 'infected' : 'good') : (isImpostor ? 'impostor' : 'good'),
      canBreakBlock: canAct && (isInfection || player?.impostorTool === 'hammer'),
      canPlaceWall: canAct && (isInfection
        ? !isInfected && !this.isLastInfectionSurvivor(playerId)
        : isImpostor) &&
        wallPlacementCooldownUntil <= Date.now(),
      canRescue: canAct && !isInfection,
      exitSealCooldownUntil: isImpostor ? this.impostorExitSealCooldownUntil : 0,
      wallPlacementCooldownUntil
    };
  }

  public getImpostorRescueStatus(): { capturedPlayers: string[]; availableRescuers: number } {
    const humanPlayers = this.playersList
      .filter(id => !id.startsWith('bot_'))
      .map(id => this.board.players.get(id))
      .filter((player): player is Player => !!player && !player.isDead && !player.hasImpostorEscaped);
    return {
      capturedPlayers: humanPlayers.filter(player => player.isInPrison).map(player => player.id),
      availableRescuers: humanPlayers.filter(player => !player.isInPrison).length
    };
  }

  public getImpostorPublicActionCounts(): Record<string, number> {
    return Object.fromEntries(this.playersList
      .filter(playerId => !playerId.startsWith('bot_'))
      .map(playerId => [playerId, this.impostorActionsUsed.get(playerId) || 0]));
  }

  public getImpostorPublicEvents(): typeof this.impostorPublicEvents {
    return this.impostorPublicEvents.map(event => ({ ...event }));
  }

  public getImpostorAuditSnapshot(): Record<string, unknown> {
    if (this.mode !== 'impostor' || !(this.board instanceof ImpostorBoard)) {
      throw new Error('Impostor audit snapshots are only available for impostor games.');
    }
    const impostorBoard = this.board;
    return {
      matchId: this.id,
      mode: this.mode,
      state: this.state,
      winner: this.winner,
      impostorId: this.impostorId,
      endReason: this.impostorEndReason,
      startedAt: this.startTime ?? null,
      capturedAt: Date.now(),
      players: this.playersList.map(playerId => {
        const player = impostorBoard.players.get(playerId);
        if (!player) throw new Error(`Impostor audit player ${playerId} is missing from the board.`);
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
          hasImpostorKey: player.hasImpostorKey,
          hasImpostorKeyDelivered: player.hasImpostorKeyDelivered,
          hasImpostorEscaped: player.hasImpostorEscaped,
          ghostModeExpiresAt: player.ghostModeExpiresAt
        };
      }),
      board: {
        size: impostorBoard.size,
        walls: impostorBoard.walls.map(wall => ({
          id: wall.id,
          ownerId: wall.ownerId,
          x: wall.x,
          y: wall.y,
          isHorizontal: wall.isHorizontal,
          isPrisonBlock: wall.isPrisonBlock,
          isSabotageWall: wall.isSabotageWall,
          isRescueWall: wall.isRescueWall
        })),
        keys: impostorBoard.keys.map(key => ({ ...key })),
        exits: impostorBoard.exits.map(exit => ({ ...exit })),
        teleports: impostorBoard.teleports.map(teleport => ({ ...teleport })),
        generators: impostorBoard.generators.map(generator => ({ ...generator })),
        tools: impostorBoard.tools.map(tool => ({ ...tool })),
        traps: impostorBoard.traps.map(trap => ({ ...trap }))
      },
      publicEvents: this.getImpostorPublicEvents(),
      publicActionCounts: this.getImpostorPublicActionCounts(),
    };
  }

  private recordImpostorAction(playerId: string): void {
    this.impostorActionsUsed.set(playerId, (this.impostorActionsUsed.get(playerId) || 0) + 1);
  }

  private getImpostorStateData(
    board: ReturnType<ImpostorBoard['toDTO']> = this.getImpostorBoard().toDTO()
  ): {
    board: ReturnType<ImpostorBoard['toDTO']>;
    rescueStatus: ReturnType<GameInstance['getImpostorRescueStatus']>;
    publicActionCounts: Record<string, number>;
    impostorSecondsUntilChange: number;
    impostorGeneratorSabotageSecondsRemaining: number;
    impostorExitSealCooldownUntil: number;
    impostorExitSealSecondsRemaining: number;
    impostorDoorSabotageSecondsRemaining: number;
    impostorExitOpenUsedBy: string[];
    impostorGoodPlayersReturned: number;
    impostorGoodPlayersTotal: number;
    impostorEmergencyMeeting: ImpostorEmergencyMeeting | null;
    impostorEmergencyMeetingSecondsRemaining: number;
    impostorRadarGraceUntil: number;
    impostorRadarGraceRemainingSeconds: number;
  } {
    return {
      board,
      rescueStatus: this.getImpostorRescueStatus(),
      publicActionCounts: this.getImpostorPublicActionCounts(),
      impostorSecondsUntilChange: this.getImpostorSecondsUntilChange(),
      impostorGeneratorSabotageSecondsRemaining: this.getImpostorGeneratorSabotageCooldownSeconds(),
      impostorExitSealCooldownUntil: this.impostorExitSealCooldownUntil,
      impostorExitSealSecondsRemaining: this.getImpostorExitSealCooldownSeconds(),
      impostorDoorSabotageSecondsRemaining: this.getImpostorExitSealCooldownSeconds(),
      impostorEmergencyMeeting: this.getImpostorEmergencyMeetingState(),
      impostorEmergencyMeetingSecondsRemaining: this.getImpostorEmergencyMeetingSecondsRemaining(),
      impostorRadarGraceUntil: this.radarGraceUntil,
      impostorRadarGraceRemainingSeconds: Math.max(0, Math.ceil((this.radarGraceUntil - Date.now()) / 1000)),
      impostorExitOpenUsedBy: [...this.impostorExitOpenUsed],
      impostorGoodPlayersReturned: this.impostorGoodPlayersReturned +
        Number(this.impostorId
          ? this.board.players.get(this.impostorId)?.hasImpostorKeyDelivered === true
          : false),
      impostorGoodPlayersTotal: this.playersList.filter(id =>
        !id.startsWith('bot_') && id !== this.impostorId
      ).length
    };
  }

  private emitImpostorPublicEvent(
    type: string,
    data: Omit<(typeof this.impostorPublicEvents)[number], 'id' | 'type'> = {}
  ): void {
    const event = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      ...data
    };
    this.impostorPublicEvents.push(event);
    this.onStateChange('impostorPublicEvent', event);
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
        ...(!this.isImpostorBoardMode()
          ? { currentTurn, turnSecondsRemaining: this.getRemainingTurnSeconds() }
          : {})
      });
    }
  }

  public recordPlayerActivity(playerId: string): void {
    if (this.state !== 'playing' || playerId.startsWith('bot_') ||
        !this.playersList.includes(playerId) ||
        (!this.isImpostorBoardMode() && this.board.players.get(playerId)?.isDead)) return;

    this.playerLastActivityAt.set(playerId, Date.now());
    if (this.isImpostorBoardMode()) {
      this.scheduleImpostorInactivityTimer();
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
    if (this.isImpostorBoardMode()) return this.executeImpostorMove(playerId, newX, newY);
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
        movementTrailIcon: p.movementTrailIcon,
        boostType: landedBoost?.type,
        teleported: landedBoost?.type === 'portal'
      });
      this.botReactionManager.onPlayerMoved(playerId, newX, newY);
      if (landedBoost?.type === 'portal' &&
          this.board.rotatePortals(this.getPortalSpawnExclusions())) {
        this.broadcastBoostBoard();
      }
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

  private executeImpostorMove(playerId: string, newX: number, newY: number): boolean {
        const player = this.board.players.get(playerId);
        const now = Date.now();
        const previousMoveAt = this.impostorMoveAt.get(playerId) ?? 0;
        if (
          this.state !== 'playing' ||
          this.isImpostorEmergencyMeetingActive() ||
          this.impostorLayoutChangeInProgress ||
          this.isInfectionBurning(now) ||
          playerId.startsWith('bot_') ||
          !player ||
          player.isDead ||
          (this.mode === 'infection' && playerId === this.impostorId &&
            now < (this.startTime ?? 0) + INFECTION_HUNT_DELAY_MS) ||
          now - previousMoveAt < (this.mode === 'infection' &&
            (this.isInfected(playerId) || this.isLastInfectionSurvivor(playerId))
            ? INFECTION_MOVE_INTERVAL_MS
            : 120)
        ) return false;

        this.cancelImpostorGeneratorRepair(playerId);
        this.cancelImpostorDoorRepair(playerId);
        const fromX = player.x;
        const fromY = player.y;
        const infectionBoard = this.mode === 'infection' ? this.getInfectionBoard() : null;
        const wasInSafeZone = infectionBoard?.isSafeZoneCell(fromX, fromY) === true;
        const movesIntoSafeZone = infectionBoard?.isSafeZoneCell(newX, newY) === true && !wasInSafeZone;
        if (infectionBoard && movesIntoSafeZone &&
            (this.isInfected(playerId) ||
             (this.infectionSafeZoneCooldownUntil.get(playerId) ?? 0) > now)) return false;
        if (!this.getImpostorBoard().moveImpostorPlayer(playerId, newX, newY)) return false;
        this.trackInfectionSafeZoneTransition(
          playerId,
          wasInSafeZone,
          infectionBoard?.isSafeZoneCell(newX, newY) === true,
          now
        );
        this.impostorMoveAt.set(playerId, now);
        this.recordPlayerActivity(playerId);
        this.updateImpostorPrisons();
        this.onStateChange('playerMoved', {
          playerId,
          fromX,
          fromY,
          newX,
          newY,
          movementTrailId: player.movementTrailId,
          movementTrailIcon: player.movementTrailIcon
        });
        if (this.mode === 'impostor' && playerId === this.impostorId) {
          this.impostorFootprintStepCount = (this.impostorFootprintStepCount || 0) + 1;
          if (this.impostorFootprintStepCount % 2 === 1) {
            this.getImpostorBoard().addFootprint(newX, newY, now);
          }
          this.emitPrivateImpostorFootprints();
        }
        const key = this.mode === 'impostor'
          ? this.getImpostorBoard().collectKey(playerId, newX, newY, playerId === this.impostorId)
          : null;
        if (key) {
          player.hasImpostorKey = true;
          this.onPrivateStateChange(playerId, 'boostCollected', { playerId, type: 'key' });
          this.emitImpostorPublicEvent('key_collected', { playerName: player.username });
        }
        if (this.mode === 'impostor' && playerId !== this.impostorId &&
            !player.impostorShieldActive &&
            this.getImpostorBoard().collectShieldPickupAt(player.x, player.y)) {
          player.impostorShieldActive = true;
          this.scheduleImpostorShieldRespawn();
          this.onPrivateStateChange(playerId, 'boostCollected', { playerId, type: 'shield' });
        }
        if (this.mode === 'impostor' && playerId !== this.impostorId &&
            this.getImpostorBoard().collectGhostPickupAt(player.x, player.y)) {
          player.ghostModeExpiresAt = Date.now() + IMPOSTOR_GHOST_DURATION_MS;
          player.isInPrison = false;
          this.updateImpostorPrisons();
          this.emitImpostorPublicEvent('impostor_ghost_activated', { playerId, playerName: player.username });
        }
        this.triggerImpostorTrap(playerId, player.x, player.y);
        if (this.mode === 'infection' && !this.isInfected(playerId) &&
            !this.isLastInfectionSurvivor(playerId)) {
          const now = Date.now();
          const hasActivePowerup =
            player.ghostModeExpiresAt > now ||
            player.invisibleUntil > now ||
            (player.impostorShieldActive && player.impostorShieldExpiresAt > now);
          const powerup = this.getInfectionBoard().collectInfectionPowerupAt(
            player.x, player.y, Math.random, hasActivePowerup
          );
          if (powerup === 'ghost') {
            player.ghostModeExpiresAt = Date.now() + INFECTION_GHOST_DURATION_MS;
            this.updateImpostorPrisons();
          } else if (powerup === 'invisible') {
            player.invisibleUntil = Date.now() + INFECTION_INVISIBLE_DURATION_MS;
          } else if (powerup === 'shield') {
            player.impostorShieldActive = true;
            player.impostorShieldExpiresAt = Date.now() + INFECTION_SHIELD_DURATION_MS;
          }
          if (powerup) {
            this.onPrivateStateChange(playerId, 'boostCollected', { playerId, type: powerup });
            this.emitImpostorGhostPickups();
          }
        }
        if (this.mode === 'impostor' && player.hasImpostorKey && !player.hasImpostorKeyDelivered &&
            this.getImpostorBoard().isSafeZoneCell(player.x, player.y)) {
          const isImpostor = playerId === this.impostorId;
          player.hasImpostorKey = false;
          player.hasImpostorKeyDelivered = true;
          if (!isImpostor) {
            this.impostorGoodPlayersReturned++;
            player.hasImpostorEscaped = true;
          }
          this.emitImpostorPublicEvent('player_reached_extraction', { playerName: player.username });
          if (!isImpostor) {
            const goodPlayers = this.playersList.filter(id =>
              !id.startsWith('bot_') && id !== this.impostorId
            );
            if (goodPlayers.length > 0 && goodPlayers.every(id =>
              this.board.players.get(id)?.hasImpostorEscaped
            )) {
              this.finishImpostorGame('good', 'escape');
            }
          }
        }
        if (this.mode === 'infection') this.resolveInfectionContact();
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        if (this.mode === 'infection') this.emitInfectionState();
        return true;
      }

  private resolveInfectionContact(): void {
    if (this.mode !== 'infection' || this.state !== 'playing' || this.isInfectionBurning()) return;
    const impostorBoard = this.getImpostorBoard();
    const newlyInfected: Player[] = [];
    const infectedPlayers = [...this.infectedPlayerIds]
      .map(playerId => this.board.players.get(playerId))
      .filter((player): player is Player =>
        !!player && !player.isDead && player.impostorFrozenUntil <= Date.now()
      );
    for (const playerId of this.getInfectionSurvivorIds()) {
      const player = this.board.players.get(playerId);
      if (!player || player.isDead || player.invisibleUntil > Date.now() ||
          (player.impostorShieldActive && player.impostorShieldExpiresAt > Date.now()) ||
          impostorBoard.isSafeZoneCell(player.x, player.y)) continue;
      let infectingPlayer: Player | undefined;
      for (const infected of infectedPlayers) {
        const dx = Math.abs(infected.x - player.x);
        const dy = Math.abs(infected.y - player.y);
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          if (!impostorBoard.isSeparatedByWall(infected.x, infected.y, player.x, player.y)) {
            infectingPlayer = infected;
            break;
          }
        }
      }
      if (!infectingPlayer) continue;
      player.isInfected = true;
      player.invisibleUntil = 0;
      player.ghostModeExpiresAt = 0;
      this.infectedPlayerIds.add(playerId);
      newlyInfected.push(player);
      this.onPrivateStateChange(player.id, 'impostorRole', this.getPrivateImpostorRole(player.id));
      this.onPrivateStateChange(player.id, 'impostorActionState', {
        canBreakBlock: false,
        canPlaceWall: false,
        canRescue: false,
        isInPrison: player.isInPrison,
        wallPlacementCooldownUntil: this.impostorWallPlacementCooldownUntil.get(player.id) ?? 0
      });
      this.onPrivateStateChange(player.id, 'impostorTrapState', {
        traps: [],
        cooldowns: this.getImpostorTrapCooldowns(player.id)
      });
      this.emitImpostorPublicEvent('player_infected', {
        playerId: player.id,
        playerName: player.username,
        infectorId: infectingPlayer?.id,
        infectorName: infectingPlayer?.username
      });
    }
    if (newlyInfected.length) {
      this.emitPrivateImpostorTrapState();
      this.emitPrivateImpostorActionStates();
      this.emitImpostorGhostPickups();
      this.announceInfectionLastSurvivor();
      this.emitInfectionState();
      if (this.getInfectionSurvivorIds().length === 0) {
        this.beginInfectionBurnSequence();
      }
    }
  }

  private announceInfectionLastSurvivor(): void {
    if (this.mode !== 'infection' || this.infectionLastSurvivorAlertSent) return;
    const survivors = this.getInfectionSurvivorIds();
    if (survivors.length !== 1) return;

    this.infectionLastSurvivorAlertSent = true;
    this.infectionLastSurvivorCountdownUntil = Date.now() + INFECTION_LAST_SURVIVOR_HUNT_COUNTDOWN_MS;
    for (const infectedId of this.getActiveInfectionIds()) {
      const infected = this.board.players.get(infectedId);
      if (infected) infected.impostorFrozenUntil = this.infectionLastSurvivorCountdownUntil;
    }
    const survivorId = survivors[0];
    const survivor = this.board.players.get(survivorId);
    if (!survivor) return;
    this.emitImpostorPublicEvent('infection_last_survivor', {
      playerId: survivor.id,
      playerName: survivor.username
    });
    if (!survivorId.startsWith('bot_')) {
      this.onPrivateStateChange(survivorId, 'infectionLastSurvivor', { playerId: survivorId });
    }
    this.emitPrivateImpostorActionStates();
    this.emitPrivateImpostorTrapState();
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    this.emitInfectionState();
  }

  public getImpostorGhostPickupsForPlayer(playerId: string): { id: string; x: number; y: number }[] {
    if (this.mode === 'impostor') {
      if (playerId === this.impostorId) return [];
      return this.getImpostorBoard().ghostPickups.map(pickup => ({ ...pickup }));
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

  public getImpostorStateDataForPlayer(playerId: string) {
    const board = this.getImpostorBoard().toDTO(playerId, playerId === this.impostorId);
    const state = this.getImpostorStateData(board);
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
      board
    };
  }

  private emitImpostorGhostPickups(): void {
    if (this.mode !== 'impostor' && this.mode !== 'infection') return;
    for (const playerId of this.playersList) {
      if (playerId.startsWith('bot_')) continue;
      if (this.mode !== 'impostor' || playerId !== this.impostorId) {
        this.onPrivateStateChange(
          playerId,
          'impostorGhostPickups',
          this.getImpostorGhostPickupsForPlayer(playerId)
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

  public teleportImpostorPlayer(playerId: string, teleportId: string): boolean {
    const player = this.board.players.get(playerId);
    if (!this.isImpostorBoardMode() || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
        this.isInfectionBurning() || !player ||
        playerId.startsWith('bot_') || player.isDead || player.isInPrison ||
        player.hasImpostorEscaped || player.impostorFrozenUntil > Date.now() ||
        player.impostorTeleportingUntil > Date.now() ||
        (this.mode === 'infection' && this.isInfected(playerId))) return false;
        const fromX = player.x;
        const fromY = player.y;
        const destination = this.getImpostorBoard().teleportPlayer(playerId, teleportId);
        if (!destination) return false;
        if (this.mode === 'infection') {
          const teleports = this.getImpostorBoard().teleports;
          const previousPositions = teleports.map(({ x, y }) => ({ x, y }));
          const pairCount = new Set(teleports.map(({ pairId }) => pairId)).size;
          this.getImpostorBoard().spawnTeleports(Math.random, previousPositions, pairCount);
        }
        player.impostorTeleportingUntil = Date.now() + IMPOSTOR_TELEPORT_ANIMATION_MS;
        this.recordPlayerActivity(playerId);
        this.impostorMoveAt.set(playerId, Date.now());
        const newlyCaptured = this.updateImpostorPrisons();
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
        this.emitImpostorCaptureEvents(this.getImpostorCaptureOwner(newlyCaptured), newlyCaptured);
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        return true;
      }

  public useInfectionLastSurvivorTeleport(
    playerId: string,
    random: () => number = Math.random
  ): boolean {
    return this.useInfectionLastSurvivorPower(playerId, 'teleport', random);
  }

  public useInfectionLastSurvivorPower(
    playerId: string,
    power: InfectionLastSurvivorPower,
    random: () => number = Math.random
  ): boolean {
    const player = this.board.players.get(playerId);
    const now = Date.now();
    if (this.mode !== 'infection' || this.state !== 'playing' || this.isInfectionBurning(now) || !player ||
        playerId.startsWith('bot_') || player.isDead || player.isInPrison ||
        player.impostorFrozenUntil > now || player.impostorTeleportingUntil > now ||
        !this.isLastInfectionSurvivor(playerId)) return false;
    const hasActivePower = player.ghostModeExpiresAt > now ||
      player.invisibleUntil > now ||
      (player.impostorShieldActive && player.impostorShieldExpiresAt > now);
    if (power !== 'teleport' && hasActivePower) return false;
    const cooldowns = this.infectionLastSurvivorPowerCooldownUntil.get(playerId) ?? {
      ghost: 0,
      shield: 0,
      invisible: 0,
      teleport: 0
    };
    if (cooldowns[power] > now) return false;
    if ((this.infectionLastSurvivorGeneralCooldownUntil.get(playerId) ?? 0) > now) return false;

    let teleport: ReturnType<InfectionBoard['teleportPlayerToOppositeEdge']> = null;
    if (power === 'ghost') {
      player.ghostModeExpiresAt = now + INFECTION_LAST_SURVIVOR_POWER_DURATION_MS;
      this.updateImpostorPrisons();
    } else if (power === 'shield') {
      player.impostorShieldActive = true;
      player.impostorShieldExpiresAt = now + INFECTION_LAST_SURVIVOR_POWER_DURATION_MS;
    } else if (power === 'invisible') {
      player.invisibleUntil = now + INFECTION_LAST_SURVIVOR_POWER_DURATION_MS;
    } else {
      teleport = this.getInfectionBoard().teleportPlayerToOppositeEdge(playerId, random);
      if (!teleport) return false;
      player.impostorTeleportingUntil = now + IMPOSTOR_TELEPORT_ANIMATION_MS;
      this.impostorMoveAt.set(playerId, now);
    }

    this.infectionLastSurvivorPowerCooldownUntil.set(playerId, {
      ...cooldowns,
      [power]: now + INFECTION_LAST_SURVIVOR_POWER_COOLDOWN_MS
    });
    this.infectionLastSurvivorGeneralCooldownUntil.set(
      playerId,
      now + INFECTION_LAST_SURVIVOR_GENERAL_COOLDOWN_MS
    );
    this.recordPlayerActivity(playerId);
    if (teleport) {
      this.onStateChange('playerMoved', {
        playerId,
        fromX: teleport.from.x,
        fromY: teleport.from.y,
        newX: teleport.destination.x,
        newY: teleport.destination.y,
        movementTrailId: player.movementTrailId,
        movementTrailIcon: player.movementTrailIcon,
        teleported: true
      });
      this.resolveInfectionContact();
    }
    this.emitImpostorPublicEvent('infection_last_survivor_power_used', {
      playerId,
      playerName: player.username,
      power
    });
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    this.emitInfectionState();
    return true;
  }

      public sealImpostorExit(playerId: string, exitId: string): boolean {
        return false;
      }

      public openImpostorExit(_playerId: string, _exitId: string): boolean {
        return false;
      }

      public placeImpostorWall(playerId: string, x: number, y: number, isHorizontal: boolean, wallId: string): boolean {
        const player = this.board.players.get(playerId);
        if (!this.isImpostorBoardMode() || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
            this.isInfectionBurning() || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasImpostorEscaped ||
            player.isInPrison || (this.mode === 'infection' && this.isLastInfectionSurvivor(playerId)) ||
            (this.mode === 'impostor' && playerId !== this.impostorId) ||
            !this.getPrivateImpostorRole(playerId)?.canPlaceWall) return false;
        const isImpostor = this.mode === 'impostor' && playerId === this.impostorId;

        const wall = new Wall(
          wallId,
          playerId,
          x,
          y,
          isHorizontal,
          undefined,
          undefined,
          false,
          isImpostor
        );
        const impostorBoard = this.getImpostorBoard();
        if (impostorBoard.wouldMakeUncollectedKeyUnreachable(wall)) return false;
        if (!impostorBoard.placeImpostorWall(wall)) return false;
        const wallCooldown = this.mode === 'infection'
          ? INFECTION_WALL_PLACEMENT_COOLDOWN_MS
          : IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS;
        this.impostorWallPlacementCooldownUntil.set(playerId, Date.now() + wallCooldown);
        this.recordPlayerActivity(playerId);

        const newlyCaptured = this.updateImpostorPrisons();
        this.emitPrivateImpostorActionStates();
        this.onStateChange('wallPlaced', { playerId, x, y, isHorizontal, wall });
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        this.emitImpostorCaptureEvents(playerId, newlyCaptured);
        return true;
      }

      public breakImpostorBlock(playerId: string, wallId: string): boolean {
        const player = this.board.players.get(playerId);
        if (!this.isImpostorBoardMode() || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
            this.isInfectionBurning() || !player ||
            playerId.startsWith('bot_') || player.isDead || player.hasImpostorEscaped ||
            player.isInPrison ||
            (this.mode === 'impostor' && player.impostorTool !== 'hammer') ||
            (this.mode === 'infection' && this.isInfected(playerId) &&
              player.impostorFrozenUntil > Date.now())) return false;
        const impostorBoard = this.getImpostorBoard();
        const wall = impostorBoard.walls.find(candidate =>
          candidate.id === wallId &&
          impostorBoard.isPlayerPlacedImpostorWall(candidate) &&
          impostorBoard.isPlayerAdjacentToWall(playerId, candidate)
        );
        if (!wall) return false;
        const removedWall = impostorBoard.removeWallById(wallId);
        if (!removedWall) return false;
        this.recordPlayerActivity(playerId);
        this.updateImpostorPrisons();
        if (!this.isInfectionPlayerInvisible(playerId)) {
          this.emitImpostorPublicEvent(this.mode === 'infection'
            ? 'player_broke_wall'
            : 'player_broke_prison_wall', {
            playerId,
            playerName: player.username,
            wallX: wall.x,
            wallY: wall.y,
            wallIsHorizontal: wall.isHorizontal
          });
        }
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        return true;
      }

      public rescueImpostorPlayer(rescuerId: string, targetId: string): boolean {
        const rescuer = this.board.players.get(rescuerId);
        const target = this.board.players.get(targetId);
        if (this.mode !== 'impostor' || this.state !== 'playing' || this.isImpostorEmergencyMeetingActive() ||
            !rescuer || !target ||
            rescuerId.startsWith('bot_') || rescuer.isDead || rescuer.hasImpostorEscaped || rescuer.isInPrison ||
            target.isDead || target.hasImpostorEscaped || !target.isInPrison ||
            Math.abs(target.x - rescuer.x) + Math.abs(target.y - rescuer.y) > 1) return false;

        const impostorBoard = this.getImpostorBoard();
        const removedWall = impostorBoard.getImpostorReleaseWalls(targetId)[0];
        if (removedWall) impostorBoard.removeWallById(removedWall.id);
        if (!removedWall) return false;

        this.recordPlayerActivity(rescuerId);
        this.updateImpostorPrisons();
        this.emitImpostorPublicEvent('player_rescued', { rescuerName: rescuer.username, playerName: target.username });
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        return true;
      }

  private expireImpostorGhostModes(now: number = Date.now()): void {
    const expired = [...this.board.players.values()].filter(player =>
      player.ghostModeExpiresAt > 0 && player.ghostModeExpiresAt <= now
    );
    if (!expired.length) return;
    for (const player of expired) player.ghostModeExpiresAt = 0;
    const newlyCaptured = this.updateImpostorPrisons();
    for (const player of expired) {
      if (!this.isInfectionPlayerInvisible(player.id)) {
        this.emitImpostorPublicEvent('impostor_ghost_ended', { playerName: player.username });
      }
    }
    this.emitImpostorCaptureEvents(this.getImpostorCaptureOwner(newlyCaptured), newlyCaptured);
    this.onStateChange('impostorStateChanged', this.getImpostorStateData());
  }

  private getImpostorCaptureOwner(capturedIds: string[]): string {
    const impostorBoard = this.getImpostorBoard();
    return capturedIds.some(playerId =>
      impostorBoard.getImpostorCageWalls(playerId).some(wall => wall.isSabotageWall)
    ) ? this.impostorId || '' : '';
  }

  private emitImpostorCaptureEvents(placerId: string, capturedIds: string[]): void {
    const capturedHumanIds = capturedIds.filter(id => !id.startsWith('bot_'));
    for (const capturedId of capturedHumanIds) {
      if (this.isInfectionPlayerInvisible(capturedId)) continue;
      const capturedPlayer = this.board.players.get(capturedId);
      const eventType = capturedId === this.impostorId
        ? 'player_captured_impostor'
        : placerId === this.impostorId ? 'impostor_captured_player' : 'player_captured_player';
      this.emitImpostorPublicEvent(eventType, { playerName: capturedPlayer?.username || capturedId });
    }
    if (capturedHumanIds.length > 0) this.resolveImpostorCapture(capturedHumanIds);
  }

  private updateImpostorPrisons(): string[] {
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
          const impostorBoard = this.getImpostorBoard();
          player.isInPrison = player.hasImpostorEscaped || player.ghostModeExpiresAt > Date.now()
            ? false
            : impostorBoard.isImpostorPlayerEnclosed(player.id);
          if (player.isInPrison !== previouslyCaptured.has(player.id)) {
            const role = this.getPrivateImpostorRole(player.id);
            this.onPrivateStateChange(player.id, 'impostorActionState', {
              canBreakBlock: role?.canBreakBlock === true,
              canPlaceWall: role?.canPlaceWall === true,
              canRescue: role?.canRescue === true,
              isInPrison: player.isInPrison
            });
          }
          if (player.isInPrison) {
            for (const wall of impostorBoard.getImpostorCageWalls(player.id)) wall.isPrisonBlock = true;
            for (const wall of impostorBoard.getImpostorReleaseWalls(player.id)) wall.isRescueWall = true;
          }
        }
        return [...this.board.players.values()]
          .filter(player => player.isInPrison && !previouslyCaptured.has(player.id))
          .map(player => player.id);
      }

      private resolveImpostorCapture(capturedIds: string[]): void {
            if (this.mode !== 'impostor') return;
        if (this.state !== 'playing') return;
        if (capturedIds.includes(this.impostorId || '')) return;
        if (capturedIds.length === 0) return;
        const newlyCapturedByImpostor = capturedIds.some(playerId =>
          this.getImpostorBoard().getImpostorCageWalls(playerId).some(wall => wall.isSabotageWall)
        );
        if (!newlyCapturedByImpostor) return;

        const goodPlayers = this.playersList
          .filter(playerId => !playerId.startsWith('bot_') && playerId !== this.impostorId)
          .map(playerId => this.board.players.get(playerId));
        if (goodPlayers.length > 0 && goodPlayers.every(player =>
          !!player?.isInPrison &&
          this.getImpostorBoard().getImpostorCageWalls(player.id).some(wall => wall.isSabotageWall)
        )) {
          this.finishImpostorGame(this.impostorId, 'capture');
        }
      }

  private finishImpostorGame(winner: string | null, reason: ImpostorEndReason): void {
    if (this.isInfectionBurning()) return;
    if (this.mode === 'infection') {
      for (const player of this.board.players.values()) player.invisibleUntil = 0;
      this.onStateChange('impostorStateChanged', this.getImpostorStateData());
    }
    this.winner = winner;
    this.impostorEndReason = reason;
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
      player.hasReachedGoal = true;
      if (this.mode === '2v2') {
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
    if (this.state !== 'playing' || this.pendingBoostDecision || this.isInfectionBurning() ||
        this.isImpostorEmergencyMeetingActive()) return false;

    const surrenderingPlayer = this.board.players.get(surrenderingUserId);
    if (!surrenderingPlayer || surrenderingPlayer.isDead) return false;
    surrenderingPlayer.isDead = true;
    this.stopTrackingPlayerActivity(surrenderingUserId);

    const alive = Array.from(this.board.players.values()).filter(p => !p.isDead);

    if (this.isImpostorBoardMode()) {
      if (this.mode === 'infection') {
        const infectionBoard = this.getImpostorBoard();
        const playerCell = infectionBoard.grid[surrenderingPlayer.y]?.[surrenderingPlayer.x];
        if (playerCell?.hasPlayer === surrenderingUserId) playerCell.hasPlayer = null;
        const playerIndex = this.playersList.indexOf(surrenderingUserId);
        if (playerIndex >= 0) this.playersList.splice(playerIndex, 1);
        infectionBoard.players.delete(surrenderingUserId);
        this.impostorMoveAt.delete(surrenderingUserId);
        this.impostorActionsUsed.delete(surrenderingUserId);
        this.impostorWallPlacementCooldownUntil.delete(surrenderingUserId);
        this.infectionTrapCooldownUntil.delete(surrenderingUserId);
        this.infectionLastSurvivorPowerCooldownUntil.delete(surrenderingUserId);
        this.infectionLastSurvivorGeneralCooldownUntil.delete(surrenderingUserId);
        this.infectionSafeZoneEnteredAt.delete(surrenderingUserId);
        this.infectionSafeZoneCooldownUntil.delete(surrenderingUserId);
        this.clearInfectionSafeZoneExpiry(surrenderingUserId);
        this.emitImpostorPublicEvent('player_left', {
          playerId: surrenderingUserId,
          playerName: surrenderingPlayer.username
        });
        this.emitInfectionState();
        this.onStateChange('impostorStateChanged', this.getImpostorStateData());
        this.announceInfectionLastSurvivor();
        if (this.getInfectionSurvivorIds().length === 0) {
          this.finishImpostorGame('infected', 'surrender');
        } else if (this.getActiveInfectionIds().length === 0) {
          this.finishImpostorGame('survivors', 'surrender');
        }
        return true;
      }
      this.impostorSurrenderedPlayerId = surrenderingUserId;
      this.finishImpostorGame(
        surrenderingUserId === this.impostorId ? 'good' : this.impostorId,
        'surrender'
      );
      return true;
    }

    const hasAliveHumans = alive.some(player => !player.id.startsWith('bot_'));
    if (!hasAliveHumans) {
      this.endGame(true);
      return true;
    }

    if (this.mode === '2v2') {
      const surrenderingTeam = surrenderingPlayer.team;
      for (const p of this.board.players.values()) {
        if (p.team === surrenderingTeam) {
          p.isDead = true;
          this.stopTrackingPlayerActivity(p.id);
        }
      }
      const winningOpponent = Array.from(this.board.players.values()).find(p => p.team !== surrenderingTeam && !p.id.startsWith('bot_'))
        || Array.from(this.board.players.values()).find(p => p.team !== surrenderingTeam);
      this.winner = winningOpponent?.id || null;
      this.surrenderedPlayerId = surrenderingUserId;
      this.surrenderedPlayerName = surrenderingPlayer.username;
      this.endGame();
      return true;
    }

    if (this.mode === '1v1' || this.mode === 'vs_ai') {
      this.winner = alive[0]?.id || null;
      this.surrenderedPlayerId = surrenderingUserId;
      this.surrenderedPlayerName = surrenderingPlayer.username;
      this.endGame();
      return true;
    }

    if (alive.length <= 1) {
      this.winner = alive[0]?.id || null;
      this.surrenderedPlayerId = surrenderingUserId;
      this.surrenderedPlayerName = surrenderingPlayer.username;
      this.endGame();
    } else {
      this.onStateChange('playerSurrendered', {
        playerId: surrenderingUserId,
        playerName: surrenderingPlayer.username,
        roomId: this.id
      });
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
    if (this.state !== 'playing' || this.isInfectionBurning() || this.isImpostorEmergencyMeetingActive()) return;
    this.endGame(true);
  }

  private endGame(abandoned: boolean = false) {
    this.state = 'finished';
    if (this.infectionBurnTimer) clearTimeout(this.infectionBurnTimer);
    this.infectionBurnTimer = null;
    this.stopTurnTimer();
    this.clearPendingBoostDecision();
    this.clearPlayerInactivityTimers();
    this.clearTimedBoostTimers();
    this.clearImpostorTimers();
    this.clearImpostorToolRequests();
    if (abandoned) this.winner = null;
    const durationSeconds = this.startTime ? Math.max(1, Math.round((Date.now() - this.startTime) / 1000)) : 0;
    this.onStateChange('gameFinished', {
      winner: this.winner,
      durationSeconds,
      abandoned,
      ...(this.surrenderedPlayerId
        ? {
            surrenderedPlayerId: this.surrenderedPlayerId,
            surrenderedPlayerName: this.surrenderedPlayerName
          }
        : {}),
      ...(this.mode === 'impostor'
        ? {
            impostorRevealedImpostorId: this.impostorId,
            impostorEndReason: this.impostorEndReason,
            impostorSurrenderedPlayerId: this.impostorSurrenderedPlayerId
          }
        : this.mode === 'infection'
          ? {
              infectionOutcome: this.winner,
              infectionCount: this.infectedPlayerIds.size
            }
        : {})
    });
    if (!abandoned && !this.isImpostorBoardMode()) this.botReactionManager.onGameFinished(this.winner);
  }
}
