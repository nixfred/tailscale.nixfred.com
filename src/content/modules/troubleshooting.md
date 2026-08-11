---
module: 11
slug: troubleshooting
title: Troubleshooting and observability
description: How to read tailscale status, ping, netcheck, bugreport, client logs, and metrics, and a symptom-driven playbook for the six ways a tailnet visibly breaks.
order: 11
words: 4600
sources:
  - id: ts-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: ts-logging
    url: https://tailscale.com/docs/features/logging
    title: Logging overview
    checked: 2026-08-10
  - id: ts-client-metrics
    url: https://tailscale.com/kb/1482/client-metrics
    title: Tailscale client metrics
    checked: 2026-08-10
  - id: ts-key-expiry
    url: https://tailscale.com/kb/1028/key-expiry
    title: Key expiry
    checked: 2026-08-10
  - id: ts-quad100
    url: https://tailscale.com/kb/1381/what-is-quad100
    title: What is 100.100.100.100?
    checked: 2026-08-10
  - id: ts-firewall
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: ts-peer-relays
    url: https://tailscale.com/kb/1591/peer-relays
    title: Peer relays
    checked: 2026-08-10
---

## The promise

1. You will be able to read every column of `tailscale status` and state, from the last column alone, whether a peer path is direct, relayed, or has never carried traffic.
2. You will be able to run `tailscale ping` and explain what each stage of its output proves and, more importantly, what it rules out.
3. You will be able to dissect a full `tailscale netcheck` report field by field and translate it into a statement about your NAT, your firewall, and your likely path quality.
4. You will be able to capture evidence correctly: `tailscale bugreport` markers, per-OS client logs, and the local metrics endpoint.
5. You will be able to triage the six classic tailnet failure symptoms with a fixed three-command opening move for each, so you stop guessing and start eliminating.
6. You will be able to wire client metrics into Prometheus and know which gauges predict trouble before users report it.

## Foundation

You already know how to troubleshoot a conventional network: check link, check IP, check route, check firewall, check DNS, in that order, because each layer depends on the one below it. You know that a good diagnostic tool does not just say "broken"; it splits the search space in half. `traceroute` is useful because each hop that answers eliminates everything before it as the culprit.

Tailscale gives you the same layered discipline, but the layers are different. Below the WireGuard tunnel there is a control plane (did this node authenticate, does it have a fresh netmap), a NAT traversal layer (can these two nodes reach each other directly, or only through a relay), and a DNS layer (MagicDNS, served from a device-local resolver at 100.100.100.100, called Quad100). Each layer has its own dedicated instrument, and each instrument answers exactly one question. The whole craft of Tailscale troubleshooting is knowing which question to ask first.

One habit to carry over from conventional networking: the difference between "no connectivity" and "degraded connectivity" is diagnostic gold. In Tailscale terms, a peer you reach only through a relay is degraded, not broken, and the tools tell you which one you have if you know where to look.

## Core content

### tailscale status: the tailnet at a glance

The analogy: `tailscale status` is the `show ip bgp summary` of your tailnet. One line per peer, and the last column is the peer's session state, the thing you actually care about.

The mechanism: each line prints, left to right, the peer's Tailscale IP (100.x.y.z), its machine name (the same name MagicDNS resolves), the owner's email, the OS, and the connection state. The state column has a small vocabulary worth memorizing:

- `-` means no traffic has ever been exchanged with that peer from this node. Not an error. A tailnet is a mesh of possible tunnels, and tunnels are only established when traffic wants to flow.
- `idle` means traffic flowed at some point but nothing is moving now; cumulative `tx`/`rx` byte counters are shown.
- `active; direct <ip>:<port>` means traffic is flowing over a point-to-point path, and the printed IP and port are the peer's real underlay endpoint that NAT traversal discovered.
- `active; relay "<code>"` means traffic is flowing but through a DERP relay, identified by a city code such as `nyc`, `fra`, or `tok`. Everything works, at relay latency and relay throughput.
- `active; peer-relay` means traffic is flowing through a peer relay (a node in your own tailnet acting as a UDP relay for connections that cannot go direct), shown with the relay's IP, UDP port, and a VNI. Peer relays require Tailscale v1.86 or later on both the relay and the clients and are generally available; older clients never print this state (checked 2026-08-10).

Useful flags: `--json` for machine-readable output (this is what you script against, with the caveat that the docs mark the JSON format as subject to change), `--active` to filter to peers with live sessions, `--peers=false` to see only the local node, and `--self` to control whether your own line appears. Column headers are off by default; `--header` turns them on.

The failure mode of the tool itself: `tailscale status` reads state from the local `tailscaled` daemon. If the CLI cannot reach the daemon at all, no diagnosis of peers is possible yet; your problem is on this machine, not in the network. Fix the daemon first (on Linux, `systemctl status tailscaled` and the journal).

> [!GOTCHA] "relay" in the status column is not an error state, and treating it as one wastes hours. A relayed peer has working, encrypted, end-to-end connectivity. The correct response to `relay` is a performance investigation (why did NAT traversal fail), not a connectivity investigation. The correct response to `-` is often nothing at all: send one packet and look again.

### tailscale ping: a layered proof, not a latency toy

The analogy: `tailscale ping` is a court proceeding with two witnesses. The DERP relay testifies first ("I can carry packets between these two nodes"), which proves both ends are alive and keyed correctly. Then the direct path testifies ("we found each other's real address"), which proves NAT traversal succeeded. Regular `ping` gives you one bit; `tailscale ping` gives you a transcript.

The mechanism: `tailscale ping <host-or-ip>` sends Tailscale disco pings at the Tailscale layer, below the OS network stack of the peer. The first responses typically come back `via DERP(<region>)` because the relay path is always available the moment both nodes hold each other's keys. In the background, the two nodes exchange candidate endpoints and attempt UDP hole punching. When a direct path is established, output switches to `via <ip>:<port>` and, because `--until-direct` defaults to true, the command stops: it has proven the best case. By default it sends at most 10 pings (`-c 10`) and waits up to 5 seconds per ping (`--timeout`).

Each hop of the output proves something specific:

- Any reply at all, even via DERP: the peer is online, its key is valid, your control plane view of it is current, and WireGuard crypto works both ways. This single fact eliminates auth, expiry, and "is it even on" from your search space.
- Reply via DERP but never direct: both ends are fine; the middle is hostile. Now you investigate NAT types and firewalls with `netcheck`, not authentication.
- Reply direct: the tunnel is as good as it gets. If the application is still slow or broken, the problem is above Tailscale (MTU, application, host firewall on the service port).
- No reply at all: the peer is offline, expired, blocked by ACL for this probe path, or your own client cannot reach even a relay. Escalate to `netcheck` locally.

Variants matter because they test different layers of the receiving host: default disco pings terminate inside tailscaled itself, `--tsmp` tests through WireGuard but not either host's OS stack, `--icmp` sends ICMP through the WireGuard tunnel (but not through the local host's OS stack), and `--peerapi` performs an HTTP check against the peer's PeerAPI server. The practical use: when `tailscale ping` succeeds but `ping 100.x.y.z` from the OS fails, the tunnel is fine and the packet is dying inside the peer's OS (host firewall, routing), a distinction that instantly halves your search.

> [!HOW-IT-WORKS] The reason DERP answers first is architectural, not incidental. Every node keeps an authenticated connection to its home DERP region as part of normal operation, so the relay path exists before any probe. Direct paths are discovered lazily via endpoint exchange and simultaneous UDP transmissions. `tailscale ping` simply makes this ordinary upgrade sequence visible and timed.

<svg viewBox="0 0 760 300" role="img" aria-label="Sequence of tailscale ping: first replies via DERP relay, then path upgrades to direct UDP">
  <title>tailscale ping path upgrade sequence</title>
  <rect x="20" y="20" width="120" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="80" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a</text>
  <rect x="320" y="20" width="120" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="14">DERP nyc</text>
  <rect x="620" y="20" width="120" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="680" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b</text>
  <line x1="80" y1="60" x2="80" y2="280" stroke="var(--diagram-line)"/>
  <line x1="380" y1="60" x2="380" y2="280" stroke="var(--diagram-line)"/>
  <line x1="680" y1="60" x2="680" y2="280" stroke="var(--diagram-line)"/>
  <line x1="80" y1="90" x2="380" y2="90" stroke="var(--diagram-line)"/>
  <line x1="380" y1="100" x2="680" y2="100" stroke="var(--diagram-line)"/>
  <text x="230" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ping 1 via relay</text>
  <line x1="680" y1="120" x2="380" y2="120" stroke="var(--diagram-line)"/>
  <line x1="380" y1="130" x2="80" y2="130" stroke="var(--diagram-line)"/>
  <text x="230" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="12">pong via DERP(nyc)</text>
  <line x1="80" y1="180" x2="680" y2="190" stroke="var(--diagram-accent)"/>
  <line x1="680" y1="200" x2="80" y2="210" stroke="var(--diagram-accent)"/>
  <text x="380" y="176" text-anchor="middle" fill="var(--diagram-text)" font-size="12">endpoint exchange + UDP probes</text>
  <line x1="80" y1="245" x2="680" y2="245" stroke="var(--diagram-accent)"/>
  <text x="380" y="237" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct path: pong via 203.0.113.7:41641</text>
  <text x="380" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="12">--until-direct stops here: best case proven</text>
</svg>

### tailscale netcheck: your side of the story

The analogy: `ping` interrogates a relationship; `netcheck` interrogates you. It is the medical checkup for the local network environment: it never mentions any peer, because it is measuring what any peer would have to work with when trying to reach this node.

The mechanism: `netcheck` probes the DERP infrastructure and prints a report on the local network's properties. Blank fields mean the property could not be measured. The fields, and what each means (field set per the current CLI docs, checked 2026-08-10):

- `UDP`: can this node exchange UDP with the outside world at all. `false` is the single most important line in the whole report: no UDP means no direct paths to anyone; you will live on DERP relays reached over encrypted TCP (HTTPS on port 443). Corporate egress filtering and strict firewalls produce this.
- `IPv4` / `IPv6`: your public addresses as seen from outside, and whether each family works. A node with working IPv6 often gets direct paths even when IPv4 NAT is hopeless, because IPv6 usually has no NAT to traverse.
- `MappingVariesByDestIP`: the NAT fingerprint. `true` means your NAT assigns a different public mapping per destination (the "hard NAT" or symmetric pattern), which defeats classic hole punching. Two nodes that both print `true` here will almost never go direct to each other without a port mapping protocol.
- `PortMapping`: which of UPnP, NAT-PMP, PCP your router offers. Any of these is a get-out-of-jail card for hard NAT: the client can lease a stable public port and hand it to peers.
- `HairPinning`: whether your router can loop traffic between two internal hosts via its own public address. Relevant when two nodes behind the same NAT try to talk using each other's public mapping.
- `Nearest DERP` and `DERP latency`: the lowest-latency relay region, and round-trip times to each region by city code. This is your worst-case latency budget: if the nearest DERP is 80 ms away, every relayed connection carries at least that tax.

Flags: `--every=<duration>` repeats the check on an interval (invaluable for flapping networks), `--format=json` for scripting, `--verbose` for probe-level detail.

The failure mode of the tool: `netcheck` describes the local environment only. A perfect netcheck on node-a proves nothing about node-b, and a direct-path failure is always a property of the pair. Run it on both ends before drawing conclusions, and compare the two `MappingVariesByDestIP` lines side by side.

> [!ON-THE-WIRE] Two easy NATs punch through: each side's mapped port is stable, both learn it via DERP-assisted endpoint exchange, and simultaneous UDP does the rest. One hard NAT plus one easy NAT usually still works, because the easy side's mapping is predictable and the hard side dials out to it. Hard plus hard, with no UPnP, NAT-PMP, or PCP on either side, is the textbook permanent-relay pair.

### tailscale bugreport: evidence with a timestamp

The analogy: a bugreport marker is the evidence bag label, not the evidence. The logs are already being collected continuously; the marker is a serialized tag dropped into the stream so a human at Tailscale can find the exact minute you cared about.

The mechanism: `tailscale bugreport` writes a unique identifier of the form `BUG-<hash>-<timestamp>-<suffix>` into the diagnostic log stream and prints it to you. You paste that identifier into a support conversation; support uses it to locate the surrounding log context without you shipping files around, and the identifier itself contains no personally identifiable information. Two flags change the workflow: `--diagnose` adds verbose system information to the logs at marker time, and `--record` runs the marker workflow in bracket mode: it drops a first marker, pauses while you reproduce the problem, then prints a second identifier when you continue, bracketing the reproduction window precisely. Share both identifiers.

The marker workflow, done properly: run `tailscale bugreport --record`, reproduce the failure while it waits, let it print the closing identifier, and hand over both identifiers. Run it on both ends of a broken pair; a one-sided story is half a story.

The failure mode: running `bugreport` hours after the incident tags the wrong part of the stream, and running it on a node started with `--no-logs-no-support` (or the `TS_NO_LOGS_NO_SUPPORT` environment variable) is pointless, because that setting disables the client log upload the marker is meant to index into.

### Client logs: where the daemon confesses

The daemon logs its own operation and its attempts to contact other nodes. Locations, per the current logging docs (checked 2026-08-10):

- Linux (systemd): `journalctl -u tailscaled`, with the usual journal filters (`--since "1 hour ago"` is the one you will actually use).
- macOS: the client logs through the unified logging system; open Console.app and search for `IPN`. Retroactive capture: `sudo sysdiagnose`, then read `system_logs.logarchive`.
- Windows: log files live under `C:\ProgramData\Tailscale` (more generally `$env:ALLUSERSPROFILE\Tailscale`).
- iOS/tvOS: attach to a Mac, use Console against the device, search `IPN`. Android: `logcat`, filter on the `com.tailscale.ipn` package.

What to grep for: lines about the control connection (map requests), disco/endpoint activity around the failure minute, DNS reconfiguration events, and health warnings. You are rarely reading logs cold; you are reading the two minutes around a timestamp you got from a user or a bugreport marker.

### Client metrics: the tailnet's vital signs

The mechanism: Tailscale v1.78.0 and later expose Prometheus-format metrics on the device-local Quad100 address at `http://100.100.100.100/metrics`, and via `tailscale metrics print` (terminal) or `tailscale metrics write <path>` (drop a file for node exporter's textfile collector). Quad100 is device local: other devices cannot reach your node through 100.100.100.100, and requests to it are answered on the machine itself. To scrape a node from elsewhere on the tailnet, enable the web client (`tailscale set --webclient`) and permit port 5252 in the policy file; to expose on another interface, `tailscale web --readonly --listen <ip>:<port>`.

The metrics worth alerting on:

- `tailscaled_inbound_bytes_total` / `tailscaled_outbound_bytes_total`, labeled by `path` (`direct_ipv4`, `direct_ipv6`, `derp`, `peer_relay_ipv4`, `peer_relay_ipv6`): this is `tailscale status` direct-versus-relay as a time series. A fleet-wide rise in the DERP-path share is a NAT or firewall regression announcing itself before any ticket arrives.
- `tailscaled_health_messages` (gauge, labeled by `type`): nonzero means the client itself believes something is wrong. Alert on it.
- `tailscaled_home_derp_region_id`: a node whose home DERP flaps between regions has an unstable underlay.
- `tailscaled_advertised_routes` versus `tailscaled_approved_routes`: a persistent gap is a subnet router advertising routes an admin never approved, which is Module 7's failure mode expressed as arithmetic.
- `tailscaled_inbound_dropped_packets_total` and its outbound twin, with `reason` labels including `acl`: the observable trace of silent policy drops. Peer relay nodes additionally expose `tailscaled_peer_relay_forwarded_bytes_total`, and clients v1.102.0 and later expose per-service throughput counters for Tailscale Services (`tailscaled_serve_inbound_bytes_total`, labeled by `service`; checked 2026-08-10).

> [!FROM-THE-FIELD] The single highest-value alert from client metrics is the ratio of DERP-path bytes to total bytes per node. Individual relayed pairs are normal life. A node whose relay share jumps from 5 percent to 90 percent overnight had its network environment changed underneath it (new firewall policy, new CGNAT, UDP freshly blocked), and metrics catch it days before a human says "things feel slow."

## On the wire

What the instruments actually print. A healthy status line versus a relayed one:

```
$ tailscale status
100.101.102.103  node-a       user@   linux   -
100.101.102.104  node-b       user@   linux   active; direct 203.0.113.7:41641, tx 1156 rx 1032
100.101.102.105  lab-vm-1     user@   linux   active; relay "nyc", tx 5116 rx 4772
100.101.102.106  cloud-1     user@   linux   idle, tx 19012 rx 18244
```

A ping upgrading from relay to direct, then stopping because `--until-direct` is satisfied:

```
$ tailscale ping node-b
pong from node-b (100.101.102.104) via DERP(nyc) in 42ms
pong from node-b (100.101.102.104) via DERP(nyc) in 41ms
pong from node-b (100.101.102.104) via 203.0.113.7:41641 in 9ms
```

A netcheck from a node behind a hard NAT with no port mapping help, exactly the profile that never goes direct against another hard NAT:

```
$ tailscale netcheck

Report:
    * UDP: true
    * IPv4: yes, 198.51.100.23:60817
    * IPv6: no, but OS has support
    * MappingVariesByDestIP: true
    * PortMapping: 
    * Nearest DERP: New York City
    * DERP latency:
        - nyc: 18.1ms  (New York City)
        - ord: 31.9ms  (Chicago)
        - dfw: 44.0ms  (Dallas)
```

A bugreport marker, ready to paste into a support thread:

```
$ tailscale bugreport
BUG-1b7641a16971a9cd75822c0ed8043fee70ae88cf05c52981dc220eb96a5c49a8-20260810151443Z-fbcd4fd3a4b7ad94
```

And the metrics endpoint, scraped locally:

```
$ curl -s http://100.100.100.100/metrics | grep -E 'derp|health'
tailscaled_home_derp_region_id 1
tailscaled_health_messages{type="warning"} 0
tailscaled_inbound_bytes_total{path="derp"} 41282
tailscaled_inbound_bytes_total{path="direct_ipv4"} 8102394
```

Read that last block as a sentence: this node lives in DERP region 1, has no active health warnings, and moves roughly 200 times more bytes directly than through relays. Healthy.

## Failure modes

The taxonomy. Six symptoms cover nearly every ticket. For each: the first three commands, and what each result rules out. The discipline is always the same: run the three, then decide, never the other way around.

<svg viewBox="0 0 780 360" role="img" aria-label="Triage flow from symptom through three diagnostic commands to isolated layer">
  <title>Symptom triage flow: each command eliminates a layer</title>
  <rect x="20" y="150" width="130" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="85" y="180" text-anchor="middle" fill="var(--diagram-text)" font-size="13">symptom</text>
  <rect x="220" y="40" width="160" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="300" y="63" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tailscale status</text>
  <text x="300" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="11">daemon + control?</text>
  <rect x="220" y="150" width="160" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="300" y="173" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tailscale ping</text>
  <text x="300" y="190" text-anchor="middle" fill="var(--diagram-text)" font-size="11">peer + path?</text>
  <rect x="220" y="260" width="160" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="300" y="283" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tailscale netcheck</text>
  <text x="300" y="300" text-anchor="middle" fill="var(--diagram-text)" font-size="11">local network?</text>
  <line x1="150" y1="165" x2="220" y2="70" stroke="var(--diagram-accent)"/>
  <line x1="150" y1="175" x2="220" y2="175" stroke="var(--diagram-accent)"/>
  <line x1="150" y1="185" x2="220" y2="285" stroke="var(--diagram-accent)"/>
  <rect x="470" y="40" width="280" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="63" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no daemon: fix THIS machine</text>
  <text x="610" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="12">expiry banner: fix auth</text>
  <rect x="470" y="150" width="280" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="173" text-anchor="middle" fill="var(--diagram-text)" font-size="12">DERP pong: peer alive, blame the middle</text>
  <text x="610" y="190" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no pong: peer or ACL</text>
  <rect x="470" y="260" width="280" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="283" text-anchor="middle" fill="var(--diagram-text)" font-size="12">UDP false: relay-only life explained</text>
  <text x="610" y="300" text-anchor="middle" fill="var(--diagram-text)" font-size="12">hard NAT both ends: no direct path</text>
  <line x1="380" y1="65" x2="470" y2="65" stroke="var(--diagram-line)"/>
  <line x1="380" y1="175" x2="470" y2="175" stroke="var(--diagram-line)"/>
  <line x1="380" y1="285" x2="470" y2="285" stroke="var(--diagram-line)"/>
</svg>

1. **Cannot connect at all.** No peer is reachable by name or IP. First three: `tailscale status` (a daemon error or empty peer list means the problem is local: service down, or control plane unreachable; a normal peer list rules out the local daemon), `tailscale ping <peer>` (any pong, even via DERP, rules out auth and crypto and moves the problem to the OS or application layer), `tailscale netcheck` (UDP false plus unreachable DERPs means this network blocks you outright; healthy netcheck rules out the local network and points at the peer's side). Symptom signature in logs: repeated failures to reach the control server.

2. **Connects via relay but never direct.** Everything works; latency and throughput disappoint; `status` says `relay` forever. First three: `tailscale ping --until-direct <peer>` left to run (pongs stay `via DERP(...)`; this rules out the everything-is-fine case where a path upgrade simply had not been triggered yet), `tailscale netcheck` locally (rules the local side in or out: `MappingVariesByDestIP: true` with empty `PortMapping` makes this side half of the explanation), `tailscale netcheck` on the peer (two hard NATs and no port mapping protocol on either side is the complete, closed explanation). Fixes flow from the diagnosis: enable UPnP, NAT-PMP, or PCP on one side, permit outbound UDP sourced from port 41641 (the default WireGuard source port) to any destination or add a static mapping, get IPv6 working on both ends, or deploy a peer relay (a v1.86 or later node in the tailnet, granted the relay capability), which Tailscale tries before falling back to DERP.

3. **Works, then drops.** Sessions die every few minutes, then recover. First three: `tailscale netcheck --every=30s` (a flapping report, UDP toggling or public endpoint changing, convicts the underlay: an aggressive NAT purging mappings, Wi-Fi roaming, a flapping uplink; a rock-steady report rules the underlay out), `tailscale status` during an incident (watch whether the peer falls from `direct` to `relay`: a fall with quick recovery is NAT rebinding; total loss is the daemon or the network), client logs around the drop timestamp (`journalctl -u tailscaled --since "10 minutes ago"` on Linux; look for endpoint changes, home DERP changes, and health warnings, which distinguishes a Tailscale-layer event from an application timeout). If the drop correlates with sleep/wake or VPN coexistence on a desktop OS, capture it with `tailscale bugreport --record` bracketing one reproduction.

4. **DNS resolves wrong or not at all.** `tailscale ping node-b` by bare name works but `ssh node-b` cannot resolve, or public names break the moment Tailscale connects. The bare-name split is the key tell: `tailscale ping` can resolve peer names from the netmap without the OS resolver, so its success plus the OS failure convicts the DNS plumbing, not the tailnet. First three: `tailscale status` (confirms the peer exists under the exact name you typed and rules out a stale or renamed machine), `dig <name> @100.100.100.100` or the OS equivalent (Quad100 answering correctly rules out MagicDNS itself and convicts the OS resolver configuration: resolv.conf ownership fights on Linux are the classic), `tailscale ping <tailscale-ip>` (working by IP while names fail anywhere confirms this is purely a DNS problem and connectivity is intact). If public internet names break instead, the suspect is the tailnet's global nameserver settings or an unreachable split-DNS resolver pushed by the admin.

5. **Auth or key expiry problems.** A node silently vanishes from reachability; often "it worked yesterday and nobody changed anything," which is exactly what expiry looks like, since node keys default to a 180 day lifetime (admins can tune the period from 1 to 180 days; checked 2026-08-10). First three: `tailscale status` on the affected node (the client states when the key has expired or logout is needed; that single line rules out every network explanation), `tailscale ping <peer>` from a healthy node toward it (no pong even via DERP is consistent with expiry, since connections to and from an expired endpoint stop working), then re-authenticate with `tailscale up --force-reauth` (with sudo where needed). Beware the sharp edge: forcing reauth on a machine you can only reach over Tailscale can strand you; the admin console can temporarily extend an expired key for 30 minutes to give the owner a window, and "Disable key expiry" per machine exists for servers. Prevention beats cure: expiry is visible in the admin console long before it fires.

6. **Subnet route not reachable.** Tailnet peers are fine, but 192.0.2.0/24 behind a subnet router is dead. First three: `tailscale ping <subnet-router>` (a pong rules out everything between you and the router node; the failure is at or behind it), `tailscale status --json` on the router (compare advertised routes against what the control plane approved: an advertised-but-unapproved route is an admin console fix, not a networking fix; the metrics pair `tailscaled_advertised_routes` versus `tailscaled_approved_routes` shows the same gap), then on the router check IP forwarding and the far-side path (Linux sysctls `net.ipv4.ip_forward` and the IPv6 equivalent, plus whether the target host's own firewall accepts traffic from the router). Each step moves the fault one hop rightward: you to router, router's authorization, router to target.

> [!GOTCHA] The most commonly skipped step in this whole catalog is running the diagnosis on BOTH ends. Netcheck describes one side. Relay-versus-direct is a property of the pair. A bugreport from one node indexes one node's logs. Any conclusion drawn from a single end of a two-ended problem is a coin flip wearing a lab coat.

## Check yourself

1. A user reports that file transfers between node-a and lab-vm-1 are painfully slow, though everything "works." `tailscale status` on node-a shows `active; relay "fra", tx ... rx ...` for lab-vm-1, and both machines sit in offices with default-deny corporate firewalls. What do you run next, and what outcome would make you stop trying to fix it?

Answer: The status line already tells you connectivity is fine and the path is the problem: traffic is hairpinning through the Frankfurt DERP. Run `tailscale netcheck` on both machines and read three fields on each: `UDP`, `MappingVariesByDestIP`, and `PortMapping`. If either side prints `UDP: false`, that side's firewall blocks UDP entirely and no direct path is possible until the firewall changes; you stop client-side tinkering and take a firewall change request (outbound UDP sourced from port 41641 to any destination) to whoever owns egress. If both sides show `MappingVariesByDestIP: true` with an empty `PortMapping` line, you have the hard-NAT-pair signature: hole punching cannot work and no client setting will change that. The escape hatches are environmental: enable a port mapping protocol on one router, add a static UDP mapping, light up IPv6 on both ends, or deploy a peer relay node in the tailnet, which both clients will try before settling for DERP. If neither condition holds, keep `tailscale ping --until-direct lab-vm-1` running while you watch, because the pair should be able to upgrade and the interesting question becomes why endpoint discovery is failing, which is bugreport territory.

2. At 09:12 a monitoring host loses contact with cloud-1. By 09:20, when you log in, everything works again. The user swears "nothing changed." How do you investigate an outage that is already over, and what would each evidence source contribute?

Answer: This is exactly the situation the passive evidence trail exists for, because the interactive tools only measure the present. Start with client logs on both ends around 09:12: on Linux, `journalctl -u tailscaled --since "09:05" --until "09:25"`. You are looking for one of three signatures: control connection failures (points at upstream internet or control plane), endpoint or home DERP changes (points at NAT rebinding or an underlay flap), or a health warning appearing and clearing. Second, if you scrape client metrics, pull the 09:00 to 09:30 window: a step change in `tailscaled_inbound_bytes_total` by `path` label (direct bytes flatlining while DERP bytes continue) proves the direct path died while relay survived, which is a NAT or firewall event, not a Tailscale outage; `tailscaled_home_derp_region_id` changing value at 09:12 proves the client re-homed, meaning its view of the network changed. Third, if this recurs, arm the next occurrence: `tailscale netcheck --every=30s` logging to a timestamped file on the monitoring host, and teach the user to run `tailscale bugreport --record` during the next incident so support-grade logs are bracketed by both identifiers. The discipline: never accept "nothing changed" and never try to diagnose a past event with a present-tense tool.

3. `tailscale ping node-b` returns pongs via DERP(nyc) in 40 ms, but `ssh 100.101.102.104` times out. Walk the layers: what has the successful tailscale ping already proven, and where can the fault still hide?

Answer: The DERP pong is a strong witness. It proves node-b is powered on, its Tailscale daemon is running, its node key is valid (ruling out expiry), your netmap and its netmap both contain each other (ruling out most control plane issues), and WireGuard encryption succeeds in both directions. That eliminates the entire bottom half of the stack. What it has not proven: that packets can traverse node-b's OS network stack and reach a listening application. Default `tailscale ping` terminates inside tailscaled itself, below the peer's OS stack. So climb deliberately: `tailscale ping --icmp node-b` pushes ICMP through the tunnel toward the OS stack; if that fails while disco pings succeed, the packet dies entering node-b's host networking. Then test the actual service layer: if ICMP works but TCP 22 does not, the fault is node-b's host firewall dropping the SSH port, sshd not listening, or a tailnet ACL that permits ping-level traffic while denying `tcp:22` for your identity (check the policy: ACL denials are silent drops on the wire, though the receiving node counts them in `tailscaled_inbound_dropped_packets_total` with `reason="acl"`). The ordering matters because each probe type is one rung higher in node-b's stack, and the first rung that fails names the culprit's layer exactly.

## What you now have

1. A reading of every `tailscale status` state: `-`, `idle`, `active; direct`, `active; relay`, and `active; peer-relay` (clients v1.86 and later), and the reflex that relay means degraded, not broken.
2. `tailscale ping` as a layered proof: DERP pong eliminates auth and liveness questions, direct pong eliminates NAT traversal, and the `--tsmp` / `--icmp` / `--peerapi` ladder locates faults inside the peer's own stack.
3. The netcheck report as a NAT fingerprint, with `UDP`, `MappingVariesByDestIP`, and `PortMapping` as the three lines that decide whether direct paths are even possible.
4. The evidence workflow: bugreport markers (with `--record` bracketing and both identifiers shared), per-OS log locations (journalctl on Linux, Console/IPN on macOS, `C:\ProgramData\Tailscale` on Windows), and the Quad100 metrics endpoint with `tailscale metrics print` and `write`.
5. A six-symptom taxonomy where every symptom opens with a fixed three-command move, each command eliminating a layer rather than confirming a hunch.

## Cross references

- Module 3 (NAT traversal and DERP) is the theory this module instruments: netcheck's `MappingVariesByDestIP` and the relay-versus-direct distinction are that module's concepts made measurable.
- Module 2 (the control plane and netmaps) explains what a DERP pong silently verifies: key distribution and netmap freshness.
- Module 6 (MagicDNS and Quad100) is the background for symptom 4; the resolver you query with `dig @100.100.100.100` is built there.
- Module 7 (subnet routers and exit nodes) owns the advertised-versus-approved route gap that symptom 6 and the route gauges detect.
- Module 5 (ACLs and policy) matters because an ACL denial is a silent drop; several "network" faults in this module's taxonomy are really policy decisions, and the policy file is where you confirm them.
- Module 10 (enterprise operations) builds on the metrics endpoint introduced here, scaling one node's vital signs into fleet-wide dashboards and alerts.
