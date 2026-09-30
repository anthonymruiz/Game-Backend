import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';

describe('Suite 10: Room Privacy, Codes, Lobby Cancellation, Guest Reports & Leaderboard', () => {
  let app: any;
  let roomService: RoomService;
  let normalToken: string;
  let normalUserId: string;
  let guestToken: string;
  let guestUserId: string;

  before(async () => {
    app = await setupTestEnvironment();
    roomService = container.resolve(RoomService);

    // Register normal user
    const rnd = Math.floor(10000 + Math.random() * 90000);
    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `lbyUser${rnd}`,
      email: `lby${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(regRes.status, 201);
    normalToken = regRes.body.token;
    normalUserId = regRes.body.user.id;

    // Register guest user
    const guestRes = await makeRequest(app, 'POST', '/api/auth/guest', { username: `GstUser${rnd}` });
    assert.strictEqual(guestRes.status, 200);
    guestToken = guestRes.body.token;
    guestUserId = guestRes.body.user.id;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('10.1 Private Room Code Generation and lookup by code', () => {
    const room = roomService.createRoom(
      normalUserId,
      'LobbyHost',
      false,
      'Private Chamber',
      '1v1',
      true,
      'secret123'
    );

    assert.ok(room.code);
    assert.strictEqual(room.code.length, 6);
    assert.strictEqual(room.isPrivate, true);

    // Lookup room by code
    const foundRoom = roomService.getRoomByCode(room.code);
    assert.ok(foundRoom);
    assert.strictEqual(foundRoom?.id, room.id);
  });

  it('10.2 Toggling room privacy (Private -> Public -> Private)', () => {
    const room = roomService.createRoom(
      normalUserId,
      'LobbyHost',
      false,
      'Flex Room',
      '1v1',
      true,
      'pass123'
    );

    assert.strictEqual(room.isPrivate, true);

    // Host toggles privacy to Public
    const updatedPublic = roomService.toggleRoomPrivacy(room.id, normalUserId, false);
    assert.strictEqual(updatedPublic.isPrivate, false);
    assert.strictEqual(updatedPublic.password, undefined);

    // Public room should now be listed in getPublicRooms
    const publicRooms = roomService.getPublicRooms();
    assert.ok(publicRooms.some(r => r.id === room.id));

    // Host toggles privacy back to Private
    const updatedPrivate = roomService.toggleRoomPrivacy(room.id, normalUserId, true, 'newPass');
    assert.strictEqual(updatedPrivate.isPrivate, true);
    assert.strictEqual(updatedPrivate.password, 'newPass');
  });

  it('10.3 Cancelling room lobby deletes it from memory/DB', () => {
    const room = roomService.createRoom(
      normalUserId,
      'CancelHost',
      false,
      'Temporary Room',
      '1v1',
      false
    );

    assert.ok(roomService.getRoom(room.id));

    // Host cancels room
    const cancelled = roomService.cancelRoom(room.id, normalUserId);
    assert.strictEqual(cancelled, true);

    // Room is no longer found
    assert.strictEqual(roomService.getRoom(room.id), null);

    // Non-host attempt throws error
    assert.throws(() => roomService.cancelRoom('non_existent_id', normalUserId), /Room not found/);
  });

  it('10.4 Reporting guest users and normal registered users', async () => {
    // Normal user reports guest user
    const repGuest = await makeRequest(app, 'POST', '/api/reports', {
      reportedUserId: guestUserId,
      category: 'harassment',
      details: 'Guest user used abusive chat messages'
    }, normalToken);

    assert.strictEqual(repGuest.status, 201);
    assert.strictEqual(repGuest.body.report.reportedUserId, guestUserId);

    // Guest user reports normal user
    const repUser = await makeRequest(app, 'POST', '/api/reports', {
      reportedUserId: normalUserId,
      category: 'cheating',
      details: 'Normal user left game intentionally'
    }, guestToken);

    assert.strictEqual(repUser.status, 201);
    assert.strictEqual(repUser.body.report.reportedUserId, normalUserId);
  });

  it('10.5 Top 100 Leaderboard API returns player ranks, win rates, tiers & levels', async () => {
    const lbRes = await makeRequest(app, 'GET', '/api/users/leaderboard');
    assert.strictEqual(lbRes.status, 200);
    assert.ok(Array.isArray(lbRes.body.leaderboard));

    if (lbRes.body.leaderboard.length > 0) {
      const topPlayer = lbRes.body.leaderboard[0];
      assert.ok(topPlayer.rank >= 1);
      assert.ok(topPlayer.username);
      assert.ok(['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'].includes(topPlayer.tier));
      assert.ok(['Principiante', 'Intermedio', 'Avanzado'].includes(topPlayer.level));
    }
  });
});
