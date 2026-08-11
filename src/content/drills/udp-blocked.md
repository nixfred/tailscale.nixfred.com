---
slug: udp-blocked
title: Everything works but everything is slow, every path is on DERP
description: An office firewall that blocks all outbound UDP forces every Tailscale connection onto DERP over TCP 443; two firewall rules bring direct paths back.
area: connectivity
difficulty: 1
symptom: "Tailscale works fine from the office but transfers are painfully slow, and every single peer shows relay in status."
words: 1250
sources:
  - id: firewall-ports
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: cli-netcheck
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: derp-servers
    url: https://tailscale.com/kb/1232/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: netcheck-source
    url: https://github.com/tailscale/tailscale/blob/main/net/netcheck/netcheck.go
    title: tailscale/tailscale net/netcheck/netcheck.go
    checked: 2026-08-10
---

## The ticket

A Customer's engineering team moved into a new office two weeks ago. Since the move, everything on the tailnet still works: SSH sessions connect, the internal wiki loads, deploys run. But large artifact pulls from lab-vm-1 that used to take a minute now take fifteen, and video calls tunneled over the tailnet stutter. The urgency is medium: nobody is blocked, everybody is annoyed, and the team has started calling Tailscale "the slow VPN", which is the reputational version of an outage.

> "It all works, it is just brutally slow from the office. From home the same laptop is fast. Every peer in tailscale status says relay."

## Evidence provided

Status from an office laptop, node-a:

```
$ tailscale status
100.64.20.11  node-a     ops@   linux  -
100.64.15.7   cloud-1    ops@   linux  active; relay "nyc", tx 2041164 rx 96422108
100.64.31.42  lab-vm-1   ops@   linux  active; relay "nyc", tx 884120 rx 10229844
100.64.44.19  node-b     ops@   macOS  idle, tx 18244 rx 16408
```

Netcheck from the same laptop:

```
$ tailscale netcheck

Report:
	* Time: 2026-08-10 15:02:11.443908Z
	* UDP: false
	* IPv4: (no addr found)
	* IPv6: no, unavailable in OS
	* MappingVariesByDestIP: 
	* PortMapping: 
	* CaptivePortal: false
	* Nearest DERP: New York City
	* DERP latency:
		- nyc: 9.8ms   (New York City)
		- ord: 22.4ms  (Chicago)
		- dfw: 33.6ms  (Dallas)
```

A ping to the artifact server:

```
$ tailscale ping --c 3 lab-vm-1
pong from lab-vm-1 (100.64.31.42) via DERP(nyc) in 24ms
pong from lab-vm-1 (100.64.31.42) via DERP(nyc) in 23ms
pong from lab-vm-1 (100.64.31.42) via DERP(nyc) in 24ms
direct connection not established
```

## Hypothesis tree

The single most useful observation is in the status output: EVERY active peer is relayed, regardless of where that peer lives. Per-peer NAT problems produce per-peer results. A uniform result points at something local to this office.

<div class="diagram-wrap">
<svg viewBox="0 0 880 380" role="img" aria-label="Hypothesis tree for all peers stuck on relay from one office">
  <title>Hypothesis tree: why is every peer relayed from this office</title>
  <rect x="270" y="14" width="340" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="440" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Symptom: every peer shows relay,</text>
  <text x="440" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="14">slow but working, one office only</text>
  <line x1="440" y1="66" x2="110" y2="140" stroke="var(--diagram-accent)"/>
  <line x1="440" y1="66" x2="330" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="550" y2="140" stroke="var(--diagram-line)"/>
  <line x1="440" y1="66" x2="770" y2="140" stroke="var(--diagram-line)"/>
  <rect x="10" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="110" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">A. Office egress blocks</text>
  <text x="110" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">outbound UDP entirely</text>
  <rect x="230" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="330" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">B. Hard NAT at the</text>
  <text x="330" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">office plus hard peers</text>
  <rect x="450" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="550" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">C. Captive portal or</text>
  <text x="550" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">interception proxy</text>
  <rect x="670" y="140" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="770" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="13">D. DERP region issue</text>
  <text x="770" y="183" text-anchor="middle" fill="var(--diagram-text)" font-size="13">or bad home DERP</text>
  <text x="110" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: netcheck UDP line.</text>
  <text x="110" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Observed: false.</text>
  <text x="110" y="286" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED</text>
  <text x="330" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: MappingVariesByDestIP.</text>
  <text x="330" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Observed: blank, STUN never answered.</text>
  <text x="550" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: CaptivePortal line and control</text>
  <text x="550" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">plane health. Observed: false, healthy.</text>
  <text x="770" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Test: DERP latency table.</text>
  <text x="770" y="268" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Observed: nyc 9.8ms, normal.</text>
</svg>
</div>

## Investigation

1. **Read status across several peers.** cloud-1, lab-vm-1, and every other active peer shows `relay "nyc"`. Peers in different networks with different NAT situations all landing on relay rules out per-peer causes (branch B needs every single peer to be hard, which the home-network test already contradicts: the same laptop goes direct from home).

2. **Run `tailscale netcheck`.** `UDP: false` is the headline. The CLI documentation is blunt about what that field means: if it is false, "it's unlikely Tailscale will be able to make point-to-point connections, and will instead rely on our encrypted TCP relays (DERP)". `IPv4: (no addr found)` follows directly: the client's STUN probes (UDP to port 3478) never got an answer, so it never learned its own public endpoint. `MappingVariesByDestIP` is blank for the same reason: you cannot classify a NAT you cannot probe. Meanwhile the DERP latency table is fully populated with healthy single-digit and low-double-digit numbers. Those measurements ran over HTTPS to the DERP servers, which is also your proof that outbound TCP 443 and IPv4 internet access are fine. That combination rules out branches C and D: a captive portal would break the control plane and show `CaptivePortal: true`, and a DERP problem would show in the latency table.

3. **Repeat netcheck on a second office machine.** Same result: `UDP: false`. Two machines with different OS builds and different local firewalls showing identical results moves the cause off the endpoint and onto the network. This rules out a host firewall or endpoint security agent on one laptop.

4. **Ask the firewall owner, with the specific question.** Not "is Tailscale allowed" but "what does the egress policy do with outbound UDP". Answer: the new office firewall shipped with a default egress policy of allow TCP 80/443, deny everything else. All outbound UDP is dropped. Hypothesis A confirmed by configuration, matching the evidence exactly.

5. **Confirm the impact is what the design predicts.** `tailscale ping --c 3 lab-vm-1` completes with steady pongs `via DERP(nyc)` at 24ms. Nothing is broken. Everything is relayed. That is precisely the designed degradation.

> [!HOW-IT-WORKS]
> DERP relays run over HTTPS on TCP 443, which is why the tailnet still works in a network that only permits web traffic. The relay is not a security downgrade: traffic stays end-to-end encrypted with WireGuard, and a DERP server blindly forwards already-encrypted packets from one device to another based on the destination's public key. It is impossible for the DERP server to decrypt your traffic. The cost is performance, never confidentiality (Module 03).

## Root cause

The office firewall drops all outbound UDP. Tailscale's direct paths are WireGuard over UDP (Module 01), and its NAT traversal machinery needs UDP twice: STUN queries to port 3478 to discover the laptop's public endpoint, and the WireGuard tunnel itself, which by default uses source port 41641 (Module 03). With UDP dead, STUN gets no answers, no endpoints are discovered, no direct path can ever form, and every client in the office falls back to its nearest DERP region over TCP 443. Each connection then pays the relay tax: an extra network hop through a shared server fleet, and a TCP transport underneath a protocol designed for UDP, so any loss stalls the whole stream instead of one packet. Fallback is doing exactly its job. The DERP documentation treats frequent relayed connections as something to fix rather than to live with: if you hit them often and they do not meet your performance requirements, it points you at peer relays.

## Fix and prevention

**Immediate fix, two egress rules on the office firewall,** straight from the firewall ports documentation:

1. Allow internal devices to initiate UDP from source port 41641 to any destination and port (the WireGuard tunnel; direct tunnels use UDP with a source port that defaults to 41641).
2. Allow internal devices to initiate UDP to `*:3478` (STUN, for endpoint discovery).

Both rules are outbound-initiated with stateful return traffic. No inbound allow rules are required: replies ride the state the outbound packets created.

**Verification:** rerun `tailscale netcheck` (expect `UDP: true` and a real `IPv4:` endpoint), then watch `tailscale status` flip peers to `active; direct <ip>:41641` within a minute or two. Transfer speed should jump immediately.

**Prevention:** put these two rules in the standard firewall template for every office, and add a scheduled `tailscale netcheck` to office network monitoring. `UDP: false` at a site is a one-line alert that predicts every "VPN is slow" ticket from that site.

> [!GOTCHA]
> Do not "fix" this by allowlisting specific DERP hostnames or IP ranges and stopping there. That makes today's relay path more reliable while guaranteeing you never get direct paths back. The order matters: open UDP first, and treat DERP allowlisting as belt-and-suspenders for locked-down networks, not as the repair.

## The handoff package

This one resolves at the firewall and never reaches engineering. The package, had it been needed:

- **Summary:** All peers relay via DERP(nyc) from one office; netcheck reports UDP false; office egress policy denies all outbound UDP.
- **Repro:** From any office node, `tailscale netcheck` shows `UDP: false`, `IPv4: (no addr found)`; `tailscale ping lab-vm-1` never leaves DERP. From home, same laptop goes direct. 100% reproducible since office move on 2026-07-27.
- **Log evidence:** netcheck 2026-08-10 15:02Z node-a (100.64.20.11): UDP false, CaptivePortal false, nyc 9.8ms via HTTPS probes. status 15:04Z: cloud-1 and lab-vm-1 both `active; relay "nyc"`.
- **Version matrix:** node-a linux 1.88.x; lab-vm-1 linux 1.88.x; cloud-1 linux 1.88.x.
- **Impact scope:** entire office (approximately 30 nodes); throughput and latency degraded on all tailnet paths; no reachability loss.
- **Ruled out:** captive portal (flag false, control plane healthy), DERP outage (normal latencies), per-peer NAT (uniform across peers), host firewall (multiple machines identical).
- **Proposed owning area:** none (Customer firewall); otherwise client netcheck/magicsock.

## The trap

The weak investigation sees "slow VPN", benchmarks it, confirms it is slow, and starts tuning: MTU experiments, switching DERP regions, filing a ticket about relay capacity, or moving the artifact server closer to the office. All of it optimizes the wrong path. The relay is not underperforming; it is performing exactly as a fallback should while the network silently forbids the fast path. The cost is an office full of engineers who learn to route around the tailnet, plus hours of tuning that a single netcheck would have prevented. Difficulty 1 lesson, stated flat: on any slowness ticket, `tailscale netcheck` is the first command you run, and `UDP: false` ends the mystery before it starts.
