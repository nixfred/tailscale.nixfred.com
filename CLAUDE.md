# CLAUDE.md - tailscale.nixfred.com

> Fleet law lives in the factory: github.com/nixfred/factory.nixfred.com (PRIVATE).
> LAWS.md, PRD_HARDENING.md, STACK.md, DEPLOY.md, CONTENT.md, and OPERATIONS.md there govern this site. This file holds only what is specific to THIS site. If this file conflicts with the factory, the factory wins unless Fred overrode it here explicitly (mark overrides with "FACTORY OVERRIDE:").

## Stage 0 status

1. **Hardened PRD:** docs/PRD.md
2. **Factory Compliance Matrix:** docs/FACTORY_COMPLIANCE.md
3. **Decision log:** docs/DECISIONS.md (single file, STANDARDS 8.4)
4. **Risk register:** docs/RISKS.md
5. **Readiness:** READY TO BUILD (2026-08-10)
6. **Approved scope:** Phase 0 foundation plus Phase 1 core (modules 00 to 03 plus troubleshooting). Later phases re-enter Stage 0 for their sections.
7. **Last hardening review:** 2026-08-10

## What this site is

An unofficial Tailscale field guide and lab notebook: how the mesh actually works, feature by feature, packet by packet. Four tracks (curriculum, feature encyclopedia plus CLI, fieldcraft plus drills, code lab) plus labs executed on the author's own tailnet and published sanitized. Not affiliated with or endorsed by Tailscale Inc.

## Site facts

| Property | Value |
|----------|-------|
| **URL** | https://tailscale.nixfred.com |
| **Repo** | github.com/nixfred/tailscale.nixfred.com (PUBLIC) |
| **Pages project** | tailscale-nixfred-com |
| **Primary class** | static publication |
| **Stack** | Astro via factory seed (Fred ruling 2026-08-10, DECISIONS 0002) |
| **Output dir** | dist/ |
| **Deploy** | push to main deploys via Actions; ./deploy.sh is the escape hatch |
| **Mission** | Mechanism-first Tailscale mastery, every claim sourced |
| **Depth target** | 110+ pages at completion, benchmarked against haeb.org (105) |
| **Motion direction** | restrained, functional only |
| **External dependencies** | none |
| **Freshness target** | source entries re-checked when cited content changes; staleness flags planned with the encyclopedia |

## Design law (settled, do not reopen)

1. Palette: deep slate base (--paper #0b1220), teal accent ramp (--accent-500 #2dd4bf), recorded in src/styles/tokens.css. Deliberately NOT the vendor's palette (DECISIONS 0006). Tokens are law; no raw hex outside tokens.css.
2. Typography trio: Space Grotesk display, Public Sans body, IBM Plex Mono for data, CLI output, numbers, and labels. Self hosted via fontsource, no CDN.
3. Dark only. No light mode, no toggle.
4. Five semantic callouts (HOW-IT-WORKS, GOTCHA, ON-THE-WIRE, FROM-THE-FIELD, LAB) authored as blockquote markers in Markdown, transformed by src/lib/remark-callouts.mjs, styled in global.css. Callout accent tokens live in tokens.css.
5. Module diagrams are inline SVG using ONLY the four --diagram-* tokens, viewBox only, role="img" plus aria-label plus title.
6. Voice: direct, precise field guide. Second person allowed. Explain WHY.
7. Every page carries at least one custom SVG graphic from tokens; module pages carry at least two (Fred ruling 2026-08-10, DECISIONS 0008).
8. Footer renders the literal text nixfred.com as a link home on every page (Fred ruling 2026-08-10, DECISIONS 0008).

## Motion model

1. **Decorative motion:** none.
2. **Functional motion:** hover and focus transitions on cards and nav (fast, under 200ms); these reduce to immediate state changes under prefers-reduced-motion via the global kill rule.
3. **Essential motion:** none. Nothing on this site requires motion to understand.
4. **Interaction rule:** No animation traps input, hides controls, forces an unnecessary wait, or makes essential content available only through motion.

## Site-specific rules (stricter than factory law)

1. Product field guide positioning only. No recruiting, hiring, or career framing anywhere: copy, metadata, routes, alt text, commit messages. <!-- guardrail:allow -->
2. Tailnet privacy: published lab material uses generic hostnames (node-a, lab-vm-1), no real IPs beyond documentation ranges, no keys, no verbatim policy files from a real tailnet. Sanitize BEFORE commit; this repo is public and history is forever.
3. Brand separation: no visual identity imitation in the site design; one disclosure line in the global footer (rendered by Shell.astro). FACTORY OVERRIDE (Fred, 2026-08-10, DECISIONS 0007): the official Tailscale wordmark from their press kit renders on the homepage hero with ownership attribution, nominative use.
4. Enforced by tests/check-guardrail.sh (banned positioning vocabulary, private machine names, local paths), proven against known bad input 2026-08-10.
5. Every factual product claim carries a source in module frontmatter; the content collection schema (src/content.config.ts) rejects sourceless modules at build time. Official sources only: docs, KB, changelog, blog, the open source repos.

## Content model

1. Modules: Markdown in src/content/modules/, schema in src/content.config.ts, rendered at /learn/<slug> by src/pages/learn/[slug].astro. The schema is the producer contract, quoted verbatim to any writing agent.
2. /learn lists live modules from the collection and describes planned ones as prose with NO links. A module appears as a link only when it exists.
3. /sources aggregates every module's frontmatter sources into the ledger.
4. Homepage cards render from the collection; nothing on the homepage links to a route that does not exist.
5. Drills: Markdown in src/content/drills/, rendered at /drills/<slug>. Fixed section order (ticket, evidence, hypothesis tree, investigation, root cause, fix and prevention, handoff package, the trap). Area must be one of connectivity, identity, policy, dns, routing, platform.
6. Guides: Markdown in src/content/guides/ with a track of fieldcraft or code-lab, rendered at /fieldcraft/<slug> or /code-lab/<slug>.
7. Navigation diagrams (CurriculumRail, AreaMap, TrackRail in src/components/) are generated from the collections. Any number rendered inside any graphic on this site is computed at build time, never typed by hand (DECISIONS 0009).

## Ship checklist (factory Laws 4, 6, 11, 13, 14 plus OPERATIONS.md)

- [x] Mandatory Stage 0 completed under PRD_HARDENING.md (2026-08-10)
- [x] Factory Compliance Matrix has no unresolved MISSING or CONFLICT items
- [x] Hardened PRD reports READY TO BUILD
- [x] Fred rulings recorded in docs/DECISIONS.md
- [x] tailscale.nixfred.com live on the Pages project (bootstrap 2026-08-10)
- [x] nixfred.com/tailscale apex alias live, plus /ts shorthand (claimed 2026-08-10)
- [x] spikenix mirror spot-checked (200, 2026-08-10)
- [x] Homepage card in portfolio.json after production verification (2026-08-10; note: the v6 root bakes its own cards, registry entry alone does not surface it there)
- [x] Footer: nixfred.com link, repo link, version tied to deployed commit (Shell.astro)
- [x] All six gates green locally and on the fresh-checkout Actions run (2026-08-10)
- [x] Browser-verified at 390/820/1440 with screenshots; footer version matched deployed commit (2026-08-10)
- [x] Motion: functional only, reduced motion covered by global kill rule
- [x] No live data, no user input, no scheduled jobs (static publication)
- [x] Production build scanned: no secret, localhost, credential, or private path (guardrail gate plus staged-file scan, 2026-08-10)

A change is done when: committed, pushed, deployed, browser-verified live. Report the URL and the evidence.
