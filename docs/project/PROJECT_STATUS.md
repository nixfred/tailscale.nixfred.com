# PROJECT STATUS
## tailscale.nixfred.com

> Single source of truth for project state. If it is not here, it is
> not the state.

## Current phase

CURRICULUM COMPLETE 2026-08-10. All thirteen modules live (00 to 12),
graphics on every page, official logo on the homepage (DECISIONS 0007),
all six gates green. Next: fieldcraft spine plus drills, then labs
wave 1 (labs need supervised tailnet time; see docs/PRD.md).

## Live URLs

1. Production: https://tailscale.nixfred.com
2. Apex aliases: https://nixfred.com/tailscale and https://nixfred.com/ts (both 301)
3. Mirror: https://tailscale.spikenix.com
4. Repo: https://github.com/nixfred/tailscale.nixfred.com

## Completed

1. 2026-08-10: Stage 0 hardening (one CONFLICT resolved: Astro over Next.js, Fred ruling). READY TO BUILD.
2. 2026-08-10: Factory bootstrap, every step verified by its output: preflight, seed, build, public repo, Actions secret, Pages project, first deploy, domain attach success true, CNAME success true.
3. 2026-08-10: Design system (slate and teal tokens, fontsource trio), Shell chrome with version stamp and disclosure line, content collections with zod schema, callout transform, guardrail gate (proven on known bad input), adapted contrast gate (40 required pairs green).
4. 2026-08-10: Five curriculum modules drafted against official sources, independently fact checked, integrated: 22,600 words, 49 ledger sources, 10 token-only SVG diagrams.
5. 2026-08-10: Deployed via Actions (fresh-checkout gates green), browser verified at 390, 820, and 1440 with screenshots; footer version matched deployed commit f3ea8ac.
6. 2026-08-10: Fleet presence: apex aliases live, spikenix mirror spot checked 200, homepage card appended to portfolio.json and pushed.

## Known state

1. portfolio.json card is in the registry, but the live nixfred.com root (v6 shell) bakes its own cards and does not read portfolio.json. Surfacing this site on the v6 homepage is a separate v6-repo change. Recorded as fleet debt in the factory (DEPLOY.md traps, 2026-08-10).
2. Favicon raster fallbacks (32px PNG, 180px apple-touch) not yet generated from the SVG mark; Phase 7 polish item.

## Next

1. Phase 2: labs wave 1 (DERP fallback, tag/SSH lockout repro, MagicDNS failure injection, full-lifecycle pcap).
2. Phase 3: fieldcraft spine plus first five drills.
3. Phase 4 onward per docs/PRD.md.
