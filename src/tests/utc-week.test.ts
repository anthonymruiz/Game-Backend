import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMostRecentCompletedUtcWeekStart, getUtcWeekRange } from '../utils/utc-week.util.js';

describe('UTC weekly reward periods', () => {
  it('uses Monday 00:00 through the following Monday 00:00 UTC', () => {
    const { start, end } = getUtcWeekRange(new Date('2026-06-17T18:30:00Z'));
    assert.equal(start.toISOString(), '2026-06-15T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-06-22T00:00:00.000Z');
  });

  it('does not close a week early on Sunday and closes it at Monday 00:00 UTC', () => {
    assert.equal(
      getMostRecentCompletedUtcWeekStart(new Date('2026-06-21T23:58:59Z')).toISOString(),
      '2026-06-08T00:00:00.000Z'
    );
    assert.equal(
      getMostRecentCompletedUtcWeekStart(new Date('2026-06-21T23:59:00Z')).toISOString(),
      '2026-06-08T00:00:00.000Z'
    );
    assert.equal(
      getMostRecentCompletedUtcWeekStart(new Date('2026-06-22T00:00:00Z')).toISOString(),
      '2026-06-15T00:00:00.000Z'
    );
    assert.equal(
      getMostRecentCompletedUtcWeekStart(new Date('2026-06-22T00:01:00Z')).toISOString(),
      '2026-06-15T00:00:00.000Z'
    );
  });
});
