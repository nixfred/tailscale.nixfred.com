---
slug: relay-stuck
title: Two nodes stuck on the relay and never going direct
description: Two sites behind endpoint dependent NAT hold an "active; relay" connection forever; the birthday paradox math explains why, and the fix is a port mapping on one side or a Peer Relay.
area: connectivity
difficulty: 2
symptom: "Both machines show active; relay in tailscale status and file sync between our offices crawls. It has never once said direct."
words: 1500
sources:
  - id: cli-netcheck
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
  - id: peer-relay
    url: https://tailscale.com/docs/features/peer-relay
    title: Tailscale Peer Relays
    checked: 2026-08-10
  - id: connection-types
    url: https://tailscale.com/docs/reference/connection-types
    title: Connection types
    checked: 2026-08-10
  - id: changelog
    url: https://tailscale.com/changelog
    title: Changelog
    checked: 2026-08-10
  - id: derp-servers
    url: https://tailscale.com/docs/reference/derp-servers
    title: DERP servers
    checked: 2026-08-10
---

## The ticket

A Customer runs two small offices. node-a sits at headquarters, node-b at a branch office, and a nightly backup sync runs between them. Both sites have 500 Mbps fiber, yet the sync moves at roughly 1.5 MB/s and interactive SSH between the two machines feels laggy. Nothing is down. The urgency is chronic annoyance, not outage, which is exactly the kind of ticket that sits unfixed for a month.

> "Both machines show active; relay in tailscale status. It has said relay for three weeks straight. I thought Tailscale was supposed to connect them directly."

## Evidence provided

The first responder collected `tailscale status` from node-a, `tailscale netcheck` from both sides, and a `tailscale ping`.

```
$ tailscale status
100.64.20.11  node-a   ops@   linux  -
100.64.31.42  node-b   ops@   linux  active; relay "ord", tx 148120 rx 96040
```

node-a netcheck:

```
$ tailscale netcheck

Report:
	* Time: 2026-08-10 14:12:04.118472Z
	* UDP: true
	* IPv4: yes, 198.51.100.23:41641
	* IPv6: no, but OS has support
	* MappingVariesByDestIP: true
	* PortMapping: 
	* CaptivePortal: false
	* Nearest DERP: Chicago
	* DERP latency:
		- ord: 18.4ms  (Chicago)
		- dfw: 29.7ms  (Dallas)
		- nyc: 33.2ms  (New York City)
```

node-b netcheck:

```
$ tailscale netcheck

Report:
	* Time: 2026-08-10 14:15:22.904115Z
	* UDP: true
	* IPv4: yes, 203.0.113.87:2896
	* IPv6: no, but OS has support
	* MappingVariesByDestIP: true
	* PortMapping: 
	* CaptivePortal: false
	* Nearest DERP: Chicago
	* DERP latency:
		- ord: 21.1ms  (Chicago)
		- nyc: 30.8ms  (New York City)
		- dfw: 34.5ms  (Dallas)
```

Ping from node-a:

```
$ tailscale ping --c 4 node-b
pong from node-b (100.64.31.42) via DERP(ord) in 46ms
pong from node-b (100.64.31.42) via DERP(ord) in 45ms
pong from node-b (100.64.31.42) via DERP(ord) in 47ms
pong from node-b (100.64.31.42) via DERP(ord) in 45ms
direct connection not established
```

## Hypothesis tree

A connection that shows "active; relay" and never upgrades has a short list of causes, and every one of them is discriminated by evidence you can collect in under five minutes. Remember the baseline from the connection types documentation: every Tailscale connection begins relayed through DERP and is upgraded afterward, so "relay" by itself is not an error. Only "relay forever" is interesting.

<div class="diagram-wrap">
<svg viewBox="0 0 880 400" role="img" aria-label="Hypothesis tree for a connection stuck on relay">
  <title>Hypothesis tree: why does the connection never upgrade to direct</title>
  <rect x="270" y="14" width="340" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="440" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Symptom: active; relay for weeks,</text>
  <text x="440" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="14">never direct</text>
  <line x1="440" y1="66" x2="110" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="330" y2="140" stroke="var(--diagram-accent)"/>
  <line x1="440" y1="66" x2="550" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="770" y2="140" stroke="var(--diagram-line)"/>
  <rect x="10" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">A. UDP blocked</text>
  <text x="110" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">at one egress</text>
  <rect x="230" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="330" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">B. Hard NAT on</text>
  <text x="330" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">BOTH sides</text>
  <rect x="450" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="550" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">C. One firewall drops</text>
  <text x="550" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">unsolicited inbound UDP</text>
  <rect x="670" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="770" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">D. Stale client,</text>
  <text x="770" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">no traversal helpers</text>
  <text x="110" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: netcheck UDP line.</text>
  <text x="110" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Observed: true. Ruled out.</text>
  <text x="330" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: MappingVariesByDestIP</text>
  <text x="330" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">on both. Observed: true, true.</text>
  <text x="330" y="286" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED</text>
  <text x="550" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: would still upgrade if the</text>
  <text x="550" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">other side were easy. Subsumed by B.</text>
  <text x="770" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: tailscale version and the</text>
  <text x="770" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">PortMapping line. Ruled out.</text>
</svg>
</div>

## Investigation

1. **Read the status line for what it actually asserts.** `active; relay "ord", tx 148120 rx 96040` means traffic is flowing in both directions through the Chicago DERP region. Byte counters climbing both ways rules out an outage, an ACL block, and a one-way path. This is a performance problem, not a reachability problem.

2. **Run `tailscale netcheck` on node-a.** `UDP: true` rules out branch A on this side: outbound UDP leaves the network and STUN answers come back. The interesting line is `MappingVariesByDestIP: true`. That means the NAT hands out a different public port for every destination the node talks to, which is endpoint dependent mapping, the hard NAT case. Also note `PortMapping:` is empty: no UPnP, NAT-PMP, or PCP service answered, so the client cannot simply ask the router for a stable port.

3. **Run `tailscale netcheck` on node-b.** Same shape: `UDP: true`, `MappingVariesByDestIP: true`, `PortMapping:` empty. Now you know both sides are hard. This is the discriminating fact of the whole case, and it also subsumes branch C: the question is no longer whether one firewall is strict, it is that neither side can predict its own public port.

4. **Run `tailscale ping --c 4 node-b` and let it finish.** The default probe count is 10, and `--until-direct` is on by default, which means the command stops early the moment a pong comes back over a direct path. Here nothing stops early: every pong arrives `via DERP(ord)` and the command ends with `direct connection not established`. This proves upgrade attempts are failing right now, not that the client gave up weeks ago: per the connection types documentation, Tailscale periodically re-checks whether it can establish a direct or peer relay connection.

5. **Check versions.** `tailscale version` on both nodes reports 1.88.x, well past the 1.86 floor the peer relay docs set. That rules out branch D and confirms both nodes are new enough to use a peer relay, which matters for the fix.

> [!GOTCHA]
> The `IPv4: yes, 203.0.113.87:2896` line in netcheck looks like a usable public endpoint. Under endpoint dependent mapping it is not. That ip:port pair is only valid for traffic between node-b and the STUN server that observed it. Any other peer that sends packets there hits a mapping that does not exist. Do not paste netcheck endpoints into firewall rules and expect them to hold.

## Root cause

Both offices are behind hard NAT: endpoint dependent mapping, the behavior older literature calls symmetric NAT (Module 03). An easy NAT reuses one public port for all destinations, so the STUN-discovered endpoint works for everyone. A hard NAT invents a fresh public port per destination, so each side's advertised endpoint is useless to the other, and the only option left is guessing ports.

Tailscale actually does this guessing, and the math is documented in the NAT traversal blog post. Against one hard NAT, the hard side opens about 256 ports (256 sockets all sending to the easy side's ip:port) and the easy side probes target ports at random. The birthday paradox makes that cheap: 174 probes for a 50% chance, 256 for 64%, 1024 for 98%, 2048 for 99.9%. At around 100 packets per second, half the time you are through in under 2 seconds.

With hard NAT on both sides, the search space multiplies instead of adding. The same post puts a 99.9% success at roughly 170,000 probes, which works out to about 28 minutes of sustained flooding. No sane client will hose two office uplinks for half an hour per peer pair, so Tailscale settles on DERP, keeps the connection alive and end-to-end encrypted (the relay never holds keys, Module 01), and quietly re-probes on a schedule. The "stuck" relay is the designed outcome of this topology, not a malfunction.

## Fix and prevention

You only need to make ONE side easy. One predictable endpoint collapses the search from 170,000 probes to a handful.

**If the Customer controls either router, use a port mapping. This is the cheapest fix.** Enable NAT-PMP or UPnP on the branch router, or add a static forward of UDP 41641 to node-b. Verify with netcheck: the `PortMapping:` line should now list the protocol (for example `PortMapping: NAT-PMP`), and within a minute `tailscale status` should flip to `active; direct 203.0.113.87:41641`.

**If neither network can be changed (both behind carrier grade NAT or landlord equipment), deploy a Peer Relay.** Stand up cloud-1 on a cheap VPS with unfiltered UDP, then:

```
$ sudo tailscale set --relay-server-port=40000
```

and grant peers permission to use it in the tailnet policy file:

```json
{
  "grants": [{
    "src": ["tag:office"],
    "dst": ["tag:relays"],
    "app": {"tailscale.com/cap/relay": []}
  }]
}
```

Check the result with `tailscale status | grep peer-relay`: a peer relay path prints as `peer-relay <ip>:<udp-port>:vni:<vni-id>, tx <bytes> rx <bytes>` where `relay "ord"` used to be. Version note, checked 2026-08-10: peer relays entered beta in the 2025-10-29 changelog entry and went generally available on 2026-02-18; the docs require Tailscale 1.86 or later on the peer relay device, any OS other than iOS, Apple TV, or Android can act as the relay, and every supported OS can use one. The configured UDP port has to be reachable from the other devices in the tailnet. A peer relay is still a relay hop, but it is your hop, and the docs claim lower latency and higher throughput than DERP servers provide.

The decision, explicitly: router access on at least one side means port mapping wins (zero new machines, true direct path). No router access on either side means a peer relay wins (one small node you own, documented as lower latency and higher throughput than DERP). DERP remains the fallback of last resort either way.

**Prevention:** add `tailscale netcheck` to the site onboarding checklist and record each site's NAT class. A site pair that is hard/hard is predictable weeks before anyone files a slowness ticket.

> [!FROM-THE-FIELD]
> Consumer ISP routers frequently ship with UPnP on and business firewalls ship with it off. The branch office with the "better" firewall is usually the hard side. Ask what changed the week the sync got slow: the answer is often a firewall upgrade.

## The handoff package

Not escalated: closed as environmental, works as designed. Package as it would have gone out:

- **Summary:** Peer pair never upgrades from DERP to direct; both sites behind endpoint dependent NAT; no port mapping protocol available on either router.
- **Repro:** `tailscale ping --c 4 node-b` from node-a ends `direct connection not established` after all pongs via DERP(ord). Reproducible 100% since at least 2026-07-18 per Customer.
- **Log evidence:** netcheck 2026-08-10 14:12Z node-a (100.64.20.11): UDP true, MappingVariesByDestIP true, PortMapping empty. netcheck 2026-08-10 14:15Z node-b (100.64.31.42): identical shape. status: `active; relay "ord", tx 148120 rx 96040`.
- **Version matrix:** node-a linux 1.88.x, node-b linux 1.88.x, both amd64.
- **Impact scope:** one peer pair (2 nodes); throughput capped at DERP relay rates; no reachability loss.
- **Ruled out:** UDP egress block (netcheck UDP true both sides), ACL deny (bidirectional byte counters), stale clients (both 1.86+), one-sided firewall (both sides EDM).
- **Proposed owning area:** none (environmental). If engineering ever owned it: magicsock / NAT traversal.

## The trap

The weak version of this investigation restarts tailscaled, toggles the tunnel off and on, reinstalls the client, and watches the connection come back as `relay` every time, because none of that changes the NAT math on either side. The next move is usually a ticket blaming DERP capacity, or worse, someone pastes the netcheck endpoint into a firewall rule and declares it fixed until the mapping expires an hour later. The cost is weeks of a business process running at one tenth speed while the actual fix was a router checkbox on one site or a five dollar relay node. The tell you should internalize: `UDP: true` plus `MappingVariesByDestIP: true` on both sides is a complete diagnosis. Once you have both netchecks, stop collecting evidence and start deciding between port mapping and Peer Relay.
