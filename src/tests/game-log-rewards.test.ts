import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProgressionRewardBreakdown,
  calculateProgressionRewardPoints
} from '../services/game-log.service.js';
import type { ILevelProgressionConfig } from '../services/level-progression.service.js';

const progressionConfig: ILevelProgressionConfig = {
  baseXpPerLevel: 10,
  exponentialMultiplier: 2,
  maxLevel: 5
};

describe('Match progression reward calculations', () => {
  it('awards the configured amount for every level crossed', () => {
    const breakdown = calculateProgressionRewardBreakdown(
      9,
      51,
      progressionConfig,
      { pointsPerLevelUp: 7, pointsPerRankUp: 0 },
      3
    );

    assert.deepStrictEqual(breakdown, {
      levelsGained: 2,
      level: 3,
      levelUpPoints: 14,
      ranksGained: 0,
      rankUpPoints: 0
    });
    assert.strictEqual(breakdown.levelUpPoints + breakdown.rankUpPoints, 14);
  });

  it('awards a rank-up bonus when XP crosses a configured rank boundary', () => {
    const bonus = calculateProgressionRewardPoints(
      49,
      51,
      progressionConfig,
      { pointsPerLevelUp: 7, pointsPerRankUp: 23 },
      3
    );

    assert.strictEqual(bonus, 23);
  });

  it('combines level and rank bonuses when both boundaries are crossed', () => {
    const bonus = calculateProgressionRewardPoints(
      9,
      51,
      progressionConfig,
      { pointsPerLevelUp: 7, pointsPerRankUp: 23 },
      3
    );

    assert.strictEqual(bonus, 37);
  });

  it('does not award rank points when there is only one configured rank', () => {
    const bonus = calculateProgressionRewardPoints(
      49,
      51,
      progressionConfig,
      { pointsPerLevelUp: 7, pointsPerRankUp: 23 },
      1
    );

    assert.strictEqual(bonus, 0);
  });
});
