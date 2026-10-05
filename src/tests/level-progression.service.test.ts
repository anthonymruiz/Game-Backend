import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLevelProgress,
  getTotalXpForLevel
} from '../services/level-progression.service.js';
import { DEFAULT_REWARDS_SETTINGS } from '../services/rewards-settings.service.js';
import { DEFAULT_LEVEL_PROGRESSION_CONFIG } from '../services/level-progression.service.js';

describe('Level progression formula', () => {
  it('keeps reward settings separate from level progression configuration', () => {
    assert.deepStrictEqual(DEFAULT_REWARDS_SETTINGS, {
      pointsPerWin: 10,
      rankedPointsPerWin: 10,
      dailyRewardPoints: 10,
      pointsPerLevelUp: 10,
      pointsPerRankUp: 10,
      pointsPerBadge: 10,
      weeklyFirstPlacePoints: 500,
      weeklySecondPlacePoints: 300,
      weeklyThirdPlacePoints: 100,
      weeklyMysteryGiftItemId: null
    });
    assert.deepStrictEqual(Object.keys(DEFAULT_LEVEL_PROGRESSION_CONFIG).sort(), [
      'baseXpPerLevel',
      'exponentialMultiplier',
      'maxLevel'
    ]);
  });

  it('uses configured exponential thresholds and computes progress within the current level', () => {
    const config = DEFAULT_LEVEL_PROGRESSION_CONFIG;

    assert.strictEqual(getTotalXpForLevel(1, config), 0);
    assert.strictEqual(getTotalXpForLevel(2, config), config.baseXpPerLevel);

    const halfway = getLevelProgress(
      getTotalXpForLevel(2, config) + 5,
      config
    );
    assert.strictEqual(halfway.level, 2);
    assert.strictEqual(halfway.currentLevelXp, getTotalXpForLevel(2, config));
    assert.strictEqual(halfway.levelProgressPercent, 50);
    assert.strictEqual(halfway.xpToNextLevel, 5);
  });

  it('caps progression at the configured maximum level', () => {
    const config = DEFAULT_LEVEL_PROGRESSION_CONFIG;
    const maxLevelXp = getTotalXpForLevel(config.maxLevel, config);

    assert.strictEqual(getLevelProgress(maxLevelXp, config).level, config.maxLevel);
    assert.strictEqual(getLevelProgress(maxLevelXp, config).isMaxLevel, true);
    assert.strictEqual(getLevelProgress(maxLevelXp, config).xpToNextLevel, 0);
  });
});
