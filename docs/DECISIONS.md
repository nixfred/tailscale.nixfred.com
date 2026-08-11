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

PARTIALLY SUPERSEDED by 0007 on the same day: the no logo clause no longer holds. The official wordmark renders on the homepage by Fred's ruling. Every other clause here stands.

## 0007, 2026-08-10, Fred: the official Tailscale logo appears on the homepage

Fred's direct instruction. The official white wordmark from Tailscale's own press kit (self hosted at public/brand/) renders in the homepage hero, captioned as the subject of the guide with ownership attribution. This amends DECISIONS 0006: the palette and visual identity separation still hold everywhere else; the logo appears nominatively on the main page only. The press kit is Tailscale's published brand distribution channel.

## 0008, 2026-08-10, Fred: every page carries graphics; nixfred.com link is literal

Two standing rules from Fred. One: every page on this site carries at least one custom SVG graphic built from tokens (modules carry two or more). Two: the footer link home renders the literal text nixfred.com sitewide, in addition to the byline.

## 0009, 2026-08-10: navigation diagrams are data driven, never hand maintained

Every content page carries a diagram generated from the content collections themselves: a curriculum rail on module pages, a coverage map with real per area counts on drill pages, a track rail on guide pages. Rationale: a hand maintained "you are here" graphic drifts the moment content changes and then lies to the reader. Generated ones cannot. The same rule governs the counts on the homepage, the drills index, and the sources ledger chart: if a number appears in a graphic, it is computed at build time from the content, never typed.

## 0010, 2026-08-10: the fieldcraft, drills, and code lab tracks ship

Fifteen drills across six failure areas, four fieldcraft guides, and four code lab guides. Drills follow a fixed section order (ticket, evidence, hypothesis tree, investigation, root cause, fix and prevention, handoff package, the trap) so the format itself teaches the method. Two drills are derived from incidents on the author's own tailnet, published with generic hostnames per site rule 2.

## 0011, 2026-08-11, Fred: a recipes track ships, two of them from the author's own fleet

Fred's instruction: show the cool things a tailnet makes possible, five to seven of them, two drawn from how he actually runs his own network and the rest researched. Recipes are a distinct content type from drills: a drill investigates a failure, a recipe builds a capability. Fixed section order (what you get, how it works, build it, verify it, gotchas, where to take it next) with a level of intermediate or advanced and a one line payoff.

The two from the author's own use are published with the specific traps that were paid for in real time, because that is what makes them worth more than the documentation: a host firewall whose enablement does not survive a reboot on one platform, reporting healthy while zero rules are loaded, and a machine whose system hostname disagreed with the name that resolves on the tailnet, in a tool that used one string for both the self check and the SSH target. Hostnames and provider names are genericized per site rule 2.
