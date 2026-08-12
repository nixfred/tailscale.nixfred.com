---
slug: key-expiry-outage
title: Two servers drop off the tailnet at exactly 180 days
description: A pair of servers provisioned the same day hit the default node key expiry together and land in NeedsLogin, which looks like a coordinated outage until you read the calendar.
area: identity
difficulty: 1
symptom: "Both boxes dropped off at the same minute. That has to be an attack or a Tailscale outage, right?"
words: 1250
sources:
  - id: kb-key-expiry
    url: https://tailscale.com/docs/features/access-control/key-expiry
    title: Key expiry
    checked: 2026-08-10
  - id: kb-auth-keys
    url: https://tailscale.com/docs/features/access-control/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: kb-tags
    url: https://tailscale.com/docs/features/tags
    title: Group devices with tags
    checked: 2026-08-10
  - id: cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: health-source
    url: https://github.com/tailscale/tailscale/blob/main/health/warnings.go
    title: tailscale/tailscale health/warnings.go
    checked: 2026-08-10
---

## The ticket

An overnight backup job pages at 03:15. node-a (backup source, in one cloud region) can no longer reach node-b (backup target, in a different provider entirely). Both machines answer on their public management interfaces, both have working internet, but neither is reachable over the tailnet and neither can reach anything else on it. The rest of the tailnet, about 38 nodes, is healthy. Both machines were provisioned by the same engineer on the same afternoon in February, logged in interactively as ops@example.com. The Customer escalates hard:

> "Both boxes dropped off at the same minute. That has to be an attack or a Tailscale outage, right?"

## Evidence provided

From the cloud provider console on node-a:

```
node-a $ tailscale status
Logged out.
```

```
node-a $ journalctl -u tailscaled --since "03:10" | tail -2
Aug 10 03:12:41 node-a tailscaled[712]: health(warnable=login-state): error: You are logged out.
Aug 10 03:12:41 node-a tailscaled[712]: Switching ipn state Running -> NeedsLogin (WantRunning=true, nm=true)
```

node-b shows the identical sequence at 03:12:44. From a healthy peer:

```
$ tailscale status | grep 'node-'
100.64.0.21  node-a  ops@   linux  offline
100.64.0.22  node-b  ops@   linux  offline
```

And from the admin console Machines page: both machines show a key expiry date that has already passed, and both were created Feb 11, 2026. Today is Aug 10, 2026. That is 180 days.

## Hypothesis tree

Two machines failing in the same minute is the signature of something shared. The branches differ in what they predict the shared thing is: a shared network, a shared control plane, a shared policy, or a shared birthday. The evidence needed to discriminate is cheap, and the fourth branch is the only one that explains the exact simultaneity.

<div class="diagram-wrap">
<svg viewBox="0 0 780 330" role="img" aria-label="Hypothesis tree: two nodes offline at the same minute, four branches, synchronized key expiry confirmed">
<title>Hypothesis tree for the simultaneous two node outage</title>
<rect x="215" y="14" width="350" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="390" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-a and node-b both offline at 03:12</text>
<text x="390" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="12">same minute, different clouds</text>
<line x1="390" y1="66" x2="100" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="293" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="487" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="680" y2="130" stroke="var(--diagram-accent)"/>
<rect x="11" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="100" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Shared network outage</text>
<text x="100" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">site or ISP failure</text>
<rect x="204" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="293" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Control plane outage</text>
<text x="293" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">coordination down</text>
<rect x="398" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="487" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Policy change</text>
<text x="487" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">ACL now blocks them</text>
<rect x="591" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
<text x="680" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Synchronized credential</text>
<text x="680" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">expiry</text>
<text x="100" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">different clouds, both</text>
<text x="100" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">have working internet</text>
<text x="293" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">38 other nodes healthy</text>
<text x="293" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">status page clean</text>
<text x="487" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">blocked nodes stay logged in;</text>
<text x="487" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">these say Logged out</text>
<text x="680" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">both created Feb 11</text>
<text x="680" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">exactly 180 days ago</text>
<text x="100" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 1</text>
<text x="293" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 1</text>
<text x="487" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 2</text>
<text x="680" y="258" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED: steps 3 to 4</text>
</svg>
</div>

## Investigation

1. **Scope the blast radius.** The two machines sit in different providers with independent uplinks, and both reach the internet fine from their provider consoles. Meanwhile 38 other nodes are exchanging traffic normally, which also means the coordination server is reachable and serving the tailnet. One check, two branches closed: no shared network, no control plane outage (Module 02).

2. **Distinguish blocked from logged out.** An ACL change that denies traffic leaves a node authenticated: it still appears active to the control plane, it just cannot pass traffic to blocked peers. These nodes print `Logged out.` and their daemons log the switch into `NeedsLogin`. A policy file cannot produce that state, and the admin console audit view shows no policy edits in weeks. Policy branch closed.

3. **Read the timestamps against the calendar.** Both machines were created Feb 11, 2026, within minutes of each other. Both failed Aug 10, 2026 at 03:12, within three seconds of each other. Feb 11 plus 180 days is Aug 10. The default node key expiry for a tailnet is 180 days (kb-key-expiry). The machines did not fail together because something attacked them together; they failed together because they were born together.

4. **Confirm in the admin console.** Machines page: both machines are past their key expiry date, and the machine menu is offering "Temporarily extend key", the option kb-key-expiry documents for exactly this state. The KB spells out the consequence: "If reauthentication does not occur, keys expire and connections to/from the given endpoint will stop working." Confirmed, mechanism and all.

## Root cause

Every node holds a node key that the coordination server uses to identify it (Module 04, Module 02). Node keys expire, and the tailnet default is 180 days, configurable between 1 and 180 days in the admin console's device management settings (kb-key-expiry). These two servers were provisioned interactively as user devices and nobody touched the expiry setting, so a silent countdown started at first login. Two machines provisioned in the same hour expire in the same hour, 180 days later. Expiry drops the node into `NeedsLogin`, and until a human re-authenticates, the node is off the tailnet.

> [!HOW-IT-WORKS] There are two different keys with two different clocks, and confusing them wastes real time. The **auth key** (kb-auth-keys) is a provisioning credential: it lets a device join without an interactive login, and it expires between 1 and 90 days after creation, 90 by default. The **node key** is the device's ongoing identity, with the 180 day default. The KB is explicit about the boundary: "If an auth key expires, any device authorized by it remains authorized until its node key expires." An expired auth key strands no running device; an expired node key strands exactly one.

## Fix and prevention

**Immediate fix.** Re-authenticate each machine. From the provider console: `tailscale up --force-reauth`, then complete the login flow as ops@example.com (kb-key-expiry). The KB warns that this command might bring down the tailnet connection, so it should not be run remotely over SSH or RDP without another way back in; here that risk is already spent, because the node is down anyway. If the person who can complete the login is not the person at the keyboard, an admin can use "Temporarily extend key" in the admin console, which extends the key for 30 minutes (kb-key-expiry).

**Durable prevention.** Infrastructure should not carry credentials that demand a human every 180 days. Two sanctioned paths:

1. **Disable expiry per machine.** Admin console, Machines page, machine menu, "Disable key expiry" (kb-key-expiry). Right answer for a handful of pet servers.
2. **Tag your servers.** When a device receives its first tag, key expiry is disabled by default (kb-tags). Tags also give infrastructure a stable, role based policy identity (Module 05), which is what these backup boxes should have had anyway. If you take this path, pair the tag change with matching ACL and SSH rules in the same policy commit; the tag-ssh-lockout drill in this area shows what happens when you do not.

Either way, sweep the Machines page for the rest of the February provisioning batch now, because anything born the same week fails the same week.

> [!FROM-THE-FIELD] "Multiple machines, same minute" reads as an attack to the Customer and as a calendar to an experienced responder. Certificates, licenses, and key expiries are the classic causes of eerily synchronized failures. Before reaching for the incident bridge, subtract the failure date from the provisioning date and see if a round number falls out.

## The handoff package

**Summary:** node-a and node-b entered NeedsLogin at 2026-08-10 03:12 UTC, 180 days after 2026-02-11 provisioning; consistent with default node key expiry, no product defect suspected.
**Repro:** (1) Provision two user owned Linux nodes via interactive login, default tailnet expiry (180 days). (2) Wait 180 days. (3) Both drop to NeedsLogin within seconds of each other.
**Log evidence:** node-a (100.64.0.21) tailscaled 03:12:41Z `health(warnable=login-state): error: You are logged out.` then `Switching ipn state Running -> NeedsLogin`; node-b (100.64.0.22) identical at 03:12:44Z; admin console shows both keys past expiry, created 2026-02-11.
**Version matrix:** node-a Tailscale 1.86.4, Debian 12; node-b Tailscale 1.84.0, Ubuntu 24.04; tailnet device management expiry setting: default 180 days, never modified.
**Impact scope:** two nodes, nightly backup pipeline down; latent for every device in the 2026-02-11 provisioning batch.
**Ruled out:** shared network outage, control plane outage, policy change, compromise.
**Proposed owning area:** none, working as designed; Customer side fix is expiry policy hygiene.

## The trap

The weak investigation takes the Customer's framing at face value and spins up an incident: security review for the "attack", a support ticket for the "outage", packet captures on two machines whose own `tailscale status` plainly prints `Logged out.` A closely related trap is restarting tailscaled over and over; a restart cannot re-authenticate a node whose key has expired, so the state machine lands right back in NeedsLogin every time. The third trap is grabbing the wrong key: someone finds the long expired auth key from February, panics, mints a new one, and wonders why nothing changes; auth key expiry never strands a running device (kb-auth-keys). The tell that was sitting in the ticket the whole time is the number 180. Same minute failures across independent infrastructure mean a shared clock, and in Tailscale the loudest shared clock is node key expiry. Cost of missing it: an incident bridge, a fake security scare, and two servers down for hours when the real fix is one login per box and a five minute policy change so it never recurs.
