import { MazeBoard, type IMazeGhostPickup } from './maze-board.js';
import type { Coordinate } from './models.js';

export interface IInfectionInvisiblePickup extends Coordinate {
  id: string;
}

export class InfectionBoard extends MazeBoard {
  public invisiblePickups: IInfectionInvisiblePickup[] = [];
  private ghostPickupSequence = 0;
  private infectionPickupSequence = 0;

  protected override getProtectedCentralZoneBounds(): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    return this.getCentralRoomBounds();
  }

  public override isSafeZoneCell(x: number, y: number): boolean {
    const { minX, maxX, minY, maxY } = this.getCentralRoomBounds();
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  public override canPlaceTrap(x: number, y: number): boolean {
    return super.canPlaceTrap(x, y) &&
      !this.ghostPickups.some(pickup => pickup.x === x && pickup.y === y) &&
      !this.invisiblePickups.some(pickup => pickup.x === x && pickup.y === y) &&
      this.getAvailablePowerupCells().length > 9;
  }

  public placePlayerAtSouthEdge(playerId: string): Coordinate {
    const player = this.players.get(playerId);
    if (!player) throw new Error(`Infection player ${playerId} is missing from the board.`);

    const centerX = Math.floor(this.size / 2);
    const xCandidates = Array.from({ length: this.size }, (_, x) => x)
      .sort((first, second) => Math.abs(first - centerX) - Math.abs(second - centerX));
    const x = xCandidates.find(candidateX =>
      !this.grid[this.size - 1][candidateX].hasPlayer ||
      this.grid[this.size - 1][candidateX].hasPlayer === playerId
    );
    if (x === undefined) throw new Error('Infection could not find an available south-edge spawn cell.');

    if (this.grid[player.y]?.[player.x]?.hasPlayer === playerId) {
      this.grid[player.y][player.x].hasPlayer = null;
    }
    player.x = x;
    player.y = this.size - 1;
    player.startX = x;
    player.startY = this.size - 1;
    this.grid[player.y][player.x].hasPlayer = playerId;
    return { x, y: this.size - 1 };
  }

  public spawnInvisiblePickups(targetCount: number, random: () => number = Math.random): void {
    const candidates = this.shuffleCandidates(this.getAvailablePowerupCells(), random);
    this.invisiblePickups = candidates.slice(0, targetCount).map(position => ({
      id: `infection_invisible_${++this.infectionPickupSequence}`,
      ...position
    }));
  }

  public collectInfectionPowerupAt(
    x: number,
    y: number,
    random: () => number = Math.random,
    hasActivePowerup = false
  ): 'ghost' | 'invisible' | 'shield' | null {
    if (hasActivePowerup) return null;
    const ghostIndex = this.ghostPickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    if (ghostIndex >= 0) {
      const collected = this.ghostPickups[ghostIndex];
      if (!collected) return null;
      const candidates = this.shuffleCandidates(
        this.getAvailablePowerupCells().filter(({ x: candidateX, y: candidateY }) =>
          candidateX !== collected.x || candidateY !== collected.y),
        random
      );
      const position = candidates[0];
      if (!position) throw new Error('Infection could not relocate its ghost pickup.');
      this.ghostPickups.splice(ghostIndex, 1);
      this.ghostPickups.push({
        id: `infection_ghost_${++this.ghostPickupSequence}`,
        ...position
      });
      return 'ghost';
    }
    const invisibleIndex = this.invisiblePickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    if (invisibleIndex >= 0) {
      const collected = this.invisiblePickups[invisibleIndex];
      if (!collected) return null;
      const replacement = this.createReplacementPickup(collected, random, 'invisible');
      this.invisiblePickups.splice(invisibleIndex, 1);
      this.invisiblePickups.push(replacement);
      return 'invisible';
    }
    const shieldIndex = this.shieldPickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    if (shieldIndex >= 0) {
      const collected = this.shieldPickups[shieldIndex];
      if (!collected) return null;
      const replacement = this.createReplacementPickup(collected, random, 'shield');
      this.shieldPickups.splice(shieldIndex, 1);
      this.shieldPickups.push(replacement);
      return 'shield';
    }
    return null;
  }

  public respawnInfectionPowerups(
    ghostCount: number,
    invisibleCount: number,
    shieldCount: number,
    random: () => number = Math.random
  ): void {
    const previousPositions = new Set([
      ...this.ghostPickups,
      ...this.invisiblePickups,
      ...this.shieldPickups
    ].map(({ x, y }) => `${x},${y}`));
    const candidates = this.shuffleCandidates(
      this.getAvailablePowerupCells(previousPositions),
      random
    );
    const requiredCount = ghostCount + invisibleCount + shieldCount;
    if (candidates.length < requiredCount) {
      throw new Error(
        `Infection could not relocate all power-ups after maze reshuffle (expected ${requiredCount}, found ${candidates.length}).`
      );
    }

    const shieldPositions = candidates.slice(0, shieldCount);
    const ghostPositions = candidates.slice(shieldCount, shieldCount + ghostCount);
    const invisiblePositions = candidates.slice(shieldCount + ghostCount, requiredCount);
    this.shieldPickups = shieldPositions
      .map(position => ({ id: `infection_shield_${++this.infectionPickupSequence}`, ...position }));
    this.ghostPickups = ghostPositions
      .map(position => ({ id: `infection_ghost_${++this.ghostPickupSequence}`, ...position }));
    this.invisiblePickups = invisiblePositions
      .map(position => ({ id: `infection_invisible_${++this.infectionPickupSequence}`, ...position }));
  }

  public override toDTO(forPlayerId?: string) {
    const dto = super.toDTO(forPlayerId);
    const viewerIsInfected = this.players.get(forPlayerId ?? '')?.isInfected === true;
    const hiddenPlayerIds = new Set(
      [...this.players.values()]
        .filter(player => viewerIsInfected && player.invisibleUntil > Date.now())
        .map(player => player.id)
    );
    const players = Object.fromEntries(
      Object.entries(dto.players)
        .filter(([playerId]) => !hiddenPlayerIds.has(playerId))
        .map(([playerId, player]) => [playerId, {
          ...player,
          isInvisible: (this.players.get(playerId)?.invisibleUntil ?? 0) > Date.now()
        }])
    );

    return {
      ...dto,
      players,
      grid: dto.grid.map(row => row.map(cell =>
        cell.hasPlayer && hiddenPlayerIds.has(cell.hasPlayer)
          ? { ...cell, hasPlayer: null }
          : cell
      )),
      teleports: viewerIsInfected ? [] : dto.teleports,
      ghostPickups: viewerIsInfected ? [] : this.ghostPickups.map((pickup: IMazeGhostPickup) => ({ ...pickup })),
      invisiblePickups: viewerIsInfected ? [] : this.invisiblePickups.map(pickup => ({ ...pickup })),
      shieldPickups: viewerIsInfected ? [] : dto.shieldPickups
    };
  }

  private createReplacementPickup(
    collected: Coordinate,
    random: () => number,
    type: 'invisible' | 'shield'
  ): { id: string; x: number; y: number } {
    const candidates = this.shuffleCandidates(
      this.getAvailablePowerupCells().filter(({ x, y }) => x !== collected.x || y !== collected.y),
      random
    );
    const position = candidates[0];
    if (!position) throw new Error(`Infection could not relocate its ${type} pickup.`);
    return { id: `infection_${type}_${++this.infectionPickupSequence}`, ...position };
  }

  private getAvailablePowerupCells(excludedPositions: ReadonlySet<string> = new Set()): Coordinate[] {
    const occupied = new Set([
      ...[...this.players.values()].map(player => `${player.x},${player.y}`),
      ...this.keys.map(item => `${item.x},${item.y}`),
      ...this.teleports.map(item => `${item.x},${item.y}`),
      ...this.traps.map(item => `${item.x},${item.y}`),
      ...this.shieldPickups.map(item => `${item.x},${item.y}`),
      ...this.ghostPickups.map(item => `${item.x},${item.y}`),
      ...this.invisiblePickups.map(item => `${item.x},${item.y}`)
    ]);
    const candidates: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const position = `${x},${y}`;
        if (!this.isSafeZoneCell(x, y) && !occupied.has(position) &&
            !excludedPositions.has(position)) candidates.push({ x, y });
      }
    }
    return candidates;
  }

  private shuffleCandidates<T>(items: T[], random: () => number): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }
}
