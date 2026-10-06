import { Board } from './board.js';
import { Wall, type Coordinate } from './models.js';

export interface IMazeKey {
  id: string;
  x: number;
  y: number;
}

export interface IMazeExit {
  id: string;
  x: number;
  y: number;
  playerId: string;
}

export class MazeBoard extends Board {
  public keys: IMazeKey[] = [];
  public exits: IMazeExit[] = [];

  public generateRandomMazeWalls(
    targetWallCount: number = Math.floor(this.size * this.size * 0.35),
    random: () => number = Math.random,
    exitCount: number = this.players.size
  ): void {
    this.exits = this.createExits(exitCount);
    const protectedPassages = this.getProtectedPassages();
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

    const blockedPassages = new Set<number>();
    for (const wall of candidates) {
      if (this.walls.length >= targetWallCount) break;
      if (!this.canPlaceWall(wall)) continue;
      const passages = this.getWallPassages(wall);
      if (passages.some(passage =>
        protectedPassages.has(passage.key) ||
        this.isPassageInsideCentralRoom(passage)
      )) continue;

      this.walls.push(wall);
      passages.forEach(passage => blockedPassages.add(passage.key));
      if (!this.isBoardConnected(blockedPassages)) {
        this.walls.pop();
        passages.forEach(passage => blockedPassages.delete(passage.key));
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
      keys: this.keys.map(key => ({ ...key })),
      exits: this.exits.map(exit => ({ ...exit }))
    };
  }

  private getAvailableKeyCells(): Coordinate[] {
    const occupiedPositions = new Set(
      [...this.players.values()].map(player => `${player.x},${player.y}`)
    );
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const cells: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const inCentralRoom = x >= minX && x <= maxX && y >= minY && y <= maxY;
        if (!inCentralRoom && !occupiedPositions.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }

  private createExits(exitCount: number): IMazeExit[] {
    const players = [...this.players.values()];
    const count = Math.min(Math.max(0, exitCount), players.length, 6);
    if (!count) return [];

    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    const exitRows = [
      { x: middle, y: middle - radius },
      { x: middle + radius, y: middle - radius },
      { x: middle + radius, y: middle + radius },
      { x: middle, y: middle + radius },
      { x: middle - radius, y: middle + radius },
      { x: middle - radius, y: middle - radius }
    ];

    return Array.from({ length: count }, (_, index) => {
      const exitIndex = Math.floor(index * exitRows.length / count);
      return {
        id: `maze_exit_${index + 1}`,
        ...exitRows[exitIndex],
        playerId: players[index].id
      };
    });
  }

  private getProtectedPassages(): Set<number> {
    const protectedPassages = new Set<number>();
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    const routes = [
      this.createRoute({ x: middle, y: middle - radius }, { x: middle, y: 0 }),
      this.createRoute({ x: middle + radius, y: middle - radius }, { x: this.size - 1, y: middle - radius }),
      this.createRoute({ x: middle + radius, y: middle + radius }, { x: this.size - 1, y: middle + radius }),
      this.createRoute({ x: middle, y: middle + radius }, { x: middle, y: this.size - 1 }),
      this.createRoute({ x: middle - radius, y: middle + radius }, { x: 0, y: middle + radius }),
      this.createRoute({ x: middle - radius, y: middle - radius }, { x: 0, y: middle - radius })
    ];

    for (const exit of this.exits) {
      const routeIndex = Number(exit.id.slice('maze_exit_'.length)) - 1;
      const route = routes[Math.floor(routeIndex * routes.length / this.exits.length)];
      for (let index = 1; index < route.length; index++) {
        protectedPassages.add(this.getPassageKey(route[index - 1], route[index]));
      }
    }
    return protectedPassages;
  }

  private createRoute(start: Coordinate, end: Coordinate): Coordinate[] {
    const route: Coordinate[] = [{ ...start }];
    const current = { ...start };
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    while (current.x !== end.x || current.y !== end.y) {
      if (current.x !== end.x) current.x += dx;
      else current.y += dy;
      route.push({ ...current });
    }
    return route;
  }

  private getWallPassages(wall: Wall): { key: number; x1: number; y1: number; x2: number; y2: number }[] {
    if (wall.isHorizontal) {
      return [
        { x1: wall.x, y1: wall.y, x2: wall.x, y2: wall.y + 1 },
        { x1: wall.x + 1, y1: wall.y, x2: wall.x + 1, y2: wall.y + 1 }
      ].map(passage => ({
        ...passage,
        key: this.getPassageKey(
          { x: passage.x1, y: passage.y1 },
          { x: passage.x2, y: passage.y2 }
        )
      }));
    }
    return [
      { x1: wall.x, y1: wall.y, x2: wall.x + 1, y2: wall.y },
      { x1: wall.x, y1: wall.y + 1, x2: wall.x + 1, y2: wall.y + 1 }
    ].map(passage => ({
      ...passage,
      key: this.getPassageKey(
        { x: passage.x1, y: passage.y1 },
        { x: passage.x2, y: passage.y2 }
      )
    }));
  }

  private getPassageKey(
    start: Coordinate,
    end: Coordinate
  ): number {
    const startIndex = start.y * this.size + start.x;
    const endIndex = end.y * this.size + end.x;
    return Math.min(startIndex, endIndex) * this.size * this.size + Math.max(startIndex, endIndex);
  }

  private isPassageInsideCentralRoom(passage: { x1: number; y1: number; x2: number; y2: number }): boolean {
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    return passage.x1 >= minX && passage.x1 <= maxX &&
      passage.x2 >= minX && passage.x2 <= maxX &&
      passage.y1 >= minY && passage.y1 <= maxY &&
      passage.y2 >= minY && passage.y2 <= maxY;
  }

  private isBoardConnected(blockedPassages: Set<number>): boolean {
    const totalCells = this.size * this.size;
    const visited = new Uint8Array(totalCells);
    const queue = new Int32Array(totalCells);
    let readIndex = 0;
    let writeIndex = 0;
    queue[writeIndex++] = 0;
    visited[0] = 1;

    while (readIndex < writeIndex) {
      const currentIndex = queue[readIndex++];
      const x = currentIndex % this.size;
      const y = Math.floor(currentIndex / this.size);
      if (y > 0) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex - this.size, totalCells, blockedPassages, visited, queue, writeIndex);
      if (y < this.size - 1) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex + this.size, totalCells, blockedPassages, visited, queue, writeIndex);
      if (x > 0) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex - 1, totalCells, blockedPassages, visited, queue, writeIndex);
      if (x < this.size - 1) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex + 1, totalCells, blockedPassages, visited, queue, writeIndex);
    }
    return writeIndex === totalCells;
  }

  private enqueueMazeCell(
    currentIndex: number,
    nextIndex: number,
    totalCells: number,
    blockedPassages: Set<number>,
    visited: Uint8Array,
    queue: Int32Array,
    writeIndex: number
  ): number {
    if (visited[nextIndex]) return writeIndex;
    const passageKey = Math.min(currentIndex, nextIndex) * totalCells + Math.max(currentIndex, nextIndex);
    if (blockedPassages.has(passageKey)) return writeIndex;
    visited[nextIndex] = 1;
    queue[writeIndex++] = nextIndex;
    return writeIndex;
  }

  private getCentralRoomRadius(): number {
    return Math.min(5, Math.max(1, Math.floor((this.size - 1) / 2)));
  }

  private getCentralRoomBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    return {
      minX: Math.max(0, middle - radius),
      maxX: Math.min(this.size - 1, middle + radius),
      minY: Math.max(0, middle - radius),
      maxY: Math.min(this.size - 1, middle + radius)
    };
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
