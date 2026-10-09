import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../game/engine/board.js';
import { Player, Wall } from '../game/engine/models.js';

describe('Classic Board', () => {
  it('tracks players on the grid and permits valid adjacent moves', () => {
    const board = new Board(7);
    const player = new Player('player-1', 'Player 1', false, 3, 3);
    board.addPlayer(player);

    assert.equal(board.grid[3][3].hasPlayer, player.id);
    assert.ok(board.getValidMoves(player.id).some(move => move.x === 4 && move.y === 3));
    assert.equal(board.movePlayer(player.id, 4, 3), true);
    assert.equal(board.grid[3][3].hasPlayer, null);
    assert.equal(board.grid[3][4].hasPlayer, player.id);
  });

  it('rejects movement through a blocking wall without changing player state', () => {
    const board = new Board(7);
    const player = new Player('player-1', 'Player 1', false, 3, 3);
    board.addPlayer(player);
    board.walls.push(new Wall('wall-1', player.id, 3, 3, false));

    assert.equal(board.movePlayer(player.id, 4, 3), false);
    assert.deepEqual({ x: player.x, y: player.y }, { x: 3, y: 3 });
    assert.equal(board.grid[3][3].hasPlayer, player.id);
  });

  it('keeps every spawned boost at least three moves away from living players', () => {
    const board = new Board(11);
    board.addPlayer(new Player('yellow', 'Yellow', false, 0, 5));
    board.addPlayer(new Player('green', 'Green', false, 10, 5));

    board.spawnRandomBoost();
    assert.equal(board.spawnFfaBoost('wall_pickup'), true);
    assert.equal(board.spawnFfaBoost('portal'), true);
    assert.equal(board.spawnFfaBoost('ghost'), true);
    assert.equal(board.spawnKillerItem(), true);
    assert.equal(board.spawnExchangeItem(), true);

    const assertBoostsAreSeparated = () => {
      for (const boost of board.boosts) {
        for (const player of board.players.values()) {
          assert.ok(
            Math.abs(boost.x - player.x) + Math.abs(boost.y - player.y) >= 3,
            `${boost.type} at (${boost.x}, ${boost.y}) is too close to ${player.username}`
          );
        }
      }
    };
    assertBoostsAreSeparated();

    board.spawnSingleRandomBoost();
    assertBoostsAreSeparated();
  });
});
