// Express wire-up.
//
// Responsibilities:
//   - Serve the static HTML (so a single add-on delivers HTML + backend).
//   - Serve /api/state, /api/media-info/:ratingKey, /healthz.
//   - Optional hardening via PROXY_SECRET + ALLOWED_ORIGINS (closes old #4).
//   - Boot loudly: on config errors, log and exit non-zero so Supervisor
//     surfaces the problem.

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig, validate as validateRuntime } from './config.js';
import { createCache } from './cache.js';
import { createHaClient } from './ha.js';
import { createHaWsClient } from './haWs.js';
import { createEventBroadcaster } from './routes/events.js';
import { createSwitcher, parseKiosks } from './switcher.js';
import { normalise } from './state.js';
import { rootRoute } from './routes/root.js';
import { healthzRoute } from './routes/healthz.js';
import { stateRoute } from './routes/state.js';
import { configRoute } from './routes/config.js';
import { mediaInfoRoute } from './routes/mediaInfo.js';
import { artworkRoute } from './routes/artwork.js';
import { plexArtRoute } from './routes/plexArt.js';
import { nightModeRoute } from './routes/nightMode.js';
import { comingSoonRoute } from './routes/comingSoon.js';
import { setupRoute } from './routes/setup.js';
import { createOverlayStore, applyOverlay } from './overlayStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

export function createApp({ config, haClient, overlayStore, baseConfig }) {
  const app = express();
  app.disable('x-powered-by');

  // The setup route needs the *env-only* baseline so it can re-merge the
  // overlay from scratch on every save (otherwise clearing an overlay key
  // would fall back to a previously-overlaid value, not env defaults).
  // Tests that don't supply baseConfig are env-only, so cloning `config`
  // works there too.
  const baseline = baseConfig
    ? JSON.parse(JSON.stringify(baseConfig))
    : JSON.parse(JSON.stringify(config));
  const store = overlayStore || createOverlayStore();
  // If the caller didn't pre-merge the overlay, do it here so first-request
  // state reflects the saved overlay even in tests / programmatic setups.
  // (In direct-run mode, the boot path has already done this; the read+apply
  // is idempotent, so doing it again is harmless.)
  try {
    const persisted = store.read();
    if (persisted && Object.keys(persisted).length > 0) {
      const merged = applyOverlay(baseline, persisted);
      Object.assign(config, merged);
      config.comingSoon = { ...(merged.comingSoon || {}) };
      config.comingSoon.tmdb = { ...((merged.comingSoon && merged.comingSoon.tmdb) || {}) };
      config.visual = { ...(merged.visual || {}) };
    }
  } catch (err) {
    console.warn(`[overlay] failed to apply persisted overlay: ${err.message}`);
  }

  // Optional shared-secret header — only enforced if PROXY_SECRET is set.
  if (config.proxySecret) {
    app.use('/api', (req, res, next) => {
      if (req.get('x-proxy-secret') !== config.proxySecret) {
        return res.status(401).json({ error: 'missing_or_invalid_proxy_secret' });
      }
      next();
    });
  }

  // Optional Origin allowlist — only enforced if ALLOWED_ORIGINS is set.
  if (config.allowedOrigins.length > 0) {
    app.use('/api', (req, res, next) => {
      const origin = req.get('origin');
      // Same-origin requests omit Origin; allow them through.
      if (!origin) return next();
      if (config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        return next();
      }
      return res.status(403).json({ error: 'origin_not_allowed' });
    });
  }

  const stateCache = createCache(config.stateTtl);
  const mediaInfoCache = createCache(config.mediaInfoTtl);
  const comingSoonCache = createCache(config.comingSoonTtl);
  // Long-lived TMDB cache: typed release dates rarely change, and we want
  // them to outlive a single Coming Soon page refresh.
  const tmdbCache = createCache(config.tmdbTtl);

  // SSE event bus (#10): created here but connected to HA WS later in the
  // direct-run path so tests don't trigger WS connections.
  const eventBus = createEventBroadcaster();

  app.use(rootRoute({ config, version: pkg.version }));
  app.use(healthzRoute({ config, version: pkg.version }));
  app.use(configRoute({ config }));
  app.use(setupRoute({ baseConfig: baseline, liveConfig: config, store, eventBus }));
  app.use(stateRoute({ haClient, cache: stateCache, config }));
  app.use(mediaInfoRoute({ cache: mediaInfoCache, config }));
  app.use(artworkRoute({ config }));
  app.use(plexArtRoute({ config }));
  app.use(nightModeRoute({ haClient, config }));
  app.use(comingSoonRoute({ cache: comingSoonCache, tmdbCache, config }));
  app.get('/api/events', eventBus.eventsRoute);

  // Static HTML last so /api/* wins on overlap.
  app.use(express.static(config.staticDir, {
    etag: true,
    maxAge: '5m',
    index: ['now_showing.html', 'index.html'],
  }));

  // Expose eventBus + stateCache for the direct-run bootstrap below
  app.set('eventBus', eventBus);
  app.set('stateCache', stateCache);

  return app;
}

// Boot when run directly (node src/server.js), not when imported by tests.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  // Load env defaults, then merge any persisted overlay config on top before
  // validating. This means a user who saved a working HA token from the
  // setup overlay won't get blocked at boot if the env var was left blank.
  const { config: envConfig } = loadConfig(process.env);
  // Keep an env-only snapshot to pass through as `baseConfig` so the setup
  // route always re-merges from a clean baseline.
  const baseConfig = JSON.parse(JSON.stringify(envConfig));
  const overlayStore = createOverlayStore();
  let overlay = {};
  try { overlay = overlayStore.read() || {}; } catch (_) { overlay = {}; }
  const effective = applyOverlay(baseConfig, overlay);
  Object.assign(envConfig, effective);
  envConfig.comingSoon = { ...(effective.comingSoon || {}) };
  envConfig.comingSoon.tmdb = { ...((effective.comingSoon && effective.comingSoon.tmdb) || {}) };
  envConfig.visual = { ...(effective.visual || {}) };
  const config = envConfig;
  const errors = validateRuntime(config);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[config] ${e}`);
    process.exit(1);
  }
  const haClient = createHaClient({ haUrl: config.haUrl, haToken: config.haToken });
  const app = createApp({ config, haClient, overlayStore, baseConfig });
  const stateCache = app.get('stateCache');
  let haWs = null;

  // HA WebSocket subscription + SSE (#10): push state changes to browsers
  // instead of forcing them to poll.
  if (config.haUrl && config.haToken) {
    const eventBus = app.get('eventBus');
    // Debounce timer for state-change broadcasts (#108): bursty media_player
    // events from unrelated players normalise to null when processed one at a
    // time, so we wait 300ms for the burst to settle, then recompute over ALL
    // HA states (the same computation /api/state serves). Never broadcasts on
    // transient HA fetch errors — lets the client fall back to polling.
    let stateBroadcastTimer = null;
    haWs = createHaWsClient({
      haUrl: config.haUrl,
      haToken: config.haToken,
      onStateChange: (_data) => {
        stateCache.invalidate('state');
        if (stateBroadcastTimer) clearTimeout(stateBroadcastTimer);
        stateBroadcastTimer = setTimeout(async () => {
          try {
            const states = await haClient.getStates();
            const normalised = normalise(states, {
              backend: config.backend,
              player: config.player,
              plexPlayer: config.plexPlayer,
              plexUsername: config.plexUsername,
            });
            eventBus.broadcast(normalised || null);
          } catch (err) {
            // Transient HA error — don't push null to kiosks, let them poll.
            console.error(`[state-broadcast] fetch failed: ${err.message}`);
          }
        }, 300);
      },
      onError: (err) => console.error(`[ha-ws] ${err.message}`),
    });
    haWs.start();
  }

  // Global shutdown: stop WS client + switch before exiting
  function gracefulShutdown() {
    const bus = app.get('eventBus');
    if (bus) bus.close();
    if (haWs) haWs.stop();
    process.exit(0);
  }

  // Optional Fully Kiosk auto-switcher (#48).
  if (config.switcherEnabled) {
    let kiosks = [];
    try {
      kiosks = parseKiosks(config.fullyKiosksRaw);
    } catch (err) {
      console.error(`[switcher] config error: ${err.message}`);
      process.exit(1);
    }
    const switcher = createSwitcher({
      haClient,
      config,
      kiosks,
      intervalMs: config.switcherIntervalMs,
    });
    switcher.start();
    // Clean shutdown so Supervisor's SIGTERM doesn't leave a dangling timer.
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, () => { switcher.stop(); gracefulShutdown(); });
    }
  } else {
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, gracefulShutdown);
    }
  }

  app.listen(config.port, () => {
    console.log(`plex-now-showing-server v${pkg.version} listening on :${config.port} (mode=${config.mode}, backend=${config.backend})`);
  });
}
