---
slug: overlapping-subnet-routers
title: Two sites advertise 192.168.1.0/24 and clients land on the wrong one
description: Two subnet routers advertise the same default home prefix, so the control plane treats them as a failover pair and clients intermittently reach the wrong site; 4via6 is the designed fix.
area: routing
difficulty: 3
symptom: "Sometimes ssh to 192.168.1.10 gets the office NAS, sometimes it gets a machine at the other site, and ssh screams about changed host keys."
words: 1500
sources:
  - id: kb-subnets
    url: https://tailscale.com/kb/1019/subnets
    title: Subnet routers
    checked: 2026-08-10
  - id: kb-4via6
    url: https://tailscale.com/kb/1201/4via6-subnets
    title: 4via6 subnet routers
    checked: 2026-08-10
  - id: kb-ha
    url: https://tailscale.com/kb/1115/high-availability
    title: Set up high availability
    checked: 2026-08-10
---

## The ticket

The Customer connected two small sites to the tailnet: an office and a warehouse, each behind a consumer router that shipped with the factory default LAN of `192.168.1.0/24`. Each site has a Linux subnet router (`node-a` at the office, `node-b` at the warehouse), both advertising `192.168.1.0/24`, both approved weeks ago. Since then, access to devices at either site has been "haunted": it works, then it reaches the wrong building, then it works again. Urgency is high because someone nearly pushed a config to the wrong device.

> "I ssh to 192.168.1.10 and sometimes it is the office NAS and sometimes it is the camera server at the warehouse. Same IP, different machine, different day. ssh keeps yelling about changed host keys."

## Evidence provided

From the Customer's laptop, `lab-vm-1`:

```
$ ssh admin@192.168.1.10
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!
Host key verification failed.
```

And two probes a few hours apart:

```
$ tailscale ping 192.168.1.10
pong from node-a (100.64.0.11) via 198.51.100.7:41641 in 31ms

$ tailscale ping 192.168.1.10        # later the same day
pong from node-b (100.64.0.12) via DERP(ord) in 88ms
```

Same destination IP, two different routers answering for it. That pair of pong lines is the incident in miniature.

## Hypothesis tree

"Same address, different machine" has a short list of causes, and they are cheap to tell apart. The discriminators: does it reproduce with a raw IP (kills DNS theories), does the client have its own `192.168.1.x` LAN (kills the local-overlap theory), and does the answering router change over time (confirms a route collision).

<div class="diagram-wrap">
<svg viewBox="0 0 820 340" role="img" aria-label="Hypothesis tree for intermittently reaching the wrong site">
  <title>Hypothesis tree: one prefix, two owners</title>
  <rect x="250" y="16" width="320" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="410" y="38" text-anchor="middle" font-size="14" fill="var(--diagram-text)">192.168.1.10 is a different machine</text>
  <text x="410" y="58" text-anchor="middle" font-size="12" fill="var(--diagram-text)">at different times of day</text>
  <line x1="410" y1="72" x2="105" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="310" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="515" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="720" y2="140" stroke="var(--diagram-line)"/>
  <rect x="12" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="105" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">DNS returning</text>
  <text x="105" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">different addresses</text>
  <text x="105" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Reproduces with a raw IP,</text>
  <text x="105" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">so DNS is not involved</text>
  <rect x="217" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="310" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Client's own LAN</text>
  <text x="310" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">overlaps the prefix</text>
  <text x="310" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Client is on LTE (172.20.10.x),</text>
  <text x="310" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">no local 192.168.1.x at all</text>
  <rect x="422" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="515" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Two routers advertise</text>
  <text x="515" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">the identical prefix</text>
  <text x="515" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">tailscale ping names a different</text>
  <text x="515" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">responding router over time</text>
  <rect x="627" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="720" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Stale ARP or NAT</text>
  <text x="720" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">inside one site</text>
  <text x="720" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Host keys alternate between two</text>
  <text x="720" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">stable keys, not random ones</text>
  <text x="410" y="300" text-anchor="middle" font-size="12" fill="var(--diagram-text)">Key question: who owns the prefix right now, and does the owner change?</text>
</svg>
</div>

## Investigation

1. **Reproduce with a raw IP.** The Customer already does; no names involved. DNS branch ruled out immediately.

2. **Check the client's own network.** `lab-vm-1` is tethered to LTE, local network `172.20.10.0/28`, no `192.168.1.x` interface. So the client's kernel is not preferring a directly connected LAN over the tailnet route. Ruled out here, but note it for the postmortem: several employees do have `192.168.1.0/24` at home, and they have a second, different version of this problem waiting.

3. **Ask who owns the prefix right now.** The two `tailscale ping` captures name different responders: `node-a` at 09:40, `node-b` at 14:55. One prefix, two owners across time. That is not a connectivity symptom (the pings succeed; Module 03 path details like `DERP(ord)` versus a direct endpoint are irrelevant noise here). It is a route ownership symptom (Module 07).

4. **Inspect the routes in the admin console.** Machines page, filter `property:subnet` (kb-subnets): both `node-a` and `node-b` advertise `192.168.1.0/24`, both approved. Advertising the same route from two machines is how you build high availability in Tailscale, and in the default failover mode one of them is used at a time by all clients; if it goes offline another one is used (kb-ha). The Customer built an HA pair by accident, with members in different buildings serving different physical networks. Longest prefix match cannot help; the prefixes are not merely overlapping, they are identical.

5. **Correlate the flips with failover events.** The office DSL line renegotiates nightly around 02:00 and drops for about a minute; the admin console shows matching last-seen blips for `node-a`. Each blip fails the prefix over to `node-b`. Selection follows the order in which the routers were added, oldest first, so the older office router is the primary and reclaims the prefix once it is back (kb-ha). The alternation between exactly two stable ssh host keys confirms two real machines, not an attacker, closing the last branch.

> [!FROM-THE-FIELD]
> `192.168.1.0/24` and `192.168.0.0/24` are the factory defaults on most consumer routers, which makes them the two most collision-prone prefixes on earth. Any time a ticket involves a home or small-office site and one of those ranges, check for a twin before checking anything else. The second site is usually already on the tailnet, advertised by someone who followed the same tutorial.

## Root cause

Both sites advertised the identical prefix, and both routes were approved. The control plane (Module 02) does not see two sites; it sees one route with two redundant carriers, the exact configuration the high availability KB describes for subnet router failover (kb-ha). In failover mode, which is the default, one router is used at a time by all clients, so at any instant the entire `192.168.1.0/24` belongs to exactly one site from every client's point of view. Each connectivity blip at the active site moves the whole prefix to the other building. The system behaved precisely as designed; the design was fed two different networks wearing the same name.

This is why the failure is intermittent rather than consistent, and why it is fleet-wide rather than per-client: route ownership is decided centrally, so every client flips at the same moment. Anything that looks like "the network changed its mind for everyone at once" points at the control plane, not at individual tunnels (Module 11).

## Fix and prevention

**Immediate stopgap.** Decide which site legitimately owns plain `192.168.1.0/24` today, and un-approve the other site's route in the admin console so ownership stops moving. Tell the second site's users their raw-IP access is paused; do not let them discover it as an outage.

**The designed fix: 4via6.** Per the 4via6 KB, 4via6 subnet routers assign each overlapping site a unique IPv6 prefix keyed by a site ID (0 to 65535), so both sites stay reachable without touching either LAN. Construct each site's route with the CLI (subnet routers need Tailscale v1.24 or later):

```
$ tailscale debug via 1 192.168.1.0/24
fd7a:115c:a1e0:b1a:0:1:c0a8:100/120

$ tailscale debug via 2 192.168.1.0/24
fd7a:115c:a1e0:b1a:0:2:c0a8:100/120
```

Advertise the site 1 route on `node-a` and the site 2 route on `node-b` (`sudo tailscale set --advertise-routes=fd7a:115c:a1e0:b1a:0:1:c0a8:100/120` and the site 2 equivalent), approve both, then remove the colliding IPv4 advertisements. With MagicDNS enabled, clients address hosts as `192-168-1-10-via-1` (office NAS) and `192-168-1-10-via-2` (warehouse camera server): same physical IPv4 devices, now with unambiguous names (Module 06). One documented limitation: the admin console shows only the IPv6 routes, not the mapped IPv4 addresses, so keep your own site ID table.

> [!HOW-IT-WORKS]
> The 4via6 address packs the site ID and the IPv4 address into a fixed ULA prefix: `fd7a:115c:a1e0:b1a:0:SITE:IPV4:IPV4`. For site 1 and `192.168.1.0`: 192 is c0, 168 is a8, 1 is 01, 0 is 00, so the last 32 bits are `c0a8:0100`, rendered `c0a8:100`. The /120 mask leaves 8 host bits, mirroring the IPv4 /24. The subnet router translates arriving IPv6 back to IPv4 at its site, so the LAN devices never know IPv6 was involved.

**The renumber alternative.** If you control both LANs and the device count is small, renumbering one site to a unique prefix (say `192.168.61.0/24`) dissolves the problem: no via names, no site ID table, plain IPv4 forever after. Between the two: renumber when the LAN is yours to change and DHCP hands out most addresses; use 4via6 when the network belongs to a Customer site, a landlord, or hardware with baked-in static addresses. For this ticket the warehouse gear had hardcoded camera IPs, so 4via6 was the right call.

**Prevention.** Keep a one-page prefix registry and allocate a unique range to every new site before its router is built. Never advertise a factory-default prefix; treat `192.168.1.0/24` in a proposed route the way you would treat a default password.

## The handoff package

**Summary:** Two subnet routers at different physical sites advertise identical `192.168.1.0/24`; control plane treats them as an HA set; route ownership flips on failover events, so clients intermittently reach the wrong site. Configuration issue; behavior matches documentation.
**Repro:** Approve identical routes on two routers serving different LANs; take the active router offline briefly; `tailscale ping` any address in the prefix names the other router afterward.
**Log evidence:** 09:40 UTC, lab-vm-1: pong from node-a (100.64.0.11). 14:55 UTC: pong from node-b (100.64.0.12). Admin console last-seen blips for node-a nightly ~02:00 UTC matching office DSL renegotiation. ssh host keys alternate between two stable fingerprints.
**Version matrix:** node-a v1.84.0 Linux, node-b v1.82.5 Linux, lab-vm-1 v1.84.0 Linux; 4via6 requires router v1.24+.
**Impact scope:** all tailnet access to both sites' LANs, intermittent over ~3 weeks; one near-miss config push to the wrong device.
**Ruled out:** DNS, client local-LAN overlap (for the reporting client), NAT traversal path changes, ARP or NAT staleness, host key attack.
**Proposed owning area:** none in product; candidate docs/UX feedback: warn in the admin console when approving a route already approved on a machine with a different tag or location.

## The trap

The weak investigation fixates on the wrong differences. The two pong lines differ in path (`DERP(ord)` versus a direct endpoint), so hours go into NAT traversal debugging that explains nothing, because both paths deliver packets fine, just to different buildings. Worse, someone "fixes" it by un-approving and re-approving a route, which forces a failover, appears to work, and guarantees a repeat at 02:00. Worst of all, users learn to delete known_hosts entries on reflex, training themselves to ignore the one ssh warning that exists to catch real hijacks. The cost is measured in weeks of ghost tickets and one config pushed to the wrong hardware. The strong move is the cheap question asked twice: who owns this prefix right now, and is the answer stable?
