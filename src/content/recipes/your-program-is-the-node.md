---
slug: your-program-is-the-node
title: Put a tailnet node inside your Go binary
description: Use tsnet to embed a full Tailscale node in a Go program so the process itself joins the tailnet, with no daemon, no sidecar, no root, and no host networking.
level: advanced
payoff: A service reachable only over your tailnet, that knows exactly who is calling it, from a single static binary.
order: 7
words: 2050
sources:
  - id: tsnet-pkg
    url: https://pkg.go.dev/tailscale.com/tsnet
    title: tsnet package reference (pkg.go.dev)
    checked: 2026-08-11
  - id: tsnet-src
    url: https://github.com/tailscale/tailscale/blob/main/tsnet/tsnet.go
    title: tailscale/tailscale tsnet/tsnet.go source
    checked: 2026-08-11
  - id: tshello
    url: https://github.com/tailscale/tailscale/blob/main/tsnet/example/tshello/tshello.go
    title: "tsnet example: tshello"
    checked: 2026-08-11
  - id: tsnet-funnel-example
    url: https://github.com/tailscale/tailscale/blob/main/tsnet/example/tsnet-funnel/tsnet-funnel.go
    title: "tsnet example: tsnet-funnel"
    checked: 2026-08-11
  - id: tsnet-kb
    url: https://tailscale.com/docs/features/tsnet
    title: Using tsnet (Tailscale docs)
    checked: 2026-08-11
  - id: local-pkg
    url: https://pkg.go.dev/tailscale.com/client/local
    title: tailscale.com/client/local package reference
    checked: 2026-08-11
  - id: apitype
    url: https://pkg.go.dev/tailscale.com/client/tailscale/apitype
    title: apitype package reference (WhoIsResponse)
    checked: 2026-08-11
  - id: tailcfg
    url: https://pkg.go.dev/tailscale.com/tailcfg
    title: tailcfg package reference (PeerCapMap, Node, UserProfile)
    checked: 2026-08-11
  - id: ipnstate
    url: https://pkg.go.dev/tailscale.com/ipn/ipnstate
    title: ipnstate package reference (Status)
    checked: 2026-08-11
  - id: authkeys
    url: https://tailscale.com/docs/features/access-control/auth-keys
    title: Auth keys (Tailscale docs)
    checked: 2026-08-11
  - id: funnel
    url: https://tailscale.com/docs/features/tailscale-funnel
    title: Tailscale Funnel (Tailscale docs)
    checked: 2026-08-11
  - id: grants-app
    url: https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities
    title: "Grants: application capabilities (Tailscale docs)"
    checked: 2026-08-11
---

## What you get

A single Go binary that is its own device on your tailnet.

Not a program behind a tailnet. Not a program in a container next to a `tailscaled` sidecar. The process itself has a Tailscale IP, a MagicDNS name, and an entry in your admin console. Kill the process and the device goes away. Start it on a different box and the same device moves with it.

The package doc states the goal plainly: tsnet "embeds a Tailscale node directly into a Go program, allowing it to join a tailnet and accept or dial connections without running a separate tailscaled daemon or requiring any system-level configuration" [tsnet-src].

That last clause is the whole point. No `tailscaled` unit file. No `/dev/net/tun`. No `NET_ADMIN` capability. No root. No host networking mode on the container. Nothing on the host is modified, because nothing on the host is involved.

What you actually hold in your hand after twenty lines of code:

- A `net.Listener` that only exists on the tailnet [tsnet-pkg]. You hand it to `http.Serve` like any other listener, and the resulting service is unreachable from the host's own network stack.
- An `*http.Client` that dials out over the tailnet [tsnet-pkg], so your service can call other tailnet services by name.
- A `WhoIs` call that tells you the login name, device, tags, and policy grants of whoever just connected [local-pkg] [apitype]. You get authenticated callers without writing a single line of login code.

That third one is the part most people never reach, and it is the reason this recipe is worth your afternoon.

## How it works

Tailscale normally runs as a daemon that owns a tunnel device and rewrites your host's routing table. tsnet does neither. It runs the same node logic inside your process against a userspace TCP/IP stack [tsnet-kb] [tsnet-src], so packets never touch the kernel's network configuration.

<div class="diagram-wrap">
<svg viewBox="0 0 760 400" role="img" aria-label="A Go binary on host cloud-1 runs a Tailscale node inside its own process using a userspace TCP/IP stack, so the host has no tailscaled daemon and no tunnel device, while the program still joins the tailnet alongside node-a and node-b.">
  <title>The binary is the node: tsnet runs a full Tailscale node inside one Go process</title>
  <rect x="8" y="8" width="744" height="384" rx="12" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <rect x="24" y="44" width="300" height="320" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="40" y="68" font-size="13" fill="var(--diagram-text)">host cloud-1</text>
  <rect x="38" y="80" width="272" height="222" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="52" y="100" font-size="12" fill="var(--diagram-text)">one Go process, no root</text>
  <rect x="52" y="110" width="244" height="38" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="64" y="134" font-size="12" fill="var(--diagram-text)">your http.Handler</text>
  <rect x="52" y="156" width="244" height="38" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="64" y="180" font-size="12" fill="var(--diagram-text)">tsnet.Server: Listen, Dial, WhoIs</text>
  <rect x="52" y="202" width="244" height="38" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="64" y="226" font-size="12" fill="var(--diagram-text)">userspace TCP/IP stack</text>
  <rect x="52" y="248" width="244" height="38" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="64" y="272" font-size="12" fill="var(--diagram-text)">Dir: tailscaled.state on disk</text>
  <text x="40" y="326" font-size="12" fill="var(--diagram-text)">no tailscaled service</text>
  <text x="40" y="346" font-size="12" fill="var(--diagram-text)">no tun device, no host route</text>
  <text x="332" y="104" font-size="11" fill="var(--diagram-text)">WireGuard over UDP</text>
  <text x="332" y="120" font-size="11" fill="var(--diagram-text)">(Server.Port, auto if zero)</text>
  <line x1="324" y1="136" x2="486" y2="136" stroke="var(--diagram-accent)"/>
  <polygon points="498,136 486,130 486,142" fill="var(--diagram-accent)"/>
  <line x1="492" y1="214" x2="336" y2="214" stroke="var(--diagram-accent)"/>
  <polygon points="324,214 336,208 336,220" fill="var(--diagram-accent)"/>
  <text x="332" y="240" font-size="11" fill="var(--diagram-text)">inbound tailnet conn</text>
  <text x="332" y="256" font-size="11" fill="var(--diagram-text)">arrives at ln.Accept()</text>
  <text x="332" y="300" font-size="11" fill="var(--diagram-text)">lc.WhoIs(r.RemoteAddr)</text>
  <text x="332" y="316" font-size="11" fill="var(--diagram-text)">returns login name, tags,</text>
  <text x="332" y="332" font-size="11" fill="var(--diagram-text)">and grant capabilities</text>
  <rect x="500" y="44" width="236" height="320" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="516" y="68" font-size="13" fill="var(--diagram-text)">your tailnet</text>
  <rect x="516" y="82" width="204" height="42" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="530" y="108" font-size="12" fill="var(--diagram-text)">node-a</text>
  <rect x="516" y="136" width="204" height="42" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="530" y="162" font-size="12" fill="var(--diagram-text)">node-b (lab-vm-1)</text>
  <rect x="516" y="190" width="204" height="60" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="530" y="214" font-size="12" fill="var(--diagram-text)">control plane:</text>
  <text x="530" y="234" font-size="12" fill="var(--diagram-text)">tags, grants, ACLs</text>
  <text x="516" y="288" font-size="12" fill="var(--diagram-text)">inventory.your-tailnet.ts.net</text>
  <text x="516" y="308" font-size="12" fill="var(--diagram-text)">resolves to this process</text>
</svg>
</div>

> [!HOW-IT-WORKS]
> `Server.Listen` returns a plain `net.Listener` [tsnet-pkg], which is why this composes with everything in Go. `http.Serve`, gRPC, a raw TCP protocol you wrote yourself: they all accept a `net.Listener` and none of them know or care that the connections arrived over WireGuard. The abstraction boundary is exactly right. You do not adopt a framework, you swap one line where the listener is created.

The reverse direction is just as clean. `Server.HTTPClient` returns an `*http.Client` whose transport dials through the tsnet node [tsnet-pkg] [tsnet-src], so `client.Get("http://node-b/metrics")` resolves and routes on the tailnet, not on the host.

> [!ON-THE-WIRE]
> From the host's point of view, your process opens outbound UDP and nothing else. `Server.Port` is documented as "the UDP port to listen on for WireGuard and peer-to-peer traffic. If zero, a port is automatically selected" [tsnet-pkg]. There is no listening socket on the host for your HTTP service, because the HTTP service does not live on the host's stack. `ss -ltn` on cloud-1 will not show port 80. This is the single most surprising thing about tsnet the first time you run it.

## Build it

**1. Start a module and pull the dependency.** The module path is `tailscale.com` [tsnet-pkg].

```
go mod init example.com/inventory
go get tailscale.com
```

**2. Mint an auth key.** In the admin console, create a key that is tagged, non reusable, and pre-approved if your tailnet has device approval on [authkeys]. Tagging matters: tagged devices get their identity from the tag, and grants target tags rather than a person.

**3. Pick a state directory that survives restarts.** `Dir` "specifies the name of the directory to use for state" and defaults to a location under `os.UserConfigDir` based on the binary name [tsnet-pkg]. In a container, that default is inside the writable layer, which is the wrong place. Point it at a mounted volume.

**4. Write the program.**

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

// capInventory is an app capability declared in your tailnet policy file.
// A grant attaches values under this name to a (source, destination) pair.
const capInventory tailcfg.PeerCapability = "example.com/cap/inventory"

// grantValue is one JSON object from the "app" section of that grant.
type grantValue struct {
	Actions []string `json:"actions"`
}

func main() {
	stateDir := os.Getenv("TSNET_STATE_DIR")
	if stateDir == "" {
		stateDir = "/var/lib/inventory/tsnet"
	}

	srv := &tsnet.Server{
		// Hostname is what control sees. MagicDNS name becomes
		// inventory.your-tailnet.ts.net.
		Hostname: "inventory",

		// Dir holds this node's identity. Lose it and you re-register.
		Dir: stateDir,

		// Read the key from the environment. Never compile it in.
		// tsnet also honors TS_AUTHKEY; this is the explicit form.
		AuthKey: os.Getenv("TS_AUTHKEY"),

		// UserLogf carries login URLs and status meant for a human.
		// Logf is the verbose backend log; leaving it nil discards it.
		UserLogf: log.Printf,
	}
	defer srv.Close()

	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Up blocks until the node is actually running, and hands back status.
	status, err := srv.Up(ctx)
	if err != nil {
		log.Fatalf("tsnet did not come up: %v", err)
	}
	log.Printf("node up: state=%s addrs=%v",
		status.BackendState, status.TailscaleIPs)

	// LocalClient talks to the LocalAPI of this in-process node.
	lc, err := srv.LocalClient()
	if err != nil {
		log.Fatalf("local client: %v", err)
	}

	// This listener exists only on the tailnet. Nothing binds on the host.
	ln, err := srv.Listen("tcp", ":80")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		who, err := lc.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil {
			http.Error(w, "cannot identify caller",
				http.StatusInternalServerError)
			return
		}

		actions, err := allowedActions(who)
		if err != nil {
			log.Printf("bad capability value from %s: %v", r.RemoteAddr, err)
			http.Error(w, "malformed grant", http.StatusInternalServerError)
			return
		}
		if len(actions) == 0 {
			http.Error(w, "no grant covers this caller",
				http.StatusForbidden)
			return
		}

		fmt.Fprintf(w, "caller:  %s\n", who.UserProfile.LoginName)
		fmt.Fprintf(w, "node:    %s\n", who.Node.ComputedName)
		fmt.Fprintf(w, "tagged:  %v %v\n", who.Node.IsTagged(), who.Node.Tags)
		fmt.Fprintf(w, "actions: %v\n", actions)
	})

	httpSrv := &http.Server{Handler: mux}
	go func() {
		<-ctx.Done()
		httpSrv.Close()
	}()

	if err := httpSrv.Serve(ln); err != nil &&
		!errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}

// allowedActions reads the capability values your policy file attached to
// this caller. No cookie, no bearer token, no local user table.
func allowedActions(who *apitype.WhoIsResponse) ([]string, error) {
	vals, err := tailcfg.UnmarshalCapJSON[grantValue](who.CapMap, capInventory)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, v := range vals {
		out = append(out, v.Actions...)
	}
	return out, nil
}
```

**5. Add the grant to your tailnet policy file.** This is what makes `CapMap` non empty. The `app` field maps a capability name to an array of JSON values [grants-app].

```json
{
  "src": ["group:ops"],
  "dst": ["tag:inventory"],
  "ip":  ["tcp:80"],
  "app": {
    "example.com/cap/inventory": [
      {"actions": ["read", "restart"]}
    ]
  }
}
```

**6. Run it.**

```
TS_AUTHKEY=tskey-auth-... TSNET_STATE_DIR=/var/lib/inventory/tsnet ./inventory
```

## Verify it

Watch the log line from `Up`. `BackendState` should read `Running` and `TailscaleIPs` should list the addresses control assigned [ipnstate]. Both come straight off the `*ipnstate.Status` that `Up` returns [tsnet-pkg].

Then, from node-b:

```
curl http://inventory
```

You should get back your own login name, the calling device's name, its tag state, and the actions your grant allows. If the caller has no matching grant, you get a 403 and the handler never sees a request body.

Now the confirmation that this is genuinely not on the host. On cloud-1, run `ss -ltn` and look for port 80. It is not there. Run `ip link` and look for a `tailscale0` interface. It is not there either. Run `curl http://localhost` on cloud-1 itself and it fails. The service exists on exactly one network, and that network is your tailnet.

Finally, check the admin console. A device named `inventory` is listed. Stop the process, start it again, and confirm it is still the same device with the same IP. If a second device appeared, your state directory is not persisting, which is the next section.

## Gotchas

> [!GOTCHA]
> **The state directory is the node's identity.** If `Dir` points at ephemeral container storage, every restart creates a brand new node with a new IP, and your admin console fills with dead duplicates. Mount it on a volume. Related: `AuthKey` "is the auth key to create the node," and "if the node is already created (from state previously stored in Store), then this field is not used" [tsnet-pkg]. Rotating the key in your environment does nothing for a node that already has state. That is usually what you want, but it surprises people who expect key rotation to re-authenticate the node.

**One `Dir` per node, always.** The docs are explicit: "If you want to use multiple tsnet services in the same binary, you will need to make sure that Dir is set uniquely for each service" [tsnet-pkg]. Two servers sharing a directory will fight over the same state file.

**`Listen` with no IP only matches traffic addressed to this node.** The doc says listeners without an IP "will match for traffic for the local node (that is, a destination address of the IPv4 or IPv6 address of this node) only. To listen for traffic on other addresses such as those routed inbound via subnet routes, explicitly specify the listening address or use RegisterFallbackTCPHandler" [tsnet-pkg]. If your tsnet service is behind a subnet router, this is the bug you will spend an hour on.

**Ephemeral versus reusable, and which to pick.** Ephemeral keys make the device clean itself up after it goes offline [authkeys], which is exactly right for a short lived job: a batch worker, a CI runner, a Lambda-style function. For a long running service you want the opposite: a non reusable, tagged key plus a persistent `Dir`, so the node registers once and keeps the same identity across restarts. Reusable keys are a convenience with teeth, and the docs say so directly: "Be very careful with reusable keys! These can be very dangerous if stolen" [authkeys]. Set `Ephemeral: true` on the `tsnet.Server` when you want ephemeral behavior [tsnet-pkg]. One useful consequence of tagging: for tagged devices, key expiry is disabled by default [authkeys], so your service does not silently drop off the tailnet in ninety days.

**`Close` has ordering rules.** "It must not be called before or concurrently with Start" [tsnet-pkg]. A `defer srv.Close()` placed before your first `Listen` or `Up` call is fine, because those start the server. A shutdown path racing a startup path is not.

**The LocalAPI client is not a frozen API.** The `local` package says its methods "vary in maturity" and that anything without an explicit stability note "should be assumed to be unstable" [local-pkg]. `WhoIs` is widely used and stable in practice, but pin your `tailscale.com` version and read release notes before upgrading.

> [!FROM-THE-FIELD]
> The `WhoIs` call is the feature people underuse. The official `tshello` example builds the entire thing in one handler: call `lc.WhoIs(r.Context(), r.RemoteAddr)`, then read `who.UserProfile.LoginName` and `who.Node.ComputedName` [tshello]. `WhoIsResponse` carries `Node`, `UserProfile`, and `CapMap`, and in successful responses `Node` and `UserProfile` are never nil [apitype]. That means an internal tool can know its caller with zero login pages, zero session cookies, zero password reset flow, and zero user table. The tailnet already authenticated them. Layer `CapMap` on top and your policy file becomes your authorization config, edited in one place for every service you run [grants-app]. The cost of adding an internal tool drops far enough that you start building the small ones you kept skipping.

## Where to take it next

**Serve HTTPS inside the tailnet.** `ListenTLS` "returns a TLS listener wrapping the tsnet listener" [tsnet-pkg]. Or wrap `Listen` yourself with `tls.NewListener` and `GetCertificate: lc.GetCertificate`, which is exactly what `tshello` does on port 443 [tshello] [local-pkg].

**Go public with Funnel.** `ListenFunnel(network, addr string, opts ...FunnelOption)` "announces on the public internet using Tailscale Funnel" and by default also listens on your tailnet; pass `FunnelOnly()` to restrict it to internet traffic [tsnet-pkg]. The official example is four lines around `s.ListenFunnel("tcp", ":443")` plus `s.CertDomains()[0]` to print the URL [tsnet-funnel-example]. Requirements are real and worth knowing before you try: a `funnel` node attribute in your policy file, HTTPS certificates enabled, MagicDNS on, only ports 443, 8443, and 10000, and only names in your own `tailnet-name.ts.net` domain [funnel]. Combine this with `WhoIs` carefully, because Funnel traffic is not tailnet traffic and will not carry a tailnet identity.

**Dial outward.** `HTTPClient` "returns an HTTP client that is configured to connect over Tailscale" and is meant for "your tsnet services connect to other devices on your tailnet" [tsnet-pkg]. A mesh of small tsnet binaries calling each other by MagicDNS name is a genuinely pleasant architecture.

**Advertise a Tailscale Service.** `ListenService(name string, mode ServiceMode)` advertises the node as hosting a named Service, with `ServiceModeTCP` and `ServiceModeHTTP` controlling port, TLS termination, and forwarded app capabilities [tsnet-pkg]. Note the constraint the package encodes as `ErrUntaggedServiceHost`: "service hosts must be tagged nodes" [tsnet-pkg], and approval still comes from an admin or an auto-approval rule.

**Debug what you cannot see.** Because there is no host interface, `tcpdump` on cloud-1 tells you nothing about tailnet traffic. `CapturePcap(ctx, pcapFile)` writes what netstack sees to a pcap file, which the docs describe as "useful during debugging, probably not useful for production" [tsnet-pkg]. `Loopback()` is the other escape hatch: it starts a SOCKS5 proxy onto the tailnet plus the LocalAPI on a loopback address, both credential protected [tsnet-pkg].

**Understand what you gave up.** No host route means nothing else on cloud-1 can use this tailnet connection, so if you need the whole machine on the tailnet you still want `tailscaled`. One node per process means N services equals N devices in your console and N entries against your device count. Userspace networking costs some throughput compared to a kernel tunnel device. And key management moves into your deployment system, where a leaked environment variable is now a tailnet device rather than an application secret. Those are real prices. For an internal service that should be reachable by exactly the right people and invisible to everyone else, they are cheap ones.
