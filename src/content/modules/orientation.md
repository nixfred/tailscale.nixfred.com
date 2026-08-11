---
module: 0
slug: orientation
title: The shape of Tailscale
description: What Tailscale actually is, a WireGuard mesh data plane coordinated by a centralized control plane, and the mental model every later module builds on.
order: 0
words: 4450
sources:
  - id: how-it-works
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works
    checked: 2026-08-10
  - id: cgnat-ips
    url: https://tailscale.com/kb/1015/100.x-addresses
    title: IP addresses in the 100.x.y.z range
    checked: 2026-08-10
  - id: magicdns
    url: https://tailscale.com/kb/1081/magicdns
    title: MagicDNS
    checked: 2026-08-10
  - id: tailnet
    url: https://tailscale.com/kb/1136/tailnet
    title: What is a tailnet
    checked: 2026-08-10
  - id: opensource
    url: https://tailscale.com/opensource
    title: Open source at Tailscale
    checked: 2026-08-10
  - id: repo
    url: https://github.com/tailscale/tailscale
    title: tailscale/tailscale GitHub repository
    checked: 2026-08-10
  - id: peer-relays
    url: https://tailscale.com/kb/1591/peer-relays
    title: Peer relays
    checked: 2026-08-10
  - id: firewall-ports
    url: https://tailscale.com/kb/1082/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: macos-variants
    url: https://tailscale.com/kb/1065/macos-variants
    title: Three ways to run Tailscale on macOS
    checked: 2026-08-10
  - id: key-expiry
    url: https://tailscale.com/kb/1028/key-expiry
    title: Key expiry
    checked: 2026-08-10
---

## The promise

1. You will be able to explain what Tailscale is in one sentence that survives contact with a packet capture: a WireGuard based mesh data plane, coordinated by a centralized control plane that never touches your traffic.
2. You will be able to draw the difference between a hub and spoke VPN and a mesh overlay, and say precisely which parts of Tailscale are which.
3. You will be able to name what actually runs on a machine (tailscaled, the CLI, the GUI wrapper) and what each piece is responsible for on each major OS.
4. You will be able to state what the coordination server sees, what it can never see, and why the private key staying on the node is the load bearing fact of the whole design.
5. You will be able to explain why every node gets a stable 100.x.y.z address, where that range comes from, and what a tailnet is as a unit of identity.
6. You will be able to sort Tailscale's components into open source and proprietary without guessing.

## Foundation

You already know most of the parts. You have configured a traditional VPN: a concentrator at the edge, IPsec or OpenVPN or an SSL VPN appliance, clients that dial in, and all remote traffic hairpinning through that one box. You know that topology is hub and spoke, and you know its two chronic diseases: the hub is a bandwidth and latency bottleneck, and the hub is a single point of failure.

You also know the control plane versus data plane split from routing. In a router, BGP and OSPF are the control plane: they decide where packets should go. The forwarding ASIC is the data plane: it actually moves packets. The control plane can be slow, chatty, and centralized without hurting throughput, because it carries decisions, not traffic.

You know NAT, and you have probably met RFC 6598, the 100.64.0.0/10 block reserved for carrier grade NAT, the range your ISP uses between its core and your home router precisely because it is guaranteed not to collide with RFC 1918 space inside your LAN.

And you know WireGuard at least by reputation: a minimal, fast, in-kernel-or-userspace tunnel protocol where each peer has a Curve25519 keypair and configuration is just "these public keys are allowed to talk to me at these addresses."

Tailscale is what you get when you take those four things you already know and wire them together with opinionated automation. Nothing in this module is exotic. The value is in seeing exactly how the pieces are arranged, because every later module assumes this arrangement.

## Core content

### Mesh where it counts, hub where it does not

Start with the topology problem. A classic corporate VPN puts a concentrator somewhere, often in one datacenter, and every client builds one tunnel to it. The blog post that anchors this module gives the canonical horror story: a worker in New York talking to a server in New York, with every packet detouring through a concentrator in San Francisco. The topology forces the detour. The hub sees, decrypts, and re-encrypts everything, which also makes it a fat target.

The obvious fix is a mesh: connect every node directly to every other node it needs to reach. The equally obvious reason nobody did this by hand is combinatorics. WireGuard tunnels are cheap, but a fully connected mesh of n nodes needs on the order of n squared peer relationships. The How Tailscale Works post does the arithmetic: a 10 node network needs 10 times 9, so 90, WireGuard tunnel endpoint configurations to maintain. Add key rotation, laptops that change IP addresses every time they move between coffee shop and cellular, and firewalls that block inbound connections, and manual mesh WireGuard collapses under its own bookkeeping.

Tailscale's move is to split the problem along the control plane and data plane line you already know from routers:

The data plane is a mesh. Actual traffic flows in WireGuard tunnels directly between nodes, node-a to node-b, encrypted end to end, taking the shortest network path the two nodes can negotiate.

The control plane is hub and spoke. Every node talks to a central coordination server to publish its public key, learn its peers' public keys and current endpoints, and receive policy. The blog is blunt about why this centralization is fine: the control plane is hub and spoke, but that does not matter, because it carries virtually no traffic. It carries decisions.

> [!HOW-IT-WORKS] Think of the coordination server as air traffic control. It tells every plane where the other planes are and who is cleared to land where, but no cargo ever passes through the tower. If the tower goes quiet, planes already in the air keep flying their existing clearances; you just cannot issue new ones.

Three ways to hold this first concept. Analogy: a phone book plus a switchboard operator who only hands out numbers, never joins calls. Mechanism: nodes upload their WireGuard public key and current network endpoints to the coordination server; the server distributes, to each node, the keys and endpoints of exactly the peers that node is allowed to reach; each node then programs its own local WireGuard instance with that peer list and dials peers directly. Failure mode: if the coordination server is unreachable, existing tunnels keep working because they need nothing from it packet to packet, but new devices cannot join, key rotations and ACL changes do not propagate, and nodes that change network location may fail to re-discover each other until control connectivity returns.

### What actually runs on your machine

Strip the branding and there are three pieces of software involved on a typical node.

First, tailscaled, the daemon. This is the engine. It maintains the connection to the coordination server, holds the node's private key, runs the WireGuard implementation (Tailscale embeds the userspace wireguard-go engine rather than requiring a kernel module), performs NAT traversal, and owns the TUN interface (typically tailscale0 on Linux) that the OS routes 100.x traffic into. On Linux and most server platforms, tailscaled is the whole product; you can run a server fleet without any GUI ever existing.

Second, the tailscale CLI. This is a thin client that talks to the local daemon over a local API socket. tailscale up, tailscale status, tailscale ping: none of these do networking themselves; they ask tailscaled to do it and print the answer. This split matters when debugging: if the CLI hangs or errors with a connection failure to the local socket, your problem is the daemon or its socket permissions, not the network.

Third, the GUI clients. On Windows and macOS, the menu bar or tray application is a control surface wrapped around the same daemon logic. On macOS specifically there are three distributions: the recommended standalone build, which implements the VPN as a system extension; the App Store build, which runs the engine as a network extension inside the sandboxed app; and an open source tailscaled-only variant that uses the kernel utun interface like a traditional daemon. That variety is why macOS debugging sometimes feels different from Linux debugging even though the engine code is the same. On iOS and Android, the app packages the engine inside the platform's VPN extension framework, because mobile operating systems only allow VPN functionality through those APIs.

Analogy: tailscaled is the engine block, the CLI is the diagnostic port, the GUI is the dashboard. Mechanism: one long-lived process holds keys and moves packets; everything else is a client of that process through a local API. Failure mode: the pieces can disagree. A GUI that shows "Connected" reflects the daemon's last known control connection state, not proof that packets flow to any particular peer; conversely a dead GUI process means nothing about the tunnel, which lives in the daemon. Always test the data plane (ping a peer's 100.x address) rather than trusting an indicator light.

> [!FROM-THE-FIELD] On servers, resist the habit of installing anything beyond the bare tailscaled package. The daemon plus CLI is the entire product on Linux, it survives reboots via the normal service manager, and there is no GUI state to drift. Every component you do not install is a component that cannot confuse you at 2 a.m.

### The coordination server: a dropbox for public keys

The coordination server (the control plane service Tailscale operates) does a short list of things, and the short list is the point.

What it does: authenticates users by bouncing them to an external identity provider; records which devices belong to which tailnet; acts as, in the blog's own words, a shared drop box for public keys; tells each node the public keys and last known endpoints of its permitted peers; stores the tailnet's access policy in one place and distributes the results to every node, which is how you get central control over policy but distributed enforcement; and helps broker NAT traversal so two nodes behind different firewalls can find each other.

What it does not do, and structurally cannot do: see your traffic. The WireGuard private key is generated on the node and, as the blog states flatly, the private key never, ever leaves its node. The coordination server only ever handles public keys. Since decrypting a WireGuard session requires a private key, the control plane could be fully compromised and the attacker still could not read your packets. What a compromised control plane could do is lie about policy and peers, which is a real threat class, but a different one from traffic interception, and later modules on ACLs and tailnet lock deal with it.

There is one more subtlety worth planting now. When two nodes cannot reach each other directly on any path (hostile NAT, UDP blocked outright), Tailscale falls back to relaying traffic through relay servers. The classic relays are DERP servers, Designated Encrypted Relay for Packets, operated by Tailscale around the world. A DERP relay does carry your traffic, but it carries it still encrypted; it blindly forwards already-encrypted bytes between nodes and, per the same source, there is never a way for a DERP server to decrypt your traffic. Newer clients (Tailscale 1.86 and later, checked 2026-08-10) can also use peer relays: nodes inside your own tailnet configured to relay for their peers. A peer relay likewise forwards only encrypted traffic, and when one is usable the client prefers it over DERP because it typically offers lower latency and higher throughput; peer relays complement DERP rather than replace it. So even the worst case fallback path preserves the invariant: only the two endpoint nodes hold the keys. Module 3 covers NAT traversal and both relay types in depth; for now, just file relays under "data plane fallback," not "control plane."

Analogy: the coordination server is a building directory in a lobby. It lists who is in the building and their suite numbers, and it decides whose names appear on your copy of the directory, but conversations happen behind closed doors it has no key to. Mechanism: nodes maintain an outbound HTTPS connection to the control service; over it they publish (public key, current endpoints) and subscribe to a filtered network map of their permitted peers; the node compiles that map into local WireGuard peer configuration. Failure mode: because the node only receives keys for peers it is allowed to talk to, a missing peer in tailscale status is very often a policy decision upstream, not a connectivity problem. Engineers burn hours pinging a node that the control plane simply never told them about.

> [!GOTCHA] "The coordination server is down" and "my VPN is down" are different sentences. Established peer connections continue without the control plane. If everything broke at once, suspect the local daemon, the local network, or an expired node key, not the mothership.

### Login, identity, and the tailnet

Tailscale does not have user accounts in the traditional sense. It always outsources authentication to an OAuth2, OIDC, or SAML identity provider: a Google account, Microsoft account, GitHub, Okta, and so on. When you run tailscale up on a fresh node, the daemon hands you a URL; you authenticate in a browser against your identity provider; the control plane witnesses that authentication and binds the node's public key to your identity. The blog notes a deliberate consequence: because your account data lives at the identity provider, the coordination service holds a minimum of personally identifiable information.

The thing your identity attaches to is a tailnet: the docs define it as a secure, interconnected collection of users, devices, and resources, created automatically the first time you authenticate. The tailnet is the blast radius of everything: it is the namespace your devices live in, the boundary your ACL policy applies to, the scope of your MagicDNS domain, and the unit that pricing plans and identity provider integrations attach to. Devices join a tailnet either as a user's device (authenticated as you) or as tagged infrastructure (authenticated as a role, like tag:server), a distinction that matters enormously once ACLs enter the picture in Module 5.

Analogy: a tailnet is a private area code. Every device you enroll gets a number in it, only members of the area code can dial each other, and the directory service only publishes numbers inside the code. Mechanism: identity provider authentication proves who you are; the control plane maps that identity to exactly one tailnet; every key it distributes and every policy it evaluates is scoped to that tailnet. Failure mode: logging in with the wrong identity, say a personal Gmail instead of the work identity provider, silently lands the device in a different tailnet. Everything reports healthy, and the device can see nothing you expected, because it is standing in a different building reading a different directory.

### Stable addresses from the CGNAT range

Every device in a tailnet is assigned one IPv4 address from 100.64.0.0/10, the special use range RFC 6598 reserved for carrier grade NAT. The choice is not aesthetic. RFC 1918 space (10/8, 172.16/12, 192.168/16) is already claimed by every home and office LAN a laptop will ever sit on; handing out overlay addresses from those ranges would guarantee collisions. The CGNAT block, per the addressing doc, does not conflict with the subnets commonly used for private networks, and using it fits, since Tailscale is functioning as a connectivity provider layered over your ISP.

Two properties of these addresses do heavy lifting. First, stability: the assigned address remains constant regardless of the device's physical location. Your laptop is 100.85.12.33 on office Wi-Fi, on hotel Wi-Fi, and on cellular, forever, until the node is removed from the tailnet. That means you can put a Tailscale IP in an SSH config, a database connection string, or a firewall rule and it stays valid across every network the device roams through. The overlay address identifies the machine; the underlay address (whatever the coffee shop DHCP handed out) merely locates it right now, and tailscaled tracks that part for you.

Second, one address in the range is infrastructure: 100.100.100.100, called Quad100, is a virtual service every node can reach locally, most importantly as the DNS resolver that powers MagicDNS.

Analogy: a Tailscale IP is like a phone number that follows a person rather than a desk. Mechanism: the control plane allocates each node a unique /32 from 100.64.0.0/10 at registration; tailscaled installs routes so traffic to 100.64.0.0/10 enters the TUN interface, where the daemon maps destination overlay address to peer public key and encrypts accordingly. Failure mode: collisions with other tenants of the same range. If another VPN product on the same host also uses CGNAT space, per the docs conflicts can occur, and you get ambiguous routing where 100.x packets go to the wrong interface. The symptom is a subset of the range working and another subset vanishing.

> [!ON-THE-WIRE] On the physical network, Tailscale traffic between two nodes appears as UDP between their underlay addresses (default port 41641 when it can get it), payload opaque WireGuard. The 100.x addresses never appear on the underlay wire; they exist only inside the encrypted tunnel and on the tailscale0 interface. A capture on eth0 shows the envelope; a capture on tailscale0 shows the letter.

### Names, briefly: MagicDNS

Remembering 100.85.12.33 is barely better than remembering any other IP, so the control plane also runs a naming layer. MagicDNS automatically registers DNS names for devices in your network. Each tailnet gets a DNS name, either a generated one or a personalized one like yak-bebop.ts.net, and each device gets machine-name.tailnet-name.ts.net. Search domains are pushed to the OS so the short machine name usually works alone: ssh node-b just resolves. MagicDNS has been enabled by default for tailnets created on or after October 20, 2022 (checked 2026-08-10), so on any recently created tailnet, names simply work without ceremony.

The mechanism, at this module's altitude: tailscaled configures the OS to send DNS queries to Quad100 at 100.100.100.100; the daemon answers tailnet names itself from the network map it already holds, and forwards everything else to your normal resolvers. The failure mode to file away: because Tailscale inserts itself into OS DNS configuration, DNS breakage on a Tailscale machine is a classic symptom class of its own, and Module 6 is devoted to it. If names break but tailscale ping by IP works, you have a naming problem, not a connectivity problem. Keeping those two layers separate in your head is half of Tailscale troubleshooting.

### What is open source and what is not

The split is clean once you see the rule (checked 2026-08-10). Client side, Tailscale's stated policy is that where the operating system is open source, the daemon and GUI are open source; where the operating system is closed, the daemon is open source and the GUI is closed. Concretely: the Linux and Android clients are fully open source; on Windows and macOS the engine, tailscaled and friends in the tailscale/tailscale repository, is open source while the GUI wrapper is proprietary. The DERP relay server is open source and self-hostable.

The coordination server, the control plane itself, is proprietary; it is the managed service you are paying for or using on a free plan. There is an independent open source reimplementation of the coordination protocol called Headscale, community maintained; Tailscale employs its head maintainer but does not set Headscale's product direction. That arrangement is worth knowing precisely: the official client software is what talks to Headscale, so the open source engine plus a self-hosted control plane is a fully open stack, at the cost of operating the control plane yourself and living without some managed features.

The practical takeaway for the mental model: the code that holds your private keys and moves your packets is inspectable on every platform. The proprietary parts are the control plane service and some GUI chrome, neither of which can read your traffic.

### The one diagram to keep

Everything above compresses into a single picture: two planes, different topologies, different jobs.

<svg viewBox="0 0 760 360" role="img" aria-label="Comparison of hub and spoke VPN topology with Tailscale's split control plane and mesh data plane">
  <title>Hub and spoke VPN versus Tailscale's two-plane design</title>
  <text x="150" y="28" text-anchor="middle" fill="var(--diagram-text)" font-size="15" font-weight="bold">Traditional VPN</text>
  <text x="540" y="28" text-anchor="middle" fill="var(--diagram-text)" font-size="15" font-weight="bold">Tailscale</text>
  <rect x="110" y="150" width="80" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="150" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="12">concentrator</text>
  <rect x="20" y="60" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="55" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-a</text>
  <rect x="210" y="60" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="245" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-b</text>
  <rect x="20" y="260" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="55" y="282" text-anchor="middle" fill="var(--diagram-text)" font-size="12">lab-vm-1</text>
  <rect x="210" y="260" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="245" y="282" text-anchor="middle" fill="var(--diagram-text)" font-size="12">cloud-1</text>
  <line x1="70" y1="94" x2="135" y2="150" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="230" y1="94" x2="165" y2="150" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="70" y1="260" x2="135" y2="190" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="230" y1="260" x2="165" y2="190" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="150" y="215" text-anchor="middle" fill="var(--diagram-text)" font-size="11">all traffic through hub</text>
  <rect x="490" y="150" width="100" height="40" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="540" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="12">coordination</text>
  <rect x="410" y="60" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="445" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-a</text>
  <rect x="600" y="60" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="635" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-b</text>
  <rect x="410" y="260" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="445" y="282" text-anchor="middle" fill="var(--diagram-text)" font-size="12">lab-vm-1</text>
  <rect x="600" y="260" width="70" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="635" y="282" text-anchor="middle" fill="var(--diagram-text)" font-size="12">cloud-1</text>
  <line x1="460" y1="94" x2="510" y2="150" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="620" y1="94" x2="570" y2="150" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="460" y1="260" x2="510" y2="190" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="620" y1="260" x2="570" y2="190" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="480" y1="77" x2="600" y2="77" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="480" y1="277" x2="600" y2="277" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="445" y1="94" x2="445" y2="260" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="635" y1="94" x2="635" y2="260" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="478" y1="94" x2="602" y2="260" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="602" y1="94" x2="478" y2="260" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="540" y="330" text-anchor="middle" fill="var(--diagram-text)" font-size="11">dashed: keys and policy only. solid: WireGuard traffic, direct</text>
</svg>

And the lifecycle of a node joining, as a sequence, because the order of operations explains most first-day confusion:

<svg viewBox="0 0 720 300" role="img" aria-label="Sequence of a node joining a tailnet: login, key upload, netmap download, direct WireGuard connection">
  <title>Node join sequence: control plane first, then data plane</title>
  <line x1="110" y1="55" x2="110" y2="270" stroke="var(--diagram-line)"/>
  <line x1="360" y1="55" x2="360" y2="270" stroke="var(--diagram-line)"/>
  <line x1="610" y1="55" x2="610" y2="270" stroke="var(--diagram-line)"/>
  <rect x="55" y="20" width="110" height="30" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="110" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-a</text>
  <rect x="300" y="20" width="120" height="30" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="360" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="12">coordination</text>
  <rect x="555" y="20" width="110" height="30" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-b</text>
  <line x1="110" y1="85" x2="360" y2="85" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <text x="235" y="78" text-anchor="middle" fill="var(--diagram-text)" font-size="11">1. login via identity provider</text>
  <line x1="110" y1="125" x2="360" y2="125" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <text x="235" y="118" text-anchor="middle" fill="var(--diagram-text)" font-size="11">2. upload public key + endpoints</text>
  <line x1="360" y1="165" x2="110" y2="165" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <line x1="360" y1="165" x2="610" y2="165" stroke="var(--diagram-accent)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <text x="360" y="158" text-anchor="middle" fill="var(--diagram-text)" font-size="11">3. netmap: permitted peers, keys, 100.x IPs</text>
  <line x1="110" y1="215" x2="610" y2="215" stroke="var(--diagram-line)" stroke-width="2.5"/>
  <text x="360" y="208" text-anchor="middle" fill="var(--diagram-text)" font-size="11">4. direct WireGuard tunnel, end to end encrypted</text>
  <text x="360" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">private keys never traverse steps 1 to 3</text>
</svg>

## On the wire

The orientation-level toolkit is three commands, all of which you will use in every later module.

First, identity and address:

```
$ tailscale ip -4
100.85.12.33
```

Second, the tailnet as the daemon sees it:

```
$ tailscale status
100.85.12.33   node-a       user@       linux   -
100.101.7.4    node-b       user@       macOS   active; direct 203.0.113.7:41641, tx 148832 rx 92210
100.90.44.19   lab-vm-1     user@       linux   idle, tx 5120 rx 4880
100.66.201.8   cloud-1      tag:server  linux   active; relay "atl", tx 33280 rx 27904
```

Read this like a routing table, because that is what it is: the node's compiled view of the netmap the control plane sent. Each line is a peer the control plane authorized. The connection column is the data plane truth: node-b is reached direct at a real underlay address and port, while cloud-1 is currently relayed through the Atlanta DERP. "idle" means a peer exists in the map but has no active WireGuard session right now; that is normal, sessions are established on demand.

Third, the layered ping, which separates overlay from underlay:

```
$ tailscale ping node-b
pong from node-b (100.101.7.4) via DERP(atl) in 42ms
pong from node-b (100.101.7.4) via 203.0.113.7:41641 in 9ms
```

That output is the whole NAT traversal story in two lines: the first probe went through the relay while both sides worked on hole punching, then the connection upgraded to a direct path and latency dropped by a factor of five. Module 3 explains how; for now, learn to read the shape.

> [!ON-THE-WIRE] tailscale ping tests the Tailscale layer: can the daemon reach the peer's daemon over WireGuard. Regular ping to a 100.x address tests that plus the OS routing on both ends. When tailscale ping succeeds and ICMP ping fails, suspect a host firewall or routing on an endpoint, never the tunnel.

For control plane versus data plane visibility, tailscale netcheck reports what the underlay permits, with no tailnet involved at all:

```
$ tailscale netcheck
Report:
  * UDP: true
  * IPv4: yes, 198.51.100.24:41641
  * IPv6: no, but OS has support
  * MappingVariesByDestIP: false
  * Nearest DERP: Atlanta
  * DERP latency:
    - atl: 11.8ms  (Atlanta)
    - ord: 27.3ms  (Chicago)
    - nyc: 31.9ms  (New York City)
```

UDP true and a stable mapping predict direct connections. UDP false predicts life on a relay. This command is the first thing to run on any misbehaving network.

In a packet capture on the physical interface, Tailscale traffic between peers is UDP, WireGuard framed, between underlay addresses, plus a persistent outbound HTTPS connection to the control service and, when relaying through DERP, an HTTPS connection on port 443 to a DERP server. The 100.x addresses appear only on the virtual interface. If a middlebox admin asks you what to allow, the honest orientation answer is: outbound UDP (41641 outbound, plus UDP 3478 for STUN) if you want good paths, outbound 443 as the floor beneath which Tailscale still functions, relayed.

## Failure modes

A catalog of how this layer breaks, with the observable symptom for each. Later modules deepen most of these.

1. Control plane unreachable, tunnels alive. Symptom: existing peer connections keep passing traffic, but tailscale status shows a stale view, new logins hang at the auth URL, and ACL or key changes do not take effect. The split-plane design makes this a degraded state, not an outage.
2. Daemon not running or local socket broken. Symptom: every tailscale CLI command fails immediately with a local connection error before any network is involved. This is a host problem: check the service manager, not the network.
3. Wrong tailnet login. Symptom: the client reports healthy, has a 100.x address, and sees either no peers or an unfamiliar set. The device authenticated against the wrong identity and is standing in a different tailnet. Check the account shown in tailscale status output or the admin console.
4. Policy filtered peer. Symptom: a machine you know exists never appears in tailscale status. The control plane only distributes keys for permitted peers, so an ACL that denies you a peer makes that peer invisible, not merely unreachable.
5. Expired node key. Symptom: a long-running server drops off the tailnet after months of flawless service, and logs show the daemon needing reauthentication. Node keys expire by default (180 days for new tailnets, checked 2026-08-10) and the machine needs a fresh login, or key expiry disabled for that device in the admin console. The insidious part is the delay: it breaks long after anyone touched the box.
6. UDP-hostile network. Symptom: everything works but latency is high and tailscale status shows relay for peers that used to be direct. The underlay is blocking UDP or NAT is unfriendly, so traffic rides a relay (DERP, or a peer relay if your tailnet runs one). Functional, slower, and a Module 3 problem to diagnose properly.
7. CGNAT range collision. Symptom: some or all 100.x destinations become unreachable while the tailnet looks healthy, typically after connecting another VPN that also claims 100.64.0.0/10 space on the host. Two claimants to the same routes are fighting; inspect the routing table.
8. DNS integration breakage. Symptom: tailscale ping node-b works by name from the daemon's perspective but applications cannot resolve tailnet names, or worse, all DNS on the host fails. The OS resolver configuration and Quad100 are out of sync. Connectivity is fine; naming is broken. Module 6 territory.
9. Component state disagreement. Symptom: GUI says connected while nothing passes, or the GUI is closed and someone assumes the VPN is off while the daemon happily forwards. Trust the daemon and the data plane test, not the indicator.

> [!GOTCHA] The single most common orientation-level misdiagnosis is treating an invisible peer (failure mode 4) as a connectivity failure. No amount of pinging, restarting, or firewall fiddling will surface a peer the control plane never told your node about. When a machine is missing from tailscale status, go read policy before you touch the network.

## Check yourself

**Scenario 1.** A colleague reports: "The Tailscale status page says the coordination service is having an incident, so our site-to-site traffic between lab-vm-1 and cloud-1 must be down. Why are the graphs still showing traffic?"

Answer: The graphs are correct and the reasoning is wrong. The coordination server is control plane only: it distributes public keys, endpoints, and policy, and it carries none of the data traffic. lab-vm-1 and cloud-1 already hold each other's public keys and have an established WireGuard session, so packets continue to flow directly between them with no dependency on the control service, exactly as a router keeps forwarding on its existing FIB while its BGP session flaps. What the incident does affect: new devices cannot authenticate and join, policy and key changes will not propagate, and if one of the two nodes changes its underlay network mid-incident, re-discovery of its new endpoint may fail until control connectivity returns. The correct posture during a control plane incident is: avoid restarting or re-authenticating nodes, avoid network changes on the endpoints, and let established tunnels ride it out.

**Scenario 2.** A developer runs tailscale status on node-a and sees node-b and cloud-1 but not lab-vm-1, which they need. They have spent an hour running ping against lab-vm-1's IP from an old note, restarting tailscaled, and toggling their Wi-Fi. What do they actually need to check, and why was every step they took useless?

Answer: The missing line in tailscale status is the tell. The coordination server gives each node the public keys of only the peers that node is permitted to reach, so a peer that is absent from status was withheld by the control plane, for one of a few reasons: an ACL that does not grant node-a access to lab-vm-1, lab-vm-1 having been removed from the tailnet or its node key having expired, or the two machines being in different tailnets entirely (for example, lab-vm-1 was enrolled under a different identity). Every local action was useless because the node cannot connect to a peer it has no key for: pinging cannot succeed without a tunnel, restarting the daemon just re-downloads the same filtered netmap, and Wi-Fi toggling changes the underlay, which was never the problem. The fix lives upstream: check the admin console for lab-vm-1's presence and key status, and check the tailnet policy for a rule permitting this user or device to reach it. The general lesson: in Tailscale, visibility is policy; reachability is networking. Diagnose them in that order.

**Scenario 3.** From a hotel, tailscale ping cloud-1 returns "via DERP(nyc) in 96ms" and never upgrades, while at home the same command shows a direct path at 12ms. Is the tunnel less secure at the hotel, and what changed?

Answer: Security is unchanged; the path is worse. At the hotel, the network is blocking outbound UDP or running NAT hostile enough that hole punching fails, so instead of a direct WireGuard flow between underlay addresses, both nodes forward their traffic through a DERP relay over connections the hotel firewall permits. The DERP server carries your packets but cannot read them: it blindly forwards already-encrypted WireGuard payloads, and the private keys needed to decrypt them never leave node-a and cloud-1. End to end encryption is identical on both paths; you pay in latency and throughput, not confidentiality. Confirm the diagnosis with tailscale netcheck: expect "UDP: false" or a mapping that varies by destination. The changed variable is the underlay's treatment of UDP, nothing in your tailnet. If the hotel network relented, the connection would upgrade to direct automatically, which is exactly the two-line pattern (relay pong, then direct pong) you look for in tailscale ping output.

## What you now have

1. A one-sentence definition that matches the wire: WireGuard mesh data plane, centralized coordination control plane, traffic never through the middle.
2. The two-plane mental model, borrowed from routing, that predicts what breaks when the control plane is unreachable versus when the daemon or underlay is.
3. Knowledge of the actual moving parts on a machine: tailscaled holds keys and moves packets, the CLI and GUI are clients of it.
4. The invariant that carries the security story: private keys never leave the node, so neither the coordination server nor any relay (DERP or peer relay) can read traffic.
5. Stable identity primitives: the tailnet as the unit of identity and policy, one constant 100.64.0.0/10 address per device, MagicDNS names on top.
6. A clean open source map: engine open everywhere, closed-OS GUIs and the coordination service proprietary, Headscale as the independent control plane.
7. Three commands (tailscale status, tailscale ping, tailscale netcheck) and the habit of reading them as netmap, path, and underlay report.

## Cross references

- Module 1, WireGuard foundations: opens the tunnel itself, the Noise handshake, keypairs, and why the peer list tailscaled programs is all WireGuard needs.
- Module 2, the control plane: the coordination server's full story, netmaps, key distribution, and exactly what breaks when it is unreachable.
- Module 3, NAT traversal, STUN, DERP, and Peer Relays: expands step 4 of the join sequence, how direct paths are negotiated, why the hotel scenario relays, and how to read netcheck like a pro.
- Module 4, identity and auth: the node key lifecycle behind failure mode 5. Tailnet Lock, the defense against a lying control plane, arrives with Module 10.
- Module 5, policy, ACLs and grants: the control plane's policy distribution in full, including why invisible peers are a feature and how tags change identity.
- Module 6, MagicDNS and split DNS: everything this module waved at with Quad100 and search domains, plus the DNS failure taxonomy.
- Module 7, routing: subnet routers and exit nodes, how the mesh extends to devices that cannot run tailscaled, bending the pure-mesh topology on purpose.
