import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment, makeRequest } from './test-helper.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';

describe('Daily reward endpoint', () => {
  let app: any;
  let token: string;
  let userId: string;
  let originalDailyRewardPoints: number | null = null;

  before(async () => {
    app = await setupTestEnvironment();
    const registration = await makeRequest(app, 'POST', '/api/auth/register', {
      username: `daily${Date.now().toString().slice(-8)}`,
      email: `daily${Date.now()}@test.com`,
      password: 'password123'
    });
    assert.strictEqual(registration.status, 201);
    token = registration.body.token;
    userId = registration.body.user.id;
  });

  after(async () => {
    if (originalDailyRewardPoints !== null && AppDataSource.isInitialized) {
      const config = await AppDataSource.getRepository(RewardsSettings).findOneByOrFail({ singletonKey: 1 });
      config.dailyRewardPoints = originalDailyRewardPoints;
      await AppDataSource.getRepository(RewardsSettings).save(config);
    }
    await teardownTestEnvironment();
  });

  it('awards configured points once per UTC day and reports the updated balance', async () => {
    const rewardsConfig = await AppDataSource.getRepository(RewardsSettings).findOneByOrFail({ singletonKey: 1 });
    originalDailyRewardPoints = rewardsConfig.dailyRewardPoints;
    rewardsConfig.dailyRewardPoints = 23;
    await AppDataSource.getRepository(RewardsSettings).save(rewardsConfig);

    const publicSettings = await makeRequest(app, 'GET', '/api/users/rewards/settings');
    assert.strictEqual(publicSettings.status, 200);
    assert.strictEqual(publicSettings.body.settings.dailyRewardPoints, 23);

    const userBefore = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { stats: true }
    });
    const beforePoints = userBefore?.stats?.points ?? 0;
    const status = await makeRequest(app, 'GET', '/api/users/me/daily-reward', undefined, token);
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.claimedToday, false);
    assert.strictEqual(status.body.points, 23);

    const claim = await makeRequest(app, 'POST', '/api/users/me/daily-reward', {}, token);
    assert.strictEqual(claim.status, 200);
    assert.strictEqual(claim.body.awardedPoints, 23);
    assert.strictEqual(claim.body.points, beforePoints + 23);
    assert.strictEqual(claim.body.claimedToday, true);

    const duplicate = await makeRequest(app, 'POST', '/api/users/me/daily-reward', {}, token);
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(duplicate.body.error, 'DAILY_REWARD_ALREADY_CLAIMED');

    rewardsConfig.dailyRewardPoints = originalDailyRewardPoints;
    await AppDataSource.getRepository(RewardsSettings).save(rewardsConfig);
    originalDailyRewardPoints = null;
  });
});
