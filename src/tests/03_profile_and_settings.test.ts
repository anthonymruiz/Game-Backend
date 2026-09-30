import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { Application } from 'express';

describe('03 - User Profile, Preferences & Admin Settings Tests', () => {
  let app: Application;
  let userToken: string;
  let adminToken: string;
  const randNum = Math.floor(10000 + Math.random() * 90000);
  const initialUsername = `profuser${randNum}`;

  before(async () => {
    app = await setupTestEnvironment();

    // Register & Login Normal User
    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: initialUsername,
      email: `profuser${randNum}@example.com`,
      password: 'Password123!'
    });
    userToken = regRes.body.token;

    // Login Admin User
    const adminRes = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    adminToken = adminRes.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Authenticated user should be able to update their avatarUrl and username', async () => {
    const updatedUsername = `newname${randNum}`;
    const avatarUrl = 'https://example.com/avatars/new_photo.png';

    const res = await makeRequest(
      app,
      'PUT',
      '/api/users/profile',
      { username: updatedUsername, avatarUrl },
      userToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, updatedUsername);
    assert.equal(res.body.user.avatarUrl, avatarUrl);
  });

  it('Should reject profile update with invalid username format', async () => {
    const res = await makeRequest(
      app,
      'PUT',
      '/api/users/profile',
      { username: 'bad name with spaces!', avatarUrl: 'https://example.com/photo.png' },
      userToken
    );

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('User should be able to update system preferences (language: es, theme: dark)', async () => {
    const res = await makeRequest(
      app,
      'PUT',
      '/api/users/preferences',
      { language: 'es', theme: 'dark' },
      userToken
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.preferences.language, 'es');
    assert.equal(res.body.preferences.theme, 'dark');
  });

  it('Admin should be able to retrieve and update system settings', async () => {
    const getRes = await makeRequest(app, 'GET', '/api/admin/settings', undefined, adminToken);
    assert.equal(getRes.status, 200);

    const updateRes = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      {
        maintenanceMode: false,
        turnTimeLimitSeconds: 25,
        maxStrikesBeforeKick: 3,
        announcementBanner: 'Welcome to WallRush Tournament!'
      },
      adminToken
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.settings.turnTimeLimitSeconds, 25);
    assert.equal(updateRes.body.settings.announcementBanner, 'Welcome to WallRush Tournament!');
  });

  it('Normal non-admin user should be rejected when trying to update system settings', async () => {
    const res = await makeRequest(
      app,
      'PUT',
      '/api/admin/settings',
      { maintenanceMode: true },
      userToken
    );

    assert.equal(res.status, 403);
    assert.match(res.body.error, /Forbidden/i);
  });
});
