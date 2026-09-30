import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { Application } from 'express';

describe('02 - SuperAdmin Default Login & User Registration Tests', () => {
  let app: Application;
  // Generate random 5-digit number for alphanumeric username (under 20 chars, no underscores)
  const randNum = Math.floor(10000 + Math.random() * 90000);
  const validUsername = `gamer${randNum}`;
  const validEmail = `gamer${randNum}@example.com`;

  before(async () => {
    app = await setupTestEnvironment();
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('SuperAdmin should be able to login with default credentials ("admin" / "admin")', async () => {
    const res = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'admin'
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, 'admin');
    assert.equal(res.body.user.role, 'superadmin');
  });

  it('Should reject login with invalid password for superAdmin', async () => {
    const res = await makeRequest(app, 'POST', '/api/auth/login', {
      login: 'admin',
      password: 'wrong_password_999'
    });

    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  it('Should successfully register a new normal user with valid credentials', async () => {
    const payload = {
      username: validUsername,
      email: validEmail,
      password: 'Password123!'
    };

    const res = await makeRequest(app, 'POST', '/api/auth/register', payload);

    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, validUsername);
    assert.equal(res.body.user.email, validEmail);
  });

  it('Should reject registration with invalid username (spaces or invalid characters)', async () => {
    const payload = {
      username: 'invalid user name!',
      email: `invalid${randNum}@example.com`,
      password: 'Password123!'
    };

    const res = await makeRequest(app, 'POST', '/api/auth/register', payload);

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('Should reject registration with duplicate username', async () => {
    const payload = {
      username: validUsername,
      email: `unique${randNum}@example.com`,
      password: 'Password123!'
    };

    const res = await makeRequest(app, 'POST', '/api/auth/register', payload);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already taken/i);
  });

  it('Should reject registration with duplicate email', async () => {
    const payload = {
      username: `another${randNum}`,
      email: validEmail,
      password: 'Password123!'
    };

    const res = await makeRequest(app, 'POST', '/api/auth/register', payload);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already in use/i);
  });

  it('Newly registered user should be able to login with their email/username and password', async () => {
    const res = await makeRequest(app, 'POST', '/api/auth/login', {
      login: validEmail,
      password: 'Password123!'
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.username, validUsername);
  });
});
