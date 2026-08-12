---
module: 1
slug: wireguard-foundations
title: WireGuard foundations
description: How WireGuard actually works at the layer Tailscale builds on, and the three problems it deliberately leaves unsolved.
order: 1
words: 4600
sources:
  - id: how-tailscale-works
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works (Tailscale blog)
    checked: 2026-08-10
  - id: wg-protocol
    url: https://www.wireguard.com/protocol/
    title: WireGuard protocol and cryptography
    checked: 2026-08-10
  - id: wg-paper
    url: https://www.wireguard.com/papers/wireguard.pdf
    title: WireGuard whitepaper (Next Generation Kernel Network Tunnel)
    checked: 2026-08-10
  - id: wg-home
    url: https://www.wireguard.com/
    title: WireGuard project homepage
    checked: 2026-08-10
  - id: ts-tcp-troubleshoot
    url: https://tailscale.com/docs/reference/troubleshooting/network-configuration/tcp-connection-two-devices
    title: Troubleshoot TCP connection issues between two devices (Tailscale docs)
    checked: 2026-08-10
  - id: ts-throughput
    url: https://tailscale.com/blog/throughput-improvements
    title: Improving Tailscale performance, enhancing userspace with kernel interfaces (Tailscale blog)
    checked: 2026-08-10
  - id: ts-peer-relay
    url: https://tailscale.com/docs/features/peer-relay
    title: Tailscale Peer Relays (Tailscale docs)
    checked: 2026-08-10
  - id: ts-userspace
    url: https://tailscale.com/docs/concepts/userspace-networking
    title: Userspace networking mode (Tailscale docs)
    checked: 2026-08-10
  - id: ts-cgnat
    url: https://tailscale.com/docs/concepts/tailscale-ip-addresses
    title: What are these 100.x.y.z addresses? (Tailscale docs)
    checked: 2026-08-10
---

## The promise

1. You will be able to explain why a Curve25519 public key, not an IP address, is the real identity of a node on a WireGuard network.
2. You will be able to walk through the Noise IK handshake message by message: what the initiation carries, what the response carries, and where the transport keys come from.
3. You will be able to explain cryptokey routing and why the allowed IPs list is simultaneously a routing table and a firewall.
4. You will be able to predict WireGuard's behavior toward unauthenticated traffic (silence) and explain the timers behind rekeying and keepalives, including the roughly two minute session rotation.
5. You will be able to state precisely which three problems WireGuard refuses to solve, because those three gaps define the entire rest of this field guide.

## Foundation

You already know how IPsec or OpenVPN style tunnels work in broad strokes: encapsulate an inner IP packet inside an encrypted outer packet, ship it across an untrusted network, decrypt and reinject at the far side. You know routing tables, you know stateful firewalls, you know why fragmentation is a source of pain, and you know the difference between the kernel network stack and a userspace process.

WireGuard keeps the encapsulation idea and throws away almost everything else you associate with VPNs: no cipher negotiation, no X.509 certificates, no TLS style session establishment, no daemon holding elaborate per-connection state machines. The whole configuration model collapses to one thing: an association between a peer's public key and the IP addresses that peer is allowed to use. The WireGuard project's own goal statement is that it should be "as easy to configure and deploy as SSH": you exchange keys, and the tunnel just exists.

Tailscale's data plane is WireGuard, specifically the userspace Go implementation, wireguard-go. Everything Tailscale does above that (login, key distribution, NAT traversal, ACLs, DNS) exists to feed correct configuration into this layer. So this module is the load bearing wall. If you understand what WireGuard guarantees and what it ignores, every later module becomes an answer to the question "who fills this gap, and how?"

## Core content

### Keys are identity: Curve25519

**Analogy.** Think of a Curve25519 keypair as a passport that a machine prints for itself. Nobody issues it, nobody signs it, and there is no central registry inside WireGuard. Two machines that have exchanged passport photos (public keys) out of band can recognize each other forever, no matter what IP address either one shows up from.

**Mechanism.** Every WireGuard interface has exactly one static private key; its Curve25519 public key is derived from it. The protocol uses Curve25519 for elliptic curve Diffie-Hellman, ChaCha20-Poly1305 for authenticated encryption, and BLAKE2s for hashing, with no negotiation: there is one cipher suite, and if it is ever broken the fix is a protocol version bump, not a downgrade dance. A public key is 32 bytes, which in base64 is the 44 character string you see everywhere in WireGuard and Tailscale tooling. In Tailscale's design, "each node generates a random public/private keypair for itself" and, critically, "the private key never, ever leaves its node." The coordination server (Module 2's subject) only ever sees public keys.

**Failure mode.** Because the key is the identity, key handling mistakes are identity mistakes. Clone a VM image with a WireGuard private key baked in and you have two machines claiming to be the same node; peers will roam their traffic to whichever clone spoke most recently, and connectivity will flap in ways that look like a network problem but are an identity collision. The reverse failure also exists: regenerate a node's key without telling its peers, and the node becomes a stranger. Nothing errors. Traffic is simply dropped in silence, which brings us to the handshake.

### The Noise IK handshake

**Analogy.** Noise IK is a two line conversation between parties who already have each other's photos. The initiator walks up and says, in a sealed envelope only the responder can open: "It is me, here is a fresh random value, and here is a timestamp proving this is not a replay." The responder answers with one sealed envelope of its own: "Confirmed, here is my fresh random value." That is the whole conversation. Both sides now do arithmetic on the exchanged values and end up with identical symmetric keys without ever transmitting them.

**Mechanism.** The "IK" pattern from the Noise framework means the Initiator's static key is transmitted (encrypted) in the first message, and the responder's static Key is already Known to the initiator. Concretely:

1. **Handshake initiation (message type 1).** The initiator generates an ephemeral Curve25519 keypair and sends: the ephemeral public key in the clear, its own static public key encrypted to the responder, and an encrypted timestamp. The timestamp (TAI64N format) is the replay defense: a responder ignores initiations whose timestamp is not greater than the last one it accepted from that static key.
2. **Handshake response (message type 2).** The responder sends its own ephemeral public key and an encrypted empty payload whose successful authentication proves the responder derived the same chaining key. This message consumes the results of multiple Diffie-Hellman operations mixing ephemeral and static keys from both sides.
3. **Key derivation.** Both sides now derive two symmetric session keys: one for sending, one for receiving. The initiator's send key is the responder's receive key and vice versa. These are the transport keys; all subsequent data packets (message type 4) are ChaCha20-Poly1305 sealed under them, each with a 64 bit counter used as the nonce and checked against a sliding window to reject replayed or badly reordered packets.

One round trip. Compare that with the multi round trip negotiation of IKEv2 or TLS based VPNs, and note the property that matters operationally: after 1-RTT the initiator can attach data immediately, so the first real packet can ride right behind the handshake.

> [!HOW-IT-WORKS] The handshake gives you forward secrecy on a rolling basis. Session keys are derived from ephemeral keys that are thrown away, so compromising a node's static private key later does not decrypt captured traffic from old sessions. The static keys authenticate; the ephemerals encrypt.

<div class="diagram-wrap">
<svg viewBox="0 0 760 420" role="img" aria-label="Noise IK handshake sequence between initiator and responder, followed by transport data and the 120 second rekey loop">
  <title>Noise IK handshake and rekey cycle</title>
  <line x1="140" y1="60" x2="140" y2="390" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="620" y1="60" x2="620" y2="390" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="70" y="20" width="140" height="36" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="140" y="43" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a (initiator)</text>
  <rect x="550" y="20" width="140" height="36" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="620" y="43" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b (responder)</text>
  <line x1="140" y1="100" x2="620" y2="100" stroke="var(--diagram-accent)" stroke-width="2"/>
  <polygon points="620,100 606,94 606,106" fill="var(--diagram-accent)"/>
  <text x="380" y="90" text-anchor="middle" fill="var(--diagram-text)" font-size="13">msg 1: initiation (ephemeral pub, encrypted static, timestamp)</text>
  <line x1="620" y1="150" x2="140" y2="150" stroke="var(--diagram-accent)" stroke-width="2"/>
  <polygon points="140,150 154,144 154,156" fill="var(--diagram-accent)"/>
  <text x="380" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="13">msg 2: response (ephemeral pub, empty sealed payload)</text>
  <rect x="290" y="170" width="180" height="34" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="192" text-anchor="middle" fill="var(--diagram-text)" font-size="13">both derive send/recv keys</text>
  <line x1="140" y1="240" x2="620" y2="240" stroke="var(--diagram-line)" stroke-width="2"/>
  <polygon points="620,240 606,234 606,246" fill="var(--diagram-line)"/>
  <text x="380" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="13">transport data (type 4, counter nonce)</text>
  <line x1="620" y1="280" x2="140" y2="280" stroke="var(--diagram-line)" stroke-width="2"/>
  <polygon points="140,280 154,274 154,286" fill="var(--diagram-line)"/>
  <text x="380" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="13">transport data</text>
  <rect x="250" y="310" width="260" height="34" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="332" text-anchor="middle" fill="var(--diagram-text)" font-size="13">session age reaches 120 s</text>
  <line x1="140" y1="375" x2="620" y2="375" stroke="var(--diagram-accent)" stroke-width="2" stroke-dasharray="6 4"/>
  <polygon points="620,375 606,369 606,381" fill="var(--diagram-accent)"/>
  <text x="380" y="365" text-anchor="middle" fill="var(--diagram-text)" font-size="13">new msg 1: rekey (fresh ephemerals, new session)</text>
</svg>
</div>

**Failure mode.** The handshake fails invisibly by design. If the responder does not recognize the initiator's static key (stale peer config, rotated key, wrong tailnet), it sends nothing back. From the initiator's side this looks identical to a firewall drop: retries every 5 seconds, no error message. Diagnosing "no handshake response" therefore always has two hypotheses, crypto identity mismatch and packet loss, and you cannot distinguish them from the initiator alone. Clock skew is the sneakier variant: because the initiation carries a monotonic timestamp, a node whose clock jumps backward (a restored VM snapshot is the classic case) will emit initiations the responder silently discards as replays until the clock catches up to the last accepted timestamp.

### Transport keys and the two minute rekey

**Analogy.** WireGuard treats session keys like disposable gloves. You do not wait for them to wear through; you change them on a schedule, so that even if one pair was somehow compromised, it was only ever worn for two minutes.

**Mechanism.** The whitepaper's timer constants are exact (checked 2026-08-10): Rekey-After-Time is 120 seconds, Reject-After-Time is 180 seconds, Rekey-Timeout is 5 seconds, Keepalive-Timeout is 10 seconds, and Rekey-After-Messages is 2^60 messages. In practice the time limit always fires long before the message limit. An active session therefore rotates its keys roughly every two minutes: the original initiator of the session starts a fresh handshake when the session is 120 seconds old and it has data to send, and each rotation mints new ephemeral keys, which is what makes the forward secrecy rolling rather than one time. Only the initiator rekeys on the timer, deliberately, so both sides do not stampede into simultaneous handshakes. At 180 seconds a session's keys are refused outright for both sending and receiving, and after three times that with no successor session, all session state and ephemeral keys are zeroed from memory.

**Failure mode.** The rekey math produces a characteristic symptom: a connection that works for exactly two to three minutes, then dies. That signature means handshakes succeeded once but cannot succeed again, which almost always means the path changed underneath the tunnel (NAT mapping expired, firewall state evicted, one side moved networks) after the first handshake. The old transport keys keep working until Reject-After-Time, then everything stops. If you see "worked for a couple of minutes, then went dark," suspect the path, not the crypto.

### Cryptokey routing: allowed IPs as routing table and firewall

This is the single most important concept in the module, so take it slowly.

**Analogy.** Imagine an apartment building mailroom with one rule sheet per resident. The sheet for the resident with passport K says: "K may send mail claiming return addresses 100.101.1.5, and any mail addressed to 100.101.1.5 goes into K's box." One sheet, enforced in both directions. There is no separate routing table and no separate firewall; the sheet is both.

**Mechanism.** Each peer entry in a WireGuard configuration binds a public key to a list of allowed IPs. The WireGuard project calls this cryptokey routing: associating each public key with the list of tunnel IP addresses that are allowed inside the tunnel. The interface uses this table twice:

- **Outbound (routing):** a packet leaving through the WireGuard interface is matched by destination IP against the allowed IPs lists; whichever peer's list matches, that peer's public key selects the session keys used to encrypt it, and the packet is sent to that peer's current endpoint.
- **Inbound (access control):** when an encrypted packet arrives and authenticates under some peer's session keys, the decrypted inner packet's source IP is checked against that same peer's allowed IPs. If the source IP is not in the list, the packet is dropped, even though it decrypted perfectly.

The consequence is profound: inside the tunnel, an IP address is a cryptographically verified claim. If a packet arrives on the interface with source 100.101.1.5, it provably came from the holder of the private key mapped to that address. Tailscale leans on exactly this property; higher level ACLs (a later module) can trust source IPs because cryptokey routing already authenticated them.

Roaming falls out of the same table. A peer's endpoint (outer IP and port) is not fixed configuration; WireGuard updates it to wherever the latest authenticated packet came from. As the WireGuard homepage puts it, both sides "send encrypted data to the most recent IP endpoint for which they authentically decrypted data." Your laptop moves from home Wi-Fi to a phone hotspot, the first authenticated packet from the new address updates the peer's endpoint, and the tunnel follows. The inner IPs never change. This is why a Tailscale SSH session survives a network switch that would kill a plain TCP connection.

> [!GOTCHA] Allowed IPs lists must not overlap ambiguously between peers on the same interface: a given inner IP can belong to only one peer, because the outbound lookup needs exactly one answer. In raw WireGuard, misassigning a subnet to the wrong peer silently blackholes traffic to it. Tailscale generates these tables for you from the coordination server's netmap, which is precisely how it removes this class of foot-gun.

<div class="diagram-wrap">
<svg viewBox="0 0 780 400" role="img" aria-label="Cryptokey routing table on node-a used in both directions: destination lookup for outbound encryption and source check for inbound acceptance">
  <title>Cryptokey routing: one table, two directions</title>
  <rect x="270" y="30" width="240" height="150" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="390" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a peer table</text>
  <line x1="270" y1="65" x2="510" y2="65" stroke="var(--diagram-line)"/>
  <text x="285" y="90" fill="var(--diagram-text)" font-size="13">key B -&gt; 100.101.1.5/32</text>
  <text x="285" y="120" fill="var(--diagram-text)" font-size="13">key C -&gt; 100.101.1.6/32</text>
  <text x="285" y="150" fill="var(--diagram-text)" font-size="13">key D -&gt; 100.101.1.7/32</text>
  <rect x="30" y="60" width="170" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="115" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="13">outbound packet</text>
  <text x="115" y="98" text-anchor="middle" fill="var(--diagram-text)" font-size="12">dst 100.101.1.5</text>
  <line x1="200" y1="85" x2="268" y2="85" stroke="var(--diagram-accent)" stroke-width="2"/>
  <polygon points="268,85 254,79 254,91" fill="var(--diagram-accent)"/>
  <rect x="580" y="60" width="170" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="665" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="13">encrypt with key B</text>
  <text x="665" y="98" text-anchor="middle" fill="var(--diagram-text)" font-size="12">send to B's endpoint</text>
  <line x1="512" y1="85" x2="578" y2="85" stroke="var(--diagram-accent)" stroke-width="2"/>
  <polygon points="578,85 564,79 564,91" fill="var(--diagram-accent)"/>
  <rect x="30" y="250" width="170" height="66" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="115" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="13">inbound from key B</text>
  <text x="115" y="290" text-anchor="middle" fill="var(--diagram-text)" font-size="12">decrypts OK</text>
  <text x="115" y="308" text-anchor="middle" fill="var(--diagram-text)" font-size="12">inner src 100.101.1.6</text>
  <line x1="200" y1="283" x2="300" y2="220" stroke="var(--diagram-accent)" stroke-width="2"/>
  <polygon points="300,220 286,222 292,232" fill="var(--diagram-accent)"/>
  <text x="230" y="245" fill="var(--diagram-text)" font-size="12">src check vs key B list</text>
  <rect x="580" y="250" width="170" height="66" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="665" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="13">DROP</text>
  <text x="665" y="300" text-anchor="middle" fill="var(--diagram-text)" font-size="12">src not in B's allowed IPs</text>
  <line x1="480" y1="220" x2="600" y2="255" stroke="var(--diagram-line)" stroke-width="2" stroke-dasharray="5 4"/>
  <polygon points="600,255 586,249 590,260" fill="var(--diagram-line)"/>
</svg>
</div>

**Failure mode.** Cryptokey routing failures are always silent drops with healthy looking crypto. The three classics: a subnet route pointing at the wrong peer (outbound blackhole), a peer sending from an inner source address outside its allowed IPs (inbound drop after successful decryption, so the sender sees its counters increment while the receiver sees nothing), and two peers configured with the same allowed IP (traffic follows whichever entry the implementation resolves, and the other peer starves). In Tailscale these appear when subnet router advertisements overlap or when a node NATs traffic into the tunnel with the wrong source.

### Silence, statelessness, and denial of service posture

**Analogy.** A WireGuard interface is a door with no doorbell, no peephole glow, and no "no soliciting" sign. Knock with the wrong key and nothing happens at all. To an internet scanner, a machine running WireGuard on a port is indistinguishable from a machine with that port dark.

**Mechanism.** The whitepaper devotes a section to this titled "Silence is a Virtue": a stated design goal is to store no state before authentication and to send no responses to unauthenticated messages. Every handshake message carries a MAC (mac1) computed using the responder's public key, so even eliciting the first byte of response requires already knowing who you are talking to. Before authentication, no memory is allocated and no state is stored, which removes the state exhaustion attacks that plague TLS and IKE responders. Under load, WireGuard adds a second, stateless defense: a cookie reply mechanism where the cookie is a MAC of the sender's source IP under a server secret that rotates every two minutes, forcing initiators to prove IP ownership before the responder spends CPU on expensive Diffie-Hellman operations. And when a session has no traffic to carry, nothing is transmitted at all: an idle WireGuard link is a silent link.

**Failure mode.** The cost of silence is diagnosability. There is no WireGuard equivalent of a TCP RST or an ICMP port unreachable to tell you "wrong key" versus "wrong port" versus "packet never arrived." Every misconfiguration presents as the same symptom: timeout. This is why tooling matters so much at this layer, and why `tailscale ping` (below) exists: the protocol itself will never tell you what went wrong.

> [!FROM-THE-FIELD] The silence property has a pleasant operational corollary: running a WireGuard listener on a public address adds essentially nothing to your visible attack surface. Port scans show nothing and banner grabs get nothing, because unauthenticated packets get no reply of any kind. This is a real reason Tailscale nodes can sit directly on hostile networks without a fronting firewall appliance.

### Keepalives

**Analogy.** Two people in adjacent rooms agree: if I have said nothing for ten seconds after you spoke, I will knock once on the wall so you know I am still here. If nobody knocks, something is wrong with the wall, not the conversation.

**Mechanism.** WireGuard has two distinct keepalive behaviors, and conflating them causes confusion. First, the passive keepalive: if a peer has received a transport message but has had nothing to send back for Keepalive-Timeout (10 seconds), it sends a transport message with a zero length payload. Because every data message therefore warrants some reply, each side can infer liveness: if nothing has been received for Keepalive-Timeout plus Rekey-Timeout (15 seconds) after sending data, the session is presumed broken and a new handshake begins. Second, the persistent keepalive: an optional per peer setting that transmits a keepalive at a fixed interval even when idle, whose real purpose is not liveness but holding NAT and firewall mappings open so the peer stays reachable from outside. Vanilla WireGuard leaves it off by default. Tailscale manages this actively as part of its NAT traversal machinery rather than leaving a static number in a config file; how it decides is Module 3 territory.

**Failure mode.** An idle WireGuard tunnel with no persistent keepalive goes completely quiet, so any stateful middlebox between the peers eventually forgets the UDP mapping. The next packet then arrives from an address and port the peer has never seen, or never arrives at all. Symptom: connections initiated from side A always work, connections initiated from side B only work shortly after A has sent something. If you have ever seen a tunnel that is "one way warm," this is it.

### MTU 1280 and why

**Analogy.** Encapsulation is putting a letter inside a second envelope. If the letter already fills the envelope to the postal size limit, the outer envelope now exceeds it. You have two options: allow envelopes to be cut in half and rejoined (fragmentation, fragile), or print your stationery smaller so the double envelope always fits (a reduced MTU).

**Mechanism.** Every WireGuard packet carries overhead: outer IP header, UDP header, WireGuard's type and receiver fields, counter, and 16 byte Poly1305 authentication tag, roughly 60 bytes on IPv4 and 80 on IPv6. A tunnel interface must advertise an MTU small enough that inner packet plus overhead fits the path beneath. Tailscale's docs state plainly that "Tailscale uses a maximum transmission unit (MTU) of 1280" (checked 2026-08-10). Why that number: 1280 is IPv6's mandated minimum link MTU, meaning any network that carries IPv6 at all must carry 1280 byte packets, so 1280 plus overhead fits inside a standard 1500 byte Ethernet path with generous margin for stacked encapsulations (PPPoE, cloud overlays, a WireGuard tunnel inside another tunnel). It trades a few percent of per packet efficiency for a value that works essentially everywhere without path MTU discovery, which is notoriously unreliable across networks that filter ICMP.

**Failure mode.** MTU problems are the great imposters. The Tailscale troubleshooting docs note that packets larger than 1280 entering the tunnel might get dropped silently on some network types. The classic signature is a TCP connection where the handshake succeeds (small packets) and small responses work, but any bulk transfer hangs: `ssh node-b` connects and then freezes the moment you `cat` a large file. Subnet routing setups where a LAN host with a 1500 MTU sends through a Tailscale subnet router are the usual scene of the crime; the fixes the docs offer are lowering the MTU on the LAN side or MSS clamping on the router.

> [!GOTCHA] MTU failures almost never say "MTU" anywhere. They say "connection hangs," "works for small files," "curl stalls at exactly the same byte count every time." When a Tailscale connection establishes but stalls under load, test with a small payload before touching keys, ACLs, or DNS. Deterministic stall size is the tell.

### Kernel WireGuard, wireguard-go, and the TUN device Tailscale actually uses

**Analogy.** Kernel WireGuard is plumbing built into the walls of the house. wireguard-go is a very good portable pump you can carry into any house. Tailscale chose to carry its own pump everywhere, so that every house behaves identically and the pump can be upgraded without renovating walls.

**Mechanism.** WireGuard the protocol has multiple implementations. The one merged into Linux 5.6 runs in kernel space and is what `wg-quick` typically drives on a modern Linux box. wireguard-go is the userspace implementation in Go. Tailscale states its base layer is "specifically the userspace Go variant, wireguard-go" across its platforms. The plumbing works like this: tailscaled creates a TUN device, a virtual network interface where, as Tailscale's engineering writeup puts it, "a packet sent out of the TUN interface is received by the userspace application, and the userspace application can inject packets back toward the kernel by writing in the other direction." Your application writes to a socket, the kernel routes the packet to the tailscale interface, wireguard-go reads it from the TUN file descriptor, encrypts it, and transmits it over an ordinary UDP socket. Inbound is the mirror image. (On platforms where a TUN device is unavailable, such as some containers, Tailscale can run in a userspace networking mode that exposes a SOCKS5 and HTTP proxy instead, per its userspace networking docs, but the TUN path is the normal case.)

Why userspace, when a kernel module exists on Linux? Portability and control: one data plane codebase across Linux, macOS, Windows, iOS, and Android, integrated tightly with Tailscale's NAT traversal logic, upgradeable in lockstep with the client. The historical objection was performance, and Tailscale attacked it head on: by teaching wireguard-go to use TCP segmentation offload and generic receive offload through the TUN driver and batching UDP syscalls with sendmmsg and recvmmsg, they achieved a 2.2x throughput improvement in wireguard-go on Linux and concluded, in their words, "userspace isn't slow, some kernel interfaces are!", with their optimized wireguard-go running faster than kernel WireGuard in the best conditions of their tests (Tailscale throughput blog, checked 2026-08-10; the measurements described are Linux specific).

**Failure mode.** The userspace design means the data path crosses the kernel/user boundary at least twice per packet, so an underpowered or CPU throttled machine shows tunnel throughput collapsing while raw network throughput is fine; profile tailscaled CPU before blaming the network. It also means the tailscale interface is only as alive as the daemon: kill or wedge tailscaled and the interface goes with it, unlike a kernel WireGuard interface which keeps forwarding with no userspace process at all. And if you hand build a kernel WireGuard config to interoperate with Tailscale nodes, you own key distribution and endpoint updates yourself, which is exactly the job you installed Tailscale to avoid.

### What WireGuard deliberately does not solve

WireGuard's minimalism is a decision, not an omission. Three whole problem domains are explicitly out of scope, and Tailscale's product is, almost exactly, these three gaps:

1. **Key distribution.** WireGuard gives you no way to learn peers' public keys or to revoke them. For a mesh, each node must somehow learn the public key and current endpoint of every other node it wants to reach directly. In raw WireGuard you copy keys around by hand and rotation is a manual, error prone chore across every peer. Tailscale replaces this with a coordination server it describes as "essentially, a shared drop box for public keys," tied to authenticated identities: each node uploads its public key, and downloads the keys it is entitled to see. That is Module 2.
2. **NAT traversal.** WireGuard assumes that when it sends a UDP packet to a peer's endpoint, the packet can arrive. Between two devices both behind NAT, with no port forwarding, that assumption fails, and WireGuard has no STUN, no ICE, no relay fallback; its only concession is the persistent keepalive to hold an existing mapping open. Tailscale layers STUN and ICE derived techniques plus DERP relays, and since version 1.86 optional peer relays, on top. That is Module 3.
3. **IP assignment.** WireGuard never assigns addresses. You choose inner IPs and allowed IPs yourself, and nothing stops two peers from claiming the same address beyond your own discipline. Tailscale assigns each node a stable address from the 100.64.0.0/10 CGNAT range (per its docs on 100.x.y.z addresses) and generates every node's cryptokey routing table from a single authoritative netmap, making address collisions structurally impossible rather than merely inadvisable.

Hold onto this framing. Every later module in this guide is a description of machinery whose entire purpose is to compute, distribute, and maintain the tiny beautiful config file that WireGuard always wanted and never wanted to fetch for itself.

## On the wire

What does all of this actually look like when you are staring at a terminal?

**Packets.** WireGuard is UDP. A capture of tunnel establishment shows exactly four interesting shapes: a 148 byte handshake initiation, a 92 byte handshake response, an occasional 64 byte cookie reply under load, and then a stream of transport data packets whose payloads are opaque. There is no protocol banner and no cleartext field naming the protocol; dissectors identify it by the message type byte and sizes. On a Tailscale node, the outer UDP flows to peers' public endpoints or to a relay, while inside the tunnel you see ordinary IP between 100.64.0.0/10 addresses.

**Vanilla WireGuard view.** On a raw WireGuard box (not Tailscale), `wg show` summarizes the cryptokey routing table and session state:

```
interface: wg0
  public key: hIs3Qx7GfUnB4sEdKeYm4tRw5A1r8pVnE2sTk6yJcm44=
  listening port: 51820

peer: xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
  endpoint: 203.0.113.7:51820
  allowed ips: 100.101.1.5/32
  latest handshake: 1 minute, 4 seconds ago
  transfer: 4.61 MiB received, 1.12 MiB sent
```

That "latest handshake" age is your rekey clock made visible: on an active tunnel it should never read much beyond two minutes. A value growing past three minutes means the session is dead and handshakes are failing right now.

**Tailscale view.** Tailscale does not expose `wg show`; its equivalents are `tailscale status` and `tailscale ping`:

```
$ tailscale status
100.101.1.4   node-a       user@        linux    -
100.101.1.5   node-b       user@        linux    active; direct 203.0.113.7:41641, tx 1181112 rx 4837122
100.101.1.6   lab-vm-1     user@        linux    idle, tx 5112 rx 4996
100.101.1.7   cloud-1      user@        linux    active; relay "ord", tx 88112 rx 91230
```

`direct` means the WireGuard flow runs peer to peer to that endpoint; `relay` means packets are riding a DERP relay (still WireGuard encrypted end to end; the relay sees ciphertext). Version note (checked 2026-08-10): since Tailscale version 1.86, tailnets can also designate their own nodes as peer relays, a feature that reached general availability in early 2026; when one carries the connection, `tailscale status` shows `peer-relay` instead of `direct` or `relay`, and Tailscale tries an available peer relay before falling back to DERP. `tailscale ping` tests reachability at the Tailscale layer rather than relying on inner ICMP:

```
$ tailscale ping node-b
pong from node-b (100.101.1.5) via 203.0.113.7:41641 in 23ms
```

A pong shows that the two nodes hold each other's current keys and have a working, authenticated path between them, direct or relayed. If `tailscale ping` succeeds but a regular `ping 100.101.1.5` fails, the tunnel path is healthy and your problem lives above it (host firewall, ACLs). That single bisection is the most useful move in Tailscale debugging.

> [!ON-THE-WIRE] Direction of proof matters. A successful `tailscale ping` rules out keys, path discovery, and NAT traversal in one shot. A failed ICMP ping rules out almost nothing, since silence is WireGuard's answer to at least five distinct failures. Always bisect with the tool that proves the most layers per attempt.

**Logs.** tailscaled logs show the control side (netmap updates, endpoint discovery, relay connections) rather than per packet WireGuard events, consistent with the protocol's silence. When wireguard-go does log, it is sparse lines about handshake initiations and completions for specific peers. Absence of noise is normal; a healthy tunnel logs almost nothing.

## Failure modes

1. **Key mismatch (stale or rotated peer key).** Symptom: handshake initiations retried every 5 seconds, zero responses, `latest handshake` never populates, `tailscale ping` times out. Indistinguishable on the wire from a firewall drop; check both ends' view of each other's keys via their control status.
2. **Clock skew replay rejection.** Symptom: one specific node cannot complete handshakes after a snapshot restore or RTC failure, while every other pair works. Responder silently discards initiations whose timestamp does not exceed the last accepted one. Fix the clock; the tunnel heals itself.
3. **Path death after establishment.** Symptom: connection works for roughly two to three minutes, then freezes; `latest handshake` age grows past 180 seconds. First handshake used a NAT mapping that has since been evicted or rebound. This is the failure Tailscale's active path management exists to prevent; in raw WireGuard, set a persistent keepalive.
4. **One way warmth (idle NAT expiry).** Symptom: node-a can always reach node-b, but node-b can only reach node-a shortly after node-a has transmitted. The idle direction's NAT mapping expired because nothing kept it alive.
5. **Cryptokey routing drop.** Symptom: sender's transfer counters climb, receiver's stay flat, no errors anywhere. Decryption succeeds but the inner source IP fails the allowed IPs check, or an overlapping or wrong allowed IPs entry blackholes outbound selection. In Tailscale, look at subnet route configuration and unapproved or overlapping advertised routes.
6. **MTU stall.** Symptom: TCP connects, interactive traffic works, bulk transfer hangs at a deterministic point; large ICMP with do not fragment set gets no reply. Oversized packets entering the tunnel are dropped silently. Clamp MSS on subnet routers; keep the 1280 assumption in mind for anything bridged into the tailnet.
7. **Userspace data plane starvation.** Symptom: tunnel throughput far below line rate while iperf outside the tunnel is fine; tailscaled pinned at high CPU. The wireguard-go encrypt path is compute bound on this machine, or the tailscaled process is wedged, in which case the interface itself misbehaves even though "the network" is perfect.

## Check yourself

**1. A teammate reports that `tailscale status` shows node-b as `active; direct`, and `tailscale ping node-b` returns a pong in 20 ms, but `ssh node-b` hangs immediately after printing the SSH version banner exchange. Which layers has the pong already exonerated, and what is your leading hypothesis?**

Answer: The pong proves the Tailscale data path end to end: both nodes hold each other's current public keys, path discovery found a working direct route, and authenticated traffic flows both ways between the endpoints. So keys, handshake, and NAT path are all exonerated, and the problem lives above the tunnel or in a size dependent behavior within it. The banner exchange succeeding is the tell: small packets traverse fine, and the hang begins exactly when SSH moves to key exchange with larger packets. That is the classic MTU stall signature. The leading hypothesis is oversized packets entering the tunnel and being dropped silently, most likely because some path element assumes a 1500 byte MTU while the tailscale interface carries 1280. Confirm by forcing small packets (for example, testing a payload under about 1200 bytes, which should work while larger ones stall deterministically), then apply MSS clamping if a subnet router is involved. Host firewalls or ACL policy are the secondary hypothesis, but those typically block the connection outright rather than permitting a banner and then hanging.

**2. You restore lab-vm-1 from a VM snapshot taken last week. It boots, tailscaled starts, and the coordination server shows the node online, but for several minutes it cannot establish tunnels to peers it worked with before the snapshot, and there are no errors anywhere. What happened at the WireGuard layer, and why are there no errors?**

Answer: Two WireGuard behaviors gang up on you here. First, the snapshot restored a clock in the past. Handshake initiations carry an encrypted TAI64N timestamp precisely so a responder can refuse replays: it silently discards any initiation whose timestamp is not greater than the last one it accepted for that static key. The restored VM's initiations carry timestamps older than ones its peers already accepted last week, so peers treat them as replayed packets and, per the "Silence is a Virtue" design, send absolutely nothing back, no error, no reset, no ICMP. Second, the snapshot may have resurrected stale session state and a stale view of peer endpoints, which times out and rehandshakes, but the rehandshakes hit the same timestamp wall. There are no errors because WireGuard's DoS posture forbids responding to anything that fails authentication or replay checks; from the outside, a replay attack and a restored snapshot look identical. The fix is to correct the clock (NTP sync) so new initiations carry timestamps beyond the high water mark; connectivity then restores itself on the next handshake retry, within about 5 seconds per the retry timer. The durable lesson: snapshots of machines with WireGuard identities should be treated as clock and state hazards, and time sync should be one of the first services up on restore.

**3. A colleague argues: "WireGuard already encrypts everything and its allowed IPs give us access control. Why are we paying for a coordination layer at all? We could just manage WireGuard configs in a git repo." Give the strongest technical version of the counterargument using only what this module covered.**

Answer: The git repo proposal is a manual reimplementation of exactly the three problems WireGuard deliberately refuses to solve, and each scales badly. Key distribution: a full mesh of N nodes needs every node to hold every other node's public key and current endpoint, so N squared relationships maintained by hand; every laptop reinstall or key rotation means editing and redeploying configs on every peer, and a mistake produces silent failure with no error to find, because WireGuard will not tell you a key is stale. Revocation is worse: removing a compromised node means racing to update every peer, and until the last config ships, the compromised key still authenticates. NAT traversal: static configs require stable, reachable endpoints; two developer laptops behind different home NATs simply cannot connect with a git managed endpoint field, because the working endpoint is discovered dynamically and changes as machines move, which no static file can express. Roaming makes it worse, since the endpoint you commit today is wrong tomorrow. IP assignment: the repo becomes the arbiter of who owns which inner IP and which allowed IPs entries exist on which peer, and an overlap or typo produces a silent blackhole, the hardest failure class in this module to diagnose. The coordination layer is not adding encryption, it is automating identity distribution, liveness aware endpoint discovery, and collision free addressing, and then regenerating every node's cryptokey routing table continuously. The crypto was never the hard part; the configuration churn is, and that is the product.

## What you now have

1. A mental model of WireGuard identity: the Curve25519 public key is the node; IPs are claims the key is allowed to make.
2. A working walkthrough of Noise IK: one round trip, timestamped initiation, sealed response, per direction transport keys, rekey at 120 seconds, hard reject at 180.
3. The cryptokey routing insight: allowed IPs are one table serving as routing on the way out and access control on the way in, which makes inner source IPs cryptographically trustworthy.
4. The silence doctrine: no response to unauthenticated packets, no pre-authentication state, cookies under load, and the diagnostic consequence that every failure looks like a timeout.
5. The operational envelope: keepalive behavior, the 1280 MTU and its silent drop failure mode, and Tailscale's choice of wireguard-go over a TUN device on every platform.
6. The three gaps (key distribution, NAT traversal, IP assignment) that define what the rest of this guide has to explain.

## Cross references

- Module 2, the coordination server and key distribution: takes gap one from this module and shows how public keys, endpoints, and netmaps move without ever moving private keys.
- Module 3, NAT traversal and relays: takes gap two and explains how two silent, stateless WireGuard endpoints behind hostile NATs find each other, and what `direct`, `relay`, and `peer-relay` in `tailscale status` really mean.
- Module 6, MagicDNS and split DNS: takes gap three, covering the 100.64.0.0/10 assignments that populate the allowed IPs tables you saw here, and the names on top of them.
- Module 5, ACLs and the policy layer: builds directly on cryptokey routing, since policy trusts source IPs only because this module's inbound check authenticated them.
- Module 7, routing: revisits allowed IPs at subnet scale, where the MTU and MSS clamping issues from this module become daily operational concerns.
