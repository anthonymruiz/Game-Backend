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
    const ignoresWalls = player.ghostTurnsRemaining > 0;

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
        if (ignoresWalls || !this.isWallBlocking(px, py, nx, ny)) {
          const occupant = this.grid[ny][nx].hasPlayer;

          if (!occupant || occupant === playerId) {
            // Unoccupied cell: standard move
            validMoves.push({ x: nx, y: ny });
          } else {
            // Occupied cell by opponent: PAWN JUMPING RULES!
            const straightX = nx + dir.dx;
            const straightY = ny + dir.dy;

            const isStraightInBounds = straightX >= 0 && straightX < this.size && straightY >= 0 && straightY < this.size;
            const isStraightWallBlocked = isStraightInBounds
              ? !ignoresWalls && this.isWallBlocking(nx, ny, straightX, straightY)
              : true;
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
                  if ((ignoresWalls || !this.isWallBlocking(nx, ny, sideX, sideY)) && !this.grid[sideY][sideX].hasPlayer) {
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
    const hadGhostPower = player.ghostTurnsRemaining > 0;

    // Enforce Quoridor move and jump rules
    const validMoves = this.getValidMoves(playerId);
    const isValid = validMoves.some(m => m.x === newX && m.y === newY);
    if (!isValid) return false;

    // Move player
    this.grid[player.y][player.x].hasPlayer = null;

    let finalX = newX;
    let finalY = newY;
    let pickedUpGhost = false;

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
      } else if (boost.type === 'ghost') {
        player.ghostTurnsRemaining = 3;
        pickedUpGhost = true;
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
    if (hadGhostPower && !pickedUpGhost && player.ghostTurnsRemaining > 0) {
      player.ghostTurnsRemaining--;
    }
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

  protected isWallBlocking(x1: number, y1: number, x2: number, y2: number): boolean {
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

  public findShortestPathToGoal(
    startX: number,
    startY: number,
    targetY?: number,
    targetX?: number,
    ghostTurnsRemaining: number = 0
  ): Coordinate[] {
    const queue: { x: number; y: number; path: Coordinate[] }[] = [
      { x: startX, y: startY, path: [{ x: startX, y: startY }] }
    ];
    const visited = new Set<string>();
    visited.add(`${startX},${startY},${ghostTurnsRemaining}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { x, y, path } = current;
      const remainingGhostTurns = Math.max(0, ghostTurnsRemaining - (path.length - 1));

      if (this.isGoalReached(x, y, targetY, targetX)) return path;

      const neighbors = [
        { x: x, y: y - 1 },
        { x: x, y: y + 1 },
        { x: x - 1, y: y },
        { x: x + 1, y: y }
      ];

      for (const n of neighbors) {
        if (n.x >= 0 && n.x < this.size && n.y >= 0 && n.y < this.size) {
          if (remainingGhostTurns > 0 || !this.isWallBlocking(x, y, n.x, n.y)) {
            const nextRemainingGhostTurns = Math.max(0, remainingGhostTurns - 1);
            const key = `${n.x},${n.y},${nextRemainingGhostTurns}`;
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
    return this.findShortestPathToGoal(
      player.x,
      player.y,
      player.targetY,
      player.targetX,
      player.ghostTurnsRemaining
    );
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

  public getBotStrategicDistance(
    playerId: string,
    startX: number,
    startY: number,
    excludedPortalId?: string,
    ghostTurnsRemainingOverride?: number
  ): number {
    const player = this.players.get(playerId);
    if (!player) return Infinity;
    const startingGhostTurns = ghostTurnsRemainingOverride ?? player.ghostTurnsRemaining;

    const queue: { x: number; y: number; distance: number; ghostTurnsRemaining: number }[] = [
      { x: startX, y: startY, distance: 0, ghostTurnsRemaining: startingGhostTurns }
    ];
    const visited = new Set<string>([`${startX},${startY},${startingGhostTurns}`]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (this.isGoalReached(current.x, current.y, player.targetY, player.targetX)) {
        return current.distance;
      }

      for (const move of [
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y }
      ]) {
        if (move.x < 0 || move.x >= this.size || move.y < 0 || move.y >= this.size ||
            (current.ghostTurnsRemaining <= 0 &&
              this.isWallBlocking(current.x, current.y, move.x, move.y))) continue;

        const portal = this.boosts.find(boost =>
          boost.type === 'portal' && boost.id !== excludedPortalId &&
          boost.x === move.x && boost.y === move.y &&
          boost.targetX !== undefined && boost.targetY !== undefined
        );
        const entranceOccupant = this.grid[move.y]?.[move.x]?.hasPlayer;
        if (portal && entranceOccupant && entranceOccupant !== playerId) continue;

        const destination = portal
          ? this.getPortalLandingPosition(portal, playerId)
          : move;
        const remainingGhostTurns = Math.max(0, current.ghostTurnsRemaining - 1);
        const key = `${destination.x},${destination.y},${remainingGhostTurns}`;
        if (visited.has(key)) continue;

        visited.add(key);
        queue.push({
          ...destination,
          distance: current.distance + 1,
          ghostTurnsRemaining: remainingGhostTurns
        });
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

  private getPortalLandingPosition(portal: Boost, movingPlayerId: string): Coordinate {
    const targetX = portal.targetX!;
    const targetY = portal.targetY!;
    const occupant = this.grid[targetY]?.[targetX]?.hasPlayer;
    if (!occupant || occupant === movingPlayerId) return { x: targetX, y: targetY };

    for (const direction of [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]) {
      const x = targetX + direction.dx;
      const y = targetY + direction.dy;
      if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
      const adjacentOccupant = this.grid[y][x].hasPlayer;
      if (!adjacentOccupant || adjacentOccupant === movingPlayerId) return { x, y };
    }
    return { x: targetX, y: targetY };
  }

  private getMoveDestination(player: Player, move: Coordinate): Coordinate {
    const portal = this.boosts.find(boost => boost.type === 'portal' && boost.x === move.x && boost.y === move.y);
    if (!portal || portal.targetX === undefined || portal.targetY === undefined) return move;
    return this.getPortalLandingPosition(portal, player.id);
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
    const botDist = this.getBotStrategicDistance(botId, bot.x, bot.y);

    // Calculate current shortest path distances for all enemies and teammates
    const enemyDists = new Map<string, number>();
    enemies.forEach(e => {
      enemyDists.set(e.id, this.getBotStrategicDistance(e.id, e.x, e.y));
    });

    const teammateDists = new Map<string, number>();
    teammates.forEach(t => {
      teammateDists.set(t.id, this.getBotStrategicDistance(t.id, t.x, t.y));
    });

    if (bot.wallsLeft > 0) {
      const portalThreats = enemies.flatMap(enemy => this.getBeneficialPortalThreats(enemy));
      if (portalThreats.length > 0) {
        const defenseWall = this.getPortalDefenseWall(botId, botDist, teammates, teammateDists, portalThreats);
        if (defenseWall) return { type: 'wall', ...defenseWall };
      }

      const boostDefenseWall = this.getBoostDefenseWall(bot, enemies, teammates, isTeamMode);
      if (boostDefenseWall) return { type: 'wall', ...boostDefenseWall };
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
                const newBotDist = this.getBotStrategicDistance(botId, bot.x, bot.y);
                const botIncrease = newBotDist - botDist;

                // Wall MUST NOT block bot from having a valid path
                if (newBotDist !== Infinity && botIncrease <= 1) {
                  // Check that wall doesn't harm or hinder any teammate
                  let harmsTeammate = false;
                  for (const t of teammates) {
                    const origTDist = teammateDists.get(t.id) ?? Infinity;
                    const newTDist = this.getBotStrategicDistance(t.id, t.x, t.y);

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

                      const newEDist = this.getBotStrategicDistance(e.id, e.x, e.y);
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
          const wallChance = isDuelMode ? 0.65 : isTeamMode ? 0.35 : 1;
          if (Math.random() < wallChance) {
            return { type: 'wall', ...bestWall };
          }
        }
      }
    }

    // 2. PAWN MOVEMENT (Evaluate portal shortcuts & follow BFS path)
    const validMoves = this.getValidMoves(botId);
    const preferredStep = botPath[1];
    const enemyExchangeThreat = this.boosts
      .filter(boost => boost.type === 'exchange_item')
      .reduce((bestThreat, boost) => {
        for (const enemy of enemies) {
          const canReachBoost = this.getValidMoves(enemy.id)
            .some(move => move.x === boost.x && move.y === boost.y);
          if (!canReachBoost) continue;
          const exchange = this.getBestBotExchangeTarget(enemy.id, isTeamMode);
          bestThreat = Math.max(bestThreat, exchange?.score ?? 0);
        }
        return bestThreat;
      }, 0);
    let bestMove: Coordinate | null = null;
    let bestMoveScore = -Infinity;

    for (const move of validMoves) {
      const boost = this.boosts.find(candidate => candidate.x === move.x && candidate.y === move.y);
      const destination = this.getMoveDestination(bot, move);
      const excludedPortalId = boost?.type === 'portal' ? boost.id : undefined;
      const ownDistance = this.getBotStrategicDistance(
        botId,
        destination.x,
        destination.y,
        excludedPortalId,
        boost?.type === 'ghost' ? 3 : undefined
      );
      if (ownDistance === Infinity) continue;

      let score = -ownDistance * 100;
      if (preferredStep?.x === move.x && preferredStep.y === move.y) score += 1;

      if (boost?.type === 'portal') {
        for (const enemy of enemies) {
          const before = this.getBotStrategicDistance(enemy.id, enemy.x, enemy.y);
          const after = this.getBotStrategicDistance(enemy.id, enemy.x, enemy.y, boost.id);
          if (before !== Infinity && after !== Infinity && after > before) {
            score += (after - before) * 80;
          }
        }
        for (const teammate of teammates) {
          const before = this.getBotStrategicDistance(teammate.id, teammate.x, teammate.y);
          const after = this.getBotStrategicDistance(teammate.id, teammate.x, teammate.y, boost.id);
          if (before !== Infinity && after !== Infinity && after > before) {
            score -= (after - before) * 100;
          }
        }
      } else if (boost?.type === 'wall_pickup' || boost?.type === 'extra_wall') {
        if (bot.wallsLeft <= 2) score += 8;
      } else if (boost?.type === 'killer_item') {
        score += 2;
      } else if (boost?.type === 'exchange_item') {
        const exchange = this.getBestBotExchangeTarget(botId, isTeamMode);
        if (exchange) score += 60 + Math.min(exchange.score, 6) * 20;
        if (enemyExchangeThreat > 0) {
          score += 80 + Math.min(enemyExchangeThreat, 6) * 20;
        }
      } else if (boost?.type === 'ghost') {
        score += 1;
      }

      if (score > bestMoveScore) {
        bestMoveScore = score;
        bestMove = move;
      }
    }

    if (bestMove) return { type: 'move', x: bestMove.x, y: bestMove.y };

    return null;
  }

  public getBestBotExchangeTarget(
    holderId: string,
    isTeamMode: boolean = false
  ): { target: Player; score: number } | null {
    const holder = this.players.get(holderId);
    if (!holder || holder.isDead) return null;

    let bestTarget: Player | null = null;
    let bestScore = 0;
    const holderDistance = this.getBotStrategicDistance(holder.id, holder.x, holder.y);

    for (const candidate of this.players.values()) {
      if (candidate.isDead || candidate.id === holder.id ||
          (isTeamMode && holder.team !== undefined && candidate.team === holder.team)) continue;

      const candidateDistance = this.getBotStrategicDistance(candidate.id, candidate.x, candidate.y);
      const holderDistanceAfterSwap = this.getBotStrategicDistance(holder.id, candidate.x, candidate.y);
      const candidateDistanceAfterSwap = this.getBotStrategicDistance(candidate.id, holder.x, holder.y);
      if ([holderDistance, candidateDistance, holderDistanceAfterSwap, candidateDistanceAfterSwap]
        .some(distance => !Number.isFinite(distance))) continue;

      const holderProgress = holderDistance - holderDistanceAfterSwap;
      const candidateDelay = candidateDistanceAfterSwap - candidateDistance;
      const score = holderProgress * 3 + candidateDelay;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget ? { target: bestTarget, score: bestScore } : null;
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

    return this.boosts.flatMap(portal => {
      if (
        portal.type !== 'portal'
        || portal.targetX === undefined
        || portal.targetY === undefined
        || (this.grid[portal.targetY]?.[portal.targetX]?.hasPlayer &&
            this.grid[portal.targetY][portal.targetX].hasPlayer !== player.id)
      ) {
        return [];
      }

      const pathToPortal = this.findShortestPathToGoal(
        player.x,
        player.y,
        portal.y,
        portal.x,
        player.ghostTurnsRemaining
      );
      const distance = pathToPortal.length - 1;
      if (distance !== 1) return [];

      const distanceWithPortal = this.getBotStrategicDistance(player.id, player.x, player.y);
      const distanceWithoutPortal = this.getBotStrategicDistance(player.id, player.x, player.y, portal.id);
      return distanceWithoutPortal > distanceWithPortal
        ? [{ player, portal, distance }]
        : [];
    });
  }

  private getBoostDefenseWall(
    bot: Player,
    enemies: Player[],
    teammates: Player[],
    isTeamMode: boolean
  ): { x: number; y: number; isHorizontal: boolean } | null {
    const threats = this.boosts.flatMap(boost => {
      if (boost.type === 'portal') return [];

      return enemies.flatMap(enemy => {
        if (!this.isBoostStrategicallyValuable(boost, enemy, isTeamMode)) return [];
        const enemyDistance = this.getBotDistanceToCell(enemy.id, boost.x, boost.y);
        const botDistance = this.getBotDistanceToCell(bot.id, boost.x, boost.y);
        if (enemyDistance > 1 || enemyDistance > botDistance ||
            !this.getValidMoves(enemy.id).some(move => move.x === boost.x && move.y === boost.y)) {
          return [];
        }
        return [{ boost, enemy, enemyDistance }];
      });
    });

    if (threats.length === 0) return null;

    const botDistance = this.getBotStrategicDistance(bot.id, bot.x, bot.y);
    const teammateDistances = new Map(
      teammates.map(teammate => [
        teammate.id,
        this.getBotStrategicDistance(teammate.id, teammate.x, teammate.y)
      ])
    );
    let bestWall: { x: number; y: number; isHorizontal: boolean } | null = null;
    let bestScore = 0;

    for (let x = 0; x < this.size - 1; x++) {
      for (let y = 0; y < this.size - 1; y++) {
        for (const isHorizontal of [true, false]) {
          const wall = new Wall('boost-defense', bot.id, x, y, isHorizontal);
          if (!this.canPlaceWall(wall)) continue;

          this.walls.push(wall);
          if (this.isValidState()) {
            const newBotDistance = this.getBotStrategicDistance(bot.id, bot.x, bot.y);
            const harmsTeammate = teammates.some(teammate =>
              this.getBotStrategicDistance(teammate.id, teammate.x, teammate.y) >
              (teammateDistances.get(teammate.id) ?? Infinity)
            );

            if (newBotDistance <= botDistance && !harmsTeammate) {
              for (const threat of threats) {
                const newEnemyDistance = this.getBotDistanceToCell(
                  threat.enemy.id,
                  threat.boost.x,
                  threat.boost.y
                );
                if (newEnemyDistance <= threat.enemyDistance) continue;

                const proximity = Math.abs(x - threat.enemy.x) + Math.abs(y - threat.enemy.y);
                const score = (newEnemyDistance - threat.enemyDistance) * 100 - proximity * 2;
                if (score > bestScore) {
                  bestScore = score;
                  bestWall = { x, y, isHorizontal };
                }
              }
            }
          }
          this.walls.pop();
        }
      }
    }

    return bestWall;
  }

  private isBoostStrategicallyValuable(boost: Boost, player: Player, isTeamMode: boolean): boolean {
    switch (boost.type) {
      case 'ghost': {
        const normalDistance = this.getBotStrategicDistance(player.id, boost.x, boost.y);
        const ghostDistance = this.getBotStrategicDistance(player.id, boost.x, boost.y, undefined, 3);
        return ghostDistance < normalDistance;
      }
      case 'killer_item':
        return !isTeamMode && this.players.size > 2;
      case 'exchange_item':
        return (this.getBestBotExchangeTarget(player.id, isTeamMode)?.score ?? 0) > 0;
      case 'wall_pickup':
      case 'extra_wall':
        return player.wallsLeft <= 2;
      default:
        return false;
    }
  }

  private getBotDistanceToCell(playerId: string, targetX: number, targetY: number): number {
    const player = this.players.get(playerId);
    if (!player) return Infinity;

    const queue: { x: number; y: number; distance: number; ghostTurnsRemaining: number }[] = [{
      x: player.x,
      y: player.y,
      distance: 0,
      ghostTurnsRemaining: player.ghostTurnsRemaining
    }];
    const visited = new Set<string>([`${player.x},${player.y},${player.ghostTurnsRemaining}`]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.x === targetX && current.y === targetY) return current.distance;

      for (const move of [
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y }
      ]) {
        if (move.x < 0 || move.x >= this.size || move.y < 0 || move.y >= this.size ||
            (current.ghostTurnsRemaining <= 0 &&
              this.isWallBlocking(current.x, current.y, move.x, move.y))) continue;

        const destination = this.getMoveDestination(player, move);
        const remainingGhostTurns = Math.max(0, current.ghostTurnsRemaining - 1);
        const key = `${destination.x},${destination.y},${remainingGhostTurns}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({
          ...destination,
          distance: current.distance + 1,
          ghostTurnsRemaining: remainingGhostTurns
        });
      }
    }

    return Infinity;
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
            const bot = this.players.get(botId)!;
            const newBotDistance = this.getBotStrategicDistance(botId, bot.x, bot.y);
            const botPathIncrease = newBotDistance - botDistance;
            const harmsTeammate = teammates.some(teammate => {
              const newDistance = this.getBotStrategicDistance(teammate.id, teammate.x, teammate.y);
              return newDistance > (teammateDistances.get(teammate.id) ?? Infinity);
            });

            if (newBotDistance !== Infinity && botPathIncrease <= 1 && !harmsTeammate) {
              for (const threat of threats) {
                const newPathToPortal = this.findShortestPathToGoal(
                  threat.player.x,
                  threat.player.y,
                  threat.portal.y,
                  threat.portal.x,
                  threat.player.ghostTurnsRemaining
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

  public spawnSingleRandomBoost(preserveSpecialBoosts: boolean = false) {
    const preservedTypes: Boost['type'][] = ['ghost', 'killer_item', 'exchange_item'];
    const removedBoosts = this.boosts.filter(boost =>
      !preserveSpecialBoosts || !preservedTypes.includes(boost.type)
    );
    removedBoosts.forEach(boost => {
      if (this.grid[boost.y]?.[boost.x]?.hasBoost === boost.id) {
        this.grid[boost.y][boost.x].hasBoost = null;
      }
    });
    this.boosts = this.boosts.filter(boost =>
      preserveSpecialBoosts && preservedTypes.includes(boost.type)
    );

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

  public spawnFfaBoost(type?: 'wall_pickup' | 'portal' | 'ghost'): boolean {
    const selectedType = type ?? (['wall_pickup', 'portal', 'ghost'] as const)[
      Math.floor(Math.random() * 3)
    ];
    if (this.boosts.some(boost => boost.type === selectedType)) return false;
    const emptyCells = this.getAccessibleEmptyCells();
    if (emptyCells.length === 0) return false;

    if (selectedType === 'portal') {
      if (emptyCells.length < 2) return false;
      const firstPosition = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      const secondPositions = emptyCells.filter(position =>
        position.x !== firstPosition.x || position.y !== firstPosition.y
      );
      const secondPosition = secondPositions[Math.floor(Math.random() * secondPositions.length)];
      const idSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const firstPortal = new Boost(`ffa_portal_a_${idSuffix}`, 'portal', firstPosition.x, firstPosition.y, secondPosition.x, secondPosition.y);
      const secondPortal = new Boost(`ffa_portal_b_${idSuffix}`, 'portal', secondPosition.x, secondPosition.y, firstPosition.x, firstPosition.y);
      this.boosts.push(firstPortal, secondPortal);
      this.grid[firstPosition.y][firstPosition.x].hasBoost = firstPortal.id;
      this.grid[secondPosition.y][secondPosition.x].hasBoost = secondPortal.id;
      return true;
    }

    if (selectedType === 'ghost') return this.spawnGhostItem();
    const position = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const id = `ffa_boost_${selectedType}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const boost = new Boost(id, selectedType, position.x, position.y);
    this.boosts.push(boost);
    this.grid[position.y][position.x].hasBoost = id;
    return true;
  }

  public spawnPortals() {
    this.spawnSingleRandomBoost();
  }

  public ensureMinWallPickups(minCount: number = 2) {
    if (this.boosts.length === 0) {
      this.spawnFfaBoost('wall_pickup');
    }
  }

  public spawnKillerItem(): boolean {
    return this.spawnSpecialItem('killer_item');
  }

  public spawnExchangeItem(): boolean {
    return this.spawnSpecialItem('exchange_item');
  }

  public spawnGhostItem(): boolean {
    if (this.boosts.some(boost => boost.type === 'ghost')) return false;
    const emptyCells = this.getAccessibleEmptyCells();
    if (emptyCells.length === 0) return false;
    const chosen = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const id = `boost_ghost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const boost = new Boost(id, 'ghost', chosen.x, chosen.y);
    this.boosts.push(boost);
    this.grid[chosen.y][chosen.x].hasBoost = id;
    return true;
  }

  public removeBoostsOfType(type: Boost['type']): number {
    const removed = this.boosts.filter(boost => boost.type === type);
    for (const boost of removed) {
      if (this.grid[boost.y]?.[boost.x]?.hasBoost === boost.id) {
        this.grid[boost.y][boost.x].hasBoost = null;
      }
    }
    if (removed.length > 0) {
      this.boosts = this.boosts.filter(boost => boost.type !== type);
    }
    return removed.length;
  }

  private spawnSpecialItem(type: 'killer_item' | 'exchange_item'): boolean {
    if (this.boosts.some(boost => boost.type === type)) return false;
    const emptyCells = this.getAccessibleEmptyCells();
    if (emptyCells.length === 0) return false;
    const chosen = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const boostId = `boost_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const boost = new Boost(boostId, type, chosen.x, chosen.y);
    this.boosts.push(boost);
    this.grid[chosen.y][chosen.x].hasBoost = boostId;
    return true;
  }

  private getAccessibleEmptyCells(): Coordinate[] {
    const reachable = new Set<string>();
    for (const player of this.players.values()) {
      if (player.isDead) continue;
      const queue: Coordinate[] = [{ x: player.x, y: player.y }];
      const visited = new Set<string>([`${player.x},${player.y}`]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        reachable.add(`${current.x},${current.y}`);
        for (const next of [
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y }
        ]) {
          const key = `${next.x},${next.y}`;
          if (next.x < 0 || next.x >= this.size || next.y < 0 || next.y >= this.size ||
              visited.has(key) || this.isWallBlocking(current.x, current.y, next.x, next.y)) continue;
          visited.add(key);
          queue.push(next);
        }
      }
    }

    const mid = Math.floor(this.size / 2);
    const emptyCells: Coordinate[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const cell = this.grid[y][x];
        if (!cell.hasPlayer && !cell.hasBoost && !(x === mid && y === mid) && reachable.has(`${x},${y}`)) {
          emptyCells.push({ x, y });
        }
      }
    }
    return emptyCells;
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
        hasReachedGoal: p.hasReachedGoal,
        hasKillerItem: p.hasKillerItem,
        hasExchangeItem: p.hasExchangeItem,
        ghostTurnsRemaining: p.ghostTurnsRemaining,
        isInPrison: p.isInPrison,
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
