import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { container } from 'tsyringe';
import { GameLogService } from '../services/game-log.service.js';
import { IRoomPlayer } from '../services/room.service.js';

describe('14 - Match History Modes, 2v2 Team Wins & Duration Logging', () => {
  let app: any;
  let user1Token: string;
  let user1Id: string;
  let user1Name: string;
  let user2Token: string;
  let user2Id: string;
  let user2Name: string;

  before(async () => {
    app = await setupTestEnvironment();

    const rnd1 = Math.floor(10000 + Math.random() * 90000);
    const u1Reg = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `mhUserA${rnd1}`,
      email: `mha${rnd1}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(u1Reg.status, 201);
    user1Token = u1Reg.body.token;
    user1Id = u1Reg.body.user.id;
    user1Name = u1Reg.body.user.username;

    const rnd2 = Math.floor(10000 + Math.random() * 90000);
    const u2Reg = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `mhUserB${rnd2}`,
      email: `mhb${rnd2}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(u2Reg.status, 201);
    user2Token = u2Reg.body.token;
    user2Id = u2Reg.body.user.id;
    user2Name = u2Reg.body.user.username;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('14.1 Should accurately record match mode, opponentUsername, and durationSeconds in 4-FFA match', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_4FFA_${Date.now()}`;

    const players: IRoomPlayer[] = [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30' },
      { id: user2Id, username: user2Name, isGuest: false, color: '#007AFF' },
      { id: 'bot_1', username: 'Bot Master', isGuest: true, color: '#34C759' },
      { id: 'bot_2', username: 'Bot Shadow', isGuest: true, color: '#FFCC00' }
    ];

    await gameLogService.logGameEnd(matchId, user1Id, players, '4-FFA', 145);

    const historyRepo = AppDataSource.getRepository(MatchHistory);
    const h1 = await historyRepo.findOne({ where: { matchId, userId: user1Id } });

    assert.ok(h1, 'Match history for user 1 should exist');
    assert.strictEqual(h1.mode, '4-FFA');
    assert.strictEqual(h1.result, 'win');
    assert.strictEqual(h1.eloChange, 15);
    assert.strictEqual(h1.durationSeconds, 145);
    assert.ok(h1.opponentUsername?.includes(user2Name));
  });

  it('14.2 2v2 Team Win: Both team members should win and gain +10 points & +15 ELO', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_2V2_${Date.now()}`;

    // Team 1: User 1 + User 2. Team 2: Bot 1 + Bot 2.
    const players: IRoomPlayer[] = [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30', team: 1 },
      { id: user2Id, username: user2Name, isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'bot_1', username: 'Bot Alpha', isGuest: true, color: '#007AFF', team: 2 },
      { id: 'bot_2', username: 'Bot Beta', isGuest: true, color: '#007AFF', team: 2 }
    ];

    // User 1 reaches the goal, triggering win for Team 1
    await gameLogService.logGameEnd(matchId, user1Id, players, '2v2', 210);

    const historyRepo = AppDataSource.getRepository(MatchHistory);
    const h1 = await historyRepo.findOne({ where: { matchId, userId: user1Id } });
    const h2 = await historyRepo.findOne({ where: { matchId, userId: user2Id } });

    assert.ok(h1, 'User 1 match history should exist');
    assert.ok(h2, 'User 2 (teammate) match history should exist');

    assert.strictEqual(h1.mode, '2v2');
    assert.strictEqual(h1.result, 'win');
    assert.strictEqual(h1.eloChange, 15);

    // Teammate check: User 2 MUST also be marked WIN because their team won!
    assert.strictEqual(h2.mode, '2v2');
    assert.strictEqual(h2.result, 'win');
    assert.strictEqual(h2.eloChange, 15);

    // Verify stats update on user entities
    const userRepo = AppDataSource.getRepository(User);
    const u2 = await userRepo.findOne({ where: { id: user2Id }, relations: { stats: true } });
    assert.ok(u2?.stats);
    assert.ok(u2.stats.wins >= 1);
    assert.ok(u2.stats.points >= 10);
  });
});
