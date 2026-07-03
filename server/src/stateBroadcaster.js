// Debounced full-state recompute + SSE broadcast (#10 follow-up).
//
// On any relevant HA state_changed event, recompute the normalised payload
// over ALL entity states — the same computation /api/state serves — and
// broadcast that. Normalising only the changed entity (the previous
// approach) returned null whenever an unrelated media_player changed state,
// which broadcast "nothing playing" to every connected kiosk mid-playback.
//
// The debounce collapses event bursts (a house full of media_players ticking)
// into a single HA REST call instead of one per event.

export function createStateBroadcaster({
  haClient,
  config,
  stateCache,
  eventBus,
  normalise,
  debounceMs = 300,
  logger = console,
}) {
  let timer = null;

  async function recomputeAndBroadcast() {
    timer = null;
    try {
      const states = await haClient.getStates();
      const payload = normalise(states, {
        backend: config.backend,
        player: config.player,
        plexPlayer: config.plexPlayer,
        plexUsername: config.plexUsername,
      });
      stateCache.set('state', payload);
      eventBus.broadcast(payload);
    } catch (err) {
      // Leave the cache invalidated so the next /api/state call retries.
      // Never broadcast on failure — a transient HA error must not blank
      // connected kiosks.
      logger.error(`[ha-ws] state recompute failed: ${err.message}`);
    }
  }

  function onStateChange() {
    stateCache.invalidate('state');
    if (timer) clearTimeout(timer);
    timer = setTimeout(recomputeAndBroadcast, debounceMs);
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { onStateChange, stop };
}
