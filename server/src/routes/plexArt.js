// GET /api/plex-art?path=<plex-path>
//
// Proxies Plex fanart/backdrop images so the browser can render them
// same-origin without ever seeing the Plex token. Used by the #21 backdrop
// feature. Path validation is strict: only paths beginning with '/library/'
// are accepted, which is what Plex emits for `art`/`thumb`/`arts` entries.
// Anything else is rejected to prevent SSRF-style abuse of the proxy.

import { Router } from 'express';

export function plexArtRoute({ config, fetchImpl = globalThis.fetch }) {
  const r = Router();

  r.get('/api/plex-art', async (req, res) => {
    if (!config.plexUrl || !config.plexToken) {
      return res.status(503).json({ error: 'plex_not_configured' });
    }

    const path = String(req.query.path || '');
    if (!path.startsWith('/library/')) {
      return res.status(400).json({ error: 'path_must_be_library_relative' });
    }
    // Reject dot segments (raw or percent-encoded) so a crafted path can't
    // traverse out of /library/ once the URL is normalised, which would
    // expose arbitrary Plex API endpoints with the server's token attached.
    let decodedPath;
    try { decodedPath = decodeURIComponent(path); } catch {
      return res.status(400).json({ error: 'path_malformed' });
    }
    if (/%2e/i.test(path) || /%2e/i.test(decodedPath)
      || decodedPath.includes('..') || decodedPath.includes('\\')) {
      return res.status(400).json({ error: 'path_traversal_rejected' });
    }

    try {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${config.plexUrl}${path}${sep}X-Plex-Token=${encodeURIComponent(config.plexToken)}`;
      const upstream = await fetchImpl(url);
      if (!upstream.ok) return res.status(upstream.status).end();

      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      // Backdrops change rarely per item — cache aggressively so crossfades
      // don't re-download the same jpg every pause cycle.
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.status(502).json({ error: 'plex_unreachable', message: err.message });
    }
  });

  return r;
}
