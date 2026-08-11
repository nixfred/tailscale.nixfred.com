---
slug: magicdns-vpn-conflict
title: ts.net names die whenever the corporate VPN connects
description: On macOS, MagicDNS names stop resolving the moment a corporate VPN client connects, because two VPNs are fighting over the OS resolver configuration while Tailscale's own resolver stays healthy.
area: dns
difficulty: 2
symptom: "Whenever I connect the corp VPN on my Mac, nothing .ts.net resolves. The moment I disconnect it, everything comes back. IPs always work."
words: 1350
sources:
  - id: kb-magicdns
    url: https://tailscale.com/kb/1081/magicdns
    title: MagicDNS
    checked: 2026-08-10
  - id: kb-dns
    url: https://tailscale.com/kb/1054/dns
    title: DNS in Tailscale
    checked: 2026-08-10
  - id: kb-quad100
    url: https://tailscale.com/kb/1381/what-is-quad100
    title: What is 100.100.100.100?
    checked: 2026-08-10
  - id: ts-resolve-failure
    url: https://tailscale.com/docs/reference/troubleshooting/resolve-domain-names-failure
    title: Can't resolve domain names
    checked: 2026-08-10
  - id: ts-other-vpns
    url: https://tailscale.com/docs/reference/faq/other-vpns
    title: Can I use Tailscale alongside other VPNs?
    checked: 2026-08-10
---

## The ticket

Medium urgency, filed by a developer who needs both networks all day: the tailnet for internal tooling and the corporate VPN for a Customer environment. On his Mac, every `*.velvet-lizard.ts.net` name resolves fine until the corporate VPN client connects. Then every ts.net lookup fails, in the browser and in scripts, while raw Tailscale IPs keep working perfectly. Disconnect the corporate VPN and names return within seconds. Reproducible on demand.

> "Whenever I connect the corp VPN, nothing .ts.net resolves. Disconnect it, everything comes back. The Tailscale IPs work the whole time. One of these two VPNs is lying to me."

## Evidence provided

Collected while the corporate VPN was connected:

```
mac$ curl -sS https://node-b.velvet-lizard.ts.net:8443/healthz
curl: (6) Could not resolve host: node-b.velvet-lizard.ts.net

mac$ curl -sS https://100.98.12.34:8443/healthz
ok

mac$ dig +short node-b.velvet-lizard.ts.net @100.100.100.100
100.98.12.34

mac$ dscacheutil -q host -a name node-b.velvet-lizard.ts.net
mac$
```

The last command returned nothing. `tailscale status` shows all peers present and active the entire time.

## Hypothesis tree

The symptom cleanly spares the data plane: IPs work, so WireGuard, peers, and routes are all healthy. This is a resolution problem, and resolution on a Tailscale client has two halves that fail independently: the daemon's resolver, and the operating system wiring that decides which queries reach it (Module 06).

<div class="diagram-wrap">
<svg viewBox="0 0 800 300" role="img" aria-label="Hypothesis tree for ts.net resolution failing only while a corporate VPN is connected"><title>Hypothesis tree: ts.net names fail while the corporate VPN is up</title><rect x="240" y="12" width="320" height="56" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="400" y="35" text-anchor="middle" fill="var(--diagram-text)" font-size="14">ts.net names fail while corp VPN is up</text><text x="400" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Tailscale IPs keep working</text><path d="M400 68 L103 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L301 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L499 140" stroke="var(--diagram-line)" fill="none"/><path d="M400 68 L697 140" stroke="var(--diagram-line)" fill="none"/><rect x="8" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="103" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">MagicDNS resolver down</text><text x="103" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">dig @100.100.100.100</text><text x="103" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">answers instantly</text><text x="103" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="206" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="301" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Tailnet DNS config broken</text><text x="301" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no admin change and</text><text x="301" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">toggle tracks corp VPN</text><text x="301" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ruled out</text><rect x="404" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="499" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Corp DNS lacks ts.net</text><text x="499" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">true, but the question is</text><text x="499" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">why the OS asks it at all</text><text x="499" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="12">contributing</text><rect x="602" y="140" width="190" height="104" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="697" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="13">OS resolver wiring rewritten</text><text x="697" y="186" text-anchor="middle" fill="var(--diagram-text)" font-size="12">scutil --dns diff: ts.net</text><text x="697" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="12">entry vanishes on connect</text><text x="697" y="226" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">confirmed</text></svg>
</div>

## Investigation

1. **Confirm the correlation.** Toggle the corporate VPN three times with a resolution test after each change. Names fail within seconds of connect, recover within seconds of disconnect, every time. A tight, reversible correlation like this rules out flaky upstream DNS and tailnet-side changes: nothing in the admin console is toggling in sync with this laptop's VPN button.

2. **Ask Tailscale's own resolver directly.** 100.100.100.100 (Quad100) is a special device-local Tailscale address whose port 53 runs a stub resolver that resolves tailnet hostnames locally via MagicDNS and forwards other queries (kb-quad100). `dig +short node-b.velvet-lizard.ts.net @100.100.100.100` returns `100.98.12.34` instantly, even with the corporate VPN connected. This is the single most valuable data point in the ticket: tailscaled, MagicDNS, the netmap, and the name data are all fine. Whatever is broken sits between applications and that resolver. It is the same move the official troubleshooting page opens with, which is to separate the device's own DNS configuration from Tailscale's part in it before blaming either (ts-resolve-failure).

3. **Ask the OS the way applications do.** For testing DNS on macOS the DNS docs point at the native `dscacheutil` command (kb-dns), and unlike the tools in the gotcha below it goes through system resolution. `dscacheutil -q host -a name node-b.velvet-lizard.ts.net` returns nothing while the corporate VPN is up, and returns the address when it is down. So the OS resolution path is what breaks, exactly matching what `curl` and the browser see.

4. **Diff the resolver wiring.** `scutil --dns` shows the macOS resolver configuration. With only Tailscale up, the list includes an entry directing the tailnet domain at Tailscale's resolver:

   ```
   resolver #2
     domain   : velvet-lizard.ts.net
     nameserver[0] : 100.100.100.100
     flags    : Request A records, Request AAAA records
   ```

   Connect the corporate VPN and run it again: that entry is gone, and the corporate client's resolvers (10.20.0.53, 10.20.0.54) now claim the default scope. All queries, including ts.net, are being sent to corporate DNS, which has no ts.net zone and answers NXDOMAIN. The mechanism is now fully identified.

5. **Confirm the corporate client's behavior.** Its settings show no split-DNS exceptions: it takes ownership of all DNS while connected. The Tailscale FAQ is blunt about this class: most VPNs set aggressive firewall rules to ensure all network traffic goes through them, and in most cases you cannot use Tailscale alongside another VPN without a workaround (ts-other-vpns). Two agents are writing one OS resolver table, and the corporate client writes last and wins.

> [!GOTCHA]
> On macOS, do not judge system DNS with `dig`, `host`, or `nslookup` alone. The MagicDNS docs note that some macOS CLI tools such as `host` and `nslookup` circumvent system DNS resolution (kb-magicdns), and `dig` queries whatever server it picks itself unless you point it somewhere with `@`. That is why `dig @100.100.100.100` is useful (it targets a specific resolver on purpose) while a bare `dig` result tells you almost nothing about what Safari or curl will do. `dscacheutil -q host` is the macOS test that walks the same path applications use (kb-dns).

## Root cause

MagicDNS names live behind a device-local resolver at 100.100.100.100, and each platform has its own way of wiring OS name resolution to it (Module 06 for the resolver, Module 09 for the per-platform wiring). On macOS that wiring is entries in the system resolver configuration, visible with `scutil --dns`, including a domain-scoped entry that sends `velvet-lizard.ts.net` queries to Quad100. The corporate VPN client, on connect, rewrote the system DNS configuration to point everything at corporate resolvers and dropped the scoped entry. Corporate DNS has no ts.net data, so every MagicDNS lookup died at an innocent bystander resolver. Tailscale's daemon and its resolver were healthy throughout, which is exactly what the evidence showed: `dig @100.100.100.100` succeeded while `dscacheutil` failed. Connectivity by IP never broke because DNS is the only casualty; the WireGuard data plane (Module 01) does not care what the OS resolver table says. This is a known coexistence class: the FAQ names aggressive traffic capture and DNS handling, plus address conflicts when the other VPN uses the same CGNAT range Tailscale uses (100.64.0.0 through 100.127.255.255), as the standard ways two VPNs hurt each other (ts-other-vpns). We checked: the corporate VPN assigns 172.16.x addresses, so this incident is DNS-only.

## Fix and prevention

**Immediate unblock.** The user keeps working with Tailscale IPs, which never broke. `tailscale status` gives the address for any peer.

**Durable fix.** Make the two DNS owners explicitly share. The Tailscale FAQ's DNS workaround for VPN coexistence is a split tunnel, also called restricted nameservers: a DNS configuration that resolves queries differently based on the query destination (ts-other-vpns). Apply that here by pointing the tailnet suffix at the resolver that can actually answer for it, which is Quad100 (kb-quad100). The right place to do it is the corporate VPN's own configuration, since it is the component overwriting the table: add a split-DNS rule forwarding `velvet-lizard.ts.net` (and `ts.net` if policy allows) to 100.100.100.100. This needs a request to the corporate IT team, so file it with the `scutil --dns` before and after diff attached; it is exactly the evidence they need.

**Not recommended here.** Disabling MagicDNS tailnet-wide, or having the user toggle "Use Tailscale DNS settings" off (kb-magicdns), removes the symptom by removing the feature for names this user needs daily. Userspace networking exists as a documented coexistence workaround, but the FAQ aims it at conflicts with Tailscale IP addresses and it works by exposing a SOCKS5 proxy rather than a normal interface (ts-other-vpns); wrong tool for a laptop whose only conflict is the resolver table.

> [!FROM-THE-FIELD]
> Reconnect order matters when two clients write one resolver table: reconnecting Tailscale after the corporate VPN often restores names until the corporate client reasserts itself. Treat that as a diagnostic hint and a demo for the IT ticket, never as the fix. A fix that depends on which daemon wrote last is a coin toss after every reboot.

## The handoff package

Assembled for the corporate IT team rather than for Tailscale engineering, because the evidence exonerates the Tailscale client; kept in the standard shape.

- **Summary:** On macOS 14.6, corporate VPN client connect removes the scoped ts.net resolver entry from the system DNS configuration, sending tailnet queries to corporate resolvers that cannot answer them. Tailscale's local resolver verified healthy throughout.
- **Repro:** 100% reproducible. Connect corp VPN; `dscacheutil -q host -a name node-b.velvet-lizard.ts.net` returns nothing; `dig +short node-b.velvet-lizard.ts.net @100.100.100.100` returns 100.98.12.34. Disconnect; both succeed.
- **Log evidence:** scutil --dns captures at 2026-08-10T15:22:04Z (VPN off, ts.net entry present, nameserver 100.100.100.100) and 15:24:31Z (VPN on, entry absent, default resolvers 10.20.0.53/54). Affected node: mac laptop, stable ID nM19rt4CNTRL, Tailscale IP 100.92.71.5.
- **Version matrix:** Tailscale 1.88.1 / macOS 14.6; corporate VPN client 5.2.x. One node affected so far; two more macOS users on the same corporate profile expected to reproduce.
- **Impact scope:** all MagicDNS names while corp VPN connected; no data plane impact; workaround (raw IPs) in use.
- **Ruled out:** tailscaled or MagicDNS failure (Quad100 answers), tailnet DNS misconfiguration (no changes, other platforms unaffected), peer or path failure (IPs work), CGNAT address collision (corp VPN uses 172.16.0.0/12).
- **Proposed owning area:** corporate VPN DNS profile (add split-DNS forward of ts.net to 100.100.100.100 per Tailscale's documented coexistence guidance).

## The trap

The weak investigation blames whichever VPN the responder likes less. Blaming Tailscale leads to toggling MagicDNS off for the whole tailnet or overriding DNS settings globally, which converts one user's conflict into everyone's regression. Blaming the corporate VPN without evidence produces an IT ticket that says "your VPN breaks Tailscale," which comes straight back marked cannot reproduce. The other classic failure is testing with bare `dig`, seeing an answer (because dig sidestepped the broken system path) and closing the ticket as user error while Safari still fails (kb-magicdns). The strong investigation costs three commands: `dig @100.100.100.100` to prove the daemon resolver is fine, `dscacheutil` to prove the OS path is broken, `scutil --dns` twice to show exactly which entry disappears and when. That diff converts a finger-pointing dispute between two vendors into a one-line configuration request with evidence attached.
