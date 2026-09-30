import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { Application } from 'express';
import { container } from 'tsyringe';
import { NotificationService } from '../services/notification.service.js';

describe('05 - Notifications, User Reports & Admin Management/Bans Tests', () => {
  let app: Application;
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let adminToken: string;

  const randNum = Math.floor(10000 + Math.random() * 90000);
  const u1Name = `repuser${randNum}`;
  const u2Name = `baduser${randNum}`;

  before(async () => {
    app = await setupTestEnvironment();

    // Register User 1
    const r1 = await makeRequest(app, 'POST', '/api/auth/register', {
      username: u1Name,
      email: `${u1Name}@example.com`,
      password: 'Password123!'
    });
    user1Token = r1.body.token;
    user1Id = r1.body.user.id;

    // Register User 2
    const r2 = await makeRequest(app, 'POST', '/api/auth/register', {
      username: u2Name,
      email: `${u2Name}@example.com`,
      password: 'Password123!'
    });
    user2Token = r2.body.token;
    user2Id = r2.body.user.id;

    // Login Admin
    const rAdmin = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });
    adminToken = rAdmin.body.token;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('NotificationService should send notifications and user should retrieve them via API', async () => {
    const notifService = container.resolve(NotificationService);
    await notifService.sendNotification(user1Id, 'MATCH_WON', 'MATCH_WON_TITLE', 'MATCH_WON_MSG');

    const res = await makeRequest(app, 'GET', '/api/notifications', undefined, user1Token);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.notifications));
    assert.ok(res.body.notifications.length >= 1);
    assert.equal(res.body.notifications[0].type, 'MATCH_WON');
  });

  it('User 1 should be able to submit a report against User 2 for cheating', async () => {
    const res = await makeRequest(
      app,
      'POST',
      '/api/reports',
      {
        reportedUserId: user2Id,
        category: 'cheating',
        details: 'User was using automated wall placement exploits.'
      },
      user1Token
    );

    assert.equal(res.status, 201);
    assert.ok(res.body.report);
    assert.equal(res.body.report.reportedUserId, user2Id);
    assert.equal(res.body.report.status, 'pending');
  });

  it('Admin should be able to view global reports and update a report status to "reviewed"', async () => {
    const listRes = await makeRequest(app, 'GET', '/api/admin/reports', undefined, adminToken);
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.data));
    assert.ok(listRes.body.data.length >= 1);

    const reportId = listRes.body.data[0].id;
    const updateRes = await makeRequest(
      app,
      'PUT',
      `/api/reports/${reportId}/status`,
      { status: 'reviewed' },
      adminToken
    );

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.report.status, 'reviewed');
  });

  it('Admin should be able to list all users with pagination and role filters', async () => {
    const res = await makeRequest(app, 'GET', '/api/admin/users?role=user&limit=10', undefined, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.meta);
  });

  it('Admin should be able to ban User 2, preventing User 2 from logging in', async () => {
    const banRes = await makeRequest(
      app,
      'POST',
      `/api/admin/users/${user2Id}/ban`,
      { reason: 'Cheating confirmed', expiresAt: '2030-01-01' },
      adminToken
    );
    assert.equal(banRes.status, 200);

    // Attempt login as User 2
    const loginRes = await makeRequest(app, 'POST', '/api/auth/login', {
      login: `${u2Name}@example.com`,
      password: 'Password123!'
    });

    assert.equal(loginRes.status, 401);
    assert.match(loginRes.body.error, /banned/i);
  });

  it('Admin should be able to unban User 2, allowing User 2 to log in again', async () => {
    const unbanRes = await makeRequest(
      app,
      'POST',
      `/api/admin/users/${user2Id}/unban`,
      {},
      adminToken
    );
    assert.equal(unbanRes.status, 200);

    // Attempt login as User 2 after unban
    const loginRes = await makeRequest(app, 'POST', '/api/auth/login', {
      login: `${u2Name}@example.com`,
      password: 'Password123!'
    });

    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.body.token);
  });
});
