import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { UserRepository } from '../repositories/user.repository.js';
import { container } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { createRateLimiter } from '../middlewares/rate-limit.middleware.js';
import express from 'express';
import http from 'http';
import { isValidAvatarUrl } from '../utils/regex.util.js';

describe('Security Hardening & Refresh Token Tests', () => {
  let app: any;
  let userRepo: UserRepository;

  before(async () => {
    app = await setupTestEnvironment();
    userRepo = container.resolve(UserRepository);
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  describe('1. Access Token Short Expiration & Refresh Token Flow', () => {
    const testEmail = `sectest_${Date.now()}@example.com`;
    const testUsername = `secUser${Math.floor(1000 + Math.random() * 9000)}`;
    const testPassword = 'Password123!';
    let accessToken: string;
    let refreshToken: string;
    let userId: string;

    it('should return short-lived access token and 7-day refresh token on registration', async () => {
      const res = await makeRequest(app, 'POST', '/api/auth/register', {
        email: testEmail,
        username: testUsername,
        password: testPassword
      });

      assert.equal(res.status, 201);
      assert.ok(res.body.token, 'Should have access token');
      assert.ok(res.body.refreshToken, 'Should have refresh token');

      accessToken = res.body.token;
      refreshToken = res.body.refreshToken;
      userId = res.body.user.id;

      // Decode access token to verify short expiration (1 hour = 3600s, not 100 years)
      const decodedAccess: any = jwt.decode(accessToken);
      assert.ok(decodedAccess.exp, 'Access token must have exp');
      const accessTtl = decodedAccess.exp - decodedAccess.iat;
      assert.equal(accessTtl, 3600, 'Access token must expire in 1 hour (3600s)');

      // Decode refresh token to verify 7-day expiration (7 * 86400 = 604800s)
      const decodedRefresh: any = jwt.decode(refreshToken);
      assert.ok(decodedRefresh.exp, 'Refresh token must have exp');
      const refreshTtl = decodedRefresh.exp - decodedRefresh.iat;
      assert.equal(refreshTtl, 7 * 86400, 'Refresh token must expire in 7 days (604800s)');
    });

    it('should return token and refreshToken on login as well', async () => {
      const res = await makeRequest(app, 'POST', '/api/auth/login', {
        email: testEmail,
        password: testPassword
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.ok(res.body.refreshToken);
      refreshToken = res.body.refreshToken;
    });

    it('should exchange a valid refresh token for a new access token and rotated refresh token', async () => {
      const res = await makeRequest(app, 'POST', '/api/auth/refresh', {
        refreshToken
      });

      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.ok(res.body.refreshToken);
      assert.notEqual(res.body.refreshToken, refreshToken, 'Refresh token must be rotated');

      const oldToken = refreshToken;
      refreshToken = res.body.refreshToken;

      // Re-using old token must fail due to token rotation
      const replayRes = await makeRequest(app, 'POST', '/api/auth/refresh', {
        refreshToken: oldToken
      });
      assert.equal(replayRes.status, 401, 'Old refresh token must be rejected');
    });

    it('should reject invalid or forged refresh tokens', async () => {
      const res = await makeRequest(app, 'POST', '/api/auth/refresh', {
        refreshToken: 'invalid.jwt.token'
      });
      assert.equal(res.status, 401);
    });
  });

  describe('2. Column Security (select: false on password and refreshToken)', () => {
    it('should never expose password or refreshToken on standard queries', async () => {
      const email = `hidden_${Date.now()}@example.com`;
      const username = `hidden${Math.floor(1000 + Math.random() * 9000)}`;
      const regRes = await makeRequest(app, 'POST', '/api/auth/register', {
        email,
        username,
        password: 'Password123!'
      });
      assert.equal(regRes.status, 201);
      const userId = regRes.body.user.id;

      const userFromDb = await userRepo.findById(userId);
      assert.ok(userFromDb);
      assert.equal(userFromDb.password, undefined, 'password must not be selected by default');
      assert.equal(userFromDb.refreshToken, undefined, 'refreshToken must not be selected by default');

      // However findByIdWithPassword must load password
      const userWithPass = await userRepo.findByIdWithPassword(userId);
      assert.ok(userWithPass?.password, 'findByIdWithPassword should load password');
    });
  });

  describe('3. Avatar URL Validation', () => {
    it('isValidAvatarUrl utility should accept https and http URLs and reject dangerous schemes', () => {
      assert.equal(isValidAvatarUrl('https://example.com/avatar.png'), true);
      assert.equal(isValidAvatarUrl('http://example.com/avatar.jpg'), true);
      assert.equal(isValidAvatarUrl('javascript:alert(1)'), false);
      assert.equal(isValidAvatarUrl('data:text/html,<script>alert(1)</script>'), false);
      assert.equal(isValidAvatarUrl('ftp://example.com/avatar.png'), false);
      assert.equal(isValidAvatarUrl('not a url'), false);
      assert.equal(isValidAvatarUrl(''), false);
    });

    it('should reject malicious or invalid avatar URLs in profile update', async () => {
      const email = `avatar_${Date.now()}@example.com`;
      const username = `avUser${Math.floor(1000 + Math.random() * 9000)}`;
      const reg = await makeRequest(app, 'POST', '/api/auth/register', {
        email,
        username,
        password: 'Password123!'
      });
      const token = reg.body.token;

      // Try malicious javascript URL
      const badRes = await makeRequest(app, 'PUT', '/api/users/profile', {
        avatarUrl: 'javascript:alert(document.cookie)'
      }, token);
      assert.equal(badRes.status, 400);
      assert.match(badRes.body.error, /Invalid avatar URL/i);

      // Valid HTTPS URL should succeed
      const goodRes = await makeRequest(app, 'PUT', '/api/users/profile', {
        avatarUrl: 'https://cdn.example.com/my-avatar.png'
      }, token);
      assert.equal(goodRes.status, 200);
      assert.equal(goodRes.body.user.avatarUrl, 'https://cdn.example.com/my-avatar.png');
    });
  });

  describe('4. Re-authentication on Destructive Actions (Account Deletion)', () => {
    it('should require password confirmation to delete a local user account', async () => {
      const email = `delete_${Date.now()}@example.com`;
      const username = `delUser${Math.floor(1000 + Math.random() * 9000)}`;
      const password = 'SecretPassword123!';
      const reg = await makeRequest(app, 'POST', '/api/auth/register', {
        email,
        username,
        password
      });
      const token = reg.body.token;

      // 1. Calling delete without password should fail with 400
      const noPassRes = await makeRequest(app, 'DELETE', '/api/users/account', {}, token);
      assert.equal(noPassRes.status, 400);
      assert.match(noPassRes.body.error, /Password confirmation is required/i);

      // 2. Calling delete with incorrect password should fail with 401
      const wrongPassRes = await makeRequest(app, 'DELETE', '/api/users/account', {
        password: 'WrongPassword999!'
      }, token);
      assert.equal(wrongPassRes.status, 401);
      assert.match(wrongPassRes.body.error, /Invalid password confirmation/i);

      // 3. Calling delete with correct password succeeds
      const correctRes = await makeRequest(app, 'DELETE', '/api/users/account', {
        password
      }, token);
      assert.equal(correctRes.status, 200);
      assert.match(correctRes.body.message, /Account deleted successfully/i);

      // Confirm user is deleted from DB
      const checkDeleted = await userRepo.findById(reg.body.user.id);
      assert.equal(checkDeleted, null);
    });
  });

  describe('5. HTTP Payload Size Limit (10kb)', () => {
    it('should reject payloads larger than 10kb with 413 Payload Too Large', async () => {
      const email = `payload_${Date.now()}@example.com`;
      const username = `payUser${Math.floor(1000 + Math.random() * 9000)}`;
      const reg = await makeRequest(app, 'POST', '/api/auth/register', {
        email,
        username,
        password: 'Password123!'
      });
      const token = reg.body.token;

      // Generate a payload exceeding 10kb
      const hugeString = 'A'.repeat(15 * 1024); // 15kb
      const hugeRes = await makeRequest(app, 'PUT', '/api/users/profile', {
        username: hugeString
      }, token);

      assert.equal(hugeRes.status, 413);
      assert.match(hugeRes.body.error, /Payload too large/i);
    });
  });

  describe('6. Rate Limiting Middleware Enforcement', () => {
    it('should block requests and return 429 when max limit is exceeded', async () => {
      const testLimiterApp = express();
      const strictLimiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        message: { error: 'Rate limit exceeded' }
      });

      testLimiterApp.use(strictLimiter);
      testLimiterApp.get('/test-rate', (req, res) => res.json({ ok: true }));

      const server = http.createServer(testLimiterApp);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}/test-rate`;

      try {
        // Request 1, 2, 3 succeed
        for (let i = 1; i <= 3; i++) {
          const res = await fetch(url);
          assert.equal(res.status, 200);
        }
        // Request 4 exceeds limit -> 429
        const blockedRes = await fetch(url);
        assert.equal(blockedRes.status, 429);
        const data = await blockedRes.json();
        assert.equal(data.error, 'Rate limit exceeded');
      } finally {
        server.close();
      }
    });
  });

  describe('7. CORS Origins Enforcement', () => {
    it('should reject unauthorized origins and accept http://localhost:4200', async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}/health`;

      try {
        // 1. Authorized origin
        const allowedRes = await fetch(url, {
          headers: { Origin: 'http://localhost:4200' }
        });
        assert.equal(allowedRes.status, 200);
        assert.equal(allowedRes.headers.get('access-control-allow-origin'), 'http://localhost:4200');

        // 2. Unauthorized origin
        const blockedRes = await fetch(url, {
          headers: { Origin: 'http://evil-attacker.com' }
        });
        assert.equal(blockedRes.status, 403);
      } finally {
        server.close();
      }
    });
  });

  describe('8. WebSocket Throttling', () => {
    it('should throttle socket events exceeding 40 per second', async () => {
      const { SocketManager } = await import('../socket/socket.manager.js');
      const socketManager = container.resolve(SocketManager);
      let eventMiddleware: (packet: [string, ...any[]], next: (err?: any) => void) => void = () => {};
      const emittedErrors: string[] = [];
      const mockSocket: any = {
        use: (fn: any) => {
          eventMiddleware = fn;
        },
        emit: (event: string, msg: string) => {
          if (event === 'error') emittedErrors.push(msg);
        }
      };

      (socketManager as any).throttleMiddleware(mockSocket, () => {});

      let allowedCount = 0;
      let blockedCount = 0;

      for (let i = 0; i < 50; i++) {
        let calledNext = false;
        eventMiddleware(['ping'], () => {
          calledNext = true;
        });
        if (calledNext) {
          allowedCount++;
        } else {
          blockedCount++;
        }
      }

      assert.equal(allowedCount, 40, 'First 40 events in 1s must be allowed');
      assert.equal(blockedCount, 10, 'Next 10 events exceeding rate limit must be blocked');
      assert.ok(emittedErrors.length >= 10, 'Error message must be emitted on throttled events');
      assert.match(emittedErrors[0], /Too many requests/i);
    });
  });
});
