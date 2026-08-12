---
slug: where-does-your-traffic-actually-go
title: Take a path census of your own tailnet
description: A read only survey of every peer to find out which connections are direct and which are relayed, run on a real 47 node tailnet, which turned up a fleet wide finding the operator did not know about.
order: 1
disruptive: false
ran: 2026-08-12
words: 2100
sources:
  - id: docs-connection-types
    url: https://tailscale.com/docs/reference/connection-types
    title: Connection types
    checked: 2026-08-12
  - id: docs-nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-12
  - id: docs-derp
    url: https://tailscale.com/docs/features/derp-servers
    title: DERP servers
    checked: 2026-08-12
  - id: docs-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-12
  - id: docs-firewall-ports
    url: https://tailscale.com/docs/reference/faq/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-12
---

## What this lab does

It asks one question of a real tailnet: for every peer, is the connection direct or relayed, and why. Nothing is changed, nothing is broken, and no configuration is touched. Every command here is read only, which makes this the right first lab and the correct first move on a network you did not build.

It is worth doing even when nothing appears wrong. The tailnet that produced the output below looked completely healthy from the outside. Every machine was reachable, every service worked, nobody had filed a complaint. The census found that only same LAN peers were taking direct paths and every other connection in the fleet was riding a relay.

> [!FROM-THE-FIELD] A relayed connection is not an error. It is the design working: the fallback exists so connectivity never depends on a successful hole punch. But relayed traffic pays a latency penalty and rides bandwidth limits that direct paths do not, so "everything works" and "everything is relayed" can be true at the same time, indefinitely, without anyone noticing.

## Prerequisites

1. Tailscale running on the machine you are sitting at, and at least a handful of peers online.
2. Nothing else. No sudo, no configuration changes, no downtime.

## Run it

### Step 1: count the paths

The status output in JSON is the fastest way to see the whole fleet at once. A peer that is `Active` with a `CurAddr` has a direct path; `Active` with an empty `CurAddr` is relayed; everything else is idle, meaning no session is currently established either way.

```bash
tailscale status --json | python3 -c "
import json,sys
d=json.load(sys.stdin)
peers=d.get('Peer') or {}
direct=relay=idle=0
for p in peers.values():
    if not p.get('Online'): continue
    if p.get('Active'):
        if p.get('CurAddr'): direct+=1
        else: relay+=1
    else: idle+=1
print('direct=%d relay=%d idle=%d' % (direct,relay,idle))"
```

On the tailnet under test, with 47 peers and 25 online:

```
direct=3 relay=0 idle=22
```

That looks excellent, and it is misleading. Only three sessions were active at that moment, and all three happened to be machines on the same physical LAN. The twenty two idle peers had no session at all, so they contributed nothing to the count. An idle peer is not evidence of anything. To learn what path a peer *would* take, you have to make one.

> [!GOTCHA] Do not draw conclusions from a status snapshot alone. Idle peers dominate a healthy tailnet, and they hide the answer. The census only becomes real when you establish sessions on purpose and watch what path each one picks.

### Step 2: establish a session and watch the path get chosen

`tailscale ping` is the instrument. By default it stops as soon as it gets a direct pong, which is convenient for a quick check and useless for watching the sequence. Turn that off so it keeps going and shows you the whole story.

```bash
tailscale ping --c 6 --until-direct=false cloud-1
```

A connection that behaves the way the documentation describes looks like this: the first pongs come back through a relay while both sides work on a direct path, then the path upgrades and latency drops.

What came back instead, every time, for every remote machine:

```
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 64ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 57ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 51ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 52ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 51ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 52ms
```

Six pongs, no upgrade. Extending the window to fifteen pings changed nothing. The status line for that peer settled at `active; relay "nyc"` and stayed there.

Meanwhile a peer on the same physical LAN:

```
pong from node-b (100.64.0.38) via 10.0.0.200:41641 in 36ms
```

Direct immediately, over the local address, never touching a relay. That contrast is the finding: the tailnet was not failing to establish direct paths in general, it was failing to establish them to anything that was not already on the same wire.

### Step 3: prove it is systemic, not one bad peer

One relayed peer is a peer problem. Every remote peer relaying is a network property. Check several, across different providers, so a single provider's behavior cannot explain it.

```bash
for h in cloud-1 lab-vm-1 node-b; do
  printf "%-12s " "$h"
  tailscale ping --c 3 --until-direct=false "$h" 2>&1 | tail -1
done
```

Three different cloud hosts, two different hosting providers, all relayed through the same region. One LAN host, direct. The pattern held without exception.

<div class="diagram-wrap">
<svg viewBox="0 0 760 330" role="img" aria-label="Census result: the local machine reaches same LAN peers directly, while every cloud host in two different providers is reached only through a DERP relay">
  <title>What the census found: direct on the LAN, relayed everywhere else</title>
  <rect x="20" y="130" width="150" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="95" y="155" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">node-a</text>
  <text x="95" y="174" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">easy NAT, UDP ok</text>

  <rect x="20" y="20" width="150" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="95" y="44" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">node-b</text>
  <text x="95" y="62" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">same LAN</text>
  <path d="M95 130 L95 76" stroke="var(--diagram-accent)" stroke-width="2.5" fill="none"/>
  <text x="106" y="108" fill="var(--diagram-accent)" font-size="11" font-family="var(--font-mono)">direct, 36ms</text>

  <rect x="300" y="120" width="150" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="375" y="150" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">DERP</text>
  <text x="375" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">relay region</text>
  <path d="M170 160 L300 160" stroke="var(--diagram-line)" stroke-width="2" stroke-dasharray="6 5" fill="none"/>

  <rect x="580" y="40" width="160" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="660" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">cloud-1</text>
  <rect x="580" y="134" width="160" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="660" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">lab-vm-1</text>
  <rect x="580" y="228" width="160" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="660" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">other provider</text>

  <g stroke="var(--diagram-line)" stroke-width="2" stroke-dasharray="6 5" fill="none">
    <path d="M450 145 L580 66 M450 160 L580 160 M450 178 L580 254"/>
  </g>
  <text x="470" y="306" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">every non LAN pair relayed, across two providers</text>
</svg>
</div>

### Step 4: read the NAT fingerprint on both ends

`netcheck` is the report that says whether direct paths are even possible from where you are standing. Run it locally, then run it on the far end, because a direct path needs both.

```bash
tailscale netcheck
```

Local machine:

```
* UDP: true
* IPv4: yes, 198.51.100.14:62517
* MappingVariesByDestIP: false
* PortMapping:
* Nearest DERP: Dallas
```

The far end, a cloud host at a different provider:

```
* UDP: true
* IPv4: yes, 203.0.113.9:37737
* MappingVariesByDestIP: false
* PortMapping:
* Nearest DERP: New York City
```

Read those two reports carefully, because they are the reason this lab is interesting. `UDP: true` on both. `MappingVariesByDestIP: false` on both, which is the easy NAT case: the mapping a host gets is the same regardless of who it is talking to, which is the condition hole punching is designed for. Two easy NATs with working UDP is the configuration that should produce a direct path.

It did not.

> [!ON-THE-WIRE] `MappingVariesByDestIP` describes mapping behavior, not filtering behavior. A NAT can hand out a stable, endpoint independent mapping and still drop inbound packets from a source it has not seen. Simultaneous probing is supposed to defeat exactly that, since both sides open their filter at the same moment. When two easy NATs still cannot connect, the interesting question moves upstream of the NAT, to whatever sits between them.

### Step 5: eliminate your own machine as the variable

The obvious suspect is the machine you are sitting at. Eliminate it by taking yourself out of the path entirely: ask two remote peers to talk to each other, and see what they choose.

```bash
ssh lab-vm-1 'tailscale ping --c 5 --until-direct=false cloud-1 | tail -3'
```

```
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 2ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 2ms
pong from cloud-1 (100.64.0.29) via DERP(nyc) in 2ms
```

Two remote hosts, neither of them the machine running the census, still relayed. Note the 2ms: both sit near the same relay region, so the relay is fast enough that no user would ever complain. It is still a relay.

That result rules out the local machine as the sole cause and turns a suspicion into a fleet property.

### Step 6: check the far end is not simply firewalled

Before theorizing, check the boring explanation. On a host you control:

```bash
sudo ufw status
ss -lunp | grep 41641
```

```
Status: inactive
UNCONN 0 0 0.0.0.0:41641 0.0.0.0:*
```

No host firewall, and the daemon is listening on all addresses on the documented port. The host is not blocking anything, which pushes the cause upstream of the host, to the provider network.

## What the census found

Stated honestly, including the part that is still open:

1. Every connection in the fleet that was not between two machines on the same LAN was relayed, and stayed relayed.
2. This held across two unrelated hosting providers and held between two remote hosts with the local machine removed from the path.
3. Both sampled endpoints report `UDP: true` and endpoint independent mapping, which is the configuration where direct paths are expected to work.
4. Neither sampled host runs a firewall that would explain it, and the daemon listens on the documented port.
5. Therefore the cause is upstream of the hosts, in one or more provider networks, and identifying it per pair needs evidence this lab does not collect: a packet capture on both ends of a single pair, taken at the same time, to see whether probes leave one side and arrive at the other.

What that means operationally is concrete: every byte between the workstation and every cloud host in this fleet crosses a relay. It works, it has always worked, and it is subject to relay bandwidth limits and an extra network leg. Nobody had noticed, because nothing was broken.

> [!GOTCHA] Resist the urge to end a census with a root cause you cannot evidence. The honest output of this lab is a narrowed problem plus the named next measurement. A confident guess here ("it must be the ISP") would feel like a conclusion and would send the next person down a path nobody has justified.

## What to do with the result

1. If your fleet is mostly relayed and you did not know, that alone is worth the twenty minutes. Latency and throughput to those hosts are worse than they need to be, and a relay outage becomes a fleet outage rather than a degradation.
2. Where the far end is a cloud host whose provider filters inbound UDP, a self hosted relay inside your own infrastructure is the designed answer, and it moves the relay hop from a shared service to hardware you control.
3. Where a host genuinely can accept inbound UDP, opening the documented port and confirming with a fresh census is the cheapest possible fix.
4. Re-run this census after any network change. It is read only, it takes minutes, and it is the difference between believing your tailnet is direct and knowing.

## Cross references

Module 03 explains the mechanism this lab measures, including what each netcheck line implies about the paths a node can form. Module 11 turns these same commands into a symptom driven playbook. The relay stuck drill works a constructed version of exactly this finding, and reading it next is the natural follow on.
