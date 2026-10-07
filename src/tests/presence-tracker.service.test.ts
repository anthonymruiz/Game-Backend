import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceTrackerService } from '../services/presence-tracker.service.js';

describe('PresenceTrackerService', () => {
  const originalRedisUrl = process.env.REDIS_URL;
  let tracker: PresenceTrackerService;

  before(async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    tracker = new PresenceTrackerService();
    await tracker.initialize(async () => {}, async () => {}, async () => {});
  });

  after(async () => {
    await tracker.close();
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it('keeps a user online until the last socket disconnects and tracks playing separately', async () => {
    const firstConnection = await tracker.connect('presence-test-user');
    const secondConnection = await tracker.connect('presence-test-user');
    assert.equal(firstConnection.online, true);
    assert.equal(firstConnection.changed, true);
    assert.equal(secondConnection.online, true);
    assert.equal(secondConnection.changed, false);

    const playing = await tracker.setPlaying('presence-test-user', true);
    assert.equal(playing.online, true);
    assert.equal(playing.playing, true);
    assert.equal(playing.changed, true);

    const afterGameSocketDisconnect = await tracker.disconnect('presence-test-user', true);
    assert.equal(afterGameSocketDisconnect.online, true);
    assert.equal(afterGameSocketDisconnect.playing, false);

    const afterLastSocketDisconnect = await tracker.disconnect('presence-test-user', false);
    assert.equal(afterLastSocketDisconnect.online, false);
    assert.equal(afterLastSocketDisconnect.playing, false);
    assert.equal(afterLastSocketDisconnect.changed, true);
  });
});
