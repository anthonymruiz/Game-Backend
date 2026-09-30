import { Cell, Player, Wall, Boost, Coordinate } from './models.js';

export class Board {
  public grid: Cell[][] = [];
  public walls: Wall[] = [];
  public players: Map<string, Player> = new Map();
  public boosts: Boost[] = [];

  constructor(public size: number = 11) {
    this.initializeGrid();
  }

  private initializeGrid() {
    this.grid = [];
    for (let y = 0; y < this.size; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.size; x++) {
        row.push(new Cell(x, y));
      }
      this.grid.push(row);
    }
  }

  public addPlayer(player: Player) {
    this.players.set(player.id, player);
    if (player.y >= 0 && player.y < this.size && player.x >= 0 && player.x < this.size) {
      this.grid[player.y][player.x].hasPlayer = player.id;
    }
  }

  public movePlayer(playerId: string, newX: number, newY: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Validate bounds
    if (newX < 0 || newX >= this.size || newY < 0 || newY >= this.size) return false;

    // Move is simply 1 cell adjacent (no diagonals)
    const dx = Math.abs(player.x - newX);
    const dy = Math.abs(player.y - newY);
    if (dx + dy !== 1) return false;

    // Check for walls blocking the move between (player.x, player.y) and (newX, newY)
    if (this.isWallBlocking(player.x, player.y, newX, newY)) return false;

    // Move player
    this.grid[player.y][player.x].hasPlayer = null;
    player.x = newX;
    player.y = newY;

    // Check if picked up a boost
    const boostId = this.grid[newY][newX].hasBoost;
    if (boostId) {
      this.grid[newY][newX].hasBoost = null;
      this.boosts = this.boosts.filter(b => b.id !== boostId);
      player.wallsLeft++;
    }

    this.grid[newY][newX].hasPlayer = player.id;
    return true;
  }

  public placeWall(wall: Wall): boolean {
    const p = this.players.get(wall.ownerId);
    if (!p || p.wallsLeft <= 0) return false;

    // Validate wall bounds (occupies 2 units)
    if (wall.x < 0 || wall.y < 0) return false;
    if (wall.isHorizontal && wall.x + 1 >= this.size) return false;
    if (!wall.isHorizontal && wall.y + 1 >= this.size) return false;

    // Check for wall overlaps
    if (this.doesWallOverlap(wall)) return false;

    // Temporarily add wall
    this.walls.push(wall);

    // Validate pathfinding (BFS) to ensure no player is completely trapped
    if (!this.isValidState()) {
      this.walls.pop(); // Revert
      return false;
    }

    p.wallsLeft--;
    return true;
  }

  private doesWallOverlap(newWall: Wall): boolean {
    for (const w of this.walls) {
      // If same orientation, check segment overlap
      if (w.isHorizontal === newWall.isHorizontal) {
        if (w.isHorizontal && w.y === newWall.y) {
          if (Math.abs(w.x - newWall.x) < 2) return true; // Shares horizontal segment
        } else if (!w.isHorizontal && w.x === newWall.x) {
          if (Math.abs(w.y - newWall.y) < 2) return true; // Shares vertical segment
        }
      } else {
        // Perpendicular cross check: exact center intersection overlap
        if (w.x === newWall.x && w.y === newWall.y) {
          return true; // Overlaps center cross point
        }
      }
    }
    return false;
  }

  private isWallBlocking(x1: number, y1: number, x2: number, y2: number): boolean {
    for (const w of this.walls) {
      if (w.isHorizontal && x1 === x2) {
        // Moving vertically: check if horizontal wall lies between y1 and y2
        const minY = Math.min(y1, y2);
        if (w.y === minY && (w.x === x1 || w.x === x1 - 1)) return true;
      } else if (!w.isHorizontal && y1 === y2) {
        // Moving horizontally: check if vertical wall lies between x1 and x2
        const minX = Math.min(x1, x2);
        if (w.x === minX && (w.y === y1 || w.y === y1 - 1)) return true;
      }
    }
    return false;
  }

  private isValidState(): boolean {
    for (const player of this.players.values()) {
      if (!this.hasPath(player)) return false;
    }
    return true;
  }

  private hasPath(player: Player): boolean {
    const queue: Coordinate[] = [{ x: player.x, y: player.y }];
    const visited = new Set<string>();
    visited.add(`${player.x},${player.y}`);

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;

      // Target condition check
      if (player.targetY !== undefined && y === player.targetY) return true;
      if (player.targetX !== undefined && x === player.targetX) return true;

      const neighbors = [
        { x: x + 1, y }, { x: x - 1, y },
        { x, y: y + 1 }, { x, y: y - 1 }
      ];

      for (const n of neighbors) {
        if (n.x >= 0 && n.x < this.size && n.y >= 0 && n.y < this.size) {
          if (!this.isWallBlocking(x, y, n.x, n.y)) {
            const key = `${n.x},${n.y}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push(n);
            }
          }
        }
      }
    }
    return false; // Trapped!
  }

  public spawnRandomBoost() {
    const x = Math.floor(Math.random() * this.size);
    const y = Math.floor(Math.random() * this.size);
    if (!this.grid[y][x].hasPlayer && !this.grid[y][x].hasBoost) {
      const boost = new Boost(Math.random().toString(), 'extra_wall', x, y);
      this.boosts.push(boost);
      this.grid[y][x].hasBoost = boost.id;
    }
  }

  public getBestMove(playerId: string): { x: number; y: number } | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    const queue: { x: number; y: number; path: { x: number; y: number }[] }[] = [
      { x: player.x, y: player.y, path: [] }
    ];
    const visited = new Set<string>();
    visited.add(`${player.x},${player.y}`);

    while (queue.length > 0) {
      const { x, y, path } = queue.shift()!;

      if ((player.targetY !== undefined && y === player.targetY) ||
          (player.targetX !== undefined && x === player.targetX)) {
        return path.length > 0 ? path[0] : null;
      }

      const neighbors = [
        { x: x + 1, y }, { x: x - 1, y },
        { x, y: y + 1 }, { x, y: y - 1 }
      ];

      for (const n of neighbors) {
        if (n.x >= 0 && n.x < this.size && n.y >= 0 && n.y < this.size) {
          if (!this.isWallBlocking(x, y, n.x, n.y)) {
            const key = `${n.x},${n.y}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({ x: n.x, y: n.y, path: [...path, { x: n.x, y: n.y }] });
            }
          }
        }
      }
    }
    return null;
  }
}

