// End-to-end style: spin up the Express app with a stub HA client and hit
// the endpoints via an injected fetch. Keeps tests offline and fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createApp } from '../src/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const haStates = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'ha_states.json'), 'utf8'),
);

function baseConfig(overrides = {}) {
  return {
    mode: 'addon',
    port: 0,
    haUrl: 'http://supervisor/core',
    haToken: 'tok',
    plexUrl: 'https://plex.example:32400',
    plexToken: 'ptok',
    plexUsername: 'rusty',
    plexPlayer: 'media_player.plex_plex_for_lg_tv',
    landscape: false,
    theme: 'classic-gold',
    poll: 5000,
    proxySecret: '',
    allowedOrigins: [],
    stateTtl: 3000,
    mediaInfoTtl: 600000,
    comingSoonTtl: 900000,
    displayMode: 'now_showing',
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
    },
    visual: { progressBar: false, ratingsBadges: false, genreChips: false, infoPanelMode: 'on_tap' },
    staticDir: join(__dirname, '..', 'fixtures'),
    ...overrides,
  };
}

function startApp(config, haClient) {
  return new Promise((resolve) => {
    const app = createApp({ config, haClient });
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('GET /api/state returns normalised payload', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const resp = await fetch(`${url}/api/state`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.title, 'Pilot');
    assert.equal(body.seriesTitle, 'Severance');
    assert.equal(body.ratingKey, '12345');
  } finally { server.close(); }
});

test('GET /healthz is always 200', async () => {
  const haClient = { getStates: async () => { throw new Error('HA is down'); } };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const resp = await fetch(`${url}/healthz`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'addon');
  } finally { server.close(); }
});

test('GET /api/state returns 502 when HA is unreachable', async () => {
  const haClient = {
    getStates: async () => {
      const err = new Error('boom'); err.status = 500; throw err;
    },
  };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const resp = await fetch(`${url}/api/state`);
    assert.equal(resp.status, 502);
    const body = await resp.json();
    assert.equal(body.error, 'ha_unreachable');
  } finally { server.close(); }
});

test('PROXY_SECRET middleware blocks requests without the header', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig({ proxySecret: 'sekret' }), haClient);
  try {
    const blocked = await fetch(`${url}/api/state`);
    assert.equal(blocked.status, 401);
    const ok = await fetch(`${url}/api/state`, { headers: { 'x-proxy-secret': 'sekret' } });
    assert.equal(ok.status, 200);
  } finally { server.close(); }
});

test('GET /api/config defaults every visual toggle off', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const resp = await fetch(`${url}/api/config`);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('cache-control'), 'no-store');
    const body = await resp.json();
    assert.deepEqual(body, {
      mode: 'addon',
      managed: true,
      haUrl: 'http://supervisor/core',
      haUrlSet: true,
      haTokenSet: true,
      landscape: false,
      displayMode: 'now_showing',
      backend: 'plex',
      player: '',
      plex: {
        urlSet: true,
        url: 'https://plex.example:32400',
        tokenSet: true,
        username: 'rusty',
      },
      comingSoon: {
        title: 'Coming Soon',
        enabled: false,
        moviesCount: 5,
        showsCount: 5,
        cycleInterval: 8,
        daysOffset: 0,
        lookaheadDays: 90,
        imageType: 'poster',
        includeCinemaReleases: true,
        radarrUrl: '',
        radarrApiKeySet: false,
        sonarrUrl: '',
        sonarrApiKeySet: false,
        tmdb: {
          enabled: false,
          apiKeySet: false,
          region: 'AU',
        },
      },
      visual: {
        progressBar: false,
        ratingsBadges: false,
        genreChips: false,
        infoPanelMode: 'on_tap',
        useBackdrops: false,
        frameStyle: 'bulbs',
        bulbSizePx: 28,
        marqueeFont: 'bebas-neue',
        posterFraming: 'centred',
        filmGrain: false,
        kenBurns: false,
        backdropStyle: 'fullscreen',
        backdropDelayMs: 10000,
        burnInMitigation: false,
        nudgeIntervalMs: 60000,
        nudgeAmplitudePx: 4,
        nightModeEntity: '',
        nightModeOpacity: 0.4,
        theme: 'classic-gold',
        accentColor: '',
        marqueeBgColor: '',
        cornerRadiusPx: 0,
        // #64 — per-section info panel visibility
        infoShowTitle: true,
        infoShowSubtitle: true,
        infoShowMeta: true,
        infoShowSummary: true,
        infoShowTechbox: true,
        infoShowPlayer: true,
      },
    });
  } finally { server.close(); }
});

// #95 — server-side config must survive per-browser localStorage swaps.
// When configured with Radarr/TMDB tokens, /api/config exposes the URLs
// and a `*Set` boolean for the secret without ever leaking the secret
// itself, so the in-app setup form can render canonical state on a fresh
// browser without the user having to re-enter anything.
test('GET /api/config surfaces canonical setup state without leaking secrets', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      mode: 'addon',
      backend: 'jellyfin',
      player: 'media_player.jellyfin_living_room',
      plexUrl: 'https://plex.example:32400',
      plexToken: 'super-secret-plex-token',
      plexUsername: 'rusty',
      comingSoon: {
        title: 'Coming Soon',
        radarrUrl: 'http://radarr.lan:7878',
        radarrApiKey: 'super-secret-radarr-key',
        sonarrUrl: 'http://sonarr.lan:8989',
        sonarrApiKey: 'super-secret-sonarr-key',
        moviesCount: 5,
        showsCount: 5,
        cycleInterval: 8,
        daysOffset: 0,
        lookaheadDays: 90,
        imageType: 'poster',
        tmdb: { apiKey: 'super-secret-tmdb-key', region: 'GB' },
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    // Canonical state surfaces correctly.
    assert.equal(body.mode, 'addon');
    assert.equal(body.managed, true);
    assert.equal(body.backend, 'jellyfin');
    assert.equal(body.player, 'media_player.jellyfin_living_room');
    assert.equal(body.plex.url, 'https://plex.example:32400');
    assert.equal(body.plex.urlSet, true);
    assert.equal(body.plex.tokenSet, true);
    assert.equal(body.plex.username, 'rusty');
    assert.equal(body.comingSoon.radarrUrl, 'http://radarr.lan:7878');
    assert.equal(body.comingSoon.radarrApiKeySet, true);
    assert.equal(body.comingSoon.sonarrUrl, 'http://sonarr.lan:8989');
    assert.equal(body.comingSoon.sonarrApiKeySet, true);
    assert.equal(body.comingSoon.tmdb.enabled, true);
    assert.equal(body.comingSoon.tmdb.apiKeySet, true);
    assert.equal(body.comingSoon.tmdb.region, 'GB');
    // Secrets must never appear anywhere in the response.
    const dump = JSON.stringify(body);
    for (const secret of [
      'super-secret-plex-token',
      'super-secret-radarr-key',
      'super-secret-sonarr-key',
      'super-secret-tmdb-key',
    ]) {
      assert.equal(dump.includes(secret), false, `secret ${secret} leaked into /api/config`);
    }
  } finally { server.close(); }
});

// #95 — when no secrets are set the *Set booleans are false. This is what
// the frontend uses to render "needs configuration" hints (vs "configured"
// when true), so the inverted case matters too.
test('GET /api/config reports *Set booleans as false when secrets are blank', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      plexUrl: '',
      plexToken: '',
      plexUsername: '',
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.plex.urlSet, false);
    assert.equal(body.plex.tokenSet, false);
    assert.equal(body.plex.username, '');
    assert.equal(body.comingSoon.radarrApiKeySet, false);
    assert.equal(body.comingSoon.sonarrApiKeySet, false);
    assert.equal(body.comingSoon.tmdb.apiKeySet, false);
    assert.equal(body.comingSoon.tmdb.enabled, false);
  } finally { server.close(); }
});

// #95 — a fresh browser opening the kiosk on a different origin must be
// able to read all canonical setup fields from /api/config alone, so the
// in-app setup form is never rendered "blank" just because that tablet's
// localStorage hasn't been seeded. This is the regression we want to
// prevent.
test('GET /api/config returns full canonical state on a fresh request (no cookies / no auth)', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      backend: 'plex',
      plexUrl: 'https://plex.example:32400',
      plexUsername: 'rusty',
      comingSoon: {
        title: 'My Coming Soon',
        radarrUrl: 'http://radarr.lan:7878',
        radarrApiKey: 'rk',
        sonarrUrl: '',
        sonarrApiKey: '',
        moviesCount: 7,
        showsCount: 3,
        cycleInterval: 12,
        daysOffset: 0,
        lookaheadDays: 60,
        imageType: 'fanart',
        tmdb: { apiKey: 'tk', region: 'US' },
      },
    }),
    haClient,
  );
  try {
    // No headers at all — simulates the very first phone hitting the
    // ingress URL or the LAN URL without any prior state.
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    // Connection
    assert.equal(body.backend, 'plex');
    assert.equal(body.plex.url, 'https://plex.example:32400');
    assert.equal(body.plex.username, 'rusty');
    // Coming Soon
    assert.equal(body.comingSoon.title, 'My Coming Soon');
    assert.equal(body.comingSoon.radarrUrl, 'http://radarr.lan:7878');
    assert.equal(body.comingSoon.moviesCount, 7);
    assert.equal(body.comingSoon.showsCount, 3);
    assert.equal(body.comingSoon.cycleInterval, 12);
    assert.equal(body.comingSoon.lookaheadDays, 60);
    assert.equal(body.comingSoon.imageType, 'fanart');
    // TMDB
    assert.equal(body.comingSoon.tmdb.enabled, true);
    assert.equal(body.comingSoon.tmdb.region, 'US');
  } finally { server.close(); }
});

test('GET /api exposes the configured backend', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig({ backend: 'jellyfin' }), haClient);
  try {
    const body = await fetch(`${url}/api`).then(r => r.json());
    assert.equal(body.name, 'plex-now-showing-server');
    assert.equal(body.displayMode, 'now_showing');
    assert.equal(body.backend, 'jellyfin');
    assert.equal(body.endpoints.comingSoon, '/api/coming-soon');
  } finally { server.close(); }
});

test('GET /api/coming-soon returns configured upcoming items', async () => {
  const originalFetch = globalThis.fetch;
  const futureRelease = new Date(Date.now() + 14 * 86400000).toISOString();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [{
      id: 1,
      title: 'The Future',
      year: 2026,
      digitalRelease: futureRelease,
      hasFile: false,
      images: [{ coverType: 'poster', remoteUrl: 'https://img/poster.jpg' }],
    }],
  });

  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig({
    comingSoon: {
      title: 'Coming Soon',
      radarrUrl: 'http://radarr.local:7878',
      radarrApiKey: 'rk',
      sonarrUrl: '',
      sonarrApiKey: '',
      moviesCount: 5,
      showsCount: 5,
      cycleInterval: 8,
      daysOffset: 0,
      lookaheadDays: 90,
      imageType: 'poster',
    },
  }), haClient);
  try {
    const resp = await originalFetch(`${url}/api/coming-soon`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.title, 'Coming Soon');
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].title, 'The Future');
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/coming-soon returns 503 when no source is configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const resp = await fetch(`${url}/api/coming-soon`);
    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.equal(body.error, 'coming_soon_not_configured');
  } finally { server.close(); }
});

test('GET /api/config surfaces frameStyle when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        frameStyle: 'gold-line',
        bulbSizePx: 36,
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.frameStyle, 'gold-line');
    assert.equal(body.visual.bulbSizePx, 36);
  } finally { server.close(); }
});

test('GET /api/config surfaces marqueeFont when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        marqueeFont: 'monoton',
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.marqueeFont, 'monoton');
  } finally { server.close(); }
});

test('GET /api/config surfaces theme + accentColor when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        theme: 'neon-80s',
        accentColor: '#ff00aa',
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.theme, 'neon-80s');
    assert.equal(body.visual.accentColor, '#ff00aa');
  } finally { server.close(); }
});

test('GET /api/config surfaces marqueeBgColor when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        marqueeBgColor: '#10233d',
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.marqueeBgColor, '#10233d');
  } finally { server.close(); }
});

test('GET /api/config surfaces cornerRadiusPx when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false,
        ratingsBadges: false,
        infoPanelMode: 'on_tap',
        cornerRadiusPx: 24,
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.cornerRadiusPx, 24);
  } finally { server.close(); }
});

test('GET /api/config surfaces burn-in fields when configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false,
        ratingsBadges: false,
        infoPanelMode: 'on_tap',
        burnInMitigation: true,
        nudgeIntervalMs: 30000,
        nudgeAmplitudePx: 6,
        nightModeEntity: 'input_boolean.bedroom_dim',
        nightModeOpacity: 0.5,
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.burnInMitigation, true);
    assert.equal(body.visual.nudgeIntervalMs, 30000);
    assert.equal(body.visual.nudgeAmplitudePx, 6);
    assert.equal(body.visual.nightModeEntity, 'input_boolean.bedroom_dim');
    assert.equal(body.visual.nightModeOpacity, 0.5);
  } finally { server.close(); }
});

test('GET /api/night-mode reports configured:false when no entity is set', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    const r = await fetch(`${url}/api/night-mode`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j, { configured: false, on: false });
  } finally { server.close(); }
});

test('GET /api/night-mode returns on=true when entity is on', async () => {
  const states = [
    { entity_id: 'input_boolean.bedroom_dim', state: 'on' },
    ...haStates,
  ];
  const haClient = { getStates: async () => states };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        burnInMitigation: true, nudgeIntervalMs: 60000, nudgeAmplitudePx: 4,
        nightModeEntity: 'input_boolean.bedroom_dim', nightModeOpacity: 0.4,
      },
    }),
    haClient,
  );
  try {
    const j = await fetch(`${url}/api/night-mode`).then(r => r.json());
    assert.deepEqual(j, { configured: true, on: true });
  } finally { server.close(); }
});

test('GET /api/night-mode returns on=false when entity is off or missing', async () => {
  const states = [
    { entity_id: 'input_boolean.bedroom_dim', state: 'off' },
    ...haStates,
  ];
  const haClient = { getStates: async () => states };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        burnInMitigation: true, nudgeIntervalMs: 60000, nudgeAmplitudePx: 4,
        nightModeEntity: 'input_boolean.bedroom_dim', nightModeOpacity: 0.4,
      },
    }),
    haClient,
  );
  try {
    const off = await fetch(`${url}/api/night-mode`).then(r => r.json());
    assert.deepEqual(off, { configured: true, on: false });
  } finally { server.close(); }

  // Now with a missing entity — server reports on:false rather than 404, so
  // a typo in config doesn't permanently dim the kiosk.
  const noEntityClient = { getStates: async () => haStates };
  const { server: s2, url: url2 } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        burnInMitigation: true, nudgeIntervalMs: 60000, nudgeAmplitudePx: 4,
        nightModeEntity: 'input_boolean.does_not_exist', nightModeOpacity: 0.4,
      },
    }),
    noEntityClient,
  );
  try {
    const j = await fetch(`${url2}/api/night-mode`).then(r => r.json());
    assert.deepEqual(j, { configured: true, on: false });
  } finally { s2.close(); }
});

test('GET /api/night-mode degrades to on:false when HA throws', async () => {
  const haClient = { getStates: async () => { throw new Error('HA down'); } };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false, ratingsBadges: false, infoPanelMode: 'on_tap',
        burnInMitigation: true, nudgeIntervalMs: 60000, nudgeAmplitudePx: 4,
        nightModeEntity: 'input_boolean.bedroom_dim', nightModeOpacity: 0.4,
      },
    }),
    haClient,
  );
  try {
    const j = await fetch(`${url}/api/night-mode`).then(r => r.json());
    assert.equal(j.configured, true);
    assert.equal(j.on, false);
    assert.ok(j.error && /HA down/.test(j.error));
  } finally { server.close(); }
});

test('GET /api/config reflects server-side visual toggle state', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ visual: { progressBar: true, ratingsBadges: false } }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.progressBar, true);
    assert.equal(body.visual.ratingsBadges, false);
  } finally { server.close(); }
});

test('GET /api/config surfaces infoPanelMode when set', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ visual: { progressBar: false, ratingsBadges: false, infoPanelMode: 'on_pause' } }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.infoPanelMode, 'on_pause');
  } finally { server.close(); }
});

test('GET /api/config surfaces ratingsBadges when enabled', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ visual: { progressBar: false, ratingsBadges: true } }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.ratingsBadges, true);
  } finally { server.close(); }
});

test('GET /api/config surfaces genreChips when enabled', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ visual: { progressBar: false, ratingsBadges: false, genreChips: true } }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.genreChips, true);
    assert.equal(body.visual.progressBar, false);
    assert.equal(body.visual.ratingsBadges, false);
  } finally { server.close(); }
});

// ===== #21 backdrop — /api/plex-art proxy + /api/config surfacing =====

test('GET /api/config surfaces all backdrop fields when set', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({
      visual: {
        progressBar: false,
        ratingsBadges: false,
        infoPanelMode: 'on_tap',
        useBackdrops: true,
        backdropStyle: 'ambient',
        backdropDelayMs: 15000,
      },
    }),
    haClient,
  );
  try {
    const body = await fetch(`${url}/api/config`).then(r => r.json());
    assert.equal(body.visual.useBackdrops, true);
    assert.equal(body.visual.backdropStyle, 'ambient');
    assert.equal(body.visual.backdropDelayMs, 15000);
  } finally { server.close(); }
});

test('GET /api/plex-art rejects paths not starting with /library/', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(baseConfig(), haClient);
  try {
    // Classic SSRF vector: attacker tries to redirect the proxy off-host.
    const cases = [
      '/etc/passwd',
      'http://evil.example/',
      '/../library/metadata/1/art',
      '',
    ];
    for (const path of cases) {
      const resp = await fetch(`${url}/api/plex-art?path=${encodeURIComponent(path)}`);
      assert.equal(resp.status, 400, `path ${path} should 400`);
    }
  } finally { server.close(); }
});

test('GET /api/plex-art returns 503 when plex is not configured', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ plexUrl: '', plexToken: '' }),
    haClient,
  );
  try {
    const resp = await fetch(`${url}/api/plex-art?path=/library/metadata/1/art/123`);
    assert.equal(resp.status, 503);
  } finally { server.close(); }
});

test('ALLOWED_ORIGINS blocks requests from other origins', async () => {
  const haClient = { getStates: async () => haStates };
  const { server, url } = await startApp(
    baseConfig({ allowedOrigins: ['https://kiosk.example'] }),
    haClient,
  );
  try {
    const blocked = await fetch(`${url}/api/state`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403);
    const ok = await fetch(`${url}/api/state`, { headers: { Origin: 'https://kiosk.example' } });
    assert.equal(ok.status, 200);
    // No Origin header (same-origin) must still work
    const same = await fetch(`${url}/api/state`);
    assert.equal(same.status, 200);
  } finally { server.close(); }
});
