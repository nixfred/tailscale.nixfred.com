---
module: 7
slug: routing
title: Routing
description: How a tailnet reaches networks and destinations that cannot run Tailscale, through subnet routers, exit nodes, site-to-site links, 4via6, and app connectors.
order: 7
words: 4400
sources:
  - id: kb-subnets
    url: https://tailscale.com/docs/features/subnet-routers
    title: Subnet routers
    checked: 2026-08-10
  - id: kb-exit-nodes
    url: https://tailscale.com/docs/features/exit-nodes
    title: Exit nodes
    checked: 2026-08-10
  - id: kb-site-to-site
    url: https://tailscale.com/docs/features/site-to-site
    title: Site-to-site networking
    checked: 2026-08-10
  - id: kb-4via6
    url: https://tailscale.com/docs/features/subnet-routers/4via6-subnets
    title: 4via6 subnet routers
    checked: 2026-08-10
  - id: kb-app-connectors
    url: https://tailscale.com/docs/features/app-connectors
    title: App connectors
    checked: 2026-08-10
  - id: kb-policy-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-10
  - id: kb-ha
    url: https://tailscale.com/docs/how-to/set-up-high-availability
    title: High availability
    checked: 2026-08-10
  - id: docs-netfilter
    url: https://tailscale.com/docs/reference/netfilter-modes
    title: Tailscale netfilter modes
    checked: 2026-08-10
---

## The promise

1. You will be able to extend a tailnet to devices that cannot run Tailscale, using a subnet router, and explain every step from `--advertise-routes` to a working ping.
2. You will be able to diagnose the advertised vs approved gap on sight, and design `autoApprovers` policy so it never bites you again.
3. You will be able to build high availability subnet routing, and state precisely how primary election and failover work, including the one longest-prefix rule that breaks naive designs.
4. You will be able to run and consume exit nodes, including LAN access during full-tunnel routing, and explain why exit node access is a policy decision, not just a checkbox.
5. You will be able to choose correctly between site-to-site routing, 4via6 for overlapping subnets, and app connectors for SaaS egress pinning, and explain the SNAT and netfilter behavior underneath each on Linux.

## Foundation

You already know how routing works in a conventional network. A router advertises prefixes, neighbors install them in a RIB, longest-prefix match picks the winner, and NAT rewrites source addresses at boundaries. You have probably run VRRP or HSRP for gateway redundancy, and you know that a route in the table is a claim, not a guarantee: the forwarding plane still has to cooperate.

Everything in this module maps onto that mental model, with one structural difference. In a tailnet there is no distributed routing protocol. There is no BGP session between peers, no OSPF flooding, no hello timers. Module 02 introduced the coordination server and the netmap it pushes to every node. Routing in Tailscale is that same mechanism doing double duty: a subnet route is just extra reachability information stamped into netmaps by the control plane, and the control plane is the single arbiter of which advertisements become real. Think of it as a route reflector with veto power. Once a route lands in a peer's netmap, the actual packets ride the same WireGuard tunnels from Module 01, using the same NAT traversal machinery from Module 03. Routing changes who is reachable, never how packets travel.

Also carry in your knowledge of Linux packet forwarding: `net.ipv4.ip_forward`, iptables and nftables, and MSS clamping. Subnet routers are ordinary Linux forwarding boxes wearing a Tailscale interface, and most subnet router failures are ordinary Linux forwarding failures.

## Core content

### Subnet routers: the on-ramp for everything else

A subnet router is a node that runs Tailscale and forwards traffic on behalf of a network segment that does not. Printers, PLCs, ancient license servers, cloud VPC ranges, a NAS that will never see another firmware update: the subnet router is their embassy. Devices behind it never learn about Tailscale at all, and they do not count toward your plan's device limits.

The analogy: a subnet router is an interpreter standing at the door of a building where nobody speaks WireGuard. Tailnet peers talk encrypted tunnel to the interpreter; the interpreter talks plain LAN to the machines inside.

The mechanism, end to end:

1. On the router, you enable IP forwarding (a sysctl on Linux; enabled automatically on macOS when you advertise routes) and run:

```
sudo tailscale set --advertise-routes=192.0.2.0/24,198.51.100.0/24
```

2. The client tells the coordination server "I can reach these prefixes." That is an advertisement, nothing more.
3. An admin approves the routes in the admin console, or an `autoApprovers` rule approves them automatically at advertisement time.
4. The control plane adds the approved prefixes to the netmaps of peers that policy allows to use them. Under the hood this widens the WireGuard allowed IPs for the router's key (Module 01): peers now accept and send packets for 192.0.2.0/24 through that tunnel.
5. Peers install the route. On Windows, macOS, iOS, tvOS, and Android this is automatic. On Linux clients it is not: they must run `tailscale set --accept-routes` or the netmap entry sits there unused.

The failure mode: five links in that chain, and each one fails silently from the perspective of the others. Advertised but not approved. Approved but forwarding disabled. Forwarded but a Linux client never ran `--accept-routes`. Every one of these presents identically to the user: ping times out. Section by section below, we take the two failures that cause the most field pain, then the rest.

> [!HOW-IT-WORKS] A subnet route never exists "in the network." It exists as a line in the netmaps the control plane pushes to each peer, and as a widened allowed-IPs entry on the router's WireGuard key. There is no routing protocol to converge and no advertisement to expire. If the netmap says the route is there, it is there, even if the router is on fire.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Subnet route lifecycle from advertisement through approval to netmap propagation">
  <title>Subnet route lifecycle: advertise, approve, propagate, accept</title>
  <rect x="20" y="110" width="150" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a (router)</text>
  <text x="95" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">advertise-routes</text>
  <rect x="250" y="20" width="180" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="340" y="48" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Control plane</text>
  <text x="340" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="11">advertised list</text>
  <rect x="250" y="200" width="180" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="340" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Approval gate</text>
  <text x="340" y="248" text-anchor="middle" fill="var(--diagram-text)" font-size="11">admin console OR</text>
  <text x="340" y="264" text-anchor="middle" fill="var(--diagram-text)" font-size="11">autoApprovers</text>
  <rect x="560" y="110" width="170" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="645" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="14">peers' netmaps</text>
  <text x="645" y="158" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Linux: accept-routes</text>
  <line x1="170" y1="125" x2="250" y2="70" stroke="var(--diagram-line)"/>
  <text x="195" y="85" fill="var(--diagram-text)" font-size="11">1. advertise</text>
  <line x1="340" y1="90" x2="340" y2="200" stroke="var(--diagram-line)"/>
  <text x="352" y="150" fill="var(--diagram-text)" font-size="11">2. pending</text>
  <line x1="430" y1="230" x2="560" y2="165" stroke="var(--diagram-accent)"/>
  <text x="470" y="185" fill="var(--diagram-text)" font-size="11">3. approved: propagate</text>
</svg>
</div>

### The advertised vs approved gap

This is the classic silent failure of Tailscale routing, so it gets its own section.

The analogy: advertising a route is submitting a form. Approval is someone signing it. The form sits in an inbox with no alarm attached, and the person who submitted it walks away believing the job is done, because the command exited zero.

The mechanism: `tailscale set --advertise-routes` succeeds locally regardless of what the admin console will do with the advertisement. The routes appear on the machine's row in the admin console with an unapproved routes indicator, and nothing else happens. No netmap changes, no error on the router, no error on the clients. The control plane treats an unapproved route as if it were never advertised, because approval is a security boundary: without it, any node could claim 0.0.0.0/8 and siphon traffic.

The failure mode: an engineer brings up a router in a lab, tests from their laptop, everything works because they approved routes that day. Months later they rebuild the router, re-run their setup script, and everything is dead. The script advertises; nobody approves. Diagnosis takes an hour because every component reports healthy. The fix takes ten seconds in the admin console. Check the Machines page first, always.

> [!GOTCHA] Approval is per-machine, keyed to the node, not to the route string. A rebuilt or re-authenticated router is a new approval decision. Your provisioning automation must either include `autoApprovers` coverage or a step that approves routes via the API, or it is provisioning outages.

### autoApprovers: closing the gap in policy

The `autoApprovers` section of the tailnet policy file pre-authorizes advertisements so they are approved the instant the control plane receives them:

```json
"autoApprovers": {
  "routes": {
    "192.0.2.0/24": ["group:netops", "tag:router"],
    "10.0.0.0/8":   ["tag:router"]
  },
  "exitNode": ["tag:exit"]
}
```

The mechanism: when a route advertisement arrives, the control plane checks whether the advertising node's owner (or its tag) is listed for a covering CIDR. A device may advertise a subnet of the listed prefix; `tag:router` approved for 10.0.0.0/8 can advertise 10.44.0.0/16. Three details matter operationally, all current as of the 2026-08-10 check date:

1. Approval happens at advertisement time. Adding an `autoApprovers` rule does not retroactively approve routes already sitting unapproved. Remove the route from the router and advertise it again (or approve manually).
2. Advertisement follows the approver's continued validity. Tailscale stops advertising a route if the user who advertised it is suspended or deleted, or if the device is re-authenticated by a user who cannot advertise it.
3. Tags dodge that fragility. A route advertised and approved via `tag:router` survives account changes, which is why production guidance is: tag your routers, list tags in `autoApprovers`, never individual humans.

The failure mode: listing `alice@example.com` as the approver, then deleting Alice's account. Routes she anchored quietly stop being advertised, and the postmortem reads like a ghost story until someone checks the audit log.

### Route propagation and the Linux accept-routes trap

The analogy: the netmap is a company-wide directory update. Most phones sync it automatically; the Linux phone requires you to press sync yourself, once, and it remembers.

The mechanism: approved routes propagate inside netmap updates over each client's control connection (Module 02). Windows, macOS, iOS, tvOS, and Android clients install newly discovered subnet routes automatically. Linux clients require `tailscale set --accept-routes`, a deliberate default because Linux hosts are disproportionately servers where surprise route table changes are unwelcome, and because a Linux subnet router accepting its own region's routes can create loops (more below under HA).

The failure mode: mixed fleet, subnet route works on every laptop, fails on one Linux box, and the owner of that box is convinced the router is broken. `tailscale status` on the Linux box will happily show the router as a peer. The route is in the netmap; it just was never installed. One flag fixes it.

### Longest-prefix match, and the fallback that does not happen

Tailscale honors longest-prefix match when multiple approved routes overlap: a peer sending to 10.1.2.3 prefers the router advertising 10.1.2.0/24 over the one advertising 10.0.0.0/8.

The gotcha hiding inside that comfort: Tailscale does not fall back to a less-specific route when the router for the more-specific route goes offline. In conventional IP routing, withdrawing the /24 lets the /8 catch the traffic. Here, the /24 stays selected and traffic blackholes until the specific router returns.

The failure mode: you run a broad /8 router as a "backup" for a set of /24 routers and believe you have redundancy. You have a diagram that looks like redundancy. Real HA requires routers advertising identical prefixes, which is the next section. If you want a broad router and specific routers to coexist safely, the guidance is to have the broad routers also advertise the specific prefixes, so failover operates prefix by prefix among identical advertisements.

### High availability: primary and failover subnet routers

The analogy: understudies in a theater. The control plane is the stage manager, only one actor is on stage per role (per prefix) at a time, and the understudy list is ordered by how long each has been in the cast.

The mechanism: run two or more subnet routers advertising the identical prefix, approve all of them. The control plane designates one as primary; selection follows the order the routers were added to the tailnet, oldest first, and failover promotes in that same order. Clients send all traffic for the prefix to the current primary: this is failover, not load balancing, and one router carries the traffic at a time. When the primary goes offline gracefully (`tailscale down`), failover to the next router takes up to roughly 15 seconds; if the primary vanishes ungracefully (network partition, cable pull), detection relies on the control plane noticing lost connectivity, which takes longer. This is active-passive orchestrated by the coordination server, not VRRP: there is no shared virtual IP, no multicast hello, and the LAN behind the routers needs no awareness of the election.

Two operational riders:

- Do not set `--accept-routes` on Linux HA routers that advertise the same routes in the same region. A standby that accepts the shared route will send its own LAN-bound traffic through the primary, adding a pointless hairpin.
- On Premium and Enterprise plans (checked 2026-08-10), regional routing lets you deploy routers grouped by DERP region; clients pick the closest regional group by measured latency to DERP servers, and traffic within a region is spread across that region's routers on a best-effort basis, with stickiness to a chosen router until it becomes unavailable.

The failure mode: HA that was never tested. Two routers, both approved, primary dies, and traffic fails anyway because the standby's IP forwarding sysctl was never set, or its routes were advertised but a rebuild left them unapproved. The control plane will cheerfully promote a router that cannot forward. Failover drills are not optional.

<div class="diagram-wrap">
<svg viewBox="0 0 760 270" role="img" aria-label="High availability failover state flow for two subnet routers advertising the same prefix">
  <title>HA subnet router failover: control plane promotes standby when primary goes offline</title>
  <rect x="30" y="30" width="190" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="125" y="56" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a PRIMARY</text>
  <text x="125" y="76" text-anchor="middle" fill="var(--diagram-text)" font-size="11">192.0.2.0/24 (oldest)</text>
  <rect x="30" y="170" width="190" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="125" y="196" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-b standby</text>
  <text x="125" y="216" text-anchor="middle" fill="var(--diagram-text)" font-size="11">192.0.2.0/24</text>
  <rect x="300" y="100" width="180" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="390" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Control plane</text>
  <text x="390" y="146" text-anchor="middle" fill="var(--diagram-text)" font-size="11">health + election</text>
  <rect x="560" y="100" width="170" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="645" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="13">clients</text>
  <text x="645" y="146" text-anchor="middle" fill="var(--diagram-text)" font-size="11">follow netmap</text>
  <line x1="220" y1="62" x2="300" y2="118" stroke="var(--diagram-line)"/>
  <text x="228" y="80" fill="var(--diagram-text)" font-size="11">offline event</text>
  <line x1="220" y1="202" x2="300" y2="146" stroke="var(--diagram-accent)"/>
  <text x="228" y="192" fill="var(--diagram-text)" font-size="11">promote next-oldest</text>
  <line x1="480" y1="132" x2="560" y2="132" stroke="var(--diagram-accent)"/>
  <text x="520" y="122" text-anchor="middle" fill="var(--diagram-text)" font-size="11">netmap update</text>
  <text x="390" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">graceful down: up to ~15s; partition: longer</text>
</svg>
</div>

### SNAT and netfilter modes on Linux routers

Two Linux-only knobs decide what packets look like on the far side of a subnet router.

SNAT, the analogy: by default the router is a concierge who makes every call on your behalf. The LAN device sees the concierge's number, never yours.

The mechanism: by default Tailscale applies source NAT to forwarded subnet traffic, so a packet from client 100.101.102.103 arrives at the LAN host with the router's LAN address as its source. Return traffic therefore flows naturally; the LAN needs no knowledge of 100.64.0.0/10. Disable it with `tailscale up --snat-subnet-routes=false` (a Linux-only flag) and original tailnet source IPs are preserved, which you want for per-client firewalling, auditing, and site-to-site routing. The price: every device behind the router (or the site's real gateway) now needs a return route for 100.64.0.0/10 pointing back at the router.

The failure mode: someone disables SNAT to get real client IPs in server logs, forgets the return route, and gets the classic one-way traffic signature: tcpdump on the LAN host shows SYNs arriving from 100.x addresses and SYN-ACKs going to the default gateway, which shrugs.

Netfilter modes, the mechanism: tailscaled manages Linux firewall rules to accept traffic on `tailscale0`, drop CGNAT-range spoofing from other interfaces, admit its UDP port, and handle NAT for subnet routing and exit nodes. `--netfilter-mode` has three values. `on` (default): rules are created and activated, with jump rules inserted into the built-in chains (iptables) or chains registered at hooks with high priority (nftables), and tailscaled periodically re-asserts their position if other software shuffles them. `nodivert`: rules are created but not activated; you insert your own jump rules, which is the mode for hosts where a config-managed firewall must own rule ordering. `off`: tailscaled touches nothing, and accept rules plus NAT for subnet routing and exit nodes are entirely your problem.

The failure mode: `off` chosen by an administrator who wanted "no interference," on a box that is also a subnet router. Forwarding works, SNAT silently does not, and the symptom looks exactly like the missing-return-route case above. If you must run `off`, you are signing up to reimplement Tailscale's masquerade and accept rules by hand.

> [!ON-THE-WIRE] SNAT is the difference between the LAN server seeing `100.101.102.103` and seeing `192.0.2.5` as the client. When debugging "works from the router, not from peers," run tcpdump on the LAN interface and look at source addresses first. They tell you instantly whether SNAT is on and whether return routing is even in play.

### Exit nodes: routing everything

A subnet router extends the tailnet to specific prefixes. An exit node is the maximal case: it advertises the default route and carries all of a client's internet traffic, like a traditional full-tunnel VPN concentrator.

The mechanism: on a Linux exit node, `sudo tailscale set --advertise-exit-node` (with IP forwarding enabled, and masquerade allowed if firewalld is in charge); GUI clients offer an equivalent Run Exit Node toggle. Like subnet routes, exit node status requires approval by an Admin or Network admin in the admin console's Machines page, or an `autoApprovers.exitNode` entry. On the client, selection is explicit and per-device:

```
sudo tailscale set --exit-node=100.64.31.7
sudo tailscale set --exit-node=100.64.31.7 --exit-node-allow-lan-access=true
sudo tailscale set --exit-node=
```

The second form preserves direct access to the client's physical LAN (printer, NAS) while everything else tunnels. The third clears the exit node.

Access is also a policy decision: a client needs a grant whose destination includes `autogroup:internet` (Module 05) to use an exit node. Reaching the internet through the exit node and reaching the exit node machine itself are separate permissions; a rule targeting the device only permits connections to it, not through it.

Platform reality check (checked 2026-08-10): Android, macOS, and Windows run exit node forwarding in userspace, with throughput and sleep caveats; a phone acting as an exit node should be on power, and macOS or Windows exit nodes must be prevented from sleeping (on Windows, enable running unattended). For serious traffic, a Linux exit node with kernel forwarding is the tool.

The failure mode: a user selects an exit node and "the office printer disappeared." Full tunnel means the LAN vanished by design; `--exit-node-allow-lan-access` is the fix. The other classic: an exit node advertised but never approved, which fails exactly like the subnet route gap, except users experience it as "the VPN button does nothing."

### Site-to-site: two LANs, no client sprawl

The pattern: a Linux subnet router in each of two networks, each advertising its own LAN and accepting the other's, so devices in both LANs reach each other with neither LAN running Tailscale broadly.

The mechanism, per router:

```
tailscale up --advertise-routes=192.0.2.0/24 --snat-subnet-routes=false --accept-routes
iptables -t mangle -A FORWARD -o tailscale0 -p tcp -m tcp \
  --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

SNAT off preserves real source IPs across the link, which multi-hop forwarding needs; MSS clamping keeps TCP inside the WireGuard tunnel MTU so bulk transfers do not die mysteriously while pings succeed; `--accept-routes` makes each router install the other's prefix. LAN devices then need a route to the remote prefix via their local router, either per-host (`ip route add 198.51.100.0/24 via <router-LAN-IP>`, which does not survive reboot unless made persistent via your network manager or DHCP) or, more sanely, on the site's default gateway; in cloud VPCs, update the provider routing table instead. Constraints: both routers must be Linux, the two sites cannot use identical CIDR ranges (that is what 4via6 or renumbering is for), policy must still permit the inter-subnet traffic, and each site runs one primary router with HA as the redundancy story.

The failure mode is almost always asymmetric routing: site A's devices have a route to site B, site B's gateway never got the return route, and every connection half-opens. tcpdump on both routers shows the request crossing and the reply exiting site B toward its internet gateway instead of the tunnel.

### 4via6: when both sites are 192.168.1.0/24

The analogy: two office buildings where every room number collides. You cannot mail "room 101," but you can mail "building 7, room 101." 4via6 gives every site a building number.

The mechanism: 4via6 wraps an IPv4 subnet inside a deterministic IPv6 prefix that encodes a site ID (0 through 65535). The layout is `fd7a:115c:a1e0:b1a:0:SITE:IPV4-IN-HEX`, and the CLI computes it for you:

```
$ tailscale debug via 7 10.1.1.0/24
fd7a:115c:a1e0:b1a:0:7:a01:100/120
```

Each site's router advertises its own 4via6 prefix instead of the raw IPv4 route, so the two 10.1.1.0/24 sites become distinct, non-overlapping IPv6 routes. Clients address hosts by the mapped IPv6 address, and Tailscale rewrites the IPv6 packet to plain IPv4 at the router, so hosts behind it are untouched and unaware. MagicDNS smooths the addressing: names like `10-1-1-16-via-7` resolve to the mapped address, so humans type the IPv4-with-site-ID name rather than hex (Module 06). Advertising 4via6 routes requires Tailscale v1.24 or later, long since universal; older clients can still consume the routes.

The failure mode: forgetting that the admin console shows the raw IPv6 routes, not the IPv4 networks they encode. An operator auditing routes sees `fd7a:...:a01:100/120`, does not recognize it, and deletes or fails to approve it. Label your routers well, and keep a site ID registry in your infrastructure docs, because site ID collisions between two routers create exactly the ambiguity 4via6 exists to remove.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="4via6 mapping of two overlapping IPv4 sites to distinct IPv6 prefixes">
  <title>4via6: identical 10.1.1.0/24 sites become distinct IPv6 routes via site IDs</title>
  <rect x="20" y="30" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Site A: 10.1.1.0/24</text>
  <text x="120" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="11">router node-a, site ID 7</text>
  <rect x="20" y="190" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="218" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Site B: 10.1.1.0/24</text>
  <text x="120" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="11">router node-b, site ID 9</text>
  <rect x="300" y="30" width="270" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="435" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="12">fd7a:115c:a1e0:b1a:0:7:a01:100/120</text>
  <text x="435" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="11">unique route for Site A</text>
  <rect x="300" y="190" width="270" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="435" y="218" text-anchor="middle" fill="var(--diagram-text)" font-size="12">fd7a:115c:a1e0:b1a:0:9:a01:100/120</text>
  <text x="435" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="11">unique route for Site B</text>
  <rect x="620" y="110" width="120" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="680" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="13">client</text>
  <text x="680" y="158" text-anchor="middle" fill="var(--diagram-text)" font-size="11">10-1-1-16-via-7</text>
  <line x1="220" y1="65" x2="300" y2="65" stroke="var(--diagram-accent)"/>
  <line x1="220" y1="225" x2="300" y2="225" stroke="var(--diagram-accent)"/>
  <text x="260" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="10">map</text>
  <text x="260" y="215" text-anchor="middle" fill="var(--diagram-text)" font-size="10">map</text>
  <line x1="570" y1="65" x2="620" y2="130" stroke="var(--diagram-line)"/>
  <line x1="570" y1="225" x2="620" y2="160" stroke="var(--diagram-line)"/>
</svg>
</div>

### App connectors: pinning SaaS egress by name

The problem app connectors solve: a SaaS vendor lets you allowlist source IPs, but your users roam. You want everyone's traffic to `app.example.com` to leave from one known public IP, without hand-maintaining route lists for a CDN-backed service whose IPs churn daily.

The analogy: a subnet router is a road to an address you know. An app connector is a courier service with a standing subscription to the vendor's change-of-address notices: you name the destination, and it keeps the routes current itself.

The mechanism: you define the app and its domains in the admin console, tag a Linux node (with a public IP and IP forwarding enabled) as the connector, and grant access via tags in the policy file. The connector performs DNS discovery for the configured domains over DNS-over-HTTPS via the peer API, learns the current IP addresses, and dynamically advertises those IPs as routes to the tailnet. Client traffic to those domains then rides through the connector and egresses from its public IP, which you allowlist at the SaaS vendor. High availability and regional routing are supported by running multiple connector devices for a single app connector.

The failure modes, three worth memorizing (checked 2026-08-10): first, any unrelated domain that happens to resolve to a shared IP (CDN colocation) also gets routed through the connector, which surprises people during traceroute archaeology. Second, if the connector is down and no redundant connector exists, the domains it fronts become unreachable for tailnet clients; this is a routed dependency, not a suggestion. Third, if you manage policy via Terraform or GitOps, admin console edits to app connector config get overwritten on the next apply; pick one source of truth. And the standing caveat: unless the vendor-side IP allowlist is actually configured, a user who disconnects from Tailscale can still reach the app directly, so the "pinning" is only as real as the allowlist.

> [!FROM-THE-FIELD] Teams reach for app connectors and then forget Linux clients still need `--accept-routes` to install the dynamically advertised routes. The connector logs show routes being learned, the admin console shows them advertised, and the one Linux workstation in the pilot group keeps egressing from its coffee-shop IP. Same trap as static subnet routes, new costume.

## On the wire

What routing looks like from the operator's chair.

Advertising without forwarding enabled warns immediately; do not scroll past it:

```
$ sudo tailscale set --advertise-routes=192.0.2.0/24
Warning: IP forwarding is disabled, subnet routing/exit nodes will not work.
See https://tailscale.com/s/ip-forwarding
```

The fix on Linux:

```
$ echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
$ echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
$ sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

A client that has selected an exit node shows it in status, and status also flags peers offering exit:

```
$ tailscale status
100.101.102.103  node-a       user@   linux   -
100.104.105.106  cloud-1      user@   linux   active; exit node; direct 203.0.113.9:41641
100.108.109.110  lab-vm-1     user@   linux   offers exit node
```

On a Linux client with `--accept-routes`, subnet routes appear in the Tailscale-owned routing table (table 52), which is where to look when "the route is approved but the box cannot ping":

```
$ ip route show table 52
100.104.105.106 dev tailscale0
192.0.2.0/24 dev tailscale0
198.51.100.0/24 dev tailscale0
```

On the router itself, SNAT-on vs SNAT-off is a one-line tcpdump difference on the LAN interface. SNAT on:

```
$ sudo tcpdump -ni eth0 host 192.0.2.50
IP 192.0.2.1.55321 > 192.0.2.50.443: Flags [S], seq 1839203112, win 64240
```

SNAT off, original tailnet source preserved:

```
IP 100.101.102.103.55321 > 192.0.2.50.443: Flags [S], seq 1839203112, win 64240
```

If you see the second form and no reply comes back, the LAN side has no return route for 100.64.0.0/10. And the 4via6 helper, showing its arithmetic (10.1.1.0 is 0a01:0100 in hex):

```
$ tailscale debug via 7 10.1.1.0/24
fd7a:115c:a1e0:b1a:0:7:a01:100/120
```

## Failure modes

1. Advertised but never approved. Symptom: router healthy, clients healthy, zero connectivity to the subnet; admin console shows the machine with unapproved routes. The single most common routing failure.
2. autoApprovers added after the fact. Symptom: policy file looks correct, routes still unapproved, because approval only happens at advertisement time. Remove and re-advertise the route to trigger it.
3. Approval anchored to a departed human. Symptom: routes that worked for months stop being advertised when the anchoring user is suspended or deleted, or when the device is re-authenticated by a user who cannot advertise them. Use tags in `autoApprovers`.
4. IP forwarding disabled on the router. Symptom: peers reach the router's own tailnet IP fine, nothing behind it; the `tailscale set` warning was ignored.
5. Linux client missing `--accept-routes`. Symptom: subnet works from every platform except one Linux machine; route absent from table 52.
6. SNAT disabled without return routes. Symptom: half-open TCP; tcpdump on the LAN host shows 100.x sources inbound and replies leaving via the default gateway.
7. More-specific route's router offline, broad route "backup" not taking over. Symptom: blackhole for the /24 while the /8 router sits healthy, because Tailscale never falls back to a less-specific prefix.
8. HA standby that cannot actually forward. Symptom: failover "succeeds" in the control plane, traffic still dead; standby was missing sysctl, approval, or firewall rules and was never drilled.
9. Exit node full tunnel hides the LAN. Symptom: user selects exit node, local printers and NAS vanish; `--exit-node-allow-lan-access=true` restores them.
10. Netfilter mode off on a router. Symptom: forwarding works but masquerade and accept rules are absent; behaves like failure 6 even with SNAT nominally default.
11. App connector down or overwritten. Symptom: one SaaS domain unreachable tailnet-wide while the internet is fine; or connector config reverts after every Terraform apply because two sources of truth are fighting.
12. MTU blindness on site-to-site. Symptom: ping and small requests cross the link, bulk transfers stall; MSS clamping missing on the routers.

## Check yourself

1. A colleague runs `sudo tailscale set --advertise-routes=10.20.0.0/16` on a fresh Linux VM, sees no errors, and reports that no laptop can reach the 10.20 network. `tailscale status` on the laptops shows the router online. Name the three most likely causes in the order you would check them.

Answer: check the admin console first: the advertised vs approved gap. The command succeeds locally whether or not anyone approves, so a pending approval is both the most likely cause and the fastest to check. Second, IP forwarding on the router: a fresh VM has `net.ipv4.ip_forward=0`, and although `tailscale set` prints a warning, it is routinely missed; peers can reach the router itself while everything behind it is dark. Third, for any Linux laptops specifically, `--accept-routes`: non-Linux clients install approved routes automatically, Linux does not, so a symptom pattern of "works on macOS, fails on Linux" localizes the fault to the client. All three failures are silent at packet level, which is why the diagnostic order is console, router sysctl, client flag: cheapest check first, and each maps to a different link in the advertise, approve, propagate, accept chain.

2. You run one subnet router advertising 10.0.0.0/8 in a data center and per-site routers advertising 10.1.0.0/16, 10.2.0.0/16, and so on. The 10.2 router dies. What happens to traffic for 10.2.0.0/16, and what should the design have been?

Answer: traffic for 10.2.0.0/16 blackholes. Longest-prefix match selected the /16 router while it was alive, and Tailscale does not fall back to a less-specific route when the more-specific route's router goes offline, so the healthy /8 router never receives the traffic. The correct design uses identical prefixes for redundancy: give each site two or more routers advertising the same /16, so the control plane's HA machinery (oldest-first primary, automatic promotion, roughly 15 seconds on graceful shutdown and longer on partition) applies. If the broad /8 router must participate in redundancy, have it also advertise each specific /16, so that for every prefix there are multiple identical advertisements to fail over among. And drill the failover: the control plane will promote a standby that cannot forward, so an untested standby is a diagram, not a design.

3. A SaaS vendor allows source-IP allowlisting. You deploy an app connector on cloud-1 with a static public IP, add the vendor domain, and allowlist cloud-1's IP at the vendor. A month later, users report a completely unrelated website is slow and traceroutes show it passing through cloud-1. Meanwhile one contractor can still log into the SaaS app with Tailscale off. Explain both observations.

Answer: the first observation is IP-level route capture. The app connector resolves its configured domains and advertises the resulting IP addresses as routes; it operates on IPs, not hostnames, at forwarding time. If the unrelated site shares infrastructure (a CDN edge, shared hosting) with the vendor's domains, its IPs coincide with learned routes and its traffic rides through cloud-1 too, adding latency. This is expected behavior, documented as a limitation, and the mitigation is narrower domain configuration or accepting the shared-path cost. The second observation is the standing caveat of egress pinning: the connector pins the path for connected tailnet clients, but it does not gate the application. If the contractor's SaaS session works with Tailscale off, the vendor-side allowlist is not actually enforced (not enabled, or the contractor's IP is separately allowed). The connector plus a genuinely enforced vendor allowlist together form the control; either half alone is theater.

## What you now have

1. The full subnet route lifecycle: advertise, approve (manually or via `autoApprovers`), propagate through netmaps, accept on Linux, forward through the kernel.
2. A reflex for the advertised vs approved gap, and tag-based `autoApprovers` design that makes provisioning idempotent and immune to account churn.
3. The longest-prefix rule and its sharp edge: no fallback to broader routes, so real HA means identical prefixes, oldest-first election, and tested standbys.
4. Working command of SNAT and netfilter modes on Linux routers, and the tcpdump signatures that distinguish their failure modes.
5. The decision map for extension patterns: exit nodes for full-tunnel egress, site-to-site for LAN bridging, 4via6 for colliding CIDRs, app connectors for domain-tracked SaaS egress pinning.

## Cross references

- Module 01 WireGuard foundations: subnet routes are implemented as widened allowed-IPs on the router's key; the tunnel semantics there explain why routing changes reachability but not transport.
- Module 02 The control plane: netmaps are the delivery vehicle for every route in this module, and the coordination server is the approval gate and HA elector.
- Module 03 NAT traversal, STUN, DERP, and Peer Relays: routed traffic rides whatever path the router and peer negotiated; a subnet router stuck on DERP relays makes an entire site slow, and regional HA routing is keyed to DERP locations.
- Module 05 Policy: ACLs and grants: route approval controls what exists; policy controls who may use it, including `autogroup:internet` grants for exit nodes and tag-based access to app connectors.
- Module 06 MagicDNS and split DNS: 4via6's generated names and split DNS for routed subnets make the addressing in this module humane.
- Module 08 Exposing services: when you need to publish one service rather than a network, the patterns there are often the better tool than a subnet route.
- Module 10 Enterprise operations: regional routing, plan gating of HA features, and policy-as-code workflows that interact with app connector configuration.
- Module 11 Troubleshooting and observability: the diagnostic habits used here (status output, table 52, tcpdump at each hop) are developed into a full methodology.
