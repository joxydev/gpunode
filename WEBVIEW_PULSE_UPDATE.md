# Telegram WebView core pulse — 2026-09-19

The previous animation could stay frozen because the removed pause control persisted `aethermind.motion=paused`. It also depended on Page Visibility plus IntersectionObserver, although Telegram Bot API 8.0+ provides its own `isActive` state and `activated` / `deactivated` events.

This update deletes the obsolete pause value, removes the pause control, follows the Telegram lifecycle and retains Page Visibility only for older clients and ordinary browsers. A watchdog performs an opacity update if a foreground embedded WebView delays `requestAnimationFrame` during a native sheet transition.

The source `core.webp`, space background and glass cube never transform. Three composited layers are limited to the central 38% of the artwork. A 4.4 second smoothstep cycle dims the center almost completely, restores the cyan/violet light and adds a bounded cross flare. Reduced-motion mode uses a smaller opacity range but does not make the core static.

Local verification covers a Telegram Android 11 LOW-performance User-Agent, stale pause migration, Bot API 8+ activation/deactivation, Bot API 7.9 fallback, compact viewport changes, reduced motion and a deliberately stalled `requestAnimationFrame`. Screenshot diffing confirms all changed pixels stay within the center while the sky and cube remain identical.

No image, dependency, backend endpoint, payment behavior or database schema is changed.
