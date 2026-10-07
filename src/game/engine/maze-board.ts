import { Board } from './board.js';
import { Wall, type Coordinate, type Player } from './models.js';

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
  isSealed?: boolean;
}

export interface IMazeTeleport {
  id: string;
  pairId: string;
  x: number;
  y: number;
}

export type MazeTrapType = 'ice' | 'teleport';

export interface IMazeTrap extends Coordinate {
  id: string;
  type: MazeTrapType;
}

export interface IMazeShieldPickup extends Coordinate {
  id: string;
}

export interface IMazeGhostPickup extends Coordinate {
  id: string;
}

export class MazeBoard extends Board {
  public keys: IMazeKey[] = [];
  public exits: IMazeExit[] = [];
  public teleports: IMazeTeleport[] = [];
  public traps: IMazeTrap[] = [];
  public shieldPickups: IMazeShieldPickup[] = [];
  public ghostPickups: IMazeGhostPickup[] = [];

  public get extraction(): Coordinate {
    const middle = Math.floor(this.size / 2);
    return { x: middle, y: middle };
  }

  public generateRandomMazeWalls(
    targetWallCount: number = Math.floor(this.size * this.size * 0.35),
    random: () => number = Math.random,
    _exitCount: number = this.players.size,
    prioritizeGateApproaches = false
  ): void {
    this.exits = this.createExits();
    if (this.shouldAddCentralEntranceWalls()) this.addCentralEntranceWalls();
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
    if (prioritizeGateApproaches) {
      const priority = new Map(candidates.map(wall => [
        wall,
        this.getGateApproachWallPriority(wall)
      ]));
      candidates.sort((first, second) =>
        (priority.get(first) ?? Number.POSITIVE_INFINITY) -
        (priority.get(second) ?? Number.POSITIVE_INFINITY)
      );
    }

    const blockedPassages = new Set<number>();
    for (const wall of this.walls) {
      for (const passage of this.getWallPassages(wall)) blockedPassages.add(passage.key);
    }
    for (const wall of candidates) {
      if (this.walls.length >= targetWallCount) break;
      if (!super.canPlaceWall(wall)) continue;
      const passages = this.getWallPassages(wall);
      if (passages.some(passage =>
        protectedPassages.has(passage.key) || this.isPassageInsideCentralRoom(passage)
      )) continue;

      this.walls.push(wall);
      passages.forEach(passage => blockedPassages.add(passage.key));
      const enclosesFreePlayer = [...this.players.values()].some(player =>
        !player.isInPrison && this.isMazePlayerEnclosed(player.id)
      );
      if (!this.isBoardConnected(blockedPassages) || enclosesFreePlayer) {
        this.walls.pop();
        passages.forEach(passage => blockedPassages.delete(passage.key));
      }
    }
  }

  public reshuffleMaze(random: () => number = Math.random, prioritizeGateApproaches = false): void {
    const previousTeleportPositions = this.teleports.map(({ x, y }) => ({ x, y }));
    const previousExitSealStates = new Map(this.exits.map(exit => [exit.id, exit.isSealed === true]));
    const capturedIds = [...this.players.values()]
      .filter(player => player.isInPrison)
      .map(player => player.id);
    const preservedCageWalls = new Set<Wall>();
    for (const playerId of capturedIds) {
      for (const wall of this.getMazeCageWalls(playerId)) preservedCageWalls.add(wall);
    }

    this.walls = [...preservedCageWalls];
    this.generateRandomMazeWalls(undefined, random, this.players.size, prioritizeGateApproaches);
    this.exits = this.exits.map(exit => ({
      ...exit,
      isSealed: previousExitSealStates.get(exit.id) ?? false
    }));
    this.teleports = [];
    this.relocateUncollectedKeys(random);
    this.spawnTeleports(random, previousTeleportPositions);
  }

  public spawnTeleports(
    random: () => number = Math.random,
    avoidPositions: Coordinate[] = [],
    pairCountOverride?: number
  ): void {
    const pairCount = pairCountOverride ?? 2 + Math.floor(random() * 3);
    const allCandidates = this.shuffle(this.getAvailableTeleportCells(), random);
    const previousPositionKeys = new Set(avoidPositions.map(({ x, y }) => `${x},${y}`));
    const newLocationCandidates = allCandidates.filter(candidate =>
      !previousPositionKeys.has(`${candidate.x},${candidate.y}`)
    );
    const candidates = newLocationCandidates.length >= pairCount * 2
      ? newLocationCandidates
      : allCandidates;
    const selected: Coordinate[] = [];
    for (const candidate of candidates) {
      if (selected.some(position =>
        Math.abs(position.x - candidate.x) + Math.abs(position.y - candidate.y) < 8
      )) continue;
      selected.push(candidate);
      if (selected.length === pairCount * 2) break;
    }
    if (selected.length < pairCount * 2) {
      for (const candidate of candidates) {
        if (selected.some(position => position.x === candidate.x && position.y === candidate.y)) continue;
        selected.push(candidate);
        if (selected.length === pairCount * 2) break;
      }
    }

    this.teleports = [];
    for (let pairIndex = 0; pairIndex * 2 + 1 < selected.length; pairIndex++) {
      const pairId = `maze_teleport_pair_${pairIndex + 1}`;
      this.teleports.push(
        { id: `${pairId}_a`, pairId, ...selected[pairIndex * 2] },
        { id: `${pairId}_b`, pairId, ...selected[pairIndex * 2 + 1] }
      );
    }
  }

  public relocateUncollectedKeys(random: () => number = Math.random): void {
    if (!this.keys.length) return;
    const available = this.shuffle(this.getAvailableKeyCells(), random);
    const occupiedKeys = new Set<string>();
    this.keys = this.keys.map(key => {
      const isAvailable = (candidate: Coordinate): boolean =>
        !occupiedKeys.has(`${candidate.x},${candidate.y}`) &&
        !this.teleports.some(teleport => teleport.x === candidate.x && teleport.y === candidate.y);
      const position = available.find(candidate =>
        isAvailable(candidate) && (candidate.x !== key.x || candidate.y !== key.y)
      ) ?? available.find(isAvailable);
      if (!position) throw new Error('Labyrinth could not relocate all uncollected keys.');
      occupiedKeys.add(`${position.x},${position.y}`);
      return { ...key, x: position.x, y: position.y };
    });
  }

  public teleportPlayer(playerId: string, teleportId: string): Coordinate | null {
    const player = this.players.get(playerId);
    const source = this.teleports.find(teleport => teleport.id === teleportId);
    if (!player || player.isDead || player.isInPrison || player.hasMazeEscaped ||
        player.mazeFrozenUntil > Date.now() || player.mazeTeleportingUntil > Date.now() || !source ||
        source.x !== player.x || source.y !== player.y) return null;
    const destination = this.teleports.find(teleport =>
      teleport.pairId === source.pairId && teleport.id !== source.id
    );
    if (!destination || this.grid[destination.y][destination.x].hasPlayer) return null;
    this.grid[player.y][player.x].hasPlayer = null;
    player.x = destination.x;
    player.y = destination.y;
    this.grid[player.y][player.x].hasPlayer = playerId;
    return { x: player.x, y: player.y };
  }

  public sealMazeExit(exitId: string): number | null {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit || exit.isSealed) return null;
    exit.isSealed = true;
    return this.exits.indexOf(exit) + 1;
  }

  public openMazeExit(exitId: string): number | null {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit?.isSealed) return null;
    exit.isSealed = false;
    return this.exits.indexOf(exit) + 1;
  }

  public canOpenMazeExitFrom(exitId: string, playerX: number, playerY: number): boolean {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit?.isSealed) return false;
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const isInsideRoom = playerX >= minX && playerX <= maxX && playerY >= minY && playerY <= maxY;
    return isInsideRoom && Math.abs(exit.x - playerX) + Math.abs(exit.y - playerY) === 1;
  }

  public getMazeValidMoves(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    const isGhost = !!player && player.ghostModeExpiresAt > Date.now();
    if (!player || player.isDead || player.hasMazeEscaped ||
        player.mazeFrozenUntil > Date.now() || player.mazeTeleportingUntil > Date.now() ||
        (player.isInPrison && !isGhost)) return [];
    const validMoves: Coordinate[] = [];
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];
    if (isGhost) {
      directions.push(
        { dx: -1, dy: -1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: 1, dy: 1 }
      );
    }

    for (const { dx, dy } of directions) {
      const adjacentX = player.x + dx;
      const adjacentY = player.y + dy;
      if (!this.isInsideBoard(adjacentX, adjacentY) ||
          this.isSealedCentralGateBlocking(player.x, player.y, adjacentX, adjacentY) ||
          (!isGhost && this.isWallBlocking(player.x, player.y, adjacentX, adjacentY))) continue;

      if (!this.grid[adjacentY][adjacentX].hasPlayer) {
        validMoves.push({ x: adjacentX, y: adjacentY });
        continue;
      }

      const jumpX = adjacentX + dx;
      const jumpY = adjacentY + dy;
      if (dx !== 0 && dy !== 0) {
        if (this.isInsideBoard(jumpX, jumpY) &&
            !this.isSealedCentralGateBlocking(adjacentX, adjacentY, jumpX, jumpY) &&
            !this.grid[jumpY][jumpX].hasPlayer) {
          validMoves.push({ x: jumpX, y: jumpY });
        }
        continue;
      }
      if (this.isInsideBoard(jumpX, jumpY) &&
          !this.isSealedCentralGateBlocking(adjacentX, adjacentY, jumpX, jumpY) &&
          (isGhost || !this.isWallBlocking(adjacentX, adjacentY, jumpX, jumpY)) &&
          !this.grid[jumpY][jumpX].hasPlayer) {
        validMoves.push({ x: jumpX, y: jumpY });
        continue;
      }

      const sideDirections = dx !== 0
        ? [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }]
        : [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
      for (const sideDirection of sideDirections) {
        const sideX = adjacentX + sideDirection.dx;
        const sideY = adjacentY + sideDirection.dy;
        if (this.isInsideBoard(sideX, sideY) &&
            !this.isSealedCentralGateBlocking(adjacentX, adjacentY, sideX, sideY) &&
            (isGhost || !this.isWallBlocking(adjacentX, adjacentY, sideX, sideY)) &&
            !this.grid[sideY][sideX].hasPlayer) {
          validMoves.push({ x: sideX, y: sideY });
        }
      }
    }

    return validMoves;
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

  public ejectPlayerFromSafeZone(playerId: string, random: () => number = Math.random): Coordinate | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    const adjacentCells: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const isAdjacentToSafeZone = [
          { x: x - 1, y },
          { x: x + 1, y },
          { x, y: y - 1 },
          { x, y: y + 1 }
        ].some(cell =>
          this.isSafeZoneCell(cell.x, cell.y) &&
          !this.isWallBlocking(cell.x, cell.y, x, y)
        );
        if (isAdjacentToSafeZone && !this.isSafeZoneCell(x, y) && !this.grid[y][x].hasPlayer) {
          adjacentCells.push({ x, y });
        }
      }
    }
    const candidates = adjacentCells.filter(({ x, y }) =>
      !this.keys.some(key => key.x === x && key.y === y) &&
      !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
      !this.traps.some(trap => trap.x === x && trap.y === y) &&
      !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
      !this.ghostPickups.some(pickup => pickup.x === x && pickup.y === y)
    );
    if (!candidates.length) {
      candidates.push(...adjacentCells.filter(({ x, y }) =>
        !this.traps.some(trap => trap.x === x && trap.y === y)
      ));
    }
    if (!candidates.length) candidates.push(...adjacentCells);
    this.shuffle(candidates, random);
    const destination = candidates[0];
    if (!destination) return null;
    this.grid[player.y][player.x].hasPlayer = null;
    player.x = destination.x;
    player.y = destination.y;
    this.grid[player.y][player.x].hasPlayer = playerId;
    return destination;
  }

  public isSafeZoneCell(x: number, y: number): boolean {
    const { minX, maxX, minY, maxY } = this.getProtectedCentralZoneBounds();
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  protected shouldAddCentralEntranceWalls(): boolean {
    return true;
  }

  public canPlaceTrap(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) &&
      this.isInsideBoard(x, y) &&
      !this.isSafeZoneCell(x, y) &&
      !this.grid[y][x].hasPlayer &&
      !this.keys.some(key => key.x === x && key.y === y) &&
      !this.exits.some(exit => exit.x === x && exit.y === y) &&
      !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
      !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
      !this.traps.some(trap => trap.x === x && trap.y === y);
  }

  public placeTrap(trap: IMazeTrap): boolean {
    if (!this.canPlaceTrap(trap.x, trap.y)) return false;
    this.traps.push({ ...trap });
    return true;
  }

  public removeTrapAt(x: number, y: number): IMazeTrap | null {
    const index = this.traps.findIndex(trap => trap.x === x && trap.y === y);
    return index < 0 ? null : this.traps.splice(index, 1)[0];
  }

  public spawnShieldPickups(targetCount: number, random: () => number = Math.random): void {
    const candidates: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (!this.isSafeZoneCell(x, y) &&
            !this.grid[y][x].hasPlayer &&
            !this.keys.some(key => key.x === x && key.y === y) &&
            !this.exits.some(exit => exit.x === x && exit.y === y) &&
            !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
            !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
            !this.traps.some(trap => trap.x === x && trap.y === y)) {
          candidates.push({ x, y });
        }
      }
    }
    this.shuffle(candidates, random);
    while (this.shieldPickups.length < targetCount && candidates.length > 0) {
      const position = candidates.pop()!;
      this.shieldPickups.push({
        id: `maze_shield_${Date.now()}_${this.shieldPickups.length}`,
        ...position
      });
    }
  }

  public collectShieldPickupAt(x: number, y: number): IMazeShieldPickup | null {
    const index = this.shieldPickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    return index < 0 ? null : this.shieldPickups.splice(index, 1)[0];
  }

  public spawnGhostPickups(targetCount: number, random: () => number = Math.random): void {
    const candidates: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (!this.isSafeZoneCell(x, y) &&
            !this.grid[y][x].hasPlayer &&
            !this.keys.some(key => key.x === x && key.y === y) &&
            !this.exits.some(exit => exit.x === x && exit.y === y) &&
            !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
            !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
            !this.ghostPickups.some(pickup => pickup.x === x && pickup.y === y) &&
            !this.traps.some(trap => trap.x === x && trap.y === y)) {
          candidates.push({ x, y });
        }
      }
    }
    this.shuffle(candidates, random);
    while (this.ghostPickups.length < targetCount && candidates.length > 0) {
      const position = candidates.pop()!;
      this.ghostPickups.push({
        id: `maze_ghost_${Date.now()}_${this.ghostPickups.length}`,
        ...position
      });
    }
  }

  public collectGhostPickupAt(x: number, y: number): IMazeGhostPickup | null {
    const index = this.ghostPickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    return index < 0 ? null : this.ghostPickups.splice(index, 1)[0];
  }

  public teleportPlayerToRandomBorder(playerId: string, random: () => number = Math.random): Coordinate | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    const candidates: Coordinate[] = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if ((x === 0 || y === 0 || x === this.size - 1 || y === this.size - 1) &&
            !this.grid[y][x].hasPlayer &&
            !this.traps.some(trap => trap.x === x && trap.y === y)) candidates.push({ x, y });
      }
    }
    this.shuffle(candidates, random);
    const destination = candidates[0];
    if (!destination) return null;
    this.grid[player.y][player.x].hasPlayer = null;
    player.x = destination.x;
    player.y = destination.y;
    this.grid[player.y][player.x].hasPlayer = playerId;
    return { ...destination };
  }

  public placeMazeWall(wall: Wall): boolean {
    if (!this.canPlaceWall(wall)) return false;
    this.walls.push(wall);
    return true;
  }

  public override canPlaceWall(wall: Wall): boolean {
    if (!super.canPlaceWall(wall)) return false;
    return !this.getWallPassages(wall).some(passage =>
      this.isPassageInsideProtectedCentralZone(passage)
    );
  }

  public wouldEnclosePlayerWithWall(wall: Wall, playerId: string): boolean {
    if (!this.canPlaceWall(wall)) return false;
    this.walls.push(wall);
    try {
      return this.isMazePlayerEnclosed(playerId);
    } finally {
      this.walls.pop();
    }
  }

  public wouldSeparatePlayersWithWall(wall: Wall, playerIds: string[]): boolean {
    if (!this.canPlaceWall(wall)) return false;
    const connectedPairs: Array<[Player, Player]> = [];
    const players = playerIds
      .map(playerId => this.players.get(playerId))
      .filter((player): player is Player => !!player);
    for (let first = 0; first < players.length; first++) {
      for (let second = first + 1; second < players.length; second++) {
        const playerA = players[first];
        const playerB = players[second];
        if (this.isMazeCellReachable(playerA.x, playerA.y, playerB.x, playerB.y)) {
          connectedPairs.push([playerA, playerB]);
        }
      }
    }

    this.walls.push(wall);
    try {
      return connectedPairs.some(([playerA, playerB]) =>
        !this.isMazeCellReachable(playerA.x, playerA.y, playerB.x, playerB.y)
      );
    } finally {
      this.walls.pop();
    }
  }

  public wouldMakeUncollectedKeyUnreachable(wall: Wall): boolean {
    if (!this.canPlaceWall(wall)) return false;
    const keysReachableBefore = this.keys.map(key => {
      const candidates = [...this.players.values()].filter(player =>
        !player.id.startsWith('bot_') && !player.isDead && !player.hasMazeKey
      );
      return {
        key,
        wasReachable: candidates.some(player =>
          this.isMazeCellReachable(player.x, player.y, key.x, key.y)
        )
      };
    });

    this.walls.push(wall);
    try {
      return keysReachableBefore.some(({ key, wasReachable }) => {
        if (!wasReachable) return false;
        const candidates = [...this.players.values()].filter(player =>
          !player.id.startsWith('bot_') && !player.isDead && !player.hasMazeKey
        );
        return !candidates.some(player =>
          this.isMazeCellReachable(player.x, player.y, key.x, key.y)
        );
      });
    } finally {
      this.walls.pop();
    }
  }

  public isMazeCellReachable(startX: number, startY: number, targetX: number, targetY: number): boolean {
    if (!this.isInsideBoard(startX, startY) || !this.isInsideBoard(targetX, targetY)) return false;
    const queue: Coordinate[] = [{ x: startX, y: startY }];
    const visited = new Set([`${startX},${startY}`]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current.x === targetX && current.y === targetY) return true;
      for (const next of [
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y }
      ]) {
        const key = `${next.x},${next.y}`;
        if (!this.isInsideBoard(next.x, next.y) || visited.has(key) ||
            this.isWallBlocking(current.x, current.y, next.x, next.y) ||
            this.isSealedCentralGateBlocking(current.x, current.y, next.x, next.y)) continue;
        visited.add(key);
        queue.push(next);
      }
    }
    return false;
  }

  public removeWallById(wallId: string): Wall | null {
    const wallIndex = this.walls.findIndex(wall => wall.id === wallId);
    if (wallIndex < 0) return null;
    return this.walls.splice(wallIndex, 1)[0];
  }

  public isPlayerPlacedMazeWall(wall: Wall): boolean {
    return wall.ownerId !== 'maze';
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
      this.isWallBlocking(player.x, player.y, next.x, next.y) ||
      this.isSealedCentralGateBlocking(player.x, player.y, next.x, next.y)
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

  public getMazeReleaseWalls(playerId: string): Wall[] {
    return this.getMazeCageWalls(playerId).filter(wall => {
      if (!this.isPlayerPlacedMazeWall(wall)) return false;
      const wallIndex = this.walls.indexOf(wall);
      if (wallIndex < 0) return false;
      const [removed] = this.walls.splice(wallIndex, 1);
      const releasesPlayer = !this.isMazePlayerEnclosed(playerId);
      this.walls.splice(wallIndex, 0, removed);
      return releasesPlayer;
    });
  }

  public isPlayerAdjacentToWall(playerId: string, wall: Wall): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    return this.getWallPassages(wall).some(passage =>
      (player.x === passage.x1 && player.y === passage.y1) ||
      (player.x === passage.x2 && player.y === passage.y2)
    );
  }

  public isSeparatedByWall(x1: number, y1: number, x2: number, y2: number): boolean {
    return this.isWallBlocking(x1, y1, x2, y2);
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

  public collectKey(playerId: string, x: number, y: number): IMazeKey | null {
    const player = this.players.get(playerId);
    if (!player || player.hasMazeKey || player.hasMazeEscaped) return null;
    const keyIndex = this.keys.findIndex(key =>
      key.x === x && key.y === y
    );
    if (keyIndex < 0) return null;
    const [key] = this.keys.splice(keyIndex, 1);
    return key;
  }

  public deliverMazeKey(playerId: string): boolean {
    const player = this.players.get(playerId);
    const extraction = this.extraction;
    if (!player || !player.hasMazeKey || player.hasMazeEscaped ||
        player.x !== extraction.x || player.y !== extraction.y) return false;
    player.hasMazeKeyDelivered = true;
    player.hasMazeKey = false;
    return true;
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
    const board = super.toDTO(forPlayerId);
    const players = { ...board.players };
    for (const [playerId, player] of this.players) {
      players[playerId] = {
        ...players[playerId],
        hasMazeKey: player.hasMazeKey,
        hasMazeKeyDelivered: player.hasMazeKeyDelivered,
        hasMazeEscaped: player.hasMazeEscaped,
        ghostModeExpiresAt: player.ghostModeExpiresAt,
        mazeFrozenUntil: player.mazeFrozenUntil,
        mazeTeleportingUntil: player.mazeTeleportingUntil,
        mazeShieldActive: player.mazeShieldActive,
        mazeShieldExpiresAt: player.mazeShieldExpiresAt
      };
    }
    return {
      ...board,
      players,
      walls: this.walls.map(wall => ({
        id: wall.id,
        ownerId: 'maze',
        isPlayerPlaced: wall.ownerId !== 'maze',
        x: wall.x,
        y: wall.y,
        isHorizontal: wall.isHorizontal,
        isPrisonBlock: wall.isPrisonBlock,
        isSabotageWall: wall.isSabotageWall,
        isRescueWall: wall.isRescueWall
      })),
      validMoves: forPlayerId ? this.getMazeValidMoves(forPlayerId) : [],
      extraction: this.extraction,
      keys: this.keys.map(key => ({ ...key })),
      shieldPickups: this.shieldPickups.map(pickup => ({ ...pickup })),
      exits: this.exits.map(exit => ({ ...exit })),
      teleports: this.teleports.map(teleport => ({ ...teleport }))
    };
  }

  private getAvailableKeyCells(): Coordinate[] {
    const occupiedPositions = new Set(
      [...this.players.values()].map(player => `${player.x},${player.y}`)
    );
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const middle = Math.floor(this.size / 2);
    const minDistanceFromCenter = Math.ceil((this.size / 2 - 1) / 2);
    const cells: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const inCentralRoom = x >= minX && x <= maxX && y >= minY && y <= maxY;
        const distanceFromCenter = Math.max(Math.abs(x - middle), Math.abs(y - middle));
        if (!inCentralRoom && distanceFromCenter >= minDistanceFromCenter &&
            !occupiedPositions.has(`${x},${y}`) &&
            !this.exits.some(exit => exit.x === x && exit.y === y) &&
            !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
            !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
            !this.traps.some(trap => trap.x === x && trap.y === y)) cells.push({ x, y });
      }

    }
    return cells;
  }

  private getAvailableTeleportCells(): Coordinate[] {
    const occupiedPositions = new Set(
      [...this.players.values()].map(player => `${player.x},${player.y}`)
    );
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const middle = Math.floor(this.size / 2);
    const minDistanceFromCenter = this.getCentralRoomRadius() + 1;
    const maxDistanceFromCenter = Math.max(
      minDistanceFromCenter,
      Math.floor((this.size / 2 - 1) * 0.65)
    );
    const cells: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const inCentralRoom = x >= minX && x <= maxX && y >= minY && y <= maxY;
        const distanceFromCenter = Math.max(Math.abs(x - middle), Math.abs(y - middle));
        if (distanceFromCenter < minDistanceFromCenter ||
            distanceFromCenter > maxDistanceFromCenter ||
            inCentralRoom || occupiedPositions.has(`${x},${y}`) ||
            this.keys.some(key => key.x === x && key.y === y) ||
            this.exits.some(exit => exit.x === x && exit.y === y) ||
            this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) ||
            this.traps.some(trap => trap.x === x && trap.y === y) ||
            this.teleports.some(teleport => teleport.x === x && teleport.y === y)) continue;
        cells.push({ x, y });
      }
    }
    return cells;
  }

  private createExits(): IMazeExit[] {
    const players = [...this.players.values()].filter(player => !player.id.startsWith('bot_'));
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    const exitRows = [
      { x: middle, y: middle - radius },
      { x: middle + radius, y: middle },
      { x: middle, y: middle + radius },
      { x: middle - radius, y: middle }
    ];

    return exitRows.map((position, index) => ({
        id: `maze_exit_${index + 1}`,
        ...position,
        playerId: players[index % players.length]?.id ?? ''
      }));
  }

  private addCentralEntranceWalls(): void {
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    const min = middle - radius;
    const max = middle + radius;
    const gateSegmentStart = middle - 1;
    let northSouthIndex = 0;
    let eastWestIndex = 0;
    for (let offset = 0; offset <= max - min; offset += 2) {
      if (min + offset === gateSegmentStart) continue;
      const x = min + offset;
      this.walls.push(
        new Wall(`maze_center_n_${northSouthIndex}`, 'maze', x, min - 1, true),
        new Wall(`maze_center_s_${northSouthIndex}`, 'maze', x, max, true)
      );
      northSouthIndex++;
      this.walls.push(
        new Wall(`maze_center_w_${eastWestIndex}`, 'maze', min - 1, x, false),
        new Wall(`maze_center_e_${eastWestIndex}`, 'maze', max, x, false)
      );
      eastWestIndex++;
    }
  }

  private getProtectedPassages(): Set<number> {
    const protectedPassages = new Set<number>();
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    const min = middle - radius;
    const max = middle + radius;
    const gateStart = middle - 1;
    const addGatePassages = (x1: number, y1: number, x2: number, y2: number): void => {
      protectedPassages.add(this.getPassageKey({ x: x1, y: y1 }, { x: x2, y: y2 }));
    };
    for (let offset = 0; offset < 2; offset++) {
      addGatePassages(gateStart + offset, min - 1, gateStart + offset, min);
      addGatePassages(gateStart + offset, max, gateStart + offset, max + 1);
      addGatePassages(min - 1, gateStart + offset, min, gateStart + offset);
      addGatePassages(max, gateStart + offset, max + 1, gateStart + offset);
    }

    const routes = [
      this.createRoute({ x: middle, y: middle - radius }, { x: middle, y: 0 }),
      this.createRoute({ x: middle + radius, y: middle }, { x: this.size - 1, y: middle }),
      this.createRoute({ x: middle, y: middle + radius }, { x: middle, y: this.size - 1 }),
      this.createRoute({ x: middle - radius, y: middle }, { x: 0, y: middle })
    ];

    for (const route of routes) {
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

  private isPassageInsideProtectedCentralZone(
    passage: { x1: number; y1: number; x2: number; y2: number }
  ): boolean {
    const { minX, maxX, minY, maxY } = this.getProtectedCentralZoneBounds();
    const isInsideZone = (x: number, y: number): boolean =>
      x >= minX && x <= maxX && y >= minY && y <= maxY;
    return isInsideZone(passage.x1, passage.y1) && isInsideZone(passage.x2, passage.y2);
  }

  private isPassageInsideCentralRoom(
    passage: { x1: number; y1: number; x2: number; y2: number }
  ): boolean {
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const isInsideRoom = (x: number, y: number): boolean =>
      x >= minX && x <= maxX && y >= minY && y <= maxY;
    return isInsideRoom(passage.x1, passage.y1) && isInsideRoom(passage.x2, passage.y2);
  }

  private isBoardConnected(blockedPassages: Set<number>): boolean {
    const totalCells = this.size * this.size;
    const excludedCells = new Uint8Array(totalCells);
    for (const player of this.players.values()) {
      if (player.isInPrison) excludedCells[player.y * this.size + player.x] = 1;
    }
    const visited = new Uint8Array(totalCells);
    const queue = new Int32Array(totalCells);
    let readIndex = 0;
    let writeIndex = 0;
    let startingCell = 0;
    while (startingCell < totalCells && excludedCells[startingCell]) startingCell++;
    if (startingCell === totalCells) return true;
    queue[writeIndex++] = startingCell;
    visited[startingCell] = 1;

    while (readIndex < writeIndex) {
      const currentIndex = queue[readIndex++];
      const x = currentIndex % this.size;
      const y = Math.floor(currentIndex / this.size);
      if (y > 0) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex - this.size, totalCells, blockedPassages, excludedCells, visited, queue, writeIndex);
      if (y < this.size - 1) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex + this.size, totalCells, blockedPassages, excludedCells, visited, queue, writeIndex);
      if (x > 0) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex - 1, totalCells, blockedPassages, excludedCells, visited, queue, writeIndex);
      if (x < this.size - 1) writeIndex = this.enqueueMazeCell(currentIndex, currentIndex + 1, totalCells, blockedPassages, excludedCells, visited, queue, writeIndex);
    }
    for (let index = 0; index < totalCells; index++) {
      if (!excludedCells[index] && !visited[index]) return false;
    }
    return true;
  }

  private enqueueMazeCell(
    currentIndex: number,
    nextIndex: number,
    totalCells: number,
    blockedPassages: Set<number>,
    excludedCells: Uint8Array,
    visited: Uint8Array,
    queue: Int32Array,
    writeIndex: number
  ): number {
    if (visited[nextIndex] || excludedCells[nextIndex]) return writeIndex;
    const passageKey = Math.min(currentIndex, nextIndex) * totalCells + Math.max(currentIndex, nextIndex);
    if (blockedPassages.has(passageKey)) return writeIndex;
    visited[nextIndex] = 1;
    queue[writeIndex++] = nextIndex;
    return writeIndex;
  }

  private getCentralRoomRadius(): number {
    return Math.min(3, Math.max(1, Math.floor((this.size - 1) / 2)));
  }

  private getGateApproachWallPriority(wall: Wall): number {
    const activePlayers = [...this.players.values()].filter(player =>
      !player.isInPrison && !player.hasMazeEscaped && !player.isDead
    );
    const passages = this.getWallPassages(wall);
    let priority = Number.POSITIVE_INFINITY;
    for (const exit of this.exits) {
      const nearbyPlayers = activePlayers.filter(player =>
        Math.abs(player.x - exit.x) + Math.abs(player.y - exit.y) <= 4
      );
      if (nearbyPlayers.length === 0) continue;
      const gateDistance = Math.min(...passages.map(passage =>
        Math.abs(passage.x1 - exit.x) + Math.abs(passage.y1 - exit.y)
      ));
      if (gateDistance > 2) continue;
      const nearestPlayerDistance = Math.min(...nearbyPlayers.map(player =>
        Math.min(...passages.map(passage =>
          Math.abs(passage.x1 - player.x) + Math.abs(passage.y1 - player.y)
        ))
      ));
      if (nearestPlayerDistance < 2) continue;
      priority = Math.min(priority, gateDistance * 10 + Math.min(4, nearestPlayerDistance));
    }
    return priority;
  }

  private isSealedCentralGateBlocking(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (fromX !== toX && fromY !== toY) {
      return this.isSealedCentralGateBlocking(fromX, fromY, toX, fromY) ||
        this.isSealedCentralGateBlocking(fromX, fromY, fromX, toY) ||
        this.isSealedCentralGateBlocking(toX, fromY, toX, toY) ||
        this.isSealedCentralGateBlocking(fromX, toY, toX, toY);
    }
    const middle = Math.floor(this.size / 2);
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const gateStart = middle - 1;
    const gateEnd = middle;
    const crossesGate = (exit: IMazeExit): boolean => {
      if (!exit.isSealed) return false;
      if (exit.x === middle && exit.y === minY) {
        return fromY !== toY && Math.min(fromY, toY) === minY - 1 &&
          (fromX === toX) && fromX >= gateStart && fromX <= gateEnd;
      }
      if (exit.x === maxX && exit.y === middle) {
        return fromX !== toX && Math.min(fromX, toX) === maxX &&
          fromY === toY && fromY >= gateStart && fromY <= gateEnd;
      }
      if (exit.x === middle && exit.y === maxY) {
        return fromY !== toY && Math.min(fromY, toY) === maxY &&
          fromX === toX && fromX >= gateStart && fromX <= gateEnd;
      }
      if (exit.x === minX && exit.y === middle) {
        return fromX !== toX && Math.min(fromX, toX) === minX - 1 &&
          fromY === toY && fromY >= gateStart && fromY <= gateEnd;
      }
      return false;
    };
    return this.exits.some(crossesGate);
  }

  private isInsideBoard(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  protected getCentralRoomBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const middle = Math.floor(this.size / 2);
    const radius = this.getCentralRoomRadius();
    return {
      minX: Math.max(0, middle - radius),
      maxX: Math.min(this.size - 1, middle + radius),
      minY: Math.max(0, middle - radius),
      maxY: Math.min(this.size - 1, middle + radius)
    };
  }

  protected getProtectedCentralZoneBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const margin = 2;
    return {
      minX: Math.max(0, minX - margin),
      maxX: Math.min(this.size - 1, maxX + margin),
      minY: Math.max(0, minY - margin),
      maxY: Math.min(this.size - 1, maxY + margin)
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
