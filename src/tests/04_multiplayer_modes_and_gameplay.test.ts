import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import { GameInstance } from '../game/engine/game-instance.js';

describe('04 - Multiplayer Modes (4-FFA, 2v2) & Core Game Mechanics Tests', () => {
  let roomService: RoomService;

  before(async () => {
    await setupTestEnvironment();
    roomService = container.resolve(RoomService);
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Should correctly initialize a 4-FFA (Free-For-All) room with 4 players on 4 borders', () => {
    const room = roomService.createRoom('p1', 'Player1', false, 'FFA Room', '4-FFA');
    roomService.joinRoom(room.id, 'p2', 'Player2', false);
    roomService.joinRoom(room.id, 'p3', 'Player3', true);
    roomService.joinRoom(room.id, 'p4', 'Player4', true);

    assert.equal(room.players.length, 4);
    assert.equal(room.maxPlayers, 4);

    const game = new GameInstance(room.id, room.mode, room.players, () => {});
    game.start();

    assert.equal(game.board.players.size, 4);
    // Player 1 at top (5, 0), Player 2 at bottom (5, 10), Player 3 at left (0, 5), Player 4 at right (10, 5)
    const p1 = game.board.players.get('p1');
    const p2 = game.board.players.get('p2');
    const p3 = game.board.players.get('p3');
    const p4 = game.board.players.get('p4');

    assert.deepEqual({ x: p1?.x, y: p1?.y }, { x: 5, y: 10 });
    assert.deepEqual({ x: p2?.x, y: p2?.y }, { x: 5, y: 0 });
    assert.deepEqual({ x: p3?.x, y: p3?.y }, { x: 0, y: 5 });
    assert.deepEqual({ x: p4?.x, y: p4?.y }, { x: 10, y: 5 });

    // Each player in 4-FFA starts with 5 walls
    assert.equal(p1?.wallsLeft, 5);
    assert.equal(p2?.wallsLeft, 5);

    game.destroy();
  });

  it('Should correctly set up a 2v2 Team mode with 2 balanced teams', () => {
    const room = roomService.createRoom('t1', 'User_T1', false, '2v2 Arena', '2v2');
    roomService.joinRoom(room.id, 't2', 'Guest_T2', true);
    roomService.joinRoom(room.id, 't3', 'User_T3', false);
    roomService.joinRoom(room.id, 't4', 'Guest_T4', true);

    assert.equal(room.players.length, 4);
    assert.equal(room.players[0].team, 1);
    assert.equal(room.players[1].team, 2);
    assert.equal(room.players[2].team, 1);
    assert.equal(room.players[3].team, 2);

    const game = new GameInstance(room.id, room.mode, room.players, () => {});
    game.start();
    assert.equal(game.state, 'playing');
    game.destroy();
  });

  it('Should execute valid wall placement and prevent overlapping walls', () => {
    const room = roomService.createRoom('p1', 'Player1', true, 'Wall Room', '1v1');
    roomService.joinRoom(room.id, 'p2', 'Player2', true);

    const game = new GameInstance(room.id, room.mode, room.players, () => {});
    game.start();

    // Player 1 places a horizontal wall at (2, 2)
    const wall1Success = game.executeWall('p1', 'wall1', 2, 2, true);
    assert.equal(wall1Success, true);

    // Player 2 attempts to place an overlapping wall at (2, 2)
    const wall2Overlap = game.executeWall('p2', 'wall2', 2, 2, true);
    assert.equal(wall2Overlap, false);

    game.destroy();
  });

  it('Should allow spawning random extra wall boosts on the board', () => {
    const room = roomService.createRoom('p1', 'Player1', true, 'Boost Room', '1v1');
    roomService.joinRoom(room.id, 'p2', 'Player2', true);

    const game = new GameInstance(room.id, room.mode, room.players, () => {});
    game.start();

    game.board.spawnRandomBoost();
    assert.ok(game.board.boosts.length >= 1);

    game.destroy();
  });
});
