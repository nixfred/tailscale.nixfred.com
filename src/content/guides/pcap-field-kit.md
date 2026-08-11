---
slug: pcap-field-kit
title: The packet capture field kit
description: How to capture, filter, and read Tailscale traffic on the wire, from STUN probes and WireGuard handshakes to DERP fallback and path migration.
track: code-lab
order: 4
words: 3600
sources:
  - id: kb-firewall-ports
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: wg-protocol
    url: https://www.wireguard.com/protocol/
    title: WireGuard Protocol and Cryptography
    checked: 2026-08-10
  - id: kb-derp
    url: https://tailscale.com/kb/1232/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: blog-nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: kb-100x
    url: https://tailscale.com/kb/1015/100.x-addresses
    title: What are these 100.x.y.z addresses?
    checked: 2026-08-10
  - id: wg-go-constants
    url: https://github.com/tailscale/wireguard-go/blob/main/device/constants.go
    title: wireguard-go protocol constants, Tailscale fork (device/constants.go)
    checked: 2026-08-10
  - id: wg-go-sizes
    url: https://github.com/tailscale/wireguard-go/blob/main/device/noise-protocol.go
    title: wireguard-go message sizes, Tailscale fork (device/noise-protocol.go)
    checked: 2026-08-10
  - id: ts-geneve-src
    url: https://github.com/tailscale/tailscale/blob/main/net/packet/geneve.go
    title: Tailscale Geneve header implementation (net/packet/geneve.go)
    checked: 2026-08-10
  - id: ts-tailscaled-src
    url: https://github.com/tailscale/tailscale/blob/main/cmd/tailscaled/tailscaled.go
    title: tailscaled flags and default TUN names (cmd/tailscaled/tailscaled.go)
    checked: 2026-08-10
  - id: ts-status-src
    url: https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/status.go
    title: tailscale status output source (cmd/tailscale/cli/status.go)
    checked: 2026-08-10
  - id: wireshark-wg
    url: https://www.wireshark.org/docs/dfref/w/wg.html
    title: Wireshark display filter reference, WireGuard (wg)
    checked: 2026-08-10
---

## The case for packet evidence

Logs tell you what tailscaled believes. A packet capture tells you what actually happened. When a Customer says "it works from the office but not from the hotel," or a node insists it has a direct connection while latency says otherwise, the wire is the only witness that does not have an opinion. This module builds your field kit: what Tailscale traffic looks like on the wire, the tcpdump filters that isolate each traffic family, how to read a connection being born, and how to interpret what you see when the payload is encrypted and always will be.

The kit assumes you can run tcpdump with root privileges on at least one end of a problem connection, and Wireshark somewhere comfortable for offline analysis. Everything here works with stock tools. No plugins, no decryption keys, no magic.

## What Tailscale traffic looks like on the wire

A Tailscale node emits four distinct traffic families, and telling them apart is the first skill. Per the firewall ports documentation, direct WireGuard tunnels use UDP with a source port that defaults to 41641, STUN runs over UDP to port 3478, and connections to the coordination server and DERP relays use HTTPS on port 443 (the coordination server may also prefer port 80 with an encrypted transport, falling back to 443).

So on the physical interface of a healthy node you should expect:

1. **WireGuard UDP.** Peer-to-peer tunnel traffic. Your node's source port defaults to 41641 but is configurable (the daemon takes a `-port` flag, and 0 means pick one automatically), and the port you see for the *remote* peer is whatever its NAT assigned. This is the traffic you want to see, though as the peer relay note below explains, UDP alone does not prove the path is direct.
2. **STUN over UDP to port 3478.** Short request and response pairs to Tailscale's relay fleet. As the NAT traversal write-up puts it, your machine asks "what's my endpoint from your point of view?" and the server replies with the ip:port it saw your UDP packet come from. These recur periodically; they are how the node keeps its public endpoint discovery fresh.
3. **DERP as TLS over TCP 443.** When a direct path is not available, tunnel traffic rides an HTTPS stream to a relay. The relay blindly forwards already encrypted WireGuard traffic; it cannot decrypt anything because private keys never leave the device. On the wire this is indistinguishable from any other long-lived TLS session except by destination.
4. **Control plane HTTPS.** Bursty, small, and boring: key exchanges with the coordination server, netmap updates. Also TCP to 443 (or 80). Easily confused with DERP in a capture, which is exactly why you learn to identify your DERP relay's address first.

> [!ON-THE-WIRE]
> STUN packets are trivially identifiable even without the port: every RFC 5389 STUN message carries the magic cookie `0x2112A442` at byte offset 4 of the UDP payload. Since the UDP header is 8 bytes, that lands at `udp[12:4] = 0x2112a442` in tcpdump terms (IPv4 only, like every `udp[...]` byte test, and it skips fragments). If you see that cookie flying to port 3478 on a dozen different addresses, you are watching a node measure the DERP fleet, which is how it selects its home relay: the client "selects a home DERP server based on latency information and reports its selection to the coordination server."

One more family exists as of 2025: peer relays. The DERP documentation is explicit about the order: "Tailscale first attempts to use any available peer relays in the tailnet. If there aren't any peer relays available, it then falls back to DERP servers." On the wire a peer relay path is UDP addressed to the relay node's ip:port rather than the peer's, but it is not bare WireGuard framing: the client source prefixes each packet with an 8 byte Geneve header (RFC 8926) carrying a virtual network identifier, so the WireGuard type byte sits 8 bytes further into the payload than it does on a direct path. That single fact defeats the byte-shape filter below, and it is the reason not to conclude "direct connection" from the presence of UDP alone. Confirm the far address is actually your peer by comparing against `tailscale status`, which prints each peer as `direct <addr>`, `relay "<region>"`, or `peer-relay <addr>`.

## The four message types, by first byte

WireGuard's wire format is austere. Every message begins with a one-byte type followed by three reserved zero bytes, and there are exactly four types. From the WireGuard protocol specification:

| First byte | Type | Size on the wire | What it means |
|---|---|---|---|
| `0x01` | Handshake initiation | 148 bytes | One side starts a new session: ephemeral key, encrypted static key, encrypted timestamp, two MACs |
| `0x02` | Handshake response | 92 bytes | The other side completes the handshake |
| `0x03` | Cookie reply | 64 bytes | Load or DoS mitigation: prove your IP before I spend crypto cycles on you |
| `0x04` | Transport data | 32 bytes minimum | The tunnel itself: 16 byte header plus encrypted payload plus auth tag |

The sizes fall straight out of the struct definitions on the protocol page (`AEAD_LEN(n)` is `n + 16`, so type 2 works out to 4 + 4 + 4 + 32 + 16 + 16 + 16 = 92) and the wireguard-go fork Tailscale embeds hard-codes the same four numbers as `MessageInitiationSize = 148`, `MessageResponseSize = 92`, `MessageCookieReplySize = 64`, and an empty transport message of 32. They are gloriously constant, which makes them a fingerprint. A 148 byte UDP payload followed shortly by a 92 byte payload in the reverse direction is a WireGuard handshake completing, full stop. A stream of 32 byte type 4 messages with nothing inside is keepalives (empty encrypted payload: header plus tag and nothing else). All multi-byte fields, including the 32 bit receiver index that lets one socket multiplex many peers, are little-endian.

Here is the classification logic as a decision flow:

<div class="diagram-wrap">
<svg viewBox="0 0 780 430" role="img" aria-label="Decision flow for classifying a captured UDP packet as STUN or one of the four WireGuard message types">
  <title>Classifying a UDP packet from a Tailscale node</title>
  <rect x="270" y="16" width="240" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="390" y="43" text-anchor="middle" fill="var(--diagram-text)" font-size="14">UDP packet on physical interface</text>
  <line x1="390" y1="60" x2="390" y2="92" stroke="var(--diagram-line)"/>
  <polygon points="385,90 395,90 390,100" fill="var(--diagram-line)"/>
  <rect x="250" y="100" width="280" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="390" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">port 3478, or magic cookie</text>
  <text x="390" y="137" text-anchor="middle" fill="var(--diagram-text)" font-size="13">udp[12:4] = 0x2112a442 ?</text>
  <line x1="250" y1="122" x2="130" y2="122" stroke="var(--diagram-line)"/>
  <line x1="130" y1="122" x2="130" y2="160" stroke="var(--diagram-line)"/>
  <polygon points="125,158 135,158 130,168" fill="var(--diagram-line)"/>
  <text x="180" y="114" text-anchor="middle" fill="var(--diagram-text)" font-size="12">yes</text>
  <rect x="55" y="168" width="150" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="130" y="195" text-anchor="middle" fill="var(--diagram-text)" font-size="14">STUN probe</text>
  <line x1="390" y1="144" x2="390" y2="180" stroke="var(--diagram-line)"/>
  <polygon points="385,178 395,178 390,188" fill="var(--diagram-line)"/>
  <text x="405" y="166" fill="var(--diagram-text)" font-size="12">no</text>
  <rect x="250" y="188" width="280" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="390" y="208" text-anchor="middle" fill="var(--diagram-text)" font-size="13">first payload byte udp[8] in 1..4</text>
  <text x="390" y="225" text-anchor="middle" fill="var(--diagram-text)" font-size="13">and bytes 9..11 all zero ?</text>
  <line x1="390" y1="232" x2="390" y2="268" stroke="var(--diagram-line)"/>
  <polygon points="385,266 395,266 390,276" fill="var(--diagram-line)"/>
  <text x="405" y="254" fill="var(--diagram-text)" font-size="12">yes: switch on udp[8]</text>
  <rect x="40" y="276" width="160" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="120" y="299" text-anchor="middle" fill="var(--diagram-text)" font-size="13">0x01 initiation</text>
  <text x="120" y="318" text-anchor="middle" fill="var(--diagram-text)" font-size="12">148 bytes</text>
  <rect x="230" y="276" width="160" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="310" y="299" text-anchor="middle" fill="var(--diagram-text)" font-size="13">0x02 response</text>
  <text x="310" y="318" text-anchor="middle" fill="var(--diagram-text)" font-size="12">92 bytes</text>
  <rect x="420" y="276" width="160" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="500" y="299" text-anchor="middle" fill="var(--diagram-text)" font-size="13">0x03 cookie reply</text>
  <text x="500" y="318" text-anchor="middle" fill="var(--diagram-text)" font-size="12">64 bytes</text>
  <rect x="610" y="276" width="160" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="690" y="299" text-anchor="middle" fill="var(--diagram-text)" font-size="13">0x04 transport</text>
  <text x="690" y="318" text-anchor="middle" fill="var(--diagram-text)" font-size="12">32+ bytes</text>
  <line x1="530" y1="210" x2="660" y2="210" stroke="var(--diagram-line)"/>
  <line x1="660" y1="210" x2="660" y2="380" stroke="var(--diagram-line)"/>
  <text x="590" y="202" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no</text>
  <line x1="660" y1="380" x2="540" y2="380" stroke="var(--diagram-line)"/>
  <polygon points="542,375 542,385 532,380" fill="var(--diagram-line)"/>
  <rect x="290" y="358" width="240" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="410" y="385" text-anchor="middle" fill="var(--diagram-text)" font-size="13">not WireGuard framing: look elsewhere</text>
</svg>
</div>

## The filter kit: tcpdump one-liners

Substitute your real interface names; `eth0` stands in for the physical interface below. Each filter isolates one traffic family.

**Direct WireGuard traffic, by port:**

```
sudo tcpdump -ni eth0 'udp port 41641'
```

**WireGuard traffic by shape, regardless of port.** This is the one to memorize, because 41641 is only a default source port, and the remote peer's port after NAT is anything at all:

```
sudo tcpdump -ni eth0 'udp and udp[8] > 0 and udp[8] < 5 and udp[9:2] = 0 and udp[11] = 0'
```

That matches a first payload byte of 1 through 4 followed by the three reserved zero bytes. False positives are possible but rare in practice; the reserved zeros do most of the filtering work.

Two blind spots come with it, both worth knowing before you trust a quiet capture. First, this filter is IPv4 only. Compile it with `tcpdump -d` and you can watch libpcap branch on ethertype `0x0800` and send `0x86dd` straight to reject; pairing any `udp[...]` byte test with `ip6` gets you "expression rejects all packets." For an IPv6 path, fall back to a port or host filter. Second, it will not match peer relay traffic, because the Geneve header shifts the WireGuard type byte from `udp[8]` to `udp[16]`. If you suspect a peer relay path, add `or (udp[16] > 0 and udp[16] < 5 and udp[17:2] = 0 and udp[19] = 0)` and treat matches on the shifted offsets as the relayed variant.

**Only handshakes.** Perfect for answering "is the tunnel renegotiating constantly?":

```
sudo tcpdump -ni eth0 'udp and (udp[8] = 1 or udp[8] = 2) and udp[9:2] = 0'
```

**STUN:**

```
sudo tcpdump -ni eth0 'udp port 3478'
```

**DERP.** First identify your relay. Run `tailscale netcheck`, which reports DERP latency per region and names the nearest relay, the one used for traffic. Resolve that relay's hostname to addresses, then:

```
sudo tcpdump -ni eth0 'tcp port 443 and host <derp-relay-ip>'
```

You will not see WireGuard message types here; you will see a TLS session. What matters is its existence, its duration, and whether tunnel-scale volumes of data are moving through it when you expected a direct path.

> [!GOTCHA]
> Filtering on `udp port 41641` silently lies to you in two directions. First, the local port is a *default* and is reconfigurable per platform, so a node may legitimately use another port. Second, even when your node uses 41641, the far side of the conversation carries whatever port the remote NAT invented, so a filter on port 41641 at the *remote* site's firewall sees nothing recognizable. When a capture looks impossibly quiet, switch to the byte-shape filter above before concluding traffic is absent, and remember that filter has its own two blind spots (IPv6, and the Geneve shifted offsets of a peer relay path). Absence of evidence at the wrong port, or at the wrong offset, is not evidence of absence.

Practical capture hygiene: add `-w /tmp/case.pcap` to write a file for Wireshark, `-s 0` is the default snap length on modern tcpdump so full packets are kept, and `-c 5000` keeps you from filling a disk on a busy exit node. Capture at both ends of a broken connection when you can, with rough clock sync; matching a handshake initiation leaving node-a against its arrival (or non-arrival) at node-b turns speculation into a verdict about which middlebox ate it.

## Two capture points: inside and outside

Every Tailscale node gives you two fundamentally different places to attach tcpdump, and a complete diagnosis usually needs both.

**Outside: the physical interface.** Here you see ciphertext: WireGuard UDP, STUN, DERP TLS. Addresses are real-world addresses. This capture answers transport questions: is there a direct path, is the handshake completing, which relay is in use, is something dropping UDP.

**Inside: the Tailscale interface.** Tailscale creates a TUN device (via `/dev/net/tun` on Linux) that behaves like any other network interface, and traffic on it is plaintext from the node's point of view. Find it by looking for the interface that holds the node's Tailscale IP, which comes from the CGNAT range `100.64.0.0/10`. The default name comes from `defaultTunName` in `cmd/tailscaled`: `tailscale0` on Linux, `utun` on macOS (a magic value that claims any free `utun` number, so you will see `utun3` or similar), `Tailscale` on Windows, and `tun` on OpenBSD. It is also settable with the daemon's `-tun` flag, so when in doubt, match the 100.x address rather than trusting a name. Then:

```
sudo tcpdump -ni tailscale0 'host 100.101.102.103'
```

This capture answers intent and delivery questions: did the application actually send anything, what did it send, did the reply make it back through the tunnel, are there TCP retransmissions or MTU-shaped stalls *inside* the encrypted path.

<div class="diagram-wrap">
<svg viewBox="0 0 800 340" role="img" aria-label="Two capture points on a Tailscale node: inside the tunnel on the TUN interface with plaintext and 100.x addresses, outside on the physical interface with encrypted WireGuard UDP or DERP TLS">
  <title>Inside and outside capture points on one node</title>
  <rect x="30" y="24" width="360" height="290" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="210" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="15">node-a</text>
  <rect x="70" y="66" width="280" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="210" y="91" text-anchor="middle" fill="var(--diagram-text)" font-size="13">application (ssh, http, anything)</text>
  <line x1="210" y1="106" x2="210" y2="130" stroke="var(--diagram-line)"/>
  <polygon points="205,128 215,128 210,138" fill="var(--diagram-line)"/>
  <rect x="70" y="138" width="280" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="210" y="163" text-anchor="middle" fill="var(--diagram-text)" font-size="13">TUN interface, 100.x addresses</text>
  <text x="620" y="90" text-anchor="middle" fill="var(--diagram-text)" font-size="13">capture point 1: INSIDE</text>
  <text x="620" y="108" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tcpdump -ni tailscale0</text>
  <text x="620" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="12">plaintext, tailnet IPs</text>
  <line x1="350" y1="158" x2="500" y2="110" stroke="var(--diagram-accent)"/>
  <line x1="210" y1="178" x2="210" y2="202" stroke="var(--diagram-line)"/>
  <polygon points="205,200 215,200 210,210" fill="var(--diagram-line)"/>
  <rect x="70" y="210" width="280" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="210" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tailscaled: encrypt, pick path</text>
  <line x1="210" y1="250" x2="210" y2="274" stroke="var(--diagram-line)"/>
  <polygon points="205,272 215,272 210,282" fill="var(--diagram-line)"/>
  <rect x="70" y="282" width="280" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="210" y="307" text-anchor="middle" fill="var(--diagram-text)" font-size="13">physical interface, real addresses</text>
  <text x="620" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="13">capture point 2: OUTSIDE</text>
  <text x="620" y="248" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tcpdump -ni eth0</text>
  <text x="620" y="266" text-anchor="middle" fill="var(--diagram-text)" font-size="12">WireGuard UDP, STUN 3478,</text>
  <text x="620" y="284" text-anchor="middle" fill="var(--diagram-text)" font-size="12">DERP TLS on tcp 443</text>
  <line x1="350" y1="302" x2="500" y2="266" stroke="var(--diagram-accent)"/>
</svg>
</div>

Why you need both: each capture point has a blind spot exactly where the other sees clearly. The outside capture cannot tell you *what* is being sent or whether it was delivered to the application; the inside capture cannot tell you *how* it traveled or why it is slow. The classic split diagnoses:

- Packet appears on node-a's TUN interface, ciphertext leaves node-a's physical interface, ciphertext arrives at node-b's physical interface, but nothing appears on node-b's TUN interface. Decryption succeeded or failed silently, or something between decryption and delivery (the ACL packet filter, for instance) dropped it. That is a policy investigation now, not a network one (Module 05).
- Packet appears on node-a's TUN interface and nothing ever leaves the physical interface. tailscaled has no path and no relay, or routing sent the flow somewhere else entirely. Check `tailscale status` and the routing table.
- Large transfers stall but small pings are fine, and the inside capture shows TCP retransmits of full-size segments. That is MTU trouble inside the tunnel, invisible from outside because encrypted packet sizes all look plausible.

## Reading a connection being born

Set two terminals: one capturing STUN plus WireGuard by shape on the physical interface, one capturing the TUN interface. Then from node-a, ping node-b's tailnet address for the first time. The capture tells a story in five acts.

**Act 1: STUN.** Even before you did anything, periodic STUN request and response pairs to port 3478 were keeping node-a's endpoint discovery current. Each is a small UDP exchange: request out, response back carrying the public ip:port the server observed, which is the raw material for NAT traversal (Module 03).

**Act 2: relay first.** Per the NAT traversal design, all connections start out with DERP preselected, so the connection is usable immediately through the fallback path while path discovery runs in parallel. In your capture that means the very first ping replies come back while the only tunnel-bearing flow is the TLS stream to the DERP relay. Do not misread this as a broken direct path; it is the deliberate starting state.

**Act 3: the probe burst.** Both sides begin firing UDP probes at each other's candidate endpoints: LAN addresses, STUN-discovered public endpoints, sometimes many ports at once. Against hard NATs Tailscale leans on a birthday-paradox strategy, opening many local ports while the far side sprays random destination ports. Be careful quoting the numbers from the NAT traversal write-up, because they describe different cases. With one hard NAT and 256 ports open, it puts 50% success at 174 probes and 99.9% at 2,048. With a hard NAT on both sides the search space is squared, and even with the birthday trick "we need each side to send 170,000 probes," about 28 minutes at 100 packets per second, which the post contrasts with "the 1.2 years it would take without the birthday paradox." So 170,000 is the cost of the clever strategy in the worst case, not the cost of scanning sequentially. On the wire all of this is a burst of small UDP packets to addresses you may not recognize, most of which go unanswered. That is normal. Only one needs to land.

**Act 4: the handshake.** The moment a probe path works both ways, you see the signature pair: a 148 byte type 1 initiation, answered by a 92 byte type 2 response on the same 5-tuple. If the responder is under load you might glimpse a 64 byte type 3 cookie reply first, forcing the initiator to retry with proof of its address; rare in the field, unmistakable when present.

**Act 5: transport.** Type 4 messages begin flowing on the direct path, and volume on the DERP TLS stream drops to nothing. The write-up describes this as the connection transparently upgrading after a few seconds, and that is exactly what the capture shows: same conversation, new road. From here you will also see fresh handshake pairs roughly every two minutes while traffic keeps flowing: the wireguard-go fork Tailscale embeds sets `RekeyAfterTime` to 120 seconds, and the original initiator starts a new handshake once the session key is that old. Periodic type 1 and type 2 exchanges on a healthy tunnel are hygiene, not trouble.

> [!HOW-IT-WORKS]
> The reason the relay-first design matters for your captures: a connection that stays on DERP forever and a connection captured during its first two seconds look identical on the wire. Before declaring "NAT traversal failed," let the capture run at least 30 seconds under traffic, then check whether type 4 UDP ever appeared and whether `tailscale status` still says `relay`. Direction of failure matters too: if you see your own probes and handshake initiations leaving but nothing returning, the problem is inbound at the far side; if you see initiations arriving and no responses leaving, the problem is local.

## Path migration mid capture

Now for the subtle one. Roam node-a from Wi-Fi to a phone hotspot, or watch a laptop wake in a new location, while the capture runs. Tailscale monitors paths continuously and, in the words of the NAT traversal write-up, upgrades connections on the fly as it discovers better paths and transparently upgrades away from previous ones, downgrading to the relay when an active path dies.

In the capture, migration has a recognizable shape:

- Type 4 transport messages stop on the old 5-tuple. There is no goodbye; the old path just goes quiet.
- STUN traffic spikes as the node re-derives its endpoints on the new network.
- Traffic reappears via the DERP TLS stream (the always-available fallback), then a probe burst, then a handshake pair on a *new* 5-tuple, then type 4 messages on that new path.

The tell that this is migration rather than a new connection is continuity at the edges: the inside capture on the TUN interface shows the same TCP session sailing on uninterrupted (perhaps with a burst of retransmits during the gap), while the outside capture shows the transport moving between addresses. This is the whole point of the design, and being able to demonstrate it in a pcap ends arguments about whether "the VPN dropped." The tunnel did not drop; the road under it changed.

> [!FROM-THE-FIELD]
> A Customer escalation that recurs in many costumes: "transfers die every day at about the same time." An outside capture across the event showed clean type 4 flow, then silence on the UDP tuple, then handshake initiations retrying unanswered for the exact duration of the outage, then a cookie-free handshake completing on a different source port. The site firewall was expiring UDP state table entries during a nightly policy reload, and the recovery was Tailscale re-traversing NAT from scratch. No log on either node said any of that. Two minutes of pcap said all of it.

## Wireshark display filters

Bring your pcap files into Wireshark for anything beyond quick triage; it ships a WireGuard dissector. The display filters that earn their keep:

- `wg` selects all recognized WireGuard messages. On nonstandard ports the heuristics usually still catch the framing; if not, right-click a packet and use Decode As to force the WireGuard dissector for that UDP conversation.
- `wg.type == 1` through `wg.type == 4` isolate initiations, responses, cookie replies, and transport data. Do not reach for something like `wg.type == 1 && !wg.type == 2` to find one-way handshake failures: a single packet has exactly one type, so that expression can never be a useful test, and the leading `!` on a bare field is a syntax problem rather than the negation you meant. The working idiom is `wg.type == 1 || wg.type == 2`, then read down the list checking that each initiation has a response near it from the other direction.
- `wg.receiver` shows the little-endian receiver index, which lets you group transport packets into sessions and watch the index change across rekeys.
- `stun` isolates STUN cleanly, decoding the XOR-mapped address attributes so you can read exactly which public ip:port each server reported. Comparing those across servers is a NAT behavior diagnosis in itself: if different servers report different ports, you are looking at the hard NAT case from Module 03.
- `tcp.port == 443 && ip.addr == <derp-relay-ip>` isolates the relay stream. Wireshark will show you TLS records, not tunnel contents. Watch the throughput graph on that conversation: sustained volume means you are living on the relay.

The Statistics tools repay attention too. Conversations, filtered to `wg`, gives per-path byte counts, which answers "which path carried the data" faster than scrolling. IO Graph with one line for `wg.type == 4` and another for the DERP TCP conversation makes the moment of upgrade or migration visible as two curves crossing.

## What the ciphertext will and will not tell you

Everything inside a type 4 message is encrypted, and DERP relays a stream that is opaque even to the relay operator, since private keys never leave the device that generated them. Be precise with yourself and with Customers about what a capture can therefore establish.

**You can conclude:** which endpoints are talking and on which ports; whether the path is direct, peer-relayed, or DERP; when handshakes occur and whether they complete in both directions; packet timing, loss and retransmission patterns at the tunnel layer; packet sizes and volumes; when a path migrated and how long recovery took. For most tailnet issues, that is the entire diagnosis.

**You cannot conclude:** what the payload contains; which application protocol is inside a given transport message; which inner 100.x flows map to which outer packets, when observing only the outside capture. If you need inner detail, capture on the TUN interface, where the node shows you its own plaintext honestly.

One honest caveat cuts the other way: encrypted does not mean informationless. Sizes and timing leak shape. A steady rhythm of small type 4 packets looks like an interactive session; symmetric bursts look like request and response traffic; a saturated one-way flood looks like a transfer. You may use that shape for diagnosis, and you should assume a sufficiently motivated observer on the path can too. That is not a Tailscale weakness; it is the nature of any encrypted transport, and it is why the claim you make from a pcap should always be about transport behavior, never about content.

## Cross references

- Module 01 for the Noise handshake and rekey machinery behind the type 1 and type 2 messages you just filtered.
- Module 03 for the full NAT traversal story: STUN, DERP, peer relays, and why the probe burst looks the way it does.
- Module 05 for the ACL packet filter that can eat a packet between decryption and the TUN interface.
- Module 07 for how routes decide which traffic enters the tunnel at all.
- Module 11 for pairing captures with `tailscale netcheck`, `tailscale status`, and client logs into one coherent investigation.
- Module 12 for where the wire format and magicsock path selection live in the source.
