---
module: 2
slug: control-plane
title: The control plane
description: How the Tailscale coordination server registers nodes, distributes keys and policy, and what freezes when it goes away.
order: 2
words: 4300
sources:
  - id: how-it-works
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works
    checked: 2026-08-10
  - id: auth-keys
    url: https://tailscale.com/kb/1085/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: key-expiry
    url: https://tailscale.com/kb/1028/key-expiry
    title: Key expiry
    checked: 2026-08-10
  - id: acls
    url: https://tailscale.com/kb/1018/acls
    title: Manage permissions using ACLs (tailnet policy file)
    checked: 2026-08-10
  - id: tags
    url: https://tailscale.com/kb/1068/tags
    title: Tags
    checked: 2026-08-10
  - id: control-data-planes
    url: https://tailscale.com/docs/concepts/control-data-planes
    title: Control and data planes
    checked: 2026-08-10
  - id: coord-down
    url: https://tailscale.com/docs/reference/coordination-server-down
    title: What happens if the coordination server is down?
    checked: 2026-08-10
  - id: peer-relays
    url: https://tailscale.com/kb/1591/peer-relays
    title: Peer relays
    checked: 2026-08-10
  - id: opensource
    url: https://tailscale.com/opensource
    title: Open source at Tailscale
    checked: 2026-08-10
  - id: tailscale-repo
    url: https://github.com/tailscale/tailscale
    title: tailscale/tailscale (client and map protocol source)
    checked: 2026-08-10
---

## The promise

1. You will be able to explain what the coordination server does and, just as important, what it never does: it moves keys and policy, never your packets.
2. You will be able to walk through node registration end to end, for both interactive SSO login and auth key enrollment, and pick the right method for a given machine.
3. You will be able to define a netmap, describe what is in it, and explain how it reaches a client and when it updates.
4. You will be able to reason about key expiry and rotation, including why tagged servers behave differently from user laptops.
5. You will be able to describe how the tailnet policy file is distributed and where ACL enforcement actually happens.
6. You will be able to predict exactly what keeps working and what freezes when the control plane is unreachable, and explain why an outage degrades gradually instead of all at once.

## Foundation

You already know this pattern from other systems, even if the names differ.

If you have run a routing protocol, you know the difference between the control plane and the data plane. OSPF or BGP sessions exchange reachability information; the forwarding plane pushes packets. Kill the BGP session and forwarding continues on the last-known RIB until routes age out. Tailscale is built on exactly that separation, and the failure behavior rhymes with it.

If you have run a PKI, you know the shape of the enrollment problem: a device generates a keypair, proves its identity to some authority, and the authority vouches for the binding between key and identity. Tailscale's coordination server plays the role of the registration authority and the directory, but with one hard rule inherited from WireGuard: the private key is generated on the node and never leaves it.

If you have managed RADIUS or 802.1X, you know the difference between a person authenticating (user identity) and a machine authenticating (device credential). Tailscale has both: interactive SSO login binds a node to a user, and auth keys plus tags bind a node to a role instead.

Module 1 covered WireGuard itself: the tunnels, the cryptography, the fact that a WireGuard peer is identified by its public key and needs to know that key plus an endpoint to talk. This module answers the question Module 1 left open: who tells every node about every other node's keys and endpoints, and on what authority?

## Core content

### What the coordination server is

The coordination server is Tailscale's control plane: a hub-and-spoke service (for the hosted product, run by Tailscale) that every node talks to over HTTPS. Tailscale's own description is blunt about how little it carries: "The so-called 'control plane' is hub and spoke, but that doesn't matter because it carries virtually no traffic." It exchanges small key and policy payloads; the data plane, where your packets actually flow, is a mesh between nodes.

The analogy: the coordination server is a switchboard operator who never carries a conversation, or, in Tailscale's own docs, an air traffic controller. It knows who everyone is, where they currently are, and who is allowed to talk to whom. It connects parties by telling them about each other. The actual conversation, the WireGuard tunnel, runs directly between nodes.

The mechanism: the server maintains a registry of every device in your tailnet: its public node key, its assigned Tailscale IP, its advertised endpoints, its OS and version metadata, its owner or tags. From that registry plus your policy file, it computes a per-node view of the network and pushes it out. That per-node view is the netmap, covered below.

The failure mode: because it is a hub, it is a single logical point of coordination. If it is unreachable, nothing about the existing mesh breaks immediately, but the network stops changing. New devices cannot join, keys cannot rotate, policy edits do not propagate. The network freezes in its last-known state and then decays slowly as keys expire. This gradual decay, not sudden death, is the signature failure mode of the whole layer.

> [!HOW-IT-WORKS] The client's link to control is a long-lived HTTPS connection to the coordination server, with a Noise-protocol channel run inside it: the channel is keyed by the node's machine key and a known control server key, so a middlebox that terminates TLS still cannot read the exchange or impersonate control. Over that connection the client sends a map request and then holds the connection open; the server streams down incremental map responses whenever something changes. The protocol lives in the open source client at github.com/tailscale/tailscale. Checked 2026-08-10.

### Node registration: what happens when a machine joins

Every enrollment, regardless of method, follows the same skeleton, described in Tailscale's architecture blog:

1. The node generates a random public/private keypair locally. "The private key never, ever leaves its node."
2. The node contacts the coordination server and leaves its public key plus "a note about where that node can currently be found, and what domain it's in." That "note" is its current set of candidate endpoints: local IPs and ports, plus its best guess at its public IP as seen through NAT.
3. The node proves who it is (this is where the two auth methods diverge).
4. The node downloads the list of public keys and endpoints for the peers it is allowed to see, and configures its WireGuard instance with them.

The analogy: joining a tailnet is checking into a hotel. You bring your own lock (keypair), the front desk verifies your ID (auth), writes down your room number (endpoints), and gives you a guest directory listing only the rooms you are allowed to call.

The mechanism, for the two auth paths:

**Interactive SSO login.** You run `tailscale up`, get a URL, and complete a browser login against your identity provider. The coordination server binds the node's key to your user identity. This is the right path for machines with a human attached: laptops, workstations, phones. The device inherits the user's identity for ACL purposes, and its key expires on the tailnet's expiry schedule so the human periodically re-proves who they are.

**Auth keys.** You mint a key in the admin console (or via the API) and enroll non-interactively:

```
sudo tailscale up --auth-key=tskey-auth-kFxxxxCNTRL-xxxxxxxxxxxxxxxxxxxxxxxx
```

This is the right path for machines with no human attached: cloud instances, containers, CI runners, appliances. Auth keys come in two base flavors with modifiers layered on:

- **One-off** keys authenticate exactly one device. Good for a single cloud server.
- **Reusable** keys authenticate many devices. Good for fleet provisioning, and correspondingly more dangerous if leaked.
- **Ephemeral** modifier: devices enrolled with it are automatically removed after they go offline. Built for containers and short-lived CI workers that would otherwise pile up as ghost entries in your machine list.
- **Pre-approved** modifier: skips the device approval queue on tailnets that require approval.
- **Tagged** keys: enroll the device directly with one or more tags instead of a user identity. This is the modifier that matters most for servers, for reasons covered in the tags section.

Auth keys themselves expire: you choose between 1 and 90 days when you create one, and the default is the 90-day maximum if you do not specify. An expired auth key can no longer enroll new devices, but, and this is a distinction that bites people, "any device authorized by it remains authorized until its node key expires." The auth key is a birth certificate, not a heartbeat.

> [!GOTCHA] Revoking an auth key does not deauthorize the nodes that used it. Tailscale's docs are explicit: "Revoking a key does not deauthorize nodes using the key." If a reusable key leaks and you revoke it, you have only stopped future enrollments. You must separately find and remove every machine the leaked key enrolled, via the Machines page or API. Plan your incident response around both steps.

The failure mode of registration: a leaked reusable auth key is the classic one. Anyone holding it can join your tailnet as whatever identity or tags the key grants, until it expires or is revoked, and their machines persist even after revocation. Scope keys tightly (short expiry, tags with minimal ACL reach, ephemeral where possible), treat them like passwords, and prefer OAuth clients with the Tailscale API for programmatic provisioning workflows where you want scoped, renewable credentials instead of a static secret.

### The netmap: the one document that defines your network

The netmap (network map) is the per-node answer to "what does my network look like right now?" It is what the coordination server actually distributes. For a given node, the netmap contains, at minimum:

- The node's own identity as control sees it: its Tailscale IPs, its user or tags.
- The set of peers this node is allowed to communicate with, each with its public node key, Tailscale IPs, and current endpoints.
- The packet filter: the compiled-down subset of the tailnet policy file that applies to this node.
- Network configuration: DNS settings, DERP relay map, and similar plumbing.

The analogy: the netmap is a personalized phone book. Not the whole directory, just the pages you are cleared to see, with each contact's current phone number (endpoints), the secret needed to have a private call (public key), and a standing list of who may call you (packet filter).

The mechanism: the client opens its long-poll connection to control and receives a full netmap, then incremental updates as peers come and go, change endpoints, or as policy changes. This is why changes you make in the admin console appear on nodes within seconds while everything is healthy: every online node is already holding an open connection that control can push down. The netmap is also how public key distribution actually happens. No node ever asks another node for its key; keys only arrive via the netmap, from control. This centralization is the trust tradeoff at the heart of Tailscale's design: the coordination server controls which public keys you learn, and therefore who you will build tunnels with. It cannot read your traffic (it never has private keys), but it defines your view of the network. Module 1's crypto guarantees are scoped by this module's distribution mechanism.

Endpoint discovery and sharing rides the same rails. Each node continuously probes its own connectivity (local addresses, NAT mappings, DERP latency) and reports its candidate endpoints to control; control shares those candidates with authorized peers in their netmaps. When two nodes want to talk, each already knows the other's candidate endpoints and public key, so they can attempt direct paths immediately. The full NAT traversal dance is Module 3's subject; what matters here is that control is the introduction service that makes the dance possible.

The failure mode: a stale netmap. If a node's control connection is down, it keeps operating on the last netmap it received. Peers that moved to new endpoints since then may become unreachable directly (though relays can mask this), newly added peers do not exist as far as this node is concerned, and revoked peers are still trusted. Staleness is invisible until you look for it, which is why the On the wire section shows you how to look.

<div class="diagram-wrap">
<svg viewBox="0 0 760 420" role="img" aria-label="Sequence of node registration and netmap distribution between a new node, the coordination server, and an existing peer">
  <title>Node registration and netmap distribution</title>
  <line x1="120" y1="60" x2="120" y2="390" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <line x1="380" y1="60" x2="380" y2="390" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <line x1="640" y1="60" x2="640" y2="390" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <rect x="55" y="20" width="130" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a (new)</text>
  <rect x="310" y="20" width="140" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="14">coordination</text>
  <rect x="575" y="20" width="130" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="640" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b (peer)</text>
  <line x1="120" y1="95" x2="374" y2="95" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="250" y="86" text-anchor="middle" fill="var(--diagram-text)" font-size="12">1. pubkey + endpoints</text>
  <line x1="120" y1="140" x2="374" y2="140" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="250" y="131" text-anchor="middle" fill="var(--diagram-text)" font-size="12">2. auth (SSO or auth key)</text>
  <line x1="380" y1="185" x2="126" y2="185" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="250" y="176" text-anchor="middle" fill="var(--diagram-text)" font-size="12">3. netmap: peers + filter</text>
  <line x1="380" y1="230" x2="634" y2="230" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="510" y="221" text-anchor="middle" fill="var(--diagram-text)" font-size="12">4. netmap update: node-a added</text>
  <line x1="120" y1="300" x2="634" y2="300" stroke="var(--diagram-line)" stroke-width="2.5"/>
  <text x="380" y="290" text-anchor="middle" fill="var(--diagram-text)" font-size="12">5. direct WireGuard tunnel (data plane)</text>
  <text x="380" y="330" text-anchor="middle" fill="var(--diagram-text)" font-size="11">control never touches step 5 traffic</text>
  <rect x="70" y="355" width="620" height="28" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="374" text-anchor="middle" fill="var(--diagram-text)" font-size="11">private keys never leave node-a or node-b</text>
</svg>
</div>

### Key expiry and rotation

Node keys are not forever. By default, a new tailnet expires node keys after 180 days, and the period is configurable between 1 and 180 days in the admin console. When a node's key expires without reauthentication, the consequence is total for that node: "connections to/from the given endpoint will stop working."

The analogy: a node key is a visitor badge with a printed expiry date. The building does not care how long you have been inside or how important your meeting is; when the badge lapses, doors stop opening, and you go back to the front desk (your identity provider) to get a new one.

The mechanism: reauthentication mints fresh key material and re-binds it to the identity. On a machine you can reach, `sudo tailscale up --force-reauth` performs it. For a remote machine whose key already expired (and which you can therefore no longer reach over Tailscale), the admin console offers "Temporarily extend key," which revives the node for 30 minutes so someone can log in and reauthenticate properly; after successful reauthentication the key is renewed for the standard expiry period. Administrators can also disable expiry per device from the Machines page, on every pricing plan.

Two behaviors here are policy decisions disguised as defaults, and you should know both:

1. **User devices expire by default.** The point is to force periodic re-proof of identity: a stolen laptop's access dies on its own within the expiry window even if nobody notices the theft.
2. **Tagged devices do not expire by default.** "When you apply a tag to a device for the first time and authenticate it, the tagged device will have key expiry disabled by default." Servers have no human available to click through an SSO flow at 3 a.m. on day 180, so Tailscale ships the sane default for infrastructure.

The failure mode: the day-180 massacre. A team enrolls a fleet of servers under a user identity (someone's personal login, because it was quick), never tags them, and never disables expiry. Six months later, machines start falling off the network on a rolling schedule matching their enrollment dates. The fix is structural, not operational: infrastructure belongs under tags, which brings us to the next section.

> [!FROM-THE-FIELD] Audit your machine list for servers still bound to a human's identity with expiry enabled. Sort the admin console's Machines page by expiry date and look for anything headless in the next 30 days. Every one of those is a scheduled outage with a date already printed on it. Re-enroll them with a tagged auth key, or at minimum disable expiry per device, and do it before the badge lapses, because after expiry you cannot reach the machine over Tailscale to fix it.

### Tags versus user identities

Every device in a tailnet has exactly one kind of identity: it belongs to a user, or it carries tags. Never both. Tailscale is categorical: "it's impossible for a user account identity and a tag identity to exist on the same device," and "applying a tag to a device previously authenticated with a user account removes the user account." In the other direction, "authenticating a device with a user account removes all tags from the device."

The analogy: user identity is a name badge; a tag is a uniform. A name badge says who you are, and your permissions follow you across every device you log into. A uniform says what you do: anyone (well, any machine) wearing `tag:webserver` gets webserver permissions, regardless of which human racked it. You cannot wear a name badge and claim the uniform's authority at the same time; the system forces you to pick.

The mechanism: tags are declared in the tailnet policy file's `tagOwners` section, which doubles as an authorization list: only owners of a tag can apply that tag to devices, though Owners, Admins, and Network admins can apply any tag. Once a device is tagged, ACL rules target the tag (`tag:prod-db`) instead of a person, the device stops representing any user, and, as covered above, its key expiry is disabled by default. A device can carry multiple tags to reflect multiple roles, and its identity is the combination of all its tags. Tags function like service accounts, with the flexibility of applying several at once.

The failure mode: tag sprawl and orphaned authority. Because tagged devices do not expire by default, a tagged machine is trusted until someone actively removes it. If your `tagOwners` list is loose (many owners, broad tags with wide ACL grants), any of those owners can mint long-lived infrastructure identity. Treat `tagOwners` as a privileged escalation path in reviews, because that is what it is: the right to apply a tag is the right to grant that tag's network access, indefinitely.

### ACL policy distribution: written centrally, enforced locally

The tailnet policy file is a single HuJSON (human-friendly JSON, with comments and trailing commas) document, edited in the admin console or managed as code via the API. It defines access rules, tag ownership, and related policy. Two syntaxes coexist as of 2026: the older `acls` section and the newer grants; both follow a deny-by-default principle once present. One default deserves a callout of its own:

> [!GOTCHA] A brand-new tailnet with no `acls` section applies a default allow-all policy: every device can reach every device. That is a deliberate onboarding choice, not a security posture. The moment your tailnet holds anything you would not want a compromised laptop to reach, replace the default with explicit rules. An empty `acls` section denies everything, which is the correct starting point to build up from.

Distribution and enforcement are where Tailscale diverges from the firewall appliances you are used to. There is no chokepoint that sees traffic and applies rules. Instead, ACLs are enforced locally: the coordination server compiles the policy file into per-node packet filters, ships each node its relevant slice inside the netmap, and "rule enforcement happens on each device directly." Enforcement applies to incoming connections on the receiving device.

The analogy: instead of one guarded gate into the campus (a perimeter firewall), every office door has its own badge reader, and building security (control) programs all the readers from one master list. Traffic between offices never detours through a guard post; the door you knock on decides.

The mechanism has a subtle optimization with visible consequences: control only tells a node about peers it could possibly communicate with. In the architecture blog's terms, the coordination server protects nodes by giving each node the public keys of only the nodes that are supposed to connect to it. If policy says node-a may never reach cloud-1, node-a's netmap simply omits cloud-1. This is why `tailscale status` on a locked-down node shows a short list even in a large tailnet: the phone book you receive was already censored.

The failure mode: policy propagation depends on the control connection. A node that is offline or cut off from control keeps enforcing its cached filter. If you push an emergency "block the compromised host" rule, every healthy node applies it within seconds, but a node that cannot reach control keeps honoring the old policy until it reconnects. Locally enforced also means locally trusted: enforcement runs inside tailscaled on the receiving host, so a fully compromised host (root access) cannot be relied on to police traffic addressed to itself. ACLs bound what the rest of the fleet accepts; defense of a compromised node itself needs layers below Tailscale.

### When the control plane goes away

This is the question the whole module builds toward: the coordination server is unreachable (Tailscale outage, your WAN link to it is down, DNS is broken). What still works?

Almost everything, at first. Tailscale routes no user traffic through the coordination server, so the data plane does not care that control is gone:

- Existing direct WireGuard connections keep flowing.
- Relayed connections keep flowing too. DERP relays (Module 3) are separate infrastructure from the coordination server, and peer relays (generally available as of 2026, on Tailscale v1.86 or later; checked 2026-08-10) are ordinary devices inside your tailnet that relay traffic when direct connections are not possible, so they live in the data plane as well.
- New connections between nodes that already know each other from their cached netmaps can still be established; keys are stored locally.
- Cached ACLs keep being enforced: "Firewall rules are cached and enforced on each device, meaning that your existing rules and access control policies will continue to function."

What stops, immediately and completely, is change:

- New devices and users cannot join.
- Keys cannot be refreshed or exchanged, so "existing devices will gradually lose access to each other" as node keys hit their expiry dates with no way to renew.
- Policy edits do not propagate; the network runs on the last-distributed rules.
- Key revocation does not propagate either: you cannot cut off a compromised device until control returns.

The analogy: the air traffic controller has left the tower. Planes already in the air keep flying their filed routes just fine. Nobody new takes off, nobody's route changes, and nobody can be ordered out of the sky. The longer the tower stays dark, the more planes run out of fuel (key expiry) and drop out, one by one, on a schedule fixed before the outage began.

The mechanism behind the gradual decay: each node's key has its own expiry timestamp based on when it last authenticated. Those timestamps are scattered across the fleet, so an extended control outage does not kill the network at a single moment; it erodes it node by node as individual badges lapse, and the docs note the expiry time is device-dependent for exactly this reason. Tagged infrastructure with expiry disabled would, in principle, keep meshing on cached state indefinitely; user laptops die first.

The failure mode worth designing for is not the outage itself but the freeze: during an outage your network is exactly as good, and exactly as bad, as its last-distributed state. Whatever access existed when control vanished is the access you live with until it returns. This cuts both ways: resilient (nothing breaks) and rigid (nothing can be fixed).

<div class="diagram-wrap">
<svg viewBox="0 0 760 340" role="img" aria-label="State of a tailnet during a control plane outage: mesh data plane continues, control functions frozen">
  <title>Control plane outage: what freezes and what flows</title>
  <rect x="290" y="20" width="180" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-dasharray="6 4"/>
  <text x="380" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="13">coordination</text>
  <text x="380" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="11">UNREACHABLE</text>
  <line x1="330" y1="70" x2="170" y2="160" stroke="var(--diagram-line)" stroke-dasharray="4 5"/>
  <line x1="380" y1="70" x2="380" y2="160" stroke="var(--diagram-line)" stroke-dasharray="4 5"/>
  <line x1="430" y1="70" x2="590" y2="160" stroke="var(--diagram-line)" stroke-dasharray="4 5"/>
  <text x="255" y="110" text-anchor="middle" fill="var(--diagram-text)" font-size="11">no netmap updates</text>
  <text x="530" y="110" text-anchor="middle" fill="var(--diagram-text)" font-size="11">no key renewal</text>
  <rect x="110" y="160" width="120" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="170" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a</text>
  <rect x="320" y="160" width="120" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-b</text>
  <rect x="530" y="160" width="120" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="590" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">cloud-1</text>
  <line x1="230" y1="180" x2="320" y2="180" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <line x1="440" y1="180" x2="530" y2="180" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <path d="M 170 200 Q 380 270 590 200" fill="none" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="380" y="255" text-anchor="middle" fill="var(--diagram-text)" font-size="11">data plane mesh: still flowing on cached keys + cached ACLs</text>
  <rect x="120" y="285" width="520" height="34" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="307" text-anchor="middle" fill="var(--diagram-text)" font-size="11">frozen: joins, policy edits, revocations, key rotation, new peers</text>
</svg>
</div>

### Headscale, in one paragraph

The Tailscale client, including the tailscaled daemon and the tailscale CLI, is open source, but the hosted coordination server is proprietary. Headscale fills that gap: in Tailscale's own words, it is "an open-source implementation of Tailscale's coordination server," developed "independently and separately from Tailscale," and pointed at by self-hosters who want the entire control plane under their own roof. Tailscale's relationship to it is unusually cordial for a commercial vendor: Headscale's lead maintainer, Kristoffer Dalby, works at Tailscale so the company can support his efforts, while Tailscale "does not set Headscale's product direction or manage its community," and the company states plainly that "a healthy Headscale project is good for the broader Tailscale ecosystem." For this field guide, everything in this module about registration, netmaps, and control outages applies conceptually to any coordination server, hosted or Headscale; the operational details and feature surface differ, and Headscale is its own project with its own docs. Checked 2026-08-10.

## On the wire

Control traffic is easy to spot precisely because there is so little of it: HTTPS to Tailscale's control infrastructure, long-lived, mostly idle, with small bursts when the netmap changes. If you are watching a node's egress, the control connection is a single persistent TLS session, not a stream of per-packet chatter. Your actual data rides the WireGuard mesh on UDP and never touches these endpoints.

Enrollment with an auth key, from a fresh cloud instance:

```
$ sudo tailscale up --auth-key=tskey-auth-kF3xample1CNTRL-x9y8z7w6v5u4t3s2r1q0
Success.
```

The same machine, interactively, would instead print a login URL and wait for the SSO flow to complete in a browser.

`tailscale status` is your daily view of the netmap's peer list. Note the identity column: node-a belongs to a user, cloud-1 belongs to tagged-devices:

```
$ tailscale status
100.84.1.23   node-a        alice@      linux    -
100.99.7.101  node-b        alice@      macOS    active; direct 203.0.113.7:41641, tx 88420 rx 61233
100.71.3.9    cloud-1       tagged-devices linux idle, tx 1024 rx 2048
100.66.5.44   lab-vm-1      bob@        linux    offline
```

When you want the raw truth rather than the summary, the client will show you its actual current netmap:

```
$ tailscale debug netmap | head -n 14
{
  "NodeKey": "nodekey:1f2e3d4c...",
  "Name": "node-a.tail1234.ts.net.",
  "Addresses": ["100.84.1.23/32", "fd7a:115c:a1e0::2301:1723/128"],
  "Peers": [
    {
      "Name": "cloud-1.tail1234.ts.net.",
      "Key": "nodekey:9a8b7c6d...",
      "Addresses": ["100.71.3.9/32"],
      "Endpoints": ["198.51.100.20:41641", "10.0.0.5:41641"]
    }
  ],
  ...
```

There it is, the whole module in one JSON blob: peer public keys and candidate endpoints, delivered by control, consumed by WireGuard. A peer missing from this list is a peer your policy does not let you see.

In `tailscaled` logs, a healthy control relationship looks like periodic map updates; an unhealthy one announces itself:

```
control: netmap: got new map (2 peers)
control: mapRequest: stream ended: context deadline exceeded
control: connect to controlplane.tailscale.com: dial tcp: i/o timeout
health: not connected to control plane (last contact 14m ago)
```

> [!ON-THE-WIRE] The sharpest diagnostic distinction this module gives you: with control down, `tailscale status` still lists peers (cached netmap) and pings to established peers still succeed, while the health messages complain about control. If instead peers are missing from status entirely, that is not an outage symptom; that is policy or enrollment, because control deliberately omitted them from your netmap. "I can ping it but control is unhappy" and "it is not in my list at all" have completely different root causes.

## Failure modes

1. **Control plane unreachable.** Symptom: existing connections fine, health warnings about control plane contact in `tailscale status` and logs, no new devices can join, admin console changes have no effect on nodes. Gradual peer loss begins only as individual keys expire.
2. **Node key expired.** Symptom: one machine drops off the tailnet entirely; peers show it offline; the machine itself logs that reauthentication is needed. If it is remote and headless, you are locked out of reaching it over Tailscale, which is exactly when the admin console's 30-minute key extension earns its keep.
3. **Expired or revoked auth key during provisioning.** Symptom: `tailscale up --auth-key=...` fails on new instances while existing ones are untouched. Common in autoscaling groups where the baked-in key silently passed its 1-to-90-day expiry.
4. **Leaked reusable auth key.** Symptom: unfamiliar machines in the Machines list, possibly tagged with real infrastructure tags. Remember the two-step cleanup: revoking the key stops future joins but does not remove machines already enrolled.
5. **Server enrolled as a user device.** Symptom: headless machines fall off the network on a rolling schedule roughly 180 days after enrollment (or your configured expiry). Root cause is identity modeling, not networking: they should have been tagged, which disables expiry by default.
6. **Tag applied, user access vanished (or the reverse).** Symptom: after re-authentication, a device's permissions change wholesale. Tag identity and user identity are mutually exclusive, so tagging removed the user binding, or a user login stripped the tags, and every ACL rule referencing the old identity stopped matching.
7. **Policy edit not reaching a node.** Symptom: every node honors the new rule except one, which behaves per the old policy. That node's control connection is down or wedged; it is enforcing its cached filter and will snap to current policy on reconnect.
8. **Peer missing from netmap by design.** Symptom: a machine you know exists does not appear in `tailscale status` or `tailscale debug netmap` on some nodes. Not a fault: control omits peers the policy file gives you no path to. The fix, if unintended, is in the policy file, not the network.

## Check yourself

**1. Tailscale's hosted coordination server suffers a multi-hour outage starting at 09:00. Your tailnet has 40 user laptops, 25 tagged servers, and a monitoring box whose node key was due to expire at 11:00. Describe the state of your network at 09:05, 12:00, and, hypothetically, two weeks in.**

Answer: At 09:05, essentially nothing user-visible has changed. All existing WireGuard connections, direct and relayed, keep flowing because no user traffic transits the coordination server. Every node enforces its cached ACLs, and nodes can still open new connections to peers already present in their cached netmaps. What has silently stopped: enrollment of new devices, policy propagation, key revocation, and key renewal. At 12:00, the monitoring box has dropped off: its key expired at 11:00, renewal requires control, and "connections to/from the given endpoint will stop working." Everything else still runs, so the outage manifests as a single mysterious host loss, not a network event, which is exactly why key expiry during control outages confuses on-call staff. Two weeks in, the network is eroding on a schedule fixed before the outage: each user laptop dies as its individual expiry timestamp passes, staggered by when each last authenticated. The 25 tagged servers, with expiry disabled by default, would keep meshing on cached state. The network does not fail; it freezes, then decays node by node.

**2. A contractor's reusable, tagged auth key (tag:build, 90-day expiry, minted 20 days ago) is committed to a public repo. Walk through the blast radius and the complete cleanup.**

Answer: Blast radius first. Anyone holding the key can enroll machines into your tailnet for the next 70 days, and those machines arrive wearing tag:build, so they immediately receive whatever access your policy grants that tag, with no human identity attached and, because they are tagged, no key expiry by default: they are trusted indefinitely once enrolled. Cleanup is necessarily two-phase because "revoking a key does not deauthorize nodes using the key." Phase one: revoke the key in the admin console, which stops future enrollments only. Phase two: audit the Machines list for every device the key enrolled, legitimate and otherwise, and remove the illegitimate ones individually; until you do, they remain valid tagged peers distributed in netmaps across your fleet. Then do the structural follow-up: check what tag:build can actually reach in the policy file and whether that scope was ever justified, consider shorter expiries or ephemeral keys for CI-shaped workloads, and prefer OAuth clients with the API for programmatic provisioning so secrets are scoped and renewable. If revocation propagation matters, note the dependency: cutting off the rogue machines requires a healthy control plane.

**3. You push a policy change adding access from tag:app to a new database server, cloud-1. Three app servers pick it up instantly; one, node-b, does not, and node-b cannot even see cloud-1 in tailscale status. Explain both observations mechanically.**

Answer: The three healthy servers demonstrate normal distribution: every online node holds a long-lived connection to control, so when you saved the policy file, control recompiled per-node packet filters and netmaps and streamed updates down within seconds. cloud-1 appeared in their netmaps (public key, Tailscale IP, endpoints) and their local filters began accepting the new flows, since enforcement happens on each device against the distributed rules. node-b's twin symptoms share one root cause: its control connection is down or wedged. It never received the new netmap, so two things follow mechanically. First, it enforces its cached, pre-change packet filter. Second, and more diagnostic, cloud-1 is absent from its peer list entirely, because control only includes peers a node is authorized to reach, and node-b's cached netmap predates that authorization; the node cannot see cloud-1's public key at all, so no tunnel is even possible. Confirm with `tailscale status` health warnings or tailscaled logs showing failed control dials on node-b, fix its path to the control plane (DNS, egress firewall, captive proxy are the usual suspects), and the netmap update lands on reconnect with no further action.

## What you now have

1. A clean mental split: control plane moves keys, endpoints, and policy; the data plane moves your packets; neither touches the other's traffic.
2. The registration flow for both auth paths, and the rule for choosing: humans log in via SSO, machines enroll with auth keys, infrastructure wears tags.
3. The netmap as the single distributed artifact: a per-node, policy-censored directory of peer keys, endpoints, and packet filter, pushed over a long-lived control connection.
4. Key lifecycle instincts: 180-day default expiry, user devices rotate, tagged devices do not, auth key revocation does not evict enrolled machines.
5. ACLs as centrally authored, locally enforced packet filters delivered inside the netmap, with a default allow-all you should replace early.
6. The outage model: control down means the network freezes at last-known state, keeps forwarding (over direct paths, DERP, and peer relays alike), and decays only as individual keys expire.
7. One paragraph of context on Headscale as the independent open source coordination server, for when the self-hosting question comes up.

## Cross references

- Module 1, WireGuard foundations: this module distributes the public keys and endpoints that Module 1's tunnels consume; the crypto guarantees there are scoped by the key distribution trust model here.
- Module 3, NAT traversal and relays: endpoint discovery introduced here becomes the full direct-connection dance there, and DERP plus peer relays explain why relayed traffic survives a control outage.
- Module 5, the tailnet policy file in depth: grants syntax, tests, and GitOps workflows build on the distribution and local-enforcement model established here.
- Module 4, identity and auth: the interactive login path summarized here gets its full treatment, including identity providers and user lifecycle.
- Module 10, enterprise operations: the failure catalog here feeds that module's runbooks, especially key expiry audits and auth key hygiene.
