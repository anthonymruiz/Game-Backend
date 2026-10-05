import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Board } from '../game/engine/board.js';
import { Player, Wall } from '../game/engine/models.js';
import { GameInstance } from '../game/engine/game-instance.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('Suite 07: Engine Comprehensive Rules & Mechanics', () => {
  let board: Board;

  beforeEach(() => {
    board = new Board(11);
  });

  it('7.1 Board Initialization correctly constructs 11x11 grid', () => {
    assert.strictEqual(board.size, 11);
    assert.strictEqual(board.grid.length, 11);
    assert.strictEqual(board.grid[0].length, 11);
    assert.strictEqual(board.walls.length, 0);
    assert.strictEqual(board.boosts.length, 0);
  });

  it('7.2 Player Movement - Valid single-step adjacent moves', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 0, 10, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    // Down (5, 1)
    const movedDown = board.movePlayer('p1', 5, 1);
    assert.strictEqual(movedDown, true);
    assert.strictEqual(p1.x, 5);
    assert.strictEqual(p1.y, 1);

    // Left (4, 1)
    const movedLeft = board.movePlayer('p1', 4, 1);
    assert.strictEqual(movedLeft, true);

    // Right (5, 1)
    const movedRight = board.movePlayer('p1', 5, 1);
    assert.strictEqual(movedRight, true);

    // Up (5, 0)
    const movedUp = board.movePlayer('p1', 5, 0);
    assert.strictEqual(movedUp, true);
  });

  it('7.3 Player Movement - Rejects illegal moves (diagonals, >1 step, out-of-bounds, non-existent player)', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 5, 0, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    // Diagonal move (6, 6)
    assert.strictEqual(board.movePlayer('p1', 6, 6), false);

    // 2-step move (5, 7)
    assert.strictEqual(board.movePlayer('p1', 5, 7), false);

    // Out of bounds (-1, 5)
    assert.strictEqual(board.movePlayer('p1', -1, 5), false);

    // Out of bounds (11, 5)
    assert.strictEqual(board.movePlayer('p1', 11, 5), false);

    // Non-existent player
    assert.strictEqual(board.movePlayer('unknown', 5, 6), false);
  });

  it('7.4 Player Movement - Blocked by Horizontal Wall', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 5, 0, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    // Place a horizontal wall between (5,5) and (5,6)
    const wall = new Wall('w1', 'p1', 5, 5, true);
    board.placeWall(wall);

    const moveDown = board.movePlayer('p1', 5, 6);
    assert.strictEqual(moveDown, false);
    assert.strictEqual(p1.y, 5);
  });

  it('7.5 Player Movement - Blocked by Vertical Wall', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 5, 0, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    // Place a vertical wall between (5,5) and (6,5)
    const wall = new Wall('w1', 'p1', 5, 5, false);
    board.placeWall(wall);

    const moveRight = board.movePlayer('p1', 6, 5);
    assert.strictEqual(moveRight, false);
    assert.strictEqual(p1.x, 5);
  });

  it('7.6 Boost Spawning and Pickup - Wall count increases upon pickup', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 5, 0, undefined, 5, 0, '#FF0000');
    board.addPlayer(p1);

    board.grid[6][5].hasBoost = 'boost_1';
    board.boosts.push({ id: 'boost_1', type: 'extra_wall', x: 5, y: 6 });

    assert.strictEqual(p1.wallsLeft, 5);

    const moved = board.movePlayer('p1', 5, 6);
    assert.strictEqual(moved, true);

    assert.strictEqual(p1.wallsLeft, 6);
    assert.strictEqual(board.grid[6][5].hasBoost, null);
    assert.strictEqual(board.boosts.length, 0);
  });

  it('7.7 Wall Placement - Rejects placement when player has 0 walls left', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 0, 10, undefined, 0, 0, '#FF0000');
    board.addPlayer(p1);

    const wall = new Wall('w1', 'p1', 2, 2, true);
    const result = board.placeWall(wall);
    assert.strictEqual(result, false);
    assert.strictEqual(board.walls.length, 0);
  });

  it('7.8 Wall Placement - Rejects wall placement out of bounds', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 0, 10, undefined, 5, 0, '#FF0000');
    board.addPlayer(p1);

    const wall1 = new Wall('w1', 'p1', 10, 2, true);
    assert.strictEqual(board.placeWall(wall1), false);

    const wall2 = new Wall('w2', 'p1', 2, 10, false);
    assert.strictEqual(board.placeWall(wall2), false);

    const wall3 = new Wall('w3', 'p1', -1, 2, true);
    assert.strictEqual(board.placeWall(wall3), false);
  });

  it('7.9 Wall Placement - Rejects parallel and cross wall overlaps', () => {
    const p1 = new Player('p1', 'Player 1', false, 5, 0, 10, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    const wall1 = new Wall('w1', 'p1', 4, 4, true);
    assert.strictEqual(board.placeWall(wall1), true);

    const wallSame = new Wall('w2', 'p1', 4, 4, true);
    assert.strictEqual(board.placeWall(wallSame), false);

    const wallOverlapH = new Wall('w3', 'p1', 3, 4, true);
    assert.strictEqual(board.placeWall(wallOverlapH), false);

    const wallCross = new Wall('w4', 'p1', 4, 4, false);
    assert.strictEqual(board.placeWall(wallCross), false);
  });

  it('7.10 Wall Placement Pathfinding - Rejects walls that completely trap a player', () => {
    const p1 = new Player('p1', 'Player 1', false, 0, 0, 10, undefined, 10, 0, '#FF0000');
    board.addPlayer(p1);

    const w1 = new Wall('w1', 'p1', 0, 0, true);
    assert.strictEqual(board.placeWall(w1), true);

    const w2 = new Wall('w2', 'p1', 0, 0, false);
    const w2Result = board.placeWall(w2);
    assert.strictEqual(w2Result, false);
    assert.strictEqual(board.walls.length, 1);
  });

  it('7.11 GameInstance Turn & Win Condition Engine', () => {
    const roomPlayers = [
      { id: 'p1', username: 'Alice', isGuest: false, color: '#FF0000' },
      { id: 'p2', username: 'Bob', isGuest: false, color: '#00FF00' }
    ];

    let lastEvent = '';
    const game = new GameInstance('room_test', '1v1', roomPlayers, (ev, data) => {
      lastEvent = ev;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.strictEqual(game.state, 'playing');
    assert.strictEqual(game.getCurrentPlayer(), 'p1');

    // P1 moves from (4,8) to adjacent cell (4,7)
    const moveRes = game.executeMove('p1', 4, 7);
    assert.strictEqual(moveRes, true);
    // Turn rotates to P2
    assert.strictEqual(game.getCurrentPlayer(), 'p2');

    game.destroy();
  });
});
