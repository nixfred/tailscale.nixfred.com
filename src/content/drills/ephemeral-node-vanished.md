---
slug: ephemeral-node-vanished
title: The CI runner that vanished between pipeline stages
description: A runner registered with an ephemeral auth key is auto removed during a long gap between pipeline stages while tailscaled was stopped, which is the documented ephemeral lifecycle doing its job.
area: identity
difficulty: 2
symptom: "Tailscale randomly kicks our runner off mid pipeline. It joined fine an hour ago. This is flaky."
words: 1400
sources:
  - id: kb-auth-keys
    url: https://tailscale.com/kb/1085/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: kb-ephemeral-nodes
    url: https://tailscale.com/kb/1111/ephemeral-nodes
    title: Ephemeral nodes
    checked: 2026-08-10
  - id: kb-github-action
    url: https://tailscale.com/kb/1276/tailscale-github-action
    title: Tailscale GitHub Action
    checked: 2026-08-10
  - id: controlclient-source
    url: https://github.com/tailscale/tailscale/blob/main/control/controlclient/direct.go
    title: tailscale/tailscale control/controlclient/direct.go
    checked: 2026-08-10
  - id: health-source
    url: https://github.com/tailscale/tailscale/blob/main/health/warnings.go
    title: tailscale/tailscale health/warnings.go
    checked: 2026-08-10
---

## The ticket

A platform team runs a three stage deploy pipeline on a long lived VM runner, lab-vm-1. Stage one builds, stage two runs integration tests against a staging server, cloud-1, reached over the tailnet, stage three deploys after a human clicks approve. The runner joins the tailnet with an auth key stored in CI secrets, and a teardown script stops tailscaled at the end of every stage "to keep the runner clean". Today the approval sat in the queue for two hours, and stage three failed with the runner unable to reach anything. Third occurrence this month, always on days with slow approvals. The Customer is ready to rip Tailscale out of the pipeline:

> "Tailscale randomly kicks our runner off mid pipeline. It joined fine an hour ago. This is flaky."

## Evidence provided

Stage two, 13:58, everything healthy:

```
[integration] $ sudo tailscale up --auth-key=tskey-auth-REDACTED --hostname=lab-vm-1
[integration] $ tailscale ip -4
[integration] 100.64.0.93
[integration] $ curl -fsS http://cloud-1.tail0ab12.ts.net:8080/healthz
[integration] ok
```

The teardown script that runs after every stage:

```
# stage-teardown.sh
systemctl stop tailscaled
```

Stage three, 16:22, after the approval gap:

```
[deploy] $ systemctl start tailscaled
[deploy] $ tailscale status
[deploy] Logged out.
[deploy] $ curl -fsS --max-time 10 http://cloud-1.tail0ab12.ts.net:8080/version
[deploy] curl: (6) Could not resolve host: cloud-1.tail0ab12.ts.net
```

The runner's journal for the stage three startup:

```
Aug 10 16:21:07 lab-vm-1 tailscaled[3151]: control: doLogin(regen=false, hasUrl=false)
Aug 10 16:21:08 lab-vm-1 tailscaled[3151]: health(warnable=login-state): error: You are logged out.
Aug 10 16:21:08 lab-vm-1 tailscaled[3151]: Switching ipn state NoState -> NeedsLogin (WantRunning=true, nm=false)
```

And the auth key's row in the admin console Keys page: **Reusable, Ephemeral, Pre-approved, Tags: tag:ci**.

## Hypothesis tree

"Flaky" is a symptom description, not a hypothesis. The real question is which layer removed the runner: the network, the policy, the key lifecycle, or the node lifecycle. Each branch predicts different evidence, and the strongest discriminator is the admin console machine list, because it distinguishes "present but blocked" from "gone entirely".

<div class="diagram-wrap">
<svg viewBox="0 0 780 330" role="img" aria-label="Hypothesis tree: CI runner off the tailnet at stage three, four branches, ephemeral removal confirmed">
<title>Hypothesis tree for the vanished CI runner</title>
<rect x="215" y="14" width="350" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="390" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">lab-vm-1 off the tailnet at stage three</text>
<text x="390" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="12">worked at 13:58, dead at 16:22</text>
<line x1="390" y1="66" x2="100" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="293" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="487" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="680" y2="130" stroke="var(--diagram-accent)"/>
<rect x="11" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="100" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Transient network</text>
<text x="100" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">NAT or DERP flake</text>
<rect x="204" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="293" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ACL change blocks</text>
<text x="293" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">runner from cloud-1</text>
<rect x="398" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="487" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Key expiry</text>
<text x="487" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">node or auth key aged out</text>
<rect x="591" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
<text x="680" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Ephemeral node removed</text>
<text x="680" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">by design while offline</text>
<text x="100" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">log says Logged out,</text>
<text x="100" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">not timeouts</text>
<text x="293" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">blocked node stays listed;</text>
<text x="293" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">machine absent entirely</text>
<text x="487" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">node was 2 hours old,</text>
<text x="487" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">defaults are in days</text>
<text x="680" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">key marked Ephemeral;</text>
<text x="680" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">daemon down 2h in a 30-60m window</text>
<text x="100" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 1</text>
<text x="293" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 2</text>
<text x="487" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 3</text>
<text x="680" y="258" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED: steps 4 to 5</text>
</svg>
</div>

## Investigation

1. **Read the failure mode, not the failure headline.** The stage three log does not show timeouts, retries, or relay fallbacks, which is what a NAT or DERP problem looks like (Module 03). It shows `Logged out.` and a MagicDNS resolution failure, which follows directly from not being on the tailnet at all (Module 06). This is an identity state, not a connectivity state. Network branch closed from the existing log alone.

2. **Check the admin console Machines page.** lab-vm-1 is not listed. Not expired, not offline: absent. An ACL change that blocked the runner would leave the machine listed and authenticated but unable to pass traffic. Absence from the machine list means the control plane removed or never had the registration. ACL branch closed (Module 05 is not in play).

3. **Check the key clocks.** Node key expiry defaults are measured in days and the node was two hours old; the auth key row shows it does not expire until 2026-09-30, and per kb-auth-keys an expired auth key would not have stranded this device anyway, since "any device authorized by it remains authorized until its node key expires". The journal carries no expiry message either. The daemon simply starts, tries to log in with the node key it has on disk, and lands in NeedsLogin. Expiry branch closed.

4. **Read the key's properties.** The Keys page shows the auth key is **Ephemeral**. Per kb-ephemeral-nodes, "ephemeral devices are auto-removed anywhere normally from 30 to 60 minutes after the last activity", a window the same page flags as subject to change (checked 2026-08-10). Now line up the timeline: teardown stopped tailscaled at 14:05, the approval landed at 16:20. The runner was offline for over two hours, roughly double the top of the removal window. The control plane deleted the node somewhere around 15:00, exactly as designed.

5. **Prove the mechanism.** Re-run the pipeline with the teardown script's `systemctl stop tailscaled` line commented out, and artificially hold the approval for two hours. The node stays online through the gap and stage three succeeds. Same key, same policy, same network. The only variable was whether the daemon stayed up. Confirmed.

## Root cause

Nothing malfunctioned. Ephemeral is a lifecycle contract with the control plane (Module 02): this node is disposable, so clean it up automatically once it goes offline. The KB positions ephemeral keys precisely for workloads like containers and cloud functions where node state does not persist (kb-auth-keys). The pipeline violated the contract from both sides: it used a disposable node identity for a runner it expected to persist, and it stopped the daemon between stages, converting a busy afternoon's approval delay into a two hour offline window. The control plane compared that window to its removal policy, normally 30 to 60 minutes after last activity (kb-ephemeral-nodes), and removed the machine. When stage three restarted tailscaled, the daemon's on disk state referenced a machine record that no longer existed, so the login attempt could not be completed with the key on disk and the client dropped to NeedsLogin (Module 04).

> [!HOW-IT-WORKS] Ephemeral cleanup is a control plane decision, not a client one. The node does not "log itself out"; the coordination server notices sustained offline status and deletes the machine record. That is also why `tailscale logout` removes an ephemeral node immediately (kb-ephemeral-nodes), and why the Tailscale GitHub Action deliberately logs out its ephemeral node the moment a workflow finishes (kb-github-action). Vanishing is the feature.

> [!GOTCHA] If an ephemeral node is recreated after removal, it comes back with a new IP address (kb-ephemeral-nodes). Any pipeline that caches a 100.x.y.z address between stages is broken twice: once by the removal, and again by the address change after re-registration. Address peers by MagicDNS name (Module 06), never by remembered tailnet IP.

## Fix and prevention

**Immediate fix, matching the runner that exists.** This runner is a persistent VM, so give it a persistent identity: mint a reusable, non ephemeral auth key carrying `tag:ci` (kb-auth-keys), re-register the runner once, and delete the `systemctl stop tailscaled` line from the teardown script. Tagging also means the node's key expiry is disabled by default, so the pipeline does not trade this incident for a key expiry incident in six months. The runner then stays on the tailnet across arbitrary approval gaps.

**Alternative shape, if stages must be isolated.** If each stage runs in its own fresh container, embrace the ephemeral design instead of fighting it: run `tailscale up` with the ephemeral key at the start of every stage and treat each stage as a brand new node with a brand new IP. This is exactly the model the Tailscale GitHub Action uses, joining as an ephemeral node per job and logging out at the end (kb-github-action). Budget for propagation: the Action documents using its ping parameter to wait for the new node to become reachable, up to about three minutes (kb-github-action).

**Prevention.** Make key type a deliberate choice reviewed in pipeline code review: ephemeral keys for infrastructure that is born and dies with a job, reusable tagged keys for infrastructure that outlives one. Write the 30 to 60 minute removal window into the team's CI runbook, flagged as subject to change, and alert if the runner's machine record disappears while a pipeline is mid flight.

## The handoff package

**Summary:** lab-vm-1 (ephemeral node, tag:ci) auto removed from tailnet during a 2h15m offline gap between pipeline stages; documented ephemeral lifecycle, not a service defect.
**Repro:** (1) Register a node with an ephemeral auth key. (2) Stop tailscaled for over an hour. (3) Start tailscaled: control returns "node not found", client enters NeedsLogin, machine absent from admin console.
**Log evidence:** 13:58:12Z joined as 100.64.0.93; 14:05:03Z teardown stopped tailscaled; 16:21:07Z `control: doLogin(regen=false, hasUrl=false)` then `health(warnable=login-state): error: You are logged out.` and `Switching ipn state NoState -> NeedsLogin` on lab-vm-1; machine absent from Machines page at 16:25Z.
**Version matrix:** runner Tailscale 1.86.4, Ubuntu 24.04 VM; staging node 1.86.4; auth key: reusable, ephemeral, pre-approved, tag:ci, expires 2026-09-30.
**Impact scope:** one pipeline, stage three only, and only on runs where approval latency exceeds roughly the documented removal window; two prior occurrences match slow approval days.
**Ruled out:** NAT and DERP path issues, ACL changes, node and auth key expiry, control plane outage.
**Proposed owning area:** none, working as designed; Customer side fix is key lifecycle selection.

## The trap

The weak investigation accepts "flaky" and treats the symptom: wrap the deploy stage in a retry loop, add a `sleep 30`, reduce the approval SLA so the gap rarely exceeds an hour. All of these make the failure intermittent instead of understood, which is strictly worse, because the pipeline now passes on fast days and fails on exactly the high stakes days when approvals are slow and people are careful. The opposite overcorrection is just as costly: declare ephemeral keys broken and switch every workload in the org to persistent keys, after which genuinely disposable CI containers stop cleaning up and the Machines page accumulates hundreds of dead entries that bury real signal. The discipline this drill teaches: when a node disappears, your first stop is the admin console machine list, and your second is the properties of the key that created the node. "Absent from the tailnet" plus "key marked Ephemeral" plus "offline longer than the removal window" is a complete explanation, and it was all readable in under ten minutes without touching the network stack once.
