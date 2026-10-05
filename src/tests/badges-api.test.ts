import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Badge } from '../models/badge.entity.js';
import { Notification } from '../models/notification.entity.js';
import { UserBadge } from '../models/user-badge.entity.js';
import { BadgeService } from '../services/badge.service.js';
import { seedBadges } from '../seeds/badges.seed.js';
import { makeRequest, setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';

describe('Badge administration and player progress', () => {
  let app: any;
  let adminToken = '';
  let userId = '';
  let badgeId = '';

  before(async () => {
    app = await setupTestEnvironment();
    await seedBadges();

    const suffix = Math.floor(10000 + Math.random() * 90000);
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `badgeUser${suffix}`,
      email: `badge${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(registration.status, 201);
    userId = registration.body.user.id;

    const admin = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    assert.equal(admin.status, 200);
    adminToken = admin.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('seeds exactly 100 badges idempotently and serves the protected admin catalog', async () => {
    await seedBadges();
    assert.equal(await AppDataSource.getRepository(Badge).count(), 100);

    const response = await makeRequest(app, 'GET', '/api/admin/badges', undefined, adminToken);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.badges.length, 100);
  });

  it('validates badge rules and persists unique progress and unlock notifications', async () => {
    const locales = {
      es: { name: 'Partidas iniciales', motto: 'Cada partida cuenta.', description: 'Completa dos partidas.' },
      en: { name: 'First Matches', motto: 'Every match counts.', description: 'Complete two matches.' }
    };
    const created = await makeRequest(app, 'POST', '/api/admin/badges', {
      code: `test_badge_${Date.now()}`,
      category: 'MATCHES',
      event: 'match_played',
      target: 2,
      icon: '🧪',
      locales,
      isActive: true
    }, adminToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    badgeId = created.body.badge.id;

    const filteredCatalog = await makeRequest(
      app,
      'GET',
      '/api/admin/badges?category=MATCHES&event=match_played&active=true&search=First%20Matches',
      undefined,
      adminToken
    );
    assert.equal(filteredCatalog.status, 200, JSON.stringify(filteredCatalog.body));
    assert.ok(filteredCatalog.body.badges.some((badge: { id: string }) => badge.id === badgeId));

    const catalog = await makeRequest(app, 'GET', '/api/admin/badges', undefined, adminToken);
    const createdAtValues = catalog.body.badges.map((badge: { createdAt: string }) =>
      new Date(badge.createdAt).getTime()
    );
    assert.deepEqual(createdAtValues, [...createdAtValues].sort((a: number, b: number) => b - a));

    const mismatchedFilter = await makeRequest(
      app,
      'GET',
      '/api/admin/badges?category=BOT&event=match_played',
      undefined,
      adminToken
    );
    assert.equal(mismatchedFilter.status, 200, JSON.stringify(mismatchedFilter.body));
    assert.equal(mismatchedFilter.body.badges.length, 0);

    const invalid = await makeRequest(app, 'POST', '/api/admin/badges', {
      category: 'BOT',
      event: 'match_played',
      target: 1,
      icon: '🧪',
      locales
    }, adminToken);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'BADGE_EVENT_CATEGORY_MISMATCH');

    const badgeService = container.resolve(BadgeService);
    await badgeService.recordEvent(userId, 'match_played');
    let profile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=es`);
    let userBadge = profile.body.items.find((badge: { id: string }) => badge.id === badgeId);
    assert.equal(profile.status, 200);
    assert.equal(userBadge.progress, 1);
    assert.equal(userBadge.unlockedAt, null);

    await badgeService.recordEvent(userId, 'match_played');
    await badgeService.recordEvent(userId, 'match_played');
    profile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=en`);
    userBadge = profile.body.items.find((badge: { id: string }) => badge.id === badgeId);
    assert.equal(userBadge.name, 'First Matches');
    assert.equal(userBadge.progress, 2);
    assert.ok(userBadge.unlockedAt);

    const activeBadges = await AppDataSource.getRepository(Badge).find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
      take: 2
    });
    const earlierBadge = activeBadges.find(badge => badge.id !== badgeId);
    assert.ok(earlierBadge);
    const userBadgeRepository = AppDataSource.getRepository(UserBadge);
    const earlierUnlock = await userBadgeRepository.findOneBy({ userId, badgeId: earlierBadge.id }) ??
      userBadgeRepository.create({ userId, badgeId: earlierBadge.id, progress: earlierBadge.target });
    const currentUnlock = await userBadgeRepository.findOneBy({ userId, badgeId });
    assert.ok(currentUnlock);
    earlierUnlock.progress = earlierBadge.target;
    earlierUnlock.unlockedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    currentUnlock.unlockedAt = new Date(Date.now() - 60 * 60 * 1000);
    await userBadgeRepository.save([earlierUnlock, currentUnlock]);
    profile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=en`);
    const earnedIds = profile.body.items
      .filter((badge: { unlockedAt: string | null }) => badge.unlockedAt)
      .map((badge: { id: string }) => badge.id);
    assert.ok(earnedIds.indexOf(earlierBadge.id) < earnedIds.indexOf(badgeId));

    const notifications = await AppDataSource.getRepository(Notification).count({
      where: { user: { id: userId }, type: 'BADGE_UNLOCKED' }
    });
    assert.equal(notifications, 1);

    const summary = await makeRequest(
      app,
      'GET',
      `/api/admin/badges/summary?badgeId=${encodeURIComponent(badgeId)}`,
      undefined,
      adminToken
    );
    assert.equal(summary.status, 200);
    assert.equal(summary.body.selectedBadgeUsers, 1);
  });

  it('deletes a badge through the protected admin endpoint', async () => {
    const response = await makeRequest(
      app,
      'DELETE',
      `/api/admin/badges/${encodeURIComponent(badgeId)}`,
      undefined,
      adminToken
    );
    assert.equal(response.status, 204);
    assert.equal(await AppDataSource.getRepository(Badge).findOneBy({ id: badgeId }), null);
  });
});
