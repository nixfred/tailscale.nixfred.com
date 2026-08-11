# HISTORY
## The Making of tailscale.nixfred.com

> The build chronicle. Every milestone gets a chapter, written as it
> happens. The site is the product; this is the ship's log of the
> factory run that built it.

---

## Chapter 1: Bootstrap
### 2026-08-10

Stage 0 ran first: the PRD was hardened against the full factory, one
CONFLICT surfaced (the draft specified Next.js; STACK.md requires
explicit approval for it) and Fred ruled Astro via the factory seed.
The compliance matrix closed with no unresolved items.

bootstrap.sh then ran clean end to end on this machine, every step
echoed and none failed: token preflight passed the Pages endpoint,
seed copied and substituted, bun install (278 packages), first Astro
build (1 page), git init and first commit, public GitHub repo
nixfred/tailscale.nixfred.com created and pushed, Actions secret set,
Pages project tailscale-nixfred-com created, first deploy uploaded
(2 files), custom domain attach returned success true, and the proxied
CNAME create returned success true. The pages.dev URL served
immediately; the custom domain waited on certificate issuance at the
time bootstrap finished and was verified separately.

## Chapter 2: Design system and first content
### 2026-08-10

Same day as bootstrap. Tokens rebranded to the slate and teal system
(two values corrected after the contrast gate math: --gray-500 and
--diagram-line both lightened to clear their thresholds). Shell layout
added the header, footer, version stamp, and the single disclosure
line. Content collections wired with the module schema as the producer
contract. The callout transform (remark-callouts.mjs) turned the five
blockquote markers into styled asides. The guardrail gate joined the
seed's four gates plus the contrast gate in deploy.yml. First five
curriculum modules (00 to 03 plus troubleshooting) drafted and
verified against official sources, then integrated.

---
