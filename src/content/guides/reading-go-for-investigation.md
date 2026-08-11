---
slug: reading-go-for-investigation
title: Reading Go for investigation
description: How to navigate the tailscale/tailscale codebase to answer field questions, from grepping a log line to its source to building tailscaled with your own print statement.
track: code-lab
order: 1
words: 3200
sources:
  - id: ts-repo
    url: https://github.com/tailscale/tailscale
    title: tailscale/tailscale GitHub repository
    checked: 2026-08-10
  - id: ts-readme
    url: https://github.com/tailscale/tailscale/blob/main/README.md
    title: tailscale/tailscale README
    checked: 2026-08-10
  - id: ts-license
    url: https://github.com/tailscale/tailscale/blob/main/LICENSE
    title: tailscale/tailscale LICENSE (BSD-3-Clause)
    checked: 2026-08-10
  - id: ts-opensource
    url: https://tailscale.com/opensource
    title: Tailscale open source policy
    checked: 2026-08-10
  - id: pkg-ipnlocal
    url: https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/local.go
    title: ipnlocal package source and doc comments (LocalBackend)
    checked: 2026-08-10
  - id: pkg-magicsock
    url: https://github.com/tailscale/tailscale/blob/main/wgengine/magicsock/magicsock.go
    title: magicsock package source and doc comments
    checked: 2026-08-10
  - id: pkg-netcheck
    url: https://github.com/tailscale/tailscale/blob/main/net/netcheck/netcheck.go
    title: netcheck package source and doc comments
    checked: 2026-08-10
  - id: pkg-controlclient
    url: https://github.com/tailscale/tailscale/blob/main/control/controlclient/direct.go
    title: controlclient package source and doc comments
    checked: 2026-08-10
  - id: cli-dir
    url: https://github.com/tailscale/tailscale/tree/main/cmd/tailscale/cli
    title: cmd/tailscale/cli directory listing
    checked: 2026-08-10
---

## Why the source code is a support tool

You do not need to write Go for a living to get value out of the Tailscale codebase. You need to read it the way you read a packet capture: with a specific question, a starting point, and a method for moving outward until the question is answered.

The core client is open source under a BSD-3-Clause license. The daemon code used across all platforms lives in one repository, github.com/tailscale/tailscale, written almost entirely in Go. On Linux and Android both the daemon and the GUI are open; on Windows and macOS the daemon is open but the GUI is closed. The coordination server is proprietary, but its client side (the code that talks to it, and the wire types it exchanges) is all in the open repo. That means nearly every behavior you observe in the field, every log line, every state transition, every retry, every timeout, has a readable definition you can find in about two minutes once you know the layout.

This module teaches four moves: the map (where things live), the grep (log line back to source), the reading level (enough Go to follow goroutines, channels, and mutexes without writing them), and the print (building your own tailscaled to confirm a theory). Everything else in the code lab builds on these.

## The map: how the repository is laid out

The repository has dozens of top-level directories, but investigations keep landing in the same ten. Learn these and you can place almost any log line or stack trace before you even grep.

| Path | What it is | When you go there |
|---|---|---|
| `cmd/tailscale` | The CLI binary. Subcommands live in `cmd/tailscale/cli` as one file per command: `up.go`, `status.go`, `ping.go`, `netcheck.go`, `set.go`, `serve_v2.go`, `debug*.go`. | "What does this flag actually do?" |
| `cmd/tailscaled` | The daemon binary: startup, wiring, platform service glue. | Daemon startup problems, systemd questions. |
| `ipn/ipnlocal` | The brain. `LocalBackend` is the state machine that coordinates everything: prefs, profiles, netmap handling, login flow. | Almost every "why did the node do that?" question. |
| `wgengine` | The data plane engine wrapping WireGuard: configuring the tunnel, routes, the packet filter. | Traffic not flowing when everything looks connected. |
| `wgengine/magicsock` | The magic UDP socket: endpoint discovery, path selection, DERP fallback, disco. Implements wireguard-go's `conn.Bind` so WireGuard sends through it without knowing paths change. | NAT traversal, relay vs direct, path flapping. |
| `control/controlclient` | The client for the control plane: authentication and the long map poll that streams netmap updates. | Login loops, "why did my netmap change?", control connectivity. |
| `net/netcheck` | The connectivity prober behind `tailscale netcheck`: STUN probes, DERP latency, the `Report` struct with fields like `UDP`, `MappingVariesByDestIP`, `PreferredDERP`. | Interpreting netcheck output precisely. |
| `tailcfg` | The shared vocabulary: wire types exchanged with control (`Node`, `Hostinfo`, `NetInfo`, `Endpoint`). No logic, just structs. | "What fields does control actually know about?" |
| `derp` | The DERP relay implementation, client and server. Open source; you can run your own. | Relay behavior, framing, why a packet took the relay. |
| `tsnet` | Tailscale as an embeddable Go library: a userspace node inside your own program. | Building lab tooling, understanding userspace mode. |

Everything meets in the middle. `ipnlocal.LocalBackend` receives events from frontends (CLI, GUIs), from `controlclient`, and from `wgengine`, advances its state machine, and pushes configuration back out. The package doc comments describe it exactly that way: the central glue between the cloud control plane, the network data plane, and the user-facing frontends. When you are lost, orient on `LocalBackend` and ask which spoke your question belongs to.

<div class="diagram-wrap">
<svg viewBox="0 0 760 420" role="img" aria-label="Package map of the tailscale repository showing LocalBackend as the hub between CLI, control plane, and data plane">
  <title>Package map: LocalBackend as the hub</title>
  <rect x="10" y="10" width="740" height="400" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <rect x="40" y="40" width="200" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="140" y="65" text-anchor="middle" fill="var(--diagram-text)" font-size="13">cmd/tailscale (CLI)</text>
  <text x="140" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="11">cli/up.go, status.go ...</text>
  <rect x="520" y="40" width="200" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="620" y="65" text-anchor="middle" fill="var(--diagram-text)" font-size="13">control plane (SaaS)</text>
  <text x="620" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="11">proprietary, not in repo</text>
  <rect x="280" y="160" width="200" height="80" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="380" y="192" text-anchor="middle" fill="var(--diagram-text)" font-size="14">ipn/ipnlocal</text>
  <text x="380" y="215" text-anchor="middle" fill="var(--diagram-accent)" font-size="13">LocalBackend</text>
  <rect x="520" y="160" width="200" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="620" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">control/controlclient</text>
  <text x="620" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="11">login + map poll</text>
  <rect x="40" y="160" width="200" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="140" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">LocalAPI socket</text>
  <text x="140" y="205" text-anchor="middle" fill="var(--diagram-text)" font-size="11">CLI &lt;-&gt; tailscaled</text>
  <rect x="160" y="310" width="200" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="260" y="335" text-anchor="middle" fill="var(--diagram-text)" font-size="13">wgengine</text>
  <text x="260" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="11">WireGuard config,</text>
  <text x="260" y="370" text-anchor="middle" fill="var(--diagram-text)" font-size="11">routes, filter</text>
  <rect x="420" y="310" width="220" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="530" y="335" text-anchor="middle" fill="var(--diagram-text)" font-size="13">wgengine/magicsock</text>
  <text x="530" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="11">paths, disco, DERP,</text>
  <text x="530" y="370" text-anchor="middle" fill="var(--diagram-text)" font-size="11">net/netcheck reports</text>
  <line x1="140" y1="100" x2="140" y2="160" stroke="var(--diagram-line)"/>
  <line x1="240" y1="190" x2="280" y2="190" stroke="var(--diagram-accent)"/>
  <line x1="480" y1="190" x2="520" y2="190" stroke="var(--diagram-accent)"/>
  <line x1="620" y1="100" x2="620" y2="160" stroke="var(--diagram-line)"/>
  <line x1="330" y1="240" x2="270" y2="310" stroke="var(--diagram-accent)"/>
  <line x1="430" y1="240" x2="510" y2="310" stroke="var(--diagram-accent)"/>
  <text x="380" y="285" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tailcfg types flow everywhere</text>
</svg>
</div>

> [!HOW-IT-WORKS]
> The two binaries divide cleanly. `tailscaled` is the long-running daemon that owns the node: it holds the keys, talks to control, and moves packets. `tailscale` is a thin client: it parses your command, converts it into a request over the LocalAPI (a local socket), and prints the daemon's answer. This is why `tailscale` commands work identically across platforms while daemon behavior varies: the CLI barely does anything itself. When you trace a CLI behavior, you are really tracing two programs and the socket between them.

## The investigation move: log line to source file

Here is the single highest-value technique in this module. A Customer or a colleague hands you a log excerpt. Instead of pattern-matching on vibes, walk the line back to the code that printed it.

Step one: clone the repo once and keep it fresh.

```
git clone https://github.com/tailscale/tailscale
cd tailscale
git checkout v1.102.2   # match the version in the logs you are reading
```

Checking out the tag matching the deployed version matters. The repo moves fast, and a log string on `main` may not exist in the older build your Customer runs (as of 2026-08-10, stable is v1.102.2, but fleets routinely lag several releases behind). `tailscale version` tells you what to check out.

Step two: pick a distinctive substring. Tailscale log lines usually begin with a subsystem prefix, and the prefixes map to package names: lines starting `magicsock:` come from `wgengine/magicsock`, `netcheck:` from `net/netcheck`, `control:` from the control client path. That prefix alone gets you to the right directory. For the exact line, choose the most unusual literal fragment, avoiding any part that looks like variable data (numbers, hostnames, IPs).

Step three: grep for it.

```
grep -rn "some distinctive fragment" --include="*.go" .
```

Step four: read outward. You found the `logf(...)` call. Now read the enclosing function top to bottom, then answer three questions: what conditions had to be true for this line to print, what happens next in this function, and who calls this function. For the last one, grep for the function name. That is the whole method: land on the print, expand to the function, expand to the callers, stop when you can narrate the behavior.

<div class="diagram-wrap">
<svg viewBox="0 0 760 340" role="img" aria-label="Decision flow for tracing a field log line back to its source and reading outward">
  <title>From log line to explanation: the grep-and-read-outward loop</title>
  <rect x="10" y="10" width="740" height="320" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <rect x="30" y="40" width="180" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="63" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Log line from the field</text>
  <text x="120" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="11">note version + prefix</text>
  <rect x="270" y="40" width="180" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="360" y="63" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Pick literal fragment</text>
  <text x="360" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="11">skip numbers and names</text>
  <rect x="510" y="40" width="200" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="63" text-anchor="middle" fill="var(--diagram-text)" font-size="12">grep -rn at matching tag</text>
  <text x="610" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="11">hit? one file, one line</text>
  <rect x="510" y="150" width="200" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="610" y="173" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Read the whole function</text>
  <text x="610" y="192" text-anchor="middle" fill="var(--diagram-text)" font-size="11">what made it fire?</text>
  <rect x="270" y="150" width="180" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="360" y="173" text-anchor="middle" fill="var(--diagram-text)" font-size="12">grep the function name</text>
  <text x="360" y="192" text-anchor="middle" fill="var(--diagram-text)" font-size="11">find the callers</text>
  <rect x="30" y="150" width="180" height="55" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="173" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Can you narrate it?</text>
  <text x="120" y="192" text-anchor="middle" fill="var(--diagram-text)" font-size="11">cause, effect, next step</text>
  <rect x="30" y="255" width="180" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="120" y="285" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">Done: write it up</text>
  <rect x="270" y="255" width="200" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="370" y="277" text-anchor="middle" fill="var(--diagram-text)" font-size="12">No: expand one level up</text>
  <text x="370" y="294" text-anchor="middle" fill="var(--diagram-text)" font-size="11">and loop</text>
  <line x1="210" y1="67" x2="270" y2="67" stroke="var(--diagram-line)"/>
  <line x1="450" y1="67" x2="510" y2="67" stroke="var(--diagram-line)"/>
  <line x1="610" y1="95" x2="610" y2="150" stroke="var(--diagram-line)"/>
  <line x1="510" y1="177" x2="450" y2="177" stroke="var(--diagram-line)"/>
  <line x1="270" y1="177" x2="210" y2="177" stroke="var(--diagram-line)"/>
  <line x1="120" y1="205" x2="120" y2="255" stroke="var(--diagram-accent)"/>
  <line x1="210" y1="280" x2="270" y2="280" stroke="var(--diagram-line)"/>
  <line x1="370" y1="255" x2="370" y2="205" stroke="var(--diagram-line)"/>
</svg>
</div>

> [!GOTCHA]
> Log lines are format strings. If the field log says `magicsock: derp-12 connected`, the source contains something like `"derp-%d connected"`, and grepping the literal `derp-12` finds nothing. When a grep comes up empty, delete the parts that could be `%v`, `%d`, `%s` substitutions and search the static fragments between them. If it is still empty, you are on the wrong tag for that version, or the line comes from a closed component (the macOS or Windows GUI layers are not in this repo).

## Reading Go at investigation level

You need about six Go constructs to follow this codebase. You are reading for control flow, not style.

### Goroutines: `go func` means a parallel timeline

A goroutine is a cheap concurrent thread of execution. Any time you see `go someFunc()` or `go func() { ... }()`, a new timeline starts, and the code after the `go` statement does not wait for it. tailscaled is built out of these: `controlclient.Auto` maintains long-lived routines for login and for the map poll, magicsock runs receive loops per transport, netcheck probes regions concurrently. When logs interleave confusingly, it is because several of these timelines write to the same log.

The shape you will see constantly:

```go
go func() {
    defer close(done)
    for {
        // ... wait for work, handle it ...
    }
}()
```

Reading rule: when you enter a file, first find its long-lived loops. They define what the component does forever; everything else is setup or plumbing.

### Channels and select: the waiting room

A channel (`chan`) moves values between goroutines. A `select` block waits on several channels at once and runs whichever case becomes ready first. This is the standard event-loop shape in the daemon:

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case msg := <-updateCh:
        handle(msg)
    case <-timer.C:
        doPeriodicWork()
    }
}
```

Reading rule: a `select` inside a `for` is the component's heartbeat. List its cases and you have listed every stimulus the component responds to: cancellation, incoming messages, timers. When investigating "why did X never happen," check whether the case that would trigger X can ever fire, and what might be starving it.

### Context cancellation: how shutdown propagates

Nearly every blocking function takes a `ctx context.Context` first argument, and `controlclient.Direct.PollNetMap(ctx, ...)` is a canonical example: the map poll blocks streaming netmap updates from control until the context is canceled or the connection dies. A context is a cancellation signal that flows down call chains. `ctx.Done()` is a channel that closes on cancellation; `context.WithTimeout` and `context.WithCancel` create child contexts.

Reading rule: when a field symptom is "operation hung" or "operation gave up early," find the context. Trace where it was created and what cancels it. A surprising timeout in the field is very often a `WithTimeout` a few frames up from where the error surfaced. The netcheck client, for example, caps a full `GetReport` run at five seconds by design (the package's `ReportTimeout` constant), which is why `tailscale netcheck` never hangs even on a hostile network.

### The netmap poll, end to end

Put the three constructs together and you can read the most important loop in the product. `controlclient` documents itself as the client for the Tailscale control plane, handling authentication and network configuration. Its `Auto` type owns goroutines that keep a connection to control; the map poll calls `PollNetMap`, which invokes a `NetmapUpdater` callback on every update streamed from control; `LocalBackend` observes those updates through the package's `Observer` pattern (`SetControlClientStatus`) and reconfigures `wgengine` accordingly. One long-lived goroutine, blocking on the network under a context, delivering values to the state machine. When a Customer says "the new ACL took effect on node-a but not node-b," you now know exactly which loop on node-b to interrogate, and Module 02 tells you what flows through it.

## Mutexes and what they guard

Goroutines that share data need locks. The pattern in this codebase is idiomatic Go: a struct holds a `mu sync.Mutex` field, and by convention the fields declared below it are the ones it guards, often with a comment saying exactly that. `magicsock.Conn` and `ipnlocal.LocalBackend` are both large structs organized this way: a block of immutable setup fields, then `mu`, then the mutable state.

What this means for reading:

```go
c.mu.Lock()
defer c.mu.Unlock()
// everything here sees a consistent snapshot of the guarded fields
```

You are almost never debugging the lock itself. You use locks as a reading aid: `grep -n "mu.Lock()" filename.go` gives you an index of every place the component's mutable state changes. That list is usually short and it is the component's true API, regardless of how many exported methods exist.

Two field-relevant consequences. First, deadlocks: if a node's daemon is wedged (the CLI hangs, the daemon is alive but unresponsive), a goroutine dump shows every goroutine and what it is blocked on, including mutexes; on Linux, sending `SIGQUIT` to a Go program makes it dump all goroutine stacks and exit, which turns "it is stuck" into "it is stuck at file:line." Second, ordering: state changes serialize through the mutex, so two log lines from the same component cannot have raced each other's guarded state; interleaving weirdness across components is real, within a locked component it is not.

## Where a CLI flag lands

Trace one flag end to end and you can trace them all. Take `tailscale up` with a preference flag.

1. **Definition.** `cmd/tailscale/cli/up.go` defines the `up` command and its flag set. The CLI is built from small per-command files using a light command framework (the `ffcomplete` helper directory in `cli/` supports its flag completion), so `grep -rn "advertise" cmd/tailscale/cli/` style searches find flag definitions immediately.
2. **Translation.** The command handler converts parsed flags into preference structures from the `ipn` package. Preferences are the durable settings of a node; the CLI's job is to build the desired prefs and detect which ones you explicitly set.
3. **Transport.** The CLI sends the request over the LocalAPI socket to tailscaled. Nothing has actually changed yet; the CLI process could be killed here with no effect on the node.
4. **Arrival.** In the daemon, the LocalAPI handler calls into `LocalBackend`. The `ipnlocal` doc comments show the landing methods: `CheckPrefs` validates, `EditPrefs` applies a masked set of changed preferences, `Start` kicks the state machine with new options.
5. **Effect.** `LocalBackend` reacts to the new prefs: informing `controlclient` (say, new advertised routes for control to approve) and reprogramming `wgengine` (routes, filters, DNS).

So the answer to "what does this flag actually do?" is always found in two greps: the flag string in `cmd/tailscale/cli` to find the pref it sets, then the pref field name in `ipn/ipnlocal` to find the behavior it drives. The flag is just a name for a pref; the pref is just an input to the state machine.

> [!FROM-THE-FIELD]
> The same two-grep pattern answers the reverse question, "why is this setting on when nobody set it?" Pref fields can be set by flags, by `tailscale set`, by MDM or system policy on managed devices, or carried forward from a previous `up`. Grepping the pref field name in the daemon shows every writer. Enumerating writers of a field beats speculating about which one fired, and it is a ten-minute job once the repo is cloned.

## Building from source to add a print

Reading gets you hypotheses. A print statement gets you proof. The build is deliberately boring.

The README gives the canonical commands. You need a current Go toolchain; as of 2026-08-10 the repo states it always requires the latest Go release, currently Go 1.26.

```
go install tailscale.com/cmd/tailscale{,d}
```

That installs both binaries into your Go bin directory. For binaries meant to leave your machine, the README says to use `./build_dist.sh tailscale.com/cmd/tailscaled` instead, which embeds version information so bug reports and `tailscale version` output stay meaningful. An unversioned lab build that escapes into production is a future support case with no version string, so treat `go install` builds as disposable.

The workflow for a lab investigation on lab-vm-1:

1. Check out the tag matching the version you are investigating.
2. Find the code path you identified by reading, and add a log line beside the decision you want to observe. Match the local style: these files log through a `logf` function value, so `c.logf("LAB: took derp path because %v", reason)` fits right in, and the `LAB:` prefix makes your lines trivially greppable in output.
3. Build with `go install tailscale.com/cmd/tailscale{,d}`.
4. On a disposable lab node, stop the packaged daemon and run your binary in the foreground with the same flags the service used, so logs land in your terminal.
5. Reproduce, read your prints, remove them, and rebuild clean.

> [!GOTCHA]
> Only do this on machines you can afford to break, and never let a modified daemon linger. A lab tailscaled with an extra print is fine; a forgotten hand-built daemon on a real node means the package manager no longer owns the binary, updates silently stop applying, and six months later someone debugs a "stale version" mystery you created. Foreground runs on disposable nodes, then put the packaged binary back.

Two smaller payoffs from having a working build. First, `go doc` works locally: `go doc tailscale.com/ipn/ipnlocal LocalBackend` prints the doc comments without a browser, and pkg.go.dev renders the same comments when you want hyperlinks. Second, `tsnet` becomes available to you: it packages the whole node as an importable Go library, so a twenty-line program can join a tailnet as a userspace node, which is a superb harness for reproducing protocol behavior without touching a machine's networking.

## Habits that compound

Three habits turn this from a party trick into standing capability. Keep a local clone with a handful of released tags fetched, so version-matched greps cost seconds. When you trace a log line to its cause, save the file and function name in your case notes; the same lines recur across Customers, and the second lookup is free. And read doc comments before bodies: this codebase is unusually well commented at the package and type level, and the `ipnlocal`, `magicsock`, `netcheck`, and `controlclient` package docs each compress a subsystem into a paragraph that frames everything beneath it.

The deeper point is that the open codebase changes what "I think" means in your write-ups. "I think the client retries" is a guess. "The map poll loop in controlclient re-enters `PollNetMap` after backoff, here is the function" is a finding. The second kind of sentence is what this track exists to make routine.

## Cross references

- Module 02 covers what the control plane sends through the netmap poll you traced here.
- Module 03 explains the NAT traversal, STUN, DERP, and Peer Relay behavior that magicsock and netcheck implement.
- Module 07 covers the routing preferences that `up` and `set` flags feed into the state machine.
- Module 11 pairs this module's source-reading with the operational tools (`tailscale netcheck`, `tailscale debug`, daemon logs) that generate the lines you grep.
- Module 12 continues the code lab with deeper dives into the packages mapped here.
- Module 00 places this track in the overall curriculum.
