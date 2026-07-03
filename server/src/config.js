// Config loader for the plex-now-showing server.
//
// Two run modes:
//
//   1. HA Add-on mode  — Supervisor provides SUPERVISOR_TOKEN at startup.
//                         HA is reached via http://supervisor/core/api/.
//                         No user-created long-lived token needed.
//
//   2. Standalone mode  — HA_URL + HA_TOKEN env vars point at any HA instance.
//                         Used by HA Container users running docker compose.
//
// Plex access (plex_url + plex_token) is always optional and purely for the
// Plex-only media-info endpoint.

import { normaliseBackend } from './backends.js';

export function loadConfig(env = process.env) {
  const supervisorToken = env.SUPERVISOR_TOKEN || '';
  const mode = supervisorToken ? 'addon' : 'standalone';

  const haUrl = mode === 'addon'
    ? 'http://supervisor/core'
    : (env.HA_URL || '').replace(/\/$/, '');
  const haToken = mode === 'addon' ? supervisorToken : (env.HA_TOKEN || '');
  const backend = normaliseBackend(env.BACKEND || env.MEDIA_SERVER || env.SERVER_TYPE, 'plex');
  const displayMode = parseEnum(env.DISPLAY_MODE || env.DISPLAY_MODE_DEFAULT,
    ['now_showing', 'coming_soon'], 'now_showing');

  const config = {
    mode,
    port: parseInt(env.PORT || '8099', 10),
    displayMode,
    backend,
    haUrl,
    haToken,
    player: env.PLAYER || env.MEDIA_PLAYER || '',
    plexUrl: (env.PLEX_URL || '').replace(/\/$/, ''),
    plexToken: env.PLEX_TOKEN || '',
    plexUsername: env.PLEX_USERNAME || '',
    plexPlayer: env.PLEX_PLAYER || '',
    landscape: parseBool(env.LANDSCAPE, false),
    theme: env.THEME || 'classic-gold',
    poll: parseInt(env.POLL || '5000', 10),
    // Optional hardening (issue #44 ships defaults that make sense in add-on mode)
    proxySecret: env.PROXY_SECRET || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    // TTLs (ms) — tuned below 1× poll interval so a second tablet doesn't re-hit HA
    stateTtl: parseInt(env.STATE_TTL_MS || '3000', 10),
    mediaInfoTtl: parseInt(env.MEDIA_INFO_TTL_MS || '600000', 10), // 10 min
    comingSoonTtl: parseInt(env.COMING_SOON_TTL_MS || '900000', 10), // 15 min
    // TMDB enrichment cache TTL (#91). Independent from the Coming Soon page
    // cache so a fresh /api/coming-soon doesn't always re-query TMDB. 6 h
    // covers a normal screensaver day with one round-trip per movie.
    tmdbTtl: parseInt(env.TMDB_TTL_MS || '21600000', 10),
    comingSoon: {
      title: env.COMING_SOON_TITLE || 'Coming Soon',
      radarrUrl: (env.RADARR_URL || '').replace(/\/$/, ''),
      radarrApiKey: env.RADARR_API_KEY || '',
      sonarrUrl: (env.SONARR_URL || '').replace(/\/$/, ''),
      sonarrApiKey: env.SONARR_API_KEY || '',
      moviesCount: parseIntClamped(env.COMING_SOON_MOVIES_COUNT, 5, 0, 50),
      showsCount: parseIntClamped(env.COMING_SOON_SHOWS_COUNT, 5, 0, 50),
      cycleInterval: parseIntClamped(env.COMING_SOON_CYCLE_INTERVAL, 8, 2, 300),
      daysOffset: parseIntClamped(env.COMING_SOON_DAYS_OFFSET, 0, 0, 365),
      // Forward window for upcoming releases (#85). Default preserves the
      // pre-#85 hard-coded 90-day horizon. Lower bound of 1 keeps the window
      // meaningful; upper bound of 365 mirrors daysOffset.
      lookaheadDays: parseIntClamped(env.COMING_SOON_LOOKAHEAD_DAYS, 90, 1, 365),
      imageType: parseEnum(env.COMING_SOON_IMAGE_TYPE, ['poster', 'fanart'], 'poster'),
      // Cinema/theatrical release inclusion (#100). Default true preserves the
      // pre-#100 behaviour where Radarr `inCinemas` and TMDB theatrical
      // release types act as eligibility/display fallbacks. When false the
      // Coming Soon feed only considers home-release dates (digitalRelease /
      // physicalRelease + TMDB digital/physical types), so a movie that has
      // only a cinema/theatrical date is filtered out entirely.
      includeCinemaReleases: parseBool(env.COMING_SOON_INCLUDE_CINEMA_RELEASES, true),
      // Optional TMDB enrichment (#91). Disabled unless an API token is
      // supplied. Fills in digital/physical/theatrical release dates by
      // region when Radarr's calendar response lacks them — Radarr stays the
      // primary source. Region defaults to AU per the issue; when missing or
      // unmatched at TMDB we fall back to the movie's first available region.
      tmdb: {
        apiKey: env.TMDB_API_KEY || '',
        region: parseRegion(env.TMDB_REGION, 'AU'),
        // TMDB API accepts both v3 keys and v4 read-tokens. v4 tokens go in
        // the Authorization header; v3 keys go in ?api_key=. Heuristic: v4
        // tokens are JWTs (contain two dots and start with "eyJ"); anything
        // else is treated as a v3 key.
      },
    },
    // Fully Kiosk auto-switcher (#48). Disabled by default; users who prefer
    // the HA Blueprint (#47) can leave it off and vice versa.
    switcherEnabled: parseBool(env.SWITCHER_ENABLED, false),
    switcherIntervalMs: parseInt(env.SWITCHER_INTERVAL_MS || '5000', 10),
    fullyKiosksRaw: env.FULLY_KIOSKS || '',
    // Visual toggles (v2 visual sprint). All default OFF so existing installs
    // keep the original look until the user opts in. Exposed to the browser
    // via GET /api/config.
    visual: {
      progressBar: parseBool(env.VISUAL_PROGRESS_BAR, false),
      // Title/subtitle overlay pinned to the poster's bottom-left. Defaults
      // ON to preserve the original look; turn off when the info panel is
      // pinned open and the title would otherwise render twice.
      showPosterTitle: parseBool(env.VISUAL_SHOW_POSTER_TITLE, true),
      ratingsBadges: parseBool(env.VISUAL_RATINGS_BADGES, false),
      // Render genre chips (Action, Sci-Fi, …) next to the content rating.
      // Populated from Plex metadata (item.Genre[]); empty for personal media.
      genreChips: parseBool(env.VISUAL_GENRE_CHIPS, false),
      // How the info panel (title + ratings + meta + tech) is revealed:
      //   'on_tap'   — default; hidden until the user taps the poster (8 s peek)
      //   'on_pause' — persistently shown while paused, still tappable when playing
      //   'always'   — persistently shown whenever media is playing
      infoPanelMode: parseEnum(env.VISUAL_INFO_PANEL_MODE,
        ['on_tap', 'on_pause', 'always'], 'on_tap'),
      // Backdrop art on pause (#21). Master switch; off keeps the original
      // poster-only look.
      useBackdrops: parseBool(env.VISUAL_USE_BACKDROPS, false),
      // Frame style picker (#65). Defaults to the current animated bulb
      // string. gold-line keeps a quiet accent border; none removes the
      // decorative screen-edge frame for OLED / minimalist installs.
      frameStyle: parseEnum(env.VISUAL_FRAME_STYLE,
        ['bulbs', 'gold-line', 'none'], 'bulbs'),
      // Bulb diameter for the animated frame. 28px preserves the original
      // look; smaller/larger values keep proportional spacing in the client.
      bulbSizePx: parseIntClamped(env.VISUAL_BULB_SIZE_PX, 28, 12, 48),
      // Marquee font picker (#62/#63). Defaults to Bebas Neue, which is the
      // original v1 headline font.
      marqueeFont: parseEnum(env.VISUAL_MARQUEE_FONT,
        ['bebas-neue', 'anton', 'oswald', 'monoton', 'playfair-display'],
        'bebas-neue'),
      // Poster framing (#67): centred (default) | cover | matted
      posterFraming: parseEnum(env.VISUAL_POSTER_FRAMING,
        ['centred', 'cover', 'matted'], 'centred'),
      // Film grain overlay (#27): subtle noise texture for cinematic warmth
      filmGrain: parseBool(env.VISUAL_FILM_GRAIN, false),
      // Ken Burns pan (#22): slow zoom + translate on poster art
      kenBurns: parseBool(env.VISUAL_KEN_BURNS, false),
      // Two presentation styles:
      //   'fullscreen' — landscape only; after backdropDelayMs of pause,
      //                   crossfade the poster view to the Plex fanart.
      //                   On portrait devices the fanart crop is always bad,
      //                   so this mode silently no-ops there.
      //   'ambient'    — replaces the yellow bulb-lit background with a
      //                   heavily blurred and darkened copy of the fanart at
      //                   all times (not just on pause). Works on both
      //                   orientations because the image is blurred to the
      //                   point where aspect ratio doesn't matter.
      backdropStyle: parseEnum(env.VISUAL_BACKDROP_STYLE,
        ['fullscreen', 'ambient'], 'fullscreen'),
      // Delay (ms) before the fullscreen backdrop fades in on pause. Spec
      // calls for >10 s so quick seeks / skip-intros don't trigger the swap.
      backdropDelayMs: parseIntClamped(env.VISUAL_BACKDROP_DELAY_MS, 10000, 1000, 600000),
      // Burn-in mitigation (#28). Master switch + sub-features. Designed for
      // 24/7 OLED kiosks where the same poster, marquee, and bulb pattern
      // would otherwise sit on the same pixels for hours. Default off so
      // LCD/short-session installs see no behaviour change.
      burnInMitigation: parseBool(env.VISUAL_BURN_IN_MITIGATION, false),
      // Pixel nudge: cycle the body through ±N px every N ms. Small enough
      // to be invisible mid-watch, large enough to rotate static pixels off
      // any given OLED sub-pixel cell.
      nudgeIntervalMs: parseIntClamped(env.VISUAL_NUDGE_INTERVAL_MS, 60000, 5000, 600000),
      nudgeAmplitudePx: parseIntClamped(env.VISUAL_NUDGE_AMPLITUDE_PX, 4, 1, 16),
      // Night mode: dims the screen overnight. Two triggers, evaluated in
      // priority order:
      //   1. HA input_boolean (or any on/off entity) named below
      //   2. browser prefers-color-scheme: dark fallback
      // Empty entity = HA path is skipped, falls through to media query.
      nightModeEntity: env.VISUAL_NIGHT_MODE_ENTITY || '',
      // Overlay opacity when night mode is active. 0.4 reads as "clearly
      // dimmed but the title is still legible from across the room".
      nightModeOpacity: parseFloatClamped(env.VISUAL_NIGHT_MODE_OPACITY, 0.4, 0, 0.95),
      // Theme presets (#23). Each preset is a small block of CSS custom
      // property overrides applied via <body data-theme="…">. The default
      // 'classic-gold' matches the bulb-lit cinema look that's been the only
      // option until now — existing installs render identically.
      // Composes with the per-axis controls below; explicit values beat
      // preset defaults.
      theme: parseEnum(env.VISUAL_THEME,
        ['classic-gold', 'art-deco-silver', 'neon-80s', 'minimalist-dark'],
        'classic-gold'),
      // Accent colour override (#66). Drives --accent-light/mid/dark/glow,
      // which the marquee trim, gold-line frame, ratings highlight and chip
      // borders all read from. Empty string = use the active theme's accent.
      // Hex validation is strict (#RRGGBB only) so a typo can't break the
      // whole UI — falls back to '' (theme default) on bad input.
      accentColor: parseHexColor(env.VISUAL_ACCENT_COLOR, ''),
      // Empty string means the active theme owns --bg-marquee / --red-curtain.
      marqueeBgColor: parseHexColor(env.VISUAL_MARQUEE_BG_COLOR, ''),
      // Corner / frame radius slider (#68). Applies to the inner marquee,
      // poster, and info panel only; the outer bulb frame stays square.
      cornerRadiusPx: parseIntClamped(env.VISUAL_CORNER_RADIUS_PX, 0, 0, 48),
      // #64 — per-section info panel visibility. All default true so
      // existing installs see no change until the opt-out.
      infoShowTitle:      parseBool(env.VISUAL_INFO_SHOW_TITLE, true),
      infoShowSubtitle:   parseBool(env.VISUAL_INFO_SHOW_SUBTITLE, true),
      infoShowMeta:       parseBool(env.VISUAL_INFO_SHOW_META, true),
      infoShowSummary:    parseBool(env.VISUAL_INFO_SHOW_SUMMARY, true),
      infoShowTechbox:    parseBool(env.VISUAL_INFO_SHOW_TECHBOX, true),
      infoShowPlayer:     parseBool(env.VISUAL_INFO_SHOW_PLAYER, true),
    },
    // Where the static HTML lives (overridden in tests)
    staticDir: env.STATIC_DIR || new URL('../../www', import.meta.url).pathname,
  };

  const errors = validate(config);
  return { config, errors };
}

function parseBool(v, defaultValue) {
  if (v == null || v === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function parseIntClamped(v, defaultValue, min, max) {
  if (v == null || v === '') return defaultValue;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return defaultValue;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseEnum(v, allowed, defaultValue) {
  if (v == null || v === '') return defaultValue;
  const s = String(v).trim().toLowerCase();
  return allowed.includes(s) ? s : defaultValue;
}

function parseFloatClamped(v, defaultValue, min, max) {
  if (v == null || v === '') return defaultValue;
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

// ISO 3166-1 alpha-2 country code, e.g. AU, US, GB. TMDB rejects anything
// else, so we normalise to upper-case and reject non-letters; bad input
// returns the default ('AU' per #91) so a typo can't silently disable the
// fallback path.
function parseRegion(v, defaultValue) {
  if (v == null) return defaultValue;
  const s = String(v).trim().toUpperCase();
  if (s === '') return defaultValue;
  return /^[A-Z]{2}$/.test(s) ? s : defaultValue;
}

// Validate a #RRGGBB hex colour string. Anything else (including #RGB short
// form, named colours, rgba(), garbage) returns defaultValue so a typo in
// add-on config can't render the kiosk unstyled. Trims and lower-cases for
// stable equality.
function parseHexColor(v, defaultValue) {
  if (v == null) return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (s === '') return defaultValue;
  return /^#[0-9a-f]{6}$/.test(s) ? s : defaultValue;
}

export function validate(c) {
  const errors = [];
  if (!c.haUrl) errors.push('haUrl is required (set HA_URL or run as an add-on)');
  if (!c.haToken) errors.push('haToken is required (set HA_TOKEN or run as an add-on so SUPERVISOR_TOKEN is provided)');
  if (c.plexUrl && !c.plexToken) errors.push('plexToken is required when plexUrl is set');
  if (!Number.isFinite(c.port) || c.port < 1 || c.port > 65535) errors.push('port must be between 1 and 65535');
  if (!Number.isFinite(c.poll) || c.poll < 1000) errors.push('poll must be \u2265 1000 ms');
  if (!Number.isFinite(c.comingSoonTtl) || c.comingSoonTtl < 10000) errors.push('comingSoonTtl must be \u2265 10000 ms');
  if (!Number.isFinite(c.tmdbTtl) || c.tmdbTtl < 10000) errors.push('tmdbTtl must be \u2265 10000 ms');
  if (c.displayMode === 'coming_soon') {
    const hasSource = !!((c.comingSoon.radarrUrl && c.comingSoon.radarrApiKey)
      || (c.comingSoon.sonarrUrl && c.comingSoon.sonarrApiKey));
    if (!hasSource) errors.push('at least one Coming Soon source is required when DISPLAY_MODE=coming_soon');
  }
  if (c.switcherEnabled && !c.fullyKiosksRaw) {
    errors.push('FULLY_KIOSKS is required when SWITCHER_ENABLED is true');
  }
  if (!Number.isFinite(c.switcherIntervalMs) || c.switcherIntervalMs < 1000) {
    errors.push('switcherIntervalMs must be \u2265 1000 ms');
  }
  return errors;
}
