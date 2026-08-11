---
slug: docker-node-multiplies
title: The Docker node registers as a brand new machine on every restart
description: A containerized Tailscale node with no persistent state volume loses its identity on every restart, littering the tailnet with dead machine entries and burning through auth keys.
area: platform
difficulty: 1
symptom: "Our admin console has 14 copies of the same container node, and this morning the auth key stopped working and the service went down."
words: 1250
sources:
  - id: kb-docker
    url: https://tailscale.com/docs/features/containers/docker
    title: Docker
    checked: 2026-08-10
  - id: docs-docker-params
    url: https://tailscale.com/docs/features/containers/docker/docker-params
    title: Docker configuration parameters
    checked: 2026-08-10
  - id: kb-auth-keys
    url: https://tailscale.com/kb/1085/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: kb-ephemeral
    url: https://tailscale.com/kb/1111/ephemeral-nodes
    title: Ephemeral nodes
    checked: 2026-08-10
  - id: src-containerboot
    url: https://github.com/tailscale/tailscale/blob/main/cmd/containerboot/tailscaled.go
    title: tailscale/tailscale cmd/containerboot (tailscaled arguments)
    checked: 2026-08-10
---

## The ticket

The Customer runs a web service with a `tailscale/tailscale` sidecar container so internal tools can reach it over the tailnet (kb-docker). It works, mostly. But the machine list has grown a graveyard: web-1, web-1-1, web-1-2, on up to web-1-13, all but one permanently offline. Someone has been deleting them by hand every week. This morning the container restarted during a host patch, failed to authenticate, and the service dropped off the tailnet entirely, which turned a cosmetic annoyance into an outage ticket.

> "Every time the container restarts we get a new machine in the console. We have been cleaning them up by hand, but today it could not log in at all and now nothing can reach the service."

## Evidence provided

The deployment command, from the Customer's runbook:

```
docker run -d --name ts-sidecar \
  -e TS_AUTHKEY=tskey-auth-REDACTED \
  -e TS_HOSTNAME=web-1 \
  --cap-add=NET_ADMIN --device /dev/net/tun \
  tailscale/tailscale:stable
```

The machine list, trimmed:

```
web-1       100.64.0.51   linux   last seen Jun 30 (offline)
web-1-1     100.64.0.58   linux   last seen Jul 8  (offline)
web-1-2     100.64.0.64   linux   last seen Jul 15 (offline)
...
web-1-13    100.64.0.97   linux   last seen Aug 10 (offline)
```

Container logs from this morning's failed restart:

```
boot: 2026/08/10 03:12:04 Starting tailscaled
boot: 2026/08/10 03:12:04 Waiting for tailscaled socket at /tmp/tailscaled.sock
boot: 2026/08/10 03:12:05 Running 'tailscale up'
backend error: invalid key: API key does not exist
```

The `Running 'tailscale up'` line on the fourteenth start of the same container is the whole case, if you know what it means. Unless `TS_AUTH_ONCE` is set, containerboot forcibly logs in every time the container starts, and this daemon has no stored login to make that a no-op.

## Hypothesis tree

Duplicated machines with the same base hostname have three candidate explanations.

<div class="diagram-wrap">
<svg viewBox="0 0 760 330" role="img" aria-label="Hypothesis tree for a container re-registering as a new machine"><title>Hypothesis tree: container node multiplies on restart</title><rect x="225" y="12" width="310" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="32" text-anchor="middle" fill="var(--diagram-text)" font-size="13">New machine entry on every restart</text><text x="380" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="11">web-1, web-1-1, ... web-1-13</text><line x1="380" y1="58" x2="130" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="380" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="630" y2="120" stroke="var(--diagram-line)"/><rect x="20" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">A. Same node flapping,</text><text x="130" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">console renaming it</text><rect x="270" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">B. Auth key type forces</text><text x="380" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">a fresh identity per login</text><rect x="520" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="630" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">C. Node state not persisted,</text><text x="630" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">identity lost with container</text><line x1="130" y1="184" x2="130" y2="224" stroke="var(--diagram-line)"/><line x1="380" y1="184" x2="380" y2="224" stroke="var(--diagram-line)"/><line x1="630" y1="184" x2="630" y2="224" stroke="var(--diagram-line)"/><rect x="20" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: entries have</text><text x="130" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">distinct IPs and creation dates,</text><text x="130" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">so they are different nodes</text><rect x="270" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: key type controls</text><text x="380" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">reuse and cleanup, not whether</text><text x="380" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">an existing identity is kept</text><rect x="520" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="630" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: docker inspect</text><text x="630" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">shows no volume mount and no</text><text x="630" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">TS_STATE_DIR; state dies on stop</text></svg>
</div>

## Investigation

1. **Read the machine list closely.** Each web-1-N entry has its own tailnet IP and its own creation date, one per container restart. A single flapping node keeps one identity and one IP; these are fourteen different nodes. That rules out hypothesis A: the console is not renaming anything, it is deduplicating hostnames because a genuinely new machine keeps arriving with the name web-1 already taken.

2. **Inspect the container for persistent state.**

    ```
    $ docker inspect ts-sidecar --format '{{json .Mounts}}'
    []
    ```

    No volumes at all, and the run command sets no `TS_STATE_DIR`. That combination is decisive. With neither `TS_STATE_DIR` nor a Kubernetes state Secret configured, containerboot starts the daemon with `--state=mem: --statedir=/tmp`, so tailscaled holds its state in memory and loses it when the process ends (src-containerboot). The documentation is blunt about the consequence: this directory "must persist across container restarts or your container will appear as a new node each time" (docs-docker-params).

3. **Confirm the mechanism in the logs.** `Running 'tailscale up'` at boot, on the 14th start of the same container, with no stored login to short-circuit it. The daemon starts empty every time, so it registers as a new node every time. This rules out hypothesis B: the auth key is how a new node proves it may join (kb-auth-keys); it is not where an existing node's identity lives. No key type would have preserved web-1.

4. **Audit the key itself for this morning's outage.** The key in the runbook was created 90 days ago. Auth keys expire after a user-specified duration between 1 and 90 days, and 90 is the maximum (kb-auth-keys). The key aged out overnight, the restart needed to re-register because of the missing state, and re-registration failed. Two findings, one root: if the node had kept its identity, this morning's restart would not have needed an auth key at all.

## Root cause

A Tailscale node's identity is its node key and login state, which `tailscaled` keeps in its state directory. In the official container image that location is set with `TS_STATE_DIR`, which "specifies where `tailscaled` stores its state," and it has to be backed by a persistent volume, because "the `TS_STATE_DIR` volume ensures the container keeps its identity across restarts" (docs-docker-params). This runbook set neither, so containerboot fell back to `--state=mem:` and the daemon kept its identity in memory only (src-containerboot). Every fresh start was therefore a fresh daemon with no identity: register with the control plane (Module 02), get a new node key and a new tailnet IP, collide with the old hostname, become web-1-N. The old entries never disappear because non-ephemeral nodes are expected to return; the control plane has no way to know they are corpses. The auth key burn is the same defect seen from the identity side (Module 04): every restart spends registration again, so key lifetime becomes service uptime. Platform lesson for Module 09: containers are the one platform where durable identity requires an explicit decision.

> [!HOW-IT-WORKS]
> Auth keys and node identity are different objects. The key answers "may this new machine join the tailnet" (kb-auth-keys). The state directory answers "which machine is this," and it is the thing that "ensures the container keeps its identity across restarts" (docs-docker-params). A node that loses that state is a stranger no matter which key it holds.

## Fix and prevention

**Immediate.** Add the volume and state directory, per the Docker configuration parameters documentation (docs-docker-params):

```
docker run -d --name ts-sidecar \
  -v ts-state:/var/lib/tailscale \
  -e TS_STATE_DIR=/var/lib/tailscale \
  -e TS_AUTHKEY=tskey-auth-NEWKEY \
  -e TS_HOSTNAME=web-1 \
  --cap-add=NET_ADMIN --device /dev/net/tun \
  tailscale/tailscale:stable
```

Authenticate once with a fresh key, verify `docker restart ts-sidecar` brings back the same machine with the same IP and no new console entry, then delete the thirteen corpses.

**Durable.** Pick the right identity model per workload, deliberately:

- **Persistent state plus a tagged key** for long-lived service nodes like this one. Tagged devices get their key expiry disabled by default (kb-auth-keys), so a stable sidecar does not fall over on a key birthday. Stable identity, stable IP, ACLs stay meaningful.
- **Ephemeral keys** for truly disposable workloads: CI runners, batch jobs, scale-out replicas that are genuinely new each time. Ephemeral nodes are auto-removed "anywhere normally from 30 to 60 minutes after the last activity" (kb-ephemeral), so no graveyard forms; the cleanup the Customer was doing by hand is what ephemeral keys do by design.

The decision rule: if you would ever say "the same node came back," you want persistent state. If every instance is legitimately a new node, you want ephemeral.

> [!GOTCHA]
> A reusable key makes this bug quieter, not better. Restarts keep succeeding, so nobody investigates while the machine list rots and a powerful credential sits in a runbook; the documentation warns bluntly, "Be very careful with reusable keys! These can be very dangerous if stolen" (kb-auth-keys). A one-off key would have failed on the second restart and surfaced this defect months earlier.

## The handoff package

Not escalated (configuration defect), but as it would be filed:

- **Summary:** tailscale/tailscale sidecar registers as a new machine on every restart; TS_STATE_DIR unset and no state volume, so containerboot runs the daemon with `--state=mem:` and node state dies with the process. Secondary: runbook auth key hit the 90 day maximum, turning restart 14 into an outage.
- **Repro:** run the image with TS_AUTHKEY but no state volume; restart the container; observe a new machine entry and IP.
- **Log evidence:** 2026-08-10 03:12:05 UTC, container ts-sidecar on host lab-vm-1: `Running 'tailscale up'` then `backend error: invalid key: API key does not exist`. Machines web-1 through web-1-13, one per restart since Jun 30.
- **Version matrix:** tailscale/tailscale:stable (1.88.1), Docker 27.x, Linux host.
- **Impact scope:** one service offline; pattern present in every deployment cloned from this runbook.
- **Ruled out:** node flapping (distinct IPs and creation dates), key type as cause of duplication (identity lives in state, not keys), control plane fault (registration succeeds whenever the key is valid).
- **Proposed owning area:** Customer deployment configuration; no product defect.

## The trap

The weak investigation treats the machine list as the problem and deletes the dead entries every week: tidy console, defect untouched, and a slow burn of auth keys until an expiry lands during an outage window, which is exactly what happened here. The opposite overcorrection is just as bad: reaching for an ephemeral key to "stop the clutter" on a node that should be stable, which makes the service surrender its identity and tailnet IP on every restart and silently breaks anything pinned to the old address. Both traps come from fixing the visible artifact instead of asking the mechanism question: where does this node keep who it is, and does that location survive a restart?
