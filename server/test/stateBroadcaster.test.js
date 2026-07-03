import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createStateBroadcaster } from '../src/stateBroadcaster.js';
import { normalise } from '../src/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const states = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'ha_states.json'), 'utf8'),
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

function makeHarness({ getStates } = {}) {
  const broadcasts = [];
  const cache = new Map();
  let getStatesCalls = 0;
  const broadcaster = createStateBroadcaster({
    haClient: {
      getStates: getStates || (async () => {
        getStatesCalls++;
        return states;
      }),
    },
    config: { backend: 'plex', player: '', plexPlayer: '', plexUsername: '' },
    stateCache: {
      set: (k, v) => cache.set(k, v),
      invalidate: (k) => cache.delete(k),
    },
    eventBus: { broadcast: (p) => broadcasts.push(p) },
    normalise,
    debounceMs: 0,
    logger: { error: () => {} },
  });
  return { broadcaster, broadcasts, cache, getStatesCalls: () => getStatesCalls };
}

test('broadcasts the full normalised payload, not the changed entity', async () => {
  // Regression for the null-broadcast bug: a state_changed for an UNRELATED
  // media_player must still broadcast the active session computed over all
  // states — previously it normalised just the changed entity and pushed
  // null, blanking every connected kiosk mid-playback.
  const { broadcaster, broadcasts } = makeHarness();
  broadcaster.onStateChange();
  await flush();

  assert.equal(broadcasts.length, 1);
  assert.notEqual(broadcasts[0], null);
  assert.equal(broadcasts[0].state, 'playing');
  assert.ok(broadcasts[0].title);
});

test('debounces bursts of state_changed into one recompute', async () => {
  const { broadcaster, broadcasts, getStatesCalls } = makeHarness();
  broadcaster.onStateChange();
  broadcaster.onStateChange();
  broadcaster.onStateChange();
  await flush();

  assert.equal(getStatesCalls(), 1);
  assert.equal(broadcasts.length, 1);
});

test('broadcasts null when genuinely nothing is playing', async () => {
  const idle = states.map((s) => ({ ...s, state: 'idle' }));
  const { broadcaster, broadcasts } = makeHarness({
    getStates: async () => idle,
  });
  broadcaster.onStateChange();
  await flush();

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0], null);
});

test('refreshes the /api/state cache with the recomputed payload', async () => {
  const { broadcaster, cache } = makeHarness();
  cache.set('state', { stale: true });
  broadcaster.onStateChange();
  // invalidate must run synchronously so /api/state never serves stale data
  assert.equal(cache.has('state'), false);
  await flush();

  assert.equal(cache.get('state').state, 'playing');
});

test('does not broadcast when HA is unreachable', async () => {
  const { broadcaster, broadcasts } = makeHarness({
    getStates: async () => { throw new Error('boom'); },
  });
  broadcaster.onStateChange();
  await flush();

  assert.equal(broadcasts.length, 0);
});

test('stop() cancels a pending recompute', async () => {
  const { broadcaster, broadcasts } = makeHarness();
  broadcaster.onStateChange();
  broadcaster.stop();
  await flush();

  assert.equal(broadcasts.length, 0);
});
