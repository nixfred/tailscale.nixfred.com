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

## Chapter 3: The curriculum completes
### 2026-08-10

Still the same day. Fred ordered graphics on every page, the official
logo on the homepage, and a literal nixfred.com link home. The press
kit came straight from Tailscale's own distribution channel, the hero
grew a five node mesh diagram, /learn a curriculum map, /sources the
citation hierarchy (DECISIONS 0007 and 0008).

Then the second module wave landed: eight writers and eight verifiers,
each writer against current official docs, each verifier repairing
facts, style, and cross references against the canonical module table
(the fix for wave one's renumbering pass, which worked: zero renumber
edits needed this time). One guardrail catch: a courier analogy used a
banned word metaphorically and was reworded. The curriculum now stands
complete: thirteen modules, 00 through 12, roughly 56,000 words,
94 deduplicated ledger sources, every page carrying token built SVG
diagrams.

---

## Chapter 4: The craft tracks, and a session limit
### 2026-08-10, late

Twenty six agents went out to write fifteen drills, four fieldcraft
guides, and four code lab guides. Eighteen came back. The session hit
its usage limit partway through the verification phase, killing every
drill verifier and three guide verifiers, and because each item runs
its stages as a chain, the dead verify stage dropped all fifteen
drills to null in the returned result. The workflow reported drills as
an empty set.

They were not lost. Every draft had already been journaled, so the
recovery was to read the run journal, pull the fifteen drill drafts and
the three unverified guide drafts straight out of it, and reconcile
against the verified copies where those existed. Nothing was rewritten.

What the missing verifiers would have caught, the gates caught instead.
One guide draft carried a line of chatter above its frontmatter, which
the schema rejected outright. One drill used a system path containing
/Users, which the guardrail gate blocks without exception; rather than
loosen the gate for a path that happens to be harmless, the evidence was
rewritten to a scenario that needs no such path and teaches the same
lesson. Two drills used a lowercase customer. Fresh agents then took the
unverified files for a real fact check against current official sources.

The graphics work landed in the same pass, on Fred's instruction that
every page carry more diagrams. Three of them are generated rather than
drawn: a curriculum rail on module pages, a coverage map with real per
area counts on drill pages, and a track rail on guide pages. The rule
recorded with them (DECISIONS 0009) is that no number inside any graphic
on this site is ever typed by hand.

---

## Chapter 5: What the second pass found
### 2026-08-10, later still

Four fresh agents took the files whose verifiers had died and checked
them against current official sources and, where it was faster, against
the tailscale source tree itself. The pass was not cosmetic. It found:

A fabricated root cause. The Docker drill explained a re-registering
node by saying state landed in the container writable layer and died
with the container. Containerboot actually starts the daemon with
`--state=mem:` when no state directory is configured, so the state was
never on disk at all. The drill had the right symptom and the wrong
mechanism, which is the worst kind of wrong for a teaching page.

A claim attributed to a page that does not contain it. One drill said
the ping-types documentation describes TSMP as skipping the access
control check. It does not; the string does not appear. The behavior is
real, and the filter source states it plainly, so the claim survived
with an honest citation instead of a borrowed one.

Reversed arithmetic. In the birthday paradox section, the 256 sockets
belong to the hard NAT side and the random probing to the easy side.
The drill had them backwards.

A packet filter aimed at the wrong byte. Peer relay traffic carries an
eight byte Geneve header ahead of the WireGuard message, so the type
byte a reader would filter on sits at offset 16, not 8. The same review
compiled every tcpdump filter on the page and found several were IPv4
only, which the generated BPF proves outright.

Invented numbers wearing the clothes of measurements. A profile reading
walked through percentages that had never been measured. They now say
so, and the guide ends with the rule that produced the fix: never ship
a number you did not read off a capture.

Several log lines that no Tailscale binary emits, including one error
string that belongs to headscale.

None of this would have been caught by the gates, which check style and
structure and cannot know whether a sentence is true. It is the argument
for the verification pass existing at all.
