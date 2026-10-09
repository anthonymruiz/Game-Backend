import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ImpostorBoard } from '../game/engine/impostor-board.js';
import { Player } from '../game/engine/models.js';

describe('ImpostorBoard', () => {
  it('creates impostor exits and paired teleports without overlapping player cells', () => {
    const board = new ImpostorBoard(20);
    board.addPlayer(new Player('player-1', 'Player 1', false, 1, 1));
    board.generateRandomImpostorWalls(0);
    board.spawnTeleports(() => 0, [], 2);

    assert.equal(board.exits.length, 4);
    assert.equal(board.teleports.length, 4);
    assert.equal(new Set(board.teleports.map(teleport => teleport.pairId)).size, 2);
    assert.ok(board.teleports.every(teleport => !board.grid[teleport.y][teleport.x].hasPlayer));
  });

  it('allows a player to place a trap on their own cell but rejects overlaps', () => {
    const board = new ImpostorBoard(20);
    const player = new Player('player-1', 'Player 1', false, 1, 1);
    board.addPlayer(player);
    const trap = { id: 'trap-1', type: 'ice' as const, x: player.x, y: player.y };

    assert.equal(board.placeTrap(trap, player.id), true);
    assert.equal(board.placeTrap({ ...trap, id: 'trap-2', type: 'teleport' }, player.id), false);
    assert.equal(board.traps.length, 1);
  });

  it('moves a player only to an available impostor move', () => {
    const board = new ImpostorBoard(20);
    const player = new Player('player-1', 'Player 1', false, 1, 1);
    board.addPlayer(player);

    assert.equal(board.moveImpostorPlayer(player.id, 2, 1), true);
    assert.deepEqual({ x: player.x, y: player.y }, { x: 2, y: 1 });
    assert.equal(board.moveImpostorPlayer(player.id, 19, 19), false);
  });

});
