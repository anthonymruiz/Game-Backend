import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';

describe('Suite 08: API Edge Cases, Security & Input Validations', () => {
  let app: any;

  before(async () => {
    app = await setupTestEnvironment();
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('8.1 Registration rejects missing username, email, or password', async () => {
    const res1 = await makeRequest(app, 'POST', '/api/auth/register', { email: `test${Date.now()}@example.com`, password: 'password123' });
    assert.strictEqual(res1.status, 400);

    const res2 = await makeRequest(app, 'POST', '/api/auth/register', { username: `valid${Date.now()}`.slice(0, 15), password: 'password123' });
    assert.strictEqual(res2.status, 400);

    const res3 = await makeRequest(app, 'POST', '/api/auth/register', { username: `valid${Date.now()}`.slice(0, 15), email: `test${Date.now()}@example.com` });
    assert.strictEqual(res3.status, 400);
  });

  it('8.2 Registration rejects illegal username characters (spaces, special chars, too short, too long)', async () => {
    const resShort = await makeRequest(app, 'POST', '/api/auth/register', { username: 'ab', email: `short${Date.now()}@test.com`, password: 'password123' });
    assert.strictEqual(resShort.status, 400);
    assert.match(resShort.body.error, /alphanumeric/i);

    const resLong = await makeRequest(app, 'POST', '/api/auth/register', { username: 'a'.repeat(21), email: `long${Date.now()}@test.com`, password: 'password123' });
    assert.strictEqual(resLong.status, 400);

    const resSpecial = await makeRequest(app, 'POST', '/api/auth/register', { username: 'user@name!', email: `special${Date.now()}@test.com`, password: 'password123' });
    assert.strictEqual(resSpecial.status, 400);

    const resSpace = await makeRequest(app, 'POST', '/api/auth/register', { username: 'user name', email: `space${Date.now()}@test.com`, password: 'password123' });
    assert.strictEqual(resSpace.status, 400);
  });

  it('8.3 Registration rejects invalid email syntax', async () => {
    const res = await makeRequest(app, 'POST', '/api/auth/register', { username: `validu${Date.now()}`.slice(0, 15), email: 'not-an-email', password: 'password123' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid email/i);
  });

  it('8.4 Login fails with invalid credentials or missing identifier', async () => {
    const res1 = await makeRequest(app, 'POST', '/api/auth/login', { login: 'nonexistent@test.com', password: 'password123' });
    assert.strictEqual(res1.status, 401);

    const res2 = await makeRequest(app, 'POST', '/api/auth/login', { login: 'admin' });
    assert.strictEqual(res2.status, 401);
  });

  it('8.5 Protected routes reject unauthenticated requests (missing, invalid token)', async () => {
    const res1 = await makeRequest(app, 'GET', '/api/admin/metrics');
    assert.strictEqual(res1.status, 401);

    const res2 = await makeRequest(app, 'GET', '/api/admin/metrics', undefined, 'invalid_jwt_token_string');
    assert.strictEqual(res2.status, 401);
  });

  it('8.6 Standard user attempting admin endpoint returns 403 Forbidden', async () => {
    const rnd = Math.floor(10000 + Math.random() * 90000);
    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `norm${rnd}`,
      email: `normal${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(regRes.status, 201);
    const userToken = regRes.body.token;

    const adminRes = await makeRequest(app, 'GET', '/api/admin/metrics', undefined, userToken);
    assert.strictEqual(adminRes.status, 403);
    assert.match(adminRes.body.error, /Forbidden/i);

    const userListRes = await makeRequest(app, 'GET', '/api/admin/users', undefined, userToken);
    assert.strictEqual(userListRes.status, 403);
  });

  it('8.7 User profile update edge cases (invalid username format, profile update)', async () => {
    const rnd = Math.floor(10000 + Math.random() * 90000);
    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `prof${rnd}`,
      email: `prof${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(regRes.status, 201);
    const userToken = regRes.body.token;

    const resInvalid = await makeRequest(app, 'PUT', '/api/users/profile', { username: 'invalid#user' }, userToken);
    assert.strictEqual(resInvalid.status, 400);

    const newName = `pNew${rnd}`;
    const resValid = await makeRequest(app, 'PUT', '/api/users/profile', { username: newName, avatarUrl: 'http://example.com/avatar.png' }, userToken);
    assert.strictEqual(resValid.status, 200);
    assert.strictEqual(resValid.body.user.username, newName);
    assert.strictEqual(resValid.body.user.avatarUrl, 'http://example.com/avatar.png');
  });

  it('8.8 Preferences update preserves custom values and handles FCM token', async () => {
    const rnd = Math.floor(10000 + Math.random() * 90000);
    const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `pref${rnd}`,
      email: `pref${rnd}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(regRes.status, 201);
    const token = regRes.body.token;

    const prefRes = await makeRequest(app, 'PUT', '/api/users/preferences', {
      language: 'en',
      theme: 'dark',
      fcmToken: 'fcm_device_token_abc123'
    }, token);

    assert.strictEqual(prefRes.status, 200);
    assert.strictEqual(prefRes.body.preferences.language, 'en');
    assert.strictEqual(prefRes.body.preferences.theme, 'dark');
    assert.strictEqual(prefRes.body.preferences.fcmToken, 'fcm_device_token_abc123');
  });
});
