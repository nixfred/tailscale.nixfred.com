---
slug: webhooks-without-a-tunnel-service
title: Receive real webhooks straight onto your dev box
description: Expose one path of a local development server to the public internet over HTTPS with Tailscale Funnel, so webhook senders deliver to your own machine with no third party tunnel service and no rotating URL.
level: intermediate
payoff: A stable public HTTPS endpoint on hardware you own, with a publicly trusted certificate, from one command.
order: 3
words: 1850
sources:
  - id: kb-funnel
    url: https://tailscale.com/kb/1223/funnel
    title: Tailscale Funnel
    checked: 2026-08-11
  - id: docs-funnel
    url: https://tailscale.com/docs/features/tailscale-funnel
    title: Tailscale Funnel (Tailscale Docs)
    checked: 2026-08-11
  - id: cli-funnel
    url: https://tailscale.com/docs/reference/tailscale-cli/funnel
    title: tailscale funnel command
    checked: 2026-08-11
  - id: kb-serve
    url: https://tailscale.com/kb/1242/tailscale-serve
    title: Tailscale Serve
    checked: 2026-08-11
  - id: kb-https
    url: https://tailscale.com/kb/1153/enabling-https
    title: Enabling HTTPS
    checked: 2026-08-11
  - id: kb-acl-syntax
    url: https://tailscale.com/kb/1337/acl-syntax
    title: Tailnet policy file syntax
    checked: 2026-08-11
  - id: blog-funnel
    url: https://tailscale.com/blog/introducing-tailscale-funnel
    title: "Tailscale Funnel: Securely Expose Local Services to the Internet"
    checked: 2026-08-11
  - id: kb-funnel-usecases
    url: https://tailscale.com/kb/1247/funnel-serve-use-cases
    title: Funnel and Serve use cases
    checked: 2026-08-11
  - id: ts-changelog
    url: https://tailscale.com/changelog
    title: Tailscale changelog
    checked: 2026-08-11
  - id: ts-aup
    url: https://tailscale.com/tailscale-aup
    title: Tailscale Acceptable Use Policy
    checked: 2026-08-11
  - id: ts-pricing
    url: https://tailscale.com/pricing
    title: Tailscale pricing and plans
    checked: 2026-08-11
---

## What you get

Webhook development carries a standing tax. The sender needs a public HTTPS endpoint. Your handler runs on 127.0.0.1. So you sign up for a tunnel service, accept whatever URL it hands you, paste that URL into the sender's configuration, and repaste it every time the tunnel restarts and the name changes. You have also quietly added a third party to the path of your production integration secrets.

Tailscale Funnel deletes the middle party. Funnel "lets you route traffic from the broader internet to a local service running on a device in your Tailscale network," using DNS names in your own tailnet domain, `tailnet-name.ts.net` (kb-funnel). Your machine already has a name there and, once you enable HTTPS, a publicly trusted certificate issued through Let's Encrypt (kb-https). One command turns that name into a public endpoint that a webhook sender can post to. The name is stable because it is your node's name, not a lease from a service. When you are done, one more command turns it off.

## How it works

The distinction that matters is Serve versus Funnel. Both are the same last hop: `tailscale serve` shares "a local service securely within your Tailscale network," and the docs are explicit that if you want tailnet only sharing you should use Serve instead of Funnel (kb-serve, docs-funnel). Funnel adds a public front door in front of that same proxy. Serve is reachable by your tailnet peers. Funnel is reachable by anyone on the internet who knows the name.

The public front door is more interesting than it sounds. DNS for your MagicDNS name points at Tailscale Funnel frontends that are "georeplicated around the world, similar to how we run DERP servers around the world" (blog-funnel). Those frontends "look at the SNI name in the TLS ClientHello, and then proxy those encrypted TCP connections to your Tailscale node over Tailscale itself." Tailscale states plainly that "Tailscale Funnel is not doing any TLS termination." The certificate and its private key live on your node, generated and stored locally, and Tailscale "never sees them" (kb-https).

<div class="diagram-wrap">
<svg viewBox="0 0 760 470" role="img" aria-label="Flow diagram showing a webhook sender on the public internet connecting over HTTPS to a Tailscale Funnel frontend, which reads the SNI name and proxies the encrypted TCP connection over the tailnet to node-a, where tailscaled terminates TLS and forwards to a development server on 127.0.0.1 port 3000">
  <title>Where a webhook actually travels when you run tailscale funnel</title>
  <rect x="230" y="20" width="300" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="46" text-anchor="middle" fill="var(--diagram-text)" font-size="15">webhook sender</text>
  <text x="380" y="66" text-anchor="middle" fill="var(--diagram-text)" font-size="11">somewhere on the public internet</text>
  <line x1="380" y1="80" x2="380" y2="122" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="392" y="106" fill="var(--diagram-text)" font-size="12">HTTPS to node-a.tailnet-name.ts.net:443</text>
  <rect x="180" y="122" width="400" height="82" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Tailscale Funnel frontend</text>
  <text x="380" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">reads the SNI name in the TLS ClientHello</text>
  <text x="380" y="190" text-anchor="middle" fill="var(--diagram-text)" font-size="11">proxies the encrypted TCP stream, no TLS termination</text>
  <line x1="380" y1="204" x2="380" y2="248" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="392" y="230" fill="var(--diagram-text)" font-size="12">same TCP stream, now carried over the tailnet</text>
  <rect x="120" y="248" width="520" height="190" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-dasharray="6 5"/>
  <text x="138" y="270" fill="var(--diagram-text)" font-size="12">your tailnet</text>
  <rect x="180" y="286" width="400" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="312" text-anchor="middle" fill="var(--diagram-text)" font-size="15">node-a runs tailscaled</text>
  <text x="380" y="334" text-anchor="middle" fill="var(--diagram-text)" font-size="11">holds the cert and key, terminates TLS here</text>
  <line x1="380" y1="350" x2="380" y2="378" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="230" y="378" width="300" height="48" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="398" text-anchor="middle" fill="var(--diagram-text)" font-size="14">127.0.0.1:3000</text>
  <text x="380" y="416" text-anchor="middle" fill="var(--diagram-text)" font-size="11">your development server</text>
</svg>
</div>

> [!ON-THE-WIRE]
> The frontend never sees your webhook payload. It sees a TLS ClientHello, matches the SNI name, and becomes a dumb pipe. Tailscale describes the frontends as deliberately constrained: "That bit prevents them from having any packet-level access to your tailnet. The only thing they're allowed to do is offer your node a funneled TCP connection." (blog-funnel) You can confirm the no-termination claim independently, because every certificate for your name appears in public Certificate Transparency logs (kb-https).

Funnel is off by default and, as the announcement puts it, "all off by default and double opt-in" (blog-funnel). Opt-in one is a tailnet policy attribute. Opt-in two is the command you run on the node. Neither alone is enough, which is why you cannot accidentally publish a machine by typing a wrong flag.

## Build it

1. **Enable HTTPS certificates for the tailnet.** In the admin console DNS page, enable MagicDNS if it is not already on, then select "Enable HTTPS" under HTTPS Certificates and acknowledge the warning that machine names will be published publicly (kb-https). Nothing about Funnel works without this: the requirements list is "Tailscale v1.38.3 or later," MagicDNS enabled, "HTTPS enabled and valid HTTPS certificates for your tailnet," and the Funnel node attribute (kb-funnel).

2. **Grant the Funnel attribute in the tailnet policy file.** The documented snippet is exactly this (kb-funnel):

   ```json
   "nodeAttrs": [
     {
       "target": ["autogroup:member"],
       "attr":   ["funnel"],
     },
   ],
   ```

   Scope `target` down if you can. `nodeAttrs` targets can select devices "via tag, user, group, or `*`" (kb-acl-syntax), so `["tag:funnel-dev"]` is a tighter grant than every member of the tailnet, and it makes the audit question "which machines may publish to the internet" answerable by reading one line.

3. **Start your handler bound to loopback.** Nothing special. Funnel proxies to a local target, and the target "can be a file, directory, text, or most commonly the location to a service running on the local machine" (cli-funnel).

4. **Turn on Funnel for that port.** On Linux you will typically need `sudo` (kb-funnel-usecases):

   ```shell
   tailscale funnel 3000
   ```

   The documented output has this shape, with your own node and tailnet name in place of the example one (kb-funnel):

   ```
   Available on the internet:
   https://node-a.tailnet-name.ts.net

   |-- / proxy http://127.0.0.1:3000

   Press Ctrl+C to exit.
   ```

   That URL is what you paste into the sender's configuration, and it does not change when you restart.

5. **Scope it to one path instead of the whole origin.** Publishing `/` publishes every route your development server has, including the debug endpoints you forgot about. The `--set-path` flag "appends the specified path to the base URL for accessing the underlying service" (cli-funnel), and `--bg` "determines whether the command should run as a background process":

   ```shell
   tailscale funnel --bg --set-path=/hooks/inbound 3000
   ```

   Background mode also survives reboots and `tailscale down` followed by `tailscale up`, whereas a foreground invocation needs restarting by hand (kb-serve).

6. **Confirm what is published.**

   ```shell
   tailscale funnel status
   ```

   `status` "gets the status" of what is currently being served, and `status --json` gives the machine readable form (cli-funnel). Read it as an inventory, not a formality.

7. **Turn it off when you are done.** Two documented ways. Append `off` to the original command, keeping the flags: `tailscale funnel --https=443 --set-path=/hooks/inbound 3000 off`. The docs describe this as adding `[off]` to the end of the original command, where the target becomes optional but the flags remain required (cli-funnel). Or clear everything with `tailscale funnel reset`.

## Verify it

Verification means proving the path works from outside your tailnet, because inside it Serve would also succeed and you would learn nothing.

From a machine that is not on your tailnet, and ideally on a different network entirely, request the exact path you published:

```shell
curl -i https://node-a.tailnet-name.ts.net/hooks/inbound
```

A success is your own application's response, with a certificate your client accepted without a flag. If you want to see the issuer rather than trust the absence of an error, inspect the chain directly:

```shell
openssl s_client -connect node-a.tailnet-name.ts.net:443 -servername node-a.tailnet-name.ts.net </dev/null
```

Then fire a real delivery from the sender, retry it from their dashboard, and watch it land in your handler's log. That is the only test that matters.

Failures sort into four buckets, and each has a different fix. If the name does not resolve at all, HTTPS certificates or MagicDNS are not enabled for the tailnet. If the CLI refuses to enable Funnel, the `funnel` node attribute is missing or does not target this device. If TLS fails, the certificate has not been provisioned yet on this node. If TLS succeeds but you get a 404, the path you published and the path the sender is calling do not match, which is what `tailscale funnel status` exists to settle.

## Gotchas

1. **Three ports, no exceptions.** "Funnel can only listen on ports `443`, `8443`, and `10000`" (kb-funnel). If your plan involved a fourth port, change the plan.

2. **Serve and Funnel cannot share a port.** "The same port number cannot be used for Serve and Funnel at the same time" (kb-funnel). If a Serve configuration is already holding 443, clear it before you expect Funnel to bind there.

3. **Your machine names become public.** Certificates land in public Certificate Transparency logs, so anyone can enumerate the names. The documentation is blunt: "Do not enable the HTTPS feature if any of your machine names contain sensitive information" (kb-https).

4. **Path scoping is routing, not authentication.** `--set-path` limits what you publish. It does not decide who may call it. Every webhook sender worth using signs its deliveries, so verify the signature in your handler and reject unsigned requests. Treat the endpoint as production exposure from the first minute, because it is.

5. **Bandwidth is limited and the limit is not yours to set.** "Traffic sent over a Funnel is subject to non-configurable bandwidth limits" (kb-funnel). Funnel is for control plane traffic like webhooks and demos, not for shipping bulk data.

6. **Certificate churn has a hard wall.** "It is possible to frequently request a new certificate and exceed Let's Encrypt's rate limits," with the documented consequence of waiting 34 hours (kb-funnel, kb-https). Do not script anything that provisions certificates in a loop.

7. **Platform and plan constraints.** Funnel "only works on platforms that can run the Tailscale CLI," and macOS requires one of the open source variants of the application (kb-funnel). The Funnel documentation states Funnel is available for all plans (kb-funnel), while the pricing page groups it with the paid tiers (ts-pricing). Check the pricing page against your own tailnet before you build a workflow on the assumption.

> [!GOTCHA]
> The Acceptable Use Policy applies to what you publish, and Tailscale "retains full discretion to take action (or not) in response to a violation of these policies with or without notice or liability to you, including account suspension, account termination, or removal of content" (ts-aup). Publishing a development handler is unremarkable. Publishing anything that looks like abuse puts the whole tailnet at risk, not just the one node.

> [!FROM-THE-FIELD]
> The failure that costs the most time is not a Funnel failure at all. It is a handler bound to `localhost` in a way that only listens on the IPv6 loopback, or inside a container with no port publishing, while Funnel dutifully proxies to a socket that nothing is listening on. Before you touch the policy file, prove the target answers locally with `curl -i http://127.0.0.1:3000/hooks/inbound` on the node itself.

## Where to take it next

Run the tailnet only version of the same setup with `tailscale serve` for the services that never need public reach, such as a staging UI or a metrics page. Same syntax, same proxy, no front door, and no certificate transparency exposure beyond what HTTPS already published.

Use the second and third allowed ports deliberately. Port 443 for the signed webhook path, 8443 for an inspection UI you only enable while debugging, then turn 8443 off the moment you are finished. Two published surfaces with different lifetimes is easier to reason about than one surface with a growing route table.

Move the receiver off your laptop once the integration is real. As of 2026 Tailscale Services, Peer Relays, and workload identity federation are all generally available (ts-changelog), and Tailscale Services in particular exist "to decouple applications and services from the devices that host them," which is the correct answer once a webhook endpoint outlives the machine that first received one.

Embed the same capability in your application with `tsnet` so the process joins the tailnet itself and no host level daemon configuration is involved. That turns a development trick into a deployable pattern.
