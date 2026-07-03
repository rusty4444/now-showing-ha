// GET /api/artwork?path=<HA-relative path>
//
// Pipes artwork (entity_picture, /api/media_player_proxy/...) from HA to the
// browser so the kiosk can render it same-origin without knowing the HA
// token. Only HA-relative paths are accepted.
//
// The frontend never calls this directly; state.js rewrites artwork URLs in
// the /api/state payload to hit here.

import { Router } from 'express';

// Only the artwork endpoints state.js actually emits may be proxied. The
// add-on token grants full HA API access, so anything broader turns this
// route into a confused deputy (e.g. ?path=/api/states would dump every
// entity to an unauthenticated caller on the direct port).
const ALLOWED_PREFIXES = ['/api/media_player_proxy/', '/api/image/serve/'];

export function isSafeArtworkPath(path) {
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return false;
  // Reject dot segments in raw or percent-encoded form: the WHATWG URL
  // parser treats `..` and `%2e%2e` (any case) as traversal, which would
  // let a crafted path escape the allowlisted prefix after normalisation.
  if (/%2e/i.test(path) || path.includes('\\')) return false;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  // Check the decoded form too so double-encoding (%252e → %2e) can't
  // smuggle a dot segment past the raw-string check.
  if (/%2e/i.test(decoded) || decoded.includes('..') || decoded.includes('\\')) return false;
  return true;
}

export function artworkRoute({ config, fetchImpl = globalThis.fetch }) {
  const r = Router();

  r.get('/api/artwork', async (req, res) => {
    const path = String(req.query.path || '');
    if (!isSafeArtworkPath(path)) {
      return res.status(400).json({ error: 'path_must_be_artwork_relative' });
    }

    try {
      const upstream = await fetchImpl(`${config.haUrl}${path}`, {
        headers: { Authorization: `Bearer ${config.haToken}` },
      });
      if (!upstream.ok) return res.status(upstream.status).end();

      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=300');

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.status(502).json({ error: 'artwork_unreachable', message: err.message });
    }
  });

  return r;
}
