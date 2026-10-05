import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { container } from 'tsyringe';
import { RankTierService, IRankTierInput } from '../services/rank-tier.service.js';
import { getTotalXpForLevel, LevelProgressionService } from '../services/level-progression.service.js';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';

describe('Persistent rank tiers', () => {
  let service: RankTierService;

  it('sets up the database and resolves the rank service', async () => {
    await setupTestEnvironment();
    service = container.resolve(RankTierService);
  });

  it('loads seeded, ordered bilingual ranks with calculated XP intervals', async () => {
    const ranks = await service.getRanks();
    const progression = await container.resolve(LevelProgressionService).getConfiguration();
    const maxLevelXp = getTotalXpForLevel(progression.maxLevel, progression);
    assert.equal(ranks.length, 10);
    assert.deepEqual(
      ranks.map((rank) => rank.level),
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    assert.equal(ranks[0].key, 'NOVATO');
    assert.equal(ranks[0].configuration.es.name, 'Novato');
    assert.ok(ranks[0].configuration.es.description);
    assert.ok(ranks[0].configuration.es.motto);
    assert.equal(ranks[0].configuration.en.name, 'Novice');
    assert.ok(ranks[0].configuration.en.description);
    assert.ok(ranks[0].configuration.en.motto);
    assert.equal(ranks[0].minXp, 0);
    assert.equal(ranks.at(-1)?.maxXp, maxLevelXp);
    assert.equal(ranks[1].minXp, ranks[0].maxXp);
  });

  it('assigns ranks by XP and calculates XP progress independently of points', async () => {
    const ranks = await service.getRanks();
    const novice = await service.getRankInfo(0);
    assert.equal(novice.rankKey, 'NOVATO');
    assert.equal(novice.configuration.en.name, 'Novice');
    assert.equal(novice.progressPercent, 0);

    const halfwayToApprentice = await service.getRankInfo(Math.floor(ranks[1].minXp / 2));
    assert.equal(halfwayToApprentice.rankKey, 'NOVATO');
    assert.equal(halfwayToApprentice.progressPercent, 50);

    const threshold = await service.getRankInfo(ranks[1].minXp);
    assert.equal(threshold.rankKey, 'APRENDIZ');
    assert.equal(threshold.xpToNextRank, ranks[2].minXp - ranks[1].minXp);
    assert.equal(threshold.nextRankKey, 'INICIADO');

    const maximum = await service.getRankInfo(ranks.at(-1)!.maxXp + 1000);
    assert.equal(maximum.rankKey, 'LEGENDARIO');
    assert.equal(maximum.isMaxRank, true);
    assert.equal(maximum.progressPercent, 100);
    assert.equal(maximum.xpToNextRank, 0);
  });

  it('persists rank order and localized configuration atomically', async () => {
    const original = await service.getRanks();
    const payload = (items: typeof original): IRankTierInput[] =>
      items.map((rank, index) => ({
        id: rank.id,
        key: rank.key,
        emoji: rank.emoji,
        badgeBg: rank.badgeBg,
        textColor: rank.textColor,
        configuration:
          index === 0
            ? {
                ...rank.configuration,
                es: { ...rank.configuration.es, motto: 'Un lema actualizado y breve.' },
              }
            : rank.configuration,
      }));

    try {
      const reversed = await service.replaceRanks(payload([...original].reverse()));
      assert.equal(reversed[0].key, 'LEGENDARIO');
      assert.equal(reversed[0].level, 1);
      assert.equal(reversed[0].configuration.es.motto, 'Un lema actualizado y breve.');
      assert.equal(reversed.at(-1)?.key, 'NOVATO');
      assert.equal((await service.getRankInfo(0)).rankKey, 'LEGENDARIO');
    } finally {
      await service.replaceRanks(payload(original));
    }
  });

  it('rejects duplicate emojis and incomplete localized configuration', async () => {
    const ranks = await service.getRanks();
    const duplicateEmoji = ranks.map((rank) => ({
      id: rank.id,
      key: rank.key,
      emoji: ranks[0].emoji,
      badgeBg: rank.badgeBg,
      textColor: rank.textColor,
      configuration: rank.configuration,
    }));
    await assert.rejects(service.replaceRanks(duplicateEmoji), /Rank emojis must be unique/);

    const missingLocale = ranks.map((rank) => ({
      id: rank.id,
      key: rank.key,
      emoji: rank.emoji,
      badgeBg: rank.badgeBg,
      textColor: rank.textColor,
      configuration: rank.configuration,
    }));
    missingLocale[0].configuration.en.description = '';
    await assert.rejects(service.replaceRanks(missingLocale), /invalid en description/);
  });

  it('tears down the test database connection', async () => {
    await teardownTestEnvironment();
  });
});
