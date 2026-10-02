import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { Application } from 'express';

describe('11 - System Settings Singleton, Validations & Registration Control Tests', () => {
  let app: Application;
  let adminToken: string;
  let normalUserToken: string;

  const randNum = Math.floor(10000 + Math.random() * 90000);
  const testUser = `settuser${randNum}`;

  before(async () => {
    app = await setupTestEnvironment();

    // Login Admin
    const rAdmin = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    adminToken = rAdmin.body.token;

    // Register Normal User
    const rUser = await makeRequest(app, 'POST', '/api/auth/register', {
      username: testUser,
      email: `${testUser}@example.com`,
      password: 'Password123!'
    });
    normalUserToken = rUser.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Admin should be able to fetch system settings and get default singleton record', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/settings', undefined, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.settings);
    assert.equal(typeof res.body.settings.maintenanceMode, 'boolean');
    assert.equal(typeof res.body.settings.turnTimeLimitSeconds, 'number');
    assert.equal(typeof res.body.settings.maxStrikesBeforeKick, 'number');
    assert.equal(typeof res.body.settings.allowNewRegistrations, 'boolean');
  });

  it('Normal user should NOT be allowed to fetch or update system settings (403 Forbidden)', async () => {
    const getRes = await makeRequest(app, 'GET', '/api/admin/settings', undefined, normalUserToken);
    assert.equal(getRes.status, 403);

    const putRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { turnTimeLimitSeconds: 25 },
      normalUserToken
    );
    assert.equal(putRes.status, 403);
  });

  it('Admin update should validate turn time limit bounds (10s to 60s)', async () => {
    // Attempt turn time < 10
    const lowRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { turnTimeLimitSeconds: 5 },
      adminToken
    );
    assert.equal(lowRes.status, 400);

    // Attempt turn time > 60
    const highRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { turnTimeLimitSeconds: 90 },
      adminToken
    );
    assert.equal(highRes.status, 400);
  });

  it('Admin update should validate max strikes limit (>= 1)', async () => {
    const invalidRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { maxStrikesBeforeKick: 0 },
      adminToken
    );
    assert.equal(invalidRes.status, 400);
  });

  it('Admin should be able to update settings with valid parameters', async () => {
    const updateRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      {
        turnTimeLimitSeconds: 45,
        maxStrikesBeforeKick: 5,
        announcementBanner: 'Torneo del fin de semana activo!'
      },
      adminToken
    );
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.settings.turnTimeLimitSeconds, 45);
    assert.equal(updateRes.body.settings.maxStrikesBeforeKick, 5);
    assert.equal(updateRes.body.settings.announcementBanner, 'Torneo del fin de semana activo!');
  });

  it('When allowNewRegistrations is false, new user registrations should be blocked', async () => {
    // Disable registrations
    await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { allowNewRegistrations: false },
      adminToken
    );

    const blockRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `blocked${randNum}`,
      email: `blocked${randNum}@example.com`,
      password: 'Password123!'
    });

    assert.equal(blockRes.status, 400);
    assert.match(blockRes.body.error || blockRes.body.message, /disabled|mantenimiento/i);

    // Restore registrations
    await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { allowNewRegistrations: true },
      adminToken
    );
  });
});
