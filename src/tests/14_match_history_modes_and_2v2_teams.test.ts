import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { container } from 'tsyringe';
import { GameLogService } from '../services/game-log.service.js';
import { MatchHistoryRepository } from '../repositories/match-history.repository.js';
import { IRoomPlayer } from '../services/room.service.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';

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
    const userRepo = AppDataSource.getRepository(User);
    const userBefore = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });

    const players: IRoomPlayer[] = [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30' },
      { id: user2Id, username: user2Name, isGuest: false, color: '#007AFF' },
      { id: 'bot_1', username: 'Bot Master', isGuest: true, color: '#34C759' },
      { id: 'bot_2', username: 'Bot Shadow', isGuest: true, color: '#FFCC00' }
    ];

    const rewards = await gameLogService.logGameEnd(matchId, user1Id, players, '4-FFA', 145);

    const historyRepo = AppDataSource.getRepository(MatchHistory);
    const h1 = await historyRepo.findOne({ where: { matchId, userId: user1Id } });

    assert.ok(h1, 'Match history for user 1 should exist');
    assert.strictEqual(h1.mode, '4-FFA');
    assert.strictEqual(h1.result, 'win');
    assert.strictEqual(h1.durationSeconds, 145);
    assert.ok(h1.opponentUsername?.includes(user2Name));
    assert.deepStrictEqual(rewards[user1Id], { points: 0, xp: 0 });
    const userAfter = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });
    assert.strictEqual(userAfter?.stats?.wins, (userBefore?.stats?.wins ?? 0) + 1);
    assert.strictEqual(userAfter?.stats?.points, userBefore?.stats?.points ?? 0);
    assert.strictEqual(userAfter?.stats?.xp, userBefore?.stats?.xp ?? 0);
  });

  it('14.2 2v2 Team Win: Both human teammates receive a win in match history against bots', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_2V2_${Date.now()}`;
    const userRepo = AppDataSource.getRepository(User);
    const userBefore = await userRepo.findOne({ where: { id: user2Id }, relations: { stats: true } });
    const previousWins = userBefore?.stats?.wins ?? 0;
    const previousPoints = userBefore?.stats?.points ?? 0;
    const previousXp = userBefore?.stats?.xp ?? 0;

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
    // Teammate check: User 2 MUST also be marked WIN because their team won!
    assert.strictEqual(h2.mode, '2v2');
    assert.strictEqual(h2.result, 'win');
    const u2 = await userRepo.findOne({ where: { id: user2Id }, relations: { stats: true } });
    assert.ok(u2?.stats);
    assert.strictEqual(u2.stats.wins, previousWins + 1);
    assert.strictEqual(u2.stats.points, previousPoints);
    assert.strictEqual(u2.stats.xp, previousXp);
  });

  it('14.3 Mode distribution aggregates all stored modes including 6-FFA', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_6FFA_${Date.now()}`;
    const userRepo = AppDataSource.getRepository(User);
    const config = await AppDataSource.getRepository(LevelProgressionConfig).findOneByOrFail({ singletonKey: 1 });
    const user1Before = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });
    const user2Before = await userRepo.findOne({ where: { id: user2Id }, relations: { stats: true } });
    const rewards = await gameLogService.logGameEnd(matchId, user1Id, [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30' },
      { id: user2Id, username: user2Name, isGuest: false, color: '#007AFF' }
    ], '6-FFA', 180);

    const user1After = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });
    const user2After = await userRepo.findOne({ where: { id: user2Id }, relations: { stats: true } });
    assert.deepStrictEqual(rewards[user1Id], { points: config.pointsPerMatch, xp: config.baseXpPerLevel });
    assert.deepStrictEqual(rewards[user2Id], { points: 0, xp: 0 });
    assert.strictEqual(user1After?.stats?.points, (user1Before?.stats?.points ?? 0) + config.pointsPerMatch);
    assert.strictEqual(user1After?.stats?.xp, (user1Before?.stats?.xp ?? 0) + config.baseXpPerLevel);
    assert.strictEqual(user2After?.stats?.points, user2Before?.stats?.points ?? 0);
    assert.strictEqual(user2After?.stats?.xp, user2Before?.stats?.xp ?? 0);

    const distribution = await container.resolve(MatchHistoryRepository).getModeDistribution();
    assert.ok(distribution.some(row => row.mode === '6-FFA' && row.count > 0));
  });

  it('14.4 1v1 win awards the configured points and XP', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_1V1_${Date.now()}`;
    const userRepo = AppDataSource.getRepository(User);
    const config = await AppDataSource.getRepository(LevelProgressionConfig).findOneByOrFail({ singletonKey: 1 });
    const userBefore = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });

    const rewards = await gameLogService.logGameEnd(matchId, user1Id, [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30' },
      { id: user2Id, username: user2Name, isGuest: false, color: '#007AFF' }
    ], '1v1', 90);

    const userAfter = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });
    assert.deepStrictEqual(rewards[user1Id], {
      points: config.pointsPerMatch,
      xp: config.baseXpPerLevel
    });
    assert.strictEqual(userAfter?.stats?.points, (userBefore?.stats?.points ?? 0) + config.pointsPerMatch);
    assert.strictEqual(userAfter?.stats?.xp, (userBefore?.stats?.xp ?? 0) + config.baseXpPerLevel);
  });

  it('14.5 Ranked 1v1 win awards configured ranked points', async () => {
    const gameLogService = container.resolve(GameLogService);
    const matchId = `TEST_MATCH_RANKED_${Date.now()}`;
    const userRepo = AppDataSource.getRepository(User);
    const config = await AppDataSource.getRepository(LevelProgressionConfig).findOneByOrFail({ singletonKey: 1 });
    const userBefore = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });

    const rewards = await gameLogService.logGameEnd(matchId, user1Id, [
      { id: user1Id, username: user1Name, isGuest: false, color: '#FF3B30' },
      { id: user2Id, username: user2Name, isGuest: false, color: '#007AFF' }
    ], '1v1', 90, true);

    const userAfter = await userRepo.findOne({ where: { id: user1Id }, relations: { stats: true } });
    assert.deepStrictEqual(rewards[user1Id], {
      points: config.rankedPointsPerMatch,
      xp: config.baseXpPerLevel
    });
    assert.strictEqual(userAfter?.stats?.points, (userBefore?.stats?.points ?? 0) + config.rankedPointsPerMatch);
    assert.strictEqual(userAfter?.stats?.xp, (userBefore?.stats?.xp ?? 0) + config.baseXpPerLevel);
  });
});
