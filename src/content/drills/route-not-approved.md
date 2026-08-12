---
slug: route-not-approved
title: The subnet router works, the subnet does not
description: A new subnet router advertises 10.20.0.0/16 and looks healthy, but clients cannot reach anything behind it because the route was never approved.
area: routing
difficulty: 1
symptom: "The new subnet router is up and connected, but nothing behind 10.20.0.0/16 answers from any client."
words: 1250
sources:
  - id: kb-subnets
    url: https://tailscale.com/docs/features/subnet-routers
    title: Subnet routers
    checked: 2026-08-10
  - id: kb-client-metrics
    url: https://tailscale.com/docs/reference/tailscale-client-metrics
    title: Tailscale client metrics
    checked: 2026-08-10
  - id: ts-router-linux
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/router/osrouter/router_linux.go
    title: tailscale/tailscale, wgengine/router/osrouter/router_linux.go
    checked: 2026-08-10
---

## The ticket

The Customer stood up `cloud-1`, a Linux VM, as a subnet router for a cloud VPC. They followed the documentation: enabled IP forwarding, ran `sudo tailscale set --advertise-routes=10.20.0.0/16`, saw no errors, and confirmed the node shows as connected. Urgency is moderate: a migration is waiting on this path. From every client, connections into the VPC time out.

> "tailscale status on the router looks completely healthy. It talks to every peer. But not one client can reach anything in 10.20.0.0/16. What is it not telling us?"

## Evidence provided

On `cloud-1`:

```
$ tailscale status
100.64.0.7   cloud-1              ops@         linux   -
100.64.0.2   node-a               ops@         macOS   active; direct 203.0.113.10:41641, tx 8412 rx 6120
100.64.0.5   lab-vm-1             ops@         linux   idle, tx 1148 rx 996
```

From `node-a`:

```
$ ping -c 3 10.20.1.5
3 packets transmitted, 0 packets received, 100.0% packet loss
```

The Customer is right that the router looks healthy. That is the lesson of this drill: it will keep looking healthy, because nothing on the router is broken.

## Hypothesis tree

Four things make a freshly built subnet router useless, and they live in four different places: the control plane, the router's kernel, the client, and the policy file. Each has a cheap discriminating check, so the tree resolves in minutes if you ask each layer directly instead of staring at `tailscale status`.

<div class="diagram-wrap">
<svg viewBox="0 0 820 340" role="img" aria-label="Hypothesis tree for unreachable subnet behind a healthy router">
  <title>Hypothesis tree: healthy router, dead subnet</title>
  <rect x="250" y="16" width="320" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="410" y="38" text-anchor="middle" font-size="14" fill="var(--diagram-text)">Clients cannot reach 10.20.0.0/16</text>
  <text x="410" y="58" text-anchor="middle" font-size="12" fill="var(--diagram-text)">Router status looks healthy</text>
  <line x1="410" y1="72" x2="105" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="310" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="515" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="720" y2="140" stroke="var(--diagram-line)"/>
  <rect x="12" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="105" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Route advertised</text>
  <text x="105" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">but never approved</text>
  <text x="105" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Metrics: advertised gauge is 1,</text>
  <text x="105" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">approved gauge is 0</text>
  <rect x="217" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="310" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">IP forwarding disabled</text>
  <text x="310" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">on the router</text>
  <text x="310" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">sysctl net.ipv4.ip_forward</text>
  <text x="310" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">answers in one command</text>
  <rect x="422" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="515" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Client not accepting</text>
  <text x="515" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">routes (Linux)</text>
  <text x="515" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Route table 52 empty on Linux;</text>
  <text x="515" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">macOS accepts automatically</text>
  <rect x="627" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="720" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">ACL blocks traffic</text>
  <text x="720" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">to the subnet</text>
  <text x="720" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Policy grants dst 10.20.0.0/16?</text>
  <text x="720" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Check before blaming routing</text>
  <text x="410" y="300" text-anchor="middle" font-size="12" fill="var(--diagram-text)">Check the control plane first: it is the only layer tailscale status never shows you</text>
</svg>
</div>

## Investigation

1. **Ask the router for both route gauges.** Client metrics ship in Tailscale v1.78.0 and later. On `cloud-1`:

   ```
   $ tailscale metrics print | grep routes
   # TYPE tailscaled_advertised_routes gauge
   tailscaled_advertised_routes 1
   # TYPE tailscaled_approved_routes gauge
   tailscaled_approved_routes 0
   ```

   Per the client metrics KB, `tailscaled_advertised_routes` displays the number of routes advertised by the client and does not include exit nodes, while `tailscaled_approved_routes` displays the number of advertised routes that have been approved by an administrator. Advertised 1, approved 0: the router asked, nobody said yes. This is the whole diagnosis (Module 11), but finish the sweep so the fix works on the first try.

2. **Confirm clients never received the route.** On `lab-vm-1` (on Linux the client installs its routes in table 52, per the router implementation in the client source, ts-router-linux):

   ```
   $ ip route show table 52 | grep 10.20
   $
   ```

   Empty. Consistent with step 1: the control plane distributes only approved routes, so there is nothing for any client to install. This also rules out an ACL problem as the primary cause, because ACLs filter traffic on a path that here does not exist yet (Module 05 vs Module 07: policy decides may it pass, routing decides is there a path).

3. **Verify the router could forward if asked.** On `cloud-1`:

   ```
   $ sysctl net.ipv4.ip_forward
   net.ipv4.ip_forward = 1
   ```

   Forwarding is on, ruling out the second branch and pre-empting the classic follow-up ticket ("you approved it and it still fails").

4. **Verify the clients accept routes.** `node-a` is macOS, which accepts routes automatically; `lab-vm-1` was already set up with `sudo tailscale set --accept-routes`, which Linux requires explicitly per the subnet routers KB. Branch three ruled out.

5. **Approve and confirm.** In the admin console, per the subnet routers KB: Machines page, filter with `property:subnet` to list the devices advertising routes, select `cloud-1`, Subnets section, Edit, select `10.20.0.0/16`, Save. Within seconds on `cloud-1`, `tailscaled_approved_routes` goes to 1, `lab-vm-1` shows the route in table 52, and ping to `10.20.1.5` answers.

> [!HOW-IT-WORKS]
> `--advertise-routes` is a request, not an action. The router tells the control plane (Module 02) "I can carry this prefix." Until an admin approves the route, or an `autoApprovers` rule in the policy file approves it at authentication time, the control plane distributes nothing to peers. Approval is the control plane's safety interlock: without it, any compromised node could advertise `0.0.0.0/0` or your production ranges and start attracting traffic.

## Root cause

The advertised-versus-approved gap. Advertising a route records intent with the control plane; only approved routes are pushed to peers and installed in their routing tables (Module 07). Nobody clicked approve, and the tailnet's policy file had no `autoApprovers` entry covering `10.20.0.0/16`, so per the subnet routers KB the route stayed inactive.

Everything the Customer checked was genuinely healthy. `tailscale status` reports peer connectivity: WireGuard sessions, endpoints, traffic counters (Module 01, Module 03). Route approval is not a property of the router at all; it is a property of the tailnet's configuration, which is why no amount of inspecting the router surfaces it. The only router-local artifact of the problem is the metrics pair, which is exactly why those two gauges exist (Module 11).

## Fix and prevention

**Immediate.** Approve the route in the admin console as in step 5. Zero changes on the router or clients.

**Durable.** If subnet routers are created repeatedly (IaC, ephemeral cloud environments), encode approval in the policy file with `autoApprovers`, keyed to a tag rather than a person:

```json
{
  "tagOwners": {
    "tag:subnet-router": ["autogroup:admin"],
  },
  "autoApprovers": {
    "routes": {
      "10.20.0.0/16": ["tag:subnet-router"],
    },
  },
}
```

A router that authenticates with `tag:subnet-router` and advertises `10.20.0.0/16` is approved automatically, and the rule itself now lives in reviewable policy (Module 05, Module 10). Second, alert on the gap itself: scrape client metrics (`http://100.100.100.100/metrics` from the device itself, or port 5252 over the tailnet, which per the client metrics KB means enabling the web interface with `tailscale set --webclient` and granting access to that port in the policy file) and page when `tailscaled_advertised_routes` exceeds `tailscaled_approved_routes` for more than a few minutes. That alert catches this whole class: new routers, re-advertised routes after reinstall, and typo'd prefixes awaiting an approval that will never come.

## The handoff package

**Summary:** New subnet router `cloud-1` advertises `10.20.0.0/16`; clients cannot reach the subnet; route advertised but never approved; no product defect suspected.
**Repro:** `tailscale set --advertise-routes=10.20.0.0/16` on a fresh node; do not approve; from any peer, traffic to the range fails; `tailscaled_advertised_routes 1`, `tailscaled_approved_routes 0`.
**Log evidence:** 14:12 UTC, cloud-1: metrics pair above. 14:15 UTC, lab-vm-1: route table 52 contains no `10.20.0.0/16`. 14:31 UTC: admin approval; approved gauge 1; first successful ping 14:31:20 UTC.
**Version matrix:** cloud-1 v1.84.0 Linux; node-a v1.84.0 macOS; lab-vm-1 v1.82.5 Linux (metrics require v1.78.0+).
**Impact scope:** all access to `10.20.0.0/16` (one VPC), from router creation to approval, ~3 hours.
**Ruled out:** IP forwarding, client route acceptance, ACL policy, WireGuard connectivity, NAT traversal.
**Proposed owning area:** not an engineering escalation; onboarding documentation gap on the Customer side.

## The trap

The weak investigation trusts `tailscale status` as a full health report and concludes the problem must be in the network: firewall rules get edited, NAT traversal gets debugged, the router gets reinstalled, and none of it changes anything because none of it was broken. The tell was structural: the router can only report what it knows, and it is not the party that approves routes. When a symptom is "this node looks perfect but the feature does not work," ask what the control plane thinks, and use the two gauges that compare intent with permission.

> [!GOTCHA]
> Approval is per route, not per machine. A router advertising three prefixes can have two approved and one silently pending, which produces "some subnets work" tickets that look like partial network failures. The metrics pair counts routes, so a gap of exactly 1 on a multi-route router is your hint to re-open the Edit route settings panel and read the checkboxes.
