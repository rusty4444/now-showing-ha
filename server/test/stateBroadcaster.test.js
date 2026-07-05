import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStateBroadcaster } from '../src/stateBroadcaster.js';

function fakeCache() {
  return {
    value: 'stale',
    invalidated: 0,
    set(key, value) {
      assert.equal(key, 'state');
      this.value = value;
      return value;
    },
    invalidate(key) {
      assert.equal(key, 'state');
      this.invalidated += 1;
      this.value = undefined;
    },
  };
}

const activePlexStates = [
  {
    entity_id: 'media_player.sonos_kitchen',
    state: 'idle',
    attributes: { friendly_name: 'Kitchen Sonos' },
  },
  {
    entity_id: 'media_player.plex_plex_for_lg_tv',
    state: 'playing',
    attributes: {
      friendly_name: 'LG TV',
      media_title: 'Pilot',
      media_series_title: 'Severance',
      media_content_id: '12345',
    },
  },
];

test('state broadcaster recomputes from all HA states before broadcasting', async () => {
  const cache = fakeCache();
  const broadcasts = [];
  let getStatesCalls = 0;

  const broadcaster = createStateBroadcaster({
    haClient: {
      getStates: async () => {
        getStatesCalls += 1;
        return activePlexStates;
      },
    },
    stateCache: cache,
    config: { backend: 'plex' },
    eventBus: { broadcast: (payload) => broadcasts.push(payload) },
    debounceMs: 0,
  });

  await broadcaster.handleStateChange();

  assert.equal(getStatesCalls, 1);
  assert.equal(cache.invalidated, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].title, 'Pilot');
  assert.equal(broadcasts[0].seriesTitle, 'Severance');
  assert.equal(cache.value.title, 'Pilot');
});

test('state broadcaster debounces event bursts into one HA state refresh', async () => {
  const cache = fakeCache();
  const broadcasts = [];
  let getStatesCalls = 0;

  const broadcaster = createStateBroadcaster({
    haClient: {
      getStates: async () => {
        getStatesCalls += 1;
        return activePlexStates;
      },
    },
    stateCache: cache,
    config: { backend: 'plex' },
    eventBus: { broadcast: (payload) => broadcasts.push(payload) },
    debounceMs: 300,
  });

  broadcaster.handleStateChange();
  broadcaster.handleStateChange();
  broadcaster.handleStateChange();
  await broadcaster.flushPending();

  assert.equal(cache.invalidated, 3);
  assert.equal(getStatesCalls, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].title, 'Pilot');
});

test('state broadcaster skips SSE broadcast on transient HA errors', async () => {
  const cache = fakeCache();
  const broadcasts = [];
  const warnings = [];

  const broadcaster = createStateBroadcaster({
    haClient: {
      getStates: async () => {
        throw new Error('HA temporarily unavailable');
      },
    },
    stateCache: cache,
    config: { backend: 'plex' },
    eventBus: { broadcast: (payload) => broadcasts.push(payload) },
    logger: { warn: (msg) => warnings.push(msg) },
    debounceMs: 0,
  });

  const result = await broadcaster.handleStateChange();

  assert.equal(result, undefined);
  assert.equal(cache.invalidated, 1);
  assert.deepEqual(broadcasts, []);
  assert.match(warnings[0], /HA temporarily unavailable/);
});
