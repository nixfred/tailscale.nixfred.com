---
slug: evidence-collection
title: Evidence collection
description: How to gather logs, bug report markers, version facts, and point in time snapshots from a tailnet incident before you commit to any theory.
track: fieldcraft
order: 1
words: 3450
sources:
  - id: kb-troubleshooting
    url: https://tailscale.com/docs/reference/troubleshooting
    title: Troubleshooting guide
    checked: 2026-08-10
  - id: kb-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: kb-logging
    url: https://tailscale.com/docs/features/logging
    title: Tailscale logging
    checked: 2026-08-10
  - id: docs-bugreport
    url: https://tailscale.com/docs/account/bug-report
    title: Generate a bug report
    checked: 2026-08-10
  - id: kb-macos-variants
    url: https://tailscale.com/docs/concepts/macos-variants
    title: Variants of the macOS client
    checked: 2026-08-10
  - id: kb-client-metrics
    url: https://tailscale.com/docs/reference/tailscale-client-metrics
    title: Client metrics
    checked: 2026-08-10
  - id: changelog
    url: https://tailscale.com/changelog
    title: Tailscale changelog
    checked: 2026-08-10
---

## Evidence first, theories second

Every bad troubleshooting session starts the same way: someone forms a theory in the first five minutes and then spends the next five hours collecting only the evidence that fits it. The discipline this module teaches is the opposite motion. When a tailnet incident lands on you, your first job is to capture the state of the world before it changes, before anyone reboots anything, and before your own brain starts pattern matching on the last incident that looked vaguely similar.

Why does this matter more with Tailscale than with a single server? Because a tailnet problem always has at least three moving parts: the client on one node, the client on another node, and the coordination and relay infrastructure between them. Any of the three can be the cause, and the evidence for each lives in a different place. If you only collect from the node that reported the problem, you have one third of the picture, and Tailscale's own logging model assumes you will use both sides: every connection requires two endpoints, and both endpoints log every connection, which makes it possible to detect lost or tampered logs by comparing the two records.

Here is the worked example that runs through this entire guide. A Customer opens a ticket: "File copies from node-a (a Linux build server) to node-b (a Windows laptop) stall out most mornings around 09:00, then recover by 09:20. It started sometime last week." That is a classic weak report: vague time window, vague onset, one symptom, zero evidence. By the end of this module you will know exactly what to collect, in what order, and why each artifact earns its place.

> [!FROM-THE-FIELD]
> The phrase "it started sometime last week" should trigger an almost physical reflex: something changed last week, and the two most common somethings are a client upgrade and an OS upgrade. You will not know which until you build the version matrix in the section below. Resist the urge to guess. Guessing feels like progress and produces none.

## The evidence kit: what you are assembling

Before diving into mechanics, know the shape of the finished product. A complete evidence kit for a tailnet incident contains:

1. **Client logs from both endpoints**, covering the incident window, with the OS and collection method noted.
2. **A bug report marker** (or a pair of markers bracketing a reproduction) so Tailscale support can locate the server side of the diagnostic logs.
3. **A version matrix**: client version, OS version, and last upgrade date for every node involved, plus the changelog entries for any version that changed recently.
4. **Point in time snapshots**: `tailscale status --json` and `tailscale netcheck` output from both endpoints, timestamped.
5. **Client metrics samples**, if the clients are v1.78.0 or later, ideally from before and during an incident.
6. **A timeline** in UTC with every event you know about, and a note on each machine's clock offset.

Everything below is the mechanics of filling those six slots.

<div class="diagram-wrap">
<svg viewBox="0 0 860 430" role="img" aria-label="Decision flow for choosing evidence collection actions based on whether the problem is reproducible now or happened in the past">
  <title>Evidence collection decision flow</title>
  <rect x="330" y="10" width="200" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="430" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Incident reported</text>
  <line x1="430" y1="60" x2="430" y2="95" stroke="var(--diagram-line)"/>
  <rect x="310" y="95" width="240" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="430" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="15">Is it happening right now?</text>
  <line x1="310" y1="120" x2="180" y2="180" stroke="var(--diagram-line)"/>
  <text x="215" y="145" fill="var(--diagram-text)" font-size="13">yes</text>
  <line x1="550" y1="120" x2="680" y2="180" stroke="var(--diagram-line)"/>
  <text x="630" y="145" fill="var(--diagram-text)" font-size="13">no</text>
  <rect x="40" y="180" width="280" height="170" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="180" y="205" text-anchor="middle" fill="var(--diagram-accent)" font-size="14">LIVE CAPTURE (both nodes)</text>
  <text x="60" y="235" fill="var(--diagram-text)" font-size="13">tailscale status --json</text>
  <text x="60" y="260" fill="var(--diagram-text)" font-size="13">tailscale netcheck</text>
  <text x="60" y="285" fill="var(--diagram-text)" font-size="13">tailscale metrics print</text>
  <text x="60" y="310" fill="var(--diagram-text)" font-size="13">tailscale bugreport --record</text>
  <text x="60" y="335" fill="var(--diagram-text)" font-size="13">(reproduce inside the bracket)</text>
  <rect x="540" y="180" width="280" height="170" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="680" y="205" text-anchor="middle" fill="var(--diagram-accent)" font-size="14">HISTORICAL CAPTURE</text>
  <text x="560" y="235" fill="var(--diagram-text)" font-size="13">Pull OS logs for the window</text>
  <text x="560" y="260" fill="var(--diagram-text)" font-size="13">tailscale bugreport (one marker)</text>
  <text x="560" y="285" fill="var(--diagram-text)" font-size="13">Build the version matrix</text>
  <text x="560" y="310" fill="var(--diagram-text)" font-size="13">Note clock offsets per node</text>
  <text x="560" y="335" fill="var(--diagram-text)" font-size="13">Set a trap for the next repro</text>
  <line x1="180" y1="350" x2="380" y2="400" stroke="var(--diagram-line)"/>
  <line x1="680" y1="350" x2="480" y2="400" stroke="var(--diagram-line)"/>
  <rect x="330" y="385" width="200" height="35" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="430" y="408" text-anchor="middle" fill="var(--diagram-text)" font-size="14">Timeline in UTC</text>
</svg>
</div>

Notice the flow ends in the same place regardless of branch: a UTC timeline. Evidence that cannot be placed on a shared timeline is trivia, not evidence.

## Client logs, per operating system

The Tailscale client logs information about its own operation and its attempts to contact other nodes. Where those logs land is entirely an OS question, and getting this wrong wastes the first hour of any incident. Learn these locations cold.

**Linux.** `tailscaled` runs as a systemd service on mainstream distributions, and its logs go to the journal:

```
journalctl -u tailscaled --since "2026-08-10 08:30" --until "2026-08-10 09:30" -o short-iso-precise
```

The `--since` and `--until` bounds matter. A raw `journalctl -u tailscaled` on a long lived server can emit weeks of output, and you want the incident window plus margin, not a haystack. The `-o short-iso-precise` output format gives you full timestamps you can correlate across machines.

**Windows.** The service writes its logs to `C:\ProgramData\Tailscale`, or more portably `$env:ALLUSERSPROFILE\Tailscale`. This is a hidden directory on default installs, which is why Customers so often report "there are no logs on Windows." There are; Explorer is hiding them. Collect the log files covering the incident window and note the machine's local timezone while you are there.

**macOS.** There is no simple log file. Tailscale's client logs are written into the macOS unified logging system, viewable in the Console application; search for entries marked `IPN` when streaming live, or extract them retroactively from a sysdiagnose archive. That second path is the one to remember: if the incident already happened, a sysdiagnose captures a window of recent unified log history, so you can recover evidence you never asked the Customer to collect at the time.

**iOS and tvOS.** Same unified log family: connect the device to a Mac, open Console, select the device, and filter for `IPN`. A sysdiagnose from the device works retroactively here too.

**Android.** Use `logcat` and search for the `com.tailscale.ipn` package.

> [!GOTCHA]
> On macOS, "which Tailscale is this?" is a real question with three answers, and it changes where you look and what the client can do. The Mac App Store variant runs as a sandboxed Network Extension. The standalone variant (the one Tailscale recommends) runs as a System Extension and is the only variant listed as fully able to generate configuration reports for support; the App Store variant's reporting ability is listed as limited. The third variant is open source `tailscaled` from the command line, with no GUI at all and no configuration report support. Ask which one is installed before you ask for any diagnostic, because the instructions differ and so does what you will get back.

For the worked example: node-a is Linux, so you ask for a `journalctl -u tailscaled` slice from 08:30 to 09:30 local on a stall day. Node-b is Windows, so you ask for the files in `C:\ProgramData\Tailscale` covering the same window. Two sides, same window. You now have both halves of every connection attempt, which means you can see whether the stall looks the same from both ends or only from one, and that single comparison eliminates half of your future theories before you form them.

## tailscale bugreport: the marker workflow

`tailscale bugreport` is one of the most misunderstood commands in the CLI, because it does not do what its name suggests. It does not upload a bundle of files, and it does not open a ticket. What it does is generate a random identifier and mark it in the diagnostic logs at that moment in time. The identifier looks like this:

```
BUG-1b7641a16971a9cd75822c0ed8043fee70ae88cf05c52981dc220eb96a5c49a8-20210427151443Z-fbcd4fd3a4b7ad94
```

> [!HOW-IT-WORKS]
> Think of the marker as a bookmark dropped into a stream, not a report. The client's diagnostic logs flow continuously; the bugreport identifier is a unique, timestamped marker embedded in that flow. The identifier itself contains no personally identifiable information, and nothing happens with it unless you explicitly hand it to Tailscale's support team, at which point it lets them jump straight to that moment in that node's diagnostic logs instead of searching by hostname and guessed times. No identifier shared, no triage access granted: the marker just sits there.

Two flags turn this from a bookmark into a proper instrument:

- `--diagnose` prints additional verbose system information into the logs at marker time. Use it by default during incidents; the extra context costs nothing.
- `--record` is the important one. It starts a pause: the command drops the first marker, waits while you reproduce the issue, and then generates a second identifier when you finish. You now have two bookmarks bracketing the reproduction, and support can read exactly the slice between them. When you use `--record`, share both identifiers. One identifier from a `--record` run is half a bracket, and half a bracket is a point, not a window.

<div class="diagram-wrap">
<svg viewBox="0 0 860 240" role="img" aria-label="Timeline showing the bugreport record workflow: first marker, reproduction window, second marker, and the log slice between them">
  <title>The bugreport --record bracket</title>
  <line x1="40" y1="150" x2="820" y2="150" stroke="var(--diagram-line)"/>
  <text x="430" y="185" text-anchor="middle" fill="var(--diagram-text)" font-size="13">continuous client diagnostic log stream</text>
  <line x1="230" y1="60" x2="230" y2="150" stroke="var(--diagram-accent)"/>
  <circle cx="230" cy="150" r="6" fill="var(--diagram-accent)" stroke="var(--diagram-line)"/>
  <text x="230" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="13">marker 1: BUG-...aa</text>
  <line x1="630" y1="60" x2="630" y2="150" stroke="var(--diagram-accent)"/>
  <circle cx="630" cy="150" r="6" fill="var(--diagram-accent)" stroke="var(--diagram-line)"/>
  <text x="630" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="13">marker 2: BUG-...bb</text>
  <rect x="230" y="90" width="400" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="430" y="115" text-anchor="middle" fill="var(--diagram-text)" font-size="14">you reproduce the issue here</text>
  <text x="430" y="220" text-anchor="middle" fill="var(--diagram-text)" font-size="13">share BOTH identifiers: the slice between them is the evidence</text>
</svg>
</div>

The field workflow, in order:

1. Confirm the client is in the broken (or about to be broken) state.
2. Run `tailscale bugreport --record --diagnose` on the affected node.
3. Reproduce the failure while the command waits: start the file copy, trigger the timeout, whatever the symptom is.
4. End the recording, and copy both identifiers verbatim into the ticket.
5. Note the wall clock time and the node it ran on. An identifier without a node attribution is a puzzle for future you.

For the worked example, the stall is time bound (09:00 to 09:20 most mornings), which makes it perfect for a scheduled bracket: have the Customer start `tailscale bugreport --record` on node-b at 08:55 tomorrow, run the file copy that always stalls, and end the recording at 09:25. If the stall shows up, you have a bracketed reproduction on the first try. If it does not, that is evidence too: a stall that vanishes under observation smells like load, scheduled jobs, or a competing network agent, not a Tailscale code path.

## The version matrix: the changelog is a suspect list

"It started sometime last week" means the delta is the suspect, and the delta lives in three places: the client version, the OS version, and the environment. Build a small table before touching anything else:

| Node | Role | Client version | OS + version | Last client update | Last OS update |
|------|------|---------------|--------------|-------------------|----------------|
| node-a | Linux build server | ? | ? | ? | ? |
| node-b | Windows laptop | ? | ? | ? | ? |

Fill it from `tailscale version` on each node, plus the OS's own update history. Then open the Tailscale changelog and read it like a detective reads an alibi. The changelog is organized in reverse chronological order, filterable by Service and Client changes, and within each release the notes are grouped by platform (all platforms, then Linux, macOS, Windows, iOS, Android, and related tools). That per platform grouping is exactly what you want: if node-b jumped from v1.102.1 to v1.102.2 the day the stalls started, the Windows section of the v1.102.2 notes is your first read, and the "All Platforms" section is your second.

The changelog also answers a subtler question: what changed on the service side even when no client updated. Control plane changes ship on their own cadence, filterable under Service changes, so "nobody updated anything" from the Customer does not mean nothing changed. As a concrete 2026 example of why release notes matter: v1.102.2 (released August 4, 2026) resolves a regression that caused incoming Tailscale Funnel connections to fail. A Customer running Funnel who updated to the affected release and then reported "inbound connections broke" would be fully explained by one changelog line. That is the payoff of treating the changelog as a suspect list: sometimes the entire investigation is already written down by the people who shipped the bug and then shipped the fix.

Version-qualify your evidence, too. Features you may lean on later in this guide have version floors: client metrics require v1.78.0 or later, Tailscale Services metrics require v1.102.0 or later, and CLI additions like `tailscale get` and `tailscale whoami` arrived in v1.102.1 (released August 3, 2026). If the version matrix says a node runs something older, adjust the evidence kit rather than assuming a command exists.

## Timestamps, clock skew, and the shared timeline

Cross machine log correlation is only as good as the clocks involved, and laptop clocks in particular are not to be trusted. Before you line up node-a's journal against node-b's log files, establish each machine's offset from real time. The cheap method: run a time echo on each node at the same moment (any authoritative time source works) and record the difference. Even noting "node-b runs 47 seconds fast" transforms your correlation from misleading to usable.

Then adopt three habits:

1. **Normalize everything to UTC** in your incident timeline. The Windows logs are in one local zone, the Linux journal may render another, and the Customer speaks in a third. UTC is the only zone in which the incident actually happened.
2. **Record capture time on every artifact.** A `netcheck` output without a timestamp is an anecdote. Prepend `date -u` to every snapshot command you ask a Customer to run.
3. **Distrust "at 9am."** Humans round times to the nearest quarter hour and to the nearest convenient narrative. Logs do not. When the Customer says 09:00 and the logs say the first retransmission storm begins at 08:52:14Z, the logs win, and that eight minute correction sometimes changes which scheduled job is the suspect.

> [!GOTCHA]
> The bugreport identifier embeds a timestamp (the `20210427151443Z` segment in the example above, in UTC). If the node's clock is skewed, that embedded timestamp is skewed with it. When you note a bugreport marker in a ticket, record both the identifier and your own trusted wall clock time. If they disagree by more than a few seconds, you have just discovered a clock skew finding for free, and you have protected the timeline from it.

For the worked example, this discipline pays off immediately: "most mornings around 09:00" on node-b's clock might be 08:58 UTC scheduled backup traffic on node-a's clock. You cannot see that alignment until both sides are in UTC with known offsets.

## Node identity: stable identifiers, not hostnames

Hostnames are labels, and labels move. Laptops get renamed, machines get reimaged and rejoin the tailnet with a familiar name and a completely new identity, and two eras of "node-b" can exist in logs with nothing in common but the string. If your evidence kit refers to nodes only by hostname, it can silently splice two different machines into one story.

So anchor your evidence to stable identity. Capture `tailscale status --json` on each node at collection time: the JSON form is the machine readable version of status and carries per node detail, including identifiers and keys, that survives cosmetic renames. Record, at minimum, for every node in the incident: the Tailscale IP, the machine name as currently displayed, and the stable identifiers from the JSON output. Pin them in the ticket next to the hostname the Customer uses. From then on, when someone says "node-b", you can verify it is the same node-b the logs came from.

This also matters for the version matrix: "node-b was reimaged Tuesday" explains a version change, a key change, and a behavior change all at once, and the only way to notice a reimage from evidence alone is that the stable identity behind the hostname changed.

## Point in time snapshots: status and netcheck

Logs tell you what happened; snapshots tell you what is true right now. Two commands make up the snapshot layer, and both should be captured from both endpoints, timestamped, at least twice (once while healthy, once during an incident if at all possible).

**`tailscale status`** shows every peer with its Tailscale IP, machine name, OS, and connection state: active or idle, and critically whether the path is direct, relayed through DERP, or via a peer relay, along with byte counters for traffic sent and received. For evidence purposes always capture `tailscale status --json`: it is the machine readable form (its schema is documented as subject to change, so archive the raw output rather than a paraphrase). The single most valuable bit in the worked example is the path type between node-a and node-b at 09:05 versus 10:05. A pair that is direct all day but relayed during the stall window is practically a confession: something in the morning network environment is breaking the direct path, and the stall is the symptom of falling back. Path types and how they form are Module 03's territory; here, your job is only to capture the fact.

**`tailscale netcheck`** is the outside in view: it reports whether UDP is usable at all, the node's IPv4 and IPv6 posture, its NAT characteristics and whether port mapping services are available, and measured latency to each DERP relay region with the nearest one identified. Run it on both nodes. For a time bound incident like the worked example, `tailscale netcheck --every=30s --format=json-line` running from 08:50 to 09:30 turns a point snapshot into a strip chart: if UDP reachability or the preferred DERP region flips at 09:00, you will see the flip itself, not just its aftermath.

> [!ON-THE-WIRE]
> `netcheck` is an active probe, not a passive report: it sends real probes from the node to STUN and DERP infrastructure and measures what comes back. That means it tests the network path as it exists at that second, from that node, through that NAT, under that firewall policy. It is the reason netcheck output is evidence rather than configuration: nobody's intent is being reported, only observed behavior. It is also the reason two netchecks an hour apart can legitimately disagree, which is exactly what makes the disagreement informative.

## Client metrics: the flight recorder

Logs are prose; metrics are instruments. Since v1.78.0, Tailscale clients expose client metrics designed for exactly this kind of investigation: insight into client behavior, health, and performance, consumable by Prometheus and Grafana or readable by hand. Every client serves them locally at `http://100.100.100.100/metrics`, and the CLI reads them directly:

```
tailscale metrics print
```

For continuous collection, `tailscale metrics write /var/lib/prometheus/node-exporter/tailscaled.prom` drops them where a Prometheus node exporter can scrape them.

The metrics that earn a place in an evidence kit:

- `tailscaled_inbound_bytes_total`, `tailscaled_outbound_bytes_total` and their packet twins: the raw throughput counters. A stall shows up here as a flatline.
- `tailscaled_inbound_dropped_packets_total` and `tailscaled_outbound_dropped_packets_total`: the difference between "traffic stopped arriving" and "traffic arrived and was dropped" is the difference between a path problem and a local problem, and these counters are how you tell.
- `tailscaled_health_messages`: a nonzero gauge here means the client itself is telling you something is wrong; read the health messages before anything else.
- `tailscaled_home_derp_region_id`: which DERP region the client currently calls home. A change in this gauge across two samples is a relay environment change, timestamped for free.
- The peer relay counters (`tailscaled_peer_relay_forwarded_packets_total` and friends) if peer relays are in play.
- On v1.102.0 or later, `tailscaled_serve_inbound_bytes_total` and `tailscaled_serve_outbound_bytes_total` for Tailscale Services traffic.

Counters only tell stories in pairs, so the field pattern is: sample before, sample during, subtract. For the worked example, ask for `tailscale metrics print` on both nodes at 08:50 and again at 09:10 on a stall morning. If node-a's outbound bytes climb while node-b's inbound bytes flatline and node-b's dropped counters do not move, the bytes are dying between the endpoints and your suspicion moves to the path. If node-b's dropped counters climb instead, the bytes arrived and node-b refused them, and your suspicion moves onto the laptop itself. One subtraction, and the investigation just halved.

## Closing the worked example

Assemble what the kit produced for the node-a to node-b stall. The version matrix shows node-b's client auto updated to a new release six days ago, the morning before the first stall report; the changelog's Windows section for that release becomes required reading. The bracketed `bugreport --record` from 08:55 to 09:25 caught a live stall, and both identifiers are in the ticket. The netcheck strip chart from node-b shows UDP reachability collapsing at 08:58 and recovering at 09:19, matching a `tailscaled_home_derp_region_id` change in the metrics samples and a direct to relayed transition in the status snapshots. The UTC timeline lines this up with a scheduled security scan on the office network that a different team confirmed runs at 08:55.

Notice what you have and what you never needed: you have a mechanism (morning UDP disruption forcing a path change), a corroborated timeline, a bracketed reproduction support can inspect server side, and a changelog suspect you can now test by rolling node-b back or forward deliberately. You never needed a theory in hour one. The evidence produced the theory, which is the entire point: theories built from complete evidence kits tend to survive contact with reality, and theories built before them tend to consume it.

The habits to keep: both sides, always. Markers before memories. Versions before vibes. UTC before anecdotes. Stable IDs before hostnames. Snapshots in pairs. Metrics as arithmetic. Collect first; conclude later.

## Cross references

- Module 03 for what DERP relays, STUN probes, and path selection actually do, which turns your netcheck and status evidence into mechanism.
- Module 02 for the control plane's role, and why service side changes appear in the changelog with no client update.
- Module 09 for the platform matrix behind the per OS log locations and the three macOS variants.
- Module 10 for enterprise operations context, including fleet wide version management that makes the version matrix cheap to build.
- Module 11 for the diagnosis techniques that consume the evidence kit this module taught you to assemble.
- Module 12 for reading the client source when the logs name a code path and you want to know what it means.
