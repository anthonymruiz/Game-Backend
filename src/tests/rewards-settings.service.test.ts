import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { RewardsSettingsService } from '../services/rewards-settings.service.js';
import { StoreItemService } from '../services/store-item.service.js';
import { AppDataSource } from '../config/database.config.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { container } from 'tsyringe';

describe('Rewards settings', () => {
  let service: RewardsSettingsService;
  let originalConfiguration: Awaited<ReturnType<RewardsSettingsService['getConfiguration']>>;
  let giftItemId: string;

  before(async () => {
    await setupTestEnvironment();
    service = container.resolve(RewardsSettingsService);
    originalConfiguration = await service.getConfiguration();
    giftItemId = (await container.resolve(StoreItemService).getItems())[0].id;
    await service.updateConfiguration({ weeklyMysteryGiftItemId: giftItemId });
  });

  after(async () => {
    if (originalConfiguration) {
      const record = await AppDataSource.getRepository(RewardsSettings).findOneBy({ singletonKey: 1 });
      if (record) {
        Object.assign(record, originalConfiguration);
        await AppDataSource.getRepository(RewardsSettings).save(record);
      }
    }
    await teardownTestEnvironment();
  });

  it('updates only validated point reward values', async () => {
    const updated = await service.updateConfiguration({
      ...originalConfiguration,
      weeklyMysteryGiftItemId: giftItemId,
      pointsPerWin: 31,
      rankedPointsPerWin: 47,
      dailyRewardPoints: 19,
      pointsPerLevelUp: 13,
      pointsPerRankUp: 71,
      pointsPerBadge: 23
    });

    assert.deepStrictEqual(updated, {
      ...originalConfiguration,
      weeklyMysteryGiftItemId: giftItemId,
      pointsPerWin: 31,
      rankedPointsPerWin: 47,
      dailyRewardPoints: 19,
      pointsPerLevelUp: 13,
      pointsPerRankUp: 71,
      pointsPerBadge: 23
    });
  });

  it('rejects non-integer, negative, and over-limit reward values', async () => {
    await assert.rejects(service.updateConfiguration({ pointsPerWin: -1 }), /must be an integer/);
    await assert.rejects(service.updateConfiguration({ pointsPerWin: 0 }), /must be an integer/);
    await assert.rejects(service.updateConfiguration({ rankedPointsPerWin: 1.5 }), /must be an integer/);
    await assert.rejects(service.updateConfiguration({ pointsPerRankUp: 1_000_001 }), /must be an integer/);
    await assert.rejects(service.updateConfiguration({ pointsPerBadge: 0 }), /must be an integer/);
  });

  it('allows the weekly Mystery Gift to be removed', async () => {
    const updated = await service.updateConfiguration({ weeklyMysteryGiftItemId: null });
    assert.equal(updated.weeklyMysteryGiftItemId, null);

    const restored = await service.updateConfiguration({ weeklyMysteryGiftItemId: giftItemId });
    assert.equal(restored.weeklyMysteryGiftItemId, giftItemId);
  });
});
