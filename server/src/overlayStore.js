// Persistent overlay-config store (#98).
//
// Storage rationale:
//   The HA add-on mounts /data, which survives add-on updates and HA restarts
//   (Supervisor never wipes it). Docker users who want overlay persistence
//   bind-mount a host directory at /data (or set OVERLAY_CONFIG_PATH to a
//   different file). HACS-only installs have no server, so this module is
//   never loaded there.
//
// Precedence:
//   The file holds the *user-edited* values from the in-app setup overlay.
//   They override the env/options defaults that loadConfig() resolves first.
//   A blank/cleared field in the overlay file means "fall back to env"; we
//   never write empty strings for fields the user left blank, so removing a
//   key from the file is the explicit clear/reset path.
//
// Secret handling:
//   Secrets live alongside non-secret fields but are never returned by the
//   overlay-aware /api/config or /api/setup endpoints — only their *Set
//   booleans are. POST /api/setup leaves a blank secret untouched (so the
//   user can edit a non-secret field without re-typing the token); an
//   explicit reset endpoint is the only way to clear them.
//
// The file is plain JSON, atomically rewritten with tmp+rename so a crash
// mid-write can't corrupt it.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

// Fields the overlay is allowed to write. Anything outside this list is
// dropped on save — defence in depth against a tampered POST body trying to
// set fields the schema doesn't expose.
//
// Secret keys are listed separately so handlePost() can apply the
// "blank preserves existing" rule without having to know the wider schema.
export const OVERLAY_TOP_KEYS = [
  'haUrl',
  'displayMode',
  'backend',
  'player',
  'plexUrl',
  'plexUsername',
  'landscape',
  'switcherEnabled',
  'switcherIntervalMs',
  'fullyKiosksRaw',
];

export const OVERLAY_TOP_SECRET_KEYS = [
  'haToken',
  'plexToken',
];

export const OVERLAY_COMING_SOON_KEYS = [
  'title',
  'radarrUrl',
  'sonarrUrl',
  'moviesCount',
  'showsCount',
  'cycleInterval',
  'daysOffset',
  'lookaheadDays',
  'imageType',
  // #100 — boolean toggle. Default true preserves the pre-#100 cinema/
  // theatrical fallback behaviour; false strips cinema/theatrical entirely.
  'includeCinemaReleases',
];

export const OVERLAY_COMING_SOON_SECRET_KEYS = [
  'radarrApiKey',
  'sonarrApiKey',
];

export const OVERLAY_TMDB_KEYS = ['region'];
export const OVERLAY_TMDB_SECRET_KEYS = ['apiKey'];

export const OVERLAY_VISUAL_KEYS = [
  'progressBar',
  'showPosterTitle',
  'ratingsBadges',
  'genreChips',
  'infoPanelMode',
  'useBackdrops',
  'frameStyle',
  'bulbSizePx',
  'marqueeFont',
  'posterFraming',
  'filmGrain',
  'kenBurns',
  'backdropStyle',
  'backdropDelayMs',
  'burnInMitigation',
  'nudgeIntervalMs',
  'nudgeAmplitudePx',
  'nightModeEntity',
  'nightModeOpacity',
  'theme',
  'accentColor',
  'marqueeBgColor',
  'cornerRadiusPx',
  // #64 — per-section info panel visibility
  'infoShowTitle',
  'infoShowSubtitle',
  'infoShowMeta',
  'infoShowSummary',
  'infoShowTechbox',
  'infoShowPlayer',
];

export function defaultOverlayPath() {
  // /data is the conventional add-on persistent path; if it exists we use it
  // even outside add-on mode (Docker users who bind-mount it pick this up).
  // Otherwise fall back to the repo-local path used in tests.
  return process.env.OVERLAY_CONFIG_PATH || '/data/overlay.json';
}

export function createOverlayStore(filePath = defaultOverlayPath()) {
  function read() {
    try {
      if (!existsSync(filePath)) return {};
      const raw = readFileSync(filePath, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (err) {
      // Don't crash the server because of a malformed overlay file — that
      // would lock the user out of the setup UI that fixes it. Log and act
      // as if no overlay is present so env defaults apply.
      console.warn(`[overlay] failed to read ${filePath}: ${err.message}`);
      return {};
    }
  }

  function write(obj) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch (_) { /* ignore */ }
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj || {}, null, 2));
    renameSync(tmp, filePath);
  }

  function clear() {
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      console.warn(`[overlay] failed to clear ${filePath}: ${err.message}`);
    }
  }

  return { read, write, clear, filePath };
}

// Apply overlay JSON over a base config produced by loadConfig(). Returns
// a new config object — never mutates the input. Empty strings in the
// overlay are treated as "not set" so users can blank a non-secret field
// to fall back to env (and so a stale empty token can't accidentally
// override a working env token).
export function applyOverlay(baseConfig, overlay) {
  if (!overlay || typeof overlay !== 'object') return baseConfig;
  const out = { ...baseConfig };
  out.comingSoon = { ...(baseConfig.comingSoon || {}) };
  out.comingSoon.tmdb = { ...((baseConfig.comingSoon && baseConfig.comingSoon.tmdb) || {}) };
  out.visual = { ...(baseConfig.visual || {}) };

  const overrideString = (target, src, key) => {
    const v = src[key];
    if (typeof v === 'string' && v.length > 0) target[key] = v;
  };
  const overrideBool = (target, src, key) => {
    if (typeof src[key] === 'boolean') target[key] = src[key];
  };
  const overrideNumber = (target, src, key) => {
    if (typeof src[key] === 'number' && Number.isFinite(src[key])) target[key] = src[key];
  };

  for (const k of OVERLAY_TOP_KEYS) {
    if (k === 'landscape' || k === 'switcherEnabled') overrideBool(out, overlay, k);
    else if (k === 'switcherIntervalMs') overrideNumber(out, overlay, k);
    else overrideString(out, overlay, k);
  }
  for (const k of OVERLAY_TOP_SECRET_KEYS) overrideString(out, overlay, k);

  const cs = overlay.comingSoon || {};
  for (const k of OVERLAY_COMING_SOON_KEYS) {
    if (['moviesCount', 'showsCount', 'cycleInterval', 'daysOffset', 'lookaheadDays'].includes(k)) {
      overrideNumber(out.comingSoon, cs, k);
    } else if (k === 'includeCinemaReleases') {
      overrideBool(out.comingSoon, cs, k);
    } else {
      overrideString(out.comingSoon, cs, k);
    }
  }
  for (const k of OVERLAY_COMING_SOON_SECRET_KEYS) overrideString(out.comingSoon, cs, k);

  const tmdb = (cs.tmdb) || {};
  for (const k of OVERLAY_TMDB_KEYS) overrideString(out.comingSoon.tmdb, tmdb, k);
  for (const k of OVERLAY_TMDB_SECRET_KEYS) overrideString(out.comingSoon.tmdb, tmdb, k);

  const v = overlay.visual || {};
  for (const k of OVERLAY_VISUAL_KEYS) {
    if (['progressBar', 'showPosterTitle', 'ratingsBadges', 'genreChips', 'useBackdrops', 'burnInMitigation'].includes(k)) {
      overrideBool(out.visual, v, k);
    } else if (['bulbSizePx', 'backdropDelayMs', 'nudgeIntervalMs', 'nudgeAmplitudePx',
                'nightModeOpacity', 'cornerRadiusPx'].includes(k)) {
      overrideNumber(out.visual, v, k);
    } else {
      overrideString(out.visual, v, k);
    }
  }

  return out;
}
