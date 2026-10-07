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
    const targetsFor = (event: string) => badges
      .filter(badge => badge.event === event)
      .map(badge => badge.target)
      .sort((a, b) => a - b);
    assert.deepEqual(
      badges.filter(badge => badge.category === 'LEVELS')
        .map(badge => badge.target)
        .sort((a, b) => a - b),
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    );
    assert.deepEqual(targetsFor('bot_win'), [1, 5, 15, 30, 50]);
    assert.deepEqual(targetsFor('match_win'), [1, 20, 75, 150, 250]);
    assert.deepEqual(targetsFor('match_played'), [10, 30, 75, 150, 250, 500]);
    assert.deepEqual(targetsFor('win_1v1'), [1, 10, 50, 150, 250]);
    assert.deepEqual(targetsFor('win_2v2'), [1, 10, 50, 100]);
    assert.deepEqual(targetsFor('win_4ffa'), [1, 10, 50, 100, 150, 200]);
    assert.deepEqual(targetsFor('win_6ffa'), [1, 10, 50, 100]);
    assert.deepEqual(targetsFor('win_streak'), [2, 3, 5, 8, 12]);
    assert.deepEqual(targetsFor('wall_placed'), [1, 10, 50, 100, 200, 500, 1000, 1500, 2000]);
    assert.deepEqual(targetsFor('move_completed'), [500, 5000]);
    assert.deepEqual(targetsFor('win_without_walls'), [1]);
    assert.deepEqual(targetsFor('boost_wall'), [1, 10, 30, 50, 75, 100]);
    assert.deepEqual(targetsFor('boost_killer'), [1, 50, 200]);
    assert.deepEqual(targetsFor('boost_exchange'), [1, 20, 100]);
    assert.deepEqual(targetsFor('portal_used'), [1, 20, 50, 100, 200]);
    assert.deepEqual(targetsFor('friend_added'), [1, 10, 30]);
    assert.deepEqual(targetsFor('friend_match'), [1, 50]);
    assert.deepEqual(targetsFor('spectate'), [1, 20]);
    assert.deepEqual(targetsFor('spectated'), [1, 10]);
    assert.deepEqual(targetsFor('emote_sent'), [1, 100, 500, 1000]);
    assert.deepEqual(targetsFor('weekly_first_place'), [1]);
    assert.deepEqual(targetsFor('weekly_second_place'), [1]);
    assert.deepEqual(targetsFor('weekly_third_place'), [1]);
    assert.deepEqual(targetsFor('store_purchase'), [1, 25, 60]);
    assert.deepEqual(targetsFor('point_purchase'), [1, 5]);
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
    assert.equal(botBadges.get('challenge_bot_win_5'), 'Cazador de bots');
    assert.equal(botBadges.get('challenge_bot_win_15'), 'Asesino de bots');
    assert.equal(botBadges.get('challenge_bot_win_30'), 'Aniquilador de bots');
    assert.equal(botBadges.get('challenge_bot_win_50'), 'Némesis de la IA');
  });
});
