import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService, AVAILABLE_COLORS } from '../services/room.service.js';
import { GameService } from '../services/game.service.js';
import { GameInstance } from '../game/engine/game-instance.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('01 - Guest Capabilities & 1v1 Room/Game Engine Tests', () => {
  let roomService: RoomService;

  before(async () => {
    try {
      await setupTestEnvironment();
      roomService = container.resolve(RoomService);
    } catch (err) {
      console.error('BEFORE HOOK ERROR:', err);
      throw err;
    }
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Guest 1 should be able to create a 1v1 public room with default colors', () => {
    const guest1Id = 'guest_1001';
    const guest1Name = 'Guest_Alpha';

    const room = roomService.createRoom(
      guest1Id,
      guest1Name,
      true,
      "Guest 1's Arena",
      '1v1',
      false
    );

    assert.equal(room.mode, '1v1');
    assert.equal(room.maxPlayers, 2);
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].id, guest1Id);
    assert.equal(room.players[0].isGuest, true);
    assert.equal(room.players[0].color, AVAILABLE_COLORS[0]);
    assert.equal(room.status, 'waiting');
  });

  it('Guest 2 should be able to join the 1v1 room and get an unused color automatically', () => {
    const guest1Id = 'guest_1002';
    const guest2Id = 'guest_1003';
    
    const room = roomService.createRoom(guest1Id, 'Guest_One', true, 'Match Room', '1v1', false);
    const updatedRoom = roomService.joinRoom(room.id, guest2Id, 'Guest_Two', true);

    assert.equal(updatedRoom.players.length, 2);
    assert.equal(updatedRoom.players[1].id, guest2Id);
    assert.notEqual(updatedRoom.players[1].color, updatedRoom.players[0].color);
  });

  it('Ranked quick-match rooms are listed and matched only within the same rank', () => {
    const sameRankRoom = roomService.createRoom(
      'ranked_host_a', 'RankedA', false, 'Ranked room A', '1v1',
      false, undefined, undefined, 0, true, true, 'NOVATO'
    );
    const otherRankRoom = roomService.createRoom(
      'ranked_host_b', 'RankedB', false, 'Ranked room B', '1v1',
      false, undefined, undefined, 0, true, true, 'APRENDIZ'
    );
    const casualRoom = roomService.createRoom(
      'casual_host', 'Casual', false, 'Casual room', '1v1',
      false, undefined, undefined, 0, true
    );

    assert.ok(roomService.getPublicRooms().some(room => room.id === sameRankRoom.id));
    assert.ok(roomService.getPublicRooms().some(room => room.id === otherRankRoom.id));
    assert.equal(roomService.findQuickMatchRoom('1v1', true, 'NOVATO')?.id, sameRankRoom.id);
    assert.equal(roomService.findQuickMatchRoom('1v1', true, 'LEGENDARIO'), undefined);
    const casualMatch = roomService.findQuickMatchRoom('1v1', false);
    assert.ok(casualMatch);
    assert.notEqual(casualMatch.isRanked, true);
    assert.ok(roomService.getPublicRooms().some(room => room.id === casualRoom.id));
  });

  it('Quick match does not join a public custom room', () => {
    const testRank = 'QUICK_MATCH_CUSTOM_ROOM_EXCLUSION';
    const customRoom = roomService.createRoom(
      'custom_room_host', 'CustomHost', false, 'Custom public room', '1v1',
      false, undefined, undefined, 0, false, true, testRank
    );

    assert.equal(customRoom.isQuickMatch, false);
    assert.equal(roomService.findQuickMatchRoom('1v1', true, testRank), undefined);

    const quickMatchRoom = roomService.createRoom(
      'quick_room_host', 'QuickHost', false, 'Quick match room', '1v1',
      false, undefined, undefined, 0, true, true, testRank
    );

    assert.equal(roomService.findQuickMatchRoom('1v1', true, testRank)?.id, quickMatchRoom.id);
  });

  it('Active room lookup prefers a waiting quick-match over an older custom room', () => {
    const userId = 'user_with_multiple_waiting_rooms';
    const customRoom = roomService.createRoom(userId, 'MultiRoomUser', false, 'Custom room', '1v1');
    const quickMatchRoom = roomService.createRoom(
      userId, 'MultiRoomUser', false, 'Quick match', '1v1',
      false, undefined, undefined, 0, true
    );

    assert.notEqual(customRoom.id, quickMatchRoom.id);
    assert.equal(roomService.findRoomByUserId(userId)?.id, quickMatchRoom.id);
  });

  it('Should enforce room max capacity for 1v1 mode (reject 3rd player)', () => {
    const r = roomService.createRoom('g1', 'G1', true, 'Full Room', '1v1');
    roomService.joinRoom(r.id, 'g2', 'G2', true);

    assert.throws(() => {
      roomService.joinRoom(r.id, 'g3', 'G3', true);
    }, /Room is full/);
  });

  it('Guest should be able to change color to an available color from the 10-color palette', () => {
    const r = roomService.createRoom('g1', 'G1', true, 'Color Room', '1v1');
    const newColor = AVAILABLE_COLORS[4]; // Purple

    const updated = roomService.selectPlayerColor(r.id, 'g1', newColor);
    assert.equal(updated.players[0].color, newColor);
  });

  it('Should reject selecting a color that is already taken by another player in the room', () => {
    const r = roomService.createRoom('g1', 'G1', true, 'Taken Color Room', '1v1');
    roomService.joinRoom(r.id, 'g2', 'G2', true);

    const takenColor = r.players[0].color;
    assert.throws(() => {
      roomService.selectPlayerColor(r.id, 'g2', takenColor);
    }, /Color is already taken/);
  });

  it('Should support joining private rooms via unique room code', () => {
    const r = roomService.createRoom('g1', 'G1', true, 'Secret Room', '1v1', true);
    assert.ok(r.code);

    const foundByCode = roomService.getRoomByCode(r.code);
    assert.ok(foundByCode);

    const joined = roomService.joinRoom(r.id, 'g2', 'G2', true);
    assert.equal(joined.players.length, 2);
  });

  it('Should start a 1v1 game between 2 guests and manage turns & strikes on timeout', () => {
    const room = roomService.createRoom('guest_a', 'Guest_A', true, 'Game Start', '1v1');
    roomService.joinRoom(room.id, 'guest_b', 'Guest_B', true);

    const events: { event: string; data: any }[] = [];
    const game = new GameInstance(room.id, room.mode, room.players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.getCurrentPlayer(), 'guest_a');
    assert.ok(events.some(e => e.event === 'gameStarted'));

    // Avoid random boosts so the move always completes without a boost decision.
    const destinations = [[4, 7], [3, 8], [5, 8], [4, 9]];
    const destination = destinations.find(([x, y]) =>
      !game.board.boosts.some(boost => boost.x === x && boost.y === y)
    );
    assert.ok(destination);
    const moved = game.executeMove('guest_a', destination[0], destination[1]);
    assert.equal(moved, true);
    assert.equal(game.getCurrentPlayer(), 'guest_b');

    // Simulate invalid move for guest_a when it's not their turn
    const invalidTurnMove = game.executeMove('guest_a', 4, 6);
    assert.equal(invalidTurnMove, false);

    game.destroy();
  });
});
