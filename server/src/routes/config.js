// GET /api/config — exposes browser-safe runtime flags.
//
// Only ships non-sensitive values. Tokens and internal settings (TTLs, cache,
// kiosk URLs) are deliberately excluded. Visual toggles let the frontend
// conditionally render new v2 UI without a rebuild.
//
// #95 — also surfaces the canonical setup state (server mode, configured
// URLs, plex username, secret-set flags) so the in-app setup overlay can
// show what the add-on/server is actually using rather than relying on a
// per-browser localStorage copy. Secret values themselves are never
// returned; only an `*Set` boolean. The frontend uses these to render a
// "managed by add-on" read-only view.

import { Router } from 'express';

export function configRoute({ config }) {
  const r = Router();

  r.get('/api/config', (_req, res) => {
    // No-cache: flipping a toggle in the add-on UI restarts the server, but
    // browsers on the wall might live for days. Let them re-read on reload.
    res.set('Cache-Control', 'no-store');
    res.json({
      // #95 — `mode` lets the frontend tell add-on/Docker installs (where
      // the server is the source of truth for setup) apart from HACS-only
      // installs (where there is no server, so localStorage stays canonical
      // per-tablet).
      mode: config.mode || 'standalone',
      managed: !!config.haToken, // server already has a working HA token
      // #98 — overlay-aware extras so the in-app setup form can prefill
      // non-secret fields without a separate request. Secrets stay behind
      // *Set booleans only.
      haUrl: config.haUrl || '',
      haUrlSet: !!config.haUrl,
      haTokenSet: !!config.haToken,
      landscape: !!config.landscape,
      displayMode: config.displayMode || 'now_showing',
      backend: config.backend || 'plex',
      player: config.player || '',
      // Plex metadata API surfaces (URL non-sensitive; token boolean only).
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
        // #100 — cinema/theatrical inclusion toggle. The frontend keeps this
        // for parity with the server: HACS-only installs without /api/coming-
        // soon also evaluate eligibility client-side, and they read the same
        // field name from /api/config so add-on/Docker installs that flip the
        // toggle in the overlay see consistent behaviour everywhere.
        includeCinemaReleases: config.comingSoon?.includeCinemaReleases !== false,
        // #95 — Radarr/Sonarr URLs are non-secret (typically a LAN IP); the
        // API keys stay server-side and we only surface a boolean.
        radarrUrl: config.comingSoon?.radarrUrl || '',
        radarrApiKeySet: !!config.comingSoon?.radarrApiKey,
        sonarrUrl: config.comingSoon?.sonarrUrl || '',
        sonarrApiKeySet: !!config.comingSoon?.sonarrApiKey,
        // #91 — surface whether TMDB enrichment is wired up so the kiosk
        // setup UI can light up a status pill ("TMDB region: AU"). The
        // token itself stays server-side.
        tmdb: {
          enabled: !!config.comingSoon?.tmdb?.apiKey,
          apiKeySet: !!config.comingSoon?.tmdb?.apiKey,
          region: config.comingSoon?.tmdb?.region || 'AU',
        },
      },
      visual: {
        progressBar: !!config.visual?.progressBar,
        showPosterTitle: config.visual?.showPosterTitle !== false,
        ratingsBadges: !!config.visual?.ratingsBadges,
        genreChips: !!config.visual?.genreChips,
        infoPanelMode: config.visual?.infoPanelMode || 'on_tap',
        useBackdrops: !!config.visual?.useBackdrops,
        // #65 frame style. Presentation-only; frontend maps this to body
        // data-frame-style and starts/stops the bulb timer as needed.
        frameStyle: config.visual?.frameStyle || 'bulbs',
        bulbSizePx: config.visual?.bulbSizePx ?? 28,
        marqueeFont: config.visual?.marqueeFont || 'bebas-neue',
        posterFraming: config.visual?.posterFraming || 'centred',
        filmGrain: !!config.visual?.filmGrain,
        kenBurns: !!config.visual?.kenBurns,
        backdropStyle: config.visual?.backdropStyle || 'fullscreen',
        backdropDelayMs: Number.isFinite(config.visual?.backdropDelayMs)
          ? config.visual.backdropDelayMs : 10000,
        // #28 burn-in mitigation. Frontend reads these to decide whether to
        // run the nudge timer and which night-mode trigger to wire up.
        burnInMitigation: !!config.visual?.burnInMitigation,
        nudgeIntervalMs: config.visual?.nudgeIntervalMs ?? 60000,
        nudgeAmplitudePx: config.visual?.nudgeAmplitudePx ?? 4,
        nightModeEntity: config.visual?.nightModeEntity || '',
        nightModeOpacity: config.visual?.nightModeOpacity ?? 0.4,
        // #23 theme preset + #66 accent colour. Both are presentation-only
        // so safe to expose; the frontend turns them into <body data-theme>
        // + a single CSS custom property override.
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
    });
  });

  return r;
}
