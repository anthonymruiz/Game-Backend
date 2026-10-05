import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_CATEGORIES, BADGE_CATEGORY_EVENTS } from '../models/badge.enum.js';
import { getDefaultBadges } from '../seeds/badges.seed.js';

describe('Default badge catalog', () => {
  const badges = getDefaultBadges();

  it('contains exactly 100 uniquely coded definitions', () => {
    assert.equal(badges.length, 100);
    assert.equal(new Set(badges.map(badge => badge.code)).size, 100);
  });

  it('uses only valid category-rule pairs and positive targets', () => {
    for (const badge of badges) {
      assert.ok(BADGE_CATEGORIES.includes(badge.category));
      assert.ok(BADGE_CATEGORY_EVENTS[badge.category].includes(badge.event));
      assert.ok(Number.isInteger(badge.target) && badge.target > 0);
    }
  });

  it('has at least one badge for every supported category-rule pair', () => {
    const coveredPairs = new Set(badges.map(badge => `${badge.category}:${badge.event}`));
    for (const [category, events] of Object.entries(BADGE_CATEGORY_EVENTS)) {
      for (const event of events) {
        assert.ok(coveredPairs.has(`${category}:${event}`), `Missing badge for ${category}:${event}`);
      }
    }
  });

  it('has one weekly leaderboard badge for each podium place and no store-redemption rule', () => {
    const placements = badges
      .filter(badge => badge.category === 'WEEKLY_LEADERBOARD')
      .map(badge => badge.event)
      .sort();
    assert.deepEqual(placements, [
      'weekly_first_place',
      'weekly_second_place',
      'weekly_third_place'
    ]);
    assert.ok(!('STORE_REDEMPTIONS' in BADGE_CATEGORY_EVENTS));
    assert.ok(!badges.some(badge => String(badge.event) === 'store_redeem'));
  });

  it('uses the requested level, match, and portal milestones without duplicate portal tiers', () => {
    assert.deepEqual(
      badges.filter(badge => badge.category === 'LEVELS')
        .map(badge => badge.target)
        .sort((a, b) => a - b),
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    );
    assert.deepEqual(
      badges.filter(badge => badge.event === 'match_played')
        .map(badge => badge.target)
        .sort((a, b) => a - b),
      [10, 25, 50, 100, 150, 250]
    );
    assert.deepEqual(
      badges.filter(badge => badge.event === 'portal_used')
        .map(badge => badge.target)
        .sort((a, b) => a - b),
      [1, 5, 15, 30, 50]
    );
    assert.ok(!badges.some(badge => [
      'challenge_portal_used_3',
      'challenge_portal_used_10',
      'challenge_portal_used_25',
      'portal_win'
    ].includes(badge.code)));
  });

  it('provides a complete Spanish and English name, motto, and description', () => {
    for (const badge of badges) {
      for (const language of ['es', 'en'] as const) {
        const locale = badge.locales[language];
        assert.ok(locale.name.trim());
        assert.ok(locale.motto.trim());
        assert.ok(locale.description.trim());
      }
    }
  });

  it('uses distinct, descriptive localized names instead of numbered tiers', () => {
    for (const language of ['es', 'en'] as const) {
      const names = badges.map(badge => badge.locales[language].name);
      assert.equal(new Set(names).size, names.length);
      assert.ok(names.every(name => !/\s\d+$/.test(name)));
    }

    const botBadges = new Map(
      badges.filter(badge => badge.category === 'BOT').map(badge => [badge.code, badge.locales.es.name])
    );
    assert.equal(botBadges.get('bot_win'), 'Primer bot derrotado');
    assert.equal(botBadges.get('challenge_bot_win_3'), 'Cazador de bots');
    assert.equal(botBadges.get('challenge_bot_win_5'), 'Asesino de bots');
    assert.equal(botBadges.get('challenge_bot_win_10'), 'Aniquilador de bots');
  });
});
