---
slug: magicsock-guided-read
title: A guided read of magicsock
description: A file by file tour of wgengine/magicsock, the packet conn that hides path selection from WireGuard, with the disco, DERP, and peer relay machinery traced through current source.
track: code-lab
order: 2
words: 3400
sources:
  - id: magicsock-pkg
    url: https://github.com/tailscale/tailscale/tree/main/wgengine/magicsock
    title: tailscale/tailscale wgengine/magicsock package
    checked: 2026-08-10
  - id: magicsock-go
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/magicsock.go
    title: wgengine/magicsock/magicsock.go
    checked: 2026-08-10
  - id: endpoint-go
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/endpoint.go
    title: wgengine/magicsock/endpoint.go
    checked: 2026-08-10
  - id: derp-go
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/derp.go
    title: wgengine/magicsock/derp.go
    checked: 2026-08-10
  - id: relaymanager-go
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/relaymanager.go
    title: wgengine/magicsock/relaymanager.go
    checked: 2026-08-10
  - id: peermap-go
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/peermap.go
    title: wgengine/magicsock/peermap.go
    checked: 2026-08-10
  - id: disco-go
    url: https://github.com/tailscale/tailscale/blob/main/disco/disco.go
    title: tailscale.com/disco package source
    checked: 2026-08-10
  - id: nat-blog
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works (Tailscale blog)
    checked: 2026-08-10
  - id: how-blog
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works (Tailscale blog)
    checked: 2026-08-10
  - id: peer-relays-blog
    url: https://tailscale.com/blog/peer-relays-beta
    title: Introducing Tailscale Peer Relays (Tailscale blog, 2025-10-29)
    checked: 2026-08-10
  - id: derp-kb
    url: https://tailscale.com/docs/reference/derp-servers
    title: DERP servers (Tailscale KB)
    checked: 2026-08-10
---

## What magicsock is, in one sentence

The package comment at the top of `wgengine/magicsock/magicsock.go` says it plainly: magicsock "implements a socket that can change its communication path while in use, actively searching for the best way to communicate" (magicsock-go). Everything else in this module is elaboration on that sentence.

Here is the trick that makes Tailscale feel like magic. WireGuard, as a protocol and as the wireguard-go implementation Tailscale embeds, believes each peer lives at exactly one UDP address. It has no concept of "this peer might be reachable at five addresses, let's race them." Tailscale wants exactly that racing behavior, described end to end in the NAT traversal blog post: probe every candidate path, fall back to a relay instantly, upgrade to direct when a hole punch lands (nat-blog). The resolution is that magicsock implements wireguard-go's `conn.Bind` interface, the abstraction wireguard-go uses to send and receive UDP. WireGuard hands magicsock a packet addressed to what it believes is a single stable endpoint, and magicsock decides, per send, whether those bytes leave via an IPv4 socket, an IPv6 socket, a DERP relay connection, or (since late 2025) a Geneve encapsulated peer relay path. Path selection is invisible to WireGuard by construction.

This guide walks the package as it exists on the `main` branch checked 2026-08-10. The file layout matters because it has drifted from what older writeups describe. The two canonical blog posts predate the current tree by years: how-blog is dated 2020-03-20 and nat-blog 2020-08-21, and neither one names a single source file or even uses the word magicsock. Meanwhile the code that once lived in one giant `magicsock.go` was broken apart in a run of commits on 2023-07-26 titled "factor out endpoint into its own file," "factor out peerMap into separate file," and "factor out more separable parts." Today it reads as `magicsock.go` (the `Conn`, send and receive paths, disco dispatch), `endpoint.go` (per peer state and path selection), `derp.go` (relay integration), `peermap.go` (index structures), and `relaymanager.go` (peer relay path discovery, first landed in May 2025 ahead of the Peer Relays beta) (magicsock-pkg). If you are cross reading an old blog post against the source, expect names and locations to have moved; the mechanisms survived, the file boundaries and line numbers did not.

## The Conn: one socket, many paths

`Conn` is the star. The comment above it reads "A Conn routes UDP packets and actively manages a list of its endpoints" (magicsock-go). Skim the struct definition and you can reconstruct the whole architecture from field names alone:

- `pconn4` and `pconn6`, two `RebindingUDPConn` values, the real IPv4 and IPv6 UDP sockets. "Rebinding" because magicsock can close and reopen them (network changes, sleep and wake) without WireGuard noticing.
- `netChecker`, a `netcheck.Client`, "the prober that discovers local network conditions" (magicsock-go). This is what runs STUN queries against the DERP fleet to learn your public ip:port mappings, the mechanism the NAT traversal post describes as asking a server "here's the ip:port that I saw your UDP packet coming from" (nat-blog).
- `peerMap`, the index of every peer. Its own doc comment calls it "an index of peerInfos by node (WireGuard) key, disco key, and discovered ip:port endpoints"; the struct actually carries four maps, keyed by node key, node ID, `epAddr` (a source address seen on the wire), and disco key (peermap-go).
- `derpMap`, `myDerp`, `activeDerp`: the DERP region catalog from the control plane, your current home region ID (`myDerp`, "0 means none/unknown"), and a map of live DERP connections keyed by region (magicsock-go).
- `relayManager`, which "manages allocation and handshaking" of peer relay endpoints (magicsock-go, relaymanager-go).
- `derpRoute`, a map of "optional alternate routes to use as an optimization instead of contacting a peer via their home DERP connection," remembered when a peer reaches us over some other DERP connection. The field and that comment live in `magicsock.go`; the `derpRoute` type itself is in `derp.go` (magicsock-go, derp-go).

The `conn.Bind` surface is implemented by a small wrapper type `connBind`, and `Conn.Send` carries the comment "Send implements conn.Bind" (magicsock-go). On the receive side, `connBind` registers multiple receive functions with wireguard-go: the IPv4 socket, the IPv6 socket, and `receiveDERP`, which drains a channel fed by DERP reader goroutines (magicsock-go, derp-go). To wireguard-go these are all just packet sources; it neither knows nor cares that one of them is a TCP stream to a relay.

<div class="diagram-wrap">
<svg viewBox="0 0 760 440" role="img" aria-label="Layer diagram showing wireguard-go above the magicsock Conn, which fans out to IPv4 and IPv6 UDP sockets, DERP relay connections, and Geneve encapsulated peer relay paths">
  <title>Where magicsock sits: one Bind above, many paths below</title>
  <rect x="180" y="16" width="400" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="16">wireguard-go device</text>
  <text x="380" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="12">one peer = one conn.Endpoint (a fiction)</text>
  <line x1="380" y1="72" x2="380" y2="108" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="392" y="96" fill="var(--diagram-text)" font-size="12">conn.Bind: Send / receive funcs</text>
  <rect x="80" y="108" width="600" height="140" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="132" text-anchor="middle" fill="var(--diagram-text)" font-size="16">magicsock.Conn</text>
  <rect x="100" y="148" width="130" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="165" y="172" text-anchor="middle" fill="var(--diagram-text)" font-size="12">peerMap</text>
  <rect x="240" y="148" width="130" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="305" y="172" text-anchor="middle" fill="var(--diagram-text)" font-size="12">endpoint (per peer)</text>
  <rect x="380" y="148" width="130" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="445" y="172" text-anchor="middle" fill="var(--diagram-text)" font-size="12">netcheck + STUN</text>
  <rect x="520" y="148" width="140" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="590" y="172" text-anchor="middle" fill="var(--diagram-text)" font-size="12">relayManager</text>
  <text x="380" y="216" text-anchor="middle" fill="var(--diagram-text)" font-size="12">disco: ping / pong / call-me-maybe (never shown to WireGuard)</text>
  <line x1="180" y1="248" x2="180" y2="300" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="380" y1="248" x2="380" y2="300" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="580" y1="248" x2="580" y2="300" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="90" y="300" width="180" height="72" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="180" y="326" text-anchor="middle" fill="var(--diagram-text)" font-size="13">pconn4 / pconn6</text>
  <text x="180" y="346" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct UDP sockets</text>
  <rect x="290" y="300" width="180" height="72" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="326" text-anchor="middle" fill="var(--diagram-text)" font-size="13">activeDerp</text>
  <text x="380" y="346" text-anchor="middle" fill="var(--diagram-text)" font-size="12">DERP over HTTPS/TCP</text>
  <rect x="490" y="300" width="180" height="72" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="580" y="326" text-anchor="middle" fill="var(--diagram-text)" font-size="13">peer relay</text>
  <text x="580" y="346" text-anchor="middle" fill="var(--diagram-text)" font-size="12">UDP + Geneve VNI</text>
  <text x="380" y="404" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-a picks among these per send; wireguard-go never sees the choice</text>
</svg>
</div>

> [!HOW-IT-WORKS]
> How does WireGuard address a peer if the real address keeps changing? Each magicsock `endpoint` carries a `fakeWGAddr`, described in the source as "the UDP address we tell wireguard-go we're using" (endpoint-go). It is a synthetic, never routed address that stays constant for the life of the peer. WireGuard files packets under that fake address; magicsock intercepts them in `Send`, looks up the real `endpoint` object, and picks the actual path at that moment. This single indirection is why a session survives your laptop moving from ethernet to hotspot without a WireGuard rekey or a dropped TCP connection inside the tunnel.

## The endpoint type: one peer, many candidate addresses

Move to `endpoint.go`. The doc comment on `endpoint` states the core inversion: "In wireguard-go and kernel WireGuard there is only one endpoint for a peer, but in Tailscale we distribute a number of possible endpoints for a peer" (endpoint-go). One `endpoint` object exists per peer, and it is simultaneously the `conn.Endpoint` handed to wireguard-go and the state machine that races paths. Its important fields, from current source:

- `publicKey`: the peer's node key, used for WireGuard and for addressing DERP frames.
- `derpAddr`: the peer's DERP home, commented as the "fallback/bootstrap path" that is "non-zero for well-behaved clients" (endpoint-go). It is stored as a fake `netip.AddrPort` whose IP is the DERP magic IP and whose port is the region ID, so DERP destinations flow through the same address plumbing as real ones.
- `bestAddr`: an `addrQuality` (address plus measured latency plus probed MTU), "best non-DERP path; zero if none" (endpoint-go).
- `trustBestAddrUntil`: the expiry time on that best path.
- `endpointState`: a map from each candidate `netip.AddrPort` to its ping history and latency. Candidates arrive from the control plane netmap, from call-me-maybe messages, and from pings we receive.
- `sentPing`: outstanding disco pings by transaction ID, so pongs can be matched to the path they prove.
- `isWireguardOnly` and `relayCapable`: whether the peer is a plain WireGuard device with no disco (path selection degrades to latency picking among static addresses), and whether it can speak the peer relay protocol (endpoint-go).

The decision every data packet flows through is `addrForSendLocked`. Its logic, compressed from source: if `bestAddr` is set and `trustBestAddrUntil` has not passed, return the direct address alone. If the peer is WireGuard only, pick the lowest latency known candidate. Otherwise return both the (expired or missing) UDP address and `derpAddr`, meaning: send via DERP so the packet definitely arrives, optionally also via the stale direct path, and let discovery repair things (endpoint-go). One layer up, `endpoint.send` adds the kicker: whenever the chosen path is not a trusted direct one, it calls `sendDiscoPingsLocked` and, if the peer is relay capable, starts peer relay path discovery (endpoint-go). Discovery is not a background daemon that happens to exist; it is triggered by the very act of sending through a bad path. Traffic heals itself.

<div class="diagram-wrap">
<svg viewBox="0 0 760 470" role="img" aria-label="Decision flow for addrForSendLocked: trusted best address goes direct, WireGuard only peers use lowest latency candidate, otherwise packets go to DERP plus the stale path while disco pings and relay discovery run">
  <title>Per packet path choice in endpoint.addrForSendLocked and endpoint.send</title>
  <rect x="280" y="12" width="200" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="39" text-anchor="middle" fill="var(--diagram-text)" font-size="13">WireGuard calls Send</text>
  <line x1="380" y1="56" x2="380" y2="88" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="240" y="88" width="280" height="48" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="108" text-anchor="middle" fill="var(--diagram-text)" font-size="12">bestAddr set AND now before</text>
  <text x="380" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="12">trustBestAddrUntil ?</text>
  <line x1="240" y1="112" x2="130" y2="180" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="160" y="146" fill="var(--diagram-text)" font-size="12">yes</text>
  <rect x="40" y="180" width="200" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="140" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="13">send direct only</text>
  <text x="140" y="225" text-anchor="middle" fill="var(--diagram-text)" font-size="12">(UDP, maybe via peer relay)</text>
  <line x1="520" y1="112" x2="600" y2="180" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="575" y="146" fill="var(--diagram-text)" font-size="12">no</text>
  <rect x="490" y="180" width="230" height="48" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="605" y="208" text-anchor="middle" fill="var(--diagram-text)" font-size="12">peer is WireGuard only ?</text>
  <line x1="605" y1="228" x2="605" y2="268" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="617" y="252" fill="var(--diagram-text)" font-size="12">yes</text>
  <rect x="490" y="268" width="230" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="605" y="291" text-anchor="middle" fill="var(--diagram-text)" font-size="12">pick lowest latency candidate,</text>
  <text x="605" y="309" text-anchor="middle" fill="var(--diagram-text)" font-size="12">short one second trust window</text>
  <line x1="490" y1="204" x2="380" y2="268" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="415" y="240" fill="var(--diagram-text)" font-size="12">no</text>
  <rect x="230" y="268" width="240" height="72" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="350" y="291" text-anchor="middle" fill="var(--diagram-text)" font-size="12">send to derpAddr (always lands)</text>
  <text x="350" y="309" text-anchor="middle" fill="var(--diagram-text)" font-size="12">plus stale bestAddr if any</text>
  <text x="350" y="327" text-anchor="middle" fill="var(--diagram-text)" font-size="12">packet loss avoided, latency worse</text>
  <line x1="350" y1="340" x2="350" y2="380" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="180" y="380" width="340" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="350" y="403" text-anchor="middle" fill="var(--diagram-text)" font-size="12">side effect in send: fire disco pings to all</text>
  <text x="350" y="421" text-anchor="middle" fill="var(--diagram-text)" font-size="12">candidates + start peer relay discovery</text>
</svg>
</div>

## Disco: how pings and pongs elect a path

Disco is Tailscale's discovery protocol, a small message family living in the `disco` package. Three of its messages carry the classic path discovery: `Ping`, `Pong`, and `CallMeMaybe`. Current source defines nine message types in total, the other six (`BindUDPRelayEndpoint`, `BindUDPRelayEndpointChallenge`, `BindUDPRelayEndpointAnswer`, `CallMeMaybeVia`, `AllocateUDPRelayEndpointRequest`, `AllocateUDPRelayEndpointResponse`) all belonging to the peer relay machinery, so a writeup that lists only three is describing the pre relay world (disco-go). Disco messages ride the same UDP sockets and DERP connections as data, but they are consumed inside magicsock and never surface to wireguard-go. In `receiveIP`, every incoming datagram is classified by `packetLooksLike`: disco packets route to `handleDiscoMessage`, STUN responses go to netcheck, and everything else is presumed WireGuard and passed up (magicsock-go).

> [!ON-THE-WIRE]
> A disco packet is recognizable by its first six bytes: the magic constant `TS💬`, hex `54 53 f0 9f 92 ac`, followed by the sender's public disco key and a nonce (disco-go). The payload is sealed to the peer's disco key, so an on path attacker can see that two nodes are doing path discovery but cannot forge pongs to poison path selection. If you capture traffic on node-a while a session ramps up, you will see these packets interleaved with WireGuard's own handshake initiations on the same ports.

The election cycle works like this, matching what the NAT traversal post describes at design level (nat-blog) but with the current function names:

1. Sending through an untrusted path triggers `sendDiscoPingsLocked`, which pings every plausible candidate in `endpointState` and records each ping in `sentPing` keyed by transaction ID (endpoint-go).
2. If that round actually sent at least one ping and the peer has a DERP home, the same function queues a `CallMeMaybe` through DERP, the "I am about to ping you, ping me back at these addresses" message. The source states its purpose directly: inform the peer "that we've sent so our firewall ports are probably open and now would be a good time for them to connect." It is not gated on whether the pair has ever talked directly before (endpoint-go). `handleCallMeMaybe` on the receiving side merges the advertised endpoints into `endpointState` and zeroes their `lastPing` times "to force sendPingsLocked to send new ones" (endpoint-go). This mutual, near simultaneous pinging is the hole punch: both NATs see outbound traffic first and therefore allow the inbound reply (nat-blog).
3. A peer receiving a ping answers in `Conn.handlePingLocked` with a `Pong` echoing the transaction ID and, crucially, the source ip:port it observed, and it opportunistically records the sender's address mapping in `peerMap` (magicsock-go).
4. The original sender's `handlePongConnLocked` matches the pong to its `sentPing`, computes latency, and then decides promotion: the pong's path becomes `bestAddr` if `betterAddr` says it wins, or unconditionally if the current best is untrusted. When the pong confirms the existing best path, `trustBestAddrUntil` is refreshed (endpoint-go).

`betterAddr` is worth reading in full because it encodes Tailscale's path taste as arithmetic. Direct paths always beat peer relay paths (any address with a Geneve VNI set loses to one without). Then latency is scored as a percentage advantage, with bonus points layered on: loopback addresses get 50 points, link local 30, private addresses 20 (cheaper and more local than public), and IPv6 a 10 point nudge (endpoint-go).

Once a direct path is elected, a heartbeat keeps it warm: every `heartbeatInterval` (3 seconds) `endpoint.heartbeat` pings the current preferred path, and each pong on that same address slides `trustBestAddrUntil` forward by `trustUDPAddrDuration` (6.5 seconds). The heartbeat also retries the full candidate set, but `wantFullPingLocked` suppresses that once the current path is at or under `goodEnoughLatency` (5 milliseconds), and otherwise rate limits it to `upgradeUDPDirectInterval` (1 minute); below the good enough line, magicsock stops shopping. After `sessionActiveTimeout` (45 seconds) with no externally triggered send the heartbeat stops and the peering goes quiet (endpoint-go, magicsock-go: the four constants all live in `magicsock.go`, the logic in `endpoint.go`).

> [!GOTCHA]
> Trust in a direct path lasts 6.5 seconds, barely two heartbeats. This is why a peer that silently stops answering disco (crashed, suspended, firewall state expired) causes traffic to shift back to DERP within seconds, and why `tailscale status` can flicker between showing a direct address and a relay for a marginal path. When a Customer reports "it keeps bouncing between direct and relayed," you are almost always looking at pong loss on the direct path, not a control plane problem: the 3 second heartbeat missed enough replies that the 6.5 second trust window lapsed. Packet capture on the disco ping port pair will settle it.

## DERP inside magicsock

The DERP design story is in the blog: relays "blindly forward already-encrypted traffic," private keys never leave the nodes, and the control plane stays out of the data path entirely (how-blog). Operationally, DERP servers are both the fallback data path and the signaling channel through which disco bootstraps direct connections (derp-kb, nat-blog). The implementation is `derp.go`.

The addressing trick is the part to internalize: a DERP destination is encoded as an ordinary `netip.AddrPort` whose IP is `tailcfg.DerpMagicIPAddr` and whose port is the region ID (derp-go). That is how one code path can hold "this peer's fallback is DERP region 17" in the same field shape as "this peer is at an ip:port," and why `isDERP := addr.Addr() == tailcfg.DerpMagicIPAddr` checks appear throughout `magicsock.go`. The magic IP never touches a wire; `Conn.sendAddr` intercepts it and hands the packet to `derpWriteChanForRegion` instead of a UDP socket.

Each active region connection gets two goroutines: `runDerpReader`, which receives frames and forwards them as `derpReadResult` values into `derpRecvCh`, and `runDerpWriter`, which drains a write channel into the HTTPS/TCP connection (derp-go). On the receive side, `connBind.receiveDERP` is registered with wireguard-go as just another receive function; `processDERPReadResult` labels each incoming frame with a synthetic source of DERP magic IP plus region, looks up the sending peer by the node key the relay authenticated, and hands the still encrypted WireGuard payload up the stack (derp-go). WireGuard decrypts as usual; end to end secrecy never depended on the relay.

Two refinements matter for field debugging. First, `Conn.myDerp` is your home region, chosen by netcheck latency measurements in `maybeSetNearestDERP`, and you keep a persistent connection to it so peers can always reach you there. Second, `derpRoute` records that a given peer recently reached us via some other region's connection; `fallbackDERPRegionForPeer` uses it as a last resort so that even a peer whose netmap entry lacks endpoints can be answered over the DERP path they used to reach us (derp-go, magicsock-go). You can see that last ditch logic directly in `endpoint.send`: no UDP address and no DERP home means try `fallbackDERPRegionForPeer` before giving up with `errNoUDPOrDERP` (endpoint-go).

## Peer relays and the relayManager (2025 and later)

Everything above existed in some form for years. The newest organ in magicsock is the peer relay path, announced as a public beta on 2025-10-29: Customer deployed relay nodes built into the ordinary Tailscale client, preferred above DERP but below direct, with measured throughput the announcement puts at "often multiple orders of magnitude higher than Tailscale's managed DERP fleet" (peer-relays-blog, derp-kb). In the source, this is `relaymanager.go` plus threading through `endpoint.go`, present and active in the code as of the 2026-08-10 checkout; older descriptions of magicsock predate it entirely.

The `relayManager` doc comment defines its job: it "manages allocation, handshaking, and initial probing (disco ping/pong)" of relay server endpoints, running everything in a single `runLoop` goroutine fed by channels so it can be safely invoked while `Conn.mu` or `endpoint.mu` are held (relaymanager-go). Peer relay packets are ordinary UDP prefixed with an 8 byte Geneve header (RFC 8926) carrying a 3 byte virtual network identifier; that is why the address type throughout modern magicsock is `epAddr`, a `netip.AddrPort` plus optional VNI (endpoint-go). `receiveIP` decodes and strips the Geneve header before handing payloads to wireguard-go. Disco messages that arrive Geneve encapsulated get split two ways: `handlePingLocked` bails out early on any ping whose VNI is set and hands it to the relayManager, which is "always responsible for handling (replying) to Geneve-encapsulated [disco.Ping] messages," while a Geneve encapsulated pong is first offered to the endpoints and only forwarded to the relayManager if no endpoint recognizes its transaction ID (magicsock-go).

Path discovery over relays deliberately reuses the disco election: the relayManager allocates a session on a candidate relay, handshakes, then probes it with disco pings, and only when a pong proves the path does `endpoint.udpRelayEndpointReady` consider installing it as `bestAddr` (endpoint-go, relaymanager-go). Because `betterAddr` ranks any VNI bearing path below any direct path, a working peer relay never blocks a later direct upgrade. Relay `epAddr` values are also kept out of `endpointState` on purpose: they are either the current best address or forgotten, with `peerMap.relayEpAddrByNodeKey` capping bookkeeping at one relay address per peer (endpoint-go, peermap-go).

## Where "direct" versus "relay" is actually decided

When someone runs `tailscale status` and asks why a peer shows a relay code instead of an address, the answer is computed in one small function: `endpoint.populatePeerStatus` in `endpoint.go`. Read it and the semantics of the status line stop being folklore (endpoint-go):

- `ps.Relay` is always set to the region code derived from `derpAddr`. Every disco capable peer has this; it means "this is their DERP home," not "traffic is relayed right now."
- `CurAddr`, the direct address in status, is set only when `addrForSendLocked` returns a valid UDP address and no DERP address, meaning the direct path is currently trusted.
- Since the Peer Relays feature (2025), a third case exists: if the chosen address carries a VNI, status reports it as `PeerRelay` instead of `CurAddr` (endpoint-go).

So "relayed" in status is not a stored flag anywhere. It is the live output of the same per packet decision function the data path uses: no trusted `bestAddr` right now means sends are going to DERP, and status shows only the relay. The status line is a window into `addrForSendLocked`.

> [!FROM-THE-FIELD]
> Tracing a "why is node-a relayed to node-b" report through the code, in order: (1) `populatePeerStatus` says the direct address is missing because `addrForSendLocked` has no trusted `bestAddr`. (2) `bestAddr` is only ever mutated through `setBestAddrLocked`, and only two of its callers install a real path: `handlePongConnLocked` for direct paths and `udpRelayEndpointReady` for peer relay paths (the other two callers zero it). So either no pong ever arrived or pongs stopped. (3) Pongs answer pings sent by `sendDiscoPingsLocked`, which iterates `endpointState`, so ask what candidates were in that map: control plane supplied endpoints, call-me-maybe endpoints, and observed sources from `handlePingLocked`. (4) If candidates exist but never pong, you are into NAT and firewall territory: check both sides' netcheck results for hard NAT (endpoint dependent mapping), because that is exactly the case the birthday attack style probing in the NAT traversal design exists to handle, and it does not always win (nat-blog). The client logs narrate steps 2 and 4 for you: every promotion prints a `magicsock: disco: node ... now using <addr>` line, and each `endpoint` keeps a ring buffer of `EndpointChange` events for its bug report output (endpoint-go).

## A reading order that works

The package is about 17,700 lines including tests (roughly 11,000 without them, counted on the 2026-08-10 checkout), so read it with a goal. This sequence front loads the concepts each later file assumes:

1. `magicsock.go`: package comment, `Conn` struct, then `Send` and `receiveIP`. You now know the boundary with wireguard-go and the packet classification on receive (magicsock-go).
2. `endpoint.go`: the `endpoint` struct comment, `addrForSendLocked`, `send`, then `handlePongConnLocked` and `betterAddr`, then the constants block back in `magicsock.go` (`trustUDPAddrDuration`, `heartbeatInterval`, `goodEnoughLatency`, `sessionActiveTimeout`). Those four functions come to roughly 300 lines between them, and they are the entire path election (endpoint-go, magicsock-go).
3. `derp.go`: `derpWriteChanForRegion`, `runDerpReader`, `processDERPReadResult`, and the DERP magic IP encoding (derp-go).
4. `peermap.go`: small, and it explains every `c.peerMap.endpointFor...` lookup you saw earlier (peermap-go).
5. `relaymanager.go`: read the type comment and `runLoop` channel list first; the state maps make sense once you accept the single goroutine ownership rule (relaymanager-go).
6. The `disco` package: `disco.go` is one file of message marshaling (the package holds only it, a fuzzer, a pcap helper, and tests), ten minutes, and wire captures become readable (disco-go).

A concrete lab to cement it: bring up two machines, lab-vm-1 behind a deliberately strict NAT and cloud-1 with an open firewall, run traffic, and watch the client logs for the disco lines while toggling the firewall. You will see the exact sequence this guide traced: DERP first, call-me-maybe, ping storms, a `now using` promotion, and, if you break the direct path, a quiet fall back to the relay within one trust window.

## Cross references

- Module 01 for the WireGuard model magicsock wraps: one peer, one endpoint, and why the protocol itself never renegotiates paths.
- Module 02 for how the netmap that seeds `endpointState` and `derpAddr` reaches the client.
- Module 03 for the operator level view of STUN, DERP, and Peer Relays that this module grounds in source.
- Module 11 for turning this reading into diagnosis: netcheck output, status fields, and log lines in practice.
- Module 12 for the wider repo map around wgengine and where magicsock sits in the build.
