import { Board } from './board.js';
import { Wall, type Coordinate, type ImpostorToolType, type Player } from './models.js';

export interface IImpostorKey {
  id: string;
  ownerId?: string;
  x: number;
  y: number;
}

export type ImpostorGeneratorSector = 'northwest' | 'northeast' | 'southwest' | 'southeast';

export interface IImpostorGenerator extends Coordinate {
  id: string;
  sector: ImpostorGeneratorSector;
  isDamaged: boolean;
}

export interface IImpostorTool extends Coordinate {
  id: string;
  type: ImpostorToolType;
  slot: number;
  carriedBy?: string;
}

export interface IImpostorExit {
  id: string;
  x: number;
  y: number;
  playerId: string;
  isSealed?: boolean;
}

export interface IImpostorTeleport {
  id: string;
  pairId: string;
  x: number;
  y: number;
}

export type ImpostorTrapType = 'ice' | 'teleport';

export interface IImpostorTrap extends Coordinate {
  id: string;
  type: ImpostorTrapType;
  isRevealed?: boolean;
}

export interface IImpostorShieldPickup extends Coordinate {
  id: string;
}

export interface IImpostorGhostPickup extends Coordinate {
  id: string;
}

export interface IImpostorFootprint extends Coordinate {
  id: string;
  createdAt: number;
}

export abstract class ImpostorBoardBase extends Board {
  public keys: IImpostorKey[] = [];
  public generators: IImpostorGenerator[] = [];
  public tools: IImpostorTool[] = [];
  public exits: IImpostorExit[] = [];
  public teleports: IImpostorTeleport[] = [];
  public traps: IImpostorTrap[] = [];
  public shieldPickups: IImpostorShieldPickup[] = [];
  public ghostPickups: IImpostorGhostPickup[] = [];
  public footprints: IImpostorFootprint[] = [];

  public generateRandomImpostorWalls(
    targetWallCount: number = Math.floor(this.size * this.size * 0.315),
    random: () => number = Math.random,
    _exitCount: number = this.players.size,
    prioritizeGateApproaches = false
  ): void {
    this.exits = this.createExits();
    if (this.generators.length > 0) {
      this.walls = this.walls.filter(wall => !this.wallPassagesTouchGenerator(wall));
    }
    if (this.shouldAddCentralEntranceWalls()) this.addCentralEntranceWalls();
    if (this.generators.length > 0) this.addGeneratorEnclosureWalls();
    const protectedPassages = this.getProtectedPassages();
    const candidates: Wall[] = [];
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        candidates.push(new Wall(`impostor_h_${x}_${y}`, 'board', x, y, true));
        candidates.push(new Wall(`impostor_v_${x}_${y}`, 'board', x, y, false));
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

    const processedCandidates = new Set<Wall>();
    const tryAddWall = (wall: Wall): boolean => {
      if (this.walls.length >= targetWallCount) return false;
      if (!super.canPlaceWall(wall) || this.wallPassagesTouchGenerator(wall)) return false;
      if (this.wouldCreateExcessiveCollinearChain(wall)) return false;
      const passages = this.getWallPassages(wall);
      if (passages.some(passage =>
        protectedPassages.has(passage.key) || this.isPassageInsideCentralRoom(passage)
      )) return false;

      this.walls.push(wall);
      const enclosesFreePlayer = [...this.players.values()].some(player =>
        !player.isInPrison && this.isImpostorPlayerEnclosed(player.id)
      );
      if (enclosesFreePlayer || !this.areGeneratorRepairApproachesOpen() ||
          !this.isGeneratedImpostorLayoutPlayable()) {
        this.walls.pop();
        return false;
      }
      return true;
    };

    if (this.generators.length > 0) {
      for (let regionY = 0; regionY < this.size - 1; regionY += 4) {
        for (let regionX = 0; regionX < this.size - 1; regionX += 4) {
          const existingWallCount = this.walls.filter(wall =>
            wall.x >= regionX && wall.x < regionX + 4 &&
            wall.y >= regionY && wall.y < regionY + 4
          ).length;
          let regionWallCount = existingWallCount;
          for (const wall of candidates) {
            if (regionWallCount >= 3 || wall.x < regionX || wall.x >= regionX + 4 ||
                wall.y < regionY || wall.y >= regionY + 4) continue;
            processedCandidates.add(wall);
            if (tryAddWall(wall)) regionWallCount++;
          }
        }
      }
    }

    for (const wall of candidates) {
      if (this.walls.length >= targetWallCount) break;
      if (processedCandidates.has(wall)) continue;
      tryAddWall(wall);
    }

  }

  public reshuffleImpostor(
    random: () => number = Math.random,
    prioritizeGateApproaches = false,
    removePlayerPlacedWalls = false
  ): void {
    const previousTeleportPositions = this.teleports.map(({ x, y }) => ({ x, y }));
    const previousExitSealStates = new Map(this.exits.map(exit => [exit.id, exit.isSealed === true]));
    const capturedIds = removePlayerPlacedWalls ? [] : [...this.players.values()]
      .filter(player => player.isInPrison)
      .map(player => player.id);
    if (removePlayerPlacedWalls) {
      for (const player of this.players.values()) player.isInPrison = false;
    }
    const preservedCageWalls = new Set<Wall>();
    for (const playerId of capturedIds) {
      for (const wall of this.getImpostorCageWalls(playerId)) preservedCageWalls.add(wall);
    }

    this.walls = removePlayerPlacedWalls ? [] : [...preservedCageWalls];
    this.generateRandomImpostorWalls(undefined, random, this.players.size, prioritizeGateApproaches);
    this.exits = this.exits.map(exit => ({
      ...exit,
      isSealed: previousExitSealStates.get(exit.id) ?? false
    }));
    this.teleports = [];
    if (previousTeleportPositions.length > 0) {
      this.spawnTeleports(random, previousTeleportPositions);
    }
  }

  public spawnGenerators(): void {
    const last = this.size - 3;
    this.generators = [
      { id: 'generator_northwest', sector: 'northwest', x: 0, y: 0, isDamaged: false },
      { id: 'generator_northeast', sector: 'northeast', x: last, y: 0, isDamaged: false },
      { id: 'generator_southwest', sector: 'southwest', x: 0, y: last, isDamaged: false },
      { id: 'generator_southeast', sector: 'southeast', x: last, y: last, isDamaged: false }
    ];
  }

  public isGeneratorCell(x: number, y: number): boolean {
    return this.generators.some(generator =>
      x >= generator.x && x <= generator.x + 2 &&
      y >= generator.y && y <= generator.y + 2
    );
  }

  public spawnTools(): void {
    const middle = Math.floor(this.size / 2);
    this.tools = [
      { id: 'radar_1', type: 'radar', slot: 1, x: middle - 1, y: middle - 1 },
      { id: 'magnifier_1', type: 'magnifier', slot: 1, x: middle + 1, y: middle - 1 },
      { id: 'magnifier_2', type: 'magnifier', slot: 2, x: middle, y: middle - 1 },
      { id: 'hammer_1', type: 'hammer', slot: 1, x: middle - 1, y: middle + 1 },
      { id: 'hammer_2', type: 'hammer', slot: 2, x: middle, y: middle + 1 },
      { id: 'wrench_1', type: 'wrench', slot: 1, x: middle + 1, y: middle + 1 },
      { id: 'wrench_2', type: 'wrench', slot: 2, x: middle + 1, y: middle }
    ];
  }

  public isToolTableCell(x: number, y: number): boolean {
    if (this.tools.length === 0) return false;
    const middle = Math.floor(this.size / 2);
    return (x === middle || x === middle + 1) && (y === middle || y === middle + 1);
  }

  public isAdjacentToToolTable(x: number, y: number): boolean {
    return this.isSafeZoneCell(x, y) && !this.isToolTableCell(x, y);
  }

  public getGeneratorSector(x: number, y: number): ImpostorGeneratorSector {
    const north = y < Math.floor(this.size / 2);
    const west = x < Math.floor(this.size / 2);
    return `${north ? 'north' : 'south'}${west ? 'west' : 'east'}` as ImpostorGeneratorSector;
  }

  public getGeneratorAt(x: number, y: number): IImpostorGenerator | null {
    return this.generators.find(generator => generator.sector === this.getGeneratorSector(x, y)) ?? null;
  }

  public isCellPowered(x: number, y: number): boolean {
    return this.getGeneratorAt(x, y)?.isDamaged !== true;
  }

  public damageGenerator(generatorId: string): IImpostorGenerator | null {
    const generator = this.generators.find(item => item.id === generatorId);
    if (!generator || generator.isDamaged) return null;
    generator.isDamaged = true;
    return generator;
  }

  public repairGenerator(generatorId: string): IImpostorGenerator | null {
    const generator = this.generators.find(item => item.id === generatorId);
    if (!generator || !generator.isDamaged) return null;
    generator.isDamaged = false;
    return generator;
  }

  public takeTool(playerId: string, toolIdOrType: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    let tool = this.tools.find(item => item.id === toolIdOrType && !item.carriedBy);
    if (!tool) {
      tool = this.tools.find(item => item.type === toolIdOrType && !item.carriedBy);
    }
    if (!tool || tool.carriedBy) return false;
    const isAdjacentDirectly = Math.abs(player.x - tool.x) <= 1 && Math.abs(player.y - tool.y) <= 1;
    const isAdjacentToTable = this.isAdjacentToToolTable(player.x, player.y);
    if (!this.isSafeZoneCell(player.x, player.y) ||
        (!isAdjacentDirectly && !isAdjacentToTable) ||
        player.impostorTool === tool.type) return false;
    const previousTool = player.impostorTool;
    if (previousTool) {
      const previousSlot = this.tools.find(item =>
        item.type === previousTool && item.carriedBy === playerId
      );
      if (previousSlot) delete previousSlot.carriedBy;
    }
    tool.carriedBy = playerId;
    player.impostorTool = tool.type;
    return true;
  }

  public dropTool(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player?.impostorTool || !this.isSafeZoneCell(player.x, player.y)) return false;
    const tool = this.tools.find(item => item.carriedBy === playerId);
    if (!tool) throw new Error(`Carried Impostor tool slot missing for player ${playerId}.`);
    delete tool.carriedBy;
    player.impostorTool = null;
    return true;
  }

  public transferTool(holderId: string, requesterId: string): boolean {
    const holder = this.players.get(holderId);
    const requester = this.players.get(requesterId);
    const heldTool = this.tools.find(item => item.carriedBy === holderId);
    if (!holder?.impostorTool || !requester || !heldTool || heldTool.type !== holder.impostorTool) return false;

    const requesterTool = this.tools.find(item => item.carriedBy === requesterId);
    heldTool.carriedBy = requesterId;
    requester.impostorTool = heldTool.type;
    if (requesterTool) {
      requesterTool.carriedBy = holderId;
      holder.impostorTool = requesterTool.type;
    } else {
      holder.impostorTool = null;
    }
    return true;
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
      const pairId = `impostor_teleport_pair_${pairIndex + 1}`;
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
      if (!position) throw new Error('Impostor could not relocate all uncollected keys.');
      occupiedKeys.add(`${position.x},${position.y}`);
      return { ...key, x: position.x, y: position.y };
    });
  }

  public teleportPlayer(playerId: string, teleportId: string): Coordinate | null {
    const player = this.players.get(playerId);
    const source = this.teleports.find(teleport => teleport.id === teleportId);
    if (!player || player.isDead || player.isInPrison || player.hasImpostorEscaped ||
        player.impostorFrozenUntil > Date.now() || player.impostorTeleportingUntil > Date.now() || !source ||
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

  public sealImpostorExit(exitId: string): number | null {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit || exit.isSealed) return null;
    exit.isSealed = true;
    return this.exits.indexOf(exit) + 1;
  }

  public openImpostorExit(exitId: string): number | null {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit?.isSealed) return null;
    exit.isSealed = false;
    return this.exits.indexOf(exit) + 1;
  }

  public canOpenImpostorExitFrom(exitId: string, playerX: number, playerY: number): boolean {
    const exit = this.exits.find(candidate => candidate.id === exitId);
    if (!exit?.isSealed) return false;
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const isInsideRoom = playerX >= minX && playerX <= maxX && playerY >= minY && playerY <= maxY;
    return isInsideRoom && Math.abs(exit.x - playerX) + Math.abs(exit.y - playerY) === 1;
  }

  public isAdjacentToImpostorExit(exit: IImpostorExit, playerX: number, playerY: number): boolean {
    return Math.abs(exit.x - playerX) + Math.abs(exit.y - playerY) === 1;
  }

  public getImpostorValidMoves(playerId: string): Coordinate[] {
    const player = this.players.get(playerId);
    const isGhost = !!player && player.ghostModeExpiresAt > Date.now();
    if (!player || player.isDead || player.hasImpostorEscaped ||
        player.impostorFrozenUntil > Date.now() || player.impostorTeleportingUntil > Date.now() ||
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
          this.isGeneratorCell(adjacentX, adjacentY) ||
          this.isToolTableCell(adjacentX, adjacentY) ||
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
            !this.isGeneratorCell(jumpX, jumpY) &&
            !this.isToolTableCell(jumpX, jumpY) &&
            !this.isSealedCentralGateBlocking(adjacentX, adjacentY, jumpX, jumpY) &&
            !this.grid[jumpY][jumpX].hasPlayer) {
          validMoves.push({ x: jumpX, y: jumpY });
        }
        continue;
      }
      if (this.isInsideBoard(jumpX, jumpY) &&
          !this.isGeneratorCell(jumpX, jumpY) &&
          !this.isToolTableCell(jumpX, jumpY) &&
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
            !this.isGeneratorCell(sideX, sideY) &&
            !this.isToolTableCell(sideX, sideY) &&
            !this.isSealedCentralGateBlocking(adjacentX, adjacentY, sideX, sideY) &&
            (isGhost || !this.isWallBlocking(adjacentX, adjacentY, sideX, sideY)) &&
            !this.grid[sideY][sideX].hasPlayer) {
          validMoves.push({ x: sideX, y: sideY });
        }
      }
    }

    return validMoves;
  }

  public isAdjacentToGenerator(generator: IImpostorGenerator, x: number, y: number): boolean {
    const distanceX = Math.max(generator.x - x, 0, x - (generator.x + 2));
    const distanceY = Math.max(generator.y - y, 0, y - (generator.y + 2));
    return !this.isGeneratorCell(x, y) && distanceX + distanceY === 1;
  }

  public moveImpostorPlayer(playerId: string, newX: number, newY: number): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.getImpostorValidMoves(playerId).some(move => move.x === newX && move.y === newY)) {
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

  protected isGeneratedImpostorLayoutPlayable(): boolean {
    return this.isBoardConnected() && this.areAdjacentQuadrantsDirectlyConnected();
  }

  public canPlaceTrap(x: number, y: number, allowPlayerId?: string): boolean {
    return Number.isInteger(x) && Number.isInteger(y) &&
      this.isInsideBoard(x, y) &&
      !this.isSafeZoneCell(x, y) &&
      !this.isGeneratorCell(x, y) &&
      (!this.grid[y][x].hasPlayer || this.grid[y][x].hasPlayer === allowPlayerId) &&
      !this.keys.some(key => key.x === x && key.y === y) &&
      !this.exits.some(exit => exit.x === x && exit.y === y) &&
      !this.teleports.some(teleport => teleport.x === x && teleport.y === y) &&
      !this.shieldPickups.some(pickup => pickup.x === x && pickup.y === y) &&
      !this.traps.some(trap => trap.x === x && trap.y === y);
  }

  public placeTrap(trap: IImpostorTrap, allowPlayerId?: string): boolean {
    if (!this.canPlaceTrap(trap.x, trap.y, allowPlayerId)) return false;
    this.traps.push({ ...trap });
    return true;
  }

  public removeTrapAt(x: number, y: number): IImpostorTrap | null {
    const index = this.traps.findIndex(trap => trap.x === x && trap.y === y);
    return index < 0 ? null : this.traps.splice(index, 1)[0];
  }

  public addFootprint(x: number, y: number, createdAt: number = Date.now()): IImpostorFootprint | null {
    if (this.isSafeZoneCell(x, y)) return null;
    const footprint: IImpostorFootprint = {
      id: `footprint_${createdAt}_${Math.random().toString(36).slice(2, 9)}`,
      x,
      y,
      createdAt
    };
    this.footprints.push(footprint);
    this.cleanupExpiredFootprints(createdAt);
    return footprint;
  }

  public cleanupExpiredFootprints(now: number = Date.now(), maxAgeMs: number = 10_000): void {
    this.footprints = this.footprints.filter(fp => now - fp.createdAt < maxAgeMs);
  }

  public clearFootprints(): void {
    this.footprints = [];
  }

  public spawnShieldPickups(targetCount: number, random: () => number = Math.random): void {
    const candidates: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (!this.isSafeZoneCell(x, y) &&
            !this.isGeneratorCell(x, y) &&
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
        id: `impostor_shield_${Date.now()}_${this.shieldPickups.length}`,
        ...position
      });
    }
  }

  public collectShieldPickupAt(x: number, y: number): IImpostorShieldPickup | null {
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
        id: `impostor_ghost_${Date.now()}_${this.ghostPickups.length}`,
        ...position
      });
    }
  }

  public collectGhostPickupAt(x: number, y: number): IImpostorGhostPickup | null {
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
              !this.isGeneratorCell(x, y) &&
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

  public placeImpostorWall(wall: Wall): boolean {
    if (!this.canPlaceWall(wall)) return false;
    this.walls.push(wall);
    return true;
  }

  public override canPlaceWall(wall: Wall): boolean {
    if (!super.canPlaceWall(wall)) return false;
    if (this.wallPassagesTouchGenerator(wall)) return false;
    return !this.getWallPassages(wall).some(passage =>
      this.isPassageInsideProtectedCentralZone(passage) ||
      this.isPassageInsideGeneratorAccess(passage)
    );
  }

  private wallPassagesTouchGenerator(wall: Wall): boolean {
    return this.getWallPassages(wall).some(passage =>
      this.isGeneratorCell(passage.x1, passage.y1) ||
      this.isGeneratorCell(passage.x2, passage.y2)
    );
  }

  private areGeneratorRepairApproachesOpen(): boolean {
    return this.generators.every(generator => {
      const lastX = generator.x + 2;
      const lastY = generator.y + 2;
      const adjacentCells = [
        { x: generator.x - 1, y: generator.y },
        { x: generator.x - 1, y: generator.y + 1 },
        { x: generator.x - 1, y: lastY },
        { x: lastX + 1, y: generator.y },
        { x: lastX + 1, y: generator.y + 1 },
        { x: lastX + 1, y: lastY },
        { x: generator.x, y: generator.y - 1 },
        { x: generator.x + 1, y: generator.y - 1 },
        { x: lastX, y: generator.y - 1 },
        { x: generator.x, y: lastY + 1 },
        { x: generator.x + 1, y: lastY + 1 },
        { x: lastX, y: lastY + 1 }
      ];
      return adjacentCells.some(({ x, y }) =>
        this.isInsideBoard(x, y) &&
        !this.isGeneratorCell(x, y) &&
        !this.isWallBlocking(
          x,
          y,
          x < generator.x ? x + 1 : x > lastX ? x - 1 : x,
          y < generator.y ? y + 1 : y > lastY ? y - 1 : y
        )
      );
    });
  }

  public wouldEnclosePlayerWithWall(wall: Wall, playerId: string): boolean {
    if (!this.canPlaceWall(wall)) return false;
    this.walls.push(wall);
    try {
      return this.isImpostorPlayerEnclosed(playerId);
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
        if (this.isImpostorCellReachable(playerA.x, playerA.y, playerB.x, playerB.y)) {
          connectedPairs.push([playerA, playerB]);
        }
      }
    }

    this.walls.push(wall);
    try {
      return connectedPairs.some(([playerA, playerB]) =>
        !this.isImpostorCellReachable(playerA.x, playerA.y, playerB.x, playerB.y)
      );
    } finally {
      this.walls.pop();
    }
  }

  public wouldMakeUncollectedKeyUnreachable(wall: Wall): boolean {
    if (!this.canPlaceWall(wall)) return false;
    const getEligibleOwners = (key: IImpostorKey) => [...this.players.values()].filter(player =>
      !player.id.startsWith('bot_') && !player.isDead &&
      !player.hasImpostorKey && !player.hasImpostorKeyDelivered &&
      (!key.ownerId || key.ownerId === player.id)
    );
    const keysReachableBefore = this.keys.map(key => {
      const candidates = getEligibleOwners(key);
      return {
        key,
        wasReachable: candidates.some(player =>
          this.isImpostorCellReachable(player.x, player.y, key.x, key.y)
        )
      };
    });

    this.walls.push(wall);
    try {
      return keysReachableBefore.some(({ key, wasReachable }) => {
        if (!wasReachable) return false;
        const candidates = getEligibleOwners(key);
        return !candidates.some(player =>
          this.isImpostorCellReachable(player.x, player.y, key.x, key.y)
        );
      });
    } finally {
      this.walls.pop();
    }
  }

  public isImpostorCellReachable(startX: number, startY: number, targetX: number, targetY: number): boolean {
    if (!this.isInsideBoard(startX, startY) || !this.isInsideBoard(targetX, targetY) ||
        this.isGeneratorCell(startX, startY) || this.isGeneratorCell(targetX, targetY)) return false;
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
        if (!this.isInsideBoard(next.x, next.y) || visited.has(key) || this.isGeneratorCell(next.x, next.y) ||
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

  public isPlayerPlacedImpostorWall(wall: Wall): boolean {
    return wall.ownerId !== 'board';
  }

  public isImpostorPlayerEnclosed(playerId: string): boolean {
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

  public getImpostorCageWalls(playerId: string): Wall[] {
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

  public getImpostorReleaseWalls(playerId: string): Wall[] {
    return this.getImpostorCageWalls(playerId).filter(wall => {
      if (!this.isPlayerPlacedImpostorWall(wall)) return false;
      const wallIndex = this.walls.indexOf(wall);
      if (wallIndex < 0) return false;
      const [removed] = this.walls.splice(wallIndex, 1);
      const releasesPlayer = !this.isImpostorPlayerEnclosed(playerId);
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

  public spawnKeys(countOrOwners: number | string[], random: () => number = Math.random): void {
    const owners = Array.isArray(countOrOwners) ? countOrOwners : [];
    const count = Array.isArray(countOrOwners) ? owners.length : countOrOwners;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('Impostor must spawn at least one key.');
    }

    const candidates = this.getAvailableKeyCells();
    const capturable = this.shuffle(candidates.filter(({ x, y }) => this.isCellCapturable(x, y)), random);
    if (capturable.length === 0) {
      throw new Error('Impostor could not place a key in a capturable location.');
    }

    const selected = [capturable[0]];
    const remaining = this.shuffle(candidates.filter(cell =>
      cell.x !== selected[0].x || cell.y !== selected[0].y
    ), random);
    selected.push(...remaining.slice(0, Math.max(0, count - 1)));
    this.keys = selected.map((position, index) => ({
      id: `impostor_key_${index + 1}`,
      ...(owners[index] ? { ownerId: owners[index] } : {}),
      ...position
    }));
  }

  public collectKey(
    playerId: string,
    x: number,
    y: number,
    isImpostor = false
  ): IImpostorKey | null {
    const player = this.players.get(playerId);
    if (!player || player.hasImpostorKey || player.hasImpostorKeyDelivered ||
        player.hasImpostorEscaped ||
        (!isImpostor && (player.impostorTool !== 'radar' || !this.isCellPowered(x, y)))) return null;
    const keyIndex = this.keys.findIndex(key =>
      key.x === x && key.y === y &&
      (isImpostor ? key.ownerId === playerId : !key.ownerId || key.ownerId === playerId)
    );
    if (keyIndex < 0) return null;
    const [key] = this.keys.splice(keyIndex, 1);
    return key;
  }

  public isCellCapturable(x: number, y: number): boolean {
    if (x <= 0 || y <= 0 || x >= this.size - 1 || y >= this.size - 1) return false;
    const sides = [
      {
        blocked: { x, y: y - 1 },
        candidates: [
          new Wall('impostor_test_north_a', 'board', x - 1, y - 1, true),
          new Wall('impostor_test_north_b', 'board', x, y - 1, true)
        ]
      },
      {
        blocked: { x, y: y + 1 },
        candidates: [
          new Wall('impostor_test_south_a', 'board', x - 1, y, true),
          new Wall('impostor_test_south_b', 'board', x, y, true)
        ]
      },
      {
        blocked: { x: x - 1, y },
        candidates: [
          new Wall('impostor_test_west_a', 'board', x - 1, y - 1, false),
          new Wall('impostor_test_west_b', 'board', x - 1, y, false)
        ]
      },
      {
        blocked: { x: x + 1, y },
        candidates: [
          new Wall('impostor_test_east_a', 'board', x, y - 1, false),
          new Wall('impostor_test_east_b', 'board', x, y, false)
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

  public override toDTO(forPlayerId?: string, isImpostorViewer = false) {
    const board = super.toDTO(forPlayerId);
    const players = { ...board.players };
    for (const [playerId, player] of this.players) {
      players[playerId] = {
        ...players[playerId],
        hasImpostorKey: player.hasImpostorKey,
        hasImpostorKeyDelivered: player.hasImpostorKeyDelivered,
        hasImpostorEscaped: player.hasImpostorEscaped,
        impostorTool: player.impostorTool,
        ghostModeExpiresAt: player.ghostModeExpiresAt,
        impostorFrozenUntil: player.impostorFrozenUntil,
        impostorTeleportingUntil: player.impostorTeleportingUntil,
        impostorShieldActive: player.impostorShieldActive,
        impostorShieldExpiresAt: player.impostorShieldExpiresAt
      };
    }
    return {
      ...board,
      players,
      walls: this.walls.map(wall => ({
        id: wall.id,
        ownerId: 'impostor',
        isPlayerPlaced: wall.ownerId !== 'board',
        x: wall.x,
        y: wall.y,
        isHorizontal: wall.isHorizontal,
        isPrisonBlock: wall.isPrisonBlock,
        isSabotageWall: wall.isSabotageWall,
        isRescueWall: wall.isRescueWall
      })),
      validMoves: forPlayerId ? this.getImpostorValidMoves(forPlayerId) : [],
      keys: forPlayerId
        ? this.keys.filter(key => {
            const player = this.players.get(forPlayerId);
            if (isImpostorViewer) return true;
            const hasRadar = player?.impostorTool === 'radar';
            const generator = this.getGeneratorAt(key.x, key.y);
            return key.ownerId === forPlayerId && !player?.hasImpostorKey &&
              hasRadar && generator?.isDamaged !== true &&
              Math.max(Math.abs(player.x - key.x), Math.abs(player.y - key.y)) <= 3;
          }).map(key => ({ ...key }))
        : [],
      generators: this.generators.map(generator => ({ ...generator })),
      tools: this.tools.filter(tool => !tool.carriedBy).map(tool => ({ ...tool })),
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
            !this.isSafeZoneCell(x, y) &&
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

  private createExits(): IImpostorExit[] {
    const players = [...this.players.values()].filter(player => !player.id.startsWith('bot_'));
    const middle = Math.floor(this.size / 2);
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const exitRows = [
      { x: middle, y: minY },
      { x: maxX, y: middle },
      { x: middle, y: maxY },
      { x: minX, y: middle }
    ];

    return exitRows.map((position, index) => ({
        id: `impostor_exit_${index + 1}`,
        ...position,
        playerId: players[index % players.length]?.id ?? ''
      }));
  }

  private addCentralEntranceWalls(): void {
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const middle = Math.floor(this.size / 2);
    const gateStart = minX + Math.floor((maxX - minX + 1) / 2) - 1;
    let northSouthIndex = 0;
    let eastWestIndex = 0;
    for (let x = minX; x < maxX; x++) {
      if (x >= gateStart - 1 && x <= gateStart + 1) continue;
      this.walls.push(
        new Wall(`impostor_center_n_${northSouthIndex}`, 'board', x, minY - 1, true),
        new Wall(`impostor_center_s_${northSouthIndex}`, 'board', x, maxY, true)
      );
      northSouthIndex++;
    }

    for (let y = minY; y < maxY; y++) {
      if (y >= gateStart - 1 && y <= gateStart + 1) continue;
      this.walls.push(
        new Wall(`impostor_center_w_${eastWestIndex}`, 'board', minX - 1, y, false),
        new Wall(`impostor_center_e_${eastWestIndex}`, 'board', maxX, y, false)
      );
      eastWestIndex++;
    }
  }

  private getProtectedPassages(): Set<number> {
    const protectedPassages = new Set<number>();
    const middle = Math.floor(this.size / 2);
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const gateStart = minX + Math.floor((maxX - minX + 1) / 2) - 1;
    const addGatePassages = (x1: number, y1: number, x2: number, y2: number): void => {
      protectedPassages.add(this.getPassageKey({ x: x1, y: y1 }, { x: x2, y: y2 }));
    };
    for (const offset of [0, 1]) {
      const gateCoordinate = gateStart + offset;
      addGatePassages(gateCoordinate, minY - 1, gateCoordinate, minY);
      addGatePassages(gateCoordinate, maxY, gateCoordinate, maxY + 1);
      addGatePassages(minX - 1, gateCoordinate, minX, gateCoordinate);
      addGatePassages(maxX, gateCoordinate, maxX + 1, gateCoordinate);
    }
    for (const generator of this.generators) {
      const { x, y } = generator;
      for (const [outside, inside] of this.getGeneratorEntrancePassages(generator)) {
        addGatePassages(outside.x, outside.y, inside.x, inside.y);
      }
      const minX = Math.max(0, x - 1);
      const maxX = Math.min(this.size - 1, x + 3);
      const minY = Math.max(0, y - 1);
      const maxY = Math.min(this.size - 1, y + 3);
      for (let ringY = minY; ringY <= maxY; ringY++) {
        for (let ringX = minX; ringX <= maxX; ringX++) {
          if (this.isGeneratorCell(ringX, ringY)) continue;
          for (const { dx, dy } of [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }]) {
            const nextX = ringX + dx;
            const nextY = ringY + dy;
            if (nextX <= maxX && nextY <= maxY && !this.isGeneratorCell(nextX, nextY)) {
              addGatePassages(ringX, ringY, nextX, nextY);
            }
          }
        }
      }
    }

    const cornerOffset = Math.max(1, Math.min(minX - 1, Math.floor(minX / 2)));
    const cornerFarOffset = this.size - 1 - cornerOffset;

    const routes = [
      this.createRoute({ x: middle, y: minY }, { x: middle, y: 0 }),
      this.createRoute({ x: maxX, y: middle }, { x: this.size - 1, y: middle }),
      this.createRoute({ x: middle, y: maxY }, { x: middle, y: this.size - 1 }),
      this.createRoute({ x: minX, y: middle }, { x: 0, y: middle }),
      // Direct quadrant connectors around corners to prevent full perimeter loops:
      this.createRoute({ x: middle, y: cornerOffset }, { x: cornerOffset, y: cornerOffset }),
      this.createRoute({ x: cornerOffset, y: cornerOffset }, { x: cornerOffset, y: middle }),
      this.createRoute({ x: middle, y: cornerOffset }, { x: cornerFarOffset, y: cornerOffset }),
      this.createRoute({ x: cornerFarOffset, y: cornerOffset }, { x: cornerFarOffset, y: middle }),
      this.createRoute({ x: cornerOffset, y: middle }, { x: cornerOffset, y: cornerFarOffset }),
      this.createRoute({ x: cornerOffset, y: cornerFarOffset }, { x: middle, y: cornerFarOffset }),
      this.createRoute({ x: cornerFarOffset, y: middle }, { x: cornerFarOffset, y: cornerFarOffset }),
      this.createRoute({ x: cornerFarOffset, y: cornerFarOffset }, { x: middle, y: cornerFarOffset })
    ];

    for (const route of routes) {
      for (let index = 1; index < route.length; index++) {
        protectedPassages.add(this.getPassageKey(route[index - 1], route[index]));
      }
    }
    return protectedPassages;
  }

  private getGeneratorEntrancePassages(
    generator: IImpostorGenerator
  ): Array<[Coordinate, Coordinate]> {
    const { x, y } = generator;
    const eastX = x + 3;
    const southY = y + 3;
    switch (generator.sector) {
      case 'northwest':
        return [
          ...[0, 1, 2].map(offset =>
            [{ x: eastX, y: y + offset }, { x: eastX + 1, y: y + offset }] as [Coordinate, Coordinate]
          ),
          ...[0, 1, 2].map(offset =>
            [{ x: x + offset, y: southY }, { x: x + offset, y: southY + 1 }] as [Coordinate, Coordinate]
          )
        ];
      case 'northeast':
        return [
          ...[0, 1, 2].map(offset =>
            [{ x: x - 1, y: y + offset }, { x: x - 2, y: y + offset }] as [Coordinate, Coordinate]
          ),
          ...[0, 1, 2].map(offset =>
            [{ x: x + offset, y: southY }, { x: x + offset, y: southY + 1 }] as [Coordinate, Coordinate]
          )
        ];
      case 'southwest':
        return [
          ...[0, 1, 2].map(offset =>
            [{ x: eastX, y: y + offset }, { x: eastX + 1, y: y + offset }] as [Coordinate, Coordinate]
          ),
          ...[0, 1, 2].map(offset =>
            [{ x: x + offset, y: y - 1 }, { x: x + offset, y: y - 2 }] as [Coordinate, Coordinate]
          )
        ];
      case 'southeast':
        return [
          ...[0, 1, 2].map(offset =>
            [{ x: x - 1, y: y + offset }, { x: x - 2, y: y + offset }] as [Coordinate, Coordinate]
          ),
          ...[0, 1, 2].map(offset =>
            [{ x: x + offset, y: y - 1 }, { x: x + offset, y: y - 2 }] as [Coordinate, Coordinate]
          )
        ];
    }
  }

  private isPassageInsideGeneratorAccess(passage: { x1: number; y1: number; x2: number; y2: number }): boolean {
    const passageKey = this.getPassageKey(
      { x: passage.x1, y: passage.y1 },
      { x: passage.x2, y: passage.y2 }
    );
    return this.generators.some(generator => {
      const { x, y } = generator;
      const entranceKeys = this.getGeneratorEntrancePassages(generator)
        .map(([first, second]) => this.getPassageKey(first, second));
      if (entranceKeys.includes(passageKey)) return true;

      const minX = Math.max(0, x - 1);
      const maxX = Math.min(this.size - 1, x + 3);
      const minY = Math.max(0, y - 1);
      const maxY = Math.min(this.size - 1, y + 3);
      const isWalkableRingCell = (cellX: number, cellY: number): boolean =>
        cellX >= minX && cellX <= maxX && cellY >= minY && cellY <= maxY &&
        !this.isGeneratorCell(cellX, cellY);
      return isWalkableRingCell(passage.x1, passage.y1) &&
        isWalkableRingCell(passage.x2, passage.y2);
    });
  }

  private addGeneratorEnclosureWalls(): void {
    for (const generator of this.generators) {
      const { x, y } = generator;
      const fenceWalls: Wall[] = [];
      switch (generator.sector) {
        case 'northwest':
          fenceWalls.push(
            new Wall(`${generator.id}_east_fence`, 'board', x + 4, y + 3, false),
            new Wall(`${generator.id}_south_fence`, 'board', x + 3, y + 4, true)
          );
          break;
        case 'northeast':
          fenceWalls.push(
            new Wall(`${generator.id}_west_fence`, 'board', x - 2, y + 2, false),
            new Wall(`${generator.id}_south_fence`, 'board', x - 2, y + 3, true)
          );
          break;
        case 'southwest':
          fenceWalls.push(
            new Wall(`${generator.id}_east_fence`, 'board', x + 4, y - 2, false),
            new Wall(`${generator.id}_north_fence`, 'board', x + 3, y - 2, true)
          );
          break;
        case 'southeast':
          fenceWalls.push(
            new Wall(`${generator.id}_west_fence`, 'board', x - 2, y - 2, false),
            new Wall(`${generator.id}_north_fence`, 'board', x - 2, y - 2, true)
          );
          break;
      }
      this.walls.push(...fenceWalls);
    }
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

  private isBoardConnected(): boolean {
    const totalCells = this.size * this.size;
    const excludedCells = new Uint8Array(totalCells);
    const blockedPassages = new Set<number>();
    for (const wall of this.walls) {
      for (const passage of this.getWallPassages(wall)) {
        blockedPassages.add(passage.key);
      }
    }
    for (const player of this.players.values()) {
      if (player.isInPrison) excludedCells[player.y * this.size + player.x] = 1;
    }
    for (const generator of this.generators) {
      for (let y = generator.y; y <= generator.y + 2; y++) {
        for (let x = generator.x; x <= generator.x + 2; x++) {
          excludedCells[y * this.size + x] = 1;
        }
      }
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
      if (y > 0) writeIndex = this.enqueueImpostorCell(currentIndex, currentIndex - this.size, excludedCells, visited, blockedPassages, queue, writeIndex);
      if (y < this.size - 1) writeIndex = this.enqueueImpostorCell(currentIndex, currentIndex + this.size, excludedCells, visited, blockedPassages, queue, writeIndex);
      if (x > 0) writeIndex = this.enqueueImpostorCell(currentIndex, currentIndex - 1, excludedCells, visited, blockedPassages, queue, writeIndex);
      if (x < this.size - 1) writeIndex = this.enqueueImpostorCell(currentIndex, currentIndex + 1, excludedCells, visited, blockedPassages, queue, writeIndex);
    }
    for (let index = 0; index < totalCells; index++) {
      if (!excludedCells[index] && !visited[index]) return false;
    }
    return true;
  }

  private enqueueImpostorCell(
    currentIndex: number,
    nextIndex: number,
    excludedCells: Uint8Array,
    visited: Uint8Array,
    blockedPassages: Set<number>,
    queue: Int32Array,
    writeIndex: number
  ): number {
    if (visited[nextIndex] || excludedCells[nextIndex]) return writeIndex;
    const passageKey = Math.min(currentIndex, nextIndex) * this.size * this.size +
      Math.max(currentIndex, nextIndex);
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
      !player.isInPrison && !player.hasImpostorEscaped && !player.isDead
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
    const crossesGate = (exit: IImpostorExit): boolean => {
      if (!exit.isSealed) return false;
      if (exit.x === middle && exit.y === minY) {
        return fromY !== toY && Math.min(fromY, toY) === minY - 1 &&
          fromX === toX && fromX === middle;
      }
      if (exit.x === maxX && exit.y === middle) {
        return fromX !== toX && Math.min(fromX, toX) === maxX &&
          fromY === toY && fromY === middle;
      }
      if (exit.x === middle && exit.y === maxY) {
        return fromY !== toY && Math.min(fromY, toY) === maxY &&
          fromX === toX && fromX === middle;
      }
      if (exit.x === minX && exit.y === middle) {
        return fromX !== toX && Math.min(fromX, toX) === minX - 1 &&
          fromY === toY && fromY === middle;
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
    const roomSize = Math.min(7, this.size);
    const min = Math.max(0, Math.min(this.size - roomSize, middle - 3));
    return {
      minX: min,
      maxX: min + roomSize - 1,
      minY: min,
      maxY: min + roomSize - 1
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

  private wouldCreateExcessiveCollinearChain(wall: Wall): boolean {
    if (wall.isHorizontal) {
      let leftCount = 0;
      let checkX = wall.x - 2;
      while (checkX >= 0 && this.walls.some(w => w.isHorizontal && w.y === wall.y && w.x === checkX)) {
        leftCount++;
        checkX -= 2;
      }
      let rightCount = 0;
      checkX = wall.x + 2;
      while (checkX < this.size - 1 && this.walls.some(w => w.isHorizontal && w.y === wall.y && w.x === checkX)) {
        rightCount++;
        checkX += 2;
      }
      if (leftCount + 1 + rightCount >= 3) return true;
    } else {
      let upCount = 0;
      let checkY = wall.y - 2;
      while (checkY >= 0 && this.walls.some(w => !w.isHorizontal && w.x === wall.x && w.y === checkY)) {
        upCount++;
        checkY -= 2;
      }
      let downCount = 0;
      checkY = wall.y + 2;
      while (checkY < this.size - 1 && this.walls.some(w => !w.isHorizontal && w.x === wall.x && w.y === checkY)) {
        downCount++;
        checkY += 2;
      }
      if (upCount + 1 + downCount >= 3) return true;
    }
    return false;
  }

  protected areAdjacentQuadrantsDirectlyConnected(): boolean {
    if (this.size < 7) return true;
    const middle = Math.floor(this.size / 2);
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    const northPt = { x: middle, y: Math.max(0, minY - 2) };
    const southPt = { x: middle, y: Math.min(this.size - 1, maxY + 2) };
    const westPt = { x: Math.max(0, minX - 2), y: middle };
    const eastPt = { x: Math.min(this.size - 1, maxX + 2), y: middle };

    const maxDirectDistance = Math.floor((this.size - 1) * 1.5) + 4;

    const distFromNorth = this.getShortestPathDistancesFrom(northPt);
    const dNW = distFromNorth[westPt.y * this.size + westPt.x];
    const dNE = distFromNorth[eastPt.y * this.size + eastPt.x];
    if (dNW < 0 || dNW > maxDirectDistance || dNE < 0 || dNE > maxDirectDistance) {
      return false;
    }

    const distFromSouth = this.getShortestPathDistancesFrom(southPt);
    const dSW = distFromSouth[westPt.y * this.size + westPt.x];
    const dSE = distFromSouth[eastPt.y * this.size + eastPt.x];
    if (dSW < 0 || dSW > maxDirectDistance || dSE < 0 || dSE > maxDirectDistance) {
      return false;
    }

    return true;
  }

  private getShortestPathDistancesFrom(start: Coordinate): Int32Array {
    const totalCells = this.size * this.size;
    const distances = new Int32Array(totalCells);
    distances.fill(-1);

    const startIndex = start.y * this.size + start.x;
    const queue = new Int32Array(totalCells);
    let readIndex = 0;
    let writeIndex = 0;

    const blockedPassages = new Set<number>();
    for (const wall of this.walls) {
      for (const passage of this.getWallPassages(wall)) {
        blockedPassages.add(passage.key);
      }
    }

    const excludedCells = new Uint8Array(totalCells);
    for (const generator of this.generators) {
      for (let y = generator.y; y <= generator.y + 2; y++) {
        for (let x = generator.x; x <= generator.x + 2; x++) {
          if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
            excludedCells[y * this.size + x] = 1;
          }
        }
      }
    }

    if (excludedCells[startIndex]) return distances;

    distances[startIndex] = 0;
    queue[writeIndex++] = startIndex;

    while (readIndex < writeIndex) {
      const currentIndex = queue[readIndex++];
      const currentDist = distances[currentIndex];
      const x = currentIndex % this.size;
      const y = Math.floor(currentIndex / this.size);

      const neighbors = [
        y > 0 ? currentIndex - this.size : -1,
        y < this.size - 1 ? currentIndex + this.size : -1,
        x > 0 ? currentIndex - 1 : -1,
        x < this.size - 1 ? currentIndex + 1 : -1
      ];

      for (const nextIndex of neighbors) {
        if (nextIndex < 0 || excludedCells[nextIndex] || distances[nextIndex] !== -1) continue;
        const passageKey = Math.min(currentIndex, nextIndex) * this.size * this.size +
          Math.max(currentIndex, nextIndex);
        if (blockedPassages.has(passageKey)) continue;

        distances[nextIndex] = currentDist + 1;
        queue[writeIndex++] = nextIndex;
      }
    }

    return distances;
  }
}
