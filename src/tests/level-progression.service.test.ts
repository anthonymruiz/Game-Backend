import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LEVEL_PROGRESSION_CONFIG,
  getLevelProgress,
  getTotalXpForLevel
} from '../services/level-progression.service.js';

describe('Level progression formula', () => {
  it('seeds an independent ranked-match points setting', () => {
    assert.strictEqual(DEFAULT_LEVEL_PROGRESSION_CONFIG.rankedPointsPerMatch, 10);
    assert.strictEqual(DEFAULT_LEVEL_PROGRESSION_CONFIG.pointsPerLevelUp, 10);
    assert.strictEqual(DEFAULT_LEVEL_PROGRESSION_CONFIG.dailyRewardPoints, 10);
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
