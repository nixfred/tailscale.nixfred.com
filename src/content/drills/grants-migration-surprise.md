---
slug: grants-migration-surprise
title: The service name that died in the grants migration
description: After a legacy ACL to grants migration, a Tailscale Service is unreachable by its service name while direct node access still works, because nobody granted the svc destination.
area: policy
difficulty: 3
symptom: "Since the ACL migration, https://billing.velvet-lizard.ts.net times out for the finance team, but the old server URL still works."
words: 1400
sources:
  - id: kb-grants
    url: https://tailscale.com/docs/features/access-control/grants
    title: Grants
    checked: 2026-08-10
  - id: kb-acl-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Syntax reference for the tailnet policy file
    checked: 2026-08-10
  - id: kb-services
    url: https://tailscale.com/docs/features/tailscale-services
    title: Tailscale Services
    checked: 2026-08-10
---

## The ticket

Monday, first thing, urgency high because invoicing is blocked. Over the weekend the platform team shipped two changes at once: they migrated the tailnet policy file from legacy `acls` to `grants`, and they moved the billing app behind a Tailscale Service named `svc:billing` so it can survive host migrations. Tailscale Services require one or more devices running v1.86.0 or later (kb-services). The fleet is on 1.88.x, so versions are not the story. The announcement told everyone to use the new URL. Finance did.

> "The new billing link times out for my whole team. The old link to the server still works, so the app is clearly fine. Whatever you changed this weekend broke the new thing you told us to use."

## Evidence provided

The first responder gathered a failing request, a working control, and the post-migration policy excerpt.

```
finance-laptop$ curl -sS --max-time 10 https://billing.velvet-lizard.ts.net/
curl: (28) Connection timed out after 10001 milliseconds

finance-laptop$ curl -sS -o /dev/null -w '%{http_code}\n' https://cloud-1.velvet-lizard.ts.net:8443/
200
```

```json
"grants": [
  {"src": ["group:finance"],  "dst": ["tag:billing-host"], "ip": ["tcp:8443"]},
  {"src": ["group:platform"], "dst": ["svc:billing"],      "ip": ["443"]}
]
```

The service host is cloud-1 (tagged `tag:billing-host`), advertising `svc:billing` with a TCP endpoint mapping the service's port 443 to the app on 8443. A platform engineer notes, unhelpfully for the outage but helpfully for the diagnosis, that the new URL "works fine for me."

## Hypothesis tree

The Customer's frame is "the new thing is broken." The interesting fact is the split: the same user, same laptop, same app, reachable by node name and port, unreachable by service name. Anything that would break the app, the host, or the network in general would break both paths.

<div class="diagram-wrap">
<svg viewBox="0 0 800 300" role="img" aria-label="Hypothesis tree for a Tailscale Service unreachable by name while direct node access works"><title>Hypothesis tree: service name times out, direct node access works</title><rect x="250" y="12" width="300" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="400" y="35" text-anchor="middle" fill="var(--diagram-text)" font-size="14">billing service name times out</text><text x="400" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">direct node access works</text><path d="M400 68 L103 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L301 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L499 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L697 140" stroke="var(--diagram-line)" fill="none"/><rect x="8" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="103" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">MagicDNS failure</text><text x="103" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">platform user resolves</text><text x="103" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">and connects fine</text><text x="103" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="206" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="301" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Service host problem</text><text x="301" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">console: approved and</text><text x="301" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">advertising endpoints</text><text x="301" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="404" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="499" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">App process down</text><text x="499" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct :8443 returns 200</text><text x="499" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">app is healthy</text><text x="499" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="602" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="697" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">No grant for svc dst</text><text x="697" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">finance has tag dst only</text><text x="697" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no dst svc:billing</text><text x="697" y="226" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">confirmed</text></svg>
</div>

## Investigation

1. **Reproduce on an affected machine.** `curl --max-time 10 https://billing.velvet-lizard.ts.net/` from a finance laptop times out. Consistent, not intermittent. That shape (timeout, not refused) already smells like filtered traffic rather than a dead listener.

2. **Run the working control from the same machine.** `curl https://cloud-1.velvet-lizard.ts.net:8443/` returns 200. This rules out the app being down, the laptop being offline, and any general connectivity or client problem on the finance side. Same user, same node, same physical server.

3. **Reproduce from a platform machine.** The service URL returns 200 for a `group:platform` member. This rules out the service definition being broken, the host advertisement being stuck, and any service-wide outage. Whatever is wrong varies by who is asking. In a policy system, "works for group X, fails for group Y" is a policy symptom (Module 05).

4. **Check the service in the admin console.** `svc:billing` exists, its host cloud-1 is approved and advertising the TCP endpoint. Service host advertisements require approval by an Admin, Network admin, or Owner unless auto-approval is configured (kb-services), so a pending approval was a live hypothesis. It is not the problem here.

5. **Read the grants section, searching for who can reach the service.** Grants use the fields `src`, `dst`, `ip`, `app`, `via`, and `srcPosture` (kb-acl-syntax). Search the file for `svc:billing`: exactly one hit, and its `src` is `group:platform`. The finance grant, produced by mechanically translating the old ACL line, has `dst: ["tag:billing-host"]` with `ip: ["tcp:8443"]`. Nothing grants finance the service destination. Grants deny by default just as ACLs do, so the absence is the answer.

6. **Confirm the semantics before declaring victory.** Per the Services docs, users reach a service through its TailVIP or its MagicDNS name, and access is controlled by grant policies that reference the service with the `svc:` prefix in `dst`, with the `ip` field naming the service ports (kb-services, kb-grants). A grant whose `dst` is the host's tag authorizes connections to that node's own addresses and ports. The service is a different destination identity. The two working data points (finance direct, platform via service) and one failing data point (finance via service) are all predicted exactly by the policy file as written. Confirmed.

> [!HOW-IT-WORKS]
> A Tailscale Service is not a nickname for a node. It gets its own virtual IP (TailVIP) and its own MagicDNS name, and traffic to it is authorized by grants whose `dst` uses the `svc:` selector (kb-services). Node and service are two destinations that happen to be served by the same machine (Module 08). Granting one says nothing about the other.

## Root cause

Two weekend workstreams collided in one policy file. Workstream one translated legacy ACLs to grants. That translation was faithful: the old rule `{"action": "accept", "src": ["group:finance"], "dst": ["tag:billing-host:8443"]}` became `{"src": ["group:finance"], "dst": ["tag:billing-host"], "ip": ["tcp:8443"]}`. Legacy ACLs express network-layer rules with `action`, `src`, `dst`, and optional `proto`; grants restructure this into `src`, `dst`, and `ip`, and add capabilities ACLs never had, including application-layer `app` grants and `via` route scoping (kb-acl-syntax, kb-grants). A mechanical translation can only preserve what the old rules said, and the old rules predate the service, so no translator output could ever contain `svc:billing`.

Workstream two created the service and granted it to `group:platform` for testing. Nobody owned the join between the two streams: granting the new destination to the population that was told to use it. Grants and legacy ACLs can coexist in the same policy file (kb-grants), so nothing forced a full review at cutover, and the save went through because nothing in the file was invalid. It was merely incomplete, and default deny turned incomplete into an outage (Module 05, Module 02 for how the resulting filter reaches each node).

## Fix and prevention

**Immediate fix.** One grant:

```json
{"src": ["group:finance"], "dst": ["svc:billing"], "ip": ["443"]}
```

Save, then verify from the finance laptop: the service URL returns 200. Total change: one line, scoped to one service and one port.

**Durable prevention.** This is precisely what the `tests` section exists for. A test names a source and then lists destinations under `accept` and under `deny`, and the allowed destination forms include `svc:my-service` for the Tailscale Virtual IP addresses of a Service. If an assertion fails, Tailscale rejects the updated tailnet policy file with an error (kb-acl-syntax). The save that caused this outage would have been rejected at the console if this had existed on Friday:

```json
"tests": [
  {"src": "fin-lead@example.com", "proto": "tcp", "accept": ["svc:billing:443"]},
  {"src": "fin-lead@example.com", "deny": ["tag:billing-host:22"]}
]
```

Adopt the rule behind the fix: every access path you announce to users gets a test in the same change that announces it. Then the policy file cannot drift away from its promises, no matter how many migrations run over it.

> [!GOTCHA]
> "Migrate ACLs to grants" sounds like a syntax exercise, and for pure network rules it nearly is. But grants carry concepts that have no legacy spelling: `svc:` destinations, `app` capabilities, `via` route scoping (kb-grants). Any access that only exists in the new model must be authored, not translated. Diff review of a migration should ask "what does the new world need that the old world could not say?"

## The handoff package

Prepared in case this had been a Services defect; it was not.

- **Summary:** Tailscale Service `svc:billing` unreachable (connect timeout) for `group:finance` via service name and TailVIP; reachable for `group:platform`. Direct host access on cloud-1:8443 works for both groups. Post-migration grants contain no finance to `svc:billing` rule; behavior matches policy as written.
- **Repro:** finance member, `curl --max-time 10 https://billing.velvet-lizard.ts.net/`, timeout at 2026-08-10T14:02:31Z. Control: same command as platform member, 200 in 180ms at 14:04:10Z.
- **Log evidence:** finance-laptop (stable ID nF31mq7CNTRL) SYN timeouts to service TailVIP 14:02:31Z to 14:02:41Z; cloud-1 (stable ID nC77ab2CNTRL) shows no inbound flow for those attempts; policy file revision saved 2026-08-08T22:14:09Z is the change boundary.
- **Version matrix:** cloud-1 Tailscale 1.88.1 / Debian 12; finance-laptop 1.88.1 / macOS 14.6; platform-laptop 1.88.2 / macOS 15.1. Services require 1.86.0+ (kb-services); satisfied.
- **Impact scope:** one service, one user group (11 users), workaround exists (direct host URL).
- **Ruled out:** app outage, host advertisement or approval state, MagicDNS, client versions, general connectivity.
- **Proposed owning area:** tailnet policy configuration (Customer side); no product defect.

## The trap

The weak investigation anchors on "the new URL is broken" and goes spelunking in DNS: flushing caches, restarting clients, toggling MagicDNS, because the visible difference between the working and failing requests is the hostname. That path can consume a morning and produce a false fix the first time a cache flush coincides with someone testing from the wrong (platform) laptop. The other weak move is the panic revert of the whole migration on Monday morning, which is worse than doing nothing: it throws away a working policy structure, still does not grant finance the service (the legacy file never had it), and now two changes are tangled instead of one. The strong move noticed in step 3 that access varied by group, which converts the whole ticket into a sixty-second read of the grants section. When the same request works for one principal and fails for another, stop debugging infrastructure and start reading policy.
