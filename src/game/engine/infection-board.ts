import { MazeBoard, type IMazeGhostPickup } from './maze-board.js';
import type { Coordinate } from './models.js';

export interface IInfectionInvisiblePickup extends Coordinate {
  id: string;
}

export class InfectionBoard extends MazeBoard {
  public invisiblePickups: IInfectionInvisiblePickup[] = [];
  private ghostPickupSequence = 0;

  public spawnInvisiblePickups(targetCount: number, random: () => number = Math.random): void {
    const candidates = this.shuffleCandidates(this.getAvailablePowerupCells(), random);
    this.invisiblePickups = candidates.slice(0, targetCount).map((position, index) => ({
      id: `infection_invisible_${index + 1}`,
      ...position
    }));
  }

  public collectInfectionPowerupAt(
    x: number,
    y: number,
    random: () => number = Math.random
  ): 'ghost' | 'invisible' | null {
    const ghostIndex = this.ghostPickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    if (ghostIndex >= 0) {
      const [collected] = this.ghostPickups.splice(ghostIndex, 1);
      if (!collected) return 'ghost';
      const candidates = this.shuffleCandidates(
        this.getAvailablePowerupCells().filter(({ x: candidateX, y: candidateY }) =>
          candidateX !== collected.x || candidateY !== collected.y
        ),
        random
      );
      const position = candidates[0];
      if (position) {
        this.ghostPickups.push({
          id: `infection_ghost_${++this.ghostPickupSequence}`,
          ...position
        });
      }
      return 'ghost';
    }
    const invisibleIndex = this.invisiblePickups.findIndex(pickup => pickup.x === x && pickup.y === y);
    if (invisibleIndex >= 0) {
      this.invisiblePickups.splice(invisibleIndex, 1);
      return 'invisible';
    }
    return null;
  }

  public respawnInfectionPowerups(
    ghostCount: number,
    invisibleCount: number,
    random: () => number = Math.random
  ): void {
    this.ghostPickups = [];
    this.invisiblePickups = [];
    this.spawnGhostPickups(ghostCount, random);
    this.spawnInvisiblePickups(invisibleCount, random);
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
      invisiblePickups: viewerIsInfected ? [] : this.invisiblePickups.map(pickup => ({ ...pickup }))
    };
  }

  private getAvailablePowerupCells(): Coordinate[] {
    const occupied = new Set([
      ...[...this.players.values()].map(player => `${player.x},${player.y}`),
      ...this.keys.map(item => `${item.x},${item.y}`),
      ...this.teleports.map(item => `${item.x},${item.y}`),
      ...this.traps.map(item => `${item.x},${item.y}`),
      ...this.ghostPickups.map(item => `${item.x},${item.y}`),
      ...this.invisiblePickups.map(item => `${item.x},${item.y}`)
    ]);
    const candidates: Coordinate[] = [];
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (!this.isSafeZoneCell(x, y) && !occupied.has(`${x},${y}`)) candidates.push({ x, y });
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
