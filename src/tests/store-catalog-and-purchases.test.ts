import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { Stats } from '../models/stats.entity.js';
import { StoreItemCategory } from '../models/store-item.enum.js';
import { DEFAULT_STORE_ITEMS } from '../seeds/store-items.seed.js';
import { PointPackageService } from '../services/point-package.service.js';
import { PointPackage } from '../models/point-package.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { Preferences } from '../models/preferences.entity.js';

describe('Store catalog categories, inventory and purchases', () => {
  let app: any;
  let token: string;
  let userId: string;
  let adminToken: string;

  before(async () => {
    app = await setupTestEnvironment();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `store${suffix}`.slice(0, 20),
      email: `store${suffix}@test.com`,
      password: 'password123'
    });
    assert.equal(registration.status, 201);
    token = registration.body.token;
    userId = registration.body.user.id;
    const adminLogin = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('stores color products separately from skins in the default catalog and enum', async () => {
    assert.equal(StoreItemCategory.PAWN_COLOR, 'PAWN_COLOR');
    const colorSeeds = DEFAULT_STORE_ITEMS.filter(item => item.category === StoreItemCategory.PAWN_COLOR);
    const skinSeeds = DEFAULT_STORE_ITEMS.filter(item => item.category === StoreItemCategory.PAWN_SKIN);
    const commonItems = DEFAULT_STORE_ITEMS.filter(item => item.rarity === 'COMMON');

    assert.ok(commonItems.length > 0);
    assert.ok(commonItems.every(item => item.pricePoints === 100));
    assert.equal(colorSeeds.length, 11);
    assert.ok(skinSeeds.length > 0);
    assert.ok(colorSeeds.every(item => item.code.startsWith('PWN-')));
    assert.ok(skinSeeds.every(item => item.code.startsWith('SKN-')));
    assert.ok(colorSeeds.every(item => {
      const config = item.configuration as { es: { name: string }; en: { name: string } };
      return !/^Color\s/i.test(config.es.name)
        && !/\p{Extended_Pictographic}/u.test(config.es.name)
        && !/\bColor$/i.test(config.en.name)
        && !/\p{Extended_Pictographic}/u.test(config.en.name);
    }));

    const response = await makeRequest(app, 'GET', '/api/store/items');
    assert.equal(response.status, 200);
    const color = response.body.items.find((item: { code: string }) => item.code === 'PWN-101');
    const skin = response.body.items.find((item: { code: string }) => item.code === 'SKN-305');
    assert.equal(color?.category, StoreItemCategory.PAWN_COLOR);
    assert.equal(skin?.category, StoreItemCategory.PAWN_SKIN);
  });

  it('requires authentication to access inventory or purchase a catalog item', async () => {
    const catalog = await makeRequest(app, 'GET', '/api/store/items');
    const color = catalog.body.items.find((item: { code: string }) => item.code === 'PWN-101');
    assert.ok(color);

    const inventory = await makeRequest(app, 'GET', '/api/store/me/items');
    const purchase = await makeRequest(app, 'POST', `/api/store/items/${color.id}/obtain`, {});
    assert.equal(inventory.status, 401);
    assert.equal(purchase.status, 401);
  });

  it('exposes localized point packages and rejects invalid checkout verification input', async () => {
    const packages = await makeRequest(app, 'GET', '/api/store/point-packages');
    assert.equal(packages.status, 200);
    assert.ok(Array.isArray(packages.body.packages));
    assert.ok(packages.body.packages.length > 0);
    await assert.rejects(
      new PointPackageService().replacePackages(packages.body.packages),
      /StripePriceUrl must be a valid Stripe Price ID/
    );
    const invalidPackageFields = packages.body.packages
      .filter((pointPackage: {
      configuration?: { es?: { name?: string; description?: string }; en?: { name?: string; description?: string } };
      points?: number;
      priceUsd?: number;
      stripePriceUrl?: string;
    }) => !(
        Number.isInteger(pointPackage.points) &&
        Number.isFinite(Number(pointPackage.priceUsd)) &&
        typeof pointPackage.stripePriceUrl === 'string' &&
        !!pointPackage.configuration?.es?.name &&
        !!pointPackage.configuration?.es?.description &&
        !!pointPackage.configuration?.en?.name &&
        !!pointPackage.configuration?.en?.description
      ))
      .map((pointPackage: {
        points: number;
        configuration?: { es?: { name?: string; description?: string }; en?: { name?: string; description?: string } };
        stripePriceUrl?: string;
      }) => ({
        points: pointPackage.points,
        hasSpanishName: !!pointPackage.configuration?.es?.name,
        hasSpanishDescription: !!pointPackage.configuration?.es?.description,
        hasEnglishName: !!pointPackage.configuration?.en?.name,
        hasEnglishDescription: !!pointPackage.configuration?.en?.description,
        hasStripePriceUrl: typeof pointPackage.stripePriceUrl === 'string'
      }));
    assert.deepEqual(invalidPackageFields, []);

    const missingSession = await makeRequest(
      app,
      'POST',
      '/api/store/point-packages/checkout/verify',
      {},
      token
    );
    assert.equal(missingSession.status, 400);
    assert.equal(missingSession.body.error, 'INVALID_SESSION_ID');

    const unknownSession = await makeRequest(
      app,
      'POST',
      '/api/store/point-packages/checkout/verify',
      { sessionId: `cs_unknown_${Date.now()}` },
      token
    );
    assert.equal(unknownSession.status, 404);
    assert.equal(unknownSession.body.error, 'PAYMENT_NOT_FOUND');

    const unknownPackage = await makeRequest(
      app,
      'POST',
      '/api/store/point-packages/missing-package/checkout',
      {},
      token
    );
    assert.equal(unknownPackage.status, 404);
    assert.equal(unknownPackage.body.error, 'POINT_PACKAGE_NOT_FOUND');
  });

  it('debits points once and records the purchased color in the authenticated inventory', async () => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: userId }, relations: { stats: true } });
    assert.ok(user?.stats);
    user.stats.points = 5000;
    await AppDataSource.getRepository(Stats).save(user.stats);

    const catalog = await makeRequest(app, 'GET', '/api/store/items');
    const color = catalog.body.items.find((item: { code: string }) => item.code === 'PWN-101');
    assert.ok(color);

    const purchase = await makeRequest(app, 'POST', `/api/store/items/${color.id}/obtain`, {}, token);
    assert.equal(purchase.status, 200);
    assert.equal(purchase.body.userPoints, 5000 - color.pricePoints);
    assert.equal(purchase.body.acquisition.storeItemId, color.id);
    assert.equal(purchase.body.acquisition.pricePointsPaid, color.pricePoints);

    const notifications = await makeRequest(app, 'GET', '/api/notifications', undefined, token);
    assert.equal(notifications.status, 200);
    const purchaseNotification = notifications.body.notifications.find(
      (notification: { type: string }) => notification.type === 'STORE_ITEM_PURCHASED'
    );
    assert.ok(purchaseNotification);
    assert.match(purchaseNotification.message, new RegExp(color.configuration.en.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const inventory = await makeRequest(app, 'GET', '/api/store/me/items', undefined, token);
    assert.equal(inventory.status, 200);
    const acquiredColor = inventory.body.items.find((entry: { item: { id: string } }) => entry.item.id === color.id);
    assert.equal(acquiredColor?.quantity, 1);
    assert.equal(acquiredColor?.item.category, StoreItemCategory.PAWN_COLOR);
  });

  it('does not change balance or inventory when the user cannot afford an item', async () => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: userId }, relations: { stats: true } });
    assert.ok(user?.stats);
    user.stats.points = 0;
    await AppDataSource.getRepository(Stats).save(user.stats);

    const catalog = await makeRequest(app, 'GET', '/api/store/items');
    const color = catalog.body.items.find((item: { code: string }) => item.code === 'PWN-102');
    assert.ok(color);

    const purchase = await makeRequest(app, 'POST', `/api/store/items/${color.id}/obtain`, {}, token);
    assert.equal(purchase.status, 409);
    assert.equal(purchase.body.error, 'INSUFFICIENT_POINTS');

    const inventory = await makeRequest(app, 'GET', '/api/store/me/items', undefined, token);
    assert.equal(inventory.body.items.some((entry: { item: { id: string } }) => entry.item.id === color.id), false);
    const userAfter = await userRepository.findOne({ where: { id: userId }, relations: { stats: true } });
    assert.equal(userAfter?.stats?.points, 0);
  });

  it('allows an admin to gift an item, records the sender relationship, and notifies the recipient', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `gift${suffix}`.slice(0, 20),
      email: `gift${suffix}@test.com`,
      password: 'password123'
    });
    assert.equal(registration.status, 201);
    const exactUsername = `rank${suffix.slice(-6)}`;
    const exactRegistration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: exactUsername,
      email: `exact-${suffix.slice(-6)}@test.com`,
      password: 'password123'
    });
    const partialRegistration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `${exactUsername}y`,
      email: `partial-${suffix.slice(-6)}@test.com`,
      password: 'password123'
    });
    assert.equal(exactRegistration.status, 201);
    assert.equal(partialRegistration.status, 201);
    const forbiddenSearch = await makeRequest(
      app,
      'GET',
      '/api/admin/store/users/search?query=gift',
      undefined,
      token
    );
    assert.equal(forbiddenSearch.status, 403);

    const recipientUser = await AppDataSource.getRepository(User).findOne({
      where: { id: registration.body.user.id },
      relations: { preferences: true }
    });
    assert.ok(recipientUser?.preferences);
    recipientUser.preferences.language = 'es';
    await AppDataSource.getRepository(Preferences).save(recipientUser.preferences);

    const catalog = await makeRequest(app, 'GET', '/api/admin/store/items', undefined, adminToken);
    assert.equal(catalog.status, 200);
    const item = catalog.body.items.find((entry: { code: string }) => entry.code === 'PWN-102');
    assert.ok(item);

    const search = await makeRequest(
      app,
      'GET',
      `/api/admin/store/users/search?query=${encodeURIComponent(registration.body.user.username.slice(0, 5))}`,
      undefined,
      adminToken
    );
    assert.equal(search.status, 200);
    assert.ok(search.body.recipients.some((user: { id: string }) => user.id === registration.body.user.id));

    const exactSearch = await makeRequest(
      app,
      'GET',
      `/api/admin/store/users/search?query=${encodeURIComponent(exactUsername)}`,
      undefined,
      adminToken
    );
    assert.equal(exactSearch.status, 200);
    assert.equal(exactSearch.body.recipients[0].id, exactRegistration.body.user.id);
    assert.equal(exactSearch.body.recipients[0].email, `exact-${suffix.slice(-6)}@test.com`);

    const emailSearch = await makeRequest(
      app,
      'GET',
      `/api/admin/store/users/search?query=${encodeURIComponent(`exact-${suffix.slice(-6)}@`)}`,
      undefined,
      adminToken
    );
    assert.equal(emailSearch.status, 200);
    assert.ok(emailSearch.body.recipients.some((user: { id: string }) => user.id === exactRegistration.body.user.id));

    const gift = await makeRequest(
      app,
      'POST',
      `/api/admin/store/items/${item.id}/gift`,
      { recipientUserId: registration.body.user.id },
      adminToken
    );
    assert.equal(gift.status, 201);
    assert.equal(gift.body.recipient.id, registration.body.user.id);

    const acquisition = await AppDataSource.getRepository(UserStoreItem).findOneBy({
      id: gift.body.acquisitionId
    });
    assert.ok(acquisition);
    assert.equal(acquisition.userId, registration.body.user.id);
    assert.equal(acquisition.storeItemId, item.id);
    assert.equal(acquisition.pricePointsPaid, 0);
    assert.ok(acquisition.giftedByUserId);

    const notifications = await makeRequest(
      app,
      'GET',
      '/api/notifications',
      undefined,
      registration.body.token
    );
    assert.equal(notifications.status, 200);
    const giftNotification = notifications.body.notifications.find(
      (notification: { type: string }) => notification.type === 'STORE_ITEM_GIFTED'
    );
    assert.ok(giftNotification);
    assert.match(giftNotification.message, new RegExp(item.configuration.es.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(giftNotification.message, /Te han regalado/);

    const batchGift = await makeRequest(
      app,
      'POST',
      `/api/admin/store/items/${item.id}/gift`,
      { recipientUserIds: [exactRegistration.body.user.id, partialRegistration.body.user.id] },
      adminToken
    );
    assert.equal(batchGift.status, 201);
    assert.equal(batchGift.body.recipients.length, 2);
    assert.equal(batchGift.body.acquisitionIds.length, 2);
    const batchAcquisitions = await Promise.all(
      batchGift.body.acquisitionIds.map((id: string) => AppDataSource.getRepository(UserStoreItem).findOneBy({ id }))
    );
    assert.ok(batchAcquisitions.every(acquisition =>
      acquisition?.storeItemId === item.id &&
      acquisition.pricePointsPaid === 0 &&
      acquisition.giftedByUserId
    ));
    assert.deepEqual(
      new Set(batchAcquisitions.map(acquisition => acquisition?.userId)),
      new Set([exactRegistration.body.user.id, partialRegistration.body.user.id])
    );
  });

  it('allows only a superadmin to gift a point package and updates only points with a localized notification', async () => {
    const pointPackage = (await new PointPackageService().getPackages(true))[0];
    assert.ok(pointPackage?.id);

    const forbiddenGift = await makeRequest(
      app,
      'POST',
      `/api/admin/store/point-packages/${pointPackage.id}/gift`,
      { recipientUserId: userId },
      token
    );
    assert.equal(forbiddenGift.status, 403);

    const recipient = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { preferences: true, stats: true }
    });
    assert.ok(recipient?.preferences);
    recipient.preferences.language = 'es';
    await AppDataSource.getRepository(Preferences).save(recipient.preferences);
    const pointsBefore = Number(recipient.stats?.points || 0);
    const xpBefore = Number(recipient.stats?.xp || 0);
    const winsBefore = Number(recipient.stats?.wins || 0);

    const gift = await makeRequest(
      app,
      'POST',
      `/api/admin/store/point-packages/${pointPackage.id}/gift`,
      { recipientUserId: userId },
      adminToken
    );
    assert.equal(gift.status, 200);
    assert.equal(gift.body.points, pointPackage.points);
    assert.equal(gift.body.balancePoints, pointsBefore + pointPackage.points);

    const recipientAfter = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { stats: true }
    });
    assert.equal(recipientAfter?.stats?.points, pointsBefore + pointPackage.points);
    assert.equal(recipientAfter?.stats?.xp, xpBefore);
    assert.equal(recipientAfter?.stats?.wins, winsBefore);

    const notifications = await makeRequest(app, 'GET', '/api/notifications', undefined, token);
    assert.equal(notifications.status, 200);
    const pointsNotification = notifications.body.notifications.find(
      (notification: { type: string }) => notification.type === 'POINTS_GIFTED'
    );
    assert.ok(pointsNotification);
    assert.match(pointsNotification.message, new RegExp(String(pointPackage.points)));
    assert.match(pointsNotification.message, /Te han regalado/);
  });
});
