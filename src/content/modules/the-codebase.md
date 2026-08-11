---
module: 12
slug: the-codebase
title: The codebase
description: A guided tour of the tailscale/tailscale repository for engineers who want to read the source, follow a packet or a login through the code, and build it themselves.
order: 12
words: 5000
sources:
  - id: ts-repo
    url: https://github.com/tailscale/tailscale
    title: tailscale/tailscale repository README
    checked: 2026-08-10
  - id: ts-opensource
    url: https://tailscale.com/opensource
    title: Open source at Tailscale
    checked: 2026-08-10
  - id: ts-how
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works
    checked: 2026-08-10
  - id: ts-nat
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
  - id: pkg-ipnlocal
    url: https://pkg.go.dev/tailscale.com/ipn/ipnlocal
    title: Package ipnlocal documentation
    checked: 2026-08-10
  - id: pkg-magicsock
    url: https://pkg.go.dev/tailscale.com/wgengine/magicsock
    title: Package magicsock documentation
    checked: 2026-08-10
  - id: pkg-tailcfg
    url: https://pkg.go.dev/tailscale.com/tailcfg
    title: Package tailcfg documentation
    checked: 2026-08-10
  - id: pkg-controlclient
    url: https://pkg.go.dev/tailscale.com/control/controlclient
    title: Package controlclient documentation
    checked: 2026-08-10
  - id: pkg-netcheck
    url: https://pkg.go.dev/tailscale.com/net/netcheck
    title: Package netcheck documentation
    checked: 2026-08-10
  - id: pkg-derp
    url: https://pkg.go.dev/tailscale.com/derp
    title: Package derp documentation
    checked: 2026-08-10
  - id: pkg-tsnet
    url: https://pkg.go.dev/tailscale.com/tsnet
    title: Package tsnet documentation
    checked: 2026-08-10
---

## The promise

1. You will be able to open github.com/tailscale/tailscale, name the ten packages that matter, and say what each one owns.
2. You will be able to trace a packet send from an application socket down through wgengine, wireguard-go, and magicsock to the wire, in the source.
3. You will be able to trace a login from `tailscale up` through the LocalAPI, LocalBackend, and controlclient to the coordination server and back.
4. You will be able to take a log line you saw in the field and grep your way back to the exact function that emitted it.
5. You will be able to build `tailscale` and `tailscaled` from source and know why your build says a different version than the packaged one.
6. You will be able to state precisely what is open source, what is proprietary, and where Headscale fits.

## Foundation

You already know the architecture this code implements. Module 00 gave you the shape: a centralized control plane that carries almost no traffic, and a mesh data plane that carries all of it. Module 01 gave you WireGuard: peers identified by public keys, encrypted UDP, a small state machine per peer. Module 03 gave you STUN, hole punching, DERP, and Peer Relays. This module shows you where each of those ideas lives as a Go package.

You also know how to read a packet capture: you follow one flow through layers, and you ignore everything that is not your flow. Reading this codebase works the same way. The repository is large, but the paths through it are few. A packet send touches perhaps five packages. A login touches five others. Once you can walk those two paths, the rest of the tree becomes reference material instead of a wall.

One Go prerequisite, stated plainly: Go programs are built from packages, a goroutine is a cheap concurrent thread of execution, a channel is a typed pipe between goroutines, and a mutex is a lock protecting shared state. That is all the Go theory you need to start. The rest you can learn by reading, and this codebase is unusually readable, because it is the production client Tailscale ships on every platform, not a demo (ts-repo).

## Core content

### The map: what owns what

Here is the ownership map you should hold in your head. Everything else in the repo hangs off one of these.

| Package | Owns |
|---|---|
| `cmd/tailscale` | The CLI binary. A thin client that talks to the daemon over the LocalAPI. |
| `cmd/tailscaled` | The daemon binary. Wires everything together at startup. |
| `ipn`, `ipn/ipnlocal` | LocalBackend: the central state machine, prefs, profiles, the LocalAPI surface (pkg-ipnlocal). |
| `wgengine` | The data plane engine: wraps wireguard-go, the TUN device, the router. |
| `wgengine/magicsock` | NAT traversal: path discovery, endpoint selection, DERP and peer relay integration (pkg-magicsock). |
| `tailcfg` | Wire types shared with the coordination server: Node, MapRequest, MapResponse, DERPMap (pkg-tailcfg). |
| `control/controlclient` | The client side of the control plane conversation: registration, map polling (pkg-controlclient). |
| `net/netcheck` | The probe engine behind `tailscale netcheck`: STUN, DERP latency, NAT classification (pkg-netcheck). |
| `derp`, `derp/derphttp` | The relay protocol: protocol and client code, with the server in a subpackage (pkg-derp). |
| `tsnet` | A whole Tailscale node as an importable Go library (pkg-tsnet). |
| `util/...`, `syncs` | Small utilities and concurrency helpers used everywhere. |

<div class="diagram-wrap">
<svg viewBox="0 0 780 440" role="img" aria-label="Layered map of the tailscale repository: CLI over LocalAPI to LocalBackend, which connects up to controlclient and the control plane, and down through wgengine and magicsock to the network"><title>Package ownership: who talks to whom</title><rect x="20" y="20" width="200" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="120" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="14">cmd/tailscale (CLI)</text><rect x="300" y="20" width="200" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="400" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="14">GUI frontends</text><rect x="540" y="20" width="220" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="650" y="43" text-anchor="middle" fill="var(--diagram-text)" font-size="13">control plane (closed)</text><text x="650" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="12">or Headscale</text><line x1="120" y1="70" x2="120" y2="120" stroke="var(--diagram-accent)" stroke-width="2"/><text x="130" y="105" fill="var(--diagram-text)" font-size="12">LocalAPI socket</text><line x1="400" y1="70" x2="400" y2="120" stroke="var(--diagram-line)"/><rect x="60" y="120" width="440" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/><text x="280" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="14">ipn/ipnlocal: LocalBackend</text><text x="280" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="12">state machine, prefs, profiles</text><rect x="540" y="120" width="220" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="650" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="14">control/controlclient</text><text x="650" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tailcfg types over HTTPS</text><line x1="500" y1="150" x2="540" y2="150" stroke="var(--diagram-line)"/><line x1="650" y1="120" x2="650" y2="70" stroke="var(--diagram-line)"/><line x1="280" y1="180" x2="280" y2="230" stroke="var(--diagram-accent)" stroke-width="2"/><rect x="60" y="230" width="440" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="280" y="255" text-anchor="middle" fill="var(--diagram-text)" font-size="14">wgengine: TUN + router + wireguard-go</text><text x="280" y="275" text-anchor="middle" fill="var(--diagram-text)" font-size="12">encrypt, decrypt, route</text><line x1="280" y1="290" x2="280" y2="330" stroke="var(--diagram-accent)" stroke-width="2"/><rect x="60" y="330" width="440" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="280" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="14">wgengine/magicsock: Conn</text><text x="280" y="375" text-anchor="middle" fill="var(--diagram-text)" font-size="12">path choice: direct, DERP, peer relay</text><rect x="540" y="330" width="220" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="650" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="14">derp/derphttp</text><text x="650" y="375" text-anchor="middle" fill="var(--diagram-text)" font-size="12">relay client</text><line x1="500" y1="360" x2="540" y2="360" stroke="var(--diagram-line)"/><line x1="280" y1="390" x2="280" y2="425" stroke="var(--diagram-line)"/><text x="280" y="437" text-anchor="middle" fill="var(--diagram-text)" font-size="12">UDP to peers</text></svg>
</div>

### Two binaries, one brain: cmd/tailscale and cmd/tailscaled

The analogy: `tailscaled` is the switch, `tailscale` is the console cable. All state, all connections, all keys live in the daemon. The CLI is a stateless remote control that formats requests, sends them to the daemon, and prints the answers.

The mechanism: `cmd/tailscaled` is the long-running daemon that runs on Linux, Windows, macOS, and to varying degrees FreeBSD and OpenBSD (ts-repo). At startup it constructs the engine (wgengine), the control client plumbing, and a `LocalBackend`, then serves the LocalAPI on a local IPC endpoint: a Unix socket such as `/var/run/tailscale/tailscaled.sock` on Linux, a named pipe on Windows. `cmd/tailscale` is the CLI; every subcommand you know (`up`, `status`, `ping`, `netcheck`, `serve`) is a LocalAPI conversation with the daemon. The GUI apps are frontends in exactly the same sense: the ipnlocal docs describe UIs and CLIs collectively as "frontends" that drive LocalBackend through its Backend interface (pkg-ipnlocal).

The failure mode: if you go looking in `cmd/tailscale` for the logic behind a behavior, you will usually find only argument parsing and output formatting. The logic is in the daemon. When investigating "why did `tailscale up` do X," start in ipnlocal, not in the CLI package. The reverse mistake also happens: people patch daemon behavior and are confused that `tailscale status` output did not change, because the formatting they wanted to change lives in the CLI.

### ipn and ipnlocal: the state machine that owns everything

The analogy: LocalBackend is the route processor of the box. Control plane messages come in from one side, data plane events from another, operator commands from a third, and one component reconciles them all into a single coherent state.

The mechanism: the package documentation is unusually direct about this. Package ipnlocal is "the heart of the Tailscale node agent that controls all the other misc pieces," and LocalBackend is "the glue between the major pieces of the Tailscale network software: the cloud control plane (via controlclient), the network data plane (via wgengine), and the user-facing UIs and CLIs" (pkg-ipnlocal). LocalBackend implements the overall state machine: frontends, controlclient, and wgengine feed events in, the machine advances, and advancing generates events back out to zero or more components (pkg-ipnlocal). The states you will meet while reading (defined in the parent `ipn` package) include NeedsLogin, NeedsMachineAuth, Starting, Running, and Stopped; `tailscale status` is essentially a rendering of this state plus the netmap. LocalBackend also owns prefs (the persisted node configuration you edit with `tailscale up` and `tailscale set`), profiles (multiple accounts on one machine), serve config, and certificate fetching (pkg-ipnlocal).

The failure mode: because everything meets here, `ipn/ipnlocal` is the largest and most intertwined part of the tree, and `local.go` is famously long. The failure mode for a reader is drowning: trying to read LocalBackend top to bottom. Do not. Enter it with a question ("what happens when a new netmap arrives?"), find the one event handler that answers it, and leave. The mutex discipline helps you here: LocalBackend guards its state with a single primary mutex, and the code comments mark which methods expect it held. When you see a method suffixed `Locked` or a comment saying "b.mu must be held," that is the codebase telling you the concurrency contract in prose.

> [!HOW-IT-WORKS] The name "ipn" is historical, and it predates the public product. Treat it as a proper noun meaning "the Tailscale node state layer" rather than trying to expand the acronym. The package boundary that matters is ipn (types, prefs, state constants) versus ipn/ipnlocal (the live LocalBackend implementation).

### wgengine: the data plane, and wireguard-go inside it

The analogy: wgengine is the forwarding plane chassis. It holds the TUN interface (the linecard facing the OS), wireguard-go (the crypto ASIC), the router (which programs OS routes and addresses), and magicsock (the uplinks). LocalBackend tells wgengine what the world should look like; wgengine makes the kernel and the crypto agree.

The mechanism: Tailscale's data plane is built on wireguard-go, the userspace Go implementation of WireGuard (ts-how). wgengine constructs the TUN device, hands it to a wireguard-go device instance, and reconfigures that device whenever the netmap changes: peers added, keys rotated, allowed IPs updated. Reconfiguration is the key verb. Where a hand-configured WireGuard install has a static config file, Tailscale rewrites the equivalent configuration continuously from the netmap, which is why the control plane in Module 02 can add a peer to a hundred nodes in seconds.

The failure mode: readers expect to find packet crypto in the Tailscale repo and do not. The crypto lives in the wireguard-go dependency; the Tailscale repo's job is configuration, routing, and transport. If you are stepping through an encryption bug, you will leave `tailscale.com/...` packages and land in WireGuard code. Conversely, filtering is Tailscale's own: the packet filter compiled from ACLs (Module 05) is enforced in the engine layer, so "peer can handshake but packets are dropped" investigations stay inside this repo.

### wgengine/magicsock: the file cluster for NAT traversal

If you read only one package deeply, read this one.

The analogy: magicsock is a policy-routing loopback for WireGuard. WireGuard thinks it has one boring UDP socket. In reality every send passes through a layer that knows every candidate address for the peer, continuously measures which of them work, and rewrites the destination per packet.

The mechanism: the package doc says it precisely: "Package magicsock implements a socket that can change its communication path while in use, actively searching for the best way to communicate" (pkg-magicsock). The central type is `Conn`, which implements wireguard-go's `conn.Bind` interface, replacing the default UDP socket (pkg-magicsock). That is the whole trick: wireguard-go asks its Bind to send an encrypted packet to "the peer," and magicsock decides whether that means a direct IPv4 path, a direct IPv6 path, a DERP relay, or a peer relay. Those options are literally enumerated in the code as `Path` constants: `direct_ipv4`, `direct_ipv6`, `derp`, `peer_relay_ipv4`, `peer_relay_ipv6` (pkg-magicsock; the peer relay paths are the newest addition, generally available in current releases, checked 2026-08-10). Per peer, magicsock keeps an endpoint structure that scores candidate addresses using disco, Tailscale's discovery side protocol: ping and pong probes, plus call-me-maybe messages relayed over DERP to trigger simultaneous hole punching, exactly the mechanism Module 03 described from the outside (ts-nat). `Conn` also owns the DERP client connections and exposes operational levers you have already used from the CLI: `Ping` backs `tailscale ping`, `ReSTUN` re-triggers discovery, `SetNetworkMap` feeds it new peers (pkg-magicsock).

The failure mode: magicsock is where concurrency bites hardest, because it sits between three clocks: WireGuard's send path (hot, per packet), disco timers (periodic), and netmap updates (rare, bursty). State transitions like "we found a better path, switch from DERP to direct" happen while packets are in flight, which is why connections upgrade transparently mid-stream (ts-nat), and also why a reader who ignores the locking comments will misread the code. When you see a field documented as guarded by a mutex, believe it; the bug reports that end up in this package are almost always ordering bugs between those three clocks.

> [!FROM-THE-FIELD] When a field engineer says "it is stuck on DERP," the code question is: what did magicsock's endpoint scoring see? `tailscale ping` prints the path per response and `tailscale status` marks each peer as direct or relayed. Reading the disco logic once makes that output stop being magic: you can name the exact probe exchange that did not complete.

### tailcfg: the treaty documents

The analogy: tailcfg is the BGP RFC of this system: not the routers, just the message formats both sides must agree on.

The mechanism: tailcfg contains the wire protocol types exchanged between nodes and the coordination server: `Node` (a device, its keys, endpoints, and capabilities), `MapRequest` (the node asking for updates), `MapResponse` (the control plane answering with the netmap: peer list, DNS config, DERPMap, packet filter), plus registration types and the capability system (`NodeCapability`, `PeerCapMap`, `CapabilityVersion`) that modern grants ride on (pkg-tailcfg). Almost every type has `Clone` and `View` methods, an immutability pattern: a View is a read-only window over a struct, so the netmap can be shared across goroutines without defensive copying (pkg-tailcfg).

The failure mode: tailcfg evolves by accretion, versioned by `CapabilityVersion` (pkg-tailcfg). Fields are added, never repurposed, and old clients simply do not see new fields. When you read a struct with forty fields and half of them marked optional, you are reading protocol history. The reader's failure is assuming every field is always populated; the writer's failure, in independent implementations like Headscale, is missing a capability gate and sending a field an old client mishandles.

### control/controlclient: the phone line to the mothership

The mechanism, briefly, since Module 02 covered the semantics: controlclient implements the client side of the control plane conversation. The `Direct` type does the raw work: `TryLogin` for registration and auth (returning a login URL when interactive auth is needed), and `PollNetMap`, a long poll that streams netmap updates and hands each one to a NetmapUpdater (pkg-controlclient). The `Auto` type wraps `Direct` with reconnection and state management, and pushes status changes (logged in, auth URL, new netmap) to an Observer, which in practice is LocalBackend (pkg-controlclient). Upward flow goes through setters: `UpdateEndpoints`, `SetNetInfo`, `SetHostinfo`, `SetDiscoPublicKey`, each one telling control something the rest of the mesh needs to know (pkg-controlclient).

The failure mode: it is easy to forget this is the only component that talks to the coordination server, and that everything it learns arrives as a netmap. If some state on the node looks wrong (wrong peers, wrong DNS, wrong filter), the investigation forks exactly here: either the MapResponse was wrong (control side, or ACL policy, Module 05) or the node mishandled a correct MapResponse (client side, ipnlocal or below). Logging the netmap, which the client can do, is the divide and conquer step.

### netcheck, derp, derphttp: the diagnostics and the lifeboat

`net/netcheck` is the probe engine behind `tailscale netcheck`. Its `Client` produces a `Report`: can we send UDP at all, do we have working IPv4 and IPv6, does our STUN mapping vary by destination (the symmetric NAT signature from Module 03), which port mapping protocols (UPnP, NAT-PMP, PCP) answered, latency to every DERP region, and which region is preferred (pkg-netcheck). magicsock consumes these reports to pick a DERP home; you consume them in Module 11 when troubleshooting.

`derp` implements the relay protocol: packets addressed by curve25519 public keys, forwarded blind, as "a last resort" when direct paths fail (pkg-derp). Clients pick a home region by latency and hold a long-lived connection there; regions run meshed nodes that forward to each other so a client on any node in the region is reachable (pkg-derp). `derp/derphttp` is the client transport that runs DERP over HTTP and HTTPS, which is why the lifeboat works even on networks that allow nothing but outbound 443 (pkg-derp). The relay daemon binary is `cmd/derper`, and the server implementation lives in the `derp/derpserver` subpackage beside the protocol code (checked 2026-08-10) (pkg-derp). The relay code is fully open source and self-hostable (ts-opensource).

### tsnet: the node as a library

tsnet packs the entire stack above into an importable package. A `tsnet.Server` embeds a Tailscale node in your Go program: no tailscaled, no root, a userspace TCP/IP stack, state in a directory you choose, and standard `net.Listener` and `net.Conn` values from `Listen` and `Dial` so existing HTTP or gRPC code works unchanged (pkg-tsnet). For a code reader, tsnet has a second use: it is the smallest complete caller of the whole system. Reading how a `tsnet.Server` starts up shows you, in one place, how LocalBackend, the engine, and the control client are assembled, which is much gentler than starting from `cmd/tailscaled`'s platform-conditional main.

### Reading Go for investigation

Three idioms carry most of this codebase.

Goroutines and channels. The daemon is a set of long-lived loops: the map poll loop in controlclient, DERP reader and writer loops per connection in magicsock, timer driven disco probes. Loops receive work over channels and quit when a context is canceled. When you are lost, find the loop: search the package for `for {` and `select {` and you will find the beating heart of most components.

Mutexes. Shared state is guarded by explicit mutexes, usually a field named `mu`, with comments declaring which fields it guards. Methods that require the lock held are suffixed `Locked` by convention. As an investigator you can exploit this: any write to a guarded field outside its lock is a bug worth reporting, and any deadlock report can be triaged by mapping which locks the two stacks hold.

Views and clones. tailcfg types are shared widely, so mutation is controlled through the Clone and View pattern (pkg-tailcfg). If a function takes a `NodeView`, you know without reading further that it cannot corrupt shared state. Use that to prune your search space.

> [!GOTCHA] Grep for log messages by their literal fragments, not what you saw on screen. Log calls are printf style: the line "magicsock: derp-12 connected" comes from a format string containing "derp-%d connected". Strip everything that looks like a number, an IP, a key, or a hostname, then `git grep` the longest remaining literal. If it still does not hit, the line may come from a dependency, most often wireguard-go.

### Following a packet send

Walk one packet from an application on node-a to a peer.

1. The application writes to a socket; the OS routes the flow to the Tailscale interface, per Module 07.
2. wgengine reads the plaintext packet off the TUN device and passes it into the wireguard-go device, after the engine's filter has applied the ACL packet filter.
3. wireguard-go looks up the peer by allowed IPs and encrypts, per Module 01.
4. wireguard-go hands the ciphertext to its Bind to send. The Bind is magicsock's `Conn` (pkg-magicsock).
5. magicsock consults its per-peer endpoint state: if disco has validated a direct path, it sends UDP straight to that ip:port; if not, it writes the packet to the peer's DERP home over derphttp, or uses a peer relay path when one has been established (pkg-magicsock; pkg-derp).
6. In parallel, if the path is still relayed, disco keeps probing, and the connection upgrades to direct transparently when a probe succeeds (ts-nat).

<div class="diagram-wrap">
<svg viewBox="0 0 780 300" role="img" aria-label="Sequence of a packet send: app to TUN to wgengine filter to wireguard-go encryption to magicsock path decision, then either direct UDP or DERP relay"><title>A packet send through the code</title><rect x="15" y="110" width="110" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="70" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="13">app socket</text><line x1="125" y1="133" x2="160" y2="133" stroke="var(--diagram-line)"/><rect x="160" y="110" width="90" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="205" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="13">TUN</text><line x1="250" y1="133" x2="285" y2="133" stroke="var(--diagram-line)"/><rect x="285" y="110" width="130" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="350" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="13">wgengine</text><text x="350" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="11">filter + encrypt</text><line x1="415" y1="133" x2="450" y2="133" stroke="var(--diagram-line)"/><rect x="450" y="100" width="150" height="66" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/><text x="525" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="13">magicsock.Conn</text><text x="525" y="146" text-anchor="middle" fill="var(--diagram-text)" font-size="11">path known?</text><line x1="600" y1="118" x2="655" y2="60" stroke="var(--diagram-accent)" stroke-width="2"/><text x="600" y="70" fill="var(--diagram-text)" font-size="11">yes</text><rect x="655" y="35" width="110" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="710" y="56" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct UDP</text><text x="710" y="72" text-anchor="middle" fill="var(--diagram-text)" font-size="11">to peer ip:port</text><line x1="600" y1="150" x2="655" y2="210" stroke="var(--diagram-line)"/><text x="600" y="200" fill="var(--diagram-text)" font-size="11">no</text><rect x="655" y="200" width="110" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="710" y="221" text-anchor="middle" fill="var(--diagram-text)" font-size="12">derphttp</text><text x="710" y="237" text-anchor="middle" fill="var(--diagram-text)" font-size="11">relay + probe</text><line x1="710" y1="200" x2="710" y2="95" stroke="var(--diagram-accent)" stroke-width="2" stroke-dasharray="5,4"/><text x="620" y="255" fill="var(--diagram-text)" font-size="11">disco upgrade path (dashed)</text></svg>
</div>

### Following a login

Walk `tailscale up` on a fresh node.

1. `cmd/tailscale` sends the request over the LocalAPI socket to the daemon.
2. LocalBackend, in state NeedsLogin, starts an interactive login via its controlclient (pkg-ipnlocal; pkg-controlclient).
3. controlclient's `TryLogin` registers the node key with the coordination server and receives a URL for interactive authentication (pkg-controlclient). The private node key was generated locally and never leaves the machine (ts-how).
4. The status flows back through the Observer to LocalBackend, which notifies the frontend; the CLI prints the URL; the human authenticates with the identity provider, per Module 04.
5. Control admits the node, and `PollNetMap` begins its long poll; the first MapResponse carries the netmap: peers, DNS, DERPMap, packet filter (pkg-controlclient; pkg-tailcfg).
6. LocalBackend advances to Starting, reconfigures wgengine and magicsock with the netmap, DNS and routes get programmed, and the state machine lands in Running (pkg-ipnlocal).

<div class="diagram-wrap">
<svg viewBox="0 0 780 250" role="img" aria-label="Login state flow: NeedsLogin through TryLogin and auth URL to netmap poll, then Starting and Running"><title>Login as a state flow</title><rect x="20" y="90" width="130" height="50" rx="24" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="85" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">NeedsLogin</text><line x1="150" y1="115" x2="195" y2="115" stroke="var(--diagram-line)"/><text x="172" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="10">up</text><rect x="195" y="90" width="130" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="260" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="13">TryLogin</text><text x="260" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="11">register node key</text><line x1="325" y1="115" x2="370" y2="115" stroke="var(--diagram-line)"/><rect x="370" y="90" width="130" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="435" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="13">auth URL</text><text x="435" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="11">human + IdP</text><line x1="500" y1="115" x2="545" y2="115" stroke="var(--diagram-accent)" stroke-width="2"/><text x="522" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="10">admitted</text><rect x="545" y="90" width="130" height="50" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/><text x="610" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="13">PollNetMap</text><text x="610" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="11">first MapResponse</text><line x1="610" y1="140" x2="610" y2="180" stroke="var(--diagram-line)"/><rect x="430" y="180" width="150" height="46" rx="24" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="505" y="208" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Starting</text><line x1="610" y1="203" x2="580" y2="203" stroke="var(--diagram-line)"/><line x1="430" y1="203" x2="360" y2="203" stroke="var(--diagram-accent)" stroke-width="2"/><text x="395" y="193" text-anchor="middle" fill="var(--diagram-text)" font-size="10">engine reconfig</text><rect x="210" y="180" width="150" height="46" rx="24" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/><text x="285" y="208" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Running</text></svg>
</div>

### Building from source

The repository builds like any modern Go project, with one caveat: it tracks the newest Go release aggressively. The README states plainly that the project always requires the latest Go release, currently Go 1.26 (ts-repo, checked 2026-08-10). The quick path is `go install tailscale.com/cmd/tailscale{,d}`; for binaries you intend to distribute or compare against packaged versions, use `./build_dist.sh`, which stamps the version and commit into the binary (ts-repo). The repo also carries a `tool/go` wrapper that fetches the project's pinned toolchain, useful when your distro Go is older than the repo wants.

### What is open, what is not

The core client code, the daemon used across all platforms, is open source; on open platforms (Linux, Android) the full client including GUI is open, while on Windows and macOS the daemon is open and the GUI is proprietary (ts-opensource). The DERP relay servers are open source and self-hostable (ts-opensource). The coordination server is closed source (ts-opensource). Headscale is an independent, community maintained open source coordination server for Tailscale clients; Tailscale employs its lead maintainer so it can support his work, but explicitly does not set Headscale's product direction or manage its community (ts-opensource, checked 2026-08-10). The practical consequence for a code reader: everything in this module is inspectable except the far end of controlclient's HTTPS connection, and tailcfg is your best window into what that far end must be doing.

> [!ON-THE-WIRE] The open and closed halves meet at a single protocol boundary: the tailcfg types serialized between controlclient and the coordination server. That is why Headscale is possible at all. Reimplement the server side of MapRequest and MapResponse faithfully and unmodified official clients will talk to you.

## On the wire

For a codebase module, "on the wire" means what the code shows you at its edges: build output, logs, and the CLI surfaces that map one to one onto packages.

Building and version stamping:

```
$ git clone https://github.com/tailscale/tailscale.git
$ cd tailscale
$ ./build_dist.sh tailscale.com/cmd/tailscaled
$ ./build_dist.sh tailscale.com/cmd/tailscale
$ ./tailscale version
1.102.2
  tailscale commit: 4f8e2c1d...
  go version: go1.26.0
```

Version numbers here are illustrative; the point is that a `build_dist.sh` binary reports a real version and commit, while a bare `go build` binary reports itself as a development build.

The netcheck report, which is a pretty printed `netcheck.Report` (pkg-netcheck):

```
$ tailscale netcheck

Report:
        * UDP: true
        * IPv4: yes, 203.0.113.7:41641
        * IPv6: no, but OS has support
        * MappingVariesByDestIP: false
        * PortMapping: UPnP
        * Nearest DERP: Atlanta
        * DERP latency:
                - atl: 14.2ms  (Atlanta)
                - ord: 27.8ms  (Chicago)
                - nyc: 31.5ms  (New York City)
```

Every field maps to a struct field you can now read: `MappingVariesByDestIP` is the symmetric NAT flag, `PreferredDERP` picks the home region (pkg-netcheck).

Tracing a field log line back to source. Suppose node-a's logs show a DERP home change and you want the emitting code:

```
$ grep -rn "home is now derp-" --include="*.go" .
./wgengine/magicsock/... : c.logf("magicsock: home is now derp-%v (%v)", ...)
```

The literal fragment survives; the `%v` verbs are where your on-screen numbers were interpolated. From the emitting function you read outward: what conditions call it, what lock is held, what state changed just before.

Watching the daemon think, live:

```
$ tailscale debug daemon-logs
```

streams the daemon's log output, where the prefixes you now recognize (`control:`, `magicsock:`, `netcheck:`, `derphttp:`) name the package that spoke.

## Failure modes

1. **Build fails with a Go version error.** Symptom: `go install` complains the module requires a newer Go than your toolchain. The repo tracks the latest Go release (Go 1.26 at the checked date) (ts-repo). Fix: upgrade Go or build with the repo's pinned `tool/go`.
2. **Your build reports the wrong version.** Symptom: a hand-built binary identifies as a development or unstable build and support tooling mistrusts it. Cause: skipping `build_dist.sh`, which embeds version and commit (ts-repo).
3. **You cannot find the GUI code.** Symptom: hours of grepping for the macOS or Windows menu bar logic. Cause: those GUIs are proprietary; only the daemon side is in this repo, while Linux and Android are fully open (ts-opensource).
4. **You cannot find the coordination server.** Symptom: searching the repo for the code that decides who is in the netmap. Cause: the coordination server is closed source (ts-opensource). The observable contract is tailcfg; the open reimplementation is Headscale (ts-opensource; pkg-tailcfg).
5. **Grep for a log line returns nothing.** Symptom: the exact on-screen text has no hits. Cause: printf verbs, or the line originates in a dependency such as wireguard-go. Fix: grep for the longest literal fragment, then repeat inside the dependency checkout.
6. **Misreading concurrent state.** Symptom: your analysis of a magicsock or LocalBackend behavior contradicts what the code "clearly says." Cause: reading a guarded field without tracking which goroutine holds `mu`, in code where disco timers, the send path, and netmap updates run on different clocks. Fix: trace lock acquisition first, logic second.
7. **pkg.go.dev drift.** Symptom: the docs show a type or subpackage layout your checkout does not have (or the reverse). Cause: published docs and your local branch are different commits; the derp server's move into a derpserver subpackage is a live example (checked 2026-08-10) (pkg-derp). Fix: trust the checkout you are reading, at the commit you are reading.
8. **Fixing the wrong binary.** Symptom: you patch `cmd/tailscale`, the behavior does not change. Cause: the logic lives in the daemon behind the LocalAPI, and the CLI is a thin frontend (pkg-ipnlocal). Fix: restate the question as "which side of the LocalAPI socket does this decision live on?" before editing anything.

## Check yourself

**1. A teammate reports that traffic between node-a and node-b is flowing but stuck on a relay, and hands you daemon logs from node-a containing repeated disco ping lines with no pongs. Which packages do you read, in which order, and what are you looking for?**

Answer: Start in `wgengine/magicsock`, because path selection and disco both live there (pkg-magicsock). Find the disco probe loop and the endpoint scoring state for the peer: you are looking for the conditions under which a candidate direct endpoint is promoted to the active path, and confirming that pings are being sent to candidate addresses but pongs never arrive, which is the signature of a hole punch that never completes (ts-nat). Next read the DERP integration in the same package to confirm the relay path is healthy, since traffic is flowing: the peer's DERP home connection via `derp/derphttp` is doing its last resort job (pkg-derp). Then step back one layer: candidate endpoints come from the netmap, so check what endpoints control distributed for node-b, which arrives through `controlclient` in the MapResponse (pkg-controlclient; pkg-tailcfg). If node-b never learned or never published a usable endpoint, the bug is upstream of magicsock. The code reading mirrors the field diagnosis from Module 03: no pongs means the return path is blocked, and the fix is environmental (firewall, symmetric NAT) far more often than it is a code bug.

**2. You want to add a small internal service to the tailnet from a Go program without installing tailscaled on the host. Which package do you use, what does it give you, and what are two limitations to design around?**

Answer: Use `tsnet`. A `tsnet.Server` embeds a complete Tailscale node in the process: it registers with the control plane using an auth key (or logs an interactive auth URL on first run), stores its identity in a directory you specify, and gives you `Listen` and `Dial` returning standard library listener and connection types, so `http.Serve` works unmodified (pkg-tsnet). It needs no root and no daemon because it uses a userspace TCP/IP stack (pkg-tsnet). Two limitations to design around: first, it is a distinct node with its own state directory and identity, not a view of the host's tailscaled, so it gets its own name in the tailnet and its own entry in the admin console, and you must manage that state directory across deploys. Second, because networking is userspace, the process only participates in the tailnet through the listeners and dialers you create from the Server; other processes on the host do not gain tailnet access the way they would with a real tailscaled and TUN interface. For a whole-host agent, you still want tailscaled; tsnet is for the service-in-a-binary case.

**3. During a change window you saw this in a node's logs: "control: mapResponse: 34 peers" followed by DNS behavior changing fleet-wide. Walk the code path that turned that log line into new resolver behavior on every node.**

Answer: The line names its layer: the `control:` prefix points at `controlclient`, whose `PollNetMap` long poll received a MapResponse from the coordination server (pkg-controlclient). The MapResponse is a tailcfg type carrying not just the 34 peers but also the DNSConfig and the DERPMap (pkg-tailcfg). controlclient hands the parsed netmap to its NetmapUpdater, which is LocalBackend: the ipnlocal docs describe exactly this flow, controlclient feeding events into LocalBackend's state machine, which then generates events out to other components (pkg-ipnlocal; pkg-controlclient). LocalBackend reconciles the new DNSConfig against current state and pushes resolver configuration to the platform's DNS manager, the mechanism Module 06 covered from the operator's side, while separately reconfiguring wgengine for any peer changes. The fleet-wide part is the control plane's hub and spoke design doing its job: one policy change at the coordination server becomes one MapResponse per node, and every node runs this same code path independently (ts-how). So the investigation of "why did DNS change" reduces to reading one MapResponse, and the divide is clean: wrong DNSConfig in the response means a control side or admin policy cause; correct DNSConfig mishandled means a client bug in LocalBackend or the DNS manager below it.

## What you now have

1. A package map: CLI and daemon as thin frontend and stateful backend, LocalBackend as the state machine gluing control plane, data plane, and frontends together (pkg-ipnlocal).
2. Two walkable paths through the source: a packet send (TUN, wgengine, wireguard-go, magicsock, wire) and a login (LocalAPI, LocalBackend, controlclient, netmap, Running).
3. The magicsock mental model: a conn.Bind that swaps paths under a running WireGuard session (direct, DERP, or peer relay), with disco probes and DERP as both side channel and fallback (pkg-magicsock; ts-nat).
4. Investigation technique: find the loop, respect the mutex, grep the literal log fragment, trust the checkout over the rendered docs.
5. A working build recipe and the open versus closed boundary, with tailcfg as the treaty line and Headscale as the independent far side (ts-repo; ts-opensource).

## Cross references

- Module 00 The shape of Tailscale: the architecture this repo implements; read it first if the control and data plane split is fuzzy.
- Module 01 WireGuard foundations: wireguard-go is the crypto core wgengine wraps; the peer and allowed IPs model appears here as code.
- Module 02 The control plane: the semantics of the netmap and MapResponse that controlclient and tailcfg implement.
- Module 03 NAT traversal, STUN, DERP, and Peer Relays: the behavior magicsock and netcheck encode; this module is that one with file names.
- Module 04 Identity and auth: the interactive login flow whose client half you traced through controlclient.
- Module 05 Policy: ACLs and grants: policy compiles into the packet filter delivered in the MapResponse and enforced in the engine.
- Module 06 MagicDNS and split DNS: the DNSConfig path from MapResponse through LocalBackend to the OS resolver.
- Module 07 Routing: what wgengine's router programs into the OS.
- Module 08 Exposing services: serve config lives in LocalBackend; tsnet's Funnel listener is the code-level sibling.
- Module 11 Troubleshooting and observability: the field techniques whose emitting code you can now find by grep.
