# PRD, hardened. tailscale.nixfred.com

> Implementation contract per factory PRD_HARDENING.md. Stage 0 completed 2026-08-10. Readiness: READY TO BUILD. Fleet law lives in factory.nixfred.com and governs everything this file does not override.

## Mission

An unofficial Tailscale field guide and lab notebook, deep enough that a reader could take an ambiguous tailnet problem cold: what every feature does, how the system actually works underneath, and how to investigate it when it misbehaves. Built and maintained by Fred Nix. Not affiliated with or endorsed by Tailscale Inc.

## Audience

Network engineers, homelabbers, and support or field engineers who run tailnets and want working depth, not marketing copy. Two reading modes, both first class:

1. Reference mode: a reader with 30 seconds finds the exact flag, ACL stanza, or failure signature.
2. Study mode: a reader with two hours works a module end to end and comes out able to whiteboard the mechanism.

## Content architecture: five tracks

1. **Curriculum** (`/learn/`): 13 sequential modules, from orientation through WireGuard foundations, the control plane, NAT traversal (STUN, DERP, Peer Relays), identity, ACLs and grants, MagicDNS, routing, Serve and Funnel and Services, the platform matrix, enterprise operations, troubleshooting, and a tour of the open source codebase.
2. **Feature encyclopedia** (`/features/` plus `/cli/`): one reference page per feature and a complete CLI subcommand tour. Coverage target: every feature on the official docs site plus the current changelog.
3. **Fieldcraft** (`/fieldcraft/` plus `/drills/`): evidence collection, reproduction construction, the engineering handoff package, and written case study drills (symptom, evidence, hypothesis tree, root cause, handoff). Minimum 15 drills.
4. **Recipes** (`/recipes/`): capabilities worth building on a working tailnet, each with mechanism, exact commands, verification, and traps. Two are drawn from the author's own fleet and published sanitized; the rest are researched from official sources. Added on Fred's instruction 2026-08-11, DECISIONS 0011.
5. **Code lab** (`/code-lab/`): guided reads of the open source Go codebase, pprof profile exercises, and annotated packet captures of STUN, DERP, and WireGuard traffic.

Plus labs (`/labs/`): at least 10 exercises actually executed on the author's own tailnet (a mixed fleet of macOS, Linux, VMs, and cloud hosts), published with generic hostnames.

## Depth target (Law 12)

Coverage rather than page count, per Fred's ruling of 2026-08-12 (DECISIONS 0012): every feature on the official docs sitemap and current changelog has a home here. Modules run 4000 to 6000 words each. No placeholders: routes ship only when their content is real, and in-progress state is authored honestly.

## Pedagogy

1. Every concept explained at least three ways: analogy, mechanism, failure mode.
2. Every feature page states what the feature is NOT and when not to use it.
3. Five callout types rendered as first class components: HOW-IT-WORKS, GOTCHA, ON-THE-WIRE, FROM-THE-FIELD, LAB.
4. No quiz or exam simulation. Tailscale offers no certification program (checked 2026-08-10), so there is nothing to simulate. Drills are prose case studies.

## Source validation (Law 9)

1. Every factual product claim resolves to a sources ledger entry: URL, title, checked date.
2. Source hierarchy: official docs, then KB, then changelog, then blog, then the open source code itself. Third party writeups are leads, never citations.
3. Version-qualify claims (client version, OS, plan tier). Conflicts resolve to the narrowest current claim with an editorial note on `/sources/`.
4. Currency rule: the 2026 surface (Peer Relays GA, Tailscale Services GA, Aperture, workload identity federation) is covered; a changelog review pass is part of every content phase. Every claim carries a checked date and the schema rejects a sourceless page. There is deliberately no rendered staleness flag (DECISIONS 0013).

## Stack and architecture

1. Astro via the factory seed (Fred ruling 2026-08-10), bun, static output to `dist/`.
2. Content authored in Markdown through typed Astro content collections; the collection schema is the content contract.
3. Cloudflare Pages, push to main deploys via Actions, `./deploy.sh` as the manual escape hatch.
4. No backend, no APIs, no user accounts, no analytics beyond Cloudflare defaults. Browser state stays local.

## Site rules (stricter than factory baseline)

1. This is a product field guide and lab notebook only. No recruiting, hiring, candidate, or career framing anywhere: copy, metadata, routes, image text, alt text, structured data, commit messages. <!-- guardrail:allow -->
2. Tailnet privacy: published lab material uses generic hostnames (node-a, lab-vm-1), no real IPs beyond documentation ranges, no keys, no policy files copied verbatim from a real tailnet. Sanitization happens before commit, not before deploy.
3. Brand separation: the site design does not imitate Tailscale's visual identity, and the name appears nominatively. One disclosure line in the global footer: unofficial, not affiliated with or endorsed by Tailscale Inc. AMENDED by Fred's ruling of 2026-08-10 (DECISIONS 0007): the official wordmark from Tailscale's own press kit renders in the homepage hero, self hosted, captioned with ownership attribution.
4. These rules are enforced by `tests/check-guardrail.sh` in addition to the seed gates, proven with known bad input before first use.

## Acceptance criteria (current release: Phase 0 foundation plus Phase 1 core)

1. Phase 0: the deployed homepage at https://tailscale.nixfred.com renders real authored content at 390, 820, and 1440 pixel widths with no horizontal overflow, a footer with the nixfred.com link, repo link, version identifier, and the single disclosure line, and all four seed gates plus the guardrail gate pass.
2. Phase 1: modules 00 through 03 plus the troubleshooting module published at full depth, each with at least 2 inline SVG diagrams, every factual claim resolving to a sources entry, and the module index linking only to modules that exist.
3. Fieldcraft, drills, and code lab: SHIPPED 2026-08-10. Fifteen drills spanning all six failure areas, each ending in a filled handoff package; four fieldcraft guides; four code lab guides.
4. Every page carries at least two custom SVG graphics, and any number shown inside a graphic is computed from the content collections at build time.
5. Remaining DEFERRED work: the feature encyclopedia with its CLI tour, and the on tailnet lab exercises. Both enter through Stage 0 review of this contract's affected sections.

## Deferred

1. Feature encyclopedia and CLI tour: one reference page per feature, enumerated against the official docs sitemap and changelog.
2. On tailnet lab exercises: these deliberately break a working network (blocking UDP, forcing relay paths, injecting DNS failures), so they are run under supervision rather than autonomously, then published sanitized.
3. Favicon raster fallbacks derived from the SVG mark.
