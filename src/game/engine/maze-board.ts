import { Board } from './board.js';
import { Wall, type Coordinate } from './models.js';

export interface IMazeKey {
  id: string;
  x: number;
  y: number;
}

export class MazeBoard extends Board {
  public keys: IMazeKey[] = [];

  public generateRandomMazeWalls(targetWallCount: number = 24, random: () => number = Math.random): void {
    const candidates: Wall[] = [];
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        candidates.push(new Wall(`maze_h_${x}_${y}`, 'maze', x, y, true));
        candidates.push(new Wall(`maze_v_${x}_${y}`, 'maze', x, y, false));
      }
    }

    for (let index = candidates.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }

    for (const wall of candidates) {
      if (this.walls.length >= targetWallCount) break;
      if (!this.canPlaceWall(wall)) continue;
      this.walls.push(wall);
      if (![...this.players.values()].every(player => this.hasPathToAnyEdge(player.x, player.y))) {
        this.walls.pop();
      }
    }
  }

  public getMazeValidMoves(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    if (!player || player.isDead || player.isInPrison) return [];
    return [
      { x: player.x, y: player.y - 1 },
      { x: player.x, y: player.y + 1 },
      { x: player.x - 1, y: player.y },
      { x: player.x + 1, y: player.y }
    ].filter(next =>
      next.x >= 0 && next.x < this.size &&
      next.y >= 0 && next.y < this.size &&
      !this.grid[next.y][next.x].hasPlayer &&
      !this.isWallBlocking(player.x, player.y, next.x, next.y)
    );
  }

  public moveMazePlayer(playerId: string, newX: number, newY: number): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.getMazeValidMoves(playerId).some(move => move.x === newX && move.y === newY)) {
      return false;
    }
    this.grid[player.y][player.x].hasPlayer = null;
    player.x = newX;
    player.y = newY;
    this.grid[newY][newX].hasPlayer = playerId;
    return true;
  }

  public placeMazeWall(wall: Wall): boolean {
    if (!this.canPlaceWall(wall)) return false;
    this.walls.push(wall);
    return true;
  }

  public removeWallById(wallId: string): Wall | null {
    const wallIndex = this.walls.findIndex(wall => wall.id === wallId);
    if (wallIndex < 0) return null;
    return this.walls.splice(wallIndex, 1)[0];
  }

  public isMazePlayerEnclosed(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const exits = [
      { x: player.x, y: player.y - 1 },
      { x: player.x, y: player.y + 1 },
      { x: player.x - 1, y: player.y },
      { x: player.x + 1, y: player.y }
    ];
    return exits.every(next =>
      next.x < 0 || next.x >= this.size ||
      next.y < 0 || next.y >= this.size ||
      this.isWallBlocking(player.x, player.y, next.x, next.y)
    );
  }

  public getMazeCageWalls(playerId: string): Wall[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    const adjacent = [
      { x: player.x, y: player.y - 1 },
      { x: player.x, y: player.y + 1 },
      { x: player.x - 1, y: player.y },
      { x: player.x + 1, y: player.y }
    ].filter(next =>
      next.x >= 0 && next.x < this.size &&
      next.y >= 0 && next.y < this.size &&
      this.isWallBlocking(player.x, player.y, next.x, next.y)
    );

    const cageWalls = new Set<Wall>();
    for (const next of adjacent) {
      for (const wall of this.walls) {
        const wallIndex = this.walls.indexOf(wall);
        this.walls.splice(wallIndex, 1);
        const stillBlocked = this.isWallBlocking(player.x, player.y, next.x, next.y);
        this.walls.splice(wallIndex, 0, wall);
        if (!stillBlocked) cageWalls.add(wall);
      }
    }
    return [...cageWalls];
  }

  public spawnKeys(count: number, random: () => number = Math.random): void {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('Labyrinth must spawn at least one key.');
    }

    const candidates = this.getAvailableKeyCells();
    const capturable = this.shuffle(candidates.filter(({ x, y }) => this.isCellCapturable(x, y)), random);
    if (capturable.length === 0) {
      throw new Error('Labyrinth could not place a key in a capturable location.');
    }

    const selected = [capturable[0]];
    const remaining = this.shuffle(candidates.filter(cell =>
      cell.x !== selected[0].x || cell.y !== selected[0].y
    ), random);
    selected.push(...remaining.slice(0, Math.max(0, count - 1)));
    this.keys = selected.map((position, index) => ({
      id: `maze_key_${index + 1}`,
      ...position
    }));
  }

  public isCellCapturable(x: number, y: number): boolean {
    if (x <= 0 || y <= 0 || x >= this.size - 1 || y >= this.size - 1) return false;
    const sides = [
      {
        blocked: { x, y: y - 1 },
        candidates: [
          new Wall('maze_test_north_a', 'maze', x - 1, y - 1, true),
          new Wall('maze_test_north_b', 'maze', x, y - 1, true)
        ]
      },
      {
        blocked: { x, y: y + 1 },
        candidates: [
          new Wall('maze_test_south_a', 'maze', x - 1, y, true),
          new Wall('maze_test_south_b', 'maze', x, y, true)
        ]
      },
      {
        blocked: { x: x - 1, y },
        candidates: [
          new Wall('maze_test_west_a', 'maze', x - 1, y - 1, false),
          new Wall('maze_test_west_b', 'maze', x - 1, y, false)
        ]
      },
      {
        blocked: { x: x + 1, y },
        candidates: [
          new Wall('maze_test_east_a', 'maze', x, y - 1, false),
          new Wall('maze_test_east_b', 'maze', x, y, false)
        ]
      }
    ].filter(side => !this.isWallBlocking(x, y, side.blocked.x, side.blocked.y));

    const addWallsRecursively = (sideIndex: number): boolean => {
      if (sideIndex === sides.length) return true;
      for (const wall of sides[sideIndex].candidates) {
        if (!this.canPlaceWall(wall)) continue;
        this.walls.push(wall);
        const canCompleteCage = addWallsRecursively(sideIndex + 1);
        this.walls.pop();
        if (canCompleteCage) return true;
      }
      return false;
    };
    return addWallsRecursively(0);
  }

  public override toDTO(forPlayerId?: string) {
    return {
      ...super.toDTO(),
      validMoves: forPlayerId ? this.getMazeValidMoves(forPlayerId) : [],
      keys: this.keys.map(key => ({ ...key }))
    };
  }

  private getAvailableKeyCells(): Coordinate[] {
    const occupiedPositions = new Set(
      [...this.players.values()].map(player => `${player.x},${player.y}`)
    );
    const cells: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (!occupiedPositions.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }

  private shuffle<T>(items: T[], random: () => number): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }

  private hasPathToAnyEdge(startX: number, startY: number): boolean {
    const queue: Coordinate[] = [{ x: startX, y: startY }];
    const visited = new Set<string>([`${startX},${startY}`]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (
        current.x === 0 || current.y === 0 ||
        current.x === this.size - 1 || current.y === this.size - 1
      ) return true;

      for (const next of [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 }
      ]) {
        const key = `${next.x},${next.y}`;
        if (
          next.x >= 0 && next.x < this.size &&
          next.y >= 0 && next.y < this.size &&
          !visited.has(key) &&
          !this.isWallBlocking(current.x, current.y, next.x, next.y)
        ) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    return false;
  }
}
