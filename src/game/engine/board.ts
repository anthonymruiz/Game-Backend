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

  public getValidMoves(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    if (!player) return [];

    const validMoves: Coordinate[] = [];
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: 0 }   // Right
    ];

    for (const dir of directions) {
      const nx = player.x + dir.dx;
      const ny = player.y + dir.dy;

      // Check bounds & wall block between player and adjacent cell
      if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
        if (!this.isWallBlocking(player.x, player.y, nx, ny)) {
          const occupant = this.grid[ny][nx].hasPlayer;

          if (!occupant) {
            // Unoccupied cell: standard move
            validMoves.push({ x: nx, y: ny });
          } else {
            // Occupied cell by opponent: PAWN JUMPING RULES!
            const straightX = nx + dir.dx;
            const straightY = ny + dir.dy;

            const isStraightInBounds = straightX >= 0 && straightX < this.size && straightY >= 0 && straightY < this.size;
            const isStraightWallBlocked = isStraightInBounds ? this.isWallBlocking(nx, ny, straightX, straightY) : true;
            const isStraightOccupied = isStraightInBounds ? !!this.grid[straightY][straightX].hasPlayer : false;

            if (isStraightInBounds && !isStraightWallBlocked && !isStraightOccupied) {
              // Straight jump over opponent
              validMoves.push({ x: straightX, y: straightY });
            } else {
              // Straight jump is blocked by wall, board edge, or another player -> Diagonal / Side jumps!
              const sideDirs = dir.dx !== 0 ? [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }] : [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];

              for (const sideDir of sideDirs) {
                const sideX = nx + sideDir.dx;
                const sideY = ny + sideDir.dy;

                if (sideX >= 0 && sideX < this.size && sideY >= 0 && sideY < this.size) {
                  if (!this.isWallBlocking(nx, ny, sideX, sideY) && !this.grid[sideY][sideX].hasPlayer) {
                    validMoves.push({ x: sideX, y: sideY });
                  }
                }
              }
            }
          }
        }
      }
    }

    return validMoves;
  }

  public movePlayer(playerId: string, newX: number, newY: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Enforce Quoridor move and jump rules
    const validMoves = this.getValidMoves(playerId);
    const isValid = validMoves.some(m => m.x === newX && m.y === newY);
    if (!isValid) return false;

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

    const validMoves = this.getValidMoves(playerId);
    if (validMoves.length === 0) return null;

    let bestMove = validMoves[0];
    let minDistance = Infinity;

    for (const move of validMoves) {
      let dist = Infinity;
      if (player.targetY !== undefined) {
        dist = Math.abs(move.y - player.targetY);
      } else if (player.targetX !== undefined) {
        dist = Math.abs(move.x - player.targetX);
      }

      if (dist < minDistance) {
        minDistance = dist;
        bestMove = move;
      }
    }

    return bestMove;
  }

  public toDTO(forPlayerId?: string) {
    const playersObj: { [id: string]: any } = {};
    this.players.forEach((p, id) => {
      playersObj[id] = {
        id: p.id,
        username: p.username,
        isGuest: p.isGuest,
        x: p.x,
        y: p.y,
        startX: p.startX,
        startY: p.startY,
        targetX: p.targetX,
        targetY: p.targetY,
        wallsLeft: p.wallsLeft,
        color: p.color
      };
    });

    return {
      size: this.size,
      grid: this.grid,
      walls: this.walls,
      boosts: this.boosts,
      players: playersObj,
      validMoves: forPlayerId ? this.getValidMoves(forPlayerId) : []
    };
  }
}
