# Owner and support update — 2026-09-19

- Core visual uses requestAnimationFrame for transform/opacity, resumes on visibility/pageshow, offers a persisted pause button. Reduced motion uses a smaller amplitude. No generated frames or heavy animation dependencies.
- Agreement accept remains gated by reaching the end and checking consent. Early click gives a visible live hint. Agreement version and PDF are unchanged.
- Profile ornament removed from all main screens. Image context-menu/drag suppression is a convenience, not access control for public images.
- Owner console: request decisions ACCEPTED/REJECTED with mandatory reason; CLOSED preserved for compatibility. Closed decisions cannot be overwritten. Historical closed requests remain valid without invented reasons.
- Support: QUESTION/COMPLAINT, subject, OPEN/IN_PROGRESS/ANSWERED/CLOSED, reply visible in user account. Owner-only paginated ticket/request lists; activity journal fetched only when opened. Manual owner refresh; user account refreshes every 30 seconds.
- Creation limited to five tickets per hour under a per-user transaction lock. Owner decisions and replies are serialized under transaction locks. No new payment or hardware claims.
- Additive migration preserves users, agreement acceptances, requests and replies. Old answered tickets become ANSWERED. No production balance or ledger writes.

## Verification
Production builds and 13 unit/database tests pass locally; mobile browser scenarios cover pulse (including reduced-motion CSS), pause, agreement hint/gate, four menus, support submission, owner decisions/replies and on-demand journal. Browser fixtures are not an actual Telegram device.
The deployment runs the extended real Nest/Prisma HTTP suite on disposable native PostgreSQL before touching production migrations. It covers authentication, agreement gate, foreign-user/owner access, duplicate request handling, decision validation, ticket filters, replies, missing IDs and concurrent support rate limits. Local native PostgreSQL was unavailable.

## Deploy
Use the supplied Termux push script, then VPS script. No GitHub Actions dependency. Existing credentials, bot and HTTPS reused. Database backup is mandatory. Rollback restores app release/unit, not schema. No database deletion or cleanup of historical backups.
