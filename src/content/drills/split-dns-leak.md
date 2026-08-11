---
slug: split-dns-leak
title: Internal names suddenly resolve to public IPs
description: A split DNS restricted nameserver entry was deleted during an admin console edit, so internal queries fell through to global resolvers that answer from the public zone.
area: dns
difficulty: 3
symptom: "Every laptop resolves gitlab.corp.example.com to a public address since this morning. It worked yesterday."
words: 1450
sources:
  - id: kb-dns
    url: https://tailscale.com/kb/1054/dns
    title: DNS in Tailscale
    checked: 2026-08-10
  - id: kb-magicdns
    url: https://tailscale.com/kb/1081/magicdns
    title: MagicDNS
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: kb-quad100
    url: https://tailscale.com/kb/1381/what-is-quad100
    title: What is 100.100.100.100?
    checked: 2026-08-10
---

## The ticket

A platform team runs a tailnet of about 200 devices with MagicDNS enabled. Internal services live under `corp.example.com`, served by an internal resolver at `10.0.5.53` that sits behind a subnet router (`node-b`, advertising an approved `10.0.0.0/16`). At 10:05 UTC the Customer opens a high urgency ticket: engineers cannot reach GitLab or the artifact registry, and browsers are throwing certificate warnings because they are landing on the wrong server entirely.

> "Since about 09:30 UTC every laptop resolves gitlab.corp.example.com to a public address and hits a certificate warning. Our DNS server has not changed. This all worked yesterday."

## Evidence provided

The first responder collected a query from an affected macOS client, `node-a`:

```
$ dig gitlab.corp.example.com A

; <<>> DiG 9.18.24 <<>> gitlab.corp.example.com A
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 23817
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; ANSWER SECTION:
gitlab.corp.example.com. 300	IN	A	203.0.113.20

;; Query time: 24 msec
;; SERVER: 100.100.100.100#53(100.100.100.100)
;; WHEN: Mon Aug 10 10:02:41 UTC 2026
```

The expected answer is `10.0.20.14`. Two facts in this one capture are worth more than everything else in the ticket: the answer came from `100.100.100.100`, and it is a clean `NOERROR` carrying a public address.

> [!HOW-IT-WORKS]
> With MagicDNS enabled, every device has a Tailscale DNS resolver on port 53 of the device-local address `100.100.100.100`, which resolves tailnet hostnames locally via MagicDNS and forwards other requests (kb-quad100, Module 06). The OS hands it every query. What happens to a forwarded query depends on the DNS configuration the control plane pushes (Module 02): a restricted nameserver only applies to queries matching a specific search domain, while a global nameserver handles queries for any domain (kb-dns). Split DNS is a routing table for questions.

## Hypothesis tree

Classify the wrongness before touching anything. "Right name, wrong answer" and "no answer" are different diseases: a dead resolver produces SERVFAIL, REFUSED, or a timeout; it can never produce a confident public A record. That single distinction prunes half the tree before you run a command.

<div class="diagram-wrap">
<svg viewBox="0 0 820 340" role="img" aria-label="Hypothesis tree for internal names resolving to public IPs">
  <title>Hypothesis tree: right name, wrong answer</title>
  <rect x="250" y="16" width="320" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="410" y="38" text-anchor="middle" font-size="14" fill="var(--diagram-text)">Internal names return public IPs</text>
  <text x="410" y="58" text-anchor="middle" font-size="12" fill="var(--diagram-text)">NOERROR, answered by 100.100.100.100</text>
  <line x1="410" y1="72" x2="105" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="310" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="515" y2="140" stroke="var(--diagram-line)"/>
  <line x1="410" y1="72" x2="720" y2="140" stroke="var(--diagram-line)"/>
  <rect x="12" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="105" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Internal resolver</text>
  <text x="105" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">down or unreachable</text>
  <text x="105" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Would be SERVFAIL or timeout,</text>
  <text x="105" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">never a clean public A record</text>
  <rect x="217" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="310" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Client bypassing</text>
  <text x="310" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Tailscale DNS</text>
  <text x="310" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">SERVER field would show a LAN</text>
  <text x="310" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">or public resolver, not quad-100</text>
  <rect x="422" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="515" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Split DNS route missing</text>
  <text x="515" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">from tailnet DNS config</text>
  <text x="515" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">tailscale dns status shows no route;</text>
  <text x="515" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">queries fall through to globals</text>
  <rect x="627" y="140" width="186" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="720" y="163" text-anchor="middle" font-size="13" fill="var(--diagram-text)">Public zone</text>
  <text x="720" y="181" text-anchor="middle" font-size="13" fill="var(--diagram-text)">tampered or hijacked</text>
  <text x="720" y="220" text-anchor="middle" font-size="11" fill="var(--diagram-text)">Record is legitimate and</text>
  <text x="720" y="236" text-anchor="middle" font-size="11" fill="var(--diagram-text)">predates the incident</text>
  <text x="410" y="300" text-anchor="middle" font-size="12" fill="var(--diagram-text)">Discriminators: who answered (SERVER), what kind of wrong (status), what config was pushed</text>
</svg>
</div>

## Investigation

1. **Confirm the query path.** The dig output already shows `SERVER: 100.100.100.100#53`. The OS handed the query to Tailscale's local resolver, exactly as designed. This rules out the bypass branch: resolv.conf drift, another VPN fighting for DNS, a hardcoded resolver in the app.

2. **Classify the wrong.** `status: NOERROR` with a public A record. A dead or unreachable internal resolver cannot manufacture that answer; it fails loudly. This demotes "resolver down" from primary suspect to impossible-as-sole-cause. Someone answered this query honestly, from the wrong view of the zone.

3. **Ask the internal resolver directly.** From the same client, through the still-approved `10.0.0.0/16` subnet route:

   ```
   $ dig @10.0.5.53 gitlab.corp.example.com A +short
   10.0.20.14
   ```

   Correct answer, 30 ms. The resolver is healthy, the subnet route works, ACLs permit the traffic. "Nothing changed on the DNS server" is now verified fact, not Customer assertion.

4. **Read the DNS config the control plane pushed.** On the client (the `dns` command is available in Tailscale v1.74.0 and later (kb-cli); output abridged):

   ```
   $ tailscale dns status

   === 'Use Tailscale DNS' status ===

   Tailscale DNS: enabled.

   === MagicDNS configuration ===

   MagicDNS: enabled tailnet-wide (suffix = velo-cirrus.ts.net)

   Resolvers (in preference order):
     - 1.1.1.1

   Split DNS Routes:
     (no routes configured: split DNS disabled)
   ```

   Yesterday this listed a route sending `corp.example.com` to `10.0.5.53`. Today the table is empty. The client is faithfully executing a configuration that no longer contains the rule. That rules out client caching, per-device weirdness, and platform quirks: every device got the same push.

5. **Check the admin console DNS page.** Under Nameservers, the global resolvers are present, but the restricted nameserver row (`10.0.5.53`, restricted to `corp.example.com`) is gone. Change history and the admin who made it line up: at 09:26 UTC someone swapped global nameservers and deleted the restricted row in the same edit session. Onset "about 09:30" matches.

6. **Explain the public answer.** `dig @9.9.9.9 gitlab.corp.example.com` from outside the tailnet returns the same `203.0.113.20`: a years-old public wildcard for `*.corp.example.com` pointing at the company's web gateway. The public record is legitimate, ruling out the hijack branch.

> [!ON-THE-WIRE]
> Per the DNS KB, when you use a public global nameserver such as Cloudflare or Google, Tailscale automatically uses DNS over HTTPS to encrypt your DNS queries. So a packet capture filtered to port 53 on the client shows nothing for the leaked queries; they left over 443. And the queries that used to go to `10.0.5.53` traveled inside the WireGuard tunnel (Module 01), invisible on the physical interface. If your instinct on DNS problems is "tcpdump port 53", a Tailscale client is where that instinct quietly stops working.

## Root cause

Split DNS in Tailscale is a suffix-to-resolver routing table, stored in the admin console DNS page and pushed to every client by the control plane (Module 02). A restricted nameserver entry said: queries matching `corp.example.com` go only to `10.0.5.53`. During a routine nameserver edit, an admin deleted that entry. Per the DNS KB, a restricted nameserver only applies to queries matching a specific search domain, while a global nameserver handles queries for any domain, so with the restricted row gone the internal names stopped matching anything special and became ordinary queries for the global resolver. The quad-100 resolver on each client (Module 06) kept doing its job perfectly; the table it was given simply had one less row.

The reason this presented as wrong answers rather than failures is split-horizon DNS: the same names exist in the public zone with different records. If the public wildcard had not existed, every lookup would have returned NXDOMAIN, the ticket would have said "names stopped resolving," and the missing-route diagnosis would have been nearly instant. This is the signature to memorize (Module 11): no answer points at a server or path; the right name with a wrong answer points at query routing, and on a tailnet, query routing is the split DNS table.

## Fix and prevention

**Immediate.** In the admin console DNS page, add the nameserver back: Add nameserver, Custom, `10.0.5.53`, then restrict it to the search domain `corp.example.com` so it becomes a restricted nameserver again. The control plane pushes the change without any client restart. Verify on an affected client: `dig gitlab.corp.example.com` now returns `10.0.20.14` from `100.100.100.100`, and `tailscale dns status` lists the route again. Total client-side action required: none, which is also your proof of the mechanism.

**Durable.**

1. Treat the DNS page as production configuration. Split DNS lives in the admin console, not in the policy file, so it does not ride through your ACL review flow. Give it an equivalent: a documented change process and a second person on any nameserver edit.
2. Add a canary: a scheduled job on a tailnet node runs `dig canary.corp.example.com` and alerts if the answer falls outside `10.0.0.0/16`. This converts the silent failure mode into a paged one, and it would have caught this at 09:27 instead of 10:05.
3. If the public wildcard is not load-bearing, remove it. A failure mode of NXDOMAIN is a gift: loud, obvious, and impossible to mistake for an application bug.

## The handoff package

**Summary:** All tailnet clients resolve `corp.example.com` names to public IPs; split DNS restricted nameserver entry absent from tailnet DNS config after an 09:26 UTC admin console edit.
**Repro:** On any client with MagicDNS enabled, `dig gitlab.corp.example.com` returns `203.0.113.20` (public wildcard) from `100.100.100.100`; expected `10.0.20.14`.
**Log evidence:** 10:02:41 UTC, node-a: NOERROR public answer via quad-100 (dig capture attached). 09:26 UTC: DNS page nameserver edit removing restricted entry `10.0.5.53` for `corp.example.com`. 10:41 UTC, node-a: `dig @10.0.5.53` returns correct internal record.
**Version matrix:** Clients v1.84.0 (macOS, Linux); subnet router node-b v1.84.0 (Linux); MagicDNS enabled tailnet-wide.
**Impact scope:** ~200 devices, every name under `corp.example.com`, 09:26 to 11:10 UTC.
**Ruled out:** internal resolver health, subnet route to `10.0.0.0/16`, ACLs, client DNS bypass, public zone tampering, client caching.
**Proposed owning area:** none in product; admin configuration change. If escalated at all: control plane DNS configuration UX (deleting a restricted nameserver warns no differently than deleting a global one).

## The trap

The weak version of this investigation hears "DNS is broken" and starts restarting things: the internal resolver, tailscaled, the laptops. Cache flushes everywhere. Each restart takes long enough that someone believes it worked, then the next lookup disproves it, and two hours vanish. The evidence that shortcuts all of it was in the very first dig: the SERVER field says who answered, and the status field says what kind of wrong you have. A clean NOERROR with a public address through quad-100 can only mean the query was routed somewhere that answers from the public view, and on a tailnet exactly one table decides that routing.

> [!GOTCHA]
> Split-horizon domains fail silently. When the same suffix has public records, losing a split DNS route does not break resolution, it redirects it. Monitor for wrong answers, not just failed ones: an NXDOMAIN alert will never fire on the failure mode that actually hurts.
