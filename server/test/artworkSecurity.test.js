import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { artworkRoute, isSafeArtworkPath } from '../src/routes/artwork.js';
import { plexArtRoute } from '../src/routes/plexArt.js';

function fakeUpstream() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(1),
    };
  };
  return { calls, fetchImpl };
}

async function request(app, urlPath) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    return await fetch(`http://127.0.0.1:${port}${urlPath}`);
  } finally {
    server.close();
  }
}

function artworkApp(fetchImpl) {
  const app = express();
  app.use(artworkRoute({
    config: { haUrl: 'http://ha.local:8123', haToken: 'secret' },
    fetchImpl,
  }));
  return app;
}

function plexArtApp(fetchImpl) {
  const app = express();
  app.use(plexArtRoute({
    config: { plexUrl: 'http://plex.local:32400', plexToken: 'ptoken' },
    fetchImpl,
  }));
  return app;
}

test('proxies media_player_proxy artwork paths', async () => {
  const { calls, fetchImpl } = fakeUpstream();
  const res = await request(
    artworkApp(fetchImpl),
    `/api/artwork?path=${encodeURIComponent('/api/media_player_proxy/media_player.plex_x?token=abc&cache=1')}`,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('http://ha.local:8123/api/media_player_proxy/'));
});

test('rejects non-artwork HA API paths (confused deputy)', async () => {
  const { calls, fetchImpl } = fakeUpstream();
  const res = await request(
    artworkApp(fetchImpl),
    `/api/artwork?path=${encodeURIComponent('/api/states')}`,
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('rejects dot-segment traversal out of the artwork prefix', async () => {
  const { calls, fetchImpl } = fakeUpstream();
  for (const raw of [
    '/api/media_player_proxy/../../api/states',
    '/api/media_player_proxy/%2e%2e/%2e%2e/api/states',
    '/api/media_player_proxy/%252e%252e/api/states',
  ]) {
    const res = await request(
      artworkApp(fetchImpl),
      `/api/artwork?path=${encodeURIComponent(raw)}`,
    );
    assert.equal(res.status, 400, `expected 400 for ${raw}`);
  }
  assert.equal(calls.length, 0);
});

test('isSafeArtworkPath allows only allowlisted prefixes', () => {
  assert.equal(isSafeArtworkPath('/api/media_player_proxy/media_player.x?token=t'), true);
  assert.equal(isSafeArtworkPath('/api/image/serve/abc/512x512'), true);
  assert.equal(isSafeArtworkPath('/api/states'), false);
  assert.equal(isSafeArtworkPath('/local/evil.jpg'), false);
  assert.equal(isSafeArtworkPath(''), false);
});

test('plex-art rejects traversal out of /library/', async () => {
  const { calls, fetchImpl } = fakeUpstream();
  for (const raw of [
    '/library/../status/sessions',
    '/library/%2e%2e/status/sessions',
  ]) {
    const res = await request(
      plexArtApp(fetchImpl),
      `/api/plex-art?path=${encodeURIComponent(raw)}`,
    );
    assert.equal(res.status, 400, `expected 400 for ${raw}`);
  }
  assert.equal(calls.length, 0);
});

test('plex-art still proxies legitimate library art', async () => {
  const { calls, fetchImpl } = fakeUpstream();
  const res = await request(
    plexArtApp(fetchImpl),
    `/api/plex-art?path=${encodeURIComponent('/library/metadata/483391/art/1751400000')}`,
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('X-Plex-Token=ptoken'));
});
