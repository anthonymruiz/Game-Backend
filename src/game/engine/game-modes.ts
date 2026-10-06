import { GameMode } from '../../services/matchmaking.service.js';
import { Player } from './models.js';
import { Board } from './board.js';

export interface IPlayerStartConfig {
  startX: number;
  startY: number;
  targetY?: number;
  targetX?: number;
  team?: number;
}

export interface IGameModeRules {
  mode: GameMode;
  boardSize: number;
  maxPlayers: number;
  wallsPerPlayer: number;
  isTeamMode: boolean;
  getPlayerStartConfig(index: number, totalPlayers: number, boardSize: number, team?: number, teamMemberIndex?: number): IPlayerStartConfig;
  checkWinCondition(player: Player, board: Board): boolean;
}

// 1v1 & VS AI Standard Mode (9x9 grid, 10 walls, opposing sides)
export class Standard1v1Rules implements IGameModeRules {
  public mode: GameMode = '1v1';
  public boardSize = 9;
  public maxPlayers = 2;
  public wallsPerPlayer = 10;
  public isTeamMode = false;

  public getPlayerStartConfig(index: number, totalPlayers: number, size: number): IPlayerStartConfig {
    const mid = Math.floor(size / 2);
    if (index === 0) {
      return { startX: mid, startY: size - 1, targetY: 0 }; // Bottom to Top
    } else {
      return { startX: mid, startY: 0, targetY: size - 1 }; // Top to Bottom
    }
  }

  public checkWinCondition(player: Player, board: Board): boolean {
    if (player.targetY !== undefined && player.y === player.targetY) return true;
    if (player.targetX !== undefined && player.x === player.targetX) return true;
    return false;
  }
}

export class VsAiRules extends Standard1v1Rules {
  public override mode: GameMode = 'vs_ai';
}

// 4-Player Free For All (11x11 grid, 7 walls, goal is center cell (5,5))
export class FourPlayerFfaRules implements IGameModeRules {
  public mode: GameMode = '4-FFA';
  public boardSize = 11;
  public maxPlayers = 4;
  public wallsPerPlayer = 7;
  public isTeamMode = false;

  public getPlayerStartConfig(index: number, totalPlayers: number, size: number): IPlayerStartConfig {
    const mid = Math.floor(size / 2);
    const targetX = mid;
    const targetY = mid;

    switch (index) {
      case 0:
        return { startX: mid, startY: size - 1, targetY, targetX }; // Bottom
      case 1:
        return { startX: mid, startY: 0, targetY, targetX }; // Top
      case 2:
        return { startX: 0, startY: mid, targetY, targetX }; // Left
      case 3:
      default:
        return { startX: size - 1, startY: mid, targetY, targetX }; // Right
    }
  }

  public checkWinCondition(player: Player, board: Board): boolean {
    if (player.targetX !== undefined && player.targetY !== undefined) {
      return player.x === player.targetX && player.y === player.targetY;
    }
    return false;
  }
}

// 2v2 Team Mode (11x11 grid, 7 walls, corners starting positions, team sync)
export class TwoVsTwoRules implements IGameModeRules {
  public mode: GameMode = '2v2';
  public boardSize = 11;
  public maxPlayers = 4;
  public wallsPerPlayer = 7;
  public isTeamMode = true;

  public getPlayerStartConfig(index: number, totalPlayers: number, size: number, team?: number, teamMemberIndex?: number): IPlayerStartConfig {
    const maxCoord = size - 1;
    const playerTeam = team !== undefined ? team : (index % 2 === 0 ? 1 : 2);
    const isSecondInTeam = teamMemberIndex !== undefined ? (teamMemberIndex > 0) : (index >= 2);
    const startX = isSecondInTeam ? maxCoord : 0;

    if (playerTeam === 1) {
      return { startX, startY: maxCoord, targetY: 0, team: 1 };
    } else {
      return { startX, startY: 0, targetY: maxCoord, team: 2 };
    }
  }

  public checkWinCondition(player: Player, board: Board): boolean {
    if (player.targetY !== undefined && player.y === player.targetY) return true;
    if (player.targetX !== undefined && player.x === player.targetX) return true;
    return false;
  }
}

// 6-Player Free For All (11x11 grid, 7 walls, goal is center cell (5,5), random border spawn)
export class SixPlayerFfaRules implements IGameModeRules {
  public mode: GameMode = '6-FFA';
  public boardSize = 11;
  public maxPlayers = 6;
  public wallsPerPlayer = 7;
  public isTeamMode = false;

  public getPlayerStartConfig(index: number, totalPlayers: number, size: number): IPlayerStartConfig {
    const mid = Math.floor(size / 2);
    const maxCoord = size - 1;

    // Collect all outer edge / border coordinates
    const borderCoords: { x: number; y: number }[] = [];
    for (let x = 0; x < size; x++) {
      borderCoords.push({ x, y: 0 });          // Top border
      borderCoords.push({ x, y: maxCoord });   // Bottom border
    }
    for (let y = 1; y < maxCoord; y++) {
      borderCoords.push({ x: 0, y });          // Left border
      borderCoords.push({ x: maxCoord, y });   // Right border
    }

    const total = Math.max(totalPlayers, 6);
    const step = Math.floor(borderCoords.length / total);
    const chosenIndex = (index * step + (index % 2 === 0 ? 1 : 2)) % borderCoords.length;
    const chosen = borderCoords[chosenIndex];

    return {
      startX: chosen.x,
      startY: chosen.y,
      targetX: mid,
      targetY: mid
    };
  }

  public checkWinCondition(player: Player, board: Board): boolean {
    if (player.targetX !== undefined && player.targetY !== undefined) {
      return player.x === player.targetX && player.y === player.targetY;
    }
    return false;
  }
}

export class LabyrinthRules implements IGameModeRules {
  public mode: GameMode = 'labyrinth';
  public boardSize = 40;
  public maxPlayers = 6;
  public wallsPerPlayer = 0;
  public isTeamMode = false;

  public getPlayerStartConfig(index: number, totalPlayers: number, size: number): IPlayerStartConfig {
    const mid = Math.floor(size / 2);
    const centralSpawnOffsets = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: -1 }
    ];
    const offset = centralSpawnOffsets[index % centralSpawnOffsets.length];
    return { startX: mid + offset.x, startY: mid + offset.y };
  }

  public checkWinCondition(): boolean {
    return false;
  }
}

// Registry to dynamically fetch mode rules
export class GameModeRegistry {
  private static modes: Map<string, IGameModeRules> = new Map([
    ['1v1', new Standard1v1Rules()],
    ['vs_ai', new VsAiRules()],
    ['4-FFA', new FourPlayerFfaRules()],
    ['2v2', new TwoVsTwoRules()],
    ['6-FFA', new SixPlayerFfaRules()],
    ['labyrinth', new LabyrinthRules()]
  ]);

  public static get(mode: GameMode | string): IGameModeRules {
    const rules = this.modes.get(mode);
    if (rules) return rules;
    // Fallback to 1v1 for unknown modes
    return new Standard1v1Rules();
  }

  public static register(rules: IGameModeRules): void {
    this.modes.set(rules.mode, rules);
  }
}
