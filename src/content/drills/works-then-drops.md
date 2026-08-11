---
slug: works-then-drops
title: Transfers stall for 30 to 60 seconds every time the laptop roams
description: Long lived sessions freeze exactly when a laptop hops between wifi and cellular; the migrated direct path is silently dropped by a strict stateful firewall until rekey and DERP fallback rescue it.
area: connectivity
difficulty: 3
symptom: "Big copies to our build server freeze for about a minute whenever I leave the office wifi, and sometimes the session just dies."
words: 1600
sources:
  - id: connection-types
    url: https://tailscale.com/kb/1257/connection-types
    title: Connection types
    checked: 2026-08-10
  - id: nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
  - id: wg-protocol
    url: https://www.wireguard.com/protocol/
    title: Protocol and Cryptography
    checked: 2026-08-10
  - id: wg-paper
    url: https://www.wireguard.com/papers/wireguard.pdf
    title: "WireGuard: Next Generation Kernel Network Tunnel"
    checked: 2026-08-10
  - id: derp-servers
    url: https://tailscale.com/kb/1232/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: firewall-ports
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: derp-map
    url: https://login.tailscale.com/derpmap/default
    title: Default DERP map
    checked: 2026-08-10
  - id: tailcfg-source
    url: https://github.com/tailscale/tailscale/blob/main/tailcfg/tailcfg.go
    title: tailscale/tailscale tailcfg/tailcfg.go
    checked: 2026-08-10
  - id: magicsock-source
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/magicsock.go
    title: tailscale/tailscale wgengine/magicsock/magicsock.go
    checked: 2026-08-10
---

## The ticket

A Customer's field engineer runs long rsync pushes from a laptop, node-a, to a build server, cloud-1, which sits behind the Customer's office firewall. The pushes are fine for hours at a desk. The moment the engineer walks out of the building and the laptop hops from office wifi to a phone hotspot, the transfer freezes. Sometimes it resumes after 30 to 60 seconds; sometimes rsync gives up first. The engineer can reproduce it on demand by toggling wifi, which makes this a gift as tickets go: a deterministic repro of an intermittent-looking failure.

> "Every single time I switch networks the copy freezes for about a minute. If I restart Tailscale it comes back instantly. So it is Tailscale, right?"

## Evidence provided

Status on node-a before the roam, healthy direct path:

```
$ tailscale status
100.64.15.7   cloud-1   ops@   linux  active; direct 203.0.113.44:41641, tx 90418804 rx 1483220
```

A continuous ping across a roam, captured by the first responder:

```
$ tailscale ping --c 0 --until-direct=false cloud-1
pong from cloud-1 (100.64.15.7) via 203.0.113.44:41641 in 12ms
pong from cloud-1 (100.64.15.7) via 203.0.113.44:41641 in 12ms
(wifi disabled here, 14:02:03)
...
no reply
no reply
pong from cloud-1 (100.64.15.7) via DERP(ord) in 51ms      (14:02:41)
pong from cloud-1 (100.64.15.7) via DERP(ord) in 50ms
```

Laptop daemon log excerpt around the roam, long interface state strings trimmed:

```
14:02:03 LinkChange: major, rebinding: old: ... new: ...
14:02:04 magicsock: endpoints changed: 172.56.41.203:7218 (stun), 10.184.22.9:41641 (local)
14:02:41 magicsock: disco: node [k9Qhx] d:4f21ab09cd88e310 now using 127.3.3.40:12 mtu=1360
```

That last address is not a typo. Tailscale encodes a DERP path as the loopback address 127.3.3.40 with the DERP region ID in the port field, and region 12 is ord (Chicago) in the published DERP map. The laptop just moved this peer onto the relay.

And `tailscale status --json` on node-a DURING the stall (fields trimmed):

```json
{
  "HostName": "cloud-1",
  "TailscaleIPs": ["100.64.15.7"],
  "Relay": "ord",
  "CurAddr": "203.0.113.44:41641",
  "RxBytes": 1483220,
  "TxBytes": 90419112,
  "LastHandshake": "2026-08-10T14:00:59Z",
  "Online": true,
  "Active": true
}
```

TxBytes still climbing, RxBytes frozen, CurAddr still pointing at the old path. The laptop is shouting into a dead socket.

## Hypothesis tree

The gap has a precise duration signature: 30 to 60 seconds, then recovery via DERP. Signatures like that are your discriminator, because each candidate mechanism predicts a different gap length.

<div class="diagram-wrap">
<svg viewBox="0 0 880 400" role="img" aria-label="Hypothesis tree for transfers stalling on network roam">
  <title>Hypothesis tree: what causes a 30 to 60 second stall on every roam</title>
  <rect x="260" y="14" width="360" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="440" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Symptom: stall on every wifi to cellular</text>
  <text x="440" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="14">roam, recovers in 30 to 60s or dies</text>
  <line x1="440" y1="66" x2="110" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="330" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="550" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="770" y2="140" stroke="var(--diagram-accent)"/>
  <rect x="10" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">A. Radio gap: laptop</text>
  <text x="110" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">briefly has no network</text>
  <rect x="230" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="330" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">B. Client slow to rebind</text>
  <text x="330" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">to the new interface</text>
  <rect x="450" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="550" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">C. Normal path migration</text>
  <text x="550" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">lag while probing new NAT</text>
  <rect x="670" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="770" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">D. Firewall drops the</text>
  <text x="770" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">migrated path until rekey</text>
  <text x="110" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: plain internet works</text>
  <text x="110" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">2s after roam. Ruled out.</text>
  <text x="330" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: log timestamps. Rebind at</text>
  <text x="330" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">+0s, endpoints at +1s. Ruled out.</text>
  <text x="550" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: migration lag is seconds,</text>
  <text x="550" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">not 30 to 60s. Wrong signature.</text>
  <text x="770" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: firewall counters at the</text>
  <text x="770" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">office edge. Drops observed.</text>
  <text x="770" y="286" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED</text>
</svg>
</div>

## Investigation

1. **Turn the repro into a measurement.** Run `tailscale ping --c 0 --until-direct=false cloud-1` continuously and toggle wifi at a known timestamp. Both flags matter: `--c 0` means ping forever, and `--until-direct=false` overrides the default, which would have stopped the command on the first direct pong before the roam ever happened. Result: pongs `via 203.0.113.44:41641` until 14:02:03, silence for 38 seconds, then pongs `via DERP(ord)`. Meanwhile a plain `curl https://example.com` from the same laptop succeeds within 2 seconds of the roam. That rules out branch A: the laptop has internet almost immediately; only the tunnel to cloud-1 is dark.

2. **Check the daemon logs for rebind speed.** `LinkChange: major, rebinding` lands at 14:02:03, the same second as the roam, and `magicsock: endpoints changed` shows the new cellular STUN endpoint (172.56.41.203:7218) one second later. Note the endpoint types the daemon prints: `(stun)` is what the STUN server saw, `(local)` is the interface address. The client noticed the new network and re-discovered its public endpoint in about a second. Branch B ruled out: the client did its half of the job immediately.

3. **Read `tailscale status --json` during the stall.** `CurAddr` still says `203.0.113.44:41641` (the old direct path), TxBytes climbs, RxBytes is frozen, and `LastHandshake` is aging past two minutes. Interpretation: node-a is still transmitting on a path that no longer returns anything. This is the signature of a silently dead path, not a torn-down one. Nothing sent a reset; packets are being eaten.

4. **Distinguish branch C from branch D with the gap length.** Normal path migration is fast: the peers exchange their new endpoint candidates through DERP as a side channel and probe them, a process the NAT traversal design treats as routine and that completes in seconds (Module 03). A 30 to 60 second outage on EVERY roam is the wrong signature for C. It is exactly the right signature for WireGuard's own recovery timers, which points to the direct path staying blackholed until cryptographic recovery, branch D.

5. **Go look at the office firewall in front of cloud-1.** The edge device is a strict stateful firewall with UDP "flow validation" enabled: it only accepts UDP packets that match an existing outbound-initiated flow, and it logs everything else. Its counters during the repro show inbound UDP from 172.56.41.203 (the cellular address) dropped at the exact stall window: the migrated packets arrive from a source the firewall has never seen, match no state, and die. The old conntrack entry still points at the wifi address, so cloud-1's outbound traffic keeps that dead state alive for a while too. Both directions of the direct path are now useless: node-a's new-source packets are dropped inbound, and cloud-1 keeps replying to a wifi address the laptop abandoned. Branch D confirmed with device evidence.

6. **Verify the recovery mechanism explains the timing.** WireGuard's protocol behavior: if we have sent a packet but received nothing back for KEEPALIVE_TIMEOUT + REKEY_TIMEOUT (10 + 5 = 15 seconds in the whitepaper's constants), initiate a new handshake, then retry every REKEY_TIMEOUT (5 seconds) plus up to 333 ms of jitter. In parallel, Tailscale's path layer gives up on the dead direct address and falls back to the relay; the connection types documentation describes relay fallback and the periodic re-check for direct paths. The first handshake that transits DERP succeeds, `Relay: "ord"` becomes the active path, and traffic resumes. Fifteen seconds of mandatory silence plus several retry rounds plus fallback lands squarely in the observed 30 to 60 second window. Sessions die when the application's own timeout is shorter than the gap.

> [!HOW-IT-WORKS]
> WireGuard sessions are bound to identities, not addresses: a peer is its public key, and the protocol is explicitly built to keep a session alive while endpoints change underneath it (Module 01). Roaming is not an edge case; it is a design feature. When roaming breaks, the suspect is almost never the cryptography and almost always a middlebox that cares about addresses more than WireGuard does.

> [!ON-THE-WIRE]
> During the stall window, three flows exist simultaneously: node-a sending WireGuard data from its new cellular address (dropped at the office edge, no matching state), cloud-1 sending to the stale wifi address (delivered to nowhere), and both sides' DERP connections over TCP 443, idle but alive. That third flow is why recovery is possible at all: DERP is the always-reachable rendezvous the handshake finally crosses.

## Root cause

The Customer's office firewall enforces strict per-flow UDP state on inbound traffic to cloud-1's network. When node-a roams, its half of the tunnel migrates to a new source address and port. WireGuard itself is happy to accept that (identity-bound sessions, Module 01), and Tailscale's discovery layer redistributes the new endpoint within seconds (Module 03). But the firewall drops the migrated packets because they match no existing flow, and it keeps honoring the stale flow to the old wifi address. The direct path is therefore blackholed in both directions with zero error signaling. Connectivity only returns when WireGuard's timer machinery declares the session stale (15 seconds of unacknowledged sends) and rehandshakes, with the handshake and subsequent traffic riding the DERP fallback path that strict TCP 443 rules never touched. The observed 30 to 60 seconds is not random; it is timer arithmetic. Restarting tailscaled "fixes" it instantly for the same reason: a restart forces an immediate new handshake instead of waiting out the timers.

## Fix and prevention

**Immediate fix, at the office firewall:** exempt cloud-1's WireGuard port from strict UDP flow validation, or equivalently add a stateless accept for UDP to 203.0.113.44:41641. Once packets from a not-yet-seen source can reach tailscaled, a roam heals in about a second: the migrated packets arrive, cloud-1 learns the new endpoint, and the direct path re-forms without waiting for timer-driven recovery. Retest with the same continuous ping repro: the gap should collapse from 38 seconds to under 3.

**Durable prevention:**

- Put the exemption in the firewall template for every node that accepts direct Tailscale connections behind a strict edge, and document WHY: WireGuard endpoints legitimately change mid-session, so "unknown source equals attack" is the wrong model for udp/41641.
- Keep the DERP path unthrottled (TCP 443 outbound). It is the safety net that turns this failure from an outage into a stall.
- Add the roam test to acceptance for laptop-heavy Customers: start a transfer, toggle wifi, measure the gap. A number under 5 seconds is a pass; 30-plus seconds means timers are doing a firewall's apology tour.
- Watch relay ratios: a fleet that quietly shifts from direct to relay after roams is this bug at scale.

> [!GOTCHA]
> "Restarting Tailscale fixes it" is the most misleading clue in this ticket. A restart forces an immediate handshake, which happens to bypass the timer wait. That makes the client look guilty when it is the only component behaving correctly. Treat instant-fix-on-restart as evidence of a stuck path plus timer recovery, not as evidence of a client bug.

## The handoff package

As prepared before the firewall evidence closed it:

- **Summary:** Direct connection node-a to cloud-1 blackholes for 30 to 60s on every wifi to cellular roam; recovery coincides with rehandshake over DERP(ord); suspected middlebox dropping migrated UDP flows.
- **Repro:** `tailscale ping --c 0 --until-direct=false cloud-1` on node-a, disable wifi with hotspot active. Gap 34 to 41s across 6 trials on 2026-08-10, then pongs via DERP(ord). 100% reproducible.
- **Log evidence:** node-a 14:02:03 `LinkChange: major, rebinding`; 14:02:04 `magicsock: endpoints changed: 172.56.41.203:7218 (stun)`; 14:02:41 `magicsock: disco: node [k9Qhx] ... now using 127.3.3.40:12` (DERP region 12, ord). status --json at 14:02:20: CurAddr 203.0.113.44:41641, RxBytes frozen, LastHandshake 14:00:59Z.
- **Version matrix:** node-a macOS client 1.88.x; cloud-1 linux 1.88.x; office edge firewall firmware 2026.1 with UDP flow validation enabled.
- **Impact scope:** every roaming client of cloud-1 (about 12 field laptops); long lived transfers stall or die on each roam; desk-bound nodes unaffected.
- **Ruled out:** radio gap (internet up within 2s), client rebind lag (log timestamps at +0s and +1s), DERP problems (fallback works, latency normal), rekey malfunction (recovery timing matches whitepaper constants exactly).
- **Proposed owning area:** Customer network edge; if a client change were wanted, magicsock path migration (faster dead-path detection) as an enhancement, not a defect.

## The trap

The weak investigation anchors on "restart fixes it, therefore Tailscale is broken", swaps the client version up and down, blames the wifi driver, and captures packets only on the laptop, where the story looks like "I send and nothing comes back", which is true and useless. Nobody captures at the office edge, so nobody sees the drops, and the ticket gets closed as "flaky cellular" while a dozen field laptops keep eating a one minute stall on every roam, with rsync jobs dying and re-sending gigabytes. The cost compounds silently: users learn to stay on wifi, or worse, to restart the client hourly. The discipline this drill teaches: when a stall has a REPEATABLE duration, stop guessing and go find the timer that measures exactly that long, then ask what failure that timer exists to survive. The timer arithmetic named the firewall before the firewall logs ever did.
