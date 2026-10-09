import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InfectionBoard } from '../game/engine/infection-board.js';
import { ImpostorBoard } from '../game/engine/impostor-board.js';
import { Player } from '../game/engine/models.js';

describe('InfectionBoard', () => {
  it('is a separate concrete board from Impostor', () => {
    const board = new InfectionBoard(20);

    assert.equal(board instanceof ImpostorBoard, false);
  });

  it('uses the central room as its safe zone and prevents traps there', () => {
    const board = new InfectionBoard(20);
    const center = Math.floor(board.size / 2);
    const safeCell = { x: center, y: center };

    assert.equal(board.isSafeZoneCell(safeCell.x, safeCell.y), true);
    assert.equal(board.canPlaceTrap(safeCell.x, safeCell.y), false);
  });

  it('places players on distinct south-edge cells and updates their start positions', () => {
    const board = new InfectionBoard(11);
    const first = new Player('player-1', 'Player 1', false, 0, 0);
    const second = new Player('player-2', 'Player 2', false, 0, 0);
    board.addPlayer(first);
    board.addPlayer(second);

    const firstSpawn = board.placePlayerAtSouthEdge(first.id);
    const secondSpawn = board.placePlayerAtSouthEdge(second.id);

    assert.equal(firstSpawn.y, board.size - 1);
    assert.equal(secondSpawn.y, board.size - 1);
    assert.notDeepEqual(firstSpawn, secondSpawn);
    assert.deepEqual({ x: first.startX, y: first.startY }, firstSpawn);
    assert.deepEqual({ x: second.startX, y: second.startY }, secondSpawn);
  });

  it('teleports to an available opposite edge and keeps the grid in sync', () => {
    const board = new InfectionBoard(11);
    const player = new Player('player-1', 'Player 1', false, 5, 5);
    board.addPlayer(player);

    const result = board.teleportPlayerToOppositeEdge(player.id, () => 0);

    assert.ok(result);
    assert.equal(result.destination.y, 0);
    assert.equal(board.grid[result.from.y][result.from.x].hasPlayer, null);
    assert.equal(board.grid[result.destination.y][result.destination.x].hasPlayer, player.id);
  });

  it('collects and replaces a ghost pickup while refusing collection with an active power', () => {
    const board = new InfectionBoard(20);
    board.ghostPickups = [{ id: 'ghost-1', x: 1, y: 1 }];

    assert.equal(board.collectInfectionPowerupAt(1, 1, () => 0.5, true), null);
    assert.equal(board.collectInfectionPowerupAt(1, 1, () => 0.5), 'ghost');
    assert.equal(board.ghostPickups.length, 1);
    assert.notDeepEqual(board.ghostPickups[0], { id: 'ghost-1', x: 1, y: 1 });
  });

});
