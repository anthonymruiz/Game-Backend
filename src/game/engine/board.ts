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

    let finalX = newX;
    let finalY = newY;

    // Check if stepped on a boost / special tile
    const boost = this.boosts.find(b => b.x === newX && b.y === newY);
    if (boost) {
      if (boost.type === 'wall_pickup' || boost.type === 'extra_wall') {
        player.wallsLeft++;
        this.grid[newY][newX].hasBoost = null;
        this.boosts = this.boosts.filter(b => b.id !== boost.id);
      } else if (boost.type === 'killer_item') {
        player.hasKillerItem = true;
        this.grid[newY][newX].hasBoost = null;
        this.boosts = this.boosts.filter(b => b.id !== boost.id);
      } else if (boost.type === 'exchange_item') {
        player.hasExchangeItem = true;
        this.grid[newY][newX].hasBoost = null;
        this.boosts = this.boosts.filter(b => b.id !== boost.id);
      } else if (boost.type === 'portal') {
        if (boost.targetX !== undefined && boost.targetY !== undefined) {
          const destOccupant = this.grid[boost.targetY][boost.targetX].hasPlayer;
          if (!destOccupant) {
            finalX = boost.targetX;
            finalY = boost.targetY;
          } else {
            const adjDirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
            let foundFree = false;
            for (const d of adjDirs) {
              const ax = boost.targetX + d.dx;
              const ay = boost.targetY + d.dy;
              if (ax >= 0 && ax < this.size && ay >= 0 && ay < this.size && !this.grid[ay][ax].hasPlayer) {
                finalX = ax;
                finalY = ay;
                foundFree = true;
                break;
              }
            }
            if (!foundFree) {
              finalX = boost.targetX;
              finalY = boost.targetY;
            }
          }
        }
      }
    }

    player.x = finalX;
    player.y = finalY;
    this.grid[finalY][finalX].hasPlayer = player.id;
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
    const mid = Math.floor(this.size / 2);
    const x = Math.floor(Math.random() * this.size);
    const y = Math.floor(Math.random() * this.size);
    if (!(x === mid && y === mid) && !this.grid[y][x].hasPlayer && !this.grid[y][x].hasBoost) {
      const boost = new Boost(Math.random().toString(), 'extra_wall', x, y);
      this.boosts.push(boost);
      this.grid[y][x].hasBoost = boost.id;
    }
  }

  public findShortestPathToGoal(startX: number, startY: number, targetY?: number, targetX?: number): Coordinate[] {
    const queue: { x: number; y: number; path: Coordinate[] }[] = [
      { x: startX, y: startY, path: [{ x: startX, y: startY }] }
    ];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { x, y, path } = current;

      if (this.isGoalReached(x, y, targetY, targetX)) return path;

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

  public findShortestPath(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    return this.findShortestPathToGoal(player.x, player.y, player.targetY, player.targetX);
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

  public getBotAction(botId: string, isTeamMode: boolean = false): { type: 'move'; x: number; y: number } | { type: 'wall'; x: number; y: number; isHorizontal: boolean } | null {
    const bot = this.players.get(botId);
    if (!bot) return null;
    const isDuelMode = !isTeamMode && this.players.size === 2;

    // Separate all other players into enemies and teammates based on team
    const enemies: Player[] = [];
    const teammates: Player[] = [];

    for (const [id, p] of this.players.entries()) {
      if (id === botId) continue;
      if (isTeamMode && bot.team !== undefined && p.team === bot.team) {
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

    if (bot.wallsLeft > 0) {
      const portalThreats = enemies.flatMap(enemy => this.getBeneficialPortalThreats(enemy));
      if (portalThreats.length > 0) {
        const defenseWall = this.getPortalDefenseWall(botId, botDist, teammates, teammateDists, portalThreats);
        if (defenseWall) return { type: 'wall', ...defenseWall };
      }
    }

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
                  // Check that wall doesn't harm or hinder any teammate
                  let harmsTeammate = false;
                  for (const t of teammates) {
                    const origTDist = teammateDists.get(t.id) ?? Infinity;
                    const newTPath = this.findShortestPath(t.id);
                    const newTDist = newTPath.length > 0 ? newTPath.length - 1 : Infinity;

                    // 1. Must not increase teammate's shortest path
                    if (newTDist === Infinity || (newTDist - origTDist) > 0) {
                      harmsTeammate = true;
                      break;
                    }

                    // 2. Must not place wall in immediate proximity to teammate (Manhattan distance <= 2)
                    const distToTeammate = Math.abs(wx - t.x) + Math.abs(wy - t.y);
                    if (distToTeammate <= 2) {
                      harmsTeammate = true;
                      break;
                    }

                    // 3. Must not block the row directly in front of teammate towards their target goal
                    if (t.targetY !== undefined) {
                      const teammateFwdY = t.targetY < t.y ? t.y - 1 : t.y;
                      if (isHoriz && Math.abs(wx - t.x) <= 1 && wy === teammateFwdY) {
                        harmsTeammate = true;
                        break;
                      }
                    }
                  }

                  if (!harmsTeammate) {
                    // Evaluate impact on enemies
                    let currentMaxIncreaseForWall = 0;
                    let leadingEnemyIncrease = 0;
                    let affectedEnemies = 0;
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
                        affectedEnemies++;
                        const isLeading = leadingEnemy && e.id === leadingEnemy.id;
                        if (isLeading) leadingEnemyIncrease = eIncrease;
                        const weight = isLeading ? 120 : 70;
                        const distToEnemy = Math.abs(wx - e.x) + Math.abs(wy - e.y);
                        wallScore += (eIncrease * weight) - (distToEnemy * 2);
                      }
                    }

                    const hasMultiplayerImpact = leadingEnemyIncrease >= 1
                      || (enemies.length > 1 && affectedEnemies === enemies.length);
                    const usefulEnemyIncrease = isDuelMode
                      ? currentMaxIncreaseForWall
                      : leadingEnemyIncrease >= 1
                        ? leadingEnemyIncrease
                        : hasMultiplayerImpact
                          ? 1
                          : 0;

                    if (usefulEnemyIncrease >= 1 && wallScore > bestScore) {
                      bestScore = wallScore;
                      maxEnemyIncrease = usefulEnemyIncrease;
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
        const isEnemyClose = minEnemyDist <= (isDuelMode ? 6 : bot.targetX !== undefined ? 3 : 6);
        const isEnemyAheadOrEqual = isDuelMode ? minEnemyDist <= botDist : minEnemyDist < botDist;
        const isStartOfGame = isDuelMode
          ? minEnemyDist >= 7 && bot.wallsLeft >= 9
          : isTeamMode
            ? minEnemyDist >= 7
            : bot.targetX !== undefined
              ? minEnemyDist >= Math.floor(this.size / 2)
              : minEnemyDist >= 7;

        if (isCriticalBlock && (isDuelMode || (!isStartOfGame && (isEnemyClose || isEnemyAheadOrEqual)))) {
          return { type: 'wall', ...bestWall };
        }

        if (!isStartOfGame && (isEnemyClose || isEnemyAheadOrEqual)) {
          const wallChance = isDuelMode ? 0.65 : isTeamMode ? 0.35 : 0.25;
          if (Math.random() < wallChance) {
            return { type: 'wall', ...bestWall };
          }
        }
      }
    }

    // 2. PAWN MOVEMENT (Evaluate portal shortcuts & follow BFS path)
    const validMoves = this.getValidMoves(botId);

    // Evaluate portal shortcuts
    let bestPortalTarget: { portalX: number; portalY: number; totalDist: number } | null = null;
    const portalBoosts = this.boosts.filter(b => b.type === 'portal' && b.targetX !== undefined && b.targetY !== undefined);

    for (const p of portalBoosts) {
      const path1 = this.findShortestPathToGoal(bot.x, bot.y, p.y, p.x);
      if (path1.length > 0) {
        const dist1 = path1.length - 1; // distance to portal entrance
        const dist2 = this.getShortestPathLength(p.targetX!, p.targetY!, bot.targetY, bot.targetX); // distance from exit to goal
        const totalViaPortal = dist1 + dist2;
        if (dist2 !== Infinity && totalViaPortal < botDist) {
          if (!bestPortalTarget || totalViaPortal < bestPortalTarget.totalDist) {
            bestPortalTarget = {
              portalX: p.x,
              portalY: p.y,
              totalDist: totalViaPortal
            };
          }
        }
      }
    }

    if (bestPortalTarget) {
      const portalPath = this.findShortestPathToGoal(bot.x, bot.y, bestPortalTarget.portalY, bestPortalTarget.portalX);
      if (portalPath.length > 1) {
        const nextStep = portalPath[1];
        const directMove = validMoves.find(m => m.x === nextStep.x && m.y === nextStep.y);
        if (directMove) {
          return { type: 'move', x: directMove.x, y: directMove.y };
        }
      }
    }

    if (botPath.length > 1) {
      const nextStep = botPath[1];

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
    if (validMoves.length > 0) {
      return { type: 'move', x: validMoves[0].x, y: validMoves[0].y };
    }

    return null;
  }

  public getBestMove(playerId: string, isTeamMode: boolean = false): { x: number; y: number } | null {
    const action = this.getBotAction(playerId, isTeamMode);
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

  private getBeneficialPortalThreats(player: Player): { player: Player; portal: Boost; distance: number }[] {
    if (player.isDead) return [];

    const normalDistance = this.getShortestPathLength(player.x, player.y, player.targetY, player.targetX, player.id);
    return this.boosts.flatMap(portal => {
      if (
        portal.type !== 'portal'
        || portal.targetX === undefined
        || portal.targetY === undefined
        || this.grid[portal.targetY]?.[portal.targetX]?.hasPlayer
      ) {
        return [];
      }

      const pathToPortal = this.findShortestPathToGoal(player.x, player.y, portal.y, portal.x);
      const distance = pathToPortal.length - 1;
      if (distance !== 1) return [];

      const distanceAfterPortal = this.getShortestPathLength(
        portal.targetX,
        portal.targetY,
        player.targetY,
        player.targetX
      );
      return distance + distanceAfterPortal < normalDistance
        ? [{ player, portal, distance }]
        : [];
    });
  }

  private getPortalDefenseWall(
    botId: string,
    botDistance: number,
    teammates: Player[],
    teammateDistances: Map<string, number>,
    threats: { player: Player; portal: Boost; distance: number }[]
  ): { x: number; y: number; isHorizontal: boolean } | null {
    let bestWall: { x: number; y: number; isHorizontal: boolean } | null = null;
    let bestScore = -Infinity;

    for (let x = 0; x < this.size - 1; x++) {
      for (let y = 0; y < this.size - 1; y++) {
        for (const isHorizontal of [true, false]) {
          const wall = new Wall('portal-defense', botId, x, y, isHorizontal);
          if (!this.canPlaceWall(wall)) continue;

          this.walls.push(wall);
          let score = -Infinity;

          if (this.isValidState()) {
            const newBotDistance = this.getShortestPathLength(
              this.players.get(botId)!.x,
              this.players.get(botId)!.y,
              this.players.get(botId)!.targetY,
              this.players.get(botId)!.targetX,
              botId
            );
            const botPathIncrease = newBotDistance - botDistance;
            const harmsTeammate = teammates.some(teammate => {
              const newDistance = this.getShortestPathLength(
                teammate.x,
                teammate.y,
                teammate.targetY,
                teammate.targetX,
                teammate.id
              );
              return newDistance > (teammateDistances.get(teammate.id) ?? Infinity);
            });

            if (newBotDistance !== Infinity && botPathIncrease <= 1 && !harmsTeammate) {
              for (const threat of threats) {
                const newPathToPortal = this.findShortestPathToGoal(
                  threat.player.x,
                  threat.player.y,
                  threat.portal.y,
                  threat.portal.x
                );
                const newDistance = newPathToPortal.length - 1;
                if (newDistance > threat.distance) {
                  const increase = newDistance - threat.distance;
                  const proximity = Math.abs(x - threat.player.x) + Math.abs(y - threat.player.y);
                  score = Math.max(score, increase * 100 - proximity * 2 - Math.max(0, botPathIncrease) * 40);
                }
              }
            }
          }

          this.walls.pop();

          if (score > bestScore) {
            bestScore = score;
            bestWall = { x, y, isHorizontal };
          }
        }
      }
    }

    return bestWall;
  }

  public spawnSingleRandomBoost() {
    // 1. Clear all existing boosts from grid and array
    this.boosts.forEach(b => {
      if (this.grid[b.y]?.[b.x]) {
        this.grid[b.y][b.x].hasBoost = null;
      }
    });
    this.boosts = [];

    // 2. Find empty cells without player and NOT on the center goal flag (mid, mid)
    const mid = Math.floor(this.size / 2);
    const emptyCells: { x: number; y: number }[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.grid[y][x];
        const isCenter = (x === mid && y === mid);
        if (!cell.hasPlayer && !isCenter) {
          emptyCells.push({ x, y });
        }
      }
    }

    if (emptyCells.length === 0) return;

    // 3. Choose 1 random boost type ('wall_pickup' or 'portal')
    const types: ('wall_pickup' | 'portal')[] = ['wall_pickup', 'portal'];
    const selectedType = types[Math.floor(Math.random() * types.length)];

    if (selectedType === 'wall_pickup') {
      const randIdx = Math.floor(Math.random() * emptyCells.length);
      const chosen = emptyCells[randIdx];
      const boostId = `boost_wall_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const boost = new Boost(boostId, 'wall_pickup', chosen.x, chosen.y);
      this.boosts.push(boost);
      this.grid[chosen.y][chosen.x].hasBoost = boostId;
    } else if (selectedType === 'portal') {
      if (emptyCells.length < 2) return;
      const randIdx1 = Math.floor(Math.random() * emptyCells.length);
      const posA = emptyCells.splice(randIdx1, 1)[0];

      const randIdx2 = Math.floor(Math.random() * emptyCells.length);
      const posB = emptyCells.splice(randIdx2, 1)[0];

      const portalIdA = `portal_${Date.now()}_A_${Math.random().toString(36).substring(2, 6)}`;
      const portalIdB = `portal_${Date.now()}_B_${Math.random().toString(36).substring(2, 6)}`;

      const portalA = new Boost(portalIdA, 'portal', posA.x, posA.y, posB.x, posB.y);
      const portalB = new Boost(portalIdB, 'portal', posB.x, posB.y, posA.x, posA.y);

      this.boosts.push(portalA, portalB);
      this.grid[posA.y][posA.x].hasBoost = portalIdA;
      this.grid[posB.y][posB.x].hasBoost = portalIdB;
    }
  }

  public spawnWallPickups(count: number = 2) {
    this.spawnSingleRandomBoost();
  }

  public spawnPortals() {
    this.spawnSingleRandomBoost();
  }

  public ensureMinWallPickups(minCount: number = 2) {
    if (this.boosts.length === 0) {
      this.spawnSingleRandomBoost();
    }
  }

  public spawnKillerItem(): boolean {
    return this.spawnSpecialItem('killer_item');
  }

  public spawnExchangeItem(): boolean {
    return this.spawnSpecialItem('exchange_item');
  }

  private spawnSpecialItem(type: 'killer_item' | 'exchange_item'): boolean {
    const mid = Math.floor(this.size / 2);
    const emptyCells: { x: number; y: number }[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.grid[y][x];
        const isCenter = (x === mid && y === mid);
        if (!cell.hasPlayer && !cell.hasBoost && !isCenter) {
          emptyCells.push({ x, y });
        }
      }
    }
    if (emptyCells.length === 0) return false;
    const randIdx = Math.floor(Math.random() * emptyCells.length);
    const chosen = emptyCells[randIdx];
    const boostId = `boost_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const boost = new Boost(boostId, type, chosen.x, chosen.y);
    this.boosts.push(boost);
    this.grid[chosen.y][chosen.x].hasBoost = boostId;
    return true;
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
        isDead: p.isDead,
        hasKillerItem: p.hasKillerItem,
        hasExchangeItem: p.hasExchangeItem,
        color: p.color,
        pawnColor: p.pawnColor,
        pawnColorItemId: p.pawnColorItemId,
        skinItemId: p.skinItemId,
        skinIcon: p.skinIcon,
        skinAllowsColor: p.skinAllowsColor,
        movementTrailId: p.movementTrailId,
        movementTrailIcon: p.movementTrailIcon,
        wallEffectId: p.wallEffectId,
        wallEffectIcon: p.wallEffectIcon,
        team: p.team,
        avatarUrl: p.avatarUrl,
        provider: p.provider
      };
    });

    return {
      size: this.size,
      grid: this.grid,
      walls: this.walls,
      boosts: this.boosts.map(b => ({
        id: b.id,
        type: b.type,
        x: b.x,
        y: b.y,
        targetX: b.targetX,
        targetY: b.targetY
      })),
      players: playersObj,
      validMoves: forPlayerId ? this.getValidMoves(forPlayerId) : []
    };
  }
}
