---
module: 9
slug: platform-matrix
title: The platform matrix
description: Where Tailscale runs, what is identical on every platform, and what each operating system decides differently.
order: 9
words: 4400
sources:
  - id: macos-variants
    url: https://tailscale.com/kb/1065/macos-variants
    title: Variants of the macOS Tailscale client
    checked: 2026-08-10
  - id: tailscaled
    url: https://tailscale.com/kb/1278/tailscaled
    title: tailscaled
    checked: 2026-08-10
  - id: cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: tailscale-up
    url: https://tailscale.com/kb/1241/tailscale-up
    title: tailscale up command
    checked: 2026-08-10
  - id: auth-keys
    url: https://tailscale.com/kb/1085/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: run-unattended
    url: https://tailscale.com/kb/1088/run-unattended
    title: Run Tailscale unattended on Windows
    checked: 2026-08-10
  - id: install-windows
    url: https://tailscale.com/kb/1022/install-windows
    title: Install Tailscale on Windows
    checked: 2026-08-10
  - id: install-ios
    url: https://tailscale.com/kb/1020/install-ios
    title: Install Tailscale on iOS
    checked: 2026-08-10
  - id: other-vpns
    url: https://tailscale.com/kb/1105/other-vpns
    title: Using Tailscale with other VPNs
    checked: 2026-08-10
  - id: install-linux
    url: https://tailscale.com/kb/1031/install-linux
    title: Install Tailscale on Linux
    checked: 2026-08-10
  - id: docker-quick
    url: https://tailscale.com/kb/1453/quick-guide-docker
    title: Quick guide to Tailscale on Docker
    checked: 2026-08-10
  - id: docker-params
    url: https://tailscale.com/docs/features/containers/docker/docker-params
    title: Docker configuration parameters
    checked: 2026-08-10
  - id: k8s-install
    url: https://tailscale.com/docs/kubernetes-operator/install-operator
    title: Install the Tailscale Kubernetes Operator
    checked: 2026-08-10
  - id: k8s-apiserver
    url: https://tailscale.com/kb/1437/kubernetes-operator-api-server-proxy
    title: Access the Kubernetes control plane using an API server proxy
    checked: 2026-08-10
  - id: k8s-customization
    url: https://tailscale.com/kb/1445/kubernetes-operator-customization
    title: Customize the Kubernetes operator and resources it manages
    checked: 2026-08-10
  - id: synology
    url: https://tailscale.com/kb/1131/synology
    title: Install Tailscale on Synology
    checked: 2026-08-10
---

## The promise

1. You will be able to state precisely which parts of Tailscale are identical on every platform (the engine) and which parts each operating system decides for itself (packet injection, DNS, firewall, state storage, process supervision).
2. You will be able to deploy a headless Linux node with an auth key, know where its state lives, and choose the right netfilter mode for a box that already has firewall opinions.
3. You will be able to identify which of the three macOS variants is installed on a machine, and explain why that answer changes how you debug it.
4. You will be able to run Tailscale in a container correctly: state volume, TS_ environment variables, userspace versus kernel networking, and the sidecar pattern.
5. You will be able to describe what the Kubernetes operator actually creates when you expose a Service, and what ProxyClass and the API server proxy are for.
6. You will be able to predict platform-specific failure modes (mobile VPN eviction, Synology TUN sandbox, Windows per-user sessions) before they burn an afternoon.

## Foundation

You already know the layered model: an overlay network needs a control channel, a data plane, and a way to inject itself into the host's networking stack. You know from Module 01 that the data plane is WireGuard, and from Module 02 that a coordination server distributes keys and network maps. You have configured VPN clients on more than one OS and have felt the pain that the same product behaves differently on each: different config paths, different service managers, different firewall interactions.

You also know how operating systems differ at the network boundary. Linux gives you TUN devices, netfilter, and systemd. macOS gives you utun interfaces and, for GUI apps, Apple's extension frameworks with their sandboxes and entitlements. Windows gives you a service model plus a per-user desktop session. Mobile platforms give you exactly one VPN slot and a hostile attitude toward background processes. Containers give you namespaces and the question of whether you are allowed to touch the kernel at all.

This module is the map of how one codebase lands on all of those surfaces.

## Core content

### The engine is the same everywhere

Analogy first: Tailscale is like a shipping company with one standard engine design installed into many different hulls. The engine (routing logic, key management, NAT traversal, the WireGuard implementation) is identical whether the hull is a Linux server, a MacBook, or a container. What changes per hull is the mounting hardware: how the engine bolts to the host's packet path, where it stores its papers, and who is allowed to turn the key.

The mechanism: on every platform, the core is the same Go program, `tailscaled`, or a library embedding of the same code. It is the privileged daemon that handles network operations; the `tailscale` CLI is a thin client that requires the daemon to be running and talks to it over a local socket (the `--socket=<path>` flag on the CLI exists precisely because that socket location varies by platform). The daemon holds the node's private key, maintains the connection to the control plane (Module 02), runs the WireGuard data plane (Module 01), and performs NAT traversal (Module 03). None of that logic forks per platform.

What the OS decides is everything at the edges:

- **Packet injection.** Linux uses a TUN device (`--tun=NAME`), macOS uses the kernel's utun interface or an Apple extension, and environments that cannot create any kernel interface use `--tun=userspace-networking`, which the daemon documents as the magic value for doing everything in process instead of using kernel support.
- **DNS.** Module 06 covered MagicDNS; each OS has a different lever for actually installing resolver configuration.
- **Firewall integration.** Only Linux gets netfilter management; other platforms use their native equivalents or nothing.
- **State storage.** A file or directory on servers, platform keychains and app containers on GUI and mobile platforms, a volume or Kubernetes Secret in containers.
- **Process supervision.** systemd on Linux, launchd on macOS, the Windows service manager, Docker's restart policy, or a kubelet.

The failure mode of forgetting this: you assume a symptom is a Tailscale bug when it is actually a hull problem. If two peers on different platforms both show the same handshake behavior, the engine is fine and your problem is above or below it. If only the Synology box misbehaves, suspect the hull.

<div class="diagram-wrap">
<svg viewBox="0 0 760 340" role="img" aria-label="Layer diagram showing the identical Tailscale engine above five different OS integration layers">
  <title>The shared engine versus the OS-decided layer</title>
  <rect x="20" y="20" width="720" height="110" rx="10" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="48" text-anchor="middle" fill="var(--diagram-text)" font-size="16" font-weight="bold">Identical everywhere: tailscaled engine</text>
  <text x="380" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="13">WireGuard data plane, control client, netmap, NAT traversal, ACL enforcement</text>
  <text x="380" y="98" text-anchor="middle" fill="var(--diagram-text)" font-size="13">CLI talks to daemon over a local socket (LocalAPI)</text>
  <line x1="380" y1="130" x2="380" y2="160" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="20" y="160" width="130" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="85" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Linux</text>
  <text x="85" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TUN device</text>
  <text x="85" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">netfilter</text>
  <text x="85" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">systemd</text>
  <text x="85" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/var/lib/tailscale</text>
  <rect x="170" y="160" width="130" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="235" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">macOS</text>
  <text x="235" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">utun or Apple</text>
  <text x="235" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">extension APIs</text>
  <text x="235" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">3 variants</text>
  <text x="235" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="11">sandbox rules</text>
  <rect x="320" y="160" width="130" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="385" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Windows</text>
  <text x="385" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">service + GUI</text>
  <text x="385" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">per-user default</text>
  <text x="385" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">unattended mode</text>
  <text x="385" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="11">registry / MDM</text>
  <rect x="470" y="160" width="130" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="535" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Mobile</text>
  <text x="535" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">one VPN slot</text>
  <text x="535" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">OS controls</text>
  <text x="535" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">lifecycle</text>
  <text x="535" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="11">battery budget</text>
  <rect x="620" y="160" width="120" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="680" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Containers</text>
  <text x="680" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">userspace or</text>
  <text x="680" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TUN + caps</text>
  <text x="680" y="250" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_ env vars</text>
  <text x="680" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="11">state volume</text>
</svg>
</div>

### Linux: the reference platform

Linux is where Tailscale is most transparent, because every layer is inspectable with standard tools.

**Install.** Distro packages exist for the major families (apt and yum repositories, plus a convenience script at `https://tailscale.com/install.sh` that detects your distro and adds the right repository). The package installs two binaries, `tailscaled` and `tailscale`, and a systemd unit.

**Supervision.** `tailscaled` runs as a systemd service (or whatever init system your distro uses). You manage it with `sudo systemctl start|stop|restart tailscaled`, and daemon flags live in the `FLAGS` line of `/etc/default/tailscaled`, which the systemd unit includes. Logs go to the journal, readable with `journalctl -u tailscaled` or portably with `tailscale debug daemon-logs`.

**Packet path.** By default the daemon creates a kernel TUN device, conventionally `tailscale0`, selectable with `--tun=NAME`. On kernels or environments where TUN is unavailable, `--tun=userspace-networking` runs the whole TCP/IP stack in process, trading kernel-speed forwarding for universal compatibility.

**Firewall.** This is the part unique to Linux: tailscaled actively manages netfilter rules so that tailnet traffic is accepted and routing features work. The `tailscale up --netfilter-mode` flag controls how much it manages. `on` (the default) gives Tailscale full management of its rules. `nodivert` makes Tailscale create and manage its own sub-chains but leaves calling those chains to you, for hosts where a config management system owns the firewall. `off` disables all netfilter management, which means features like subnet routing are on you to make work. The analogy: `on` is letting the plumber cut into your pipes, `nodivert` is the plumber leaving you a labeled valve you must connect yourself, and `off` is the plumber handing you parts in a box. The failure mode: a firewall management tool (firewalld, an Ansible iptables role) flushes chains on its next run and silently deletes Tailscale's rules; traffic stops until the daemon restores them or you restart it.

**Headless auth.** Servers have no browser, so you authenticate with an auth key: `tailscale up --auth-key=tskey-...` (a value beginning with `file:` is treated as a path to a file containing the key, so the secret stays out of shell history and process lists). Keys come in flavors that matter operationally: one-off keys are revoked after a single use; reusable keys can enroll many machines and should live in a vault because they are dangerous if stolen; ephemeral keys auto-remove the device when it goes offline, which is exactly right for containers and short-lived VMs; tagged keys stamp the node with an ACL tag (Module 05) so policy applies from first boot. Keys expire in 1 to 90 days (default 90), and an expired auth key does not deauthorize devices already enrolled; their node keys live on their own 180-day default cycle (Module 04).

**State.** Node identity (private key, assigned IPs, tailnet membership) lives in the daemon's state file, `tailscaled.state` inside the state directory, which the Linux packages put at `/var/lib/tailscale`. Destroy that file and the machine is a brand new node next time it authenticates. Preserve it and the node survives reinstalls with the same identity. This one fact explains most container state-volume guidance later.

> [!HOW-IT-WORKS] The `tailscale` CLI never touches the network itself. Every command is a request over a local socket to tailscaled's local API, which is why `tailscale status` fails with a connection error when the daemon is down, and why the CLI has a `--socket` flag at all. Learn to read "cannot connect to tailscaled" as "the daemon is not running or I am talking to the wrong socket," never as a network problem.

### macOS: one product, three bodies

macOS is the platform where "which Tailscale do you have" is a real debugging question, because there are three distinct variants (all require macOS 12.0 or later, checked 2026-08-10).

**Standalone (recommended).** Downloaded directly from Tailscale. Uses Apple's system extension framework, has a GUI, and self-updates through an in-app mechanism (Sparkle) without waiting on App Store review. It is compatible with the Screen Time web filter. Tailscale's own guidance is to always start with this variant. Note what it does not do: like the App Store variant, it does not run the Tailscale SSH server; on macOS only the open source daemon does.

**Mac App Store.** Distributed through the App Store, so it updates on the App Store's schedule. It runs inside the App Store sandbox using a network extension. The sandbox is not free: the Tailscale SSH server is unavailable here too, and the KB documents that the Screen Time web filter can conflict with this variant. The CLI still exists but is buried inside the app bundle: `/Applications/Tailscale.app/Contents/MacOS/Tailscale <command>` (the binary decides at launch whether it is a GUI or a CLI based on environment variables; `TAILSCALE_BE_CLI=1` forces CLI mode in scripts, and the docs recommend a shell alias for daily use).

**Open source tailscaled.** The same daemon you run on Linux, using the kernel's utun interface directly. No GUI, no auto-update, but it is the one macOS variant that supports the Tailscale SSH server. The KB scopes it to unattended installs managed by experienced macOS administrators.

Analogy: same actor, three costumes. The Standalone variant is the actor in street clothes, free to move. The App Store variant is the actor in a full-body mascot suit: recognizably the same performer, but some gestures are physically impossible inside the suit. The open source variant is the actor's voice on a phone line: fully capable in a narrow channel, invisible on stage.

Mechanism: the difference is which Apple process model hosts the packet tunnel. The GUI variants do not run a literal `tailscaled` process; the engine is hosted inside the variant's Apple extension, a system extension for Standalone and a network extension for the App Store build. The open source variant runs plain `tailscaled` with utun.

Failure mode: mixing variants. Two variants installed at once fight over the VPN configuration and produce flapping connectivity that looks like a NAT traversal bug. And debugging with the wrong mental model wastes time: `ps aux | grep tailscaled` finding nothing does not mean Tailscale is not running; on GUI variants it never would.

> [!GOTCHA] Do not install more than one macOS variant simultaneously, and identify the variant before debugging anything. A missing feature (no Tailscale SSH on either GUI variant, a Screen Time conflict on the App Store one) may be a variant property, not a bug. `tailscale version` output and the presence or absence of a `tailscaled` process tell you which body the engine is wearing.

<div class="diagram-wrap">
<svg viewBox="0 0 760 320" role="img" aria-label="Decision tree for choosing and identifying macOS Tailscale variants">
  <title>macOS variant decision tree</title>
  <rect x="270" y="15" width="220" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="38" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Need a GUI?</text>
  <text x="380" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="11">macOS client choice</text>
  <line x1="310" y1="65" x2="140" y2="110" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="200" y="85" fill="var(--diagram-text)" font-size="11">no, headless</text>
  <line x1="450" y1="65" x2="560" y2="110" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="520" y="85" fill="var(--diagram-text)" font-size="11">yes</text>
  <rect x="30" y="110" width="220" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="140" y="135" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Open source tailscaled</text>
  <text x="140" y="155" text-anchor="middle" fill="var(--diagram-text)" font-size="11">utun, CLI only, no auto-update</text>
  <text x="140" y="172" text-anchor="middle" fill="var(--diagram-text)" font-size="11">runs the Tailscale SSH server</text>
  <rect x="450" y="110" width="220" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="560" y="132" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Managed by App Store</text>
  <text x="560" y="149" text-anchor="middle" fill="var(--diagram-text)" font-size="11">policy requires it?</text>
  <line x1="500" y1="160" x2="380" y2="215" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="410" y="185" fill="var(--diagram-text)" font-size="11">no</text>
  <line x1="620" y1="160" x2="640" y2="215" stroke="var(--diagram-line)" stroke-width="2"/>
  <text x="645" y="185" fill="var(--diagram-text)" font-size="11">yes</text>
  <rect x="250" y="215" width="260" height="85" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="380" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Standalone (recommended)</text>
  <text x="380" y="260" text-anchor="middle" fill="var(--diagram-text)" font-size="11">system extension, direct download</text>
  <text x="380" y="277" text-anchor="middle" fill="var(--diagram-text)" font-size="11">in-app updates (Sparkle)</text>
  <text x="380" y="293" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Screen Time compatible</text>
  <rect x="540" y="215" width="200" height="85" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="640" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">App Store variant</text>
  <text x="640" y="260" text-anchor="middle" fill="var(--diagram-text)" font-size="11">network extension, sandbox</text>
  <text x="640" y="277" text-anchor="middle" fill="var(--diagram-text)" font-size="11">no SSH server, Screen Time</text>
  <text x="640" y="293" text-anchor="middle" fill="var(--diagram-text)" font-size="11">filter can conflict</text>
</svg>
</div>

### Windows: a service wearing a tray icon

Windows ships as a single `.exe` installer that picks the right build for 32-bit and 64-bit systems (an MSI exists for managed deployment) and requires Windows 10 or later, or Windows Server 2016 or later. After install you get a tray icon GUI, and the engine runs behind it.

The mechanism that matters: by default, the Tailscale connection is associated with the logged-in user. Log out, and connectivity stops. Enable unattended mode (tray menu under Preferences, or `tailscale up --unattended=true`; elevated permissions may be required) and Tailscale runs continuously at the system level regardless of who is logged in, including across concurrent RDP sessions on Windows Server. Different users on the same machine can hold different Tailscale login profiles, which is why a colleague logging into a shared workstation can appear to "change" the machine's tailnet identity: the active profile followed the console session.

For fleets, Windows registry values distribute system policy to the client, typically pushed by MDM, mirroring what MDM configuration profiles do on Apple platforms.

Analogy: default Windows Tailscale is a desk lamp plugged into a switched outlet: it dies when the wall switch (your login session) goes off. Unattended mode rewires it to always-on power. Failure mode: a Windows box used as a remote-access target reboots after updates, sits at the login screen, and is unreachable until someone logs in, because nobody enabled unattended mode. If a Windows machine drops off the tailnet exactly when a user logs out, this is the diagnosis, checked in seconds.

### Mobile: iOS and Android

On mobile, the OS is in charge and Tailscale is a guest. Both iOS and Android enforce a limit of one running VPN at a time, so Tailscale cannot coexist with another active VPN app on the same device; connecting one disconnects the other. On iOS (15.0 or later, iPhone and iPad) the app installs a VPN configuration you must accept, and enterprise deployment happens through MDM configuration profiles. Push notifications prompt reauthentication when keys are about to expire.

Mechanism: there is no daemon you control. The engine runs inside an OS-managed VPN extension with a constrained lifecycle and memory budget. The OS decides when the extension runs and how much background activity it gets. Keeping a node reachable requires ongoing keepalive work for NAT traversal (Module 03), and that costs battery; poor cellular signal amplifies it because the client keeps re-establishing connectivity.

Analogy: a mobile Tailscale node is a shop inside a mall. The mall sets the opening hours, controls the power, and can shut your storefront for the night. A Linux server is a standalone building with its own keys.

Failure mode: treating a phone like a server. If you expect a phone to be a reliable subnet router or exit node, the OS will eventually pause the extension or the user will toggle another VPN, and "Tailscale is flaky" complaints follow. Mobile nodes are clients first.

> [!FROM-THE-FIELD] When a mobile user reports that Tailscale "randomly disconnects," ask two questions before anything else: is another VPN app installed (the one-VPN-slot rule means a corporate VPN or a privacy VPN evicts Tailscale), and did the OS battery optimizer restrict the app? Both look identical to a network problem from the tailnet side: the node just goes offline.

### Containers: the engine with no kernel of its own

The official image is `tailscale/tailscale` on Docker Hub, configured entirely through environment variables so it can be driven declaratively from compose files and manifests.

The variables that carry the load (full list in the Docker parameters doc, checked 2026-08-10):

- `TS_AUTHKEY`: the auth key or OAuth client secret that enrolls the container (OAuth secrets create ephemeral nodes by default). Pair with a tagged, ephemeral credential for disposable workloads.
- `TS_STATE_DIR`: where tailscaled stores state, conventionally `/var/lib/tailscale`, and the single most important variable in the file. Mount a volume there. Without it, every container recreation is a brand new node: new IP, new name, stale duplicates piling up in the admin console.
- `TS_HOSTNAME`: tailnet name for the node (otherwise you get the container's generated hostname).
- `TS_USERSPACE`: defaults to `true`. Userspace networking needs no kernel privileges at all, which is why it is the default: it runs anywhere, including restricted platforms. Set it to `false` for kernel TUN mode, which requires `/dev/net/tun` and added capabilities (`NET_ADMIN`, with `NET_RAW` also granted in Tailscale's compose examples), and is required for acting as a subnet router or exit node in kernel mode.
- `TS_ROUTES`: advertise subnet routes (Module 07) from inside the container.
- `TS_DEST_IP`, `TS_TAILNET_TARGET_IP`, `TS_TAILNET_TARGET_FQDN`: forwarding and egress-proxy behaviors; the tailnet-target pair is documented as incompatible with userspace mode.
- `TS_SERVE_CONFIG`: path to a JSON file declaring Serve and Funnel configuration (Module 08), so a container can publish services with no exec-into-container step. Mount the containing directory if you want config updates picked up.
- `TS_EXTRA_ARGS` and `TS_TAILSCALED_EXTRA_ARGS`: escape hatches passing flags to `tailscale up` and `tailscaled` respectively.
- `TS_ENABLE_HEALTH_CHECK` and `TS_ENABLE_METRICS` (both default `false`, both require Tailscale 1.78 or later, served at `TS_LOCAL_ADDR_PORT`, default `[::]:9002`): expose `/healthz` and `/metrics` for orchestration and monitoring.
- `TS_AUTH_ONCE` (default `false`): at `false` the container forces a login attempt on every start; at `true` it logs in only if not already authenticated, the right setting alongside persisted state.
- `TS_EXPERIMENTAL_SERVICE_AUTO_ADVERTISEMENT` (1.96 or later, default `true`): auto-advertises Tailscale Services on startup. The Services feature itself is GA, but this knob is still labeled experimental, so verify current behavior before relying on it (checked 2026-08-10).

The sidecar pattern is the idiomatic composition: run `tailscale/tailscale` as one container, and attach your application to it, either with compose's `network_mode: "service:tailscale"` so the app shares the Tailscale container's network namespace, or at minimum `depends_on` ordering as in Tailscale's quick-start compose. In the shared-namespace form, the app binds to localhost and the tailnet sees one node whose ports are the app's ports. Your application image stays completely unmodified.

Analogy: the sidecar is a translator sitting in the same booth as a speaker. The speaker (your app) talks plain HTTP to the room (the shared namespace); the translator (Tailscale) is the only one wired to the outside world, and everything in or out passes through it.

Failure modes: the classic three. No state volume, so every deploy mints a duplicate node. Userspace mode combined with a feature that needs kernel routing (tailnet-target egress, kernel-mode subnet routing), which fails because the two are incompatible. And a reusable auth key that expired, so the container restarts into an authentication loop; logs show the login URL prompt that nobody is watching.

> [!GOTCHA] `TS_USERSPACE=true` is the default. Userspace mode works everywhere but does not create a TUN device, so anything that assumes kernel routing, including `TS_TAILNET_TARGET_IP` egress, will not work. Flip to kernel mode deliberately: `TS_USERSPACE=false`, device `/dev/net/tun`, and `NET_ADMIN` capability, and expect a fast failure in the logs if one of the three is missing.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Docker sidecar topology: app container sharing the network namespace of a Tailscale container that connects to the tailnet">
  <title>Sidecar pattern in Docker</title>
  <rect x="20" y="30" width="420" height="240" rx="12" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-dasharray="6 4"/>
  <text x="230" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="12">shared network namespace (network_mode: service:tailscale)</text>
  <rect x="50" y="80" width="160" height="90" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="130" y="110" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">app container</text>
  <text x="130" y="130" text-anchor="middle" fill="var(--diagram-text)" font-size="11">binds 127.0.0.1:8080</text>
  <text x="130" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="11">unmodified image</text>
  <rect x="250" y="80" width="160" height="130" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="330" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">tailscale/tailscale</text>
  <text x="330" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_AUTHKEY (ephemeral)</text>
  <text x="330" y="143" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_STATE_DIR + volume</text>
  <text x="330" y="161" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_SERVE_CONFIG</text>
  <text x="330" y="179" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_USERSPACE default true</text>
  <line x1="210" y1="125" x2="250" y2="125" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="230" y="118" text-anchor="middle" fill="var(--diagram-text)" font-size="10">localhost</text>
  <rect x="250" y="225" width="160" height="35" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="330" y="247" text-anchor="middle" fill="var(--diagram-text)" font-size="11">volume: /var/lib/tailscale</text>
  <line x1="330" y1="210" x2="330" y2="225" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="540" y="90" width="180" height="110" rx="12" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="630" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">tailnet</text>
  <text x="630" y="148" text-anchor="middle" fill="var(--diagram-text)" font-size="11">sees ONE node</text>
  <text x="630" y="166" text-anchor="middle" fill="var(--diagram-text)" font-size="11">app port = node port</text>
  <line x1="410" y1="145" x2="540" y2="145" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="475" y="135" text-anchor="middle" fill="var(--diagram-text)" font-size="10">WireGuard</text>
</svg>
</div>

### Kubernetes: the operator builds proxies for you

The Kubernetes operator moves from "run a Tailscale container" to "declare intent and let a controller run the containers." You install it with Helm from `https://pkgs.tailscale.com/helmcharts`:

```
helm upgrade --install tailscale-operator tailscale/tailscale-operator \
  --namespace=tailscale --create-namespace \
  --set-string oauth.clientId="<ID>" \
  --set-string oauth.clientSecret="<secret>" --wait
```

The credentials are an OAuth client (created in the admin console) with write scope on Devices Core, Keys Auth Keys, and Services, tagged `tag:k8s-operator`. Your ACL policy declares `tag:k8s-operator` as an owner of `tag:k8s`, so the operator can mint auth keys and manage the proxy devices it creates, which default to `tag:k8s`. This is Module 04's tag-ownership model doing real work: the operator is a machine identity that manufactures other machine identities, with the blast radius fenced by tags.

What it does with that power:

- **Ingress proxies**: annotate a Service (or use `loadBalancerClass: tailscale`, or a Kubernetes Ingress with the tailscale ingress class) and the operator creates a proxy pod, a StatefulSet running the same engine, that publishes that workload to your tailnet as a node. Tailnet devices reach the Service; nothing is opened to the internet.
- **Egress proxies**: expose a tailnet node inside the cluster as a regular Kubernetes Service, so in-cluster workloads reach tailnet resources by cluster-native DNS names.
- **Connector**: an operator-managed subnet router or exit node, replacing the hand-run `--advertise-routes` container with a declarative custom resource.
- **API server proxy**: kubectl over the tailnet, with Tailscale identity mapped into Kubernetes RBAC, no public control plane endpoint.
- **ProxyClass**: a CRD that customizes the pods the operator creates (resources, labels, tolerations, and other pod-level knobs), because operator-created pods are not hand-editable; you customize the template, not the instance.
- **ProxyGroup**: replicated proxies for scale-out and availability rather than a single proxy pod.

A default install creates the ProxyClass, Connector, ProxyGroup, DNSConfig, Recorder, and Tailnet CRDs (list as of 2026-08-10; the CRD surface has grown over the 2025 to 2026 releases, so expect additions).

Analogy: the raw Docker pattern is arranging every courier yourself; the operator is a dispatch service. You post a work order (an annotation or CR), dispatch sends out a courier (proxy pod), badges it (auth key with `tag:k8s`), and replaces it when it quits (reconciliation).

Failure mode: ACL drift. If the tag ownership stanza is missing or wrong, the operator cannot create or manage proxies; you see proxy pods crash-looping on authentication or resources stuck without a tailnet IP, and the root cause is in the policy file (Module 05), not the cluster.

> [!ON-THE-WIRE] Each operator-created proxy is a full tailnet node: it shows up in `tailscale status` output on your other machines, gets a MagicDNS name, does its own NAT traversal, and is subject to ACLs like any laptop. There is no special "Kubernetes mode" in the protocol. The operator's entire job is manufacturing ordinary nodes fast and consistently.

### NAS and appliances: Synology and friends

Appliance platforms run the same Linux engine inside someone else's packaging rules. Synology is the canonical example: install from Package Center (easiest, though the package there lags roughly quarterly, so schedule automatic updates or install Tailscale's own package manually). On DSM6 Tailscale runs as root with full permissions. DSM7 tightened the sandbox: by default only inbound connections work, and outbound access to the tailnet from the NAS requires the documented fix, a boot-triggered scheduled task running `tailscale configure-host` followed by a package restart, re-run (or reboot) after each package upgrade. Upgrading DSM6 to DSM7 requires uninstalling and reinstalling the Tailscale app.

Constraints to remember: a Synology node can advertise subnet routes but cannot accept routes from other subnet routers, its hybrid networking means subnet destinations work over UDP and TCP but do not reliably answer ping, and Tailscale SSH does not run on Synology (use DSM's own SSH). If the Synology firewall is on, allow `100.64.0.0/10`.

The general appliance lesson: the vendor's sandbox, update cadence, and init system are now part of your debugging surface. Other NAS and firewall platforms each have their own equivalents of the DSM7 TUN dance. When an appliance misbehaves, check the platform KB page before assuming an engine bug.

## On the wire

The engine's sameness shows up in tooling: `tailscale status` output reads identically everywhere, and only the OS column of your mental model changes.

A healthy headless Linux node:

```
$ sudo systemctl status tailscaled --no-pager
● tailscaled.service
     Loaded: loaded (/lib/systemd/system/tailscaled.service; enabled)
     Active: active (running) since Mon 2026-08-10 09:14:02 EDT
   Main PID: 812 (tailscaled)

$ tailscale status
100.101.1.4   lab-vm-1      admin@      linux   offline
100.101.1.7   node-a        admin@      macOS   active; direct 203.0.113.7:41641
100.101.1.9   cloud-1       tag:k8s     linux   idle; relay "ord"
```

The daemon-to-CLI split, observed from the failure side:

```
$ tailscale status
failed to connect to local tailscaled; is it running?
```

That message means the socket, not the network. On Linux, check systemd. On macOS, first ask which variant: with the App Store or Standalone app the engine lives in an Apple extension, so the equivalent check is the GUI's state, and the CLI lives inside the app bundle at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (alias it once, per the CLI docs, and use `TAILSCALE_BE_CLI=1` in scripts).

A Docker sidecar coming up in userspace mode:

```
$ docker logs ts-sidecar 2>&1 | head -4
boot: tailscaled: starting in userspace-networking mode
boot: state dir /var/lib/tailscale
boot: authenticating with TS_AUTHKEY
health(overall=true)
```

And the same container failing kernel mode, the fingerprint of a missing device or capability:

```
$ docker logs ts-sidecar 2>&1 | tail -2
wgengine.NewUserspaceEngine(tun "tailscale0") error: tstun.New("tailscale0"):
  CreateTUN("tailscale0") failed; /dev/net/tun does not exist
```

Operator-side, intent and manufactured result:

```
$ kubectl get pods -n tailscale
NAME                                     READY   STATUS    RESTARTS
operator-7c6bd5b9c4-x2m8p                1/1     Running   0
ts-web-frontend-abc12-0                  1/1     Running   0

$ kubectl annotate service web-frontend tailscale.com/expose=true
$ tailscale status | grep web
100.101.1.22  web-frontend   tag:k8s   linux   idle
```

The proxy pod is a StatefulSet pod; the tailnet just sees a new Linux node.

## Failure modes

1. **Firewall manager fights netfilter.** Symptom: a Linux node's tailnet traffic dies after a config management run or firewalld reload, and recovers on `systemctl restart tailscaled`. Cause: Tailscale's rules were flushed. Fix: `--netfilter-mode=nodivert` and wire the chains into your managed ruleset, or exempt Tailscale's chains from flushes.
2. **Container without a state volume.** Symptom: the admin console fills with duplicate nodes named `hostname-1`, `hostname-2`, each deploy a new machine with a new IP. Cause: no volume mounted at `TS_STATE_DIR`, so node identity dies with each container. Fix: persist the state dir (and set `TS_AUTH_ONCE=true` so restarts reuse it), or lean in with ephemeral keys for genuinely disposable workloads.
3. **Userspace mode asked to do kernel work.** Symptom: a container egress proxy (`TS_TAILNET_TARGET_IP`) or kernel-mode subnet router silently fails or errors at startup. Cause: `TS_USERSPACE` defaults to `true` and those features are incompatible with it. Fix: `TS_USERSPACE=false`, `/dev/net/tun`, `NET_ADMIN`.
4. **Two macOS variants installed.** Symptom: VPN state flaps, settings do not stick, connectivity toggles seemingly at random. Cause: two variants contending for the VPN configuration. Fix: remove all but one, preferably Standalone.
5. **Wrong-variant debugging on macOS.** Symptom: "tailscaled is not running" panic, or Tailscale SSH mysteriously unsupported. Cause: GUI variants have no tailscaled process, and neither GUI variant runs the Tailscale SSH server (on macOS only the open source tailscaled does); the Screen Time web filter can conflict with the App Store variant specifically. Fix: identify the variant first, then apply that variant's rules.
6. **Windows node vanishes on logout.** Symptom: a remote-access target is reachable only while someone is logged in, and disappears after patch-Tuesday reboots. Cause: default per-user operation. Fix: `tailscale up --unattended=true`.
7. **Mobile node evicted.** Symptom: a phone drops off the tailnet with no error. Cause: another VPN app took the single VPN slot, or the OS restricted the extension in the background; heavy keepalive on poor cellular also drains battery and invites the user to force-quit. Fix: one VPN app, relax battery optimization, and do not architect around phones as infrastructure.
8. **Synology DSM7 sandbox blocks outbound.** Symptom: inbound to the NAS works but outbound tailnet connections fail after install or after a package upgrade. Cause: DSM7's sandbox and the not-yet-run `tailscale configure-host` boot task. Fix: the documented scheduled task, re-run after upgrades.
9. **Operator proxies crash-loop on auth.** Symptom: proxy pods restart endlessly; annotated Services never get a tailnet IP. Cause: OAuth client scopes or the `tag:k8s-operator` owns `tag:k8s` ACL stanza are wrong, so the operator cannot mint keys for its proxies. Fix: repair the policy file and the OAuth client scopes.
10. **Expired auth key in automation.** Symptom: fresh containers and VMs stop joining the tailnet while existing nodes are fine. Cause: auth keys expire in 1 to 90 days; enrollment fails but enrolled node keys are untouched. Fix: rotate keys via vault or OAuth-based key generation, and alarm on enrollment failures, not just node health.

## Check yourself

1. A teammate reports that "Tailscale is broken on the new Mac": `tailscale` is not found in the shell, and `ps` shows no tailscaled process, yet the machine appears online in the admin console. What happened, and what do you check?

Answer: The machine is almost certainly running one of the GUI variants. GUI variants host the engine inside an Apple extension process (a system extension for Standalone, a network extension for the App Store build), so the absence of a tailscaled process is normal and the admin console is telling the truth: the node is up. The missing CLI is a packaging detail. For both GUI variants the CLI is bundled at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, and the CLI docs recommend adding a shell alias to that path; in scripts, `TAILSCALE_BE_CLI=1` forces the binary into CLI mode, since it otherwise decides between GUI and CLI at launch based on environment variables. Identify the variant, use the right CLI path, and while you are there confirm only one variant is installed, because two at once produce real breakage rather than this cosmetic confusion.

2. You deploy a compose stack with a `tailscale/tailscale` sidecar to act as an egress proxy toward a tailnet database node using `TS_TAILNET_TARGET_IP`, and it does not pass traffic. The container authenticated fine and shows up in the tailnet. What is the most likely cause and the complete fix?

Answer: The container is running in userspace networking mode, which is the image default (`TS_USERSPACE=true`), and the tailnet-target egress feature is documented as incompatible with userspace mode because it requires kernel routing through a real TUN device. Authentication and tailnet presence succeed regardless, which is why the node looks healthy while doing nothing useful. The fix has three parts that must all be present: set `TS_USERSPACE=false`, pass the device `/dev/net/tun` into the container, and grant `NET_ADMIN` capability (Tailscale's compose examples also grant `NET_RAW`). Also confirm a volume is mounted at `TS_STATE_DIR` so the proxy keeps one stable identity, since an egress proxy that changes tailnet identity on every deploy will fight your ACLs.

3. Your Kubernetes operator install succeeds, but every Service you annotate with `tailscale.com/expose` produces a proxy pod that crash-loops and never appears in the tailnet. The operator pod itself is Running. Where do you look, and why there first?

Answer: Look at the tailnet policy file and the OAuth client, not the cluster. The operator's job on exposure is to mint an auth key and enroll a proxy device tagged `tag:k8s`. That only works if the OAuth client has write scope on Devices Core, Keys Auth Keys, and Services, and if the ACL declares `tag:k8s-operator` as an owner of `tag:k8s`. If either is missing, the operator itself runs fine (it authenticated at install time) but every device it tries to manufacture fails authentication, which presents exactly as healthy operator plus crash-looping proxies. Check the proxy pod logs for auth errors, verify the tagOwners stanza, and verify the OAuth client scopes and tag. Only after those pass is it worth suspecting cluster-side issues, and ProxyClass is the right lever if the eventual fix requires pod-level customization, because operator-managed pods must be customized through the template rather than edited directly.

## What you now have

1. A two-layer mental model: one identical engine (daemon plus CLI over a local socket), many OS-specific mounting layers, and the habit of asking "engine or hull?" first.
2. The Linux reference deployment: systemd unit, `/var/lib/tailscale` state, TUN or userspace, three netfilter modes, and headless enrollment with the right flavor of auth key.
3. The macOS three-variant map (including which single variant runs the Tailscale SSH server) and the debugging discipline of identifying the variant before touching anything.
4. The Windows per-user default and the unattended-mode fix; the mobile single-VPN-slot and battery constraints that make phones clients, not infrastructure.
5. Container fluency: TS_ variables, the state volume rule, userspace versus kernel mode, serve config, and the sidecar pattern.
6. The Kubernetes operator model: OAuth plus tag ownership manufacturing ordinary tailnet nodes as ingress and egress proxies, Connectors, ProxyClass templates, and the API server proxy.
7. The appliance lesson from Synology: vendor sandboxes and update lag are part of the system you are debugging.

## Cross references

- Module 01, WireGuard foundations: the data plane that is byte-identical on every platform in this matrix.
- Module 02, The control plane: what every client, regardless of hull, is talking to when it authenticates and fetches its netmap.
- Module 03, NAT traversal, STUN, DERP, and Peer Relays: why mobile keepalives cost battery and why container nodes traverse NAT like any laptop.
- Module 04, Identity and auth: auth keys, node keys, tags, and OAuth clients, the machinery this module applies per platform.
- Module 05, Policy: ACLs and grants: tag ownership, the thing that breaks when operator proxies crash-loop.
- Module 06, MagicDNS and split DNS: the DNS layer each OS installs differently.
- Module 07, Routing: subnet routers and exit nodes, which this module deploys via TS_ROUTES, Connectors, and appliance caveats.
- Module 08, Exposing services: Serve and Funnel, driven in containers by TS_SERVE_CONFIG and in clusters by operator ingress.
- Module 11, Troubleshooting and observability: the systematic version of the per-platform diagnostic instincts built here.
- Module 12, The codebase: where the single engine and its per-OS shims actually live in the source tree.
