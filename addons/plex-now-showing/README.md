# Now Showing - Home Assistant Add-on

Cinema-style now-playing and coming-soon kiosk for Home Assistant, installed
straight from the Home Assistant add-on store. One click, no long-lived access
token, no Docker command line.

## What's new in 2.3.4

- **Instant setup propagation** — saving or resetting the in-app setup overlay
  broadcasts a sanitized `config_changed` event over SSE. Open kiosks switch
  between Now Showing and Coming Soon, update backend/source settings, and apply
  visual changes without a browser refresh.
- **Coming Soon auto-cycle** — Coming Soon mode rotates on the configured
  `coming_soon_cycle_interval` without full-page reloads, and timer changes take
  effect immediately.
- **Smooth poster crossfade** — artwork now preloads into a second poster layer
  and crossfades into place, preventing black flashes during Coming Soon rotation
  while preserving the server `/api/artwork` proxy path.

## What's new in 2.3.2

- **Fixed all requests returning `:ok`** — the SSE endpoint was registered with
  `app.use()` without a path prefix, so it caught every incoming request and
  returned `:ok` instead of the actual file. The kiosk HTML, font files, and
  static assets were all blocked. Fixed by mounting it at `/api/events` only.

## What's new in 2.3.1

- **Fixed SSE crash** — a `ReferenceError: req is not defined` in the `/api/events`
  endpoint was causing the SSE connection to break after sending the initial `:ok`
  heartbeat. The browser's EventSource fell back to polling, but intermittent HTTP
  proxy timing could leave `:ok` as visible text on the kiosk. Fixed.
- **Server version now matches add-on store** — the server runtime was reporting
  `v2.1.6` despite the add-on being on `v2.3.0`. Boot logs, `/api`, and `/healthz`
  now correctly report `v2.3.1`.

## What's new in 2.3.0

- **Poster framing modes** — three layout options (`centred`, `cover`, `matted`) for
  how artwork sits in the kiosk view. Configurable via `visual_poster_framing`.
- **Film-grain overlay** — subtle 5% opacity SVG noise texture for cinematic
  warmth. Toggle on with `visual_film_grain`.
- **Ken Burns poster pan** — a slow 30 s zoom/translate animation on the poster
  art. Toggle on with `visual_ken_burns`.
- **Self-hosted Google Fonts** — Bebas Neue, Playfair Display, Inter, Anton,
  Monoton, and Oswald shipped as bundled woff2 files. No CDN needed — survives
  internet outages with zero external dependencies.
- **Per-section info panel toggles** — independent visibility switches for
  title, subtitle, meta (year/runtime/rating), summary, tech box, and player
  info. All default ON so existing installs see no change. Set via
  `visual_info_show_*` env vars or the in-app setup overlay.
- **Live updates via HA WebSocket + SSE** — the server now connects to Home
  Assistant's WebSocket API for real-time state changes and pushes them to
  browsers via Server-Sent Events at `/api/events`. The browser falls back to
  30 s polling only when SSE isn't available (no more 5 s polling).
- **Fixed overlay persistence bug** — `posterFraming`, `filmGrain`, and
  `kenBurns` were never registered in the overlay store, so the in-app setup
  UI silently dropped saves for these fields. All visual settings now persist
  correctly across devices.
- **Graceful shutdown** — the HA WebSocket client is properly cleaned up on
  SIGTERM/SIGINT, leaving no stale connections.

## What's new in 2.2.0

- **CSS-driven chase animation** — replaces the old JS `setInterval` with a
  native `@keyframes` animation. Smoother on low-end tablets, no GC churn,
  survives tab backgrounding without stuttering.
- **Connection status indicators** — two small dots in the bottom-right corner
  show HA server health (green/amber/red/grey) and media backend status, so
  you can tell at a glance if everything is connected.
- **Debug mode** — append `?debug=1` to the kiosk URL for an on-screen overlay
  with real-time poll data and timestamps. Handy for diagnosing connection
  issues without digging through logs.
- **Developer health** — new `CONTRIBUTING.md`, bug report and feature request
  issue templates, and a PR template to make community contributions easier.

## What's new in 2.1.6

- New **Include cinema / theatrical releases** checkbox in the in-app
  setup overlay, under Coming Soon sources/settings. It controls
  whether Radarr `inCinemas` dates and TMDB theatrical/cinema release
  types are used when building the Coming Soon list.
- Default is **enabled**, preserving the prior behaviour: Radarr
  `inCinemas` acts as an eligibility/display fallback and TMDB
  theatrical-only dates surface as labelled cinema entries
  (`In cinemas: <date>`).
- Disabling the toggle suppresses cinema-only entries entirely —
  Radarr `inCinemas` is ignored and TMDB theatrical types are skipped
  — while digital and physical home releases keep showing.
- The setting is persisted server-side via the v2.1.5 overlay file, so
  flipping it on any device updates every browser, kiosk, and phone on
  the install. Monitored, `hasFile`, and the configurable look-ahead
  window keep applying as before.

## What's new in 2.1.5

- Persistent **server-side setup overlay**. The in-app setup overlay
  (gear icon / `#setup`) is now a real configuration editor that saves
  server-side instead of per-device `localStorage`. Settings — Plex /
  Radarr / Sonarr URLs and keys, HA token, Coming Soon counts, visual
  options, and more — persist across phones, Master Panel / Fully
  Kiosk, the HA app via Ingress, and direct URL access. Saving from
  any device updates them all on the next page load.
- TMDB API key and region can now be entered directly in the setup
  overlay. The TMDB section no longer leaves the heading orphaned
  when `/api/config` is unavailable. Existing add-on options / Docker
  env values remain supported as defaults.
- New API surface backs the overlay: `GET /api/setup`,
  `POST /api/setup`, `POST /api/setup/reset`. Secrets are never
  returned by the server (only `*Set` booleans), saving a blank
  secret preserves the existing value, and reset reverts every device
  to the add-on / Docker defaults. Add-on options / env vars provide
  defaults; the overlay file overrides them where set.

## What's new in 2.1.4

- Add-on setup state now persists across browsers, devices, and the
  HA app. Configuration moved from per-tablet `localStorage` to the
  add-on **Configuration** tab (or Docker env vars), with the unified
  server exposing a non-secret summary at `GET /api/config` so every
  browser sees the same configured state without per-device re-entry.

## What's new in 2.1.3

- Optional TMDB enrichment for Coming Soon. Set `tmdb_api_key` (and
  optionally `tmdb_region`, default `AU`) to let the server fill in
  digital, physical, or theatrical release dates that Radarr's calendar
  is missing. Disabled by default — leave the key blank to keep Coming
  Soon fully Radarr-driven. Both v3 keys and v4 read-tokens work.
- Radarr stays the primary source. TMDB is only consulted when Radarr
  has no usable home-release date inside the look-ahead window. A TMDB
  digital or physical date upgrades the entry to a `home` release; a
  theatrical-only TMDB date is used as a labelled cinema fallback.
- Lookups are cached for `tmdb_ttl_ms` (default 6 h) and TMDB failures
  (auth, rate limit, network, no match) are logged and silently
  swallowed, so Coming Soon never breaks because TMDB is unreachable.
- The Coming Soon footer now prefers the earliest qualifying
  home-release date for Radarr movies and only falls back to
  `inCinemas` when no home date qualifies. Cinema-only items are
  prefixed with `In cinemas: <date>` so the footer is not mistaken for
  home availability.
- `hasFile === false`, monitored filtering, and the configurable
  `coming_soon_lookahead_days` window are still respected.

## What's new in 2.1.2

- Radarr Coming Soon eligibility now also accepts `inCinemas` as a release-date
  fallback alongside `digitalRelease` and `physicalRelease`. When more than one
  date is populated, the earliest qualifying date inside the configured
  look-ahead window wins.
- Already-downloaded movies still drop out (`hasFile === false` and monitored
  filtering are unchanged), and the configurable
  `coming_soon_lookahead_days` window is still respected.

## What's new in 2.1.1

- Configurable Coming Soon look-ahead via `coming_soon_lookahead_days`
  (1–365 days, default **90**), so Coming Soon can reach further out without
  changing existing installs.
- Radarr eligibility began including `physicalRelease` alongside
  `digitalRelease`, with the earliest qualifying date inside the window
  selected.

## What's new in 2.1.0

- The add-on is now presented as **Now Showing**.
- Apple TV, generic streaming-device, and Kaleidescape backends join Plex,
  Jellyfin, Emby, and Kodi.
- `coming_soon` mode turns Radarr/Sonarr upcoming movies and episodes into a
  Fully Kiosk-friendly screensaver.
- The setup UI can load compatible players, configure Coming Soon sources, and
  preview display changes before saving, with a corrected bulb-frame preview.
- Setup now opens at the top and scrolls correctly inside Home Assistant
  Ingress, so tall setup tabs no longer require browser zoom.
- New visual controls include frame style, bulb size, marquee font, theme
  preset, accent color, marquee background color, corner radius, progress bar,
  ratings, genre chips, info-panel mode, backdrops, burn-in nudge, and night
  dimming.
- The docs cover using Now Showing and Coming Soon at the same time with two
  display URLs or instances.

## What this is

This add-on wraps the unified Node 20 server (`../../server/`) and serves:

- `/now_showing.html` - the kiosk UI (opens via Ingress or on port `8099`)
- `/api/state` - normalised now-playing payload (no HA token in the browser)
- `/api/media-info/:ratingKey` - Plex metadata proxy when `backend: plex`
- `/api/artwork` - same-origin artwork proxy
- `/api/coming-soon` - Radarr/Sonarr upcoming-release payload
- `/healthz` - liveness probe

Supervisor injects `SUPERVISOR_TOKEN`, so the add-on talks to Home Assistant
at `http://supervisor/core` with **no user-created HA token required**.

## Installation

Once this repository is published as a Home Assistant add-on repository, adding
it is:

1. Settings -> Add-ons -> Add-on store -> ... -> Repositories
2. Paste `https://github.com/rusty4444/now-showing-ha`
3. Install **Now Showing**
4. Start it, then click **Open Web UI**

## Documentation

Full option reference lives in [`DOCS.md`](./DOCS.md). HA renders it on the
add-on's **Documentation** tab.
