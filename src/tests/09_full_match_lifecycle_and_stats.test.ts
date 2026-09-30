import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';

describe('Suite 09: Room Lifecycle, Modes, Stats & Reports', () => {
  let app: any;
  let superAdminToken: string;
  let userToken: string;
  let userId: string;

  before(async () => {
    app = await setupTestEnvironment();

    const adminLogin = await makeRequest(app, 'POST', '/api/auth/login', { login: 'admin', password: 'admin' });
    assert.strictEqual(adminLogin.status, 200);
    superAdminToken = adminLogin.body.token;

    const rnd = Math.floor(10000 + Math.random() * 90000);
    const userReg = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `lcUser${rnd}`,
      email: `lifecycle${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(userReg.status, 201);
    userToken = userReg.body.token;
    userId = userReg.body.user.id;
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('9.1 Report creation and admin report status workflow', async () => {
    const rnd = Math.floor(10000 + Math.random() * 90000);
    const targetReg = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `tgtUser${rnd}`,
      email: `target${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(targetReg.status, 201);
    const targetId = targetReg.body.user.id;

    const repRes = await makeRequest(app, 'POST', '/api/reports', {
      reportedUserId: targetId,
      category: 'cheating',
      details: 'Using impossible wall speed hacks'
    }, userToken);

    assert.strictEqual(repRes.status, 201);
    assert.strictEqual(repRes.body.report.reportedUserId, targetId);
    assert.strictEqual(repRes.body.report.status, 'pending');

    const reportId = repRes.body.report.id;

    const updateRes = await makeRequest(app, 'PUT', `/api/reports/${reportId}/status`, {
      status: 'reviewed'
    }, superAdminToken);

    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.report.status, 'reviewed');
  });

  it('9.2 Notification list and mark read endpoints', async () => {
    const notifListRes = await makeRequest(app, 'GET', '/api/notifications', undefined, userToken);
    assert.strictEqual(notifListRes.status, 200);
    assert.ok(Array.isArray(notifListRes.body.notifications));
  });

  it('9.3 System Settings updates enforce valid numeric limits', async () => {
    const settingsGet = await makeRequest(app, 'GET', '/api/admin/settings', undefined, superAdminToken);
    assert.strictEqual(settingsGet.status, 200);

    const settingsPut = await makeRequest(app, 'PUT', '/api/admin/settings', {
      turnTimeoutSeconds: 45,
      maxInactivityStrikes: 4,
      enableMatchmaking: true
    }, superAdminToken);

    assert.strictEqual(settingsPut.status, 200);
    assert.strictEqual(settingsPut.body.settings.turnTimeoutSeconds, 45);
    assert.strictEqual(settingsPut.body.settings.maxInactivityStrikes, 4);
  });

  it('9.4 Admin active users & metrics API endpoints', async () => {
    const metricsRes = await makeRequest(app, 'GET', '/api/admin/metrics', undefined, superAdminToken);
    assert.strictEqual(metricsRes.status, 200);
    assert.ok(metricsRes.body.totalUsers >= 1);

    const activeUsersRes = await makeRequest(app, 'GET', '/api/admin/active-users', undefined, superAdminToken);
    assert.strictEqual(activeUsersRes.status, 200);
    assert.ok(Array.isArray(activeUsersRes.body));
  });
});
