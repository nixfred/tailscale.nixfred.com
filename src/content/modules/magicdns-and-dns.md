---
module: 6
slug: magicdns-and-dns
title: MagicDNS and split DNS
description: How Tailscale's Quad100 resolver, MagicDNS names, per-platform OS resolver rewiring, split DNS, and exit node DNS behavior actually work, and how they fail.
order: 6
words: 4500
sources:
  - id: kb-magicdns
    url: https://tailscale.com/docs/features/magicdns
    title: MagicDNS
    checked: 2026-08-10
  - id: kb-dns
    url: https://tailscale.com/docs/reference/dns-in-tailscale
    title: DNS in Tailscale (DNS settings)
    checked: 2026-08-10
  - id: kb-quad100
    url: https://tailscale.com/docs/reference/quad100
    title: What is 100.100.100.100?
    checked: 2026-08-10
  - id: kb-tailnet-name
    url: https://tailscale.com/docs/concepts/tailnet-name
    title: Tailnet name
    checked: 2026-08-10
  - id: kb-linux-dns
    url: https://tailscale.com/docs/reference/linux-dns
    title: Configuring Linux DNS
    checked: 2026-08-10
  - id: docs-dns-reference
    url: https://tailscale.com/docs/reference/dns-in-tailscale
    title: DNS in Tailscale (reference)
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
---

## The promise

1. You will be able to explain what Quad100 (100.100.100.100) is, why it never leaves your device, and why every DNS feature Tailscale ships is implemented inside it.
2. You will be able to decode any MagicDNS name into its parts (machine name, tailnet name, ts.net suffix) and predict when a short name will and will not resolve.
3. You will be able to describe, per platform, exactly how Tailscale rewires the OS resolver: systemd-resolved and resolv.conf on Linux, scoped resolvers on macOS, NRPT rules on Windows.
4. You will be able to state precisely what "Override DNS servers" does and does not do, and when split DNS (restricted nameservers) is the better tool.
5. You will be able to predict how DNS behaves when an exit node is in use, and which admin console setting changes that.
6. You will be able to run a five minute DNS diagnosis with `dig @100.100.100.100`, `tailscale dns status`, and the platform native lookup tools, and localize the fault to one of four layers.

## Foundation

You already know how a stub resolver works: applications call the OS resolver library, the OS consults its configured nameservers, and a recursive resolver somewhere does the real work. You know that `/etc/resolv.conf` is the classic Unix expression of that configuration, that search domains let `ping db1` expand to `ping db1.corp.example`, and that the DNS client on every OS has grown layers of caching, policy, and interface scoping that the classic model does not capture.

You also know the pain: every VPN ever built has to answer the question "who resolves names while the tunnel is up?" Full tunnel VPNs traditionally seize the whole resolver configuration. That works until the user also needs their home printer, their corporate intranet, and a second VPN at the same time. The industry answer to this is split DNS: route queries for certain domains to certain resolvers, leave everything else alone.

Tailscale's DNS story is a specific, opinionated implementation of that answer. The core move: instead of pointing your OS at some remote resolver, Tailscale points it at a resolver that lives inside the daemon already running on your machine. Everything else follows from that one decision.

One more piece of context from earlier modules: the control plane (Module 02) is how DNS configuration reaches your device. MagicDNS name mappings, global nameservers, restricted nameservers, and search domains are all tailnet wide settings distributed by the coordination server, then enforced locally by each node. DNS resolution itself never touches Tailscale's infrastructure.

## Core content

### Quad100: the resolver that lives in the daemon

The analogy: Quad100 is the concierge desk in the lobby of your own building. You never leave the building to ask it a question. If you ask about a resident (a tailnet machine), the concierge answers from the building's own directory, instantly, with no outside call. If you ask about anything else, the concierge picks up the phone and calls the right outside party on your behalf, following whatever calling rules management has posted.

The mechanism: `100.100.100.100` is a reserved address inside the Tailscale CGNAT range that behaves like a localhost service. Traffic to it is handled by `tailscaled` (or the equivalent client process) on your own device and does not leave the machine unless the service being provided requires forwarding. There is an IPv6 twin, `fd7a:115c:a1e0::53`. On port 53, Quad100 runs a stub DNS resolver with these jobs:

1. Resolve MagicDNS names for your tailnet locally, from the netmap the control plane already pushed to you. No network round trip, no external logging.
2. Forward every other query upstream according to tailnet DNS policy: to restricted nameservers for matching domains, to global nameservers if configured, or to the resolvers the OS already had.
3. Use DNS-over-HTTPS to upstream resolvers that support it, so forwarded queries are encrypted in transit where possible. Tailscale applies DoH automatically for known public providers such as Cloudflare and Google.
4. When the device is using an exit node, forward queries through the tunnel to the exit node instead (more on this below).

Quad100 also serves a device management web interface on port 80, enabled by default in Tailscale v1.64.0 and later (checked 2026-08-10), but that is a management surface, not part of the DNS path.

> [!HOW-IT-WORKS] Other devices on your tailnet cannot reach your 100.100.100.100. Every node has its own Quad100, answered by its own local daemon. It is per-device in the same way 127.0.0.1 is, which is also why "can node-a resolve names" and "can node-b resolve names" are always independent questions.

The failure mode: because the OS resolver is pointed at Quad100, the daemon is now load bearing for all DNS on the machine, not just tailnet DNS. If `tailscaled` hangs, crashes, or is stopped without cleaning up the resolver configuration, the symptom is not "Tailscale is down." The symptom is "the internet is down," because every DNS query on the box is being sent to a resolver that no longer answers. This single fact explains a large fraction of "Tailscale broke my laptop's WiFi" reports: WiFi was fine, DNS was orphaned.

### MagicDNS names: the naming scheme

The analogy: MagicDNS is a phone contact list that writes itself. Every device that joins the tailnet gets an entry automatically, the entry follows the device across networks and IP changes, and everyone in the tailnet sees the same list.

The mechanism: every device gets a fully qualified domain name built from two parts:

```
machine-name . tailnet-name . ts.net
```

For example `node-a.velvet-osprey.ts.net`. The machine name is generated from the OS hostname when the device joins; you can edit it in the admin console, and if the device's name changes, the MagicDNS entry changes with it. The tailnet name is assigned as `tail<ID>.ts.net` using a random hexadecimal string (something like `tailfe8c.ts.net`), and admins can replace it with a randomly generated memorable name like `cat-crocodile.ts.net` from the DNS page of the admin console. You pick from generated options and can re-roll for more; you cannot type an arbitrary name. You can revert to the original hex name later.

Short names come from search domains. When MagicDNS is enabled, Tailscale automatically adds your tailnet domain as a search domain on each device. That is the entire trick behind `ssh node-a` working: the OS expands `node-a` to `node-a.velvet-osprey.ts.net` before resolving. MagicDNS is enabled by default for tailnets created on or after October 20, 2022, and since Tailscale v1.20 it no longer requires you to configure a global nameserver first (checked 2026-08-10).

> [!GOTCHA] Machines shared into your tailnet from someone else's tailnet (Module 04 covers sharing and identity) do not get short names. They live in the other tailnet's namespace, so you must use their full ts.net FQDN, and the client must be v1.4 or later. If `ssh partner-box` fails but the full name works, this is why.

The failure mode, in three flavors. First, renaming: the tailnet name is embedded in every FQDN and every HTTPS certificate (Module 08), so renaming the tailnet can break existing links, scripts, and pinned names; also, once a memorable name has been used for HTTPS certificates, that specific name cannot be generated again after you release it. Second, staleness: MagicDNS answers come from the local netmap, so a device that has lost its control plane connection can keep resolving from a stale map or fail to learn about new peers. Third, collisions: a machine name that shadows a real host in another search domain resolves through whichever search domain the OS applies to the query, and since Tailscale adds the tailnet domain to the device's search list, people whose LAN also has a `node-a` get surprised.

The legacy `.beta.tailscale.net` domain stopped working on September 13, 2024. If you find it in an old script, that script has been broken for a while.

### How the OS resolver gets rewired, per platform

This is the part that makes or breaks real deployments, because Tailscale does not get to invent a DNS API. It has to use whatever each OS provides, and the three major desktop platforms provide three completely different things.

The analogy: Tailscale is a new tenant who needs their mail routed correctly in three different countries, each with a different postal bureaucracy. Same goal everywhere, three different sets of forms.

<div class="diagram-wrap">
<svg viewBox="0 0 880 360" role="img" aria-label="Per-platform DNS plumbing: Linux systemd-resolved, macOS scoped resolvers, and Windows NRPT all direct queries to the local Quad100 resolver">
  <title>How each OS routes DNS queries to Quad100</title>
  <defs>
    <marker id="arr1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-accent)"/>
    </marker>
  </defs>
  <rect x="20" y="20" width="250" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="145" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="15" font-weight="bold">Linux</text>
  <text x="145" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="12">app query</text>
  <text x="145" y="95" text-anchor="middle" fill="var(--diagram-text)" font-size="12">systemd-resolved stub</text>
  <text x="145" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="12">or rewritten resolv.conf</text>
  <text x="145" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="12">nameserver 100.100.100.100</text>
  <rect x="315" y="20" width="250" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="15" font-weight="bold">macOS</text>
  <text x="440" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="12">app query</text>
  <text x="440" y="95" text-anchor="middle" fill="var(--diagram-text)" font-size="12">system resolver</text>
  <text x="440" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="12">scoped resolver entries</text>
  <text x="440" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="12">per domain, via extension</text>
  <rect x="610" y="20" width="250" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="735" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="15" font-weight="bold">Windows</text>
  <text x="735" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="12">app query</text>
  <text x="735" y="95" text-anchor="middle" fill="var(--diagram-text)" font-size="12">DNS Client service</text>
  <text x="735" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="12">NRPT policy rules</text>
  <text x="735" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="12">match ts.net and split domains</text>
  <line x1="145" y1="170" x2="400" y2="270" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr1)"/>
  <line x1="440" y1="170" x2="440" y2="270" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr1)"/>
  <line x1="735" y1="170" x2="480" y2="270" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr1)"/>
  <rect x="290" y="275" width="300" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="440" y="300" text-anchor="middle" fill="var(--diagram-text)" font-size="14" font-weight="bold">Quad100 resolver in tailscaled</text>
  <text x="440" y="322" text-anchor="middle" fill="var(--diagram-text)" font-size="12">100.100.100.100:53</text>
</svg>
</div>

**Linux.** There is no single Linux DNS system, so Tailscale detects what is managing `/etc/resolv.conf` and cooperates with it. The preferred setup is systemd-resolved: Tailscale registers its resolver and its domains with resolved, resolved keeps its stub on 127.0.0.53, and `/etc/resolv.conf` should be a symlink to `/run/systemd/resolve/stub-resolv.conf`. In that world, real split DNS works: resolved sends ts.net (and any restricted domains) to Quad100 and everything else wherever it was already going. If nothing is managing resolv.conf, Tailscale falls back to rewriting the file directly, placing `100.100.100.100` as the nameserver. That works, but it is a shared file with no locking: `dhclient`, NetworkManager, and cloud-init all believe they own it too, and the last writer wins. Tailscale's own Linux DNS documentation is frank that this is a messy space and recommends centralizing on systemd-resolved or resolvconf so DHCP clients stop fighting over the file.

> [!FROM-THE-FIELD] The canonical worst case is Amazon Linux 2023, where the distro's legacy resolved configuration causes Tailscale's 100.100.100.100 to end up in a backup copy of resolv.conf that then gets fed back as an upstream, creating a DNS forwarding loop: Quad100 forwarding to a file that names Quad100. The documented fix is to move systemd-resolved into normal stub resolver mode and point resolv.conf at the stub. The general lesson travels: on Linux, always ask "who else thinks they own resolv.conf?"

**macOS.** The Tailscale client runs as a Network Extension and installs scoped resolver entries: the system resolver is told "for these domains, use this resolver" rather than having its primary resolver replaced. You can see these entries with `scutil --dns`. The critical consequence is that only lookups going through the system resolution APIs honor scoped resolvers. The classic BSD tools `host`, `nslookup`, and `dig` speak DNS directly to whatever server they choose and bypass the system resolver entirely, so on macOS they will fail to resolve MagicDNS names even while Safari and `ssh` resolve them fine. The supported way to test what the OS actually does is `dscacheutil -q host -a name node-a.velvet-osprey.ts.net`.

**Windows.** Tailscale uses the Name Resolution Policy Table, NRPT, a Windows policy mechanism that says "queries matching this namespace go to this DNS server." Tailscale installs NRPT rules for the ts.net domain and for any restricted nameserver domains, steering those to Quad100 while the interface's normal DNS servers keep handling the rest. Same trap as macOS, different reason: `nslookup` does not honor NRPT rules, so it lies to you about split DNS behavior. Use PowerShell's `Resolve-DnsName`, which goes through the DNS Client service and honors policy.

> [!GOTCHA] On two of the three major desktop platforms, the tool a network engineer reaches for first (`nslookup` or `dig` against the default resolver) tests the wrong path. Before you file "MagicDNS is broken," confirm your test tool actually uses the OS resolver: `dscacheutil` on macOS, `Resolve-DnsName` on Windows. Plain `dig name @100.100.100.100` is trustworthy everywhere because it names its target explicitly.

The failure mode common to all three platforms: partial teardown. DNS configuration is stateful OS mutation, and anything that kills the client without letting it clean up (force quit, crash, aggressive scripts) can leave the OS pointing at a resolver that is gone. On Linux this looks like a stale resolv.conf; on Windows, stale NRPT rules; on macOS, stale scoped entries. All three present as "no DNS until I toggled Tailscale or rebooted."

Every platform has an opt out. `tailscale set --accept-dns=false` on Linux, unchecking "Use Tailscale DNS settings" on macOS, and deselecting "Use Tailscale DNS" from the tray menu on Windows all tell the client: keep the tunnel, leave my resolver alone. With DNS acceptance off, MagicDNS names stop resolving through the OS (you can still query Quad100 explicitly), which makes this both a useful escape hatch and a common self inflicted mystery.

### "Override DNS servers": what it really does

The analogy: by default, Tailscale's DNS settings are a set of additions to the phone book your device already had. Override local DNS replaces the phone book.

The mechanism: in the admin console DNS page, global nameservers are resolvers for all domains. Without the override toggle, devices may still use their locally configured (DHCP provided) resolvers alongside tailnet policy. With "Override DNS servers" enabled, devices ignore their local DNS configuration and use only the tailnet's global nameservers for general resolution. Queries still enter through Quad100; the override controls what Quad100 forwards to. This is how you guarantee every device resolves through, say, a filtering resolver or an internal DNS server, no matter what network it sits on. One detail worth knowing: when you add a known public provider, Tailscale treats that provider's address list as a unit, so adding one of its addresses brings the set.

The failure mode: override is an availability bet. The moment you enable it, every device's DNS depends on being able to reach the configured nameservers. A device on a captive portal network, or one whose only route to an internal nameserver is a subnet router that just went down (Module 07), now has no DNS at all, because you told it to ignore the local resolvers that do work. Tailscale's guidance is to make sure all devices can reach the global nameservers before forcing them to use tailnet DNS settings, and best practice is more than one global nameserver for redundancy.

### Split DNS: restricted nameservers

The analogy: split DNS is a mail sorting rule. Letters addressed to `corp.example` go in the courier bag for headquarters; everything else goes in the ordinary mail.

The mechanism: a restricted nameserver is a resolver paired with a domain. Configure `10.0.0.53` for `corp.example` and Quad100 forwards any query matching `*.corp.example` to `10.0.0.53`, touching nothing else. This composes cleanly with everything above: MagicDNS handles ts.net, restricted nameservers handle your named internal domains, and global or local resolvers handle the public internet. It is the tool for "my AWS VPC has private zones," "my office has an AD domain," and "I need internal names only when they are internal names."

Two behavioral notes worth engraving. First, ordering: when you list multiple resolvers, modern OS resolver stacks may query them in parallel or reorder them by performance, and Tailscale explicitly does not guarantee that resolvers are consulted in the order configured. If order matters to you, that is the signal that you actually want split DNS, where domain matching replaces ordering. Second, search domains: you can add tailnet wide search domains so short internal names expand for everyone, usable on devices running Tailscale v1.34 and later.

<div class="diagram-wrap">
<svg viewBox="0 0 880 420" role="img" aria-label="Decision flow inside the Quad100 resolver: MagicDNS match answers locally, restricted domain match forwards to that nameserver, otherwise global or local resolvers handle the query">
  <title>Quad100 query decision flow</title>
  <defs>
    <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-accent)"/>
    </marker>
  </defs>
  <rect x="340" y="15" width="200" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="43" text-anchor="middle" fill="var(--diagram-text)" font-size="13">query arrives at Quad100</text>
  <line x1="440" y1="61" x2="440" y2="95" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <rect x="330" y="100" width="220" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="128" text-anchor="middle" fill="var(--diagram-text)" font-size="13">name in tailnet? (ts.net)</text>
  <line x1="330" y1="123" x2="185" y2="123" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="255" y="113" text-anchor="middle" fill="var(--diagram-text)" font-size="11">yes</text>
  <rect x="25" y="100" width="160" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="105" y="121" text-anchor="middle" fill="var(--diagram-text)" font-size="12">answer locally</text>
  <text x="105" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="11">from netmap, no network</text>
  <line x1="440" y1="146" x2="440" y2="180" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="460" y="168" fill="var(--diagram-text)" font-size="11">no</text>
  <rect x="315" y="185" width="250" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="213" text-anchor="middle" fill="var(--diagram-text)" font-size="13">matches restricted domain?</text>
  <line x1="315" y1="208" x2="185" y2="208" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="255" y="198" text-anchor="middle" fill="var(--diagram-text)" font-size="11">yes</text>
  <rect x="25" y="185" width="160" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="105" y="206" text-anchor="middle" fill="var(--diagram-text)" font-size="12">forward to that</text>
  <text x="105" y="223" text-anchor="middle" fill="var(--diagram-text)" font-size="11">nameserver only</text>
  <line x1="440" y1="231" x2="440" y2="265" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="460" y="253" fill="var(--diagram-text)" font-size="11">no</text>
  <rect x="315" y="270" width="250" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="298" text-anchor="middle" fill="var(--diagram-text)" font-size="13">global nameservers set?</text>
  <line x1="315" y1="293" x2="185" y2="293" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="255" y="283" text-anchor="middle" fill="var(--diagram-text)" font-size="11">yes</text>
  <rect x="25" y="270" width="160" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="105" y="291" text-anchor="middle" fill="var(--diagram-text)" font-size="12">forward to global</text>
  <text x="105" y="308" text-anchor="middle" fill="var(--diagram-text)" font-size="11">(only these if override on)</text>
  <line x1="440" y1="316" x2="440" y2="350" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr2)"/>
  <text x="460" y="338" fill="var(--diagram-text)" font-size="11">no</text>
  <rect x="330" y="355" width="220" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="376" text-anchor="middle" fill="var(--diagram-text)" font-size="12">forward to the resolvers</text>
  <text x="440" y="393" text-anchor="middle" fill="var(--diagram-text)" font-size="12">the OS already had</text>
</svg>
</div>

The failure mode: split DNS quietly depends on reachability of the restricted nameserver, which is often itself behind Tailscale (a subnet router or an internal node). When that path breaks, only names under the restricted domain die, which produces the classic confusing symptom: "the internet is fine, ts.net names are fine, but everything under corp.example times out." That pattern is a routing problem wearing a DNS costume; check Module 07 before you blame the resolver.

### Exit nodes and DNS

The analogy: when you use an exit node, you have moved into someone else's building, so by default you use their concierge for outside calls too.

The mechanism: when a device routes through an exit node (Module 07), Quad100 forwards DNS queries through the tunnel to be resolved via the exit node, regardless of the nameservers you configured. This is deliberate privacy behavior: if all your traffic exits from cloud-1, your DNS should too, or your queries leak your browsing to the local network while your traffic exits elsewhere. Since it is a Quad100 behavior, it applies to forwarded queries; MagicDNS names still answer locally from the netmap.

The control: in the admin console, each nameserver has a "Use with exit node" setting. Enabling it says: even when an exit node is active, keep sending matching queries to this nameserver. That is the tool for "laptops use exit nodes for privacy, but corp.example must still resolve against the internal resolver."

The failure mode: an exit node whose own DNS is broken breaks DNS for every client currently using it, and the clients' own perfectly healthy resolvers do not save them. Symptom signature: names fail only while the exit node is selected, `tailscale ping` to peers still works, and deselecting the exit node instantly fixes resolution.

<div class="diagram-wrap">
<svg viewBox="0 0 880 300" role="img" aria-label="Sequence of a DNS query while an exit node is active: app to Quad100, MagicDNS answered locally, other queries forwarded through the tunnel to the exit node's resolver path">
  <title>DNS query path with an active exit node</title>
  <defs>
    <marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--diagram-accent)"/>
    </marker>
  </defs>
  <rect x="20" y="30" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13">app on node-a</text>
  <rect x="250" y="30" width="170" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="335" y="53" text-anchor="middle" fill="var(--diagram-text)" font-size="13">local Quad100</text>
  <text x="335" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="11">on node-a</text>
  <rect x="520" y="30" width="160" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="600" y="53" text-anchor="middle" fill="var(--diagram-text)" font-size="13">exit node cloud-1</text>
  <text x="600" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="11">via WireGuard tunnel</text>
  <rect x="730" y="30" width="130" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="795" y="53" text-anchor="middle" fill="var(--diagram-text)" font-size="13">upstream</text>
  <text x="795" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="11">resolver</text>
  <line x1="170" y1="55" x2="245" y2="55" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr3)"/>
  <line x1="420" y1="55" x2="515" y2="55" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr3)"/>
  <line x1="680" y1="55" x2="725" y2="55" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr3)"/>
  <text x="467" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="11">non-tailnet query</text>
  <rect x="250" y="150" width="170" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="335" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ts.net query:</text>
  <text x="335" y="193" text-anchor="middle" fill="var(--diagram-text)" font-size="12">answered locally,</text>
  <text x="335" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="12">never forwarded</text>
  <line x1="335" y1="80" x2="335" y2="145" stroke="var(--diagram-accent)" stroke-width="2" marker-end="url(#arr3)"/>
  <rect x="520" y="150" width="340" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="690" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="12">exception: nameservers marked</text>
  <text x="690" y="193" text-anchor="middle" fill="var(--diagram-text)" font-size="12">"Use with exit node" still receive</text>
  <text x="690" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="12">their matching queries directly</text>
</svg>
</div>

## On the wire

DNS problems are the easiest Tailscale problems to localize, because you can interrogate each layer separately. The layers, from the inside out: the Quad100 resolver, the tailnet DNS policy it received, the OS resolver plumbing pointing at it, and the upstreams it forwards to.

Ask Quad100 directly, bypassing all OS plumbing:

```
$ dig +short node-b.velvet-osprey.ts.net @100.100.100.100
100.101.102.103
```

If this answers, the daemon is up, MagicDNS is on, and the name exists in your netmap. Everything left to debug is OS plumbing or upstream policy. If it times out, stop debugging the OS: the daemon itself is not serving.

Ask the daemon what DNS configuration it thinks it has:

```
$ tailscale dns status
=== 'Use Tailscale DNS' status ===
Tailscale DNS: enabled.
...
=== MagicDNS configuration ===
MagicDNS: enabled tailnet-wide (suffix = velvet-osprey.ts.net)
Other devices in your tailnet can reach this device at node-a.velvet-osprey.ts.net
Search Domains:
  - velvet-osprey.ts.net
Routes:
  - corp.example -> 10.0.0.53:53
```

`tailscale dns status` prints the local forwarder configuration and the tailnet wide MagicDNS configuration; add `--all` for advanced debugging detail. Its sibling `tailscale dns query name type`, available in Tailscale v1.76.0 and later (checked 2026-08-10), performs a query through the local forwarder itself, which tests exactly the path applications use minus the OS resolver layer.

Then test the OS layer with the tool that honors it:

```
# macOS: uses the system resolver, honors scoped resolvers
$ dscacheutil -q host -a name node-b.velvet-osprey.ts.net
name: node-b.velvet-osprey.ts.net
ip_address: 100.101.102.103

# Windows: honors NRPT, unlike nslookup
PS> Resolve-DnsName node-b.velvet-osprey.ts.net

# Linux with systemd-resolved: show who owns which domain
$ resolvectl status tailscale0
Link 5 (tailscale0)
    Current DNS Server: 100.100.100.100
           DNS Servers: 100.100.100.100
            DNS Domain: velvet-osprey.ts.net corp.example ~0
```

> [!ON-THE-WIRE] A MagicDNS answer produces zero packets on any physical interface: the query goes into the TUN device and the daemon answers from memory. A split DNS answer for corp.example produces WireGuard encrypted UDP toward the restricted nameserver's path. A forwarded public query may leave as DNS-over-HTTPS (TCP 443) to a supporting upstream rather than classic port 53, which surprises people staring at port 53 captures and seeing nothing. Forwarded queries can be logged by whoever runs the upstream nameserver; the local MagicDNS resolution is not.

One caution on interpreting captures and logs: because modern resolver stacks parallelize and reorder upstreams, do not read meaning into which of several global nameservers answered a given query. Tailscale documents that configured resolver order is not guaranteed.

## Failure modes

1. **Everything resolves by IP, nothing by name, on one machine.** `tailscale ping node-b` works, `dig @100.100.100.100` times out. The daemon's resolver is not serving: client stopped, hung, or MagicDNS disabled tailnet wide. Restart the client; check the admin console DNS page.
2. **ts.net names dead, internet fine.** `dig @100.100.100.100` answers correctly but normal lookups fail. The OS plumbing layer is broken: DNS acceptance turned off (`--accept-dns=false`, the macOS checkbox, the Windows tray toggle), or another program reclaimed the resolver configuration. On Linux, read `/etc/resolv.conf` and ask what wrote it last.
3. **Names resolve on macOS but "not" on the same Mac in a terminal.** `ssh node-b` works, `host node-b` fails. Not a failure at all: `host`, `nslookup`, and bare `dig` bypass the macOS system resolver and its scoped entries. Test with `dscacheutil` before believing anything is wrong.
4. **Names resolve everywhere except one Windows box, but only in `nslookup`.** Mirror image of the macOS trap: `nslookup` ignores NRPT, so it reports failure (or wrong answers) for names that every real application resolves fine. Use `Resolve-DnsName`.
5. **No DNS at all after Tailscale crashed or was force killed.** The OS still points at a Quad100 nobody is answering. Symptom is total resolution failure that survives until the client restarts and rewrites, or you manually restore, the resolver configuration. This is the partial teardown failure.
6. **DNS dies periodically on a Linux server, then comes back.** Classic resolv.conf fight: dhclient or NetworkManager rewrites the file on lease renewal, clobbering Tailscale's entry, and one side eventually rewrites it back. Fix by centralizing on systemd-resolved with `/etc/resolv.conf` symlinked to the stub file. On Amazon Linux 2023, check for the documented forwarding loop where a backup resolv.conf feeds 100.100.100.100 back to itself.
7. **Internal domain dead, everything else fine.** `corp.example` names time out while ts.net and public names work. The restricted nameserver for that domain is unreachable, usually because the route to it (often a subnet router) is down. This is Module 07's problem surfacing as DNS.
8. **DNS breaks only when an exit node is selected.** Forwarded queries are resolved via the exit node by default; if the exit node's DNS path is broken, yours is too. Deselect the exit node to confirm, then fix the exit node, or mark critical nameservers "Use with exit node."
9. **Enabling "Override DNS servers" took a fleet segment offline.** Devices that cannot reach the tailnet's global nameservers (captive portals, isolated networks, a down subnet router in front of an internal resolver) lose all DNS, because you told them to ignore the local resolvers that still worked. Verify reachability from every network segment before enabling override, and configure redundant nameservers.
10. **Another VPN and Tailscale coexist badly.** A full tunnel corporate VPN that seizes the whole resolver, or a second product writing its own scoped entries or NRPT rules, can shadow Tailscale's configuration (or be shadowed by it). Symptom: name resolution depends on which client connected last. Durable fix: prefer split DNS scoping on both sides so each owns only its domains.
11. **Short names fail, FQDNs work.** Search domain missing on that device (DNS acceptance off), or the target is a machine shared from another tailnet, which never gets a short name and requires its full ts.net FQDN.
12. **Scripts broke after the tailnet was renamed.** Every FQDN changed with the tailnet name. Old links, pinned certs, and hardcoded names break by design; and a memorable name once used for HTTPS certificates cannot be generated again later.

## Check yourself

**1. A user reports: "Tailscale DNS is broken on my Mac. `nslookup node-b` fails, but weirdly the browser can open http://node-b just fine." What is happening, and what single command settles it?**

Answer: Almost certainly nothing is broken. On macOS, Tailscale configures DNS through scoped resolver entries attached to the system resolver, and only lookups made through the system resolution APIs see those entries. The browser and `ssh` use those APIs, so `node-b` expands via the MagicDNS search domain and resolves through Quad100. But `nslookup`, `host`, and bare `dig` construct DNS queries themselves and send them to the default resolver directly, bypassing the scoped entries entirely, so they fail on MagicDNS names by design. The command that settles it is `dscacheutil -q host -a name node-b.velvet-osprey.ts.net`, which exercises the real system resolver path; if that returns the 100.x address, the system is healthy and the only bug was the test methodology. If you want a resolver tool result anyway, `dig node-b.velvet-osprey.ts.net @100.100.100.100` targets Quad100 explicitly and works on every platform.

**2. You enable "Override DNS servers" with a single global nameserver, 10.0.0.53, which lives in the office and is advertised over a subnet router. Remote laptops immediately lose all DNS whenever the office subnet router reboots. Explain the full causal chain and two distinct fixes.**

Answer: With override enabled, every device ignores its locally configured resolvers and forwards all non-tailnet queries through Quad100 exclusively to the tailnet's global nameservers, here a single internal resolver reachable only via the subnet router. When the subnet router goes down, laptops lose the route to 10.0.0.53; Quad100 has no other upstream and is forbidden from falling back to local resolvers, so every public lookup times out. MagicDNS names keep working, which is a diagnostic tell. Fix one: add at least one redundant, independently reachable global nameserver (a second internal resolver on a different path, or a public resolver if policy allows), following the documented best practice of multiple global nameservers. Fix two: stop using override for this goal entirely; make 10.0.0.53 a restricted nameserver for the internal domain (split DNS), so only `corp.example` queries depend on the office path and everything else uses whatever resolver the laptop's network provides. Choose fix two when the real requirement was "resolve internal names," and reserve override for when you genuinely must force all resolution through controlled resolvers.

**3. A laptop using exit node cloud-1 resolves public names fine, but the Customer's internal zone `corp.example`, served by a restricted nameserver at the Customer site, stopped resolving the moment the exit node was selected. Peers still ping. What is the mechanism, and what setting addresses it?**

Answer: By default, once an exit node is active, Quad100 forwards DNS queries via the exit node regardless of the tailnet's configured nameservers. Public resolution works because cloud-1's resolution path is healthy, but queries for `corp.example` are now being resolved from cloud-1's vantage point instead of being forwarded from the laptop to the restricted nameserver, and cloud-1 either has no route to the internal resolver or no knowledge of the zone, so those lookups die. Peer pings still work because tailnet connectivity and MagicDNS are unaffected. The addressing setting is per nameserver in the admin console: enable "Use with exit node" on the restricted nameserver for `corp.example`, which tells clients to keep sending matching queries to that nameserver even while an exit node is active. Then verify the laptop can actually reach that nameserver's route while the exit node is engaged, since split DNS still depends on reachability.

## What you now have

1. A mental model of Quad100 as a per-device, in-daemon stub resolver at 100.100.100.100 (and fd7a:115c:a1e0::53): MagicDNS answered locally from the netmap, everything else forwarded by policy, DoH used upstream where available.
2. The anatomy of a MagicDNS name, machine plus tailnet plus ts.net, why short names are just a search domain trick, and why renaming a tailnet is a breaking change.
3. The three platform plumbing stories: systemd-resolved or resolv.conf on Linux, scoped resolvers on macOS, NRPT on Windows, and which diagnostic tool tells the truth on each.
4. The real semantics of global nameservers, "Override DNS servers," restricted nameservers (split DNS), and search domains, including the no-guaranteed-ordering rule.
5. The exit node DNS default (resolve via the exit node) and the per nameserver "Use with exit node" escape hatch.
6. A layered diagnostic method: `dig @100.100.100.100`, then `tailscale dns status` and `tailscale dns query`, then the platform native resolver test, each isolating one layer.

## Cross references

- Module 02, The control plane: DNS settings, MagicDNS mappings, and search domains are tailnet configuration distributed through the coordination server; a stale netmap means stale MagicDNS answers.
- Module 04, Identity and auth: machines shared from other tailnets keep their home tailnet's namespace, which is why they need full FQDNs.
- Module 07, Routing: subnet routers carry the routes that restricted nameservers usually depend on, and exit nodes are what trigger the resolve-via-exit-node default.
- Module 08, Exposing services: ts.net names are the basis for HTTPS certificates, Serve, and Funnel, and tailnet renames interact with certificate name reuse.
- Module 09, The platform matrix: the per platform DNS plumbing here is one row of the broader story of what each OS lets Tailscale do.
- Module 11, Troubleshooting and observability: the layered `dig` and `tailscale dns` workflow from this module slots into the general diagnosis playbook there.
