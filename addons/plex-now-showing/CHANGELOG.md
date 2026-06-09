# Changelog

All notable changes to the Now Showing add-on will be documented here.
The project follows [Semantic Versioning](https://semver.org/).

## 2.3.4 - 2026-06-09

### Added
- Setup saves and resets now broadcast `config_changed` over the existing SSE
  channel, so connected kiosks apply server-side configuration changes without a
  manual refresh. Display mode, backend, Coming Soon, and visual settings update
  from the sanitized `/api/setup` view; secret values are never sent.
- Coming Soon mode now auto-cycles on the configured
  `coming_soon_cycle_interval`, reloading the next upcoming item without a page
  reload and restarting the timer immediately when that setting changes.
- Poster changes now use a double-buffered crossfade with stale-image guards, so
  Coming Soon rotations and live artwork changes do not flash black or regress to
  an older slow-loading image.

### Fixed
- Ken Burns animation is restricted to the active poster layer so it does not
  fight the crossfade buffer.
- The Coming Soon route test now uses a date relative to the test run instead of
  a fixed past date.

## 2.3.3 - 2026-06-06

### Changed
- Maintenance release: dependency updates for the Node server (`ws` and
  `express`) plus the non-standard entity artwork fix already present on main.

## 2.3.2 - 2026-05-19

### Fixed
- All requests returning `:ok` (closes #105) — the SSE `/api/events` handler was
  registered with `app.use(eventBus.eventsRoute)` which catches **every** request
  path on the server. The function wrote `:ok` and never called `next()`, so the
  Express static middleware never ran. No static files were served: not
  `now_showing.html`, not the font files, not `now_showing.config.js`. Changed
  to `app.get('/api/events', eventBus.eventsRoute)` so it only matches
  `GET /api/events`.

## 2.3.1 - 2026-05-19

### Fixed
- SSE endpoint crash (closes #104) — `ReferenceError: req is not defined` on every
  `/api/events` connection. The parameter `_req` (intentionally unused prefix) was
  referenced as `req` in the `close` handler, causing Express to return a 500 error
  after writing the initial `:ok` heartbeat. Browser EventSource clients saw a
  broken connection and fell back to polling, but the partial response could
  render as raw `:ok` text depending on proxy timing.
- `package.json` version bumped to `2.3.1` (was still `2.1.6` from the pre-v2.2.0
  era). The add-on store (`config.yaml`) has been at `2.3.0` since v2.3.0, but the
  server runtime reported `v2.1.6` everywhere — boot logs, `/api`, `/healthz`, and
  the HTTP header.

## 2.3.0 - 2026-05-18

### Added
- Poster framing modes (closes #67) — three layout options (`centred`, `cover`,
  `matted`) for how artwork sits in the kiosk view. Configurable via
  `VISUAL_POSTER_FRAMING` / `visual_poster_framing`.
- Film-grain overlay (closes #27) — subtle 5% opacity SVG noise texture for
  cinematic warmth. Configurable via `VISUAL_FILM_GRAIN` / `visual_film_grain`.
- Ken Burns poster pan (closes #22) — slow 30s zoom/translate animation on the
  poster art. Configurable via `VISUAL_KEN_BURNS` / `visual_ken_burns`.
- Self-hosted Google Fonts (closes #40) — Bebas Neue, Playfair Display, Inter,
  Anton, Monoton, and Oswald shipped as bundled woff2 files. Survives internet
  outages with zero CDN dependency. Falls back gracefully if CDN is available.
- Per-section info panel toggles (closes #64) — independent visibility switches
  for title, subtitle, meta (year/runtime/rating), summary, tech box, and player
  info. All default ON so existing installs see no change. Configurable via
  `VISUAL_INFO_SHOW_*` env vars or the in-app setup overlay.
- Fixed missing overlay keys — `posterFraming`, `filmGrain`, and `kenBurns` were
  never registered in the overlay store, causing setup UI saves to silently drop
  them. All visual settings now actually persist across devices.
- HA WebSocket subscription + SSE push (closes #10) — server connects to HA's
  WebSocket API for real-time state_changed events, pushes updates to browsers
  via Server-Sent Events at `/api/events`. Browser falls back to 30s poll.
  Frontend no longer polls every 5s.
- Graceful shutdown — HA WS client cleaned up on SIGTERM/SIGINT.

## 2.2.0 - 2026-05-18

### Added
- CSS-driven chase animation (closes #16) — replaces JS `setInterval` with
  `@keyframes` animation. Smoother on low-end tablets, no GC churn, survives
  tab backgrounding.
- Connection status indicators (closes #15) — two small dots in the bottom-right
  corner show HA server health (green/amber/red/grey) and media backend status.
- Debug mode (closes #15) — append `?debug=1` to the kiosk URL for an on-screen
  overlay with real-time poll data and timestamps.
- Dev health: `CONTRIBUTING.md`, issue templates (bug report + feature request),
  and pull request template (closes #37).

## 2.1.6 - 2026-05-10

### Added
- Toggle to include or exclude cinema/theatrical releases from Coming
  Soon (closes #100). New `coming_soon_include_cinema_releases` add-on
  option / `COMING_SOON_INCLUDE_CINEMA_RELEASES` Docker env var, and an
  "Include cinema / theatrical releases" checkbox in the in-app setup
  overlay (Coming Soon sources). Default is **on**, which preserves the
  pre-#100 fallback behaviour exactly: Radarr `inCinemas` and TMDB
  theatrical release types act as eligibility/display fallbacks, and
  cinema-only entries appear with the existing `In cinemas: <date>`
  label. Turning the toggle off suppresses cinema-only entries entirely
  — Radarr `inCinemas` is ignored and TMDB theatrical types are
  skipped — while digital and physical home releases keep showing.
  Monitored, `hasFile`, and the configurable look-ahead window keep
  applying as before. The toggle is persisted server-side in the v2.1.5
  overlay file (`/data/overlay.json`) and applies across every browser,
  kiosk and phone on the install.

## 2.1.5 - 2026-05-09

### Added
- Server-side persistent setup overlay (closes #98). The in-app setup
  overlay (gear icon / `#setup`) is now a real persistent configuration
  editor: every relevant field, including TMDB API key + region, HA
  token, Plex/Radarr/Sonarr URLs and keys, Coming Soon counts, and
  visual settings, is editable in the overlay and saves server-side via
  `POST /api/setup`. Values are stored in `/data/overlay.json` on the
  add-on disk and propagate to every browser, kiosk, and phone on the
  next page load. No more "configured on Master Panel, blank on the
  phone" — saving from any device updates them all.
- New API surface: `GET /api/setup`, `POST /api/setup`,
  `POST /api/setup/reset`. Secrets are never returned by the server —
  only `*Set` booleans — and saving a blank secret preserves the
  existing value so users can edit non-secret fields without re-typing
  tokens. Reset deletes the overlay file and reverts every device to
  the add-on/Docker defaults.
- `/api/config` now also surfaces `haUrl`, `haUrlSet`, `haTokenSet`,
  and `landscape` so the in-app overlay can prefill non-secret fields
  consistently across clients.

### Changed
- Setup overlay now POSTs to the server in add-on/Docker mode instead
  of writing to `localStorage` only. localStorage is still written as
  a per-device cache so HACS-only installs (no server) keep working
  unchanged.
- Config precedence is now explicit: env / add-on options provide
  *defaults*, the persistent overlay file *overrides* them where set.
  Clearing a non-secret overlay field falls back to the env default;
  the explicit `/api/setup/reset` endpoint wipes the file entirely.

### Fixed
- TMDB section in the setup overlay no longer leaves the heading
  orphaned when `/api/config` fails — a fallback hint is shown
  instead, and TMDB API key + region are now editable from the overlay
  itself (closes #97). Existing add-on options / Docker env values
  remain supported as defaults.

## 2.1.4 - 2026-05-09

### Fixed
- Add-on setup state now persists across browsers, devices, and the HA
  app (closes #95). The in-app setup overlay was previously the only
  mechanism for configuring connection / Coming Soon / TMDB values and
  it stored everything in per-tablet `localStorage`, so a phone or HA
  app opening the kiosk on a different origin saw blank fields even
  though the operator had filled them in on Master Panel. The canonical
  setup now lives in the add-on **Configuration** tab (or Docker env
  vars). The unified server reads it once at boot and exposes a
  non-secret summary at `GET /api/config`; every browser hits the same
  endpoint, so a fresh phone shows the same configured state without
  any per-device re-entry.
- The setup overlay now renders a "Settings are managed by the Now
  Showing add-on" banner in unified-server mode with a read-only
  summary of what the server actually loaded (mode, display mode,
  backend/player, Plex/Radarr/Sonarr URLs, TMDB region + configured
  status). Connection / Coming Soon password fields are still hidden
  for security; the banner shows a `(key set)` / `(token set)` marker
  instead of the secret. localStorage values continue to work as
  per-device overrides for visual preferences.
- The first-run setup auto-open is now suppressed in unified-server
  mode — the server already has a working HA token, so a brand-new
  phone is no longer forced through a setup form pretending to need
  credentials.
- Save-button validation no longer demands an HA / Radarr / Sonarr
  token in unified-server mode (the server already has them).

### Added
- `GET /api/config` now exposes `mode`, `managed`, the canonical
  Plex / Radarr / Sonarr URLs, plex username, and `*Set` booleans for
  every secret. No secrets are returned. This is what the in-app
  setup overlay uses to render the read-only summary.
- The setup overlay's Coming Soon section gained an inline TMDB
  status panel showing whether the server has a TMDB API key
  configured and which region is active (driven by the existing
  `tmdb_api_key` / `tmdb_region` add-on options). This is a status
  display only — the API key remains a server-side option in the
  add-on Configuration tab (or `TMDB_API_KEY` env var); the kiosk
  frontend never calls TMDB directly.

### Migration
- No action required for the canonical Connection / Coming Soon /
  TMDB values: they are already read from add-on options. If you
  previously filled in the in-app setup overlay and the values only
  appeared on one tablet, copy those same values into **Settings →
  Add-ons → Now Showing → Configuration** once and every device will
  pick them up automatically. The per-device localStorage overrides
  are left untouched and continue to work.

## 2.1.3 - 2026-05-09

### Added
- Optional TMDB enrichment for Coming Soon (closes #91, PR #93). New
  `tmdb_api_key`, `tmdb_region`, and `tmdb_ttl_ms` add-on options
  (env: `TMDB_API_KEY`, `TMDB_REGION` default `AU`, `TMDB_TTL_MS` default
  6 h) let the server fall back to The Movie Database for movies whose
  Radarr calendar entry has no usable digital/physical release date.
  Radarr stays the primary source — TMDB is only consulted when Radarr
  lacks usable home-release metadata, and any TMDB digital/physical date
  inside the look-ahead window upgrades the entry to a `home` release.
  If only a TMDB theatrical date is available it is used as a labelled
  cinema fallback. Movies are matched by Radarr `tmdbId` first and fall
  back to `imdbId` via TMDB's `/find` endpoint; title-only matching is
  deliberately avoided. Disabled by default — leave `tmdb_api_key`
  blank for identical behaviour to 2.1.2. Both v3 keys and v4
  read-tokens are accepted. Auth, rate-limit, and network failures are
  logged and silently swallowed so Coming Soon never breaks because
  TMDB is unreachable. `hasFile`, monitored filtering, and the
  configurable look-ahead window are unchanged.

### Changed
- Coming Soon footer now prefers the earliest qualifying home-release
  date (`digitalRelease` / `physicalRelease`) inside the look-ahead
  window for Radarr movies (closes #90, PR #92). The kiosk only falls
  back to `inCinemas` when no home date qualifies, and cinema-only
  items are tagged with `releaseType: 'cinema'` and prefixed with
  `In cinemas: <date>` so the footer is not mistaken for home
  availability. Both the Node server and the frontend-only path apply
  the same rule. `hasFile`, monitored filtering, and the configurable
  look-ahead behaviour are unchanged.

## 2.1.2 - 2026-05-08

### Changed
- Radarr Coming Soon eligibility now also accepts `inCinemas` as a
  release-date fallback alongside `digitalRelease` and `physicalRelease`.
  When multiple dates are populated, the earliest qualifying date inside
  the configured look-ahead window is selected. `hasFile === false` and
  monitored filtering are unchanged, so already-imported movies still
  drop out (closes #87, PR #88).

## 2.1.1 - 2026-05-08

### Added
- Configurable Coming Soon look-ahead window via the new
  `coming_soon_lookahead_days` option (env `COMING_SOON_LOOKAHEAD_DAYS`,
  frontend key `comingSoonLookaheadDays`). Range is 1–365 days; default
  remains **90** so existing installs keep their current behaviour
  (closes #85, PR #86).
- Radarr eligibility now includes `physicalRelease` alongside
  `digitalRelease`. When both are present, the earliest qualifying date
  inside the look-ahead window is selected.

## 2.1.0 - 2026-05-03

### Added
- The Home Assistant add-on is now presented as **Now Showing** in the add-on
  store, Ingress labels, container metadata, and add-on documentation. The
  internal slug/image path remains unchanged for existing installs.
- Apple TV, generic streaming-device, and Kaleidescape backends are now part
  of the documented v2.1.0 release path.
- Coming Soon mode can use Radarr/Sonarr as a Fully Kiosk screensaver, with
  configurable marquee text, movie/show counts, cycle interval, days offset,
  and poster/fanart artwork.
- The setup UI can load/pick compatible media players, configure Coming Soon
  sources, generate automation/switcher config, and preview visual changes in
  a wider Display-tab preview with a generated bulb frame that matches the
  live display.
- Marquee background colour picker (closes #62/#viz-13). Add-on option
  `visual_marquee_bg_color`, Docker env `VISUAL_MARQUEE_BG_COLOR`, and
  frontend key `visualMarqueeBgColor` accept strict `#RRGGBB` values or empty
  theme default. Setup includes black, deep red, navy, forest green,
  midnight purple, charcoal, and arbitrary picker options.
- Corner radius, frame style, bulb size, marquee font, theme, accent colour,
  progress bar, ratings, genre chips, info panel, backdrops, burn-in nudge,
  and night dimming are all documented as Display setup controls.
- Bulb size slider. Add-on option `visual_bulb_size_px`, Docker env
  `VISUAL_BULB_SIZE_PX`, and frontend key `visualBulbSizePx` resize the
  animated bulb frame from `12` to `48` px. Default `28` preserves the
  original look.

### Documentation
- README and add-on docs now explain how to use Now Showing and Coming Soon at
  the same time with two URLs/instances, including Fully Kiosk
  `playing_url`/`stopped_url` examples.

### Fixed
- Setup now opens at the top and scrolls inside Home Assistant add-on Ingress,
  so tall setup tabs no longer have unreachable controls unless the browser is
  zoomed out.
- The Display-tab preview now generates bulbs around the preview frame and
  marquee divider instead of showing a sparse fixed set of sample dots.

## 2.0.0 - 2026-04-27

### Added
- Initial add-on wrapper for the unified Node 20 server (closes #44).
- Ingress support (`ingress: true`, entry `/now_showing.html`).
- User options for Plex URL/token/username/player, theme, landscape, poll
  interval, cache TTLs, proxy secret, and origin allowlist.
- Multi-arch Dockerfile (`amd64`, `aarch64`, `armv7`, `armhf`, `i386`).
- s6-overlay service that forwards `/data/options.json` → env and runs
  `node src/server.js`.
- HEALTHCHECK against `/healthz` so Supervisor can detect a stuck process.
- Built-in Fully Kiosk auto-switcher (closes #48). Opt-in via
  `switcher_enabled: true`; configure one entry per tablet under
  `fully_kiosks`. Alternative to the HA Blueprint (#47 / PR #51) — pick one,
  not both.
- Playback progress bar (closes #17). Opt-in via `visual_progress_bar: true`
  — a slim gold bar along the bottom of the poster that tracks HA's
  `media_position`, interpolated between polls for smooth motion. Freezes
  while paused, hides when idle. Off by default; every other v2 visual
  feature will follow the same toggle pattern.
- Server now exposes `GET /api/config` so the browser can read runtime
  visual toggles without a rebuild.
- Ratings badges (closes #18). Opt-in via `visual_ratings_badges: true` —
  IMDb, Rotten Tomatoes (fresh/rotten critic), and audience (RT upright/
  spilled or TMDB fallback) chips on the info panel. Scores are pulled
  server-side from `/library/metadata` and cached with the existing
  media-info TTL. Requires `plex_url` + `plex_token`.
- Info panel visibility mode (`visual_info_panel_mode`). Three choices:
  `on_tap` (default, current behaviour), `on_pause` (panel pinned open
  whenever the player is paused; tap-to-peek still works while playing),
  and `always` (panel pinned open the entire time media is active).
- Genre chips (closes #20). Opt-in via `visual_genre_chips: true` — genre
  pills (Action, Sci-Fi, …) appended to the content-rating row on the
  info panel. Tags read from Plex metadata (`item.Genre[]`) via the
  existing media-info pipeline; requires `plex_url` + `plex_token`. Capped
  at 6 entries and deduped so a long sub-genre list can't blow out the
  layout.
- Backdrop art on pause (closes #21). Opt-in via `visual_use_backdrops:
  true`. Two styles: `fullscreen` (default) crossfades the poster view to
  the Plex fanart after `visual_backdrop_delay_ms` of sustained pause on
  landscape devices; `ambient` replaces the yellow bulb-lit background
  with a blurred and darkened copy of the fanart whenever media is active,
  and works in both orientations because the blur makes aspect ratio moot.
  Fanart is proxied through a new `/api/plex-art?path=…` endpoint so the
  Plex token never reaches the browser; the proxy rejects any path that
  doesn't start with `/library/` to block SSRF-style abuse. Requires
  `plex_url` + `plex_token`.
- Burn-in mitigation (closes #28). Opt-in via
  `visual_burn_in_mitigation: true`. Combines two subsystems: (1) a pixel
  nudge that shifts the whole UI by ±N pixels every N ms via a 400 ms GPU
  transform (tunable via `visual_nudge_interval_ms` 5 000–600 000 and
  `visual_nudge_amplitude_px` 1–16, defaults 60 000 / 4), and (2) an
  optional night-mode dim overlay driven by an HA
  `input_boolean` / `switch` / `binary_sensor`
  (`visual_night_mode_entity`) with the OS `prefers-color-scheme: dark`
  media query as automatic fallback; overlay opacity tunable via
  `visual_night_mode_opacity` (0–0.95, default 0.4). New `GET
  /api/night-mode` endpoint surfaces entity state to the kiosk.
- Theme presets (closes #23). New `visual_theme` option — one of
  `classic-gold` (default, original bulb look), `art-deco-silver` (cooler
  chrome accents), `neon-80s` (hot pink + cyan), or `minimalist-dark`
  (clean dark UI, ornament off). Drives `<body data-theme>` so all
  accent-derived elements (bulbs, marquee text glow, progress bar,
  ratings badges) reskin together. Existing installs default to
  `classic-gold` so nothing changes until the user picks another preset.
- Accent colour picker (closes #66). Opt-in `visual_accent_color` — a
  strict `#RRGGBB` hex (e.g. `#ff5500`) that overrides the active theme's
  accent ramp via `--accent-override`; the four-stop ramp is derived with
  CSS `color-mix(in srgb, ...)`. Empty value (the default) leaves the
  theme's ramp untouched. Short form (`#abc`) and named colours are
  rejected at both server and client validation layers.
- Corner / frame radius slider (closes #68). New
  `visual_corner_radius_px` option, `VISUAL_CORNER_RADIUS_PX` env, and
  setup slider round the inner marquee, poster, and info panel from
  `0`-`48` px while leaving the outer bulb frame square. Default `0`
  preserves the original sharp cinema look.
- Frame style picker (closes #65). New `visual_frame_style` option with
  `bulbs` (default, current animated bulb string), `gold-line` (thin
  accent-coloured double border with no bulb glow), and `none` (no
  decorative screen-edge frame). Non-bulb modes clear the bulb DOM and stop
  the chase timer so idle kiosks do no wasted animation work.
- Backend abstraction (closes #34). New `backend` / `BACKEND` option selects
  `plex`, `jellyfin`, `emby`, or `kodi`; new generic `player` / `PLAYER`
  option can pin any exact `media_player` entity. Existing Plex defaults and
  `plex_player` / `PLEX_PLAYER` remain backward-compatible.
- Frontend-only setup now has a Display tab with controls for every visual
  option: theme, accent colour, frame style, progress bar, ratings badges,
  genre chips, info panel mode, backdrops, burn-in mitigation, pixel nudge,
  and night dimming. The Display tab includes a wide live preview so visual
  changes can be tested before saving.
- Marquee font picker (`visual_marquee_font`) adds Bebas Neue, Anton, Oswald,
  Monoton, and Playfair Display choices to the add-on, Docker, server, and
  frontend-only setup paths.
- Setup Automation tab links to the tablet-switching Blueprint import/download
  flow and generates add-on/Docker config for the built-in Fully Kiosk
  switcher.
- Apple TV backend support (closes #77). `backend: apple_tv` auto-detects
  active Apple TV media players, carries HA `app_name` through to the kiosk,
  and shows a compact app badge/icon when available.
- Generic streaming backend support (refs #77). `backend: streaming`
  auto-detects any active `media_player.*` entity with an `app_name`
  attribute, so the same app-name, title, artwork, and dashboard-icons badge
  path works for Roku, Google TV, Android TV, YouTube, Disney+, Netflix, Plex,
  and similar providers.
- Kaleidescape backend support (closes #78). `backend: kaleidescape`
  auto-detects active Kaleidescape `media_player` entities exposed by Home
  Assistant and renders their now-playing artwork and metadata.
- Coming Soon display mode (closes #33). `display_mode: coming_soon` turns
  the kiosk into a Radarr/Sonarr upcoming-release carousel with a Coming Soon
  marquee, poster/fanart selection, counts, cycle interval, and days offset.

### Fixed
- Dev add-on installs now use a matching pre-release image tag and the build
  workflow publishes the exact `config.yaml` version tag alongside the rolling
  `:dev` alias, so Supervisor no longer tries to pull a missing release image
  from GHCR.
- Blank Plex username now correctly disables user filtering in both server and
  frontend-only mode, so HA Plex entities with a `username` attribute still
  show as active playback.
