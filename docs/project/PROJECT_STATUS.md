# PROJECT STATUS
## tailscale.nixfred.com

> Single source of truth for project state. If it is not here, it is
> not the state. Rewritten 2026-08-12 because it had drifted: it still
> claimed 42 pages and listed shipped work under Next.

## Current phase

Five content tracks live at 50 pages. Curriculum (13 modules), recipes
(7), drills (15 across six failure areas), fieldcraft (4 guides), code
lab (4 guides). Every page carries two or more custom SVG diagrams, and
every number rendered inside a diagram is computed from the content at
build time. All six gates green. Fleet presence complete.

Remaining: the feature encyclopedia with its CLI tour, and the on
tailnet labs. Both are described under Next.

## Live URLs

1. Production: https://tailscale.nixfred.com
2. Apex aliases: https://nixfred.com/tailscale and https://nixfred.com/ts (both 301)
3. Mirror: https://tailscale.spikenix.com
4. Repo: https://github.com/nixfred/tailscale.nixfred.com (public)
5. Private companion: github.com/nixfred/tailscale.prep

## Numbers, as of 2026-08-12

1. 50 pages built, 50 URLs in the sitemap, verified equal.
2. 170 distinct sources on the ledger, each with a checked date.
3. Roughly 120,000 words of body prose by declared frontmatter counts.
4. 65 diagrams, all built from the four diagram tokens.

## Completed

1. 2026-08-10: Stage 0 hardening; one CONFLICT resolved (Astro over Next.js, Fred ruling). Factory bootstrap verified step by step. Design system, content collections, callout transform, guardrail gate proven on known bad input, contrast gate adapted.
2. 2026-08-10: Curriculum complete, 13 modules, drafted against official sources and independently fact checked.
3. 2026-08-10: Drills, fieldcraft, and code lab shipped. Drill drafts were recovered from the workflow journal after a session limit killed their verifiers; a second pass then fact checked every unverified file. Findings in HISTORY.md chapter 5.
4. 2026-08-10: Discovery surface: sitemap and robots added (the factory seed ships neither, recorded as fleet debt), favicon rasters generated from the SVG mark.
5. 2026-08-11: Recipes track, seven of them, two written from running a real fleet.
6. 2026-08-12: Fleet presence closed. The site is in the v6 master registry (src/data/sites.ts, the one place a site is added), with a captured clip and poster, and the hub header now reads 53 systems. Apex aliases and the spikenix mirror were already live.

## Known state

1. DONE 2026-08-12: the knowledge base URL migration ran as one pass. All 72 `/kb/` citations were resolved by following their actual redirects and rewritten to canonical `/docs/` URLs, then all 86 resulting URLs were verified to answer 200 directly. Checked dates were deliberately NOT restamped, because a checked date records when a claim was verified against a page, not when a URL was resolved. Two consequences worth knowing: one redirect was a chain (`acl-syntax` pointed at `policy-syntax`, which then pointed at `/docs/`), so a naive one hop rewrite would have left citations on a still redirecting URL; and the ledger fell from 170 to 155 entries because two old URL shapes for the same page now collapse into one entry, which was the point.
2. Some drills quote operating system internals (macOS unified log lines) that have no official Tailscale source. They are confined to constructed scenarios and labeled as mechanism illustration, never as documented product behavior. See docs/RISKS.md.
3. Customer version matrices in drills are deliberately behind the current release, because Customers run behind. No drill presents a cited version as current.
4. There is no rendered staleness flag, deliberately (DECISIONS 0013). Sources carry checked dates; currency is maintained by a changelog pass during content work.

## Next

1. **Feature encyclopedia and CLI tour.** The one track never started, and the thing that satisfies the coverage target set in DECISIONS 0012: enumerate every feature from the official docs sitemap and the changelog, give each a home, and track it as a checklist percentage rather than a page count.
2. **On tailnet labs, one at a time, carefully** (Fred, 2026-08-12). Each lab deliberately breaks a working network: blocking UDP to force a relay path, reproducing the tag and SSH lockout, injecting DNS failure, capturing a full connection lifecycle. Non destructive observation first. Anything that disrupts a live tailnet is proposed and confirmed before it runs, never executed unattended.
3. **The knowledge base URL pass** described under Known state 1.
