---
slug: pin-saas-egress-to-one-address
title: Give a SaaS vendor one address to allowlist, from anywhere
description: Use an app connector so traffic to a specific vendor's domains leaves your tailnet from a single stable public address, while everything else on the device keeps going out directly.
level: advanced
payoff: The vendor's IP allowlist stays one line long no matter where anyone opens their laptop.
order: 6
words: 2010
sources:
  - id: kb-app-connectors
    url: https://tailscale.com/kb/1281/app-connectors
    title: App connectors
    checked: 2026-08-11
  - id: docs-app-connectors
    url: https://tailscale.com/docs/features/app-connectors
    title: How app connectors work
    checked: 2026-08-11
  - id: docs-appc-setup
    url: https://tailscale.com/docs/features/app-connectors/how-to/setup
    title: Set up an app connector
    checked: 2026-08-11
  - id: docs-appc-best
    url: https://tailscale.com/docs/reference/best-practices/app-connectors
    title: Best practices for using app connectors
    checked: 2026-08-11
  - id: docs-ha
    url: https://tailscale.com/docs/how-to/set-up-high-availability
    title: Set up high availability
    checked: 2026-08-11
  - id: docs-policy-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Syntax reference for the tailnet policy file
    checked: 2026-08-11
  - id: kb-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-11
  - id: blog-saas
    url: https://tailscale.com/blog/saas
    title: Secure your SaaS with Tailscale app connectors
    checked: 2026-08-11
---

## What you get

A vendor that only accepts connections from an approved list of source addresses sees exactly one address from your whole organization, permanently, regardless of who is connecting or which coffee shop, hotel, or home network they are connecting from. You add one address to the vendor's allowlist and never touch it again.

Everything else on the device is untouched. Video calls, package downloads, and the rest of the internet still leave from wherever the device actually is, at full speed, over the shortest path. Only the domains you name take the detour. That is the difference between this and every full tunnel VPN anyone has ever resented: the scope of the redirect is a list of domain names you wrote down, not the entire default route.

This is what Tailscale calls an app connector, and the vendor facing version of the pitch is direct. The addresses of the node running the app connector can be added to the allowlist, and all nodes on the tailnet will use that address for their traffic egress to that application.

## How it works

Start with what an app connector is not, because two neighboring features look similar and behave completely differently.

An **exit node** takes everything. It offers to be the path for all internet traffic for a device, so the selection is per device and total. A **subnet router** advertises a fixed range of addresses, so it routes by CIDR, and it only works when the destination has stable addresses you can write down in advance. An **app connector** sits between the two. The documentation describes it as being like a subnet router with the added benefit of routing your users and devices to applications by domain names instead of IP addresses, which gives more reliable connectivity. You configure `example.com`, not `198.51.100.0/24`, and the connector figures out the addresses at runtime.

That runtime discovery is the part people get wrong, so slow down here.

The connector does not resolve your domain list on a schedule and cache the answers. Discovery is driven by actual client demand. App connectors use the PeerAPI to perform DNS discovery through DoH, DNS over HTTPS. When a device on your tailnet wants a configured domain, the resolution goes to the connector, the connector resolves it, and the addresses it learns are automatically advertised as routes to the tailnet. Those routes are what pull subsequent traffic through the connector.

Three consequences fall directly out of that design, and every one of them shows up in the field.

First, there is a learning period. Without preconfigured routes, a connector that has just been stood up knows the domains but not yet the addresses. It learns them by proxying real DNS requests from real users, and routes appear as demand arrives. A connector nobody has used yet is not routing anything, and that is not a fault.

Second, the client must be able to see the connector as a peer at all. Client devices must have access to the app connector tag for it to appear as a peer, and minimal access such as ICMP is sufficient for discovery. Full application access is not required for the discovery step. If your policy gives nobody any access to the connector tag, discovery silently does not happen, and the symptom is that nothing routes rather than that something errors.

Third, because the routes come from DNS answers, anything that changes the DNS answer changes your routing. Geographic load balancing, CDN fronting, and CNAME chains all land on this mechanism.

<div class="diagram-wrap">
<svg viewBox="0 0 760 330" role="img" aria-label="App connector traffic path: a device anywhere sends only configured vendor domains through the tagged app connector, which egresses from one stable public address to the vendor allowlist, while all other traffic leaves the device directly">
  <title>Only the named domains take the detour</title>
  <rect x="20" y="34" width="170" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="105" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">node-a, anywhere</text>
  <text x="105" y="79" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">hotel, home, office</text>

  <rect x="290" y="34" width="190" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="385" y="60" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">app connector</text>
  <text x="385" y="79" text-anchor="middle" fill="var(--diagram-accent)" font-size="11" font-family="var(--font-mono)">one stable public address</text>

  <rect x="570" y="34" width="170" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="655" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">vendor allowlist</text>
  <text x="655" y="79" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">one entry, forever</text>

  <g stroke="var(--diagram-accent)" stroke-width="2" fill="none">
    <path d="M190 64 L290 64 M480 64 L570 64"/>
  </g>
  <text x="240" y="52" text-anchor="middle" fill="var(--diagram-accent)" font-size="10" font-family="var(--font-mono)">named domains</text>
  <text x="525" y="52" text-anchor="middle" fill="var(--diagram-accent)" font-size="10" font-family="var(--font-mono)">egress</text>

  <path d="M105 94 L105 146 L290 146" stroke="var(--diagram-line)" stroke-width="1.5" stroke-dasharray="5 5" fill="none"/>
  <rect x="290" y="124" width="190" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="385" y="151" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">everything else: direct</text>

  <rect x="20" y="200" width="720" height="110" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="40" y="226" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">how the connector learns where to send traffic</text>
  <text x="40" y="250" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">1. a client asks the connector to resolve a configured domain, over DoH via the PeerAPI</text>
  <text x="40" y="270" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">2. the connector resolves it and advertises the discovered addresses as routes</text>
  <text x="40" y="290" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">3. those routes pull the traffic through. no client demand yet means no routes yet.</text>
</svg>
</div>

> [!HOW-IT-WORKS] Routes are discovered, not declared. That single sentence explains most app connector confusion. A brand new connector with a perfect configuration advertises nothing until somebody actually resolves one of its domains through it, and the route table grows over the first hours of real use. If you need the routes present on day zero, for example because an upstream firewall must be programmed before traffic starts, preconfigure them. The documentation recommends preconfiguring routes anyway, since address ranges rather than single addresses keep the routing table smaller and cheaper.

## Build it

1. **Pick the host, and pick it for its address.** You need a Linux device with a public address and IP forwarding enabled. The address is the entire product here, so it must be one you control and can keep: a static or reserved address on a cloud instance, not whatever ephemeral address the provider hands out on reboot. If that address changes, the vendor's allowlist stops matching and your access breaks in a way that looks like a vendor problem.

2. **Create the tag and its owners** in the tailnet policy file, so the connector has a machine identity separate from any person.

    ```json
    "tagOwners": {
      "tag:vendor-connector": ["group:network-admins"],
    },
    ```

3. **Auto approve the routes it will discover.** This step is what makes discovery actually work unattended. Discovered addresses arrive as route advertisements, and unapproved routes do not carry traffic. The setup documentation approves the default routes for the connector tag.

    ```json
    "autoApprovers": {
      "routes": {
        "0.0.0.0/0": ["tag:vendor-connector"],
        "::/0":      ["tag:vendor-connector"],
      },
    },
    ```

4. **Grant clients at least DNS access to the connector tag,** because discovery happens through the connector and a client that cannot reach it cannot trigger it.

    ```json
    "grants": [
      {
        "src": ["autogroup:member"],
        "dst": ["tag:vendor-connector"],
        "ip":  ["tcp:53", "udp:53"],
      },
    ],
    ```

5. **Define the connector itself in `nodeAttrs`,** naming the tag that serves it and the domains it serves.

    ```json
    "nodeAttrs": [
      {
        "target": ["*"],
        "app": {
          "tailscale.com/app-connectors": [
            {
              "name": "vendor-portal",
              "connectors": ["tag:vendor-connector"],
              "domains": ["example.com", "*.example.com"],
            },
          ],
        },
      },
    ],
    ```

    Wildcards work for subdomains but never for top level domains. `*.example.com` and `*.example.co.uk` are valid, `*.com` and `*.co.uk` are not. Note also that the wildcard does not include the parent, which is why both entries appear above.

6. **Advertise the connector on the node.**

    ```sh
    tailscale up --advertise-connector --advertise-tags=tag:vendor-connector
    ```

    The flag offers the device as an app connector for domain specific internet traffic for the tailnet. It is also available on `tailscale set`, which changes only the settings you name rather than requiring the complete desired configuration, which is what you want when reconfiguring a connector that is already carrying traffic.

7. **Register the application in the admin console.** On the Apps page, give the application a name, choose a preset or supply your own domains, and select the connector tags that serve it. Preset applications exist for common platforms, and for those Tailscale updates and manages the routes.

8. **Give the vendor the connector's public address** and confirm it is in place on their side before you tell anyone the path is live.

9. **Build the second connector before you need it.** Multiple app connector devices for a single application are recommended for performance and reliability. Same tag, same policy, different host, ideally different failure domain.

## Verify it

1. **Ask the connector what it has learned.** On the connector node, `tailscale appc-routes` prints the current app connector route status: the domains from the configuration and how many routes have been learned for each. `--all` prints learned domains and routes plus extra routes configured by policy, `--map` prints the map of learned domains, and `--n` prints the total number of routes the node advertises. If a domain shows zero routes, nobody has resolved it through this connector yet.

2. **Check that the routes are approved,** in the admin console or with `tailscale status --json` on the connector. Advertised is not the same as approved, and an unapproved route carries nothing.

3. **Prove the egress address from a client**, not from the connector. Fetch a service that reports the source address it sees, from a device that is not the connector, and confirm the answer is the connector's public address. Then fetch the same service over a domain that is not in your configuration and confirm the answer is the device's own local address. Both halves matter. The second one is what proves you built an app connector and not an accidental full tunnel.

4. **Follow the CNAME chain if the domain has one.** Use `dig` to check the CNAME configuration, and expect the resolved target rather than the alias to show up in the route advertisements. A configuration that names only the alias can look correct and route nothing.

5. **Know what failure looks like.** If an app connector becomes unavailable while in use and no other connector is available, resolution to the domain begins to fail until the connector is back online. So the failure presents as name resolution breaking for one specific vendor while the rest of the internet is fine. That is a very recognizable signature once you have seen it, and a very confusing one if you have not.

> [!GOTCHA] Test the failover deliberately, on a schedule, before it happens to you. Connector selection is by the order in which connectors were added to the tailnet, with the oldest as primary, and failover proceeds oldest first. In failover mode, if a connector is disconnected from the control plane for more than about fifteen seconds, traffic moves to another connector. Running `tailscale down` on the primary is the cheap way to observe that window in a controlled setting, and fifteen seconds of failure is a number worth knowing before you promise anyone a service level.

## Gotchas

1. **The address is the deliverable, so protect it like one.** A host whose public address is not reserved will eventually reboot into a new address, and the outage will look like the vendor blocking you rather than like your own infrastructure moving.

2. **Discovery needs peer visibility.** If policy gives clients no access at all to the connector tag, the connector never appears as a peer and discovery never fires. Minimal access such as ICMP is enough for that step, so this is cheap to satisfy and easy to forget.

3. **Cold start looks like breakage.** Fresh connector, correct configuration, zero routes. Nothing is wrong. Preconfigure routes if you cannot tolerate the learning window, particularly when an upstream firewall has to be programmed before traffic flows.

4. **Do not point a connector at a CDN.** Publishing CDN routes can force unrelated traffic through the connector, because CDNs frequently share addresses across many unrelated properties. You will pay for that in bandwidth and in confusing incidents. Serve that content outside the connector.

5. **Wildcards do not include the parent.** To cover a domain and its subdomains you list both. Half your users hitting the bare domain and being routed differently from the half hitting the subdomain is a genuinely miserable diagnosis.

6. **Regional routing is not the same as failover.** Failover is the default behavior for overlapping connectors and is available on all plans. Regional routing, which sends devices to the nearest connector and spreads load within a region, is a Premium and Enterprise feature. Design for the one you actually have.

7. **Within a region, load balancing is sticky and pseudorandom.** When regional routing spreads load across overlapping connectors in a region, clients tend to stay on one connector unless it becomes unavailable. Do not expect even distribution when you look at a single client.

> [!FROM-THE-FIELD] Say plainly what this is not. It is not a general purpose proxy: it moves traffic for the domains you configured and nothing else, by design, and trying to grow the domain list until it covers the internet is how you rebuild a full tunnel VPN with extra steps. It is not anonymity: the vendor sees one address instead of many, which is exactly the point, and your identity provider, your tailnet, and the vendor's own logs all still know precisely who did what. And it does not encrypt anything the application was not already encrypting on the last hop from the connector to the vendor. Sell it internally as what it is, which is address stability plus policy control over who may reach the application, and it will hold up. Sell it as privacy and it will not.

## Where to take it next

1. Place a connector near each concentration of people, then let regional routing pick the closest one, so the address stability you gained does not cost you a transatlantic round trip on every request.
2. Preconfigure route ranges for the vendors whose address space is published and stable, and reserve pure discovery for the ones that move. Smaller route tables, faster cold starts, and an upstream firewall you can program in advance.
3. Bring the connector definition into the policy as code pipeline, so adding a domain to a connector is a reviewed pull request with an assertion attached rather than a live edit to a text box.
4. Extend the same pattern to internal services with unstable addresses, since the argument for routing by domain name rather than by CIDR is not limited to third party vendors.
