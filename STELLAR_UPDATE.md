# Stationary core lighting — 2026-09-19

Original core.webp is unchanged. The background, glass frame and central core remain fixed in size and position. Two radial layers affect only the central sphere: soft local dimming and a faint cyan/violet highlight. Only opacity changes, never source-image scale, translation or brightness.

The light follows smooth overlapping 6.8 and 11.3 second waves, throttled to ~30 paints/second with requestAnimationFrame and a persistent phase. It stops offscreen, in hidden tabs and on manual pause; time does not jump on resume. System reduced motion reduces the brightness range. One persisted pause setting also pauses ambient interface lighting.

Buttons have a 1.5–9% light veil over 8.6 seconds. Card edges have a 10–32% accent overlay over 9.8 seconds with staggered phases. Disabled buttons, sold-out cards and experimental cards are excluded. Selected category tabs have a subtle stationary border. Focus outlines, labels and click targets are preserved. Reduced-motion mode disables ambient CSS animation. No new package, animated image, WebGL, video, payment change or database migration.

Guidance: https://web.dev/articles/animations-guide and https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

Deploy with the supplied 15/16 Termux scripts. VPS deployment reuses the existing isolated PostgreSQL API tests, backups and rollback workflow and does not depend on GitHub Actions.
