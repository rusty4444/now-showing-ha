// Server-side overlay configuration (#98).
//
// Boots the Express app against a temp overlay file and exercises GET/POST
// /api/setup, including the cross-client persistence guarantee (a save from
// one client is visible to another), secret-handling rules (blank preserves,
// secrets never returned), and the TMDB save path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createApp } from '../src/server.js';
import { createOverlayStore, applyOverlay } from '../src/overlayStore.js';
import { sanitizeOverlayInput, mergeOverlay, effectiveSetupView } from '../src/routes/setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const haStates = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'ha_states.json'), 'utf8'),
);

function tmpStorePath(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pns-overlay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'overlay.json');
}

function envBaseConfig(overrides = {}) {
  return {
    mode: 'addon',
    port: 0,
    haUrl: 'http://supervisor/core',
    haToken: 'tok',
    plexUrl: '',
    plexToken: '',
    plexUsername: '',
    plexPlayer: '',
    landscape: false,
    theme: 'classic-gold',
    poll: 5000,
    proxySecret: '',
    allowedOrigins: [],
    stateTtl: 3000,
    mediaInfoTtl: 600000,
    comingSoonTtl: 900000,
    tmdbTtl: 21600000,
    displayMode: 'now_showing',
    backend: 'plex',
    player: '',
    switcherEnabled: false,
    switcherIntervalMs: 5000,
    fullyKiosksRaw: '',
    comingSoon: {
      title: 'Coming Soon',
      radarrUrl: '',
      radarrApiKey: '',
      sonarrUrl: '',
      sonarrApiKey: '',
      moviesCount: 5,
      showsCount: 5,
      cycleInterval: 8,
      daysOffset: 0,
      lookaheadDays: 90,
      imageType: 'poster',
      tmdb: { apiKey: '', region: 'AU' },
    },
    visual: {
      progressBar: false, ratingsBadges: false, genreChips: false,
      infoPanelMode: 'on_tap', useBackdrops: false, frameStyle: 'bulbs',
      bulbSizePx: 28, marqueeFont: 'bebas-neue', backdropStyle: 'fullscreen',
      backdropDelayMs: 10000, burnInMitigation: false,
      nudgeIntervalMs: 60000, nudgeAmplitudePx: 4,
      nightModeEntity: '', nightModeOpacity: 0.4,
      theme: 'classic-gold', accentColor: '', marqueeBgColor: '', cornerRadiusPx: 0,
    },
    staticDir: join(__dirname, '..', 'fixtures'),
    ...overrides,
  };
}

function startApp(t, { config, overlayPath } = {}) {
  const cfg = config || envBaseConfig();
  const baseConfig = JSON.parse(JSON.stringify(cfg));
  const overlayStore = createOverlayStore(overlayPath || tmpStorePath(t));
  const haClient = { getStates: async () => haStates };
  const app = createApp({ config: cfg, haClient, overlayStore, baseConfig });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      t.after(() => server.close());
      resolve({ url: `http://127.0.0.1:${port}`, config: cfg, baseConfig, overlayStore });
    });
  });
}

test('GET /api/setup returns effective config with *Set flags and no secrets', async (t) => {
  const cfg = envBaseConfig({
    plexUrl: 'http://plex.lan:32400',
    plexToken: 'top-secret-plex',
    comingSoon: {
      ...envBaseConfig().comingSoon,
      radarrUrl: 'http://radarr.lan:7878',
      radarrApiKey: 'top-secret-radarr',
      tmdb: { apiKey: 'top-secret-tmdb', region: 'GB' },
    },
  });
  const { url } = await startApp(t, { config: cfg });
  const body = await fetch(`${url}/api/setup`).then(r => r.json());
  assert.equal(body.haUrl, 'http://supervisor/core');
  assert.equal(body.haTokenSet, true);
  assert.equal(body.plex.url, 'http://plex.lan:32400');
  assert.equal(body.plex.tokenSet, true);
  assert.equal(body.comingSoon.radarrUrl, 'http://radarr.lan:7878');
  assert.equal(body.comingSoon.radarrApiKeySet, true);
  assert.equal(body.comingSoon.tmdb.apiKeySet, true);
  assert.equal(body.comingSoon.tmdb.region, 'GB');
  // No secrets present anywhere.
  const dump = JSON.stringify(body);
  for (const s of ['top-secret-plex', 'top-secret-radarr', 'top-secret-tmdb']) {
    assert.equal(dump.includes(s), false, `secret ${s} leaked`);
  }
});

test('POST /api/setup persists settings server-side and another client sees them', async (t) => {
  const overlayPath = tmpStorePath(t);
  // Client A writes via one app instance.
  const a = await startApp(t, { overlayPath });
  const saveResp = await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      backend: 'jellyfin',
      player: 'media_player.jellyfin_living_room',
      comingSoon: {
        radarrUrl: 'http://radarr.lan:7878',
        radarrApiKey: 'fresh-radarr-key',
        moviesCount: 9,
      },
    }),
  });
  assert.equal(saveResp.status, 200);

  // Client B is a *fresh* app instance reading the same overlay file —
  // simulates a phone hitting the LAN URL after the kiosk saved settings.
  const b = await startApp(t, { overlayPath });
  const seen = await fetch(`${b.url}/api/setup`).then(r => r.json());
  assert.equal(seen.backend, 'jellyfin');
  assert.equal(seen.player, 'media_player.jellyfin_living_room');
  assert.equal(seen.comingSoon.radarrUrl, 'http://radarr.lan:7878');
  assert.equal(seen.comingSoon.radarrApiKeySet, true);
  assert.equal(seen.comingSoon.moviesCount, 9);
  // The Radarr API key must not appear in the response or on disk-as-config.
  assert.equal(JSON.stringify(seen).includes('fresh-radarr-key'), false);
});

async function readNextSseData(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/^data: (.*)$/m);
    if (match) return JSON.parse(match[1]);
  }
}

test('POST /api/setup broadcasts config_changed over SSE', async (t) => {
  const a = await startApp(t, { config: envBaseConfig({ haToken: 'super-secret-ha-token' }) });
  const events = await fetch(`${a.url}/api/events`);
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));

  // Wait until the SSE route has registered the client; the initial heartbeat
  // is written before registration, so the next tick is enough for Express to
  // finish adding the response to the broadcaster set.
  await new Promise(resolve => setImmediate(resolve));

  const saveResp = await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayMode: 'coming_soon', comingSoon: { moviesCount: 7 } }),
  });
  assert.equal(saveResp.status, 200);

  const event = await readNextSseData(reader);
  assert.equal(event.type, 'config_changed');
  assert.equal(event.config.displayMode, 'coming_soon');
  assert.equal(event.config.comingSoon.moviesCount, 7);
  assert.equal(JSON.stringify(event).includes('super-secret-ha-token'), false, 'SSE config event must not leak HA token');
});

test('POST /api/setup with blank secret preserves the existing saved secret', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  // Save a Plex token through the overlay.
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plexUrl: 'http://plex.lan:32400', plexToken: 'kept-secret' }),
  });
  let view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  assert.equal(view.plex.tokenSet, true);

  // Now save again with a blank plexToken — non-secret fields can change,
  // but the saved token must survive.
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plexUrl: 'http://plex.lan:32400', plexToken: '' }),
  });
  view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  assert.equal(view.plex.tokenSet, true, 'blank plexToken should preserve saved value');
  assert.equal(view.plex.url, 'http://plex.lan:32400');

  // And it should still be present on a fresh process.
  const b = await startApp(t, { overlayPath });
  const seen = await fetch(`${b.url}/api/setup`).then(r => r.json());
  assert.equal(seen.plex.tokenSet, true);
});

test('POST /api/setup/reset clears the overlay file and reverts to env defaults', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: 'jellyfin', plexToken: 'sekret' }),
  });
  let view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  assert.equal(view.backend, 'jellyfin');
  assert.equal(view.plex.tokenSet, true);

  await fetch(`${a.url}/api/setup/reset`, { method: 'POST' });
  view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  // Back to env-only baseline (which sets backend=plex, plexToken='').
  assert.equal(view.backend, 'plex');
  assert.equal(view.plex.tokenSet, false);
  assert.equal(existsSync(overlayPath), false);
});

test('POST /api/setup persists TMDB key + region; *Set boolean reflects it', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comingSoon: { tmdb: { apiKey: 'xxxx-tmdb-yyyy', region: 'US' } },
    }),
  });
  const view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  assert.equal(view.comingSoon.tmdb.apiKeySet, true);
  assert.equal(view.comingSoon.tmdb.enabled, true);
  assert.equal(view.comingSoon.tmdb.region, 'US');
  assert.equal(JSON.stringify(view).includes('xxxx-tmdb-yyyy'), false);

  // The persisted file holds the raw secret (it has to, so the server can
  // use it on the next restart) but only on disk, never on the wire.
  const onDisk = JSON.parse(readFileSync(overlayPath, 'utf8'));
  assert.equal(onDisk.comingSoon.tmdb.apiKey, 'xxxx-tmdb-yyyy');
  assert.equal(onDisk.comingSoon.tmdb.region, 'US');
});

test('GET /api/setup falls back to env/options defaults when no overlay exists', async (t) => {
  const cfg = envBaseConfig({
    backend: 'plex',
    comingSoon: {
      ...envBaseConfig().comingSoon,
      title: 'From env',
      moviesCount: 7,
      tmdb: { apiKey: 'env-tmdb', region: 'CA' },
    },
  });
  const { url } = await startApp(t, { config: cfg });
  const view = await fetch(`${url}/api/setup`).then(r => r.json());
  assert.equal(view.comingSoon.title, 'From env');
  assert.equal(view.comingSoon.moviesCount, 7);
  assert.equal(view.comingSoon.tmdb.apiKeySet, true);
  assert.equal(view.comingSoon.tmdb.region, 'CA');
});

test('Overlay overrides env values where both are set', async (t) => {
  const cfg = envBaseConfig({
    backend: 'plex',
    comingSoon: { ...envBaseConfig().comingSoon, title: 'env-title', moviesCount: 5 },
  });
  const overlayPath = tmpStorePath(t);
  // Pre-write the overlay file before starting the app.
  writeFileSync(overlayPath, JSON.stringify({
    backend: 'jellyfin',
    comingSoon: { title: 'overlay-title', moviesCount: 12 },
  }));
  const { url } = await startApp(t, { config: cfg, overlayPath });
  const view = await fetch(`${url}/api/setup`).then(r => r.json());
  assert.equal(view.backend, 'jellyfin', 'overlay backend overrides env');
  assert.equal(view.comingSoon.title, 'overlay-title');
  assert.equal(view.comingSoon.moviesCount, 12);
});

test('POST /api/setup rejects invalid enum values', async (t) => {
  const { url } = await startApp(t);
  const r = await fetch(`${url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend: 'this-is-not-a-backend' }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, 'invalid_setup_payload');
  assert.ok(body.details.includes('backend_invalid'));
});

test('GET /api/config still works alongside overlay (now exposes haUrl + landscape)', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ landscape: true }),
  });
  const cfg = await fetch(`${a.url}/api/config`).then(r => r.json());
  assert.equal(cfg.landscape, true);
  assert.equal(cfg.haUrl, 'http://supervisor/core');
  assert.equal(cfg.haTokenSet, true);
});

// === Pure-function tests (no server) ===

test('sanitizeOverlayInput drops unknown fields', () => {
  const { overlay, errors } = sanitizeOverlayInput({
    backend: 'plex',
    nefarious: 'do bad things',
    comingSoon: { sneaky: 1, title: 'ok' },
  });
  assert.equal(errors.length, 0);
  assert.equal(overlay.backend, 'plex');
  assert.equal('nefarious' in overlay, false);
  assert.equal('sneaky' in overlay.comingSoon, false);
  assert.equal(overlay.comingSoon.title, 'ok');
});

test('mergeOverlay preserves existing secrets when blank, drops blank non-secrets', () => {
  const existing = {
    plexUrl: 'http://old',
    plexToken: 'tok',
    comingSoon: { radarrApiKey: 'rkey' },
  };
  const merged = mergeOverlay(existing, {
    plexUrl: '',           // non-secret blank → clear
    plexToken: '',         // secret blank → preserve
    comingSoon: { radarrApiKey: '' }, // secret blank → preserve
  });
  assert.equal('plexUrl' in merged, false);
  assert.equal(merged.plexToken, 'tok');
  assert.equal(merged.comingSoon.radarrApiKey, 'rkey');
});

test('applyOverlay merges nested objects without mutating base', () => {
  const base = envBaseConfig();
  const baseClone = JSON.parse(JSON.stringify(base));
  const merged = applyOverlay(base, { comingSoon: { tmdb: { apiKey: 'k', region: 'GB' } } });
  assert.equal(merged.comingSoon.tmdb.apiKey, 'k');
  assert.equal(merged.comingSoon.tmdb.region, 'GB');
  // Base must be untouched.
  assert.deepEqual(base, baseClone);
});

// === #100 cinema/theatrical inclusion toggle ===

test('GET /api/setup defaults includeCinemaReleases to true (no overlay) (#100)', async (t) => {
  const { url } = await startApp(t);
  const view = await fetch(`${url}/api/setup`).then(r => r.json());
  assert.equal(view.comingSoon.includeCinemaReleases, true,
    'default must preserve pre-#100 cinema fallback behaviour');
});

test('POST /api/setup persists includeCinemaReleases=false server-side (#100)', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  const resp = await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comingSoon: { includeCinemaReleases: false } }),
  });
  assert.equal(resp.status, 200);

  // Persisted to disk and visible to a fresh process.
  const onDisk = JSON.parse(readFileSync(overlayPath, 'utf8'));
  assert.equal(onDisk.comingSoon.includeCinemaReleases, false,
    'overlay file should hold the new toggle value');

  const b = await startApp(t, { overlayPath });
  const seen = await fetch(`${b.url}/api/setup`).then(r => r.json());
  assert.equal(seen.comingSoon.includeCinemaReleases, false);

  // /api/config also surfaces the value so the kiosk frontend stays in sync.
  const cfg = await fetch(`${b.url}/api/config`).then(r => r.json());
  assert.equal(cfg.comingSoon.includeCinemaReleases, false);
});

test('POST /api/setup can flip includeCinemaReleases back to true (#100)', async (t) => {
  const overlayPath = tmpStorePath(t);
  const a = await startApp(t, { overlayPath });
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comingSoon: { includeCinemaReleases: false } }),
  });
  await fetch(`${a.url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comingSoon: { includeCinemaReleases: true } }),
  });
  const view = await fetch(`${a.url}/api/setup`).then(r => r.json());
  assert.equal(view.comingSoon.includeCinemaReleases, true);
});

test('POST /api/setup rejects non-boolean includeCinemaReleases (#100)', async (t) => {
  const { url } = await startApp(t);
  // asBool() accepts string truthy/falsy synonyms ("true"/"false"); only a
  // genuinely unparseable value (object, number) is rejected as invalid.
  const r = await fetch(`${url}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comingSoon: { includeCinemaReleases: { nope: 1 } } }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.ok(body.details.includes('includeCinemaReleases_invalid'));
});

test('Add-on/Docker default fallback: env var false propagates through to /api/setup (#100)', async (t) => {
  const cfg = envBaseConfig({
    comingSoon: {
      ...envBaseConfig().comingSoon,
      includeCinemaReleases: false,
    },
  });
  const { url } = await startApp(t, { config: cfg });
  const view = await fetch(`${url}/api/setup`).then(r => r.json());
  assert.equal(view.comingSoon.includeCinemaReleases, false);
});

test('effectiveSetupView never includes secret values', () => {
  const cfg = envBaseConfig({
    plexToken: 'plex-secret-7777',
    haToken: 'ha-secret-4444',
    comingSoon: {
      ...envBaseConfig().comingSoon,
      radarrApiKey: 'radarr-secret-1111',
      sonarrApiKey: 'sonarr-secret-2222',
      tmdb: { apiKey: 'tmdb-secret-3333', region: 'AU' },
    },
  });
  const view = effectiveSetupView(cfg);
  const dump = JSON.stringify(view);
  for (const s of [
    'plex-secret-7777', 'ha-secret-4444',
    'radarr-secret-1111', 'sonarr-secret-2222', 'tmdb-secret-3333',
  ]) {
    assert.equal(dump.includes(s), false, `secret ${s} leaked`);
  }
  assert.equal(view.haTokenSet, true);
  assert.equal(view.plex.tokenSet, true);
  assert.equal(view.comingSoon.radarrApiKeySet, true);
  assert.equal(view.comingSoon.sonarrApiKeySet, true);
  assert.equal(view.comingSoon.tmdb.apiKeySet, true);
});
