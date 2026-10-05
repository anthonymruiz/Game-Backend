import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Badge } from '../models/badge.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Stats } from '../models/stats.entity.js';
import { User } from '../models/user.entity.js';
import { Notification } from '../models/notification.entity.js';
import { UserBadge } from '../models/user-badge.entity.js';
import { BadgeService } from '../services/badge.service.js';
import { GameLogService } from '../services/game-log.service.js';
import { StoreItemService } from '../services/store-item.service.js';
import { WeeklyRewardsService } from '../services/weekly-rewards.service.js';
import { getDefaultBadges, seedBadges } from '../seeds/badges.seed.js';
import { getUtcWeekRange } from '../utils/utc-week.util.js';
import { makeRequest, setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';

describe('Badge administration and player progress', () => {
  let app: any;
  let adminToken = '';
  let userToken = '';
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
    userToken = registration.body.token;

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

  it('unlocks every seeded badge at its own event threshold and not before it', async () => {
    const suffix = Math.floor(10000 + Math.random() * 90000);
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `allBadges${suffix}`,
      email: `allBadges${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(registration.status, 201);
    const testUserId = registration.body.user.id as string;

    const definitions = getDefaultBadges();
    const repository = AppDataSource.getRepository(Badge);
    const seededBadges = await repository.find({
      where: definitions.map(({ code }) => ({ code }))
    });
    assert.equal(seededBadges.length, 100);
    const previousActiveStates = new Map(seededBadges.map(badge => [badge.id, badge.isActive]));
    const seededByCode = new Map(seededBadges.map(badge => [badge.code, badge]));
    const definitionsByEvent = new Map<typeof definitions[number]['event'], typeof definitions>();
    for (const badge of definitions) {
      const eventBadges = definitionsByEvent.get(badge.event) ?? [];
      eventBadges.push(badge);
      definitionsByEvent.set(badge.event, eventBadges);
    }
    try {
      await repository.save(seededBadges.map(badge => {
        badge.isActive = true;
        return badge;
      }));
      const badgeService = container.resolve(BadgeService);
      for (const [event, eventBadges] of definitionsByEvent) {
        let progress = 0;
        const thresholds = [...new Set(eventBadges.map(badge => badge.target))].sort((a, b) => a - b);
        for (const threshold of thresholds) {
          const belowThreshold = threshold - 1;
          if (belowThreshold > progress) {
            await badgeService.recordEvent(testUserId, event, belowThreshold - progress);
            progress = belowThreshold;
          }

          let userBadges = await AppDataSource.getRepository(UserBadge).findBy({ userId: testUserId });
          const unlockedAtThreshold = new Set(userBadges.filter(userBadge => userBadge.unlockedAt)
            .map(userBadge => userBadge.badgeId));
          for (const badge of eventBadges) {
            const seeded = seededByCode.get(badge.code);
            assert.ok(seeded, `Seeded badge ${badge.code} was not persisted`);
            if (badge.target >= threshold) {
              assert.ok(
                !unlockedAtThreshold.has(seeded.id),
                `${badge.code} unlocked before target ${badge.target}`
              );
            }
          }

          await badgeService.recordEvent(testUserId, event);
          progress++;
          userBadges = await AppDataSource.getRepository(UserBadge).findBy({ userId: testUserId });
          const unlockedBadgeIds = new Set(userBadges.filter(userBadge => userBadge.unlockedAt)
            .map(userBadge => userBadge.badgeId));
          for (const badge of eventBadges) {
            const seeded = seededByCode.get(badge.code);
            assert.ok(seeded, `Seeded badge ${badge.code} was not persisted`);
            assert.equal(
              unlockedBadgeIds.has(seeded.id),
              badge.target <= threshold,
              `${badge.code} did not match its target ${badge.target} at progress ${threshold}`
            );
          }
        }
      }

      const userBadges = await AppDataSource.getRepository(UserBadge).findBy({ userId: testUserId });
      assert.equal(userBadges.filter(userBadge => userBadge.unlockedAt).length, 100);
      assert.equal(
        await AppDataSource.getRepository(Notification).count({
          where: { user: { id: testUserId }, type: 'BADGE_UNLOCKED' }
        }),
        100
      );
    } finally {
      await repository.save(seededBadges.map(badge => {
        badge.isActive = previousActiveStates.get(badge.id) ?? badge.isActive;
        return badge;
      }));
    }
  });

  it('refreshes names for existing seed badges without replacing other edits', async () => {
    const repository = AppDataSource.getRepository(Badge);
    const seededBadge = await repository.findOneByOrFail({ code: 'bot_win' });
    seededBadge.locales.es.name = 'Nombre antiguo';
    seededBadge.locales.es.motto = 'Lema personalizado';
    seededBadge.isActive = false;
    await repository.save(seededBadge);

    await seedBadges();

    const refreshedBadge = await repository.findOneByOrFail({ code: 'bot_win' });
    assert.equal(refreshedBadge.locales.es.name, 'Primer bot derrotado');
    assert.equal(refreshedBadge.locales.es.motto, 'Lema personalizado');
    assert.equal(refreshedBadge.isActive, false);
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

  it('awards friend and store badges from the authenticated HTTP endpoints', async () => {
    const suffix = Math.floor(10000 + Math.random() * 90000);
    const friendRegistration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `badgeFriend${suffix}`,
      email: `badgeFriend${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(friendRegistration.status, 201);

    const friendshipRequest = await makeRequest(
      app,
      'POST',
      `/api/friends/request/${friendRegistration.body.user.id}`,
      undefined,
      userToken
    );
    assert.equal(friendshipRequest.status, 200, JSON.stringify(friendshipRequest.body));
    const friendAcceptance = await makeRequest(
      app,
      'POST',
      `/api/friends/accept/${friendshipRequest.body.friendship.id}`,
      undefined,
      friendRegistration.body.token
    );
    assert.equal(friendAcceptance.status, 200, JSON.stringify(friendAcceptance.body));

    const userBadgeProfile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=en`);
    const friendBadge = userBadgeProfile.body.items.find((badge: { code: string }) => badge.code === 'first_friend');
    assert.ok(friendBadge?.unlockedAt, 'Accepting a friend through the API should award friend_added');

    await container.resolve(StoreItemService).seedDefaultItems();
    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { stats: true }
    });
    assert.ok(user?.stats);
    user.stats.points = 10_000;
    await AppDataSource.getRepository(Stats).save(user.stats);
    const catalog = await makeRequest(app, 'GET', '/api/store/items');
    assert.equal(catalog.status, 200);
    const item = catalog.body.items.find((storeItem: { pricePoints: number }) => storeItem.pricePoints <= 10_000);
    assert.ok(item, 'Expected a purchasable store item');
    const purchase = await makeRequest(
      app,
      'POST',
      `/api/store/items/${item.id}/obtain`,
      {},
      userToken
    );
    assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
    const storeBadgeProfile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=en`);
    const storeBadge = storeBadgeProfile.body.items.find(
      (badge: { code: string }) => badge.code === 'challenge_store_purchase_1'
    );
    assert.ok(storeBadge?.unlockedAt, 'Purchasing through the API should award store_purchase');
  });

  it('awards match, mode, bot, and streak badges from completed match results', async () => {
    const modes = [
      { mode: '1v1', event: 'win_1v1', otherCount: 1 },
      { mode: '2v2', event: 'win_2v2', otherCount: 3 },
      { mode: '4-FFA', event: 'win_4ffa', otherCount: 3 },
      { mode: '6-FFA', event: 'win_6ffa', otherCount: 5 }
    ] as const;
    const gameLogService = container.resolve(GameLogService);

    for (const { mode, event, otherCount } of modes) {
      const suffix = Math.floor(10000 + Math.random() * 90000);
      const registration = await makeRequest(app, 'POST', '/api/auth/register', {
        username: `matchBadge${suffix}`,
        email: `matchBadge${suffix}@test.com`,
        password: 'Password123!'
      });
      assert.equal(registration.status, 201);
      const matchUserId = registration.body.user.id as string;
      const matchingBadges = await AppDataSource.getRepository(Badge).find({
        where: [{ event: 'match_played' }, { event: 'match_win' }, { event }]
      });
      await AppDataSource.getRepository(Badge).save(matchingBadges.map(badge => {
        badge.isActive = true;
        return badge;
      }));
      await AppDataSource.getRepository(UserBadge).save(matchingBadges.map(badge => ({
        userId: matchUserId,
        badgeId: badge.id,
        progress: badge.target - 1,
        unlockedAt: null
      })));

      const players: Array<{
        id: string;
        username: string;
        isGuest: boolean;
        color: string;
        team?: number;
      }> = [{
        id: matchUserId,
        username: registration.body.user.username,
        isGuest: false,
        color: '#FF3B30',
        ...(mode === '2v2' ? { team: 1 } : {})
      }];
      for (let index = 0; index < otherCount; index++) {
        players.push({
          id: `guest_badge_${suffix}_${index}`,
          username: `Guest${index}`,
          isGuest: true,
          color: '#007AFF',
          ...(mode === '2v2' ? { team: index % 2 === 0 ? 2 : 1 } : {})
        });
      }
      await gameLogService.logGameEnd(`badge-match-${suffix}`, matchUserId, players, mode);

      const unlocked = await AppDataSource.getRepository(UserBadge).findBy({ userId: matchUserId });
      for (const badge of matchingBadges) {
        assert.ok(
          unlocked.find(userBadge => userBadge.badgeId === badge.id)?.unlockedAt,
          `Completing a ${mode} win should emit ${badge.event} for ${badge.code}`
        );
      }
    }

    const suffix = Math.floor(10000 + Math.random() * 90000);
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `botBadge${suffix}`,
      email: `botBadge${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(registration.status, 201);
    const botMatchUserId = registration.body.user.id as string;
    const botBadges = await AppDataSource.getRepository(Badge).find({
      where: [{ event: 'match_played' }, { event: 'match_win' }, { event: 'win_1v1' }, { event: 'bot_win' }]
    });
    await AppDataSource.getRepository(Badge).save(botBadges.map(badge => {
      badge.isActive = true;
      return badge;
    }));
    await AppDataSource.getRepository(UserBadge).save(botBadges.map(badge => ({
      userId: botMatchUserId,
      badgeId: badge.id,
      progress: badge.target - 1,
      unlockedAt: null
    })));
    await gameLogService.logGameEnd(`badge-bot-match-${suffix}`, botMatchUserId, [
      { id: botMatchUserId, username: registration.body.user.username, isGuest: false, color: '#FF3B30' },
      { id: `bot_badge_${suffix}`, username: 'BOT', isGuest: true, isBot: true, color: '#007AFF' }
    ], '1v1');
    const botMatchBadges = await AppDataSource.getRepository(UserBadge).findBy({ userId: botMatchUserId });
    for (const badge of botBadges) {
      assert.ok(
        botMatchBadges.find(userBadge => userBadge.badgeId === badge.id)?.unlockedAt,
        `Winning against a bot should emit ${badge.event} for ${badge.code}`
      );
    }
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

  it('counts each spectator and spectated match only once, including reconnects', async () => {
    const badgeService = container.resolve(BadgeService);
    const roomId = `spectator-test-${Date.now()}`;
    await badgeService.recordEventOnce(userId, 'spectate', roomId);
    await badgeService.recordEventOnce(userId, 'spectate', roomId);

    const profile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=en`);
    const spectatorBadge = profile.body.items.find((badge: { code: string }) => badge.code === 'spectate_1');
    assert.equal(spectatorBadge.progress, 1);
    assert.ok(spectatorBadge.unlockedAt);
    assert.equal(await AppDataSource.getRepository(UserBadge).count({
      where: { userId, badge: { event: 'spectate' } }
    }), 2);
  });

  it('unlocks first, second, and third weekly placement badges through transactional events', async () => {
    const badgeService = container.resolve(BadgeService);
    const placementEvents = [
      'weekly_first_place',
      'weekly_second_place',
      'weekly_third_place'
    ] as const;
    const result = await AppDataSource.transaction(async manager => {
      const unlocks: import('../services/badge.service.js').IBadgeUnlockBatch[] = [];
      for (const event of placementEvents) {
        unlocks.push(await badgeService.recordEventsInTransaction(manager, userId, [{ event }]));
      }
      return unlocks;
    });

    const profile = await makeRequest(app, 'GET', `/api/users/${userId}/badges?language=es`);
    for (const event of placementEvents) {
      const badge = profile.body.items.find((item: { code: string }) => item.code === `challenge_${event}_1`);
      assert.ok(badge?.unlockedAt, `Expected ${event} to unlock`);
    }
    assert.equal(result.flatMap(batch => batch.badges).length, 3);
  });

  it('awards the weekly winner from persisted results and does not pay the same week twice', async () => {
    const suffix = Math.floor(10000 + Math.random() * 90000);
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `weeklyBadge${suffix}`,
      email: `weeklyBadge${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(registration.status, 201);
    const winnerId = registration.body.user.id;

    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 30);
    future.setUTCDate(future.getUTCDate() + Math.floor(Math.random() * 100_000) * 7);
    const { start: currentWeekStart } = getUtcWeekRange(future);
    const now = new Date(currentWeekStart.getTime() + 24 * 60 * 60 * 1000);
    const playedAt = new Date(currentWeekStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    await AppDataSource.getRepository(MatchHistory).save(
      AppDataSource.getRepository(MatchHistory).create({
        userId: winnerId,
        matchId: `weekly-badge-${suffix}`,
        result: 'win',
        mode: '1v1',
        createdAt: playedAt
      })
    );

    const rewards = container.resolve(WeeklyRewardsService);
    assert.equal(await rewards.payMostRecentCompletedWeek(now), true);
    assert.equal(await rewards.payMostRecentCompletedWeek(now), false);
    const profile = await makeRequest(app, 'GET', `/api/users/${winnerId}/badges?language=en`);
    const firstPlace = profile.body.items.find((badge: { code: string }) =>
      badge.code === 'challenge_weekly_first_place_1'
    );
    assert.ok(firstPlace?.unlockedAt);
  });

  it('retires old store-redemption progress instead of converting it into a weekly placement', async () => {
    const suffix = Math.floor(10000 + Math.random() * 90000);
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `retiredBadge${suffix}`,
      email: `retiredBadge${suffix}@test.com`,
      password: 'Password123!'
    });
    assert.equal(registration.status, 201);
    const retiredUserId = registration.body.user.id;
    const badgeRepository = AppDataSource.getRepository(Badge);
    const legacy = await badgeRepository.save(badgeRepository.create({
      code: 'challenge_store_redeem_1',
      category: 'STORE_PURCHASES',
      event: 'store_purchase',
      target: 1,
      icon: '🎁',
      locales: {
        es: { name: 'Canje inaugural', motto: 'Old', description: 'Old' },
        en: { name: 'First Redemption', motto: 'Old', description: 'Old' }
      },
      isActive: true
    }));
    await AppDataSource.getRepository(UserBadge).save({
      userId: retiredUserId,
      badgeId: legacy.id,
      progress: 1,
      unlockedAt: new Date()
    });

    await seedBadges();

    assert.equal(await badgeRepository.findOneBy({ code: legacy.code }), null);
    const weeklyBadge = await badgeRepository.findOneByOrFail({ code: 'challenge_weekly_first_place_1' });
    assert.equal(await AppDataSource.getRepository(UserBadge).findOneBy({
      userId: retiredUserId,
      badgeId: weeklyBadge.id
    }), null);
    assert.equal(await badgeRepository.count(), 100);
  });

});
