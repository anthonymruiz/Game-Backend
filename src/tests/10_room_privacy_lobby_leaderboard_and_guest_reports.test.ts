import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { In } from 'typeorm';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import { AppDataSource } from '../config/database.config.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { User } from '../models/user.entity.js';
import { Stats } from '../models/stats.entity.js';
import { getUtcWeekRange } from '../utils/utc-week.util.js';

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
      true
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
      true
    );

    assert.strictEqual(room.isPrivate, true);

    // Host toggles privacy to Public
    const updatedPublic = roomService.toggleRoomPrivacy(room.id, normalUserId, false);
    assert.strictEqual(updatedPublic.isPrivate, false);

    // Public room should now be listed in getPublicRooms
    const publicRooms = roomService.getPublicRooms();
    assert.ok(publicRooms.some(r => r.id === room.id));

    // Host toggles privacy back to Private
    const updatedPrivate = roomService.toggleRoomPrivacy(room.id, normalUserId, true);
    assert.strictEqual(updatedPrivate.isPrivate, true);
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
    // Normal user attempts to report unregistered guest (should reject with 400 as guest is not in DB)
    const repGuest = await makeRequest(app, 'POST', '/api/reports', {
      reportedUserId: guestUserId,
      category: 'harassment',
      details: 'Guest user used abusive chat messages'
    }, normalToken);

    assert.strictEqual(repGuest.status, 400);

    // Guest user attempts to report normal user (should reject with 403 as guests cannot report)
    const repUser = await makeRequest(app, 'POST', '/api/reports', {
      reportedUserId: normalUserId,
      category: 'cheating',
      details: 'Normal user left game intentionally'
    }, guestToken);

    assert.strictEqual(repUser.status, 403);
  });

  it('10.5 Top 100 Leaderboard API returns player ranks, win rates, tiers & levels', async () => {
    const lbRes = await makeRequest(app, 'GET', '/api/users/leaderboard');
    assert.strictEqual(lbRes.status, 200);
    assert.ok(Array.isArray(lbRes.body.leaderboard));
    assert.ok(lbRes.body.leaderboard.length <= 100);
    assert.ok(Array.isArray(lbRes.body.ranks));
    assert.ok(lbRes.body.ranks.every((rank: { minXp: number; maxXp: number }) =>
      Number.isInteger(rank.minXp) && Number.isInteger(rank.maxXp)
    ));

    if (lbRes.body.leaderboard.length > 0) {
      const topPlayer = lbRes.body.leaderboard[0];
      assert.ok(topPlayer.rank >= 1);
      assert.ok(topPlayer.username);
      assert.ok(['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'].includes(topPlayer.tier));
      assert.ok(Number.isInteger(topPlayer.level) && topPlayer.level >= 1 && topPlayer.level <= 100);
      assert.ok(topPlayer.rankInfo.rankKey);
      assert.equal(topPlayer.rankInfo.xp, topPlayer.xp);
      assert.ok(lbRes.body.leaderboard.every((player: { wins: number }, index: number, players: { wins: number }[]) =>
        index === 0 || players[index - 1].wins >= player.wins
      ));

      const filtered = await makeRequest(
        app,
        'GET',
        `/api/users/leaderboard?rankKey=${encodeURIComponent(topPlayer.rankInfo.rankKey)}`
      );
      assert.strictEqual(filtered.status, 200);
      assert.ok(filtered.body.leaderboard.length <= 100);
      assert.ok(filtered.body.leaderboard.every((player: { rankInfo: { rankKey: string } }) =>
        player.rankInfo.rankKey === topPlayer.rankInfo.rankKey
      ));
    }
  });

  it('10.6 Leaderboard groups match results by winning player for today and all history', async () => {
    const repository = AppDataSource.getRepository(MatchHistory);
    const userRepository = AppDataSource.getRepository(User);
    const statsRepository = AppDataSource.getRepository(Stats);
    const prefix = `leaderboard-period-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secondRegistration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `tieUser${Math.floor(Math.random() * 1000000)}`,
      email: `tie-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(secondRegistration.status, 201);
    const secondUserId = secondRegistration.body.user.id as string;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayWins = Array.from({ length: 200 }, (_, index) => repository.create({
      userId: normalUserId,
      matchId: `${prefix}-today-${index}`,
      mode: '1v1',
      result: 'win',
      xpAwarded: 7,
      createdAt: new Date(todayStart.getTime() + 60_000 + index)
    }));
    const todayLoss = repository.create({
      userId: normalUserId,
      matchId: `${prefix}-today-loss`,
      mode: '1v1',
      result: 'loss',
      createdAt: new Date(todayStart.getTime() + 120_000)
    });
    const previousWin = repository.create({
      userId: normalUserId,
      matchId: `${prefix}-previous`,
      mode: '1v1',
      result: 'win',
      createdAt: new Date(todayStart.getTime() - 1)
    });
    const tiedTodayWins = Array.from({ length: 200 }, (_, index) => repository.create({
      userId: secondUserId,
      matchId: `${prefix}-tied-today-${index}`,
      mode: '1v1',
      result: 'win',
      xpAwarded: 4,
      createdAt: new Date(todayStart.getTime() + 60_000 + index)
    }));
    const { start: weekStart, end: weekEnd } = getUtcWeekRange(now);
    const weeklyOnlyWin = repository.create({
      userId: secondUserId,
      matchId: `${prefix}-weekly-only`,
      mode: '1v1',
      result: 'win',
      xpAwarded: 11,
      createdAt: new Date(weekStart.getTime() + 1)
    });
    const weekMatches = [...tiedTodayWins, weeklyOnlyWin].filter(match =>
      match.createdAt >= weekStart && match.createdAt < weekEnd
    );
    const expectedWeeklyXp = weekMatches.reduce((total, match) => total + match.xpAwarded, 0);
    const matchIds = [...todayWins, todayLoss, previousWin, ...tiedTodayWins, weeklyOnlyWin].map(match => match.matchId);
    const normalUser = await userRepository.findOne({ where: { id: normalUserId }, relations: { stats: true } });
    const secondUser = await userRepository.findOne({ where: { id: secondUserId }, relations: { stats: true } });
    assert.ok(normalUser?.stats);
    assert.ok(secondUser?.stats);
    const previousNormalWins = normalUser.stats.wins;
    normalUser.stats.wins = 10;
    secondUser.stats.wins = 20;
    secondUser.avatarUrl = 'https://example.test/leaderboard-avatar.png';

    try {
      await Promise.all([
        statsRepository.save([normalUser.stats, secondUser.stats]),
        userRepository.save(secondUser)
      ]);
      await repository.insert([...todayWins, todayLoss, previousWin, ...tiedTodayWins, weeklyOnlyWin]);

      const today = await makeRequest(app, 'GET', '/api/users/leaderboard?period=today');
      assert.strictEqual(today.status, 200);
      const todayPlayer = today.body.leaderboard.find((player: { id: string }) => player.id === normalUserId);
      assert.ok(todayPlayer);
      assert.equal(todayPlayer.wins, 200);
      assert.equal(todayPlayer.losses, 1);
      assert.equal(todayPlayer.totalGames, 201);
      const secondTodayPlayer = today.body.leaderboard.find((player: { id: string }) => player.id === secondUserId);
      assert.ok(secondTodayPlayer);
      assert.equal(secondTodayPlayer.wins, 200);
      assert.equal(secondTodayPlayer.periodXp, 800);
      assert.equal(secondTodayPlayer.avatarUrl, 'https://example.test/leaderboard-avatar.png');
      assert.ok(today.body.leaderboard.findIndex((player: { id: string }) => player.id === secondUserId) <
        today.body.leaderboard.findIndex((player: { id: string }) => player.id === normalUserId));

      const weekly = await makeRequest(app, 'GET', '/api/users/leaderboard?period=weekly');
      assert.strictEqual(weekly.status, 200);
      const secondWeeklyPlayer = weekly.body.leaderboard.find((player: { id: string }) => player.id === secondUserId);
      assert.ok(secondWeeklyPlayer);
      assert.equal(secondWeeklyPlayer.periodXp, expectedWeeklyXp);

      const history = await makeRequest(app, 'GET', '/api/users/leaderboard?period=history');
      assert.strictEqual(history.status, 200);
      const historyPlayer = history.body.leaderboard.find((player: { id: string }) => player.id === normalUserId);
      assert.ok(historyPlayer);
      assert.equal(historyPlayer.wins, 201);
      assert.equal(historyPlayer.totalGames, 202);

      const invalidPeriod = await makeRequest(app, 'GET', '/api/users/leaderboard?period=week');
      assert.strictEqual(invalidPeriod.status, 400);
    } finally {
      await repository.delete({ matchId: In(matchIds) });
      normalUser.stats.wins = previousNormalWins;
      await statsRepository.save(normalUser.stats);
      await userRepository.delete(secondUserId);
      await statsRepository.delete(secondUser.stats.id);
    }
  });
});
