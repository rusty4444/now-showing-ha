// /api/setup — server-side persistent configuration editor (#98).
//
// GET  /api/setup             returns the effective non-secret config plus
//                              *Set booleans for every secret. Same shape as
//                              GET /api/config but with the extras the setup
//                              overlay needs (haUrlSet, switcher fields, …).
//
// POST /api/setup             accepts a JSON body of overlay updates. Only
//                              fields listed in OVERLAY_*_KEYS are honoured;
//                              everything else is ignored. Blank secret
//                              fields preserve existing saved/env secrets so
//                              the user can edit non-secret fields without
//                              re-typing tokens. Returns 200 + the new
//                              effective config on success.
//
// POST /api/setup/reset       deletes the overlay file. The next GET reflects
//                              env/options defaults again. Body is ignored.
//
// The store and the loaded config are passed in by createApp() so the route
// can both read the merged effective view and refresh it after a save by
// re-applying the overlay over the env baseline.

import express, { Router } from 'express';
import {
  OVERLAY_TOP_KEYS, OVERLAY_TOP_SECRET_KEYS,
  OVERLAY_COMING_SOON_KEYS, OVERLAY_COMING_SOON_SECRET_KEYS,
  OVERLAY_TMDB_KEYS, OVERLAY_TMDB_SECRET_KEYS,
  OVERLAY_VISUAL_KEYS,
  applyOverlay,
} from '../overlayStore.js';

// Whitelisted enum values — match config.js.
const DISPLAY_MODES = ['now_showing', 'coming_soon'];
const BACKENDS = ['plex', 'jellyfin', 'emby', 'kodi', 'apple_tv', 'streaming', 'kaleidescape'];
const IMAGE_TYPES = ['poster', 'fanart'];
const INFO_PANEL_MODES = ['on_tap', 'on_pause', 'always'];
const FRAME_STYLES = ['bulbs', 'gold-line', 'none'];
const MARQUEE_FONTS = ['bebas-neue', 'anton', 'oswald', 'monoton', 'playfair-display'];
const BACKDROP_STYLES = ['fullscreen', 'ambient'];
const VISUAL_THEMES = ['classic-gold', 'art-deco-silver', 'neon-80s', 'minimalist-dark'];
const POSTER_FRAMINGS = ['centred', 'cover', 'matted'];

const HEX_RE = /^#[0-9a-f]{6}$/;
const REGION_RE = /^[A-Z]{2}$/;

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}
function clampFloat(v, min, max) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}
function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(1|true|yes|on)$/i.test(v);
  return null;
}
function asString(v, max = 1024) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length <= max ? s : s.slice(0, max);
}

// Convert a raw POST body into the on-disk overlay JSON shape. Only fields
// the schema knows about are forwarded; unknowns are silently dropped so a
// hostile client can't smuggle in extras. Secrets are merged separately by
// the route handler so blank values can preserve existing ones.
export function sanitizeOverlayInput(body) {
  if (!body || typeof body !== 'object') return { overlay: {}, errors: ['body_must_be_object'] };
  const errors = [];
  const out = {};

  // Top level non-secret
  for (const k of OVERLAY_TOP_KEYS) {
    if (!(k in body)) continue;
    const raw = body[k];
    switch (k) {
      case 'haUrl':
      case 'plexUrl': {
        const s = asString(raw);
        if (s === null) { errors.push(`${k}_invalid`); break; }
        // Allow blank string to mean "clear this override" — we drop empties
        // when writing so they fall back to env. Strip trailing slash to
        // match loadConfig() normalisation.
        out[k] = s.replace(/\/$/, '');
        break;
      }
      case 'displayMode': {
        const s = asString(raw);
        if (s && !DISPLAY_MODES.includes(s)) { errors.push('displayMode_invalid'); break; }
        if (s !== null) out[k] = s;
        break;
      }
      case 'backend': {
        const s = asString(raw);
        if (s && !BACKENDS.includes(s)) { errors.push('backend_invalid'); break; }
        if (s !== null) out[k] = s;
        break;
      }
      case 'player':
      case 'plexUsername':
      case 'fullyKiosksRaw': {
        const s = asString(raw, 8192);
        if (s !== null) out[k] = s;
        break;
      }
      case 'landscape':
      case 'switcherEnabled': {
        const b = asBool(raw);
        if (b === null) { errors.push(`${k}_invalid`); break; }
        out[k] = b;
        break;
      }
      case 'switcherIntervalMs': {
        const n = clampInt(raw, 1000, 60000);
        if (n === null) { errors.push(`${k}_invalid`); break; }
        out[k] = n;
        break;
      }
    }
  }

  // Top level secrets — the route applies the blank-preserves rule, but we
  // still validate type here.
  for (const k of OVERLAY_TOP_SECRET_KEYS) {
    if (!(k in body)) continue;
    const s = asString(body[k], 8192);
    if (s === null) { errors.push(`${k}_invalid`); continue; }
    out[k] = s;
  }

  // Coming Soon
  if (body.comingSoon && typeof body.comingSoon === 'object') {
    const cs = body.comingSoon;
    out.comingSoon = {};
    for (const k of OVERLAY_COMING_SOON_KEYS) {
      if (!(k in cs)) continue;
      const raw = cs[k];
      switch (k) {
        case 'title': {
          const s = asString(raw, 256);
          if (s !== null) out.comingSoon[k] = s;
          break;
        }
        case 'radarrUrl':
        case 'sonarrUrl': {
          const s = asString(raw);
          if (s !== null) out.comingSoon[k] = s.replace(/\/$/, '');
          break;
        }
        case 'imageType': {
          const s = asString(raw);
          if (s && !IMAGE_TYPES.includes(s)) { errors.push('imageType_invalid'); break; }
          if (s !== null) out.comingSoon[k] = s;
          break;
        }
        case 'moviesCount':
        case 'showsCount': {
          const n = clampInt(raw, 0, 50);
          if (n === null) { errors.push(`${k}_invalid`); break; }
          out.comingSoon[k] = n;
          break;
        }
        case 'cycleInterval': {
          const n = clampInt(raw, 2, 300);
          if (n === null) { errors.push(`${k}_invalid`); break; }
          out.comingSoon[k] = n;
          break;
        }
        case 'daysOffset': {
          const n = clampInt(raw, 0, 365);
          if (n === null) { errors.push(`${k}_invalid`); break; }
          out.comingSoon[k] = n;
          break;
        }
        case 'lookaheadDays': {
          const n = clampInt(raw, 1, 365);
          if (n === null) { errors.push(`${k}_invalid`); break; }
          out.comingSoon[k] = n;
          break;
        }
        case 'includeCinemaReleases': {
          const b = asBool(raw);
          if (b === null) { errors.push(`${k}_invalid`); break; }
          out.comingSoon[k] = b;
          break;
        }
      }
    }
    for (const k of OVERLAY_COMING_SOON_SECRET_KEYS) {
      if (!(k in cs)) continue;
      const s = asString(cs[k], 8192);
      if (s === null) { errors.push(`${k}_invalid`); continue; }
      out.comingSoon[k] = s;
    }
    if (cs.tmdb && typeof cs.tmdb === 'object') {
      out.comingSoon.tmdb = {};
      for (const k of OVERLAY_TMDB_KEYS) {
        if (!(k in cs.tmdb)) continue;
        if (k === 'region') {
          const s = asString(cs.tmdb[k], 4);
          if (s === null) continue;
          if (s === '') { out.comingSoon.tmdb[k] = ''; break; }
          const upper = s.toUpperCase();
          if (!REGION_RE.test(upper)) { errors.push('tmdb_region_invalid'); break; }
          out.comingSoon.tmdb[k] = upper;
        }
      }
      for (const k of OVERLAY_TMDB_SECRET_KEYS) {
        if (!(k in cs.tmdb)) continue;
        const s = asString(cs.tmdb[k], 8192);
        if (s === null) { errors.push(`tmdb_${k}_invalid`); continue; }
        out.comingSoon.tmdb[k] = s;
      }
    }
  }

  // Visual
  if (body.visual && typeof body.visual === 'object') {
    const v = body.visual;
    out.visual = {};
    for (const k of OVERLAY_VISUAL_KEYS) {
      if (!(k in v)) continue;
      const raw = v[k];
      switch (k) {
        case 'posterFraming': {
          const s = asString(raw);
          if (s && !POSTER_FRAMINGS.includes(s)) { errors.push('visual_posterFraming_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'filmGrain':
        case 'kenBurns':
        case 'infoShowTitle':
        case 'infoShowSubtitle':
        case 'infoShowMeta':
        case 'infoShowSummary':
        case 'infoShowTechbox':
        case 'infoShowPlayer':
        case 'progressBar':
        case 'ratingsBadges':
        case 'genreChips':
        case 'useBackdrops':
        case 'burnInMitigation': {
          const b = asBool(raw);
          if (b === null) { errors.push(`visual_${k}_invalid`); break; }
          out.visual[k] = b;
          break;
        }
        case 'infoPanelMode': {
          const s = asString(raw);
          if (s && !INFO_PANEL_MODES.includes(s)) { errors.push('visual_infoPanelMode_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'frameStyle': {
          const s = asString(raw);
          if (s && !FRAME_STYLES.includes(s)) { errors.push('visual_frameStyle_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'marqueeFont': {
          const s = asString(raw);
          if (s && !MARQUEE_FONTS.includes(s)) { errors.push('visual_marqueeFont_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'backdropStyle': {
          const s = asString(raw);
          if (s && !BACKDROP_STYLES.includes(s)) { errors.push('visual_backdropStyle_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'theme': {
          const s = asString(raw);
          if (s && !VISUAL_THEMES.includes(s)) { errors.push('visual_theme_invalid'); break; }
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'bulbSizePx': {
          const n = clampInt(raw, 12, 48);
          if (n === null) { errors.push('visual_bulbSizePx_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'backdropDelayMs': {
          const n = clampInt(raw, 1000, 600000);
          if (n === null) { errors.push('visual_backdropDelayMs_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'nudgeIntervalMs': {
          const n = clampInt(raw, 5000, 600000);
          if (n === null) { errors.push('visual_nudgeIntervalMs_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'nudgeAmplitudePx': {
          const n = clampInt(raw, 1, 16);
          if (n === null) { errors.push('visual_nudgeAmplitudePx_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'cornerRadiusPx': {
          const n = clampInt(raw, 0, 48);
          if (n === null) { errors.push('visual_cornerRadiusPx_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'nightModeOpacity': {
          const n = clampFloat(raw, 0, 0.95);
          if (n === null) { errors.push('visual_nightModeOpacity_invalid'); break; }
          out.visual[k] = n;
          break;
        }
        case 'nightModeEntity': {
          const s = asString(raw, 256);
          if (s !== null) out.visual[k] = s;
          break;
        }
        case 'accentColor':
        case 'marqueeBgColor': {
          const s = asString(raw, 16);
          if (s === null) { errors.push(`visual_${k}_invalid`); break; }
          if (s === '') { out.visual[k] = ''; break; }
          const lower = s.toLowerCase();
          if (!HEX_RE.test(lower)) { errors.push(`visual_${k}_invalid`); break; }
          out.visual[k] = lower;
          break;
        }
      }
    }
  }

  return { overlay: out, errors };
}

// Merge `incoming` over `existing` overlay JSON. Drops blank non-secret
// strings so the user can clear an override; keeps existing secret values
// when the incoming secret is blank. Empty strings for secrets are an
// explicit "clear" signal only when `clearSecrets` is true (used by the
// reset endpoint).
export function mergeOverlay(existing = {}, incoming = {}) {
  const out = JSON.parse(JSON.stringify(existing || {}));

  // Top level non-secret
  for (const k of OVERLAY_TOP_KEYS) {
    if (!(k in incoming)) continue;
    const v = incoming[k];
    if (typeof v === 'string' && v === '') delete out[k];
    else out[k] = v;
  }
  // Top level secrets — blank preserves existing
  for (const k of OVERLAY_TOP_SECRET_KEYS) {
    if (!(k in incoming)) continue;
    const v = incoming[k];
    if (typeof v === 'string' && v === '') continue;
    out[k] = v;
  }

  if (incoming.comingSoon) {
    out.comingSoon = { ...(out.comingSoon || {}) };
    for (const k of OVERLAY_COMING_SOON_KEYS) {
      if (!(k in incoming.comingSoon)) continue;
      const v = incoming.comingSoon[k];
      if (typeof v === 'string' && v === '') delete out.comingSoon[k];
      else out.comingSoon[k] = v;
    }
    for (const k of OVERLAY_COMING_SOON_SECRET_KEYS) {
      if (!(k in incoming.comingSoon)) continue;
      const v = incoming.comingSoon[k];
      if (typeof v === 'string' && v === '') continue;
      out.comingSoon[k] = v;
    }
    if (incoming.comingSoon.tmdb) {
      out.comingSoon.tmdb = { ...((out.comingSoon && out.comingSoon.tmdb) || {}) };
      for (const k of OVERLAY_TMDB_KEYS) {
        if (!(k in incoming.comingSoon.tmdb)) continue;
        const v = incoming.comingSoon.tmdb[k];
        if (typeof v === 'string' && v === '') delete out.comingSoon.tmdb[k];
        else out.comingSoon.tmdb[k] = v;
      }
      for (const k of OVERLAY_TMDB_SECRET_KEYS) {
        if (!(k in incoming.comingSoon.tmdb)) continue;
        const v = incoming.comingSoon.tmdb[k];
        if (typeof v === 'string' && v === '') continue;
        out.comingSoon.tmdb[k] = v;
      }
    }
  }

  if (incoming.visual) {
    out.visual = { ...(out.visual || {}) };
    for (const k of OVERLAY_VISUAL_KEYS) {
      if (!(k in incoming.visual)) continue;
      const v = incoming.visual[k];
      // Blank string = clear the override; the rest are passed through (a
      // boolean false is a real saved value, not "unset").
      if (typeof v === 'string' && v === '' && !['accentColor', 'marqueeBgColor'].includes(k)) {
        delete out.visual[k];
      } else {
        out.visual[k] = v;
      }
    }
  }

  return out;
}

// Build the response body for GET /api/setup. Same as /api/config but with
// the extra fields the overlay needs (haUrlSet, fullyKiosksRaw, etc.).
export function effectiveSetupView(config) {
  return {
    mode: config.mode || 'standalone',
    managed: !!config.haToken,
    haUrl: config.haUrl || '',
    haUrlSet: !!config.haUrl,
    haTokenSet: !!config.haToken,
    displayMode: config.displayMode || 'now_showing',
    backend: config.backend || 'plex',
    player: config.player || '',
    landscape: !!config.landscape,
    plex: {
      urlSet: !!config.plexUrl,
      url: config.plexUrl || '',
      tokenSet: !!config.plexToken,
      username: config.plexUsername || '',
    },
    comingSoon: {
      title: config.comingSoon?.title || 'Coming Soon',
      enabled: !!((config.comingSoon?.radarrUrl && config.comingSoon?.radarrApiKey)
        || (config.comingSoon?.sonarrUrl && config.comingSoon?.sonarrApiKey)),
      moviesCount: config.comingSoon?.moviesCount ?? 5,
      showsCount: config.comingSoon?.showsCount ?? 5,
      cycleInterval: config.comingSoon?.cycleInterval ?? 8,
      daysOffset: config.comingSoon?.daysOffset ?? 0,
      lookaheadDays: config.comingSoon?.lookaheadDays ?? 90,
      imageType: config.comingSoon?.imageType || 'poster',
      // #100 — default true preserves existing installs' cinema/theatrical
      // fallback behaviour. Only `false` (explicitly disabled) suppresses it.
      includeCinemaReleases: config.comingSoon?.includeCinemaReleases !== false,
      radarrUrl: config.comingSoon?.radarrUrl || '',
      radarrApiKeySet: !!config.comingSoon?.radarrApiKey,
      sonarrUrl: config.comingSoon?.sonarrUrl || '',
      sonarrApiKeySet: !!config.comingSoon?.sonarrApiKey,
      tmdb: {
        enabled: !!config.comingSoon?.tmdb?.apiKey,
        apiKeySet: !!config.comingSoon?.tmdb?.apiKey,
        region: config.comingSoon?.tmdb?.region || 'AU',
      },
    },
    visual: {
      progressBar: !!config.visual?.progressBar,
      ratingsBadges: !!config.visual?.ratingsBadges,
      genreChips: !!config.visual?.genreChips,
      infoPanelMode: config.visual?.infoPanelMode || 'on_tap',
      useBackdrops: !!config.visual?.useBackdrops,
      frameStyle: config.visual?.frameStyle || 'bulbs',
      bulbSizePx: config.visual?.bulbSizePx ?? 28,
      marqueeFont: config.visual?.marqueeFont || 'bebas-neue',
      posterFraming: config.visual?.posterFraming || 'centred',
      filmGrain: !!config.visual?.filmGrain,
      kenBurns: !!config.visual?.kenBurns,
      backdropStyle: config.visual?.backdropStyle || 'fullscreen',
      backdropDelayMs: Number.isFinite(config.visual?.backdropDelayMs) ? config.visual.backdropDelayMs : 10000,
      burnInMitigation: !!config.visual?.burnInMitigation,
      nudgeIntervalMs: config.visual?.nudgeIntervalMs ?? 60000,
      nudgeAmplitudePx: config.visual?.nudgeAmplitudePx ?? 4,
      nightModeEntity: config.visual?.nightModeEntity || '',
      nightModeOpacity: config.visual?.nightModeOpacity ?? 0.4,
      theme: config.visual?.theme || 'classic-gold',
      accentColor: config.visual?.accentColor || '',
      marqueeBgColor: config.visual?.marqueeBgColor || '',
      cornerRadiusPx: config.visual?.cornerRadiusPx ?? 0,
      // #64 — per-section info panel visibility
      infoShowTitle: config.visual?.infoShowTitle !== false,
      infoShowSubtitle: config.visual?.infoShowSubtitle !== false,
      infoShowMeta: config.visual?.infoShowMeta !== false,
      infoShowSummary: config.visual?.infoShowSummary !== false,
      infoShowTechbox: config.visual?.infoShowTechbox !== false,
      infoShowPlayer: config.visual?.infoShowPlayer !== false,
    },
    switcher: {
      enabled: !!config.switcherEnabled,
      intervalMs: config.switcherIntervalMs ?? 5000,
      kiosksRawSet: !!config.fullyKiosksRaw,
    },
  };
}

// Replace each top-level field of `target` with the corresponding field of
// `next`, recursively for the two nested objects we care about. Keeps the
// same object reference so other routes that captured `config` see the
// updated values on their next request.
function mutateInPlace(target, next) {
  if (!target || !next) return;
  for (const k of Object.keys(target)) {
    if (k === 'comingSoon' || k === 'visual') continue;
    if (!(k in next)) delete target[k];
  }
  for (const k of Object.keys(next)) {
    if (k === 'comingSoon' || k === 'visual') continue;
    target[k] = next[k];
  }
  // comingSoon (and its tmdb sub-object)
  if (!target.comingSoon) target.comingSoon = {};
  for (const k of Object.keys(target.comingSoon)) {
    if (k === 'tmdb') continue;
    if (!next.comingSoon || !(k in next.comingSoon)) delete target.comingSoon[k];
  }
  for (const k of Object.keys(next.comingSoon || {})) {
    if (k === 'tmdb') continue;
    target.comingSoon[k] = next.comingSoon[k];
  }
  if (!target.comingSoon.tmdb) target.comingSoon.tmdb = {};
  const nextTmdb = (next.comingSoon && next.comingSoon.tmdb) || {};
  for (const k of Object.keys(target.comingSoon.tmdb)) {
    if (!(k in nextTmdb)) delete target.comingSoon.tmdb[k];
  }
  for (const k of Object.keys(nextTmdb)) target.comingSoon.tmdb[k] = nextTmdb[k];
  // visual
  if (!target.visual) target.visual = {};
  for (const k of Object.keys(target.visual)) {
    if (!next.visual || !(k in next.visual)) delete target.visual[k];
  }
  for (const k of Object.keys(next.visual || {})) target.visual[k] = next.visual[k];
}

export function setupRoute({ baseConfig, liveConfig, store, eventBus }) {
  const r = Router();

  r.get('/api/setup', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(effectiveSetupView(liveConfig));
  });

  r.post('/api/setup', express.json({ limit: '256kb' }), (req, res) => {
    const { overlay, errors } = sanitizeOverlayInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'invalid_setup_payload', details: errors });
    }
    try {
      const existing = store.read();
      const merged = mergeOverlay(existing, overlay);
      store.write(merged);
      const effective = applyOverlay(baseConfig, merged);
      mutateInPlace(liveConfig, effective);
      const view = effectiveSetupView(liveConfig);
      if (eventBus) eventBus.broadcast({ type: 'config_changed', config: view });
      return res.json(view);
    } catch (err) {
      console.error('[setup] save failed:', err.message);
      return res.status(500).json({ error: 'setup_save_failed', message: err.message });
    }
  });

  r.post('/api/setup/reset', (_req, res) => {
    try {
      store.clear();
      const effective = applyOverlay(baseConfig, {});
      mutateInPlace(liveConfig, effective);
      const view = effectiveSetupView(liveConfig);
      if (eventBus) eventBus.broadcast({ type: 'config_changed', config: view });
      return res.json(view);
    } catch (err) {
      console.error('[setup] reset failed:', err.message);
      return res.status(500).json({ error: 'setup_reset_failed', message: err.message });
    }
  });

  return r;
}
