---
module: 3
slug: nat-traversal
title: NAT traversal, STUN, DERP, and Peer Relays
description: How two Tailscale nodes behind NATs find each other, punch through, relay when they cannot, and upgrade the moment they can.
order: 3
words: 4650
sources:
  - id: nat-blog
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
  - id: derp-kb
    url: https://tailscale.com/kb/1232/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: cli-kb
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: conn-types
    url: https://tailscale.com/docs/reference/connection-types
    title: Connection types
    checked: 2026-08-10
  - id: peer-relay-docs
    url: https://tailscale.com/docs/features/peer-relay
    title: Tailscale Peer Relays
    checked: 2026-08-10
  - id: peer-relay-ga
    url: https://tailscale.com/blog/peer-relays-ga
    title: "Tailscale Peer Relays: Use your own devices as high-throughput relays"
    checked: 2026-08-10
---

## The promise

1. You will be able to classify any NAT you meet as endpoint-independent (easy) or endpoint-dependent (hard) and predict from that alone whether two nodes will get a direct path.
2. You will be able to narrate UDP hole punching step by step, including why both sides must transmit at roughly the same time and what keeps the hole open afterward.
3. You will be able to explain the birthday paradox trick that punches through hard NATs, with the actual probe counts and probabilities behind it.
4. You will be able to read every line of a `tailscale netcheck` report and say what it implies about the paths this node can form.
5. You will be able to explain what DERP relays actually do, why Tailscale cannot read the traffic they carry, and how a node picks its home DERP region.
6. You will be able to decide, for a given workload, whether Peer Relays (GA since February 2026) or DERP is the right relay layer, and configure the former.

## Foundation

You already know most of the raw ingredients. A NAT device rewrites the source address and port of outbound packets and keeps a translation table so replies find their way back. A stateful firewall tracks flows and admits inbound packets only when they match state created by an earlier outbound packet. UDP has no handshake, so "a flow" for UDP is just a heuristic: same 5-tuple seen recently. You know that most home users sit behind one NAT, that many mobile and ISP networks add carrier-grade NAT on top (a second translation you cannot configure), and that port forwarding is the classic manual escape hatch.

What this module adds is the machinery Tailscale layers on those ingredients. Module 01 established that the data plane is WireGuard: each packet is already encrypted end to end to a specific peer public key before any of this machinery touches it. Module 02 established that the coordination server distributes public keys and endpoint lists but never carries your traffic. This module answers the question those two left hanging: given two WireGuard peers who know each other's keys, both behind NAT, neither with a port forwarded, how does an encrypted UDP packet from one ever land on the other?

The honest answer: through an aggressive, parallel, latency-scored search for a working path, with a relay standing by so the connection works from the first packet even while the search runs. Everything below is the anatomy of that search.

## Core content

### The problem: two firewalls facing each other

Start with the pure firewall case, no address translation at all. The stateful UDP rule is simple: the firewall allows an inbound UDP packet if it previously saw a matching outbound packet. That works beautifully for client-to-server traffic, because the client always goes first.

Now put a stateful firewall in front of both peers. Each firewall will only admit packets from the other side after its own side has transmitted. Both sides must go first. Neither can go first. That is the entire NAT traversal problem in one sentence, and it exists even before NAT enters the picture.

The escape is timing: if both peers transmit toward each other at roughly the same time, each firewall sees its own side's outbound packet first and creates state. The packets in flight may cross in the middle; the first one to arrive at a firewall that has not yet seen outbound traffic gets dropped, and that is fine. Within a round trip or two, both firewalls hold state, and traffic flows both ways.

> [!HOW-IT-WORKS] Hole punching is not an exploit and does not bypass the firewall's policy. Each firewall is enforcing exactly its configured rule: outbound-initiated UDP flows are allowed. Traversal works by arranging for both sides to initiate, simultaneously, toward endpoint addresses they learned out of band.

Analogy: two people in soundproof rooms, each with a door that only opens from the inside, and each door snaps shut after 30 seconds of silence. Neither can knock. But if both agree (via a note passed by a third party) to open their doors at noon and start talking, the conversation works. The note-passing third party is the coordination server plus DERP. The 30 seconds is real: firewall state for UDP commonly expires after about 30 seconds idle, which is why Tailscale keeps active paths warm with periodic traffic and must re-punch if state lapses.

Failure mode: one side transmits, the other does not (or transmits late). The early packets die against fresh firewalls, state on the eager side expires, and no path forms. This is why traversal needs a live signaling channel, not a one-time exchange of addresses.

### NAT mapping behavior: endpoint-independent versus endpoint-dependent

Add NAT and a new question appears: when your node sends from private `192.168.0.20:41641`, what public `ip:port` does the world see, and does that answer stay stable?

**Endpoint-independent mapping (EIM)**: the NAT assigns one public mapping per private source, and reuses it for every destination. Talk to a STUN server, then to a peer: same public `ip:port` both times. Tailscale's blog calls these easy NATs. The mapping you discover through a third party is valid for everyone.

**Endpoint-dependent mapping (EDM)**: the NAT assigns a different public mapping per destination. The `ip:port` a STUN server reports is the mapping for talking to that STUN server, and only that. Your peer will see some other, unpredictable port. These are hard NATs, the classical "symmetric NAT."

Analogy: an easy NAT is a receptionist who gives you one extension number and forwards any caller who dials it. A hard NAT is a receptionist who invents a new extension for every company that calls you, and tells nobody the numbering scheme.

Mechanism: the old cone taxonomy (full cone, restricted cone, port-restricted cone, symmetric) collapses into this cleaner split. The first three are all EIM with progressively pickier firewall filtering; filtering pickiness barely matters, because hole punching generates outbound packets to the exact peer `ip:port` anyway, which satisfies even the strictest filter. Symmetric is EDM, and EDM is the one property that actually breaks address discovery.

Failure mode: EDM on one side means the easy side does not know what `ip:port` to send to on the hard side. EDM on both sides is the worst case and gets its own section below. In `netcheck` output this property has a name you will learn to scan for first: `MappingVariesByDestIP`.

### STUN: learning your own reflection

A node behind NAT cannot see its own public endpoint; the rewrite happens upstream. STUN (Session Traversal Utilities for NAT) fixes that with almost embarrassing simplicity. Your machine sends a UDP request to a STUN server that amounts to "what endpoint do you see me as?" and the server replies "your packet arrived from `203.0.113.77:41641`." That reflexive address is the mapping the NAT created for this conversation. The full STUN RFC includes authentication and obfuscation machinery, but for address discovery you can ignore all of it; the echo is the product.

Tailscale nodes run STUN queries against Tailscale-operated STUN servers, harvest their reflexive endpoints, and publish them, along with LAN addresses, IPv6 addresses, and any port-mapping-derived endpoints, to the coordination server as their candidate endpoint list.

By comparing STUN answers across multiple servers, the client also learns which kind of NAT it lives behind. Same reflexive port from every vantage point: EIM, and the advertised endpoint is trustworthy. Different port per vantage point: EDM, and the advertised endpoint is only a hint.

> [!GOTCHA] A STUN answer is a snapshot with a shelf life. The mapping it reports exists only while the NAT retains state for that flow, commonly around 30 seconds of idle time. Candidate endpoints must be refreshed continuously; an endpoint list from five minutes ago may describe mappings that no longer exist.

Failure mode: UDP blocked outright (some corporate and hotel networks) means STUN gets no answer at all, no reflexive candidates exist, and no direct path is possible, period. Everything rides the relay. `netcheck` makes this diagnosis in one line: `UDP: false`.

### The punch, assembled

Now compose the pieces into what actually happens when `node-a` first sends traffic toward `node-b`:

1. Both nodes have long since STUN-discovered their candidate endpoints and published them via the coordination server (Module 02's job).
2. Traffic starts flowing immediately over DERP, so the user experiences a working connection with zero setup delay.
3. Both nodes, coordinating over DERP as a signaling side channel, begin firing UDP probes at every candidate endpoint of the other: LAN addresses (in case they share a network), IPv6, STUN-derived WAN addresses, port-mapping-derived addresses. This is the "try everything at once and pick the best thing that works" strategy Tailscale borrowed in spirit from ICE.
4. The probes themselves are the hole punchers. Each outbound probe creates NAT and firewall state; because both sides probe simultaneously, holes open in both directions.
5. Probes that complete a round trip mark a working path. Since v0.100.0, Tailscale scores working paths by measured round-trip latency rather than a hardcoded category preference, which naturally lands on LAN over WAN over WAN-plus-NAT ordering without hardcoding it.
6. The connection transparently upgrades to the best working path, usually within a few seconds. Keepalive traffic maintains the NAT state on the chosen path from then on.

<div class="diagram-wrap">
<svg viewBox="0 0 760 400" role="img" aria-label="Sequence of NAT traversal between two nodes: STUN discovery, endpoint exchange over DERP, simultaneous UDP probes, direct path established">
  <title>UDP hole punching sequence between node-a and node-b</title>
  <rect x="20" y="40" width="130" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="85" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="15">node-a</text>
  <rect x="180" y="40" width="90" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="225" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="15">NAT A</text>
  <rect x="490" y="40" width="90" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="535" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="15">NAT B</text>
  <rect x="610" y="40" width="130" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="675" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="15">node-b</text>
  <rect x="315" y="120" width="130" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="15">DERP + STUN</text>
  <line x1="225" y1="86" x2="345" y2="130" stroke="var(--diagram-line)" stroke-dasharray="5 4"/>
  <line x1="535" y1="86" x2="415" y2="130" stroke="var(--diagram-line)" stroke-dasharray="5 4"/>
  <text x="230" y="118" fill="var(--diagram-text)" font-size="13">1. STUN: my ip:port?</text>
  <text x="452" y="118" fill="var(--diagram-text)" font-size="13">1. STUN</text>
  <line x1="85" y1="86" x2="345" y2="155" stroke="var(--diagram-accent)" stroke-dasharray="2 4"/>
  <line x1="675" y1="86" x2="415" y2="155" stroke="var(--diagram-accent)" stroke-dasharray="2 4"/>
  <text x="380" y="190" text-anchor="middle" fill="var(--diagram-text)" font-size="13">2. traffic + endpoint exchange via relay</text>
  <line x1="85" y1="240" x2="368" y2="240" stroke="var(--diagram-accent)"/>
  <polygon points="368,240 356,234 356,246" fill="var(--diagram-accent)"/>
  <line x1="675" y1="240" x2="392" y2="240" stroke="var(--diagram-accent)"/>
  <polygon points="392,240 404,234 404,246" fill="var(--diagram-accent)"/>
  <text x="380" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="13">3. simultaneous UDP probes open both NATs</text>
  <line x1="85" y1="300" x2="668" y2="300" stroke="var(--diagram-accent)"/>
  <polygon points="668,300 656,294 656,306" fill="var(--diagram-accent)"/>
  <polygon points="92,300 104,294 104,306" fill="var(--diagram-accent)"/>
  <text x="380" y="290" text-anchor="middle" fill="var(--diagram-text)" font-size="13">4. direct WireGuard path, latency-scored</text>
  <text x="380" y="330" text-anchor="middle" fill="var(--diagram-text)" font-size="13">5. keepalives hold NAT state open; DERP stays as fallback</text>
</svg>
</div>

### Hard NATs and the birthday paradox

When one side is behind an EDM NAT, its advertised STUN endpoint is wrong for the peer: the NAT will mint a fresh, unpredictable port for the new destination. Brute force is technically possible: the easy side could spray probes across all 65,535 ports of the hard side's public IP. At 100 packets per second, worst case is about 10 minutes. Nobody waits 10 minutes for a connection.

The trick that makes this tractable is the same statistics that says 23 people in a room have a 50 percent chance of a shared birthday: collisions between two random sets come much faster than a linear scan. The hard-NAT side opens 256 UDP sockets, all probing toward the easy side's known endpoint. Its NAT mints 256 distinct public port mappings. The easy side, instead of scanning sequentially, probes random ports on the hard side's public IP. Each probe is a lottery ticket against 256 winning numbers out of 65,535.

The numbers, from Tailscale's own analysis: 174 random probes gets you a 50 percent chance of a hit, 256 probes about 64 percent, 1024 about 98 percent, and 2048 about 99.9 percent. At 100 packets per second, that is even odds in under 2 seconds and near certainty in about 20, while touching roughly 4 percent of the port space. One collision is all it takes: the moment any probe lands in an open mapping, a round trip completes, and both sides converge on that pair.

Failure mode one: hard NAT on both sides. Now neither side knows the other's ports, the search space becomes source and destination port pairs, and the same math turns ugly: about 170,000 probes per side for 99.9 percent confidence, roughly 28 minutes at 100 packets per second. Tailscale treats that as impractical and relays instead.

Failure mode two: collateral damage. Every probe consumes a NAT session table entry. Tailscale's blog notes a Juniper SRX 300 maxes out at 64,000 active sessions; aggressive probing from many hosts behind one such box can exhaust the table and break traffic for everyone behind it. This is one reason the probing is bounded and why "just probe harder" is not the answer to hard NATs. Peer Relays, below, are the modern answer.

> [!FROM-THE-FIELD] The single highest-value fact to learn about a troublesome site is whether its NAT is EDM. One hard NAT in a pair is usually survivable via the birthday trick. Two is a relay sentence. When a Customer site and a cloud VPC both show `MappingVariesByDestIP: true`, stop debugging hole punching and start planning a relay or a port-mapping fix; that pair was never going to go direct.

### DERP: the relay the whole design leans on

DERP (Designated Encrypted Relay for Packets) is Tailscale's relay fleet, and it plays two roles at once: the fallback of last resort for packets, and the always-available side channel that makes direct connections possible in the first place. Tailscale deliberately did not use TURN, the standards-track relay protocol: TURN is unpleasant to implement and, unlike STUN, offers no interoperability payoff since there is no ecosystem of open TURN servers to benefit from.

The mechanism: every node maintains a connection to DERP. A DERP server relays payloads addressed by WireGuard public key: send it a blob tagged "for key X," and it forwards the blob down whatever connection the node holding key X has open. DERP runs over HTTP-shaped, TLS-encrypted TCP, which is exactly the traffic shape that strict egress-filtered networks still allow, so DERP works from networks where UDP is dead on arrival.

The security property matters and is worth stating precisely: the payloads DERP relays are already-encrypted WireGuard packets. Tailscale private keys never leave the device that generated them, so a DERP server is physically incapable of decrypting what it forwards. It blindly shovels ciphertext between key holders. A compromised DERP server could drop or delay your traffic and observe metadata (who talks to whom, when, how much), but never content. Contrast with Module 02's trust analysis of the coordination server: DERP is even less trusted, and needs to be, because it touches every byte of relayed traffic.

Analogy: DERP is a mail forwarding service handling sealed, tamper-evident envelopes written in a cipher only sender and recipient hold. It reads the name on the envelope (the destination public key) and nothing else.

Coverage: as of the checked date, Tailscale operates DERP servers in more than 20 geographic regions worldwide, including ten US cities (Ashburn, Chicago, Dallas, Denver, Honolulu, Los Angeles, Miami, New York City, San Francisco, Seattle) plus regions across Europe, Asia-Pacific, South America, Africa, and the Middle East. The practical consequence: any two nodes that can each reach a DERP server can exchange traffic, even when no direct path between them is possible at all.

Failure mode: DERP down or unreachable (rare, but captive portals and TLS-intercepting middleboxes can do it) removes both the fallback path and the signaling channel. Nodes that already hold a warm direct path keep talking; new path negotiation stalls. `netcheck` showing blank DERP latency lines is the tell.

### Home DERP and the relayed path

Each client fetches a DERP map from the coordination server, measures latency to the regions, picks the lowest-latency region as its home DERP, and reports the choice back to the coordination server, which shares it with the rest of the tailnet. Your home DERP is where peers address relayed traffic for you; it is your stable rendezvous point on the public internet.

Two nodes with different home regions still work: a relayed packet enters the sender's DERP path and is delivered via the receiver's home region connection. But this is why a relayed connection between two nodes in the same city can take an absurd detour: each node anchored to its own home region, chosen by its own latency measurements at its own location. A laptop that picked its home DERP on hotel Wi-Fi in Frankfurt will re-evaluate, but until it does, its relayed traffic hairpins through Europe.

### The upgrade dance, and path migration

Restating the lifecycle as policy, because this ordering is the thing to memorize. Per Tailscale's connection-types reference (checked 2026-08-10): every connection starts relayed through DERP; Tailscale then tries to upgrade to a direct connection; if direct fails, it tries a peer relay; DERP remains the floor. Preference order once paths are known: direct, then peer relay, then DERP. Re-checks run periodically, so a connection stuck on a relay keeps retrying for something better.

Starting on DERP is a product decision disguised as a protocol decision. The first packet flows immediately through a path that always works, while discovery runs in parallel; a few seconds later the path silently improves. Users never see the machinery, which is precisely why this module exists.

Path migration is the same machinery pointed at change. Roam from Wi-Fi to a phone hotspot and every candidate endpoint your node advertised becomes stale: new local addresses, new NAT, new reflexive endpoints. The node re-runs discovery, republishes candidates, and re-probes. If the direct path dies, traffic falls back to a relay (DERP or peer relay) rather than dropping the connection, then upgrades again when a new direct path lands. WireGuard's cryptographic sessions are keyed to peers, not to IP addresses (Module 01), so the tunnel itself never notices its outer packets changed address; applications see, at worst, a brief latency bump.

> [!ON-THE-WIRE] You can watch an upgrade happen with `tailscale ping node-b`: the first pong or two typically report `via DERP(region)`, then a pong reports `via ip:port` and the latency drops. The `--until-direct` flag, which defaults to true, stops the ping loop once a direct path is established, which makes it a fine scripted traversal test.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="State flow of Tailscale path selection: start on DERP, upgrade to direct, fall back through peer relay to DERP on failure">
  <title>Path selection and fallback order</title>
  <rect x="30" y="110" width="170" height="60" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="115" y="136" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Start: DERP</text>
  <text x="115" y="156" text-anchor="middle" fill="var(--diagram-text)" font-size="12">works immediately</text>
  <rect x="295" y="30" width="170" height="60" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="56" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Direct UDP</text>
  <text x="380" y="76" text-anchor="middle" fill="var(--diagram-text)" font-size="12">best: lowest RTT</text>
  <rect x="295" y="190" width="170" height="60" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="216" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Peer relay</text>
  <text x="380" y="236" text-anchor="middle" fill="var(--diagram-text)" font-size="12">your node, UDP</text>
  <rect x="560" y="110" width="170" height="60" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="645" y="136" text-anchor="middle" fill="var(--diagram-text)" font-size="15">DERP floor</text>
  <text x="645" y="156" text-anchor="middle" fill="var(--diagram-text)" font-size="12">always available</text>
  <line x1="200" y1="122" x2="288" y2="72" stroke="var(--diagram-accent)"/>
  <polygon points="288,72 276,72 282,83" fill="var(--diagram-accent)"/>
  <text x="222" y="80" fill="var(--diagram-text)" font-size="12">probes succeed</text>
  <line x1="200" y1="158" x2="288" y2="208" stroke="var(--diagram-line)"/>
  <polygon points="288,208 276,208 282,197" fill="var(--diagram-line)"/>
  <text x="204" y="196" fill="var(--diagram-text)" font-size="12">direct fails</text>
  <line x1="465" y1="72" x2="560" y2="122" stroke="var(--diagram-line)" stroke-dasharray="5 4"/>
  <polygon points="560,122 548,114 546,126" fill="var(--diagram-line)"/>
  <text x="478" y="88" fill="var(--diagram-text)" font-size="12">path lost</text>
  <line x1="465" y1="208" x2="560" y2="158" stroke="var(--diagram-line)" stroke-dasharray="5 4"/>
  <polygon points="560,158 546,156 550,166" fill="var(--diagram-line)"/>
  <text x="478" y="204" fill="var(--diagram-text)" font-size="12">relay lost</text>
  <line x1="645" y1="110" x2="472" y2="56" stroke="var(--diagram-accent)" stroke-dasharray="2 4"/>
  <polygon points="472,56 482,52 484,63" fill="var(--diagram-accent)"/>
  <text x="558" y="66" fill="var(--diagram-text)" font-size="12">periodic re-check, upgrade</text>
</svg>
</div>

### Peer Relays: bring your own middle

For years the relay story ended at DERP, and DERP has structural limits: it is shared infrastructure, tuned for availability rather than throughput, and it sits wherever Tailscale put it rather than where your traffic lives. Peer Relays, generally available since February 18, 2026 (checked 2026-08-10), close that gap: any capable node in your tailnet can serve as a high-throughput UDP relay for other nodes in the same tailnet.

Mechanism: a peer relay is an ordinary Tailscale node told to listen on a UDP port for relay duty. It forwards WireGuard-encrypted packets between peers exactly as DERP does, with the same security consequence: the relay carries ciphertext it cannot decrypt. The differences are placement and transport. A peer relay sits inside your infrastructure (same VPC, same rack, same campus), speaks UDP rather than DERP's HTTP-shaped TCP, and has only your workloads to serve, so per Tailscale's connection-types reference it is usually faster than DERP, and it keeps relayed bulk traffic on network paths you control, which matters where cloud egress is billed.

Requirements and configuration, current as of the checked date: relay servers need Tailscale v1.86 or later and can run on any supported OS except iOS, Apple TV, or Android; clients using them also need v1.86 or later. Enable with:

```
tailscale set --relay-server-port=40000
```

The chosen UDP port must be reachable by the peers that will use the relay. Behind port forwarding or a load balancer, advertise explicit endpoints with `--relay-server-static-endpoints`. Setting the port to an empty string disables the relay.

Authorization is not implicit. Clients may use a peer relay only if a grant in the tailnet policy gives them the `tailscale.com/cap/relay` application capability with that relay as the destination:

```json
{
  "grants": [{
    "src": ["tag:us-east-vpc"],
    "dst": ["tag:us-east-relays"],
    "app": { "tailscale.com/cap/relay": [] }
  }]
}
```

Without the grant, a device cannot use that node as its relay. Selection then slots into the path order you already know: direct first, then an authorized, reachable peer relay, then DERP.

When to use which: peer relays earn their keep when relayed traffic is heavy and locality matters: bulk transfers between NAT-bound VPCs, high-bitrate media, sites with hard NAT on both ends where direct paths are statistically doomed. DERP remains the right floor everywhere else, and it keeps its irreplaceable jobs regardless: connection negotiation, the signaling side channel, reachability from UDP-hostile networks, and fallback when your relay host is down. Tailscale's docs are explicit that peer relays complement rather than replace the DERP fleet, but for the self-hosted relay use case they now steer toward peer relays instead of running a custom DERP server, citing lower latency and better performance with less to maintain.

> [!GOTCHA] Scope your relay grants narrowly. A `src` of `*` invites every node to relay through one box, adding latency for pairs that had no business relaying at all, and turning your relay into a chokepoint. Grant relay capability to the tags that genuinely face hard NAT, and do not advertise roaming laptops as relay servers; a relay that changes networks strands its clients mid-flow.

## On the wire

The whole subsystem is unusually observable. Three commands cover it.

**`tailscale netcheck`** probes the network and prints a report of current conditions:

```
$ tailscale netcheck

Report:
    * UDP: true
    * IPv4: yes, 203.0.113.77:41641
    * IPv6: no, but OS has support
    * MappingVariesByDestIP: false
    * PortMapping: UPnP
    * CaptivePortal: false
    * Nearest DERP: New York City
    * DERP latency:
        - nyc: 18.2ms  (New York City)
        - ord: 29.7ms  (Chicago)
        - mia: 33.1ms  (Miami)
        - dfw: 41.9ms  (Dallas)
```

Read it line by line. `UDP: true` means UDP egress works at all; `false` here means no STUN, no hole punching, no direct paths, everything over DERP's TCP transport. `IPv4` shows your STUN-discovered reflexive endpoint: the public face of this node. `IPv6` reports whether you have a second address family to attempt direct paths over. `MappingVariesByDestIP` is the EDM detector: `false` means easy NAT, `true` means hard NAT and the birthday machinery will be needed. `PortMapping` lists which of UPnP, NAT-PMP, or PCP the local router offers; any of them lets Tailscale request a real forwarded port and skip punching entirely. `Nearest DERP` is the home region candidate, and the latency table is the measurement set behind that choice. Blank fields mean the property could not be measured, which is itself diagnostic: an all-blank DERP table points at a captive portal or TLS interception.

**`tailscale ping node-b`** shows the upgrade happening:

```
$ tailscale ping node-b
pong from node-b (100.101.102.103) via DERP(nyc) in 46ms
pong from node-b (100.101.102.103) via DERP(nyc) in 44ms
pong from node-b (100.101.102.103) via 198.51.100.24:41641 in 8ms
```

Two relayed round trips while probes fly, then the direct path lands and latency collapses. `tailscale ping` defaults to Tailscale-level pings and also offers TSMP, ICMP, and peer API ping types via flags, so it tests the tunnel path itself rather than just IP reachability.

**`tailscale status`** labels every active peer path:

```
$ tailscale status
100.64.0.1   node-a    fred@   macOS   -
100.64.0.2   node-b    fred@   linux   active; direct 198.51.100.24:41641, tx 187324 rx 220118
100.64.0.3   lab-vm-1  fred@   linux   active; relay "nyc", tx 1204 rx 988
100.64.0.4   cloud-1   fred@   linux   active; peer-relay 198.51.100.60:40000:vni:1, tx 54800 rx 77120
```

`direct` with an `ip:port` is a punched or LAN path; `relay "nyc"` is DERP through the New York region; `peer-relay` with an `ip:port` and VNI marks traffic through one of your own relay nodes. Grepping `tailscale status` for `peer-relay` confirms a peer relay is actually in use. `--json` exists for automation.

> [!ON-THE-WIRE] In a packet capture, DERP traffic is TLS on TCP toward a DERP server, indistinguishable in shape from HTTPS, which is exactly why it survives strict egress filtering. A direct path is UDP between the two reflexive endpoints, and a peer relay path is UDP to the relay's configured port. Inside every one of those wrappers is the same WireGuard ciphertext; the wrapper changes, the payload encryption never does.

## Failure modes

1. **UDP blocked entirely.** Symptom: `netcheck` shows `UDP: false`, every peer in `status` shows `relay`, latency is DERP-shaped forever. No direct path is possible; only DERP's TCP transport survives.
2. **Hard NAT on one side.** Symptom: `MappingVariesByDestIP: true` at one site; connections still usually go direct but take longer to upgrade, arriving via the birthday probe search rather than a clean first-probe hit.
3. **Hard NAT on both sides.** Symptom: both sites report `MappingVariesByDestIP: true`, and the pair sits on `relay` or `peer-relay` indefinitely. The pairwise search space is statistically impractical (order 170,000 probes per side for high confidence). Fix with a port-mapping protocol, a static port, or a peer relay; do not wait for luck.
4. **NAT session table exhaustion.** Symptom: under heavy probing or many concurrent flows behind a small appliance, unrelated connections at the site start failing intermittently. Session capacity is finite (a Juniper SRX 300 tops out at 64,000 sessions) and traversal probing spends it.
5. **Idle timeout kills the punched path.** Symptom: after a quiet period, the first packets stall for a beat, `status` may briefly show `relay`, then direct returns. UDP state expired (about 30 seconds is typical), traffic fell back to DERP, and the path was re-punched.
6. **CGNAT stacking.** Symptom: `netcheck` reports a public IPv4 that does not match what external services see; port mapping protocols fail because the outermost NAT belongs to the ISP and ignores you. Direct paths depend entirely on hole punching quality through both layers.
7. **No hairpinning.** Symptom: two nodes behind the same NAT (including the same CGNAT) fail to reach each other via their shared public endpoint, because many otherwise well-behaved NAT devices refuse to loop traffic back. Normally invisible because LAN candidates win first, but it surfaces when nodes share a NAT yet cannot see each other's private addresses.
8. **DERP unreachable.** Symptom: blank DERP latency lines in `netcheck`, new connections fail to establish even though existing direct paths keep working. Usually a captive portal, TLS interception, or an egress policy that finally blocked even HTTPS-shaped traffic.
9. **Stale home DERP after roaming.** Symptom: relayed latency far worse than geography justifies (two nodes in one city relaying through another continent) until the roamed node re-measures and re-selects its home region.
10. **Peer relay configured but unused.** Symptom: grepping `tailscale status` for `peer-relay` returns nothing despite configuration. Usual causes: the relay's UDP port is not reachable from the clients, a missing `tailscale.com/cap/relay` grant, or a client or server below v1.86.

## Check yourself

**1. From your laptop, `tailscale netcheck` shows `UDP: true`, `MappingVariesByDestIP: false`. From a Customer's warehouse box, the same command shows `UDP: true`, `MappingVariesByDestIP: true`. Will these two nodes connect directly, and by what mechanism?**

Answer: Almost certainly yes, but through the asymmetric hard-NAT procedure rather than a clean punch. Your laptop is behind an easy NAT: the endpoint it advertises from STUN is valid for any peer. The warehouse box is behind a hard NAT: its advertised endpoint is only valid toward the STUN server that observed it, so your laptop cannot simply aim at it. Traffic starts over DERP immediately, so the connection works from the first packet regardless. In parallel, the warehouse side opens on the order of 256 sockets toward your laptop's known-good endpoint, minting 256 public mappings on its NAT, while your laptop sprays probes at random ports on the warehouse NAT's public IP. The birthday math makes a collision likely fast: even odds within roughly 174 probes, near certainty within about 2048, seconds at normal probe rates. First collision completes a round trip, both sides converge on that port pair, the path is latency-scored, and the connection upgrades from DERP to direct. Had the laptop also shown `MappingVariesByDestIP: true`, the answer flips: the two-sided search is impractical, and the pair stays relayed unless you fix a side via port mapping or deploy a peer relay.

**2. `tailscale ping node-b` returns `via DERP(nyc)` for the first two pongs, then `via 198.51.100.24:41641` with latency dropping from 44ms to 8ms. Narrate exactly what happened between pong two and pong three.**

Answer: This is the standard upgrade sequence, visible in real time. Every Tailscale connection begins relayed through DERP by design, so the first pongs traveled from your node over its DERP connection to the New York region, then down node-b's DERP connection, as WireGuard ciphertext neither relay hop could read. Meanwhile both nodes had exchanged candidate endpoint lists through the coordination side channel and were probing every candidate pair: LAN addresses, IPv6, STUN-derived public endpoints. Those probes are themselves the hole punchers; each one created outbound state in its local NAT and firewall, and because both sides probed simultaneously, inbound probes started matching that state. A probe pair completed a round trip on the path through `198.51.100.24:41641`, node-b's reflexive endpoint. Path selection scores discovered paths by round-trip latency, the 8ms direct path beat the 44ms relayed path, and the connection migrated transparently. Pong three rode the new path. From here, keepalives maintain the NAT state, and if the path ever dies, traffic drops back to DERP while re-discovery runs.

**3. Two VPCs, both behind strict cloud NAT, need sustained multi-gigabit transfers between lab-vm-1 and cloud-1. Both currently show `relay "nyc"` in `tailscale status`. What do you deploy, and what are the concrete steps?**

Answer: This is the canonical Peer Relays case, GA since February 2026: both sides hard-NATed (so direct paths are statistically out of reach), throughput-heavy (so shared DERP is the wrong pipe), and the traffic should stay inside your infrastructure rather than hairpinning through Tailscale's relays. Pick a stable node with clean reachability from both VPCs (or one per VPC), running Tailscale v1.86 or later on a supported server OS (not iOS, Apple TV, or Android). Enable relay duty with `tailscale set --relay-server-port=40000` and open that UDP port to the relevant peers; if the relay sits behind a load balancer or forwarded port, advertise it via `--relay-server-static-endpoints`. Then authorize use in the tailnet policy with a grant whose `src` is the tags for the transfer endpoints, `dst` is the relay's tag, and `app` contains `tailscale.com/cap/relay`. Keep `src` narrow: a wildcard would pull unrelated traffic through the relay and add latency for pairs that did not need it. Verify by grepping `tailscale status` for `peer-relay` on the endpoints. Selection order takes care of the rest: direct still gets tried first, the peer relay carries the load when direct fails, and DERP remains the floor if the relay host goes down.

## What you now have

1. A two-axis mental model of NAT (mapping behavior, filtering behavior) reduced to the one bit that matters: endpoint-independent or endpoint-dependent.
2. The hole punching sequence: STUN discovery, endpoint exchange over the side channel, simultaneous probing, latency-scored selection, keepalives.
3. The birthday paradox numbers for hard NATs: 256 sockets, even odds around 174 probes, and why two hard NATs means relay.
4. DERP's dual role, its cannot-decrypt security property, and how home region selection works.
5. The path lifecycle: born on DERP, upgraded to direct, degraded gracefully, migrated across network changes.
6. Peer Relays as the 2026-era self-hosted relay tier: v1.86+, `--relay-server-port`, the `tailscale.com/cap/relay` grant, and the direct, peer relay, DERP preference order.
7. The three-command observability kit: `netcheck`, `tailscale ping`, `tailscale status`.

## Cross references

- Module 01, WireGuard foundations: the encryption that makes relaying safe. Every packet DERP or a peer relay touches was sealed by WireGuard before it left the node, and sessions keyed to peers rather than addresses are what make path migration invisible.
- Module 02, the control plane: the coordination server distributes the keys, candidate endpoints, DERP map, and home region reports this module's machinery consumes.
- Module 05, ACLs and grants: the grant syntax used here for `tailscale.com/cap/relay` is the general policy mechanism that module covers in full.
- Module 07, routing: subnet routers and exit nodes ride the same per-peer paths built here; a relayed path to an exit node relays all your internet traffic.
- Module 11, troubleshooting: starts from symptoms and works backward to this module's mechanisms; the failure catalog above is its foundation.
- Module 12, the open source codebase: the traversal engine, netcheck, and the DERP client and server live in the open tailscale repositories, where you can read everything this module described.
