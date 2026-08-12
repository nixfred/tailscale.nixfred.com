---
slug: acl-one-way-ping
title: Ping works one way, so the Customer says routing is broken
description: A one-way reachability failure between two healthy nodes that turns out to be a directional ACL, plus the invisible peers effect that made a third machine look dead.
area: policy
difficulty: 2
symptom: "Ping works from node-a to node-b but not the other way, so routing is broken between the sites."
words: 1350
sources:
  - id: kb-acls
    url: https://tailscale.com/docs/features/access-control/acls
    title: Manage permissions using ACLs
    checked: 2026-08-10
  - id: kb-acl-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Syntax reference for the tailnet policy file
    checked: 2026-08-10
  - id: ping-types
    url: https://tailscale.com/docs/reference/ping-types
    title: Tailscale ping message types
    checked: 2026-08-10
  - id: connect-failure
    url: https://tailscale.com/docs/reference/troubleshooting/connectivity/connect-device-failure
    title: Can't connect to other tailnet devices
    checked: 2026-08-10
  - id: ts-filter-source
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/filter/filter.go
    title: tailscale/tailscale, wgengine/filter/filter.go
    checked: 2026-08-10
---

## The ticket

Priority two, Tuesday morning. The ops team stood up a new build runner, node-b, tagged `tag:lab`, and pointed its artifact push job at a cache service on node-a, an ops engineer's workstation in `group:ops`. Deploys from node-a to node-b work perfectly. The push from node-b back to node-a fails every time, and a third lab machine has apparently vanished from the network entirely.

> "Ping works from node-a to node-b but not the other way, so routing is broken between the sites. Also lab-vm-1 dropped off the network completely. Can you fix the routes before the 2pm build?"

## Evidence provided

The first responder collected pings from both ends and a status dump from node-b.

```
node-a$ tailscale ping node-b
pong from node-b (100.105.66.20) via 203.0.113.77:41641 in 14ms

node-b$ ping -c 3 100.98.12.34
PING 100.98.12.34 (100.98.12.34) 56(84) bytes of data.
--- 100.98.12.34 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2043ms
```

```
node-b$ tailscale status
100.105.66.20   node-b               tagged-devices  linux   -
100.98.12.34    node-a               ops@            macOS   active; direct 203.0.113.77:41641, tx 30208 rx 1448
```

The Customer points out that lab-vm-1 (100.83.44.9, tagged `tag:isolated`) does not appear in that list at all, which is fueling the "network outage" theory.

## Hypothesis tree

The Customer's theory is routing. But a failure that is cleanly asymmetric between two nodes that can already exchange traffic in one direction is rarely a path problem: a broken route or NAT path tends to break the pair, not one initiation direction. Four hypotheses fit the evidence, and two commands discriminate between all of them.

<div class="diagram-wrap">
<svg viewBox="0 0 800 300" role="img" aria-label="Hypothesis tree for one-way connectivity between node-a and node-b"><title>Hypothesis tree: one-way reachability between node-a and node-b</title><rect x="250" y="12" width="300" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="400" y="35" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a reaches node-b</text><text x="400" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b cannot reach node-a</text><path d="M400 68 L103 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L301 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L499 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L697 140" stroke="var(--diagram-line)" fill="none"/><rect x="8" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="103" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Path or NAT failure</text><text x="103" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">disco ping succeeds</text><text x="103" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">in both directions</text><text x="103" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="206" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="301" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Host firewall on node-a</text><text x="301" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">would drop inbound flows</text><text x="301" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no deny rules found</text><text x="301" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="404" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="499" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Routing or subnet issue</text><text x="499" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no subnet routers in path</text><text x="499" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct peer connection</text><text x="499" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="602" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="697" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Directional ACL deny</text><text x="697" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">TSMP pong, ICMP timeout</text><text x="697" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no rule with src tag:lab</text><text x="697" y="226" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">confirmed</text></svg>
</div>

## Investigation

1. **Confirm both nodes are healthy and connected.** `tailscale status` on node-a shows node-b as `active; direct`. That rules out node-b being offline, key expiry, and auth problems (kb-acls, connect-failure).

2. **Baseline the working direction.** `tailscale ping node-b` from node-a returns `pong from node-b (100.105.66.20) via 203.0.113.77:41641 in 14ms`. The a to b path is direct and fast.

3. **Test path establishment from the failing side.** The default `tailscale ping` is a disco ping, which exercises peer discovery and NAT traversal (Module 03), not the payload path (ping-types).

   ```
   node-b$ tailscale ping node-a
   pong from node-a (100.98.12.34) via DERP(ord) in 46ms
   pong from node-a (100.98.12.34) via 198.51.100.14:41641 in 18ms
   ```

   Discovery upgrades from DERP to a direct path within two probes. This rules out the path and NAT hypothesis entirely: node-b can find node-a and establish the tunnel.

4. **Test the payload path.** `tailscale ping --icmp node-a` from node-b prints `ping "100.98.12.34" timed out` on every attempt and exits with `no reply`. So the tunnel forms but IP traffic initiated by node-b never comes back.

5. **Split the stack with TSMP.** Per the ping reference, TSMP is a Tailscale-specific protocol designed to test connectivity when ICMP might be blocked, and TSMP pings test end-to-end IP connectivity over the WireGuard tunnel while bypassing the device's operating system IP stack; ICMP pings send a normal ICMP message over that same tunnel (ping-types). The other half of the difference is in the client packet filter itself, which accepts TSMP unconditionally while an ICMP echo request has to match a policy rule (ts-filter-source).

   ```
   node-b$ tailscale ping --tsmp node-a
   pong from node-a (100.98.12.34, 42813) via TSMP in 13ms
   ```

   TSMP succeeds and ICMP fails. A packet type the filter never evaluates gets through, and the one it does evaluate does not. The troubleshooting docs describe exactly this class of outcome: you can fail to reach an endpoint despite the absence of connection problems, because of the tailnet's access control policies (connect-failure). This is the pivot of the whole drill: two commands localized the failure to policy.

6. **Eliminate the host firewall anyway.** A quick check of the macOS application firewall and packet filter on node-a shows nothing dropping tunnel traffic. Cheap to check, and it keeps the handoff package honest.

7. **Read the policy file.** The Access controls page shows:

   ```json
   {
     "acls": [
       {"action": "accept", "src": ["group:ops"], "dst": ["tag:lab:*"]}
     ]
   }
   ```

   One rule. Source `group:ops`, destination `tag:lab`. There is no rule anywhere with `src: ["tag:lab"]`, and Tailscale takes a deny-by-default approach, so anything no rule accepts is denied (kb-acls, kb-acl-syntax). Confirmed.

8. **Explain the "vanished" machine.** lab-vm-1 is tagged `tag:isolated`, which appears in no rule in either direction. The troubleshooting docs state that `tailscale status` lists the current device's connection to every other device in the tailnet to which it has access, and that if a device is not listed you should check the tailnet policy file (connect-failure). From node-b:

   ```
   node-b$ tailscale ping 100.83.44.9
   no matching peer
   ```

   Nothing is down. node-b was simply never given a relationship with lab-vm-1, so lab-vm-1 is not in node-b's view of the network at all.

> [!HOW-IT-WORKS]
> The coordination server (Module 02) does not just distribute filter rules, it also trims what each node learns about. A peer you have no permitted relationship with may not appear in your network map at all, so it is absent from `tailscale status` and `tailscale ping` reports `no matching peer`. Absence from status is a policy statement, not an outage.

## Root cause

ACL rules are directional. The ACL docs say it plainly: allowing a source to connect to a destination does not mean the destination can connect to the source, unless a policy explicitly enables it (kb-acls). The only rule in this tailnet authorizes connections initiated by `group:ops` devices toward `tag:lab` devices. Deny by default (Module 05) handles everything else, including every connection node-b tries to initiate.

The reason this surprises people is that the WireGuard tunnel underneath (Module 01) is a symmetric encrypted pipe. Once node-a opens an SSH session to node-b, packets flow both directions inside that accepted connection, so the link "feels" bidirectional. But the packet filter, computed by the control plane (Module 02) and enforced on the receiving node, evaluates who initiated. Direction of initiation is the unit of policy; the tunnel has no direction. "Routing" was never involved, which is why every routing-shaped intervention was going to fail (Module 11 covers this discriminator pattern).

## Fix and prevention

**Immediate fix.** Add the reverse rule, scoped to what node-b actually needs (the artifact cache on port 8443), not a blanket mirror:

```json
{"action": "accept", "src": ["tag:lab"], "dst": ["group:ops:8443"]}
```

Verify from node-b: `tailscale ping --icmp node-a` now returns `pong from node-a (100.98.12.34) via ICMP in 15ms` and the artifact push succeeds.

**Durable prevention.** Encode both directions of every workflow you promise into the `tests` section of the policy file. Tests are assertions evaluated on every save, and if an assertion fails, Tailscale rejects the updated tailnet policy file with an error (kb-acl-syntax):

```json
"tests": [
  {"src": "tag:lab", "proto": "tcp", "accept": ["group:ops:8443"], "deny": ["group:ops:22"]}
]
```

Now nobody can save a policy revision that silently breaks the push path or silently widens it to SSH.

> [!GOTCHA]
> "Ping works" is not one fact, it is three. A default `tailscale ping` is a disco ping, which tests direct connectivity between devices without involving IP at either end. `--tsmp` tests end-to-end IP connectivity through the tunnel while bypassing the OS IP stack (ping-types), and the filter waves TSMP through without evaluating a rule (ts-filter-source). `--icmp` sends a real ICMP message, so it is the one that has to satisfy policy. A one-way workflow failure with a healthy tunnel is a policy question until proven otherwise.

## The handoff package

Had this needed escalation, this is the package. It did not: the fix was policy configuration.

- **Summary:** Unidirectional reachability failure node-b (100.105.66.20, tag:lab) to node-a (100.98.12.34, group:ops). TSMP ping succeeds, ICMP ping times out, consistent with packet filter deny on receiving node.
- **Repro:** From node-b: `tailscale ping --icmp node-a` times out (5/5 attempts, 2026-08-10T13:41:07Z to 13:41:22Z). From node-a: all ping types succeed.
- **Log evidence:** node-b disco pong via DERP(ord) 46ms then direct 18ms at 13:39:51Z; TSMP pong 13ms at 13:40:12Z; ICMP timeouts 13:41:07Z onward. Node IDs: node-a stable ID nA8bQk2CNTRL, node-b stable ID nB55xw9CNTRL.
- **Version matrix:** node-a Tailscale 1.88.1 / macOS 14.6; node-b Tailscale 1.88.1 / Ubuntu 24.04 (kernel WireGuard).
- **Impact scope:** One workflow (artifact push), one direction, two nodes. No other tailnet traffic affected.
- **Ruled out:** node offline, key expiry, NAT or path failure (disco succeeds both directions), host firewall (audited), subnet routing (none in path).
- **Proposed owning area:** tailnet policy configuration (Customer side). No client or control plane defect.

## The trap

The weak version of this investigation accepts the Customer's frame. It hears "routing is broken," restarts tailscaled on both ends, tears into NAT traversal, stares at DERP latency, maybe disables the firewall on node-a entirely, and burns half a day, and it treats lab-vm-1's absence from `tailscale status` as evidence of a spreading outage, which escalates the ticket instead of closing it. Worst case it "fixes" the problem with `src: ["*"]` accept rule, which works instantly and quietly deletes the tailnet's security model. The strong version costs about ninety seconds: disco ping, TSMP ping, ICMP ping, read the policy file. The symptom was directional, and in a default-deny system with directional rules, directional symptoms are policy symptoms first.
