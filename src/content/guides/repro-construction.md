---
slug: repro-construction
title: Reproduction construction
description: How to turn a vague field report into a minimal, runnable reproduction using containers, iptables, and tc, with state discipline that keeps every run clean.
track: fieldcraft
order: 2
words: 3200
sources:
  - id: kb-docker
    url: https://tailscale.com/docs/features/containers/docker
    title: Docker
    checked: 2026-08-10
  - id: kb-docker-params
    url: https://tailscale.com/docs/features/containers/docker/docker-params
    title: Docker configuration parameters
    checked: 2026-08-10
  - id: kb-firewall-ports
    url: https://tailscale.com/docs/reference/faq/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-10
  - id: kb-connect-failure
    url: https://tailscale.com/docs/reference/troubleshooting/connectivity/connect-device-failure
    title: Can't connect to other tailnet devices
    checked: 2026-08-10
  - id: kb-poor-performance
    url: https://tailscale.com/docs/reference/troubleshooting/poor-performance-tailnet
    title: Poor performance between tailnet devices
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: kb-ephemeral
    url: https://tailscale.com/docs/features/ephemeral-nodes
    title: Ephemeral nodes
    checked: 2026-08-10
  - id: blog-nat
    url: https://tailscale.com/blog/how-nat-traversal-works
    title: How NAT traversal works
    checked: 2026-08-10
---

## A repro is not a demonstration

"It happens sometimes at the Customer site" is the starting condition of most hard field problems. The site has a firewall you cannot see, a NAT device nobody documented, a security agent someone installed in 2019, and a failure that shows up on Tuesdays. You will not debug that in place. You will debug a reproduction of it, on hardware you control, and the quality of that reproduction decides whether the bug gets fixed in a day or argued about for a month.

Before building anything, be clear about what you are building. A demonstration shows the symptom. A reproduction isolates the trigger. The difference is falsifiability.

A demonstration is "here is a video of the transfer stalling." Useful as evidence that the problem exists, useless for finding it, because nothing in a demonstration can be varied. A reproduction is an environment where you can remove one element at a time and watch whether the symptom survives. If you delete the packet loss rule and the stall disappears, loss is part of the trigger. If you delete it and the stall remains, you have just eliminated a variable, which is equally valuable. A repro is an experiment apparatus. A demo is a photograph.

The practical test: hand your artifact to someone else and ask "what happens if you change X?" If the honest answer is "you would have to go back to the Customer site," you have a demo. If the answer is "edit line 12 and rerun," you have a repro.

This module builds the apparatus: minimizing the variable space, simulating the Customer's topology with containers, forcing specific network paths, faking their NAT, injecting their latency and loss, keeping runs hermetic, and packaging the whole thing so an engineer who has never heard of the ticket can run it in five minutes.

## Shrink the variable space before touching a terminal

The instinct is to start building immediately. Resist it. A repro of an unminimized problem reproduces the confusion along with the bug. Every variable you eliminate before building is ten you do not have to eliminate after, because variables in a built environment interact.

Interrogate the field data along three axes, in order.

**Which side?** A tailnet problem always has at least two nodes and a control plane. Does the symptom follow node-a wherever it goes, or does it only occur when node-b is the peer, or only at this site regardless of which nodes are involved? The cheapest experiments in the field answer exactly this: move one laptop to a phone hotspot and retest. If the symptom follows the node, you are reproducing a node condition (version, config, platform). If it stays with the site, you are reproducing a network condition (NAT, firewall, middlebox). These need completely different labs.

**Which path?** Tailscale traffic between two peers is either direct over UDP or relayed, and `tailscale ping` tells you which, printing the latency and the path the pong took (kb-cli, kb-poor-performance). A bug that only occurs on relayed connections is a different bug from one that occurs on direct connections, and both are different from a bug in the transition between them. Get the Customer to run `tailscale ping <peer>` and `tailscale netcheck` while the symptom is live. Those two outputs, captured at the right moment, are worth more than an hour of screen sharing.

**Which feature?** Strip the feature stack in your head before you strip it in the lab. Does the symptom involve MagicDNS, subnet routing, an exit node, Tailscale SSH, serve or funnel? Each of those rides on the base connectivity layer. If the Customer reports "SSH over Tailscale hangs," the first minimization question is whether a plain TCP connection between the same two nodes also hangs. If it does, SSH is scenery, not trigger, and your repro should not contain it.

<div class="diagram-wrap">
<svg viewBox="0 0 760 420" role="img" aria-label="Decision flow for minimizing a field report into a repro target">
  <title>Minimization decision flow: which side, which path, which feature</title>
  <rect x="280" y="10" width="200" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="37" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Field report (vague)</text>
  <line x1="380" y1="54" x2="380" y2="84" stroke="var(--diagram-line)"/>
  <rect x="255" y="84" width="250" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="111" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Which side? (move a node, retest)</text>
  <line x1="380" y1="128" x2="180" y2="168" stroke="var(--diagram-line)"/>
  <line x1="380" y1="128" x2="580" y2="168" stroke="var(--diagram-line)"/>
  <rect x="70" y="168" width="220" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="180" y="188" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Follows the node:</text>
  <text x="180" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="13">repro = node condition</text>
  <rect x="470" y="168" width="220" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="580" y="188" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Stays with the site:</text>
  <text x="580" y="204" text-anchor="middle" fill="var(--diagram-text)" font-size="13">repro = network condition</text>
  <line x1="180" y1="212" x2="380" y2="252" stroke="var(--diagram-line)"/>
  <line x1="580" y1="212" x2="380" y2="252" stroke="var(--diagram-line)"/>
  <rect x="230" y="252" width="300" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Which path? (tailscale ping, netcheck)</text>
  <text x="380" y="288" text-anchor="middle" fill="var(--diagram-text)" font-size="13">direct UDP vs DERP vs the transition</text>
  <line x1="380" y1="296" x2="380" y2="326" stroke="var(--diagram-line)"/>
  <rect x="230" y="326" width="300" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="346" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Which feature? (strip until the symptom</text>
  <text x="380" y="362" text-anchor="middle" fill="var(--diagram-text)" font-size="13">lives at the lowest layer that shows it)</text>
  <line x1="380" y1="370" x2="380" y2="396" stroke="var(--diagram-line)"/>
  <text x="380" y="412" text-anchor="middle" fill="var(--diagram-accent)" font-size="14">Minimal repro target</text>
</svg>
</div>

The output of this stage is one sentence: "Two nodes, one behind a NAT that varies its mapping per destination, relayed connection, plain TCP transfer stalls after roughly 30 seconds when loss exceeds 2 percent." That sentence is a build specification. "Transfers are flaky at the Customer site" is not.

## Build the lab: two containers as two sites

You do not need two physical sites to reproduce a two-site problem. You need two network namespaces, and every Docker container gets its own by default. Two containers on one Linux host are, from Tailscale's point of view, two machines: separate interfaces, separate routing tables, separate iptables state, separate tailscaled instances. That isolation is the entire trick, and it is why containers beat two terminal windows on the same host, where both tailscaled instances would share one namespace and one NAT experience.

Tailscale publishes an official container image and configures it through environment variables (kb-docker, kb-docker-params). The ones that matter for repro work:

- `TS_AUTHKEY` authenticates the container to your tailnet, equivalent to `tailscale login --auth-key=` (kb-docker-params).
- `TS_STATE_DIR` sets where tailscaled stores its state. Without persistent state, each container restart creates a brand new node in the admin console (kb-docker-params). For repro work this is usually what you want, and the state discipline section below explains why.
- `TS_USERSPACE` selects userspace networking, and it is enabled by default in the container image. Userspace mode works everywhere but has lower performance; set `TS_USERSPACE=false` for kernel networking, which requires access to `/dev/net/tun` and additional capabilities (kb-docker-params).
- `TS_EXTRA_ARGS` passes additional flags to `tailscale up`, and `TS_TAILSCALED_EXTRA_ARGS` passes flags to tailscaled itself, such as `--verbose=2` for debug logging (kb-docker-params).

A minimal two-site lab as a compose file:

```yaml
services:
  node-a:
    image: tailscale/tailscale:latest
    hostname: node-a
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY_A}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    volumes:
      - ./state/node-a:/var/lib/tailscale
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
  node-b:
    image: tailscale/tailscale:latest
    hostname: node-b
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY_B}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    volumes:
      - ./state/node-b:/var/lib/tailscale
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
```

> [!GOTCHA]
> Decide the userspace question deliberately, not by default. The container image defaults to `TS_USERSPACE=true` (kb-docker-params), but the Customer's Linux servers almost certainly run kernel networking with a TUN device. Userspace and kernel modes move packets through genuinely different code paths, so a repro built in the wrong mode can fail to reproduce a real bug, or reproduce a bug the Customer can never hit. Match the Customer's mode first; only flip it later as a controlled experiment, because a symptom that appears in exactly one mode is itself a strong localization signal.

Pin the image version to whatever the Customer runs. `tailscale/tailscale:latest` is fine for a scratch experiment and wrong for a repro, because a repro that silently upgrades under you is not the same experiment twice. Put the exact tag in the compose file and note the Customer's version in the README.

For problems that need more than two nodes (a subnet router plus a client plus a target, say), the pattern scales: one container per role, one compose file per topology. Full VMs still have a place when the bug involves a kernel version, a specific distro's firewall defaults, or a non-Linux platform, but reach for them second. Containers rebuild in seconds; VMs rebuild in minutes, and repro construction is an iteration game.

## Force the path: pinning traffic to DERP

Field report says the connection is relayed. Your lab, sitting on one host with no NAT between the containers, will happily go direct and reproduce nothing. You need to force the path the Customer is actually on.

Tailscale prefers a direct WireGuard connection over UDP, with 41641 as the default source port and STUN to UDP 3478 for discovering the public mapping (kb-firewall-ports). When no direct connection can be established, traffic falls back to DERP relays, which are reachable over HTTPS on TCP 443, so connectivity survives even on networks that block all UDP (kb-firewall-ports). That fallback is the lever: block UDP, and you have deterministically forced the relay path.

Inside node-a:

```bash
iptables -I OUTPUT -p udp -j DROP
```

One rule, total UDP blackout for that namespace: no direct WireGuard, no STUN. Tailscale's only remaining option is DERP over TCP 443, exactly as documented (kb-firewall-ports). Verify before trusting it:

```bash
tailscale ping node-b
# pong from node-b (100.x.y.z) via DERP(nyc) in 48ms
```

The phrase "via DERP" in ping output is the confirmation that traffic is relayed; a relayed pong includes the DERP server's city code, such as nyc or fra (kb-cli). One 2025 change to keep in view: current clients distinguish three connection paths, direct, relay, and peer-relay (kb-cli, checked 2026-08-10). If the Customer's tailnet uses Peer Relays and their captures say peer-relay, a forced-DERP lab is modeling the wrong path; make your lab's ping output match theirs, not just "not direct."

> [!ON-THE-WIRE]
> Run `tailscale ping` several times in a row and watch the path, not just the latency. Connections start out relayed and transition to a direct connection when one is possible (kb-poor-performance), so on an unrestricted network the first pong often arrives via DERP and later pongs switch to direct as the connection upgrades. That upgrade moment is itself a place bugs hide: a symptom that appears only in the first seconds of a connection and then vanishes is pointing you at the transition, not at either steady state. A repro for that class of bug must restart the connection every iteration, because a warm connection has already left the crime scene.

Blocking all UDP is the bluntest instrument. Two finer settings you will need:

- **Block only STUN**: `iptables -I OUTPUT -p udp --dport 3478 -j DROP`. The node can send UDP but cannot learn its public mapping. This models networks that permit UDP generally but filter STUN specifically, and it exercises different fallback behavior than a full UDP blackout.
- **Asymmetric blocking**: apply the rule in node-a only. Now one side of the pair has full connectivity and the other is crippled, which is the honest model of most real incidents. When a pair only ever relays, the limitation may sit on either device, and which one matters (kb-poor-performance). An asymmetric lab lets you establish which side's condition is load-bearing by moving the rule.

Remove rules with `iptables -D` and rerun. The repro should flip between "reproduces" and "does not reproduce" with a single rule change. When it does, you have isolated a trigger.

## Reproduce the Customer's NAT

Blocked UDP is the easy case. The expensive cases are NAT behavior bugs, where UDP flows fine but the NAT's mapping behavior defeats or degrades traversal. Tailscale's own docs draw the distinction: STUN probing classifies a network as easy NAT, where the source port maps to the same external port for all destinations, or hard NAT, where the port varies per destination (kb-firewall-ports). Endpoint-dependent mapping is what makes a NAT hard: the address node-b learns for node-a is not the mapping node-a will use when talking to node-b, so the candidates exchanged during traversal are wrong on arrival (blog-nat).

You can build a hard NAT on a stock Linux box with one iptables flag. Put a container behind a NAT namespace and masquerade with randomized ports:

```bash
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE --random
```

`MASQUERADE` rewrites the source address as usual; `--random` randomizes source port selection per connection rather than preserving ports predictably. From the outside, the mapping now varies by destination, which is precisely the endpoint-dependent behavior that STUN-based traversal struggles against. (`--random-fully` extends the randomization; the flags themselves are standard Linux netfilter, not Tailscale behavior.) In practice this means the lab needs three namespaces for one hard-NATed site: the node, the NAT router doing the masquerade, and the outside world, with the node's default route pointing through the router.

Verify the simulation from inside the node before blaming Tailscale for anything:

```bash
tailscale netcheck
```

`netcheck` reports the local network's conditions: whether UDP works, whether port mapping protocols are available, and latency to nearby DERP servers (kb-poor-performance). The field to watch here is `MappingVariesByDestIP`, which reports whether the device sits behind a difficult NAT whose mapping varies by destination (kb-cli). If your masquerade rule is doing its job, that field flips to true, and your lab classifies the same way the Customer's network does. That comparison is the whole point. Get the Customer's netcheck output, get your lab's netcheck output, and do not proceed until the relevant fields agree. A NAT repro whose netcheck disagrees with the Customer's is a model of some other network.

> [!HOW-IT-WORKS]
> Why does one iptables flag change Tailscale's fate? NAT traversal works by both sides learning their public ip:port mapping via STUN and exchanging those candidates through a side channel (kb-firewall-ports, blog-nat). With an endpoint-independent mapping, the port STUN observed is the port the peer can reach. With `--random` masquerading, the mapping STUN observed was allocated for the flow to the STUN server, and the flow to the peer gets a different one, so the exchanged candidate is stale on arrival. Two easy NATs traverse reliably; one hard NAT in the path is a speedbump that extra tricks usually clear; hard plus hard has a vanishingly small chance of going direct and lands on the relay (blog-nat walks the probabilities). Your lab can dial through all three regimes by toggling `--random` on either router, which turns "NAT weirdness" from an anecdote into an independent variable.

<div class="diagram-wrap">
<svg viewBox="0 0 800 340" role="img" aria-label="Lab topology: two containers behind simulated NATs with a forced DERP path">
  <title>Two-container lab with NAT simulation and forced DERP relay path</title>
  <rect x="320" y="20" width="160" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="400" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="13">DERP relay</text>
  <text x="400" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="12">TCP 443</text>
  <rect x="40" y="230" width="180" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="130" y="255" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a container</text>
  <text x="130" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="12">own netns, tailscaled</text>
  <text x="130" y="288" text-anchor="middle" fill="var(--diagram-text)" font-size="12">state/node-a</text>
  <rect x="580" y="230" width="180" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="670" y="255" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-b container</text>
  <text x="670" y="272" text-anchor="middle" fill="var(--diagram-text)" font-size="12">own netns, tailscaled</text>
  <text x="670" y="288" text-anchor="middle" fill="var(--diagram-text)" font-size="12">state/node-b</text>
  <rect x="90" y="140" width="120" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="150" y="159" text-anchor="middle" fill="var(--diagram-text)" font-size="12">NAT router ns</text>
  <text x="150" y="176" text-anchor="middle" fill="var(--diagram-text)" font-size="11">MASQUERADE --random</text>
  <rect x="590" y="140" width="120" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="650" y="159" text-anchor="middle" fill="var(--diagram-text)" font-size="12">NAT router ns</text>
  <text x="650" y="176" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tc netem loss 2%</text>
  <line x1="130" y1="230" x2="150" y2="186" stroke="var(--diagram-line)"/>
  <line x1="670" y1="230" x2="650" y2="186" stroke="var(--diagram-line)"/>
  <line x1="150" y1="140" x2="360" y2="70" stroke="var(--diagram-accent)"/>
  <line x1="650" y1="140" x2="440" y2="70" stroke="var(--diagram-accent)"/>
  <text x="400" y="100" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">relayed path (forced)</text>
  <line x1="230" y1="265" x2="570" y2="265" stroke="var(--diagram-line)" stroke-dasharray="6 5"/>
  <text x="400" y="256" text-anchor="middle" fill="var(--diagram-text)" font-size="12">direct UDP path: blocked by iptables</text>
  <text x="400" y="290" text-anchor="middle" fill="var(--diagram-text)" font-size="20">&#10005;</text>
  <text x="400" y="325" text-anchor="middle" fill="var(--diagram-text)" font-size="12">one Linux host, every box a separate network namespace</text>
</svg>
</div>

## Inject the Customer's physics: tc netem

Some bugs are not about whether packets arrive but about when. Timeouts that fire early, retransmission storms, transfers that stall only when latency crosses a threshold, races that need a slow link to lose. Your lab's containers talk to each other in microseconds, which means the timing conditions of the Customer's transatlantic relayed path simply do not exist in your lab until you install them.

`tc` with the `netem` queueing discipline is standard Linux kernel tooling for exactly this. Applied inside a namespace, it shapes only that namespace's traffic:

```bash
# 80ms each way with 10ms jitter
tc qdisc add dev eth0 root netem delay 80ms 10ms

# 2 percent packet loss on top
tc qdisc change dev eth0 root netem delay 80ms 10ms loss 2%

# reordering, for the truly cursed bugs
tc qdisc change dev eth0 root netem delay 80ms 10ms reorder 25% 50%
```

Three rules for using it honestly. First, get real numbers: the Customer's `tailscale ping` output gives you actual observed latency to calibrate against (kb-poor-performance notes ping reports latency in milliseconds and the DERP servers used); do not invent round numbers. Second, apply impairment on the router namespace rather than the node when you can, because that is where the real world degrades traffic, and it leaves the node's own stack unmodified. Third, sweep, do not spot-check: a timing bug that appears at 2 percent loss and not at 1 percent has a threshold, and the threshold is diagnostic information. A repro script that takes the loss rate as a parameter turns the sweep into a for loop.

`netem` is also how "sometimes on Tuesdays" becomes deterministic. Intermittent field failures are usually deterministic failures whose trigger condition is intermittent. Once the trigger is latency plus loss rather than the day of the week, the repro fires every run.

## State reset discipline

The silent killer of repro credibility is state contamination: run three fails, run four passes, and the difference is not your variable, it is that tailscaled remembered something from run three. A tailscaled state directory holds the node's identity and configuration; carrying it between runs means every run after the first starts from a different initial condition than the first. Your experiment is no longer controlled.

The container docs are explicit about the mechanism: `TS_STATE_DIR` determines where state lives, and without a persisted state directory each restart creates a new node in the admin console (kb-docker-params). Production documentation treats that as a problem to avoid. Repro work inverts it: a fresh node per run is exactly the hermetic starting condition you want. The discipline:

```bash
docker compose down
sudo rm -rf ./state/node-a ./state/node-b
docker compose up -d
```

Every run: same image, same config, empty state, new node. Boring, reproducible, correct.

Two supporting mechanisms from the docs. `TS_AUTH_ONCE` defaults to false, meaning the container forces a login on every restart; setting it true logs in only when not already authenticated (kb-docker-params). For repros, leave it false so a restart never silently reuses stale credentials. And use ephemeral node credentials so wipes do not litter the admin console: ephemeral nodes are automatically removed from the tailnet shortly after disconnecting, OAuth client secrets create ephemeral nodes by default, and auth keys can be generated as ephemeral in the admin console (kb-docker-params, kb-ephemeral).

> [!GOTCHA]
> The state directory is not the only state. The container's iptables rules, its qdiscs, conntrack entries in the NAT namespace, and the tailnet-side node list all persist independently of `TS_STATE_DIR`. A `docker compose down` destroys namespace-local state along with the namespaces, which is one more reason containers beat long-lived VMs for this work, but anything you configured on the host, and anything living in the admin console, survives. The reset script must reset everything the run touched, and the README must say what the reset script resets. "I reran it and got a different result" almost always means an incomplete reset, not a heisenbug.

When you genuinely need persistent state, because the bug involves what a node remembers across restarts, then persist it deliberately: mount the state volume, set `TS_AUTH_ONCE=true`, and document that this repro is stateful and which run number exhibits the bug. Stateful repros are legitimate. Accidentally stateful repros are worthless.

## Prove it, then package it: the five minute README

A repro that only runs on your laptop is a demo with extra steps. The finish line is an engineer who has never seen the ticket running it inside five minutes and seeing the bug with their own eyes. That requires the repro to carry its own verification.

Your oracles are the diagnostic commands, captured as expected output: `tailscale status` for the peer list and connection state, `tailscale ping` for path and latency, `tailscale netcheck` for the simulated network's classification (kb-connect-failure, kb-poor-performance). A repro without a stated expected result is unfalsifiable; the reader cannot distinguish "reproduced the bug" from "broke the lab."

The README template, which fits on one screen:

```markdown
# Repro: TCP transfer stalls on relayed path with 2% loss

## Claim
With both nodes forced onto DERP and 2% loss injected at the
NAT router, a plain TCP transfer between node-a and node-b
stalls within 60s. Removing the loss rule makes it complete.
Matches ticket #NNNN (Customer runs v1.XX.X, relayed, lossy WAN).

## Requirements
Linux host, Docker + compose, two ephemeral auth keys in .env.
Tested on tailscale/tailscale:v1.XX.X.

## Run
1. ./reset.sh          # wipes state dirs, tears down namespaces
2. docker compose up -d
3. ./verify-lab.sh     # asserts: ping says "via DERP",
                       #   netcheck matches expected.txt
4. ./trigger.sh        # starts the transfer, prints PASS/FAIL

## Expected
trigger.sh prints STALLED (bug reproduced) in under 90s.
With LOSS=0: prints COMPLETED (bug absent).

## Knobs
LOSS (default 2), DELAY_MS (default 80), IMAGE_TAG.
```

Note the shape. The claim states the trigger and the negative control in two sentences. The verify step runs before the trigger, so a broken lab fails loudly instead of producing a false negative. The knobs section tells the next engineer which variables were established as load-bearing and hands them the levers to keep minimizing.

> [!FROM-THE-FIELD]
> The negative control line is the one most repros omit and the one engineers trust most. "It fails with the rule and completes without it" is a claim about causation; "it fails" is only a claim about existence. When a Customer escalation is contested (their network team says nothing is wrong, your traces say otherwise), a repro whose bug appears and disappears under a single documented toggle ends the argument in a way no amount of log excerpts ever does. Build the toggle in from the first draft, because the version of you writing the README at 6pm will not go back and add it.

One last calibration: know when to stop minimizing. The perfect one-line repro is a joy, but the goal is transferring the bug to someone who can fix it. When the repro is deterministic, documented, and runs in five minutes, ship it. Minimization past that point is a hobby.

## Cross references

- Module 03 explains the NAT traversal machinery (STUN, DERP, easy versus hard NAT, and the newer Peer Relays) that this module's iptables and MASQUERADE tricks are simulating.
- Module 11 covers the diagnostic commands (status, ping, netcheck, bugreport) used here as repro oracles, in full depth.
- Module 09 matters when the Customer's platform is not Linux, because a container lab reproduces Linux behavior only.
- Module 01 gives the WireGuard fundamentals that determine what the direct UDP path actually carries.
- Module 02 explains the control plane's role in candidate exchange, which is why login state and node identity affect traversal at all.
