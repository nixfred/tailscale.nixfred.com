---
module: 8
slug: exposing-services
title: Exposing services
description: How to publish services on and beyond your tailnet with serve, Funnel, HTTPS certificates, Tailscale Services, and tsnet, and how to choose between them.
order: 8
words: 4400
sources:
  - id: serve-kb
    url: https://tailscale.com/docs/features/tailscale-serve
    title: Tailscale Serve
    checked: 2026-08-10
  - id: serve-cli
    url: https://tailscale.com/docs/reference/tailscale-cli/serve
    title: tailscale serve command reference
    checked: 2026-08-10
  - id: funnel-kb
    url: https://tailscale.com/docs/features/tailscale-funnel
    title: Tailscale Funnel
    checked: 2026-08-10
  - id: funnel-cli
    url: https://tailscale.com/docs/reference/tailscale-cli/funnel
    title: tailscale funnel command reference
    checked: 2026-08-10
  - id: https-certs
    url: https://tailscale.com/docs/how-to/set-up-https-certificates
    title: Enabling HTTPS
    checked: 2026-08-10
  - id: services-kb
    url: https://tailscale.com/docs/features/tailscale-services
    title: Tailscale Services
    checked: 2026-08-10
  - id: services-ga
    url: https://tailscale.com/blog/services-ga
    title: Tailscale Services GA announcement
    checked: 2026-08-10
  - id: tsnet-kb
    url: https://tailscale.com/docs/features/tsnet
    title: tsnet
    checked: 2026-08-10
  - id: tsnet-repo
    url: https://github.com/tailscale/tailscale/tree/main/tsnet
    title: tsnet package, tailscale/tailscale repository
    checked: 2026-08-10
---

## The promise

1. You will be able to publish a local service to your tailnet with `tailscale serve`, including path mounting, raw TCP forwarding, and TLS-terminated TCP, and read `serve status` output fluently.
2. You will be able to expose a service to the public internet with Funnel, explain why only ports 443, 8443, and 10000 work, and describe exactly where TLS terminates and what the relay can and cannot see.
3. You will be able to provision real Let's Encrypt certificates for tailnet nodes with `tailscale cert`, explain the DNS-01 mechanism behind it, and state the privacy consequence of Certificate Transparency logs before you flip the toggle.
4. You will be able to explain Tailscale Services (GA February 19, 2026): stable virtual endpoints, service proxies, high availability, and the register, route, drain lifecycle.
5. You will be able to describe when embedding a node with tsnet beats running a full client, and how a tsnet program registers itself as a Service backend.
6. You will be able to pick the right exposure mechanism for a given audience and workload using a decision framework, not vibes.

## Foundation

You already run reverse proxies. You know that nginx or HAProxy sits in front of a backend, terminates TLS, and forwards requests. You know what a VIP is: a virtual IP that floats above real machines so clients get one stable address while the backends behind it come and go. You have configured DNS-01 challenges, or at least fought with HTTP-01 ones. You know the difference between L4 forwarding (bytes in, bytes out, no inspection) and L7 proxying (parse the protocol, route on paths and headers).

Everything in this module is those same ideas relocated. The reverse proxy moves into `tailscaled` itself. The VIP becomes a TailVIP that the coordination server hands out. The DNS challenge is completed by Tailscale's infrastructure on your behalf because it controls the `ts.net` zone. The load balancer health check becomes "is this node online in the tailnet." If you keep asking "which familiar box did this feature absorb," this module reads fast.

From earlier modules you need three facts. First, every node has a stable MagicDNS name under your tailnet domain, `node-a.tailnet-name.ts.net` (Module 06). Second, ACLs and grants filter every connection, including connections to served content (Module 05). Third, traffic between peers is WireGuard end to end, with DERP as a fallback relay (Modules 01 and 03). Serve, Funnel, and Services are all built on top of those three layers, not beside them.

## Core content

### tailscale serve: the reverse proxy you already had

The analogy: `tailscale serve` is nginx-as-a-flag. You have a web app listening on `127.0.0.1:3000`, invisible even to your own tailnet because it binds loopback. One command puts a TLS-fronted reverse proxy in front of it, reachable by every device your ACLs allow:

```
tailscale serve 3000
```

The mechanism: `tailscaled` starts listening on port 443 of the node's tailnet address. It presents a real Let's Encrypt certificate for `node-a.tailnet-name.ts.net` (serve requires HTTPS certificates to be enabled for the tailnet first). Incoming HTTPS connections from tailnet peers are decrypted inside `tailscaled` and proxied to your local listener. Because the connection arrived over the tailnet, `tailscaled` knows cryptographically who the caller is, and it injects that identity into the proxied request as headers: `Tailscale-User-Login`, `Tailscale-User-Name`, and `Tailscale-User-Profile-Pic`. Your backend gets authentication for free without ever seeing a password. These headers are not populated for connections from tagged devices, since tags are not people, and the proxy strips them from incoming requests so a caller cannot inject them. Since v1.92 you can also pass `--accept-app-caps` to forward selected application capabilities in a `Tailscale-App-Capabilities` header, which turns grants (Module 05) into application-level authorization data.

The failure mode: serve runs in the foreground by default. The terminal shows a live status block and the proxy dies when you press Ctrl+C or the session ends. Engineers set up a demo, close the laptop, and file a bug the next morning that "serve is broken." It is not broken. It did exactly what foreground mode does. Persistence requires `--bg`:

```
tailscale serve --bg 3000
```

With `--bg` the configuration is stored and survives reboots until you remove it.

Targets are more flexible than a port number. A target can be a port (`3000`), a host and port (`localhost:8080`), a full URL, an absolute filesystem path to serve a file or directory listing, or literal text:

```
tailscale serve --bg /home/alice/public-docs
tailscale serve --bg text:"maintenance window until 0400 UTC"
```

If the backend already speaks HTTPS with a self-signed certificate, `https+insecure://localhost:8443` tells the proxy to connect anyway and skip verification. Useful for appliances that refuse to speak plain HTTP; keep in mind you are trusting loopback, which is usually fine, and trusting that nothing else on the box can hijack that port, which is worth a thought on shared machines.

### Paths, and why one hostname can hold many services

The analogy: path mounting is virtual hosting flipped sideways. Instead of many hostnames on one IP, you hang many backends off one hostname, one per path prefix.

The mechanism: `--set-path` mounts a target under a URL path on the node's single HTTPS site:

```
tailscale serve --bg --set-path=/grafana 3001
tailscale serve --bg --set-path=/api 8080
```

Now `https://node-a.tailnet-name.ts.net/grafana` proxies to port 3001 and `/api` to port 8080. The proxy routes on the path prefix before forwarding.

The failure mode: backends that generate absolute URLs. An app that thinks it lives at `/` will emit redirects and asset links that escape its `/grafana` prefix and land on the wrong backend or a 404. This is the same problem you have behind any path-rewriting proxy, and the same fix applies: configure the app's base URL or serve it at the root of its own port instead.

### TCP forwarding: when the payload is not HTTP

Not everything is a web app. `--tcp` turns the proxy into a plain L4 forwarder:

```
tailscale serve --bg --tcp=2222 tcp://localhost:22
```

Bytes in, bytes out, no HTTP parsing, no identity headers (there is no request to inject them into). `--tls-terminated-tcp` is the hybrid: `tailscaled` terminates TLS using the node's certificate, then forwards the decrypted byte stream to the backend. That lets a TLS-unaware backend present a valid certificate to TLS-expecting clients. If the backend needs the real client address, `--proxy-protocol=1` or `=2` prepends the standard PROXY protocol header so the source IP survives the hop.

The failure mode for TCP mode is expecting L7 behavior from an L4 tool: no path mounting, no header injection, no per-request identity. If you need those, the payload must be HTTP and you must use the HTTP modes.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Data paths for serve versus Funnel">
  <title>Serve keeps traffic inside the tailnet; Funnel adds a public relay hop that cannot decrypt</title>
  <rect x="10" y="30" width="330" height="240" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="175" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">serve (tailnet only)</text>
  <rect x="30" y="80" width="110" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="4"/>
  <text x="85" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="12">peer node-b</text>
  <rect x="200" y="80" width="120" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="4"/>
  <text x="260" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-a :443</text>
  <rect x="200" y="180" width="120" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="4"/>
  <text x="260" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="12">127.0.0.1:3000</text>
  <line x1="140" y1="100" x2="200" y2="100" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="260" y1="120" x2="260" y2="180" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="170" y="92" text-anchor="middle" fill="var(--diagram-text)" font-size="10">WireGuard</text>
  <text x="300" y="155" text-anchor="start" fill="var(--diagram-text)" font-size="10">proxy</text>
  <rect x="380" y="30" width="370" height="240" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="565" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Funnel (public)</text>
  <rect x="395" y="80" width="95" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="4"/>
  <text x="442" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="12">browser</text>
  <rect x="520" y="80" width="100" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="4"/>
  <text x="570" y="99" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Funnel relay</text>
  <text x="570" y="113" text-anchor="middle" fill="var(--diagram-text)" font-size="9">no decrypt</text>
  <rect x="645" y="80" width="95" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="4"/>
  <text x="692" y="99" text-anchor="middle" fill="var(--diagram-text)" font-size="11">node-a</text>
  <text x="692" y="113" text-anchor="middle" fill="var(--diagram-text)" font-size="9">TLS ends here</text>
  <rect x="645" y="180" width="95" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="4"/>
  <text x="692" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="11">local app</text>
  <line x1="490" y1="100" x2="520" y2="100" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="620" y1="100" x2="645" y2="100" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="692" y1="120" x2="692" y2="180" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="505" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="10">public DNS resolves to relay IP</text>
  <text x="505" y="155" text-anchor="middle" fill="var(--diagram-text)" font-size="10">relay is a blind TCP proxy</text>
</svg>
</div>

### Funnel: opening the front door, narrowly

The analogy: Funnel is a valet stand for the public internet. Strangers never learn where your car is parked. They hand their request to a Tailscale-operated relay, and the relay walks it to your node over a tunnel. The relay never gets your keys.

The mechanism: enabling Funnel makes the public DNS name `node-a.tailnet-name.ts.net` resolve to the IP of a Tailscale Funnel relay server, not to your device. The relay accepts inbound TCP on your behalf and proxies the raw byte stream to your node over Tailscale. Critically, the relay does not decrypt anything: the TLS session runs from the visitor's browser all the way to `tailscaled` on your node, which holds the private key for the certificate. Tailscale's infrastructure sees encrypted bytes and connection metadata, nothing more. Your device's real IP is never published.

Funnel is deliberately narrow. It requires Tailscale v1.38.3 or later, MagicDNS on, HTTPS certificates enabled, and a `funnel` node attribute granted in the tailnet policy file, so an admin has to opt the node in before any exposure is possible. Only three external ports are allowed: 443, 8443, and 10000. Only TLS-carrying connections are accepted. Bandwidth through the relays is restricted and the limits are not configurable (checked 2026-08-10; the KB does not publish numbers, so treat throughput as "fine for demos and webhooks, wrong for production file transfer"). These constraints are the abuse story: three well-known ports, TLS-only, admin-gated, identity-bound DNS names, and throttled relays make Funnel a poor tool for running anonymous abusive infrastructure, which is exactly the point.

The command mirrors serve:

```
tailscale funnel --bg 3000
tailscale funnel --tls-terminated-tcp=10000 tcp://localhost:5432
```

The failure mode: forgetting that serve and Funnel share the same listener table. The same port on the same node cannot be private serve and public Funnel simultaneously. Another classic: turning Funnel off requires repeating the original flags (`tailscale funnel --https=443 <target> off`, or `tailscale funnel reset` to clear everything); people run a bare `off`, see an error or no effect, and believe the service is down when it is still public. Verify with `tailscale funnel status`, not with your memory.

> [!HOW-IT-WORKS] Funnel's end-to-end encryption is structural, not promised. The relay can only forward ciphertext because the certificate's private key exists solely on your node. Compromising a Funnel relay gets an attacker traffic metadata, not plaintext.

> [!GOTCHA] Serve inherits your ACLs; Funnel bypasses them by definition, because visitors have no tailnet identity to evaluate. Anything you Funnel must carry its own authentication. Treat a Funnel URL exactly like a port forward on your home router with a nicer certificate story.

### HTTPS certificates: the ts.net trick

The analogy: Tailscale plays notary for a street it owns. You cannot get a public CA to sign `node-a` on a private IP, but Tailscale owns `ts.net`, so it can prove to Let's Encrypt that your name under that zone is yours.

The mechanism: you enable HTTPS on the admin console's DNS page (MagicDNS must be on first). Then, on the node:

```
tailscale cert node-a.tailnet-name.ts.net
```

The client generates a key pair locally and asks for a certificate through Tailscale's infrastructure, which completes the Let's Encrypt DNS-01 challenge by publishing the required TXT record under `ts.net`. The private key and the Let's Encrypt account key never leave your machine; Tailscale's servers cannot read your traffic afterward. Serve and Funnel drive this same machinery automatically, so you only run `tailscale cert` yourself when some other daemon (nginx, a mail server, a Go binary) needs the cert and key files directly.

The failure modes: two of them, both scheduled. First, certificates last 90 days, and `tailscale cert` does not install a renewal timer for you; if you copied the files into nginx and walked away, you built an outage with a 90 day fuse. Integrations that call the machinery themselves (Caddy is the documented example, and serve internally) renew without you. Second, Let's Encrypt rate limits apply: a misfiring renewal loop can lock the name out, with waits up to roughly 34 hours before retrying.

> [!GOTCHA] Every certificate issued lands in public Certificate Transparency logs. Your tailnet domain is a random pair of words, so the organization is obscured, but the machine name is not: `internal-billing-db.tailnet-name.ts.net` becomes a public, searchable fact forever. Name nodes as if the names will be published, because with HTTPS enabled, they will be.

### Tailscale Services: the VIP layer

The analogy: serve publishes a machine; Services publish a role. `tailscale serve` says "port 3000 on node-a." A Service says "the wiki," and which physical node answers is an implementation detail that can change at 3 a.m. without clients noticing. It is the same conceptual jump as moving from "point everyone at web-server-7" to putting a VIP and a load balancer in front.

The mechanism: a Tailscale Service (GA February 19, 2026) is a named virtual endpoint with four parts: a stable MagicDNS name (`service-name.tailnet-name.ts.net`), a TailVIP (a virtual Tailscale IP owned by the service, not by any device), a resource definition, and one or more service proxies, which are ordinary nodes that advertise they can answer for the service. You define the service (named with an `svc:` prefix, for example `svc:wiki`) in the admin console, then on a host:

```
tailscale serve --service=svc:wiki --https=443 127.0.0.1:8080
```

An admin approves the pending host (or an auto-approval policy does it), and the coordination server starts routing the TailVIP to that proxy. Multiple hosts can advertise the same service, which buys horizontal scaling and automatic failover: when a proxy goes offline, traffic shifts to the survivors, and the service shows Offline only when nobody is left. Access control treats the service as a first-class destination, `"dst": ["svc:wiki"]` in a grant, and since GA you can write ACL tests against services just like machine targets. Flow logs record both the service VIP and the actual proxy machine IP, so you can audit which physical host handled which connection, and per-service audit logs capture configuration changes.

Version requirements matter here and are recent enough to rot-check (all checked 2026-08-10): hosts need v1.86.0+, must use tag-based identity rather than a user login, and clients v1.94.1+ learn service virtual IPs automatically without `--accept-routes`; Linux clients v1.93 or earlier need explicit route acceptance. Endpoints come in three types: L7 (HTTP/HTTPS, path-aware), L4 (TCP and TLS forwarding), and a Linux-only L3 TUN type, which is the only way to carry UDP and requires manual OS configuration. Since GA, a service can also point at remote destinations beyond localhost, such as a managed database. Every plan, including Personal, includes up to 10 services (checked 2026-08-10).

Since GA, services also support declarative configuration: a JSON file on the proxy node describes every endpoint, and `tailscale serve set-config` applies it without restarts. That is the GitOps shape: the service definition lives in a repo, CI ships the file, a reload applies it, and nobody runs bespoke `serve` incantations on production boxes.

The failure mode: treating a Service like a load balancer with health checks. Availability is judged by whether the proxy node is online in the tailnet, not by whether your application behind it is healthy. A proxy whose backend process crashed still advertises happily and still receives traffic. You need process supervision on the backend, or the tsnet lifecycle integration below, which ties advertisement to the application itself.

<div class="diagram-wrap">
<svg viewBox="0 0 760 320" role="img" aria-label="Tailscale Services architecture with failover">
  <title>A client resolves a service name to a TailVIP; the control plane routes it to approved proxies, failing over when one drops</title>
  <rect x="20" y="120" width="120" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="80" y="139" text-anchor="middle" fill="var(--diagram-text)" font-size="12">client</text>
  <text x="80" y="155" text-anchor="middle" fill="var(--diagram-text)" font-size="10">dials svc name</text>
  <rect x="200" y="120" width="150" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="6"/>
  <text x="275" y="139" text-anchor="middle" fill="var(--diagram-text)" font-size="12">svc:wiki</text>
  <text x="275" y="155" text-anchor="middle" fill="var(--diagram-text)" font-size="10">TailVIP + DNS name</text>
  <rect x="440" y="40" width="140" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="510" y="59" text-anchor="middle" fill="var(--diagram-text)" font-size="12">proxy node-a</text>
  <text x="510" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="10">approved</text>
  <rect x="440" y="130" width="140" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="510" y="149" text-anchor="middle" fill="var(--diagram-text)" font-size="12">proxy node-b</text>
  <text x="510" y="165" text-anchor="middle" fill="var(--diagram-text)" font-size="10">approved</text>
  <rect x="440" y="230" width="140" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-dasharray="5,4" rx="6"/>
  <text x="510" y="249" text-anchor="middle" fill="var(--diagram-text)" font-size="12">proxy lab-vm-1</text>
  <text x="510" y="265" text-anchor="middle" fill="var(--diagram-text)" font-size="10">offline: drained</text>
  <rect x="630" y="85" width="110" height="46" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="685" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="11">backend app</text>
  <line x1="140" y1="143" x2="200" y2="143" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="350" y1="135" x2="440" y2="70" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="350" y1="150" x2="440" y2="150" stroke="var(--diagram-accent)" stroke-width="2"/>
  <line x1="350" y1="160" x2="440" y2="248" stroke="var(--diagram-line)" stroke-width="2" stroke-dasharray="5,4"/>
  <line x1="580" y1="63" x2="630" y2="100" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="580" y1="150" x2="630" y2="118" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="390" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="10">no traffic to drained host</text>
</svg>
</div>

### tsnet and the register, route, drain lifecycle

The analogy: tsnet turns "a machine on the tailnet" into "a process on the tailnet." Instead of installing the Tailscale client on a box and running your app beside it, your Go program imports `tailscale.com/tsnet` and becomes its own node, with its own IP, name, ACL identity, and certificate, even if five such programs share one host.

The mechanism: `tsnet.Server` embeds a userspace TCP/IP stack (no TUN device, no elevated privileges) plus the full Tailscale client logic. You set a hostname and an auth key, call `Start()`, and then use it like the `net` package: `Listen("tcp", ":80")` accepts connections arriving over the tailnet, `ListenTLS` adds a `ts.net` certificate automatically, `ListenFunnel` publishes straight to the internet from inside your program, and the local client's `WhoIs` resolves any incoming connection to the tailnet identity behind it, giving you per-request authentication in a few lines. This is how Tailscale's own internal tools like golink are built.

The GA Services release connected the two features: a tsnet application can register as a service backend through the Service API (`ListenService` in the tsnet package). The lifecycle is the payoff. On startup the program registers and begins advertising, so the control plane routes the TailVIP to it. On shutdown it drains first: it stops accepting new connections for the service, lets in-flight requests finish, then disappears, while traffic shifts to remaining proxies. The same drain is available manually for CLI-managed hosts (`tailscale serve drain svc:wiki`) for maintenance on a host you are about to reboot. Because advertisement is tied to the process rather than the machine, the "node up, app dead" failure mode from the previous section largely disappears: if the program is gone, so is the advertisement.

The failure mode for tsnet generally: it is Go-only, and each embedded node is a real node from the control plane's perspective. It needs state storage (a directory) to keep its identity across restarts, it consumes a device slot, it must authenticate like any node, and if you ship it in an ephemeral container without an ephemeral auth key strategy you will leak dead nodes into the admin console.

> [!FROM-THE-FIELD] The strongest tsnet use case is the small internal tool with awkward auth. A 200-line dashboard gains a stable HTTPS name, network-enforced access control, and login-free user identity via WhoIs headers, with zero reverse proxy configuration. Teams that try tsnet for one tool tend to build the next three the same way.

### The decision framework

Four questions settle almost every case.

1. Who is the audience? Anyone on the internet: Funnel, full stop, and put app-level auth on it. Only tailnet members: keep reading.
2. Is the thing a role or a machine? If clients should not care which host answers, or you need failover, rolling deploys, or more than one backend: Tailscale Services. If it is inherently "this box" (a dev server, a NAS UI): plain serve.
3. Do you control the code? If it is your Go program and you want lifecycle-correct registration, identity-aware requests, or many logical nodes on one host: tsnet, optionally registering into a Service. If it is somebody else's binary: serve or a Service proxy in front of it.
4. Does some other daemon need the certificate itself? Then `tailscale cert` and hand the files over; serve is not involved at all.

And one veto: if the workload is UDP or needs raw L3 semantics, none of the proxy modes apply except the Linux-only Services L3 endpoint; otherwise you are back to plain tailnet routing (Module 07).

<div class="diagram-wrap">
<svg viewBox="0 0 760 360" role="img" aria-label="Decision tree for choosing an exposure mechanism">
  <title>Decision tree: audience, role versus machine, and code ownership select Funnel, Services, serve, tsnet, or tailscale cert</title>
  <rect x="290" y="15" width="180" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="380" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Who connects?</text>
  <rect x="60" y="105" width="150" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="135" y="126" text-anchor="middle" fill="var(--diagram-text)" font-size="12">public internet</text>
  <text x="135" y="141" text-anchor="middle" fill="var(--diagram-accent)" font-size="11">Funnel</text>
  <rect x="290" y="105" width="180" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="380" y="132" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tailnet: role or machine?</text>
  <rect x="180" y="195" width="170" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="265" y="216" text-anchor="middle" fill="var(--diagram-text)" font-size="12">role, needs HA</text>
  <text x="265" y="231" text-anchor="middle" fill="var(--diagram-accent)" font-size="11">Tailscale Services</text>
  <rect x="430" y="195" width="170" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="515" y="216" text-anchor="middle" fill="var(--diagram-text)" font-size="12">machine: your code?</text>
  <rect x="350" y="290" width="150" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="425" y="311" text-anchor="middle" fill="var(--diagram-text)" font-size="12">yes, Go program</text>
  <text x="425" y="326" text-anchor="middle" fill="var(--diagram-accent)" font-size="11">tsnet</text>
  <rect x="540" y="290" width="200" height="44" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="640" y="311" text-anchor="middle" fill="var(--diagram-text)" font-size="12">no: serve; cert only?</text>
  <text x="640" y="326" text-anchor="middle" fill="var(--diagram-accent)" font-size="11">tailscale cert</text>
  <line x1="330" y1="59" x2="170" y2="105" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="380" y1="59" x2="380" y2="105" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="340" y1="149" x2="285" y2="195" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="430" y1="149" x2="500" y2="195" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="490" y1="239" x2="440" y2="290" stroke="var(--diagram-line)" stroke-width="2"/>
  <line x1="545" y1="239" x2="620" y2="290" stroke="var(--diagram-line)" stroke-width="2"/>
</svg>
</div>

## On the wire

A foreground serve session shows you the whole configuration at a glance:

```
$ tailscale serve 3000
Available within your tailnet:

https://node-a.tailnet-name.ts.net/
|-- proxy http://127.0.0.1:3000

Press Ctrl+C to exit.
```

Background configuration is inspected with `serve status`, which prints the mount table:

```
$ tailscale serve status
https://node-a.tailnet-name.ts.net (tailnet only)
|-- /        proxy http://127.0.0.1:3000
|-- /api     proxy http://127.0.0.1:8080

|-- tcp://node-a.tailnet-name.ts.net:2222 (tailnet only)
|-- tcp://localhost:22
```

`tailscale funnel status` marks which listeners are public ("Funnel on") versus tailnet-only, and `--json` on either command gives machine-readable output for monitoring.

On the backend, a proxied request from a tailnet user carries the identity headers, which you can see with any header echo:

```
GET /whoami HTTP/1.1
Host: node-a.tailnet-name.ts.net
Tailscale-User-Login: alice@example.com
Tailscale-User-Name: Alice Example
X-Forwarded-For: 100.101.102.103
```

Certificate issuance is observable in DNS. While `tailscale cert` runs, Tailscale publishes the DNS-01 proof as a `ts.net` TXT record, and the resulting certificate is public record in CT logs, which you can confirm from any CT search interface by looking up your tailnet domain.

> [!ON-THE-WIRE] A Funnel visitor's traceroute and the TLS SNI both point at Tailscale relay infrastructure, never at your device. From the visitor's side the connection is indistinguishable from any CDN-fronted site; the difference is that the relay is forwarding ciphertext it cannot open, because the leaf certificate's key lives only on your node.

For Services, `tailscale serve status` on a proxy shows the `svc:` endpoints it advertises, and the admin console's Services page shows per-service state (Pending approval, Needs configuration, Connected, Offline, Draining) plus pending host approvals. Network flow logs (Module 10 territory) record connections twice over: to the TailVIP, and via the proxy's machine IP.

## Failure modes

1. Foreground serve dies with the terminal. Symptom: the URL worked during the demo, 502 or connection refused an hour later, `serve status` shows nothing. Fix: `--bg`.
2. HTTPS not enabled on the tailnet. Symptom: serve or `tailscale cert` prompts for consent or fails with an HTTPS/MagicDNS error. Fix: enable MagicDNS, then HTTPS, on the admin console DNS page.
3. Funnel policy attribute missing. Symptom: `tailscale funnel` errors that Funnel is not enabled for the node even though serve works fine. Fix: grant the `funnel` node attribute in the tailnet policy file.
4. Wrong Funnel port. Symptom: works on 443, refuses on 8080. Only 443, 8443, and 10000 are valid externally; remap with the flag, the local backend port is unrestricted.
5. Expired 90 day certificate in a hand-rolled deployment. Symptom: browsers scream on schedule, roughly three months after the day everything worked. Fix: automate `tailscale cert` renewal, or let serve or Caddy own the certificate lifecycle.
6. Let's Encrypt rate limiting. Symptom: cert issuance suddenly fails after repeated attempts, possibly for up to about 34 hours. Fix: stop the retry loop, wait, then fix the underlying cause before retrying.
7. Path-mounted app escapes its prefix. Symptom: `/grafana` loads, then redirects to `/login` at the root and 404s. Fix: set the app's base URL or give it its own port.
8. Serve and Funnel collide on a port. Symptom: enabling one silently replaces or refuses the other on the same port. Fix: separate ports, or decide which audience actually needs it.
9. Service advertises but the backend is dead. Symptom: service shows Connected, clients get connection refused or 502 from one proxy. Fix: supervise the backend process, or move to tsnet registration so advertisement follows the application.
10. Service host uses a user identity. Symptom: `serve --service` refuses; hosts must be tagged devices. Fix: tag the node (Module 04 for identity, Module 05 for tag ownership).
11. Old clients cannot reach a TailVIP. Symptom: service resolves but connections fail from Linux clients v1.93 or earlier without `--accept-routes`. Fix: upgrade to v1.94.1+ for automatic virtual IP distribution, or accept routes explicitly (checked 2026-08-10).
12. Identity headers trusted from the wrong hop. Symptom: backend honors a spoofed `Tailscale-User-Login` header injected by a client that reached it directly on the LAN. The serve proxy strips these headers from incoming requests, but a path that bypasses the proxy entirely never gets that protection. Fix: bind backends to loopback so the only path in is through the serve proxy.

## Check yourself

**1. A teammate runs a personal wiki on lab-vm-1 with `tailscale serve --bg 8080` and now wants their non-Tailscale-using friend to read one page. What is the minimal safe change, and what protections silently disappear the moment they make it?**

Answer: The minimal change is Funnel on the same content: an admin grants the `funnel` node attribute to lab-vm-1 in the policy file, then `tailscale funnel --bg 8080` publishes `https://lab-vm-1.tailnet-name.ts.net` to the internet on port 443. What disappears is everything identity-based. Serve traffic arrives over WireGuard from authenticated peers, is filtered by ACLs, and carries identity headers the wiki could use for authorization. Funnel visitors have no tailnet identity, so ACLs cannot apply and the identity headers are absent; the wiki is now exactly as exposed as any public website, and its only remaining protections are TLS, the throttled relay path, the restricted port set, and whatever login the wiki app itself implements. If the wiki has no auth of its own, the friend and four billion strangers now share the same access. A narrower alternative worth considering: if the page is one static file, `tailscale funnel /path/to/page.html` exposes just that file rather than the whole app.

**2. Your team runs an internal API on two tagged hosts behind the Service `svc:api`, with clients on v1.95. During a deploy, one host is rebooted without ceremony and several requests fail mid-flight. What should the deploy have done differently, and what would change if the API were a tsnet application?**

Answer: The deploy should have drained before rebooting: `tailscale serve drain svc:api` on the host about to go down stops the control plane from routing new connections to that proxy while in-flight requests complete, after which the reboot is invisible to clients because the second host keeps advertising and the TailVIP routes there. Rebooting without draining means the proxy vanishes abruptly; failover happens, but connections open at that moment die. With a tsnet application registered via the Service API, this behavior stops being a deploy-script responsibility and becomes a program property: the GA lifecycle integration advertises the service when the process starts and drains automatically on shutdown, so an ordinary graceful process stop performs the whole register, route, drain sequence. The remaining operational duty is making sure shutdown is actually graceful (the supervisor sends a signal the program handles) rather than a hard kill.

**3. A security review asks two questions about your Funnel-exposed status page: "Can Tailscale read the traffic?" and "What did enabling HTTPS reveal about our fleet?" Give precise answers.**

Answer: For the first: no, with a precise boundary. Public DNS points the node's name at a Funnel relay, and the relay proxies TCP without decrypting; the TLS session terminates on your node, which is the only holder of the certificate's private key. Tailscale infrastructure can observe metadata (that connections happened, from which source IPs, when, and how many bytes) but not plaintext content. For the second: enabling HTTPS means every certificate issued for the tailnet is written to public Certificate Transparency logs. The tailnet domain itself is a randomized label that does not identify the organization, but each certified machine name is fully visible, forever, to anyone searching CT logs. If nodes are named things like `payroll-db` or bear a Customer's name, that information is now public record. The mitigation is naming discipline before enabling the feature, since CT entries cannot be retracted.

## What you now have

1. serve as an identity-injecting reverse proxy built into `tailscaled`: HTTP proxying, path mounts, file and text serving, raw and TLS-terminated TCP, foreground versus `--bg`.
2. Funnel as the deliberately narrow public gate: three ports, TLS-only, admin-gated by policy attribute, relay-forwarded without decryption, bandwidth-limited.
3. `tailscale cert` and the DNS-01 mechanism that gets real Let's Encrypt certificates for `ts.net` names, plus the 90 day renewal duty and the CT log exposure.
4. Tailscale Services as the role layer: TailVIP plus MagicDNS name in front of approved, tagged proxies, with HA, grants, ACL tests, flow and audit log visibility, and declarative config (GA February 19, 2026).
5. tsnet as the process-as-node pattern, and the register, route, drain lifecycle that ties service advertisement to application lifetime.
6. A four-question decision framework: audience, role versus machine, code ownership, certificate-only.

## Cross references

- Module 05 (Policy: ACLs and grants): serve traffic is ACL-filtered, Funnel is not; `svc:` destinations and the `funnel` node attribute live in the policy file.
- Module 06 (MagicDNS and split DNS): every name in this module, node names, service names, and public Funnel hostnames, is minted by the machinery there.
- Module 04 (Identity and auth): identity headers and WhoIs lookups reuse node identity; Service hosts require tags, which are identity constructs.
- Module 07 (Routing): TailVIP distribution and the v1.94.1 automatic virtual IP change are a special case of route propagation.
- Module 03 (NAT traversal, STUN, DERP, and Peer Relays): Funnel relays rhyme with DERP, blind forwarders that never hold keys.
- Module 10 (Enterprise operations): flow logs, audit logs, and service approval workflows at fleet scale.
- Module 11 (Troubleshooting and observability): the `serve status` and `funnel status` reading skills here feed directly into that module's diagnostic loops.
- Module 12 (The codebase): tsnet, and the serve implementation itself, live in the open source repository dissected there.
