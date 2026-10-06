import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Board } from '../game/engine/board.js';
import { Boost, Player, Wall } from '../game/engine/models.js';
import { GameInstance, PLAYER_INACTIVITY_LIMIT_MS } from '../game/engine/game-instance.js';
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

  it('7.11 Ghost power crosses walls for three moves and then expires', () => {
    const player = new Player('ghost_player', 'Ghost', false, 5, 4, 0, undefined, 5);
    player.ghostTurnsRemaining = 3;
    board.addPlayer(player);
    board.walls.push(
      new Wall('ghost_wall_1', 'other', 5, 4, true),
      new Wall('ghost_wall_2', 'other', 5, 5, true),
      new Wall('ghost_wall_3', 'other', 5, 6, true),
      new Wall('ghost_wall_4', 'other', 5, 7, true)
    );

    assert.ok(board.getValidMoves(player.id).some(move => move.x === 5 && move.y === 5));
    assert.strictEqual(board.movePlayer(player.id, 5, 5), true);
    assert.strictEqual(player.ghostTurnsRemaining, 2);
    assert.strictEqual(board.movePlayer(player.id, 5, 6), true);
    assert.strictEqual(player.ghostTurnsRemaining, 1);
    assert.strictEqual(board.movePlayer(player.id, 5, 7), true);
    assert.strictEqual(player.ghostTurnsRemaining, 0);
    assert.strictEqual(board.movePlayer(player.id, 5, 8), false);
  });

  it('7.12 Ghost boost pickup grants three moves and spawns on a reachable free cell', () => {
    const player = new Player('ghost_picker', 'Ghost Picker', false, 5, 5, 0, undefined, 5);
    board.addPlayer(player);

    assert.strictEqual(board.spawnGhostItem(), true);
    const boost = board.boosts.find(item => item.type === 'ghost')!;
    assert.ok(!board.grid[boost.y][boost.x].hasPlayer);
    const pathToBoost = board.findShortestPathToGoal(player.x, player.y, boost.y, boost.x);
    assert.ok(pathToBoost.length > 0);
    for (const step of pathToBoost.slice(1)) {
      assert.strictEqual(board.movePlayer(player.id, step.x, step.y), true);
    }
    assert.strictEqual(player.ghostTurnsRemaining, 3);
    assert.ok(!board.boosts.some(item => item.id === boost.id));
  });

  it('7.13 Placing a wall does not consume a ghost move', () => {
    const roomPlayers = [
      { id: 'ghost_wall_player', username: 'Ghost', isGuest: false, color: '#FF0000' },
      { id: 'ghost_wall_rival', username: 'Rival', isGuest: false, color: '#00FF00' },
      { id: 'ghost_wall_rival_2', username: 'Rival 2', isGuest: false, color: '#0000FF' },
      { id: 'ghost_wall_rival_3', username: 'Rival 3', isGuest: false, color: '#FFFF00' }
    ];
    const game = new GameInstance('ghost_wall_turn_test', '4-FFA', roomPlayers, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const player = game.board.players.get('ghost_wall_player')!;
    player.ghostTurnsRemaining = 3;

    assert.strictEqual(game.executeWall(player.id, 'ghost_wall_test', 1, 1, true), true);
    assert.strictEqual(player.ghostTurnsRemaining, 3);
    assert.notStrictEqual(game.getCurrentPlayer(), player.id);
    game.destroy();
  });

  it('7.14 GameInstance Turn & Win Condition Engine', () => {
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

  it('7.15 Inactivity kicks a player after two minutes and activity resets the deadline', () => {
    const roomPlayers = [
      { id: 'inactive_1', username: 'Player 1', isGuest: false, color: '#FF0000' },
      { id: 'inactive_2', username: 'Player 2', isGuest: false, color: '#00FF00' },
      { id: 'inactive_3', username: 'Player 3', isGuest: false, color: '#0000FF' },
      { id: 'inactive_4', username: 'Player 4', isGuest: false, color: '#FFFF00' }
    ];
    const emittedEvents: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('inactivity_test', '4-FFA', roomPlayers, (event, data) => {
      emittedEvents.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    game.recordPlayerActivity('inactive_2');
    const lastActivityAt = Date.now();
    game.checkPlayerInactivity('inactive_2', lastActivityAt + PLAYER_INACTIVITY_LIMIT_MS - 1);
    assert.ok(game.playersList.includes('inactive_2'), 'activity immediately before the deadline keeps the player in game');

    const inactivePlayer = game.board.players.get('inactive_3')!;
    game.checkPlayerInactivity('inactive_3', Date.now() + PLAYER_INACTIVITY_LIMIT_MS);
    assert.ok(!game.playersList.includes('inactive_3'), 'an inactive player is removed at the two-minute deadline');
    assert.ok(!game.board.players.has('inactive_3'));
    assert.equal(inactivePlayer.strikes, 0, 'the inactivity limit is independent of turn strikes');
    assert.equal(game.getCurrentPlayer(), 'inactive_1', 'removing an off-turn player preserves the active turn');
    const kickEvent = emittedEvents.find(({ event, data }) => event === 'playerKicked' && data.playerId === 'inactive_3');
    assert.equal(kickEvent?.data.reason, 'inactivity');
    assert.equal(kickEvent?.data.currentTurn, 'inactive_1');
    assert.ok(!kickEvent?.data.board.players.inactive_3);

    game.recordPlayerActivity('inactive_2');
    const refreshedActivityAt = Date.now();
    game.checkPlayerInactivity('inactive_2', refreshedActivityAt + PLAYER_INACTIVITY_LIMIT_MS - 1);
    assert.ok(game.playersList.includes('inactive_2'), 'new activity restarts the inactivity deadline');
    game.checkPlayerInactivity('inactive_2', Date.now() + PLAYER_INACTIVITY_LIMIT_MS);
    assert.ok(!game.playersList.includes('inactive_2'), 'the player is removed after two full minutes without further activity');
    game.destroy();
  });
});
