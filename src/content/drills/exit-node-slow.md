---
slug: exit-node-slow
title: Everything through the exit node crawls at 2 Mbps
description: Direct tailnet traffic is fast, but the moment the exit node comes on all internet traffic collapses, because the path to the exit node is relayed through a DERP region on the other side of the planet.
area: routing
difficulty: 2
symptom: "The exit node makes my internet unusable, but Tailscale transfers to my other machines run at full speed. The exit node box must be broken."
words: 1450
sources:
  - id: kb-exit-nodes
    url: https://tailscale.com/kb/1103/exit-nodes
    title: Exit nodes (route all traffic)
    checked: 2026-08-10
  - id: kb-derp
    url: https://tailscale.com/kb/1232/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: kb-peer-relays
    url: https://tailscale.com/docs/features/peer-relay
    title: Tailscale Peer Relays
    checked: 2026-08-10
  - id: kb-connection-types
    url: https://tailscale.com/kb/1257/connection-types
    title: Connection types
    checked: 2026-08-10
  - id: kb-firewall-ports
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: changelog
    url: https://tailscale.com/changelog
    title: Tailscale changelog
    checked: 2026-08-10
---

## The ticket

The Customer runs a distributed engineering team. Their egress node, cloud-1, sits inside the Singapore office network so that traffic to regional services leaves from an office IP. The Customer's laptop, node-a, is on the US East coast. This week every browser tab through the exit node is unusable: speed tests read 2 Mbps down, video calls drop. But a large file copy from node-a to node-b, a Linux box on the same tailnet, runs near line rate. The Customer has concluded the exit node host is faulty and wants it rebuilt today.

> "Tailscale itself is clearly fine, my transfers to node-b are fast. Something is wrong with the exit node machine. Can you rebuild it this afternoon?"

## Evidence provided

The first responder collected status, a path check, and a throughput number before touching anything.

```
$ tailscale status
100.64.0.11   node-a       ops@       macOS   -
100.64.0.42   cloud-1      tag:exit   linux   active; exit node; relay "sin", tx 8114224 rx 71982416
100.64.0.17   node-b       ops@       linux   active; direct 203.0.113.88:41641, tx 992216 rx 1114328
```

```
$ tailscale ping cloud-1
pong from cloud-1 (100.64.0.42) via DERP(sin) in 243ms
pong from cloud-1 (100.64.0.42) via DERP(sin) in 239ms
pong from cloud-1 (100.64.0.42) via DERP(sin) in 244ms

$ tailscale ping node-b
pong from node-b (100.64.0.17) via 203.0.113.88:41641 in 12ms
```

```
$ curl -s https://speed.example.net/api | jq .download_mbps
2.1
```

The two status lines already tell most of the story. Per the connection types documentation (kb-connection-types), "direct" plus an IP and port means a real UDP path; "relay" plus a region code means every packet is riding a DERP server. node-b is direct. cloud-1, the exit node, is relayed through the Singapore DERP region.

## Hypothesis tree

Three explanations fit "internet slow through exit node, tailnet fast to another peer." They make different predictions, so cheap checks separate them.

<div class="diagram-wrap">
<svg viewBox="0 0 760 330" role="img" aria-label="Hypothesis tree for slow exit node traffic"><title>Hypothesis tree: slow exit node traffic</title><rect x="230" y="12" width="300" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="32" text-anchor="middle" fill="var(--diagram-text)" font-size="13">All traffic via exit node caps at 2 Mbps</text><text x="380" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="11">(peer traffic to node-b is fast)</text><line x1="380" y1="58" x2="130" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="380" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="630" y2="120" stroke="var(--diagram-line)"/><rect x="20" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">A. Exit node host saturated</text><text x="130" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">CPU, NIC, or provider cap</text><rect x="270" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="380" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">B. Path to exit node is</text><text x="380" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">DERP relayed, not direct</text><rect x="520" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="630" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">C. DNS or MTU pathology</text><text x="630" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">pages feel slow, bandwidth fine</text><line x1="130" y1="184" x2="130" y2="224" stroke="var(--diagram-line)"/><line x1="380" y1="184" x2="380" y2="224" stroke="var(--diagram-line)"/><line x1="630" y1="184" x2="630" y2="224" stroke="var(--diagram-line)"/><rect x="20" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: iperf3 from</text><text x="130" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">lab-vm-1 on the same LAN;</text><text x="130" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">host CPU and NIC metrics</text><rect x="270" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="380" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: tailscale status</text><text x="380" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">shows relay vs direct;</text><text x="380" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tailscale ping never upgrades</text><rect x="520" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="630" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: raw iperf3 by IP</text><text x="630" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">still reads 2 Mbps, so it is</text><text x="630" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">bandwidth, not name lookup</text></svg>
</div>

Branch B carries the accent because the evidence already leans that way: the status line says relay "sin" for cloud-1 and direct for node-b.

## Investigation

1. **Compare the two peer paths in `tailscale status`.** cloud-1 shows `relay "sin"`; node-b shows `direct 203.0.113.88:41641`. This rules out the Customer's core assumption that "Tailscale is fine" as a single statement. Tailscale maintains a separate path per peer; one peer being direct proves nothing about another (kb-connection-types).

2. **Run `tailscale ping cloud-1` and let it finish.** By default the command stops after ten pings or once a direct, non-DERP path has been established, whichever comes first. It runs all ten, and every pong reports `via DERP(sin)` at roughly 240 ms. This rules out a transient blip: direct path establishment to this specific peer is failing continuously, which is exactly the condition where Tailscale falls back to relaying (kb-derp).

3. **`tailscale netcheck` on node-a.** UDP true, a public IPv4 mapping, nearest DERP New York City at 18 ms, Singapore at 242 ms. This rules out the laptop side: node-a can do UDP and is nowhere near Singapore. The DERP region in the status line belongs to the far end.

4. **`tailscale netcheck` on cloud-1** (over the tailnet, which still works, just slowly):

    ```
    Report:
        * Time: 2026-08-10 22:11:03.482119+08:00
        * UDP: true
        * IPv4: yes, 198.51.100.190:61712
        * IPv6: no, but OS has support
        * MappingVariesByDestIP: true
        * PortMapping:
        * Nearest DERP: Singapore
        * DERP latency:
            - sin: 3.9ms    (Singapore)
            - hkg: 38.1ms   (Hong Kong)
            - tok: 71.4ms   (Tokyo)
    ```

    `MappingVariesByDestIP: true` means the office edge is a hard NAT that gives every destination a different source mapping, and the empty `PortMapping` line means no NAT-PMP or UPnP escape hatch exists. This rules out a DERP outage or a Tailscale infrastructure problem: relaying here is the documented, expected fallback when a direct connection is not possible (kb-derp). The office firewall is the mechanism.

5. **Throughput cross-check.** iperf3 from node-a to cloud-1 over the tailnet reads about 2 Mbps, matching the exit node experience exactly. iperf3 from lab-vm-1, sitting on the same office LAN as cloud-1, to an internet target reads several hundred Mbps. This rules out hypothesis A (host or provider throttle) and hypothesis C (DNS): the ceiling follows the tailnet path to cloud-1, not the host or name resolution.

## Root cause

Routing all traffic through an exit node means you are "effectively using default routes (`0.0.0.0/0`, `::/0`)" pointed at that peer, "similar to how you would if you were using a typical VPN" (kb-exit-nodes). That is the whole feature. There is no separate exit node transport: the traffic rides the exact same WireGuard peer connection that `tailscale status` shows for cloud-1, chosen by the same NAT traversal machinery covered in Module 03. So the rule is brutal and simple: if the path to the exit node is relayed, then ALL internet traffic is relayed.

Here the office edge in Singapore is a hard NAT with no port mapping protocol, so node-a and cloud-1 never establish a direct UDP path and fall back to DERP (kb-derp). The geometry then doubles the damage: node-a delivers packets via the Singapore DERP region, so a request for a US website travels US to Singapore relay, Singapore relay to the office, office back out across the Pacific to the US site, and the reply retraces all of it. Relays are a correctness fallback, not a performance path: "direct connections usually provide the lowest latency and highest throughput, while relayed connections are a fallback" (kb-connection-types). At 240 ms of added RTT on a shared relay, 2 Mbps is a normal result. This is Module 07 routing behavior explained by Module 03 path selection.

> [!HOW-IT-WORKS]
> DERP relaying does not weaken security, only performance. Traffic through DERP stays encrypted end to end; because "Tailscale private keys never leave the local device that generated them, it's impossible for a DERP server to decrypt your traffic" (kb-derp). Data connections to the DERP relays use HTTPS on port 443 (kb-firewall-ports), which is why the fallback works on networks that block almost everything else, and why it is never fast.

## Fix and prevention

**Immediate.** Make the direct path possible from the exit node's side: allow inbound UDP to cloud-1's WireGuard port on the office firewall, or enable NAT-PMP on the edge so `PortMapping` stops coming back empty. Verify with `tailscale ping cloud-1` until pongs report a real `ip:port` instead of `via DERP(sin)`, then re-run the throughput test through the exit node.

**Durable.** If the office edge cannot be opened, deploy a Tailscale peer relay on lab-vm-1 in the same office (kb-peer-relays). Peer relays reached general availability in February 2026 (changelog) and require "Tailscale version 1.86 or later" on the relay device and on the devices using it (kb-peer-relays). Use `tailscale set` with the `--relay-server-port` option to pick the UDP port, for example `tailscale set --relay-server-port=40000`, open that single UDP port, and add the grant:

```json
{
  "grants": [{
    "src": ["*"],
    "dst": ["tag:exit"],
    "app": {"tailscale.com/cap/relay": []}
  }]
}
```

Clients try direct first, then peer relays, then DERP (kb-derp), and a peer relay in the same building as the exit node removes the trans-Pacific detour. Confirm with `tailscale status | grep peer-relay` (kb-peer-relays). Finally, ask what the exit node is for: if the goal was privacy rather than a Singapore egress IP, an exit node in the Customer's own region ends the mismatch entirely.

> [!FROM-THE-FIELD]
> Add "exit node path type" to routine health checks. A relayed exit node is silently degraded for every user behind it, and nobody files a ticket that says "my path changed from direct to relay." They file "the internet is slow," weeks later.

## The handoff package

Not escalated (resolved in support), but as filed it would read:

- **Summary:** Exit node traffic via cloud-1 capped near 2 Mbps; path node-a to cloud-1 is DERP relayed (region sin) due to hard NAT at office edge; peer paths elsewhere direct and fast.
- **Repro:** `tailscale set --exit-node=cloud-1` on any US client, run any speed test; `tailscale ping cloud-1` stays `via DERP(sin)`.
- **Log evidence:** node-a status 2026-08-10 14:02 UTC shows `cloud-1 ... relay "sin"`; netcheck on cloud-1 14:11 UTC shows `MappingVariesByDestIP: true`, `PortMapping:` empty. Node IDs: node-a 100.64.0.11, cloud-1 100.64.0.42.
- **Version matrix:** node-a macOS client 1.88.1; cloud-1 Linux 1.88.1; node-b Linux 1.86.4.
- **Impact scope:** all users selecting cloud-1 as exit node; peer-to-peer traffic unaffected.
- **Ruled out:** exit node host saturation (LAN iperf3 fast, low CPU), DNS and MTU (raw iperf3 by IP shows same 2 Mbps ceiling), DERP outage (relay works, it is just slow by design), client-side NAT (node-a netcheck clean).
- **Proposed owning area:** Customer network configuration; no product defect.

## The trap

The weak investigation accepts the Customer's framing: "tailnet is fast, therefore the exit node machine is broken," and rebuilds cloud-1. The rebuild changes nothing, because the office NAT is untouched, and now the ticket carries a failed fix and a Customer who watched hours of work produce zero improvement. The tell was sitting in the very first `tailscale status`: two peers, two different path types. Per-peer path inspection costs ten seconds. Skipping it costs a rebuild, and it also misses the real lesson of Module 03: fast traffic to one peer is never evidence about the path to another.
