---
slug: handoff-package
title: The handoff package
description: The canonical template for escalating a confirmed product issue to engineering so that zero follow up questions are needed.
track: fieldcraft
order: 3
words: 3500
sources:
  - id: bugreport
    url: https://tailscale.com/docs/account/bug-report
    title: Generate a bug report
    checked: 2026-08-10
  - id: cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-10
  - id: derp
    url: https://tailscale.com/docs/reference/derp-servers
    title: DERP servers
    checked: 2026-08-10
  - id: connection-types
    url: https://tailscale.com/docs/reference/connection-types
    title: Connection types
    checked: 2026-08-10
---

## The most expensive thing in an escalation is a question

You have done the work. You reproduced the issue, or at least cornered it. You know it is real, you know it is not the Customer's firewall, and you know it needs an engineering team. Now comes the moment where most investigations lose a week: the handoff.

Here is the arithmetic that this page exists to fix. An escalation that provokes a question costs one round trip. A round trip between a field team and an engineering team is rarely minutes. It is usually a day: the question sits in a queue, the answer requires going back to the Customer, the Customer's admin is in another timezone, and by the time the answer lands, the engineer has swapped the problem out of their head. Four missing fields is four round trips. Four round trips is a week, and a week is enough time for the issue to stop reproducing, for the logs to age out of everyone's attention, and for the Customer to conclude that nobody is driving.

The handoff package is the countermeasure. It is a single document, written once, that answers every question the receiving engineer would otherwise have to ask. The test is brutal and simple: if the engineer has to reply with anything other than "acknowledged, investigating," the package failed.

<div class="diagram-wrap">
<svg viewBox="0 0 880 400" role="img" aria-label="Comparison of a thin escalation costing four round trips over six days versus a complete handoff package where work starts on day one">
  <title>Round trip cost: thin escalation versus handoff package</title>
  <rect x="10" y="10" width="420" height="380" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <rect x="450" y="10" width="420" height="380" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="220" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="16" font-weight="bold">Thin escalation</text>
  <text x="660" y="40" text-anchor="middle" fill="var(--diagram-text)" font-size="16" font-weight="bold">Handoff package</text>
  <rect x="30" y="60" width="110" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="85" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Field</text>
  <rect x="300" y="60" width="110" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="355" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Engineering</text>
  <line x1="140" y1="120" x2="300" y2="120" stroke="var(--diagram-line)"/>
  <text x="220" y="114" text-anchor="middle" fill="var(--diagram-text)" font-size="11">"DERP is slow"</text>
  <line x1="300" y1="150" x2="140" y2="150" stroke="var(--diagram-line)"/>
  <text x="220" y="144" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Day 2: which versions?</text>
  <line x1="140" y1="185" x2="300" y2="185" stroke="var(--diagram-line)"/>
  <line x1="300" y1="215" x2="140" y2="215" stroke="var(--diagram-line)"/>
  <text x="220" y="209" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Day 3: which nodes? logs?</text>
  <line x1="140" y1="250" x2="300" y2="250" stroke="var(--diagram-line)"/>
  <line x1="300" y1="280" x2="140" y2="280" stroke="var(--diagram-line)"/>
  <text x="220" y="274" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Day 5: can you repro?</text>
  <line x1="140" y1="315" x2="300" y2="315" stroke="var(--diagram-line)"/>
  <text x="220" y="345" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Work starts: day 6, context decayed</text>
  <rect x="470" y="60" width="110" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="525" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Field</text>
  <rect x="740" y="60" width="110" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="6"/>
  <text x="795" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Engineering</text>
  <line x1="580" y1="120" x2="740" y2="120" stroke="var(--diagram-accent)" stroke-width="3"/>
  <text x="660" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="11">one package, nine fields</text>
  <rect x="560" y="150" width="200" height="150" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="6"/>
  <text x="660" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="11">summary, versions, repro,</text>
  <text x="660" y="195" text-anchor="middle" fill="var(--diagram-text)" font-size="11">evidence, markers, scope,</text>
  <text x="660" y="215" text-anchor="middle" fill="var(--diagram-text)" font-size="11">ruled out, owning area,</text>
  <text x="660" y="235" text-anchor="middle" fill="var(--diagram-text)" font-size="11">context links</text>
  <text x="660" y="270" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-weight="bold">zero questions</text>
  <text x="660" y="345" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Work starts: day 1, context intact</text>
</svg>
</div>

## The nine fields, and the round trip each one kills

The template has nine fields. None are decorative. Each one exists because its absence generates a specific, predictable question, and the discipline of this method is that you answer the question before it is asked.

**1. One line summary.** The first sentence the engineer reads determines which mental model they load. "Relayed traffic through one DERP region degraded for all node pairs that cannot go direct" loads the right model instantly. "Customer says Tailscale is slow" loads nothing. The summary states what is broken, where, and for whom, in one line. The round trip it kills: "what is this actually about?"

**2. Environment and version matrix.** Every node that appears in the evidence, with its OS, its Tailscale client version, and its role. A matrix, not prose, because engineers scan matrices and skim prose. Version skew is itself diagnostic: if the issue appears on 1.82.0 and 1.84.1 alike, a recent client regression is unlikely, and you have just saved someone a changelog dive. The round trip it kills: "what versions are involved?" which is reliably the first question asked when this field is missing.

**3. Reproduction, or best known trigger.** The exact steps, commands included, that make the issue appear, with the observed and expected result. If you cannot reproduce it on demand, say so explicitly and give the best known trigger instead: what conditions were present every time it happened. An honest "intermittent, but always during X" is far more useful than a vague "sometimes happens." The round trip it kills: "how do I see this myself?"

**4. Log evidence.** Exact timestamps with timezone, the node identifier each log line came from, and bugreport markers (covered in detail below). Not an attachment of ten thousand lines: the specific lines that show the failure, quoted, with a pointer to where the rest lives. The round trip it kills: "can you send logs?" which is the single most common and most expensive follow up in existence, because it usually requires going back to the Customer.

**5. Impact scope.** How many nodes, which Customers, whether a workaround exists, and whether the workaround is acceptable or merely tolerated. Scope is what turns triage from guesswork into arithmetic. "14 nodes, one Customer, workaround exists but doubles latency" is a priority decision an engineering lead can make in ten seconds. The round trip it kills: "how bad is this?"

**6. What has been ruled out, and HOW.** This is the field that separates a professional package from a complaint. Every ruled out item names the evidence that rules it out. "Not the Customer's ISP: an independent probe from cloud-1 on a different provider shows identical latency to the same region." An assertion without evidence will be re-tested by the engineer, which means your work gets done twice, which means the field was worthless. The round trip it kills: "did you check the obvious things?" and, worse, the silent round trip where the engineer re-checks them anyway.

**7. Proposed owning area.** Data plane, control plane, DNS, a specific platform, DERP infrastructure. You are closer to the evidence than anyone else at the moment of handoff, and your routing guess, stated with its reasoning, gets the package to the right team on the first hop. Be explicit that it is a proposal. A wrong guess with visible reasoning is still useful, because the reasoning shows the receiving engineer what you saw. The round trip it kills: the days a ticket spends bouncing between teams that each conclude "not ours."

**8. Links that keep context.** The ticket, the Customer thread, the prior related issue. Escalations outlive people's attention. When this issue resurfaces in three months, the package must be the trailhead that leads to everything else. The round trip it kills: "is there history on this?"

**9. Bugreport markers as first class evidence.** Listed separately from general logs because they are the mechanism by which the vendor's support and engineering teams locate the diagnostic record on their side. A package about a Tailscale issue without a marker is a package that forces someone to go back to the Customer and ask them to run one more command. Details next.

> [!FROM-THE-FIELD]
> A useful self test before you hit send: read your own package pretending you have never seen this Customer, this network, or this ticket. Every place you find yourself relying on something in your head rather than something on the page is a round trip you are about to bill to someone else. The package is done when a stranger could start work from it.

## Evidence mechanics: markers, not log dumps

The evidence field is where packages most often fail, so it deserves its own mechanics section. Tailscale gives you a purpose-built tool for exactly this handoff: `tailscale bugreport`, available in the CLI since v1.8.

Running `tailscale bugreport` on an affected node generates a random identifier and stamps it into the node's diagnostic logs. The identifier looks like this:

```
BUG-1b7641a16971a9cd75822c0ed8043fee70ae88cf05c52981dc220eb96a5c49a8-20210427151443Z-fbcd4fd3a4b7ad94
```

Note the middle segment: it encodes the UTC timestamp of when the marker was created. That timestamp is part of the evidence.

> [!HOW-IT-WORKS]
> The marker is a bookmark, not a payload. It carries the public key for the device's logs, the creation time, and a random number, and it shares no personally identifiable information by itself. It does nothing unless you actually hand the identifier to the vendor's team, who use it to locate and triage the diagnostic logs on their backend. This is why a marker pasted into a handoff package is worth more than a log attachment: it points at the full diagnostic record at exactly the moment that matters, without you having to guess which lines to export.

Two flags change what the marker captures, and both belong in your field kit:

- `--diagnose` prints additional verbose system information into the Tailscale logs after generating the identifier. Use it when the issue smells environmental (routes, interfaces, platform state), because it gives the receiving engineer a system snapshot to read against the logs.
- `--record` creates a paired set of identifiers: the command pauses, you reproduce the issue while it waits, then you press Enter and it generates a second marker. The two markers bracket the reproduction window. Share both. For an intermittent or triggerable issue, this converts "somewhere in these logs" into "between these two bookmarks."

> [!GOTCHA]
> Timing is the whole game. Tailscale's own guidance is to run the command on the device experiencing the issue at the time you encounter it, because that is when the diagnostics are accurate. A bugreport run two days after the incident marks two days after the incident. If the issue is live right now and you do only one thing before touching anything else, run `tailscale bugreport` on an affected node and paste the marker into the ticket with the local symptom you saw at that moment. You can build the rest of the package afterward; you cannot retroactively place the bookmark.

<div class="diagram-wrap">
<svg viewBox="0 0 880 330" role="img" aria-label="Flow of a bugreport marker from an affected node through the diagnostic log stream to the vendor engineer, including a record window bracketed by two markers">
  <title>How a bugreport marker indexes the diagnostic record</title>
  <rect x="20" y="40" width="150" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="95" y="65" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a</text>
  <text x="95" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tailscale bugreport</text>
  <line x1="170" y1="70" x2="280" y2="70" stroke="var(--diagram-accent)" stroke-width="2"/>
  <rect x="280" y="40" width="220" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" rx="8"/>
  <text x="390" y="65" text-anchor="middle" fill="var(--diagram-text)" font-size="12">marker: BUG-...Z-...</text>
  <text x="390" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="11">stamped into diagnostic logs</text>
  <line x1="500" y1="70" x2="610" y2="70" stroke="var(--diagram-line)"/>
  <rect x="610" y="40" width="250" height="60" fill="var(--diagram-bg)" stroke="var(--diagram-line)" rx="8"/>
  <text x="735" y="65" text-anchor="middle" fill="var(--diagram-text)" font-size="12">vendor support / engineering</text>
  <text x="735" y="85" text-anchor="middle" fill="var(--diagram-text)" font-size="11">locates logs by identifier</text>
  <text x="440" y="150" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-weight="bold">with --record: two markers bracket the reproduction</text>
  <line x1="60" y1="220" x2="820" y2="220" stroke="var(--diagram-line)"/>
  <text x="440" y="245" text-anchor="middle" fill="var(--diagram-text)" font-size="11">diagnostic log timeline</text>
  <line x1="250" y1="185" x2="250" y2="255" stroke="var(--diagram-accent)" stroke-width="3"/>
  <text x="250" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="11">marker 1: start</text>
  <line x1="630" y1="185" x2="630" y2="255" stroke="var(--diagram-accent)" stroke-width="3"/>
  <text x="630" y="175" text-anchor="middle" fill="var(--diagram-text)" font-size="11">marker 2: end</text>
  <rect x="250" y="200" width="380" height="40" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-dasharray="6 4"/>
  <text x="440" y="290" text-anchor="middle" fill="var(--diagram-text)" font-size="12">reproduce the issue inside the window, share both identifiers</text>
</svg>
</div>

The markers carry the vendor-side record. Your package still needs the client-side observations that frame them, and three CLI commands supply almost all of it:

- `tailscale netcheck` reports the physical network conditions: whether UDP works, IPv4 and IPv6 reachability, NAT behavior indicators such as `MappingVariesByDestIP`, and a per-region DERP latency table with lines like `sea: 24.2ms (Seattle)`. For any relay-shaped issue this table is your primary quantitative evidence.
- `tailscale status` shows, for each peer, whether the connection is direct or relayed; a relayed peer's line names the DERP server in use by its code, for example `relay "fra"`. This is how you prove which pairs were on the relay path. One version note for 2025 and later clients: a connection can also show `peer-relay`, meaning it rides a peer relay device rather than DERP; the worked example below is DERP only.
- `tailscale ping <peer>` diagnoses the path to one peer. By default it keeps pinging until a direct connection is established (the `--until-direct` behavior, on by default), which cleanly separates "relay is slow" from "everything is slow," and `--icmp` tests at the ICMP level through WireGuard without involving the local host OS stack.

> [!ON-THE-WIRE]
> Read the netcheck DERP table like a race result, not a scoreboard. Each client selects its home DERP region based on measured latency and reports that selection to the coordination server, which shares it with peers. So the interesting evidence is rarely one number; it is the shape. One region suddenly slower than its neighbors, on multiple nodes, from multiple networks, is a regional story. All regions slower from one node is a local story. Capture the whole table, from more than one vantage point, and let the shape testify.

## The empty template

Copy this into the escalation verbatim. Fill every field. If a field is genuinely unknown, write "unknown" and one line on what you tried, because a visible unknown is information and a missing field is a question.

```
ESCALATION: <one line: what is broken, where, for whom>

ENVIRONMENT / VERSION MATRIX
| node    | role              | OS       | tailscale version | network position        |
|---------|-------------------|----------|-------------------|-------------------------|
|         |                   |          |                   |                         |

REPRODUCTION (or best known trigger)
Steps:
  1.
  2.
Observed:
Expected:
Reliability: <always / intermittent, with best known trigger conditions>

LOG EVIDENCE
Timezone of all timestamps: <UTC recommended>
Bugreport markers (node, moment, marker):
  -
Key log lines / command output (quoted, with node + timestamp):
  -

IMPACT SCOPE
Nodes affected: <count and which>
Customers affected: <which Customers, how visibly>
Workaround: <exists / none; if exists, what it costs>

RULED OUT (each item names its evidence)
  - <hypothesis>: ruled out by <specific evidence>
  - <hypothesis>: ruled out by <specific evidence>

PROPOSED OWNING AREA
<data plane / control plane / DNS / DERP infrastructure / specific platform>
Reasoning: <one or two lines>

CONTEXT LINKS
Ticket:
Customer thread:
Related prior issues:
```

## Worked example: regional DERP latency

Everything below is a constructed example with fictional nodes, a fictional Customer, and illustrative numbers, but the shape is exactly what a real package should look like. The scenario: a Customer's two sites communicate over Tailscale, most node pairs sit behind hard NAT and therefore ride the DERP relay, and one morning every relayed pair between the sites degrades at once.

```
ESCALATION: Relayed traffic homed to the Frankfurt DERP region degraded
~10x (18ms to ~180ms) for all node pairs using the relay; direct pairs
unaffected; onset 2026-08-10 06:40 UTC.

ENVIRONMENT / VERSION MATRIX
| node     | role                        | OS           | tailscale version | network position               |
|----------|-----------------------------|--------------|-------------------|--------------------------------|
| node-a   | site 1 app server           | Ubuntu 24.04 | 1.82.0            | behind hard NAT, no port map   |
| node-b   | site 2 admin laptop         | macOS 15     | 1.84.1            | behind hard NAT, office wifi   |
| lab-vm-1 | site 1 test VM              | Debian 12    | 1.84.1            | same LAN as node-a             |
| cloud-1  | independent probe, same city| Ubuntu 24.04 | 1.84.1            | public IP, different provider  |

REPRODUCTION (or best known trigger)
Steps:
  1. From node-b, run: tailscale ping node-a
     (pair is relayed; the node-a peer line in tailscale status names
     the Frankfurt DERP code as its relay)
  2. Compare with: tailscale ping lab-vm-1 from node-a (direct pair,
     confirmed with tailscale ping --until-direct)
Observed: relayed pair round trips ~175-190ms; direct pair ~2ms,
unchanged from baseline.
Expected: relayed pair baseline was 17-19ms for the past 90 days
(Customer's own monitoring).
Reliability: always, continuously, since onset. Not intermittent.

LOG EVIDENCE
Timezone of all timestamps: UTC
Bugreport markers (node, moment, marker):
  - node-a, during degradation, plain run:
    BUG-4f2a9c1d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b-20260810070212Z-9c8b7a6f5e4d3c2b
  - node-b, --record pair bracketing a 5 minute reproduction window:
    BUG-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b-20260810071505Z-0f1e2d3c4b5a6978
    BUG-8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d-20260810072031Z-7a6b5c4d3e2f1a0b
Key command output (quoted, node + timestamp):
  - node-a, 07:00Z, tailscale netcheck DERP latency excerpt:
      fra: 178.4ms (Frankfurt)     [baseline last week: ~15ms]
      nue: 21.7ms (Nuremberg)
      lhr: 24.9ms
  - node-b, 07:05Z, same shape: fra ~182ms, neighboring regions normal.
  - cloud-1, 07:10Z, different ISP, same city: fra 176.9ms. Same shape.
  - node-b, 07:15Z, tailscale status: peer node-a shown as relayed,
    with the Frankfurt DERP code named on its peer line, not direct.

IMPACT SCOPE
Nodes affected: 14 (all site 1 / site 2 pairs that cannot establish a
direct connection; 3 direct pairs unaffected).
Customers affected: one, Meridian Logistics (fictional). Their
inter-site file sync and admin SSH visibly degraded; they have opened
their own internal incident.
Workaround: none clean. Opening a firewall port mapping at site 1 lets
some pairs go direct, but the Customer's security team has not approved
it; not viable as more than a stopgap.

RULED OUT (each item names its evidence)
  - Customer ISP or local network degradation: ruled out by cloud-1,
    an independent probe on a different provider in the same city,
    showing the same ~10x latency to the same single region while its
    latency to neighboring regions stayed normal.
  - Client version regression: ruled out because 1.82.0 (node-a) and
    1.84.1 (node-b, lab-vm-1, cloud-1) show identical symptoms, and
    package manager history shows no client upgrades within 2 weeks
    of onset.
  - General data plane / WireGuard problem: ruled out because direct
    pairs (node-a to lab-vm-1, confirmed direct via
    tailscale ping --until-direct) show unchanged ~2ms round trips.
  - Control plane involvement: no evidence of it. Netmap updates, key
    activity, and admin console changes all propagate normally; only
    relayed forwarding latency changed.
  - DNS: ruled out because affected connections are by Tailscale IP as
    well as by name, with identical results.

PROPOSED OWNING AREA
DERP infrastructure (data plane relay), Frankfurt region specifically.
Reasoning: the degradation is isolated to one relay region, visible
identically from three networks and two providers, while direct
WireGuard paths and the control plane are healthy. Everything the
client controls has been eliminated with evidence above.

CONTEXT LINKS
Ticket: SUP-20817 (fictional)
Customer thread: Meridian Logistics incident channel, pinned summary
Related prior issues: SUP-19244, a transient single-region latency
event in March, closed without root cause. Possibly the same shape.
```

Walk back through that package and notice what is absent: any question an engineer would need answered before starting. The version matrix preempts "what versions." The paired `--record` markers preempt "can you send logs" and bracket a five minute window instead of a haystack. The cloud-1 probe preempts "is it the Customer's network." The direct-pair measurements preempt "is WireGuard itself slow." The owning area proposal, with its reasoning shown, routes it to the relay infrastructure owners on the first hop instead of the third.

Notice also what the ruled out section does not do: it does not say "we checked DNS, it is fine." It names the test. That distinction is the difference between evidence and reassurance, and engineers act only on the first.

## Assembling it under pressure

The template looks like paperwork until an incident is live, at which point the order of operations matters, because some evidence is perishable and some is not.

Capture the perishable evidence first, while the issue is occurring: bugreport markers on affected nodes (with `--record` around a reproduction if you can trigger one), the netcheck table from at least two vantage points, and the status output proving which pairs ride the relay. All of that takes under five minutes and cannot be recreated after the incident clears.

The durable evidence can wait an hour: the version matrix, the impact count, the context links, the write-up of what you ruled out. Do the perishable capture during the incident, then assemble the package once, calmly, and send it complete. A half package sent fast, followed by three corrections, costs more round trips than a whole package sent ninety minutes later, because every correction restarts the receiving engineer's read.

One final rule: the package is also for you. Six weeks from now, when a similar shape appears at a different Customer, the package you wrote is the searchable record that turns "this feels familiar" into "this is SUP-20817 again, and here is what ruled everything else out last time." Write it well enough that future you sends a thank you.

## Cross references

- Module 03 covers what DERP relays actually do, how a client selects its home region, why hard NAT pairs end up relayed, and what a Peer Relay changes, which is the mechanism behind the worked example.
- Module 02 explains the coordination server's role in distributing the DERP map and sharing each device's relay selection, useful when arguing an issue is not control plane.
- Module 11 covers the broader troubleshooting toolkit that feeds the evidence section, including netcheck, status, and ping in depth.
- Module 06 matters when your ruled out section needs to eliminate MagicDNS with evidence rather than assertion.
- Module 09 helps you write the environment matrix accurately when the affected fleet spans platforms.
- Module 10 covers the operational context (Customer scale, admin workflows) that sharpens the impact scope field.
