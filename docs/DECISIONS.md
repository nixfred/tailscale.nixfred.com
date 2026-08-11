# Decisions. tailscale.nixfred.com

> Dated rulings. Superseded entries get marked SUPERSEDED, never deleted. Naming per STANDARDS 8.4: single file, docs/DECISIONS.md.

## 0001, 2026-08-10, Fred: site direction

Public field guide and lab notebook. Four content tracks (curriculum, feature encyclopedia plus CLI, fieldcraft plus drills, code lab) plus labs run on the author's own tailnet, published sanitized. Hybrid depth model: curriculum discipline benchmarked on the nutanix build, engineering discipline benchmarked on the n1 build.

## 0002, 2026-08-10, Fred: stack is Astro via the factory seed

Stage 0 found a CONFLICT: the draft PRD specified Next.js (copying the n1 sibling), but factory STACK.md requires explicit approval for Next.js and the factory seed ships Astro with bootstrap, gates, and deploy prebuilt. Fred ruled: Astro via factory seed. Typed content discipline moves to Astro content collections.

## 0003, 2026-08-10, Fred: repo is PUBLIC

Fred's words: as long as it is not a SECRET, everything can go in there. Consequence: sanitization happens before commit, not before deploy. Git history is treated as permanently public.

## 0004, 2026-08-10, Fred: no quiz engine

Quiz only if a certification exists. Checked 2026-08-10: Tailscale offers no certification program. Therefore no quiz or exam simulation; drills are prose case studies.

## 0005, 2026-08-10: build order is internals first

After the foundation, modules 00 through 03 plus the troubleshooting module come first, then labs wave 1, then fieldcraft, then the encyclopedia. Rationale: mechanism depth is the hardest and highest value material; reference breadth follows.

## 0006, 2026-08-10: site title treatment

Title: Tailscale Field Guide. The vendor name appears nominatively only (qumulo.nixfred.com precedent), no logo or visual identity imitation, one unofficial disclosure line in the global footer.
