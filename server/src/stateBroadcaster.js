// Debounced HA state-change broadcaster for /api/events.
//
// HA emits state_changed for every media_player entity. Normalising only the
// changed entity makes unrelated idle players broadcast `null` while another
// player is active. Recompute from the full HA state set, mirroring /api/state,
// then broadcast the aggregate payload.

import { normalise } from './state.js';

function normaliseAll(states, config) {
  return normalise(states, {
    backend: config.backend,
    player: config.player,
    plexPlayer: config.plexPlayer,
    plexUsername: config.plexUsername,
  });
}

export function createStateBroadcaster({
  haClient,
  stateCache,
  config,
  eventBus,
  debounceMs = 300,
  logger = console,
}) {
  let timer = null;
  let inFlight = null;

  async function refreshAndBroadcast() {
    timer = null;
    try {
      const states = await haClient.getStates();
      const payload = normaliseAll(states, config);
      stateCache.set('state', payload);
      eventBus.broadcast(payload);
      return payload;
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      logger.warn?.(`[state-broadcaster] skipped SSE update because HA state refresh failed: ${detail}`);
      return undefined;
    } finally {
      inFlight = null;
    }
  }

  function handleStateChange() {
    stateCache.invalidate('state');

    if (timer) clearTimeout(timer);
    if (debounceMs <= 0) {
      inFlight = refreshAndBroadcast();
      return inFlight;
    }

    timer = setTimeout(() => {
      inFlight = refreshAndBroadcast();
    }, debounceMs);
    return inFlight;
  }

  async function flushPending() {
    if (timer) {
      clearTimeout(timer);
      return refreshAndBroadcast();
    }
    if (inFlight) return inFlight;
    return undefined;
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { handleStateChange, flushPending, stop };
}
