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
});
