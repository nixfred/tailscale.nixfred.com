---
slug: stand-up-a-relay-you-control
title: Stand up a peer relay, and find out first whether you even can
description: The remedy for labs 01 and 02. Survey the fleet for a host that is genuinely reachable, enable relay duty on it, and discover that the last step is a policy decision with a real cost rather than a command.
order: 3
disruptive: true
ran: 2026-08-12
words: 2250
sources:
  - id: docs-peer-relays
    url: https://tailscale.com/docs/features/peer-relay
    title: Peer relays
    checked: 2026-08-12
  - id: docs-nat-traversal
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-12
  - id: docs-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-12
  - id: docs-tags
    url: https://tailscale.com/docs/features/tags
    title: Tags
    checked: 2026-08-12
  - id: docs-policy-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-12
  - id: docs-firewall-ports
    url: https://tailscale.com/docs/reference/faq/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-12
---

## What this lab does

Labs 01 and 02 established that a tailnet was entirely relayed and proved why: two NATs facing each other, dropping probes in both directions, with the far NAT owned by a hosting provider. No host side change fixes that pair.

A peer relay is the designed answer. Instead of falling back to shared relay infrastructure, you nominate a node in your own tailnet to relay for peers that cannot reach each other directly. This lab stands one up.

It is marked disruptive because it changes configuration on a real machine and opens a firewall port, unlike the two labs before it. Both changes are additive and reversible, and the restore commands are given. The final step, which this lab deliberately stops short of, is a change to the tailnet policy file, and that one deserves its own decision.

## The prerequisite nobody checks first

A relay only helps if peers can actually reach it. That sounds obvious and it is the step people skip, because the instinct is to pick the biggest or most convenient machine and start configuring.

If your whole fleet is behind NAT, which is exactly the situation that made you want a relay, then most of your candidates cannot serve as one. Find out before you configure anything:

```bash
for h in host-1 host-2 host-3; do
  echo "=== $h"
  ssh "$h" 'ip -4 -o addr show scope global | awk "{print \$2, \$4}"'
done
```

Then compare each host's interface address with the public address it discovers through STUN:

```bash
ssh relay-1 'tailscale netcheck | grep IPv4'
```

The test is simple. If the address on the interface equals the address netcheck reports, there is no NAT between that host and the internet, and it can receive an inbound packet from anywhere. If they differ, the host is behind NAT and is a poor relay candidate for the same reason it was a poor direct path candidate.

On the fleet under test, nine hosts were surveyed. Seven had only private addresses. Two did not:

```
relay-1: eth0 198.51.100.20/24  tailscale0 100.64.0.97/32
```

```
* UDP: true
* IPv4: yes, 198.51.100.20:40835
* MappingVariesByDestIP: false
* Nearest DERP: New York City
```

The interface address and the discovered address are the same. That host is directly addressable, and it is the candidate.

> [!FROM-THE-FIELD] This survey took two minutes and changed the plan. The obvious relay candidate on this fleet was the biggest, busiest machine, and it turned out to be behind NAT like everything else. The viable candidate was a host nobody thought of, identified purely by comparing two addresses.

## Build it

### Step 1: confirm the version supports it

Peer relays require a reasonably current client, and the feature is not available on every platform.

```bash
ssh relay-1 'tailscale version | head -1'
```

Both candidates on this fleet reported versions well past the requirement. Check the documentation for the current floor rather than trusting a number in a writeup.

### Step 2: enable relay duty

One command. It offers the node as a relay and starts a listener on the port you name.

```bash
ssh relay-1 'sudo tailscale set --relay-server-port=40000'
```

`tailscale set` only changes settings you explicitly name, which is what makes this safe to run on a machine doing other work. Confirm it took:

```bash
ssh relay-1 'tailscale debug prefs | grep -i relayserver'
```

```
"RelayServerPort": 40000,
```

And confirm the daemon is actually listening, which is a different question from the preference being recorded:

```bash
ssh relay-1 'sudo ss -lunp | grep 40000'
```

```
UNCONN 0 0 0.0.0.0:40000 0.0.0.0:* users:(("tailscaled",pid=3466569,fd=37))
UNCONN 0 0    [::]:40000    [::]:* users:(("tailscaled",pid=3466569,fd=38))
```

### Step 3: the step that makes it useless if you skip it

The host has a firewall. It was configured for Tailscale, which means somebody already thought about ports, which is exactly why this trap catches people.

```bash
ssh relay-1 'sudo ufw status verbose'
```

```
Default: deny (incoming), allow (outgoing), deny (routed)

To                         Action      From
--                         ------      ----
Anywhere on tailscale0     ALLOW IN    Anywhere    # tailscale tunnel
41641/udp                  ALLOW IN    Anywhere    # tailscale wireguard
```

Read that carefully. The firewall permits `41641/udp`, the port Tailscale uses for its normal direct connections. It does not permit `40000/udp`, the port just assigned to relay duty. Default policy is deny.

So the relay would have listened, faithfully, forever, while the firewall silently discarded every packet aimed at it. That is the same failure shape as lab 02, one layer up: a component that is running correctly and never receives anything.

```bash
ssh relay-1 'sudo ufw allow 40000/udp comment "tailscale peer relay"'
```

Then verify against the loaded kernel rules, not the tool's own summary. Lab 02 exists because config level checks pass while packets die.

```bash
ssh relay-1 'sudo iptables -S | grep "dport 40000"'
```

```
-A ufw-user-input -p udp -m udp --dport 40000 -j ACCEPT
```

That is the proof. A line in `ufw status` is a statement of intent; this is the rule the kernel will actually apply.

> [!GOTCHA] While you are here, check that the firewall survives a reboot: `systemctl is-enabled ufw`. On at least one hosting platform, enabling a firewall does not persist across a restart, and it comes back reporting healthy with zero rules loaded. A relay whose port closes on the next reboot is a future incident with your name on it.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Three layers must all be true for a peer relay to work: the daemon listening, the host firewall permitting the port, and the tailnet policy granting peers permission to use the relay. The first two are node local and were completed; the third is a tailnet wide policy change.">
  <title>Three layers, and only two of them are node local</title>
  <rect x="30" y="20" width="700" height="66" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="50" y="46" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">1 daemon listening</text>
  <text x="50" y="68" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">tailscale set --relay-server-port=40000, verified with ss</text>
  <text x="690" y="58" text-anchor="end" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">DONE</text>

  <rect x="30" y="102" width="700" height="66" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="50" y="128" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">2 firewall permits the port</text>
  <text x="50" y="150" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">ufw allow 40000/udp, verified in the LOADED iptables rules</text>
  <text x="690" y="140" text-anchor="end" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">DONE</text>

  <rect x="30" y="184" width="700" height="66" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5" stroke-dasharray="6 5"/>
  <text x="50" y="210" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">3 policy grants peers permission to use it</text>
  <text x="50" y="232" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">tailnet wide change, and it forces a decision about identity</text>
  <text x="690" y="222" text-anchor="end" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">NOT DONE</text>

  <text x="380" y="284" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">all three must be true. two of them are yours alone; the third changes the whole tailnet.</text>
</svg>
</div>

### Step 4: where this lab stops, and why

With the daemon listening and the port open, peers still will not use the relay. Relay use is authorized in the tailnet policy file by a grant that names which peers may relay through which relay node, using the relay application capability.

The documented shape names the relay by tag. That is the sentence that turns a five minute task into a decision, because the candidate host on this fleet is user owned and carries no tag:

```bash
tailscale status --json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in (d.get('Peer') or {}).values():
    if p.get('HostName')=='relay-1': print('tags:', p.get('Tags') or 'NONE, user owned')"
```

```
tags: NONE, user owned
```

Applying a tag to that host does not simply add a label. Tagging replaces user identity with tag identity, and a device cannot hold both. Every policy rule that reaches this host through `autogroup:self`, which means devices owned by the same user, stops matching the moment the tag lands. If your SSH rules are scoped that way, and the default ones are, you lose SSH to the host at the same instant you make it a relay.

That is survivable and entirely routine, provided you make the tag change and the matching access rule in the same edit rather than discovering the second half afterward. It is the exact failure the tag and SSH lockout drill on this site walks through, and it is unpleasant to meet for the first time on the machine you just made load bearing.

So this lab stops here, with the node side complete and verified, and the policy change stated rather than performed:

1. Decide the relay's identity, tag it, and in the same edit add the access rules that keep your existing reach to it.
2. Add the grant authorizing the peers that need relaying to use it.
3. Re-run the census from lab 01 and confirm those pairs moved.

## Verify it, honestly

What is proven right now, by command output rather than assumption:

1. The relay preference is recorded on the node.
2. `tailscaled` is listening on the relay port on all addresses.
3. The firewall permits that port, confirmed in the kernel's loaded rules rather than the firewall tool's summary.
4. The host has a routable address with no NAT in front of it, so an inbound packet can arrive.
5. The firewall is enabled at boot, so the rule survives a restart.

What is not proven, and will not be until the policy grant exists:

```bash
tailscale status | grep -c peer-relay
```

```
0
```

Zero peer relay paths in use, which is the correct and expected reading at this stage. A relay nobody is permitted to use carries no traffic. Anyone who stopped after step 3 and declared victory would have a listener, an open port, and no change whatsoever in how their traffic flows.

> [!HOW-IT-WORKS] The three layers fail independently and only the last one is visible from the outside. That is why the verification here is layered too: preference recorded, socket bound, kernel rule loaded, address routable, grant present. Checking only the last one tells you nothing about which of the first four is missing, and checking only the first tells you nothing about whether it works.

## Undo it

Every change in this lab reverses in two commands, which is worth knowing before you run any of them:

```bash
ssh relay-1 'sudo tailscale set --relay-server-port=0'
ssh relay-1 'sudo ufw delete allow 40000/udp'
```

The first stops offering relay duty and releases the listener. The second closes the port. Neither touches anything else, and no peer notices, because no peer was permitted to use the relay yet.

## What this changes about the original problem

Nothing yet, and that is an honest place to leave a lab.

What it does establish is that the remedy is achievable on this fleet, which was genuinely in doubt at the end of lab 02. A fleet where every host sits behind NAT has no valid relay candidate, and the correct conclusion there would have been to accept the shared relay path. Here two hosts turned out to be directly addressable, so the remedy is available. The remaining work is a policy decision about identity, not a networking problem.

## Cross references

Lab 01 is the census that found the problem, lab 02 is the capture that proved its cause, and this is the remedy for it. Module 03 covers what peer relays are and where they sit relative to direct paths and shared relays. Module 05 covers grants and the identity model that makes step 4 a decision. The tag and SSH lockout drill is the specific accident this lab is steering around, and it is worth reading before you tag anything load bearing.
