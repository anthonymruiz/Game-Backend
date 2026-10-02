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

  public getValidMoves(playerId: string, fromX?: number, fromY?: number): Coordinate[] {
    const player = this.players.get(playerId);
    if (!player) return [];

    const px = fromX !== undefined ? fromX : player.x;
    const py = fromY !== undefined ? fromY : player.y;

    const validMoves: Coordinate[] = [];
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: 0 }   // Right
    ];

    for (const dir of directions) {
      const nx = px + dir.dx;
      const ny = py + dir.dy;

      // Check bounds & wall block between player and adjacent cell
      if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
        if (!this.isWallBlocking(px, py, nx, ny)) {
          const occupant = this.grid[ny][nx].hasPlayer;

          if (!occupant || occupant === playerId) {
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

  private isGoalReached(x: number, y: number, targetY?: number, targetX?: number): boolean {
    if (targetX !== undefined && targetY !== undefined) {
      return x === targetX && y === targetY;
    }
    if (targetY !== undefined && y === targetY) return true;
    if (targetX !== undefined && x === targetX) return true;
    return false;
  }

  private hasPath(player: Player): boolean {
    const queue: Coordinate[] = [{ x: player.x, y: player.y }];
    const visited = new Set<string>();
    visited.add(`${player.x},${player.y}`);

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;

      // Target condition check
      if (this.isGoalReached(x, y, player.targetY, player.targetX)) return true;

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

  public findShortestPath(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    if (!player) return [];

    const queue: { x: number; y: number; path: Coordinate[] }[] = [
      { x: player.x, y: player.y, path: [{ x: player.x, y: player.y }] }
    ];
    const visited = new Set<string>();
    visited.add(`${player.x},${player.y}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { x, y, path } = current;

      if (this.isGoalReached(x, y, player.targetY, player.targetX)) return path;

      const neighbors = [
        { x: x, y: y - 1 },
        { x: x, y: y + 1 },
        { x: x - 1, y: y },
        { x: x + 1, y: y }
      ];

      for (const n of neighbors) {
        if (n.x >= 0 && n.x < this.size && n.y >= 0 && n.y < this.size) {
          if (!this.isWallBlocking(x, y, n.x, n.y)) {
            const key = `${n.x},${n.y}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push({
                x: n.x,
                y: n.y,
                path: [...path, { x: n.x, y: n.y }]
              });
            }
          }
        }
      }
    }

    return [];
  }

  public getShortestPathLength(startX: number, startY: number, targetY?: number, targetX?: number, playerId?: string): number {
    if (playerId) {
      const path = this.findShortestPath(playerId);
      if (path.length > 0) return path.length - 1;
    }
    const queue: { x: number; y: number; dist: number }[] = [{ x: startX, y: startY, dist: 0 }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const { x, y, dist } = queue.shift()!;

      if (this.isGoalReached(x, y, targetY, targetX)) return dist;

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
              queue.push({ x: n.x, y: n.y, dist: dist + 1 });
            }
          }
        }
      }
    }
    return Infinity;
  }

  public canPlaceWall(wall: Wall): boolean {
    if (wall.x < 0 || wall.y < 0) return false;
    if (wall.isHorizontal && wall.x + 1 >= this.size) return false;
    if (!wall.isHorizontal && wall.y + 1 >= this.size) return false;
    if (this.doesWallOverlap(wall)) return false;
    return true;
  }

  public getBotAction(botId: string): { type: 'move'; x: number; y: number } | { type: 'wall'; x: number; y: number; isHorizontal: boolean } | null {
    const bot = this.players.get(botId);
    if (!bot) return null;

    // Separate all other players into enemies and teammates based on team
    const enemies: Player[] = [];
    const teammates: Player[] = [];

    for (const [id, p] of this.players.entries()) {
      if (id === botId) continue;
      if (bot.team !== undefined && bot.team !== 0 && p.team === bot.team) {
        teammates.push(p);
      } else {
        enemies.push(p);
      }
    }

    const botPath = this.findShortestPath(botId);
    const botDist = botPath.length > 0 ? botPath.length - 1 : Infinity;

    // Calculate current shortest path distances for all enemies and teammates
    const enemyDists = new Map<string, number>();
    enemies.forEach(e => {
      const p = this.findShortestPath(e.id);
      enemyDists.set(e.id, p.length > 0 ? p.length - 1 : Infinity);
    });

    const teammateDists = new Map<string, number>();
    teammates.forEach(t => {
      const p = this.findShortestPath(t.id);
      teammateDists.set(t.id, p.length > 0 ? p.length - 1 : Infinity);
    });

    // Find the leading enemy (the one closest to winning)
    let leadingEnemy: Player | null = null;
    let minEnemyDist = Infinity;
    enemies.forEach(e => {
      const d = enemyDists.get(e.id) ?? Infinity;
      if (d < minEnemyDist) {
        minEnemyDist = d;
        leadingEnemy = e;
      }
    });

    // 1. SMART & TACTICAL WALL PLACEMENT AI
    if (enemies.length > 0 && bot.wallsLeft > 0 && minEnemyDist !== Infinity) {
      let bestWall: { x: number; y: number; isHorizontal: boolean } | null = null;
      let maxEnemyIncrease = 0;
      let bestScore = -10000;

      for (let wx = 0; wx < this.size - 1; wx++) {
        for (let wy = 0; wy < this.size - 1; wy++) {
          for (const isHoriz of [true, false]) {
            const testWall = new Wall('temp', botId, wx, wy, isHoriz);

            if (this.canPlaceWall(testWall)) {
              this.walls.push(testWall);

              if (this.isValidState()) {
                const newBotPath = this.findShortestPath(botId);
                const newBotDist = newBotPath.length > 0 ? newBotPath.length - 1 : Infinity;
                const botIncrease = newBotDist - botDist;

                // Wall MUST NOT block bot from having a valid path
                if (newBotDist !== Infinity && botIncrease <= 1) {
                  // Check that wall doesn't harm any teammate
                  let harmsTeammate = false;
                  for (const t of teammates) {
                    const origTDist = teammateDists.get(t.id) ?? Infinity;
                    const newTPath = this.findShortestPath(t.id);
                    const newTDist = newTPath.length > 0 ? newTPath.length - 1 : Infinity;
                    if (newTDist === Infinity || (newTDist - origTDist) > 0) {
                      harmsTeammate = true;
                      break;
                    }
                  }

                  if (!harmsTeammate) {
                    // Evaluate impact on enemies
                    let currentMaxIncreaseForWall = 0;
                    let wallScore = -(botIncrease * 40);

                    for (const e of enemies) {
                      const origEDist = enemyDists.get(e.id) ?? Infinity;
                      if (origEDist === Infinity) continue;

                      const newEPath = this.findShortestPath(e.id);
                      const newEDist = newEPath.length > 0 ? newEPath.length - 1 : Infinity;
                      if (newEDist === Infinity) continue;

                      const eIncrease = newEDist - origEDist;
                      if (eIncrease > currentMaxIncreaseForWall) {
                        currentMaxIncreaseForWall = eIncrease;
                      }

                      if (eIncrease >= 1) {
                        const isLeading = leadingEnemy && e.id === leadingEnemy.id;
                        const weight = isLeading ? 120 : 70;
                        const distToEnemy = Math.abs(wx - e.x) + Math.abs(wy - e.y);
                        wallScore += (eIncrease * weight) - (distToEnemy * 2);
                      }
                    }

                    if (currentMaxIncreaseForWall >= 1 && wallScore > bestScore) {
                      bestScore = wallScore;
                      maxEnemyIncrease = currentMaxIncreaseForWall;
                      bestWall = { x: wx, y: wy, isHorizontal: isHoriz };
                    }
                  }
                }
              }

              this.walls.pop();
            }
          }
        }
      }

      // Decide whether to place wall or move pawn:
      if (bestWall && maxEnemyIncrease >= 1) {
        const isCriticalBlock = maxEnemyIncrease >= 2;
        const isEnemyClose = minEnemyDist <= 5;
        const isEnemyAheadOrEqual = minEnemyDist <= botDist + 1;
        const tacticalWallChance = Math.random() < 0.65;

        if (isCriticalBlock || isEnemyClose || isEnemyAheadOrEqual || tacticalWallChance) {
          return { type: 'wall', ...bestWall };
        }
      }
    }

    // 2. PAWN MOVEMENT (Follow reconstructed BFS path)
    if (botPath.length > 1) {
      const nextStep = botPath[1];
      const validMoves = this.getValidMoves(botId);

      const directMove = validMoves.find(m => m.x === nextStep.x && m.y === nextStep.y);
      if (directMove) {
        return { type: 'move', x: directMove.x, y: directMove.y };
      }

      // If nextStep is occupied, pick valid jump/side move that minimizes distance to target
      let bestJumpMove = validMoves[0];
      let minJumpDist = Infinity;
      for (const m of validMoves) {
        const dist = this.getShortestPathLength(m.x, m.y, bot.targetY, bot.targetX);
        if (dist < minJumpDist) {
          minJumpDist = dist;
          bestJumpMove = m;
        }
      }
      if (bestJumpMove) {
        return { type: 'move', x: bestJumpMove.x, y: bestJumpMove.y };
      }
    }

    // Fallback valid move
    const validMoves = this.getValidMoves(botId);
    if (validMoves.length > 0) {
      return { type: 'move', x: validMoves[0].x, y: validMoves[0].y };
    }

    return null;
  }

  public getBestMove(playerId: string): { x: number; y: number } | null {
    const action = this.getBotAction(playerId);
    if (action && action.type === 'move') {
      return { x: action.x, y: action.y };
    }
    const path = this.findShortestPath(playerId);
    if (path.length > 1) {
      return { x: path[1].x, y: path[1].y };
    }
    const validMoves = this.getValidMoves(playerId);
    return validMoves.length > 0 ? { x: validMoves[0].x, y: validMoves[0].y } : null;
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
        color: p.color,
        team: p.team,
        avatarUrl: p.avatarUrl,
        provider: p.provider
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
