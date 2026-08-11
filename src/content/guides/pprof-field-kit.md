---
slug: pprof-field-kit
title: The pprof field kit
description: How to pull CPU, heap, and goroutine profiles out of a running tailscaled and read them like an engineer instead of guessing at high CPU or memory reports.
track: code-lab
order: 3
words: 2900
sources:
  - id: ts-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: ts-debug-cli-src
    url: https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/debug.go
    title: tailscale CLI debug command source (cmd/tailscale/cli/debug.go)
    checked: 2026-08-10
  - id: ts-localapi-src
    url: https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go
    title: tailscaled LocalAPI handler source (ipn/localapi/localapi.go)
    checked: 2026-08-10
  - id: ts-localapi-pprof-src
    url: https://github.com/tailscale/tailscale/blob/main/ipn/localapi/pprof.go
    title: tailscaled LocalAPI pprof handler source (ipn/localapi/pprof.go)
    checked: 2026-08-10
  - id: ts-client-local-src
    url: https://github.com/tailscale/tailscale/blob/main/client/local/local.go
    title: Tailscale LocalAPI Go client source (client/local/local.go)
    checked: 2026-08-10
  - id: tailscaled-debug-src
    url: https://github.com/tailscale/tailscale/blob/main/cmd/tailscaled/debug.go
    title: tailscaled debug server source (cmd/tailscaled/debug.go)
    checked: 2026-08-10
  - id: tailscaled-main-src
    url: https://github.com/tailscale/tailscale/blob/main/cmd/tailscaled/tailscaled.go
    title: tailscaled main and flag definitions (cmd/tailscaled/tailscaled.go)
    checked: 2026-08-10
  - id: go-http-pprof
    url: https://pkg.go.dev/net/http/pprof
    title: net/http/pprof package documentation
    checked: 2026-08-10
  - id: go-runtime-pprof
    url: https://pkg.go.dev/runtime/pprof
    title: runtime/pprof package documentation
    checked: 2026-08-10
  - id: google-pprof
    url: https://pkg.go.dev/github.com/google/pprof
    title: google/pprof tool documentation
    checked: 2026-08-10
  - id: kb-client-metrics
    url: https://tailscale.com/kb/1482/client-metrics
    title: Tailscale client metrics
    checked: 2026-08-10
---

## Why profiles beat guesses

A Customer says "tailscaled is eating a CPU core" or "the daemon is at 2 GB of RAM and climbing." Without evidence, the conversation goes in circles: maybe it is the subnet router load, maybe it is a logging loop, maybe it is a leak. Every guess costs a round trip with the Customer and burns goodwill.

tailscaled is a Go program, and Go ships a profiler in the standard runtime. A profile is a sampled statistical picture of what the program was actually doing: which functions were on CPU, which call sites own the live memory, which goroutines exist and what each one is waiting on. One good profile capture usually replaces a week of speculation.

This module teaches three things: how to get profiles out of a running tailscaled (with exact, source-verified commands), how to read the three profile types that matter in the field (CPU, heap, goroutine), and how to package what you captured into a handoff that an upstream engineer can act on immediately. The reading method matters more than any specific numbers, because the numbers vary wildly by platform, version, and workload. Anyone who tells you "tailscaled should always be under X MB" is making it up. What does not vary is the shape of healthy versus unhealthy profiles, and shapes are what you will learn to read.

> [!GOTCHA]
> Everything under `tailscale debug` is explicitly not a stable interface. The command's own help text says so, verbatim from `cmd/tailscale/cli/debug.go`: `"tailscale debug" contains misc debug facilities; it is not a stable interface.` The command is also marked hidden in the CLI, which is why the published CLI reference (ts-cli) documents `status`, `netcheck`, `bugreport`, and `metrics` but not `debug`: the source is the only documentation. The commands below are verified against the main branch of the tailscale/tailscale repository as of 2026-08-10. Before you paste them into a runbook, verify them against the Customer's installed version with `tailscale debug --help`, because flags can move between releases without notice.

## Getting profiles out of a live tailscaled

There are three doors into the runtime. Two work on a running daemon with no restart. One requires a restart but gives you the full standard pprof surface. Know all three, reach for the first one by default.

<div class="diagram-wrap">
<svg viewBox="0 0 920 430" role="img" aria-label="Three paths from an engineer to profile data inside tailscaled">
  <title>Three paths into the tailscaled runtime: the debug CLI flags via LocalAPI, direct LocalAPI calls, and the optional debug HTTP server</title>
  <rect x="20" y="30" width="200" height="370" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="120" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="14" font-weight="bold">You (root shell)</text>
  <rect x="40" y="80" width="160" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="6"/>
  <text x="120" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tailscale debug</text>
  <text x="120" y="122" text-anchor="middle" fill="var(--diagram-text)" font-size="11">--cpu-profile</text>
  <text x="120" y="138" text-anchor="middle" fill="var(--diagram-text)" font-size="11">--mem-profile</text>
  <rect x="40" y="170" width="160" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="120" y="195" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tailscale debug</text>
  <text x="120" y="212" text-anchor="middle" fill="var(--diagram-text)" font-size="11">localapi /pprof</text>
  <text x="120" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="11">daemon-goroutines</text>
  <rect x="40" y="260" width="160" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="120" y="285" text-anchor="middle" fill="var(--diagram-text)" font-size="12">go tool pprof</text>
  <text x="120" y="302" text-anchor="middle" fill="var(--diagram-text)" font-size="11">http://localhost:PORT</text>
  <text x="120" y="318" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/debug/pprof/...</text>
  <rect x="370" y="80" width="220" height="160" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="480" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">LocalAPI socket</text>
  <text x="480" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/localapi/v0/pprof</text>
  <text x="480" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="11">?name=X&amp;seconds=N</text>
  <text x="480" y="162" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/localapi/v0/goroutines</text>
  <text x="480" y="182" text-anchor="middle" fill="var(--diagram-text)" font-size="11">requires write access</text>
  <text x="480" y="199" text-anchor="middle" fill="var(--diagram-text)" font-size="11">seconds must be 0 to 300</text>
  <rect x="370" y="270" width="220" height="110" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="480" y="295" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Debug HTTP server</text>
  <text x="480" y="315" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tailscaled -debug=addr:port</text>
  <text x="480" y="332" text-anchor="middle" fill="var(--diagram-text)" font-size="11">restart required</text>
  <text x="480" y="349" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/debug/pprof/, /debug/metrics</text>
  <text x="480" y="366" text-anchor="middle" fill="var(--diagram-text)" font-size="11">/debug/ipn, /debug/magicsock</text>
  <rect x="700" y="140" width="200" height="160" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="800" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">Go runtime</text>
  <text x="800" y="195" text-anchor="middle" fill="var(--diagram-text)" font-size="11">runtime/pprof</text>
  <text x="800" y="215" text-anchor="middle" fill="var(--diagram-text)" font-size="11">CPU sampler</text>
  <text x="800" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="11">heap sampler</text>
  <text x="800" y="255" text-anchor="middle" fill="var(--diagram-text)" font-size="11">goroutine table</text>
  <line x1="200" y1="115" x2="370" y2="140" stroke="var(--diagram-accent)"/>
  <line x1="200" y1="205" x2="370" y2="170" stroke="var(--diagram-line)"/>
  <line x1="200" y1="295" x2="370" y2="320" stroke="var(--diagram-line)"/>
  <line x1="590" y1="160" x2="700" y2="200" stroke="var(--diagram-line)"/>
  <line x1="590" y1="320" x2="700" y2="260" stroke="var(--diagram-line)"/>
  <text x="285" y="105" text-anchor="middle" fill="var(--diagram-text)" font-size="10">no restart</text>
  <text x="285" y="315" text-anchor="middle" fill="var(--diagram-text)" font-size="10">lab only</text>
</svg>
</div>

### Door 1: the built-in flags (use this first)

The `tailscale debug` command carries two flags purpose-built for this exact situation:

```
tailscale debug --cpu-profile=cpu.prof --profile-seconds=30
tailscale debug --mem-profile=heap.prof
```

`--cpu-profile` samples the daemon's CPU for `--profile-seconds` seconds (default 15) and writes a standard pprof file. `--mem-profile` grabs a heap profile immediately: in source it is exactly a LocalAPI request for the `heap` profile with zero seconds, so it is the inuse view, not `allocs`. Pass `-` as the filename to write to stdout. No restart, no config change, works on a production node while the problem is happening. That last part is the whole point: CPU profiles are only useful if captured while the symptom is live.

### Door 2: LocalAPI for the other profile types

Those two flags cover CPU and heap. For everything else the CLI has a general escape hatch into the daemon's LocalAPI, and the LocalAPI has a pprof endpoint:

```
tailscale debug localapi "/localapi/v0/pprof?name=goroutine" > goroutine.prof
tailscale debug localapi "/localapi/v0/pprof?name=allocs" > allocs.prof
tailscale debug localapi "/localapi/v0/pprof?name=mutex" > mutex.prof
```

The handler in `ipn/localapi/pprof.go` is a thin shim, eight lines of switch: `name=profile` invokes `pprof.Profile` (the CPU profiler), and any other name is passed to `pprof.Handler(name)`, so the standard `net/http/pprof` profile names work: `heap`, `allocs`, `goroutine`, `block`, `mutex`, `threadcreate`. The `seconds` parameter is accepted; the Go LocalAPI client does not clamp it, it refuses anything outside 0 to 300 with "duration out of range."

Two of those names come with a condition that `net/http/pprof` documents and that costs people an afternoon: `block` and `mutex` are only populated when the process has enabled the corresponding sampling, through `runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction`. Read an empty `block` or `mutex` profile as "sampling was never turned on," not as "there is no contention."

For a human-readable goroutine dump (not a binary profile), there is a dedicated subcommand:

```
tailscale debug daemon-goroutines > goroutines.txt
```

This calls `/localapi/v0/goroutines` and prints every goroutine's stack as text. It is the single highest-value capture for "stuck" reports, and it is cheap enough to run repeatedly.

### Door 3: the tailscaled debug server (lab and reproduction work)

`tailscaled` accepts a `-debug` flag, described in source as the "listen address ([ip]:port) of optional debug server." When set, the mux in `cmd/tailscaled/debug.go` serves the standard pprof surface at `/debug/pprof/` (index, `cmdline`, `profile`, `symbol`, `trace`) plus `/debug/metrics` in Prometheus text format, and `cmd/tailscaled/tailscaled.go` adds two HTML status pages onto the same mux: `/debug/ipn` and `/debug/magicsock`. This is the right door when you are reproducing a Customer problem on lab-vm-1 and want to iterate with `go tool pprof` pointed straight at a URL:

```
go tool pprof http://localhost:PORT/debug/pprof/profile?seconds=30
go tool pprof http://localhost:PORT/debug/pprof/heap
```

It requires restarting tailscaled with the flag, so it is almost never the right ask for a production Customer node. Use door 1 there.

> [!HOW-IT-WORKS]
> Why does `tailscale debug --cpu-profile` need root (or equivalent LocalAPI write access)? The LocalAPI handler refuses profile requests without write permission, and the source comment explains the reasoning: "Require write access out of paranoia that the profile dump might contain something sensitive." A profile embeds function names, and heap profiles reveal allocation call sites; the daemon treats that as privileged. Also note the build tag on `ipn/localapi/pprof.go`: the file is excluded on iOS, Android, js, and any build with the `ts_omit_debug` tag, with the comment "We don't include it on mobile where we're more memory constrained and there's no CLI to get at the results anyway." On those builds the endpoint answers "not implemented on this platform," so the mobile clients cannot be profiled this way at all. On mobile, your evidence is `tailscale bugreport` output, logs, and client metrics (Module 11).

## Reading a CPU profile: flat, cum, and the hot path

Open a capture with the pprof tool (it ships with the Go toolchain):

```
go tool pprof cpu.prof
(pprof) top 15
```

Every row has two numbers you must not confuse:

- **flat**: samples where the CPU was executing this exact function's own code.
- **cum** (cumulative): samples where this function was anywhere on the stack, so its own work plus everything it called.

The reading method: `top` sorted by flat tells you where cycles are actually burned. `top -cum` tells you which high-level entry points own the work. You need both. A function like a packet receive loop will have huge cum and tiny flat, which is fine: it is a dispatcher, and the flat time lives in its callees. The bug smell is the opposite shape: a function with huge flat time that has no business doing heavy work, like a logging formatter, a JSON marshaler running per-packet, or a lock spin.

From `top`, pick the biggest legitimate suspect and walk its call tree:

```
(pprof) list SomeFunction
(pprof) web
```

`list` shows per-line sample counts inside one function. `web` renders the whole call graph, and it needs Graphviz installed: without `dot` on your PATH that command fails rather than drawing anything, which is why `go tool pprof -http=:8081 cpu.prof` (interactive flame graph in a browser, also Graphviz-backed for the graph view) is usually the faster route to the hot path. The hot path is the chain of thick edges from the root to a leaf. Name that chain in your notes, with the percentage your own capture actually shows. A finding reads like "N percent of CPU is under magicsock receive into WireGuard decryption," where N came off your `top` output; "CPU is high" is a complaint.

One honest caveat: a CPU profile is a sample of the capture window only. Fifteen seconds of idle daemon tells you nothing. Capture while the symptom is active, and say in your notes what the node was doing during the window (traffic level, subnet routes, active transfers), because the profile is meaningless without that context.

## Reading a heap profile: inuse versus alloc

Heap profiles answer two different questions, and mixing them up produces false leak diagnoses:

- **inuse_space / inuse_objects**: memory live right now, attributed to the call sites that allocated it. This is the "why is RSS high" view and the default when you open a `heap` profile.
- **alloc_space / alloc_objects**: everything allocated since process start, including memory long since freed. This is the "who is churning the garbage collector" view, and it is also what the `allocs` profile endpoint emphasizes.

Switch views inside pprof with `-sample_index`:

```
go tool pprof -sample_index=inuse_space heap.prof
go tool pprof -sample_index=alloc_objects heap.prof
```

A big alloc_space number with small inuse_space is not a leak. It may still matter (allocation churn shows up as CPU time in garbage collection on the CPU profile), but it is a different problem with different fixes.

For a suspected leak, one heap snapshot is nearly useless because you cannot see direction. Capture two, thirty or sixty minutes apart, under the same conditions, and diff them:

```
go tool pprof -diff_base=heap1.prof heap2.prof
(pprof) top
```

The diff view shows growth by call site. Steady growth attributed to one call site across multiple intervals is a leak signature. Growth that plateaus is usually a cache or buffer pool reaching its working size, which is normal. Also remember two ways RSS can look scarier than the Go heap: the runtime holds freed memory before returning it to the OS, and profile samples are statistical rather than exact. So never promise a Customer that "the profile says only X MB" equals what `ps` will show. Compare trends, not absolutes.

## Goroutine dumps: reading the classic stuck shapes

`tailscale debug daemon-goroutines` gives you every goroutine with a state and a stack. Goroutines are cheap and tailscaled legitimately runs a lot of them, so the count alone means nothing. The reading is about states, groups, and growth.

Each goroutine header shows its state, and for long waits, roughly how long it has been waiting. The states you will act on:

- **running / runnable**: on CPU or ready for it. Many of these plus high CPU means go read the CPU profile instead.
- **chan receive / chan send / select**: waiting on channels. This is the normal resting state for most of a healthy daemon; almost everything idles in a select loop. It becomes a finding only when many goroutines with the same stack pile up waiting to send on the same channel: that shape means the consumer on the other end is stuck or too slow.
- **sync.Mutex.Lock / semacquire**: waiting for a lock. A handful, transiently, is life. Dozens of goroutines parked on the same mutex, with wait times in minutes, means some goroutine took that lock and never released it. Find the one goroutine that is inside the critical section (its stack will be in the guarded code, not in Lock) and you have your culprit.
- **IO wait / syscall**: parked in network reads or system calls. Normal for a network daemon. Suspicious only when one has been stuck for a very long time on an operation that should be bounded.

The two-dump method makes this rigorous. Take a dump, wait five to ten minutes, take another. Then group by identical stack (a quick `grep -c` on a distinctive frame works) and compare counts. Three outcomes:

1. Counts stable, states mostly channel waits: healthy, look elsewhere.
2. One stack's count grew between dumps and keeps growing: a goroutine leak. Something spawns workers that never exit. This eventually shows up as memory growth too, since each goroutine pins its stack and whatever its stack references.
3. Counts stable but a cluster is waiting on one mutex or one channel in both dumps, with growing wait durations: a deadlock or a wedged consumer.

<div class="diagram-wrap">
<svg viewBox="0 0 920 480" role="img" aria-label="Decision flow for triaging a goroutine dump">
  <title>Goroutine triage decision flow: take two dumps, compare grouped stack counts, then branch on growth, lock pileups, and channel pileups</title>
  <rect x="360" y="20" width="200" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="460" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Dump now, dump again</text>
  <text x="460" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="12">in 5 to 10 minutes</text>
  <rect x="360" y="105" width="200" height="50" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="460" y="127" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Group goroutines by</text>
  <text x="460" y="143" text-anchor="middle" fill="var(--diagram-text)" font-size="12">identical stack, compare counts</text>
  <line x1="460" y1="70" x2="460" y2="105" stroke="var(--diagram-line)"/>
  <rect x="60" y="210" width="230" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="175" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="12">One stack's count grew</text>
  <text x="175" y="252" text-anchor="middle" fill="var(--diagram-text)" font-size="12">dump over dump</text>
  <text x="175" y="269" text-anchor="middle" fill="var(--diagram-accent)" font-size="12" font-weight="bold">Goroutine leak</text>
  <rect x="345" y="210" width="230" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="460" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Cluster parked on one mutex,</text>
  <text x="460" y="252" text-anchor="middle" fill="var(--diagram-text)" font-size="12">wait times growing</text>
  <text x="460" y="269" text-anchor="middle" fill="var(--diagram-accent)" font-size="12" font-weight="bold">Held lock or deadlock</text>
  <rect x="630" y="210" width="230" height="70" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="745" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Counts stable, mostly</text>
  <text x="745" y="252" text-anchor="middle" fill="var(--diagram-text)" font-size="12">select and chan receive</text>
  <text x="745" y="269" text-anchor="middle" fill="var(--diagram-accent)" font-size="12" font-weight="bold">Healthy, look elsewhere</text>
  <line x1="400" y1="155" x2="200" y2="210" stroke="var(--diagram-line)"/>
  <line x1="460" y1="155" x2="460" y2="210" stroke="var(--diagram-line)"/>
  <line x1="520" y1="155" x2="720" y2="210" stroke="var(--diagram-line)"/>
  <rect x="60" y="330" width="230" height="90" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="175" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Next: identify the spawn site</text>
  <text x="175" y="372" text-anchor="middle" fill="var(--diagram-text)" font-size="11">from the leaked stack's top</text>
  <text x="175" y="389" text-anchor="middle" fill="var(--diagram-text)" font-size="11">frames; pair with heap diff</text>
  <text x="175" y="406" text-anchor="middle" fill="var(--diagram-text)" font-size="11">to show memory impact</text>
  <rect x="345" y="330" width="230" height="90" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="460" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Next: find the one goroutine</text>
  <text x="460" y="372" text-anchor="middle" fill="var(--diagram-text)" font-size="11">executing inside the guarded</text>
  <text x="460" y="389" text-anchor="middle" fill="var(--diagram-text)" font-size="11">code (not waiting in Lock);</text>
  <text x="460" y="406" text-anchor="middle" fill="var(--diagram-text)" font-size="11">that stack is the finding</text>
  <rect x="630" y="330" width="230" height="90" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="745" y="355" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Next: CPU profile if CPU is</text>
  <text x="745" y="372" text-anchor="middle" fill="var(--diagram-text)" font-size="11">the complaint, heap diff if</text>
  <text x="745" y="389" text-anchor="middle" fill="var(--diagram-text)" font-size="11">memory is, client metrics</text>
  <text x="745" y="406" text-anchor="middle" fill="var(--diagram-text)" font-size="11">for path and drop counters</text>
  <line x1="175" y1="280" x2="175" y2="330" stroke="var(--diagram-line)"/>
  <line x1="460" y1="280" x2="460" y2="330" stroke="var(--diagram-line)"/>
  <line x1="745" y1="280" x2="745" y2="330" stroke="var(--diagram-line)"/>
</svg>
</div>

## A worked reading: healthy versus suspicious shapes

Here is the honest version of "what should tailscaled profiles look like." Not numbers, shapes. The exact percentages depend on version, platform, hardware crypto support, and what the node is doing, so treat the following as pattern recognition, not thresholds.

**Healthy under traffic load.** On a busy node (say, a subnet router pushing real throughput), expect the CPU profile to be dominated by the data plane: WireGuard cryptography (ChaCha20-Poly1305 work), packet handling in magicsock and the TUN read/write path, and a large slab of syscall time for actually moving packets through the kernel. This is the daemon doing its job. If a Customer shows you a busy core during a sustained transfer and the profile is crypto and syscalls top to bottom, the finding is "CPU scales with your traffic," and the conversation moves to expectations and hardware, not bugs. No percentage in this section is a measurement of anything; the numbers that matter are the ones in front of you, and there is no published figure for what tailscaled "should" burn. Cross-check with `tailscale metrics print` (available since v1.78.0): the throughput counters with their path labels tell you whether that traffic moved over a direct path or DERP, which changes the cost per byte (Module 03 explains why relayed bytes cost more).

**Suspicious on CPU.** High CPU on an idle node is always a finding. If the profile shows the burn in something periodic (log processing, netmap handling, endpoint discovery churn) rather than the data plane, capture two 30-second profiles a few minutes apart and confirm the shape repeats. Regular sawtooth CPU with profiles full of the same non-dataplane path is exactly the kind of evidence upstream can act on. Similarly suspicious: heavy flat time in garbage collection functions, which usually points back at allocation churn; go pull the `allocs` profile next.

**Healthy memory.** A stable working set that scales roughly with tailnet size and netmap complexity, with inuse_space attributed across buffers, netmap state, and connection tracking. Two heap snapshots an hour apart look about the same.

**Suspicious memory.** Monotonic inuse growth in the diff view attributed to one call site, or goroutine counts climbing in lockstep with RSS. Wildly growing goroutine counts are never normal, whatever the absolute number is. That pairing (goroutine dump growth plus heap diff growth) is the classic leak dossier.

> [!FROM-THE-FIELD]
> The single most common mistake in escalated performance cases is a lone artifact: one heap profile, or one CPU profile captured after the incident cooled off. A profile without a baseline or a pair is an anecdote. Make "capture in pairs" a reflex: two CPU profiles during the symptom, two heap snapshots separated by enough time to show direction, two goroutine dumps. The delta is the evidence; the single snapshot is just a picture.

> [!ON-THE-WIRE]
> Nothing in this module touches Customer packet payloads. Profiles contain function names, call stacks, and allocation sizes from the tailscaled binary itself. But treat them as sensitive anyway: goroutine dumps can embed hostnames and addresses in stack arguments, which is part of why the LocalAPI gates the pprof endpoint behind write access. Ship profiles through whatever channel the Customer already uses for logs and bugreports, not public issue trackers.

## Packaging the handoff

A profile bundle that an upstream engineer can open cold should contain:

1. **The artifacts, named with content and time**: `cpu-during-spike-1030Z.prof`, `cpu-during-spike-1040Z.prof`, `heap-1030Z.prof`, `heap-1130Z.prof`, `goroutines-1030Z.txt`, `goroutines-1040Z.txt`.
2. **Exact version and platform**: `tailscale version` output. Profiles are read against the source of that exact version (Module 12), and a line number from the wrong release sends someone down the wrong file.
3. **A bugreport marker**: run `tailscale bugreport` at capture time and include the marker it prints. It anchors your captures to a position in the server-side logs.
4. **Metrics context**: `tailscale metrics print` output from around the capture window (v1.78.0 or later). The throughput, drop, and health counters tell the reader what the node was doing while the CPU profile was sampling.
5. **Your reading, clearly separated from the raw data**: three or four sentences. The shape of it, with every value replaced by what you measured: "CPU pinned at <observed percent> on node-a while idle. Two 30-second CPU profiles both show the majority of flat time under <the path you found>, not in crypto or syscalls. Goroutine count grew from N to M in ten minutes with the growth concentrated in one stack (attached). Heap diff over one hour attributes the growth to the same subsystem." Never ship a number you did not read off a capture.
6. **What you ruled out**: idle versus loaded, direct versus DERP path, whether a restart clears it and for how long.

That last discipline, separating your interpretation from the raw evidence, is what makes the bundle trustworthy. The profiles let the next engineer check your reading; your reading tells them where to look first. When the case is real, this bundle is the difference between "we could not reproduce" and a fix.

## Cross references

- Module 01 for why WireGuard cryptography dominating a loaded CPU profile is the expected healthy shape.
- Module 03 for why DERP-relayed traffic changes the per-byte cost you see under load.
- Module 09 for platform differences that decide which capture doors exist, including mobile builds compiling out the pprof endpoint.
- Module 11 for the wider observability toolkit this kit slots into: bugreport, client metrics, and log pipelines.
- Module 12 for reading the tailscaled source at the exact version your profile came from, which is how a hot path becomes a file and line.
