import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { Application } from 'express';
import { container } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { MatchHistoryRepository } from '../repositories/match-history.repository.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { PresenceStatus } from '../models/presence.enum.js';

describe('06 - User Presence, Chat Translations & Match History Tests', () => {
  let app: Application;
  let adminToken: string;
  let userId: string;

  const randNum = Math.floor(10000 + Math.random() * 90000);
  const username = `chatuser${randNum}`;

  before(async () => {
    app = await setupTestEnvironment();

    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username,
      email: `${username}@example.com`,
      password: 'Password123!'
    });
    userId = regRes.body.user.id;

    const adminRes = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    adminToken = adminRes.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Should update user presence status between online, playing, idle, and offline', async () => {
    const userRepo = container.resolve(UserRepository);
    const user = await userRepo.findById(userId);
    assert.ok(user);

    user.presenceStatus = PresenceStatus.PLAYING;
    user.isOnline = true;
    await userRepo.save(user);

    const check1 = await userRepo.findById(userId);
    assert.equal(check1?.presenceStatus, PresenceStatus.PLAYING);
    assert.equal(check1?.isOnline, true);

    user.presenceStatus = PresenceStatus.IDLE;
    await userRepo.save(user);

    const check2 = await userRepo.findById(userId);
    assert.equal(check2?.presenceStatus, PresenceStatus.IDLE);
  });

  it('Should persist finished match history in database and allow admin querying', async () => {
    const matchRepo = container.resolve(MatchHistoryRepository);
    const userRepo = container.resolve(UserRepository);
    const user = await userRepo.findById(userId);

    const historyItem = new MatchHistory();
    historyItem.user = user;
    historyItem.userId = userId;
    historyItem.matchId = `match_${Date.now()}`;
    historyItem.mode = '1v1';
    historyItem.result = 'win';
    historyItem.opponentUsername = 'Guest_Opponent';
    historyItem.durationSeconds = 145;
    historyItem.eloChange = 25;

    await matchRepo.save(historyItem);

    const res = await makeRequest(app, 'GET', '/api/admin/matches?limit=10', undefined, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 1);
  });
});
