---
slug: both-sides-shouting-neither-hearing
title: Capture both ends at once to find out why a direct path never forms
description: The measurement lab 01 said it needed. Two simultaneous packet captures on a permanently relayed pair, which showed both hosts transmitting probes and neither receiving any, and turned up a NAT the operator did not know was there.
order: 2
disruptive: false
ran: 2026-08-12
words: 2350
sources:
  - id: docs-nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-12
  - id: docs-connection-types
    url: https://tailscale.com/docs/reference/connection-types
    title: Connection types
    checked: 2026-08-12
  - id: docs-firewall-ports
    url: https://tailscale.com/docs/reference/faq/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-12
  - id: docs-derp
    url: https://tailscale.com/docs/features/derp-servers
    title: DERP servers
    checked: 2026-08-12
  - id: docs-peer-relays
    url: https://tailscale.com/docs/features/peer-relay
    title: Peer relays
    checked: 2026-08-12
  - id: docs-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-12
---

## What this lab does

Lab 01 found that an entire tailnet was relayed and could not say why. It ended by naming the measurement that would settle it: capture packets on both ends of one pair at the same time, and see whether the probes each side sends ever arrive at the other. This lab is that measurement.

It is still read only. A packet capture observes; it changes no configuration and breaks no path. It does need root on both machines, which is the only new requirement over lab 01.

The reason this specific measurement is worth the setup is that it collapses a large space of theories into one of four answers, and it does so with evidence rather than inference. Everything before this point in an investigation like this is narrowing. This is the step that decides.

## How to read the result before you run it

Decide in advance what each outcome means, because it stops you from rationalizing whatever you happen to see. Two hosts, A and B. Each capture answers one question: did packets leave, and did packets arrive.

<div class="diagram-wrap">
<svg viewBox="0 0 760 320" role="img" aria-label="A truth table of four outcomes: both sides send and receive means the path works, one side receiving means an asymmetric drop, neither receiving means the drop is in the middle in both directions, and a side that never sends means the local daemon is the problem">
  <title>Four outcomes, decided before the capture runs</title>
  <rect x="20" y="16" width="350" height="130" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="40" y="42" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">both send, both receive</text>
  <text x="40" y="66" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">the path works. if it is still relayed,</text>
  <text x="40" y="84" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">the problem is above the network:</text>
  <text x="40" y="102" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">look at path selection, not delivery</text>

  <rect x="390" y="16" width="350" height="130" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="410" y="42" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">A arrives at B, B never arrives at A</text>
  <text x="410" y="66" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">asymmetric drop. one direction is</text>
  <text x="410" y="84" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">filtered. the side that fails to</text>
  <text x="410" y="102" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">RECEIVE owns the problem</text>

  <rect x="20" y="164" width="350" height="130" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="40" y="190" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">both send, neither receives</text>
  <text x="40" y="214" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">the drop is in the middle, both ways.</text>
  <text x="40" y="232" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">neither host is misconfigured and</text>
  <text x="40" y="250" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">no host side change will fix it</text>
  <text x="40" y="274" fill="var(--diagram-accent)" font-size="11" font-family="var(--font-mono)">this is what the run below found</text>

  <rect x="390" y="164" width="350" height="130" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="410" y="190" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">a side never sends at all</text>
  <text x="410" y="214" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">stop looking at the network. the</text>
  <text x="410" y="232" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">local daemon is not attempting a</text>
  <text x="410" y="250" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">direct path, or a local firewall ate</text>
  <text x="410" y="268" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">it before it reached the wire</text>
</svg>
</div>

> [!FROM-THE-FIELD] Writing this table down before running the capture is the whole discipline. Packet captures are persuasive, and a persuasive tool pointed at a theory you already hold will confirm it. Decide what each result means while you still have no result.

## Run it

### Step 1: pick the pair and learn both public addresses

Pick one pair, not several. A capture of many peers at once produces a file you will not read.

You need the address each host presents to the internet, because that is what the other side aims at and therefore what you filter on.

```bash
tailscale netcheck | grep IPv4
ssh lab-vm-1 'tailscale netcheck | grep IPv4'
```

For the pair under test, the local machine reported `198.51.100.14` and the remote reported `203.0.113.9`.

### Step 2: start both captures at the same time

Both captures must overlap, or you are comparing two different moments and proving nothing. Start them, give them a few seconds of headroom, then trigger the traffic.

Remote, in the background:

```bash
ssh lab-vm-1 'sudo timeout 20 tcpdump -ni any "udp and host 198.51.100.14" \
  -w /tmp/lab02-remote.pcap' &
```

Local:

```bash
sudo timeout 20 tcpdump -ni en0 "udp and host 203.0.113.9" \
  -w /tmp/lab02-local.pcap &
```

Note what the filters say. Each side captures all UDP to or from the other side's public address. That is deliberately wider than port 41641, because if the far side is answering from an unexpected port you want to see it rather than filter it out. A filter that only matches what you expect can only ever confirm you.

### Step 3: force a fresh attempt

```bash
sleep 4
tailscale ping --c 10 --until-direct=false lab-vm-1
```

```
pong from lab-vm-1 (100.64.0.41) via DERP(nyc) in 56ms
pong from lab-vm-1 (100.64.0.41) via DERP(nyc) in 52ms
pong from lab-vm-1 (100.64.0.41) via DERP(nyc) in 95ms
```

Relayed throughout, as expected. The pongs are not the data. The captures are.

### Step 4: read the local capture

```bash
sudo tcpdump -nr /tmp/lab02-local.pcap
```

```
16:30:24.701719 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
16:30:25.489252 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
16:30:25.779617 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
16:30:26.837448 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
16:30:27.895454 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
16:30:28.952941 IP 10.0.0.213.41641 > 203.0.113.9.4844: UDP, length 124
```

Thirteen packets in total, and the source of every single one is the local machine. Confirm that rather than eyeballing it:

```bash
sudo tcpdump -nr /tmp/lab02-local.pcap | awk '{print $3}' | cut -d. -f1-4 | sort | uniq -c
```

```
  13 10.0.0.213
```

One source address, thirteen packets, zero inbound. The local host is trying, repeatedly, and nothing is coming back.

### Step 5: read the remote capture

```bash
ssh lab-vm-1 'sudo tcpdump -nr /tmp/lab02-remote.pcap'
```

```
16:30:25.516855 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
16:30:28.510728 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
16:30:31.553775 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
16:30:34.512342 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
16:30:37.521684 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
16:30:40.516328 eth0  Out IP 10.42.0.42.41641 > 198.51.100.14.3541: UDP, length 124
```

```bash
ssh lab-vm-1 'sudo tcpdump -nr /tmp/lab02-remote.pcap | awk "{print \$3}" | sort | uniq -c'
```

```
  6 Out
```

Six packets, every one of them outbound, zero inbound. The remote host is also trying, and also hearing nothing.

> [!ON-THE-WIRE] Both hosts are aiming at a specific port on the other side, 4844 in one direction and 3541 in the other, and neither of those is 41641. Those are the mapped ports each NAT assigned, discovered through STUN and exchanged through the coordination plane. Seeing them proves endpoint discovery worked and the exchange happened. The machinery ran correctly, all the way up to delivery.

## What the capture proved

Against the table written before the run, this is the bottom left cell. Both sides send, neither receives.

That single result eliminates a list of suspects at once, and each elimination is evidence backed rather than assumed:

1. **Not the local daemon.** It sent thirteen probes. It is attempting a direct path.
2. **Not the remote daemon.** It sent six. Also attempting.
3. **Not endpoint discovery or the coordination plane.** Each side is aiming at a specific mapped port on the other, which means STUN worked and the candidates were exchanged.
4. **Not a host firewall.** Lab 01 had already shown no firewall on the remote host and the daemon listening on the documented port. The capture confirms it from the other direction: packets leave the host cleanly.
5. **Not a one directional filter.** An asymmetric drop would show one side receiving. Neither does.

What remains is the only thing left: the packets are dropped between the two hosts, in both directions, by something neither host controls.

### The thing nobody had noticed

Look again at the source address in the remote capture. It is `10.42.0.42`, on a `/16`. That is a private address, and it is the VPS's own interface address:

```bash
ssh lab-vm-1 'ip -4 addr show eth0 | grep inet'
```

```
inet 10.42.0.42/16 brd 10.42.255.255 scope global eth0
```

The cloud host does not have a public address attached to it. It sits behind its provider's NAT, and the `203.0.113.9` it reports through netcheck is a mapping on that shared NAT, not an address it owns.

That matters because it changes the shape of the problem. This is not one NAT with a host behind it. It is two NATs facing each other, and the far one belongs to a hosting provider and is not configurable by the person running the VPS. Opening a port on the VPS cannot help, because the packets are not reaching the VPS to be filtered.

> [!GOTCHA] `MappingVariesByDestIP: false` in netcheck, which both of these hosts report, is a statement about mapping behavior: the NAT hands out the same mapping regardless of which destination IP you talk to. It is not a statement about filtering behavior, and it is not a promise that an inbound packet from a peer will be delivered. Reading it as "easy NAT, direct paths will work" is the specific mistake this lab was built to correct. Two hosts can both report friendly mapping and still never exchange a packet.

## What to do about it

The honest answer is that no host side change fixes this pair, and recognizing that is the value of the measurement. Options in order of how much control they give you:

1. **Accept the relay.** It works, it is the designed fallback, and for control plane traffic like SSH sessions and web dashboards the latency cost is unremarkable. Know that it is happening and that relay bandwidth limits apply.
2. **Run a relay you control.** A peer relay is a node in your own tailnet that relays for peers when direct paths fail, which moves the hop off shared infrastructure and onto a machine whose capacity and location you choose. This is the designed answer for exactly this situation, and it requires that at least one node in your tailnet is actually reachable.
3. **Change the underlay.** Move a host to a provider or plan that assigns a routable address, or obtain port forwarding on a NAT you control. This is the only route to a genuinely direct path here, and it is a procurement decision rather than a configuration one.

What you should not do is keep tuning host firewalls. The capture already proved that is not where the packets die.

## Reproduce this on your own pair

The technique generalizes to any two hosts that will not connect directly:

1. Get both public addresses from netcheck.
2. Start overlapping captures on both ends filtered to the other side's public address, wider than the port you expect.
3. Force an attempt with `tailscale ping --until-direct=false`.
4. Tally sent versus received on each side, with `awk` rather than by eye.
5. Read the answer off the table at the top of this page, and check the far host's own interface address while you are in there. A private address on a cloud host is a finding by itself.

Clean up the capture files when you are done. They contain your own network's addressing.

## Cross references

Module 03 explains hole punching and what each netcheck field does and does not tell you, which is the theory this lab tests against reality. Module 11 covers the symptom driven version of the same investigation. Lab 01 is the census that produced the question this lab answers. The relay stuck drill is the constructed version of this scenario, and comparing its tidy resolution with this one is instructive: the drill resolves, and the real network did not.
