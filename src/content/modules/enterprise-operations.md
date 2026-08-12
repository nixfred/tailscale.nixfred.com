---
module: 10
slug: enterprise-operations
title: Enterprise operations
description: How to run a tailnet at organization scale, covering admin surfaces, audit and flow logging, SCIM, roles, device approval, Tailnet Lock, GitOps for the policy file, and the Aperture AI gateway.
order: 10
words: 4400
sources:
  - id: audit-logging
    url: https://tailscale.com/docs/features/logging/audit-logging
    title: Configuration audit logs
    checked: 2026-08-10
  - id: flow-logs
    url: https://tailscale.com/docs/features/logging/network-flow-logs
    title: Network flow logs
    checked: 2026-08-10
  - id: log-streaming
    url: https://tailscale.com/docs/features/logging/log-streaming
    title: Log streaming
    checked: 2026-08-10
  - id: scim
    url: https://tailscale.com/docs/features/user-group-provisioning
    title: User and group provisioning
    checked: 2026-08-10
  - id: user-roles
    url: https://tailscale.com/docs/reference/user-roles
    title: User roles
    checked: 2026-08-10
  - id: tailnet-lock
    url: https://tailscale.com/docs/features/tailnet-lock
    title: Tailnet Lock
    checked: 2026-08-10
  - id: device-approval
    url: https://tailscale.com/docs/features/access-control/device-management/device-approval
    title: Device approval
    checked: 2026-08-10
  - id: api
    url: https://tailscale.com/docs/reference/tailscale-api
    title: Tailscale API
    checked: 2026-08-10
  - id: gitops
    url: https://tailscale.com/docs/gitops
    title: GitOps for the tailnet policy file
    checked: 2026-08-10
  - id: gitops-github
    url: https://tailscale.com/docs/integrations/github/gitops
    title: GitOps with GitHub Actions
    checked: 2026-08-10
  - id: aperture
    url: https://tailscale.com/docs/aperture/what-is-aperture
    title: What is Aperture?
    checked: 2026-08-10
  - id: aperture-blog
    url: https://tailscale.com/blog/aperture-self-serve
    title: Aperture by Tailscale is now self-serve
    checked: 2026-08-10
---

## The promise

1. You will be able to map every operational surface of the admin console (machines, users, access controls, DNS, logs) to the team that should own it, and assign the least-privileged role that covers each job.
2. You will be able to explain what configuration audit logs and network flow logs record, what they deliberately cannot record, and stream both into a SIEM or object storage.
3. You will be able to wire your identity provider into Tailscale with SCIM so that joiners, movers, and leavers are handled by the IdP, not by hand, and state precisely when a suspended user actually loses network access.
4. You will be able to describe how Tailnet Lock removes the coordination server from your trust boundary, why signing nodes and disablement secrets exist, and what recovery looks like.
5. You will be able to run the tailnet policy file as code through the public API and the gitops-acl workflow, with tests on pull requests and automatic apply on merge.
6. You will be able to explain what Aperture (Tailscale's 2026 AI gateway) does, and why it reuses the tailnet identity layer instead of distributing provider API keys.

## Foundation

You already run networks where the config lives in more than one head. You know the difference between the data plane (packets moving) and the management plane (humans and automation changing config), and you know the management plane is where organizations actually get hurt: an unreviewed firewall change, an ex-employee's still-valid VPN credential, a switch config edited live on the box with no record.

You also know the standard enterprise answers: RBAC so not everyone is root on the network, AAA and syslog so changes and flows are attributable, NetFlow/IPFIX for connection metadata, and configuration management (RANCID then Ansible then GitOps) so the intended state lives in version control instead of in device memory.

This module is those same disciplines translated into Tailscale terms. Two things carry over from earlier modules and matter constantly here. First, from Module 02: the coordination server is the policy and key distribution point, not a packet forwarder, so "managing the tailnet" means managing what the control plane believes. Second, from Module 04: users come from your identity provider, so user lifecycle is really an IdP integration problem.

## Core content

### The admin console: five surfaces, one control plane

The admin console is a web frontend to the coordination server's state. Operationally it decomposes into five surfaces:

- **Machines**: every node, its addresses, tags, key expiry, approval state, and advertised routes. This is where route approval and device approval happen.
- **Users**: every identity that has authenticated, their role, and their status (active, suspended). With SCIM enabled, much of this page becomes a read-only mirror of your IdP.
- **Access controls**: the tailnet policy file (ACLs or grants, covered in Module 05) with an editor, syntax checks, and tests.
- **DNS**: MagicDNS, your tailnet name, split DNS and global nameservers (Module 06).
- **Logs**: the configuration audit log viewer and the log streaming configuration.

The analogy: think of the console as the out-of-band management network for your overlay. Nothing you do there touches a packet directly; it changes what the control plane will tell nodes the next time they check in. The mechanism: every console action is an API call against the coordination server, executed with your user's role, and recorded in the configuration audit log. The failure mode: treating the console as the source of truth once you have adopted GitOps. The console will happily let an admin hand-edit the policy file that your pipeline believes it owns, and the pipeline's next apply will overwrite that edit. More on that below.

### Configuration audit logs: who changed the network

Configuration audit logs record modification events in the tailnet: who did what, to which resource, and when. Policy file edits include a full diff of old and new contents. Actors can be humans or automated systems. Read-only actions are not logged, and log retention is fixed at 90 days on Tailscale's side (all plans, on by default, cannot be disabled). If you need more than 90 days, and any compliance regime will, you stream them out (checked 2026-08-10).

Three ways to see the same idea. Analogy: this is the `show archive log config` of the tailnet, a commit log for the management plane. Mechanism: the coordination server appends an event for each mutating operation with a timestamp, action, actor, target, and diff; events triggered by one logical operation share an `eventGroupID` so you can reconstruct compound changes. You can read them in the console under Logs, or through the API with a token scoped `logs:configuration:read`, passing `start` and `end` times. Failure mode: assuming everything is in there. Changes initiated by Tailscale's support team are not currently included, and reads are not logged. Audit logs answer "what changed," not "who looked."

### Network flow logs: who talked to whom

Network flow logs are Tailscale's NetFlow analog. Each record is connection metadata: source and destination Tailscale IPs and ports, protocol, packet and byte counts in each direction, timestamps, plus node context. They categorize traffic by layer (virtual, subnet, exit, physical), so subnet router and exit node traffic is covered.

What they are not: packet capture. Tailscale cannot inspect your traffic; WireGuard payloads (Module 01) are encrypted end to end between nodes, so flow logs are generated client-side, each node reporting its own connection metadata. That also defines the trust model: there is no server-side validation, so a compromised node can lie in its own flow reports, and during an investigation you corroborate with the flow logs of the trustworthy peer on the other side of the connection.

Flow logs require clients v1.34 or later, are retained for the most recent 30 days, and are gated to the Premium and Enterprise plans (checked 2026-08-10). There is no console viewer: you read them via the API (`logs:network:read` scope) or stream them.

> [!ON-THE-WIRE] A flow log entry for an SSH session from node-a to node-b shows src `100.101.102.103:53412`, dst `100.104.105.106:22`, protocol 6, and byte counts. It does not show the SSH session content, does not show failed connection attempts (only successful connects are logged), and public internet addresses are not logged as source or destination unless you enable destination logging. Metadata only, by construction.

Failure mode: enabling flow logs and expecting a security camera. They record successful flows' metadata; no payloads, no failed attempts. They are for attribution and forensics ("which node moved 40 GB to the exit node on Tuesday"), not intrusion detection on their own.

### Log streaming: getting logs off the island

Both log types stream to external destinations: SIEMs (Splunk via HTTP Event Collector, Datadog, Elasticsearch Logstash, Axiom, Cribl, Panther, and HEC-compatible platforms) and object storage (Amazon S3 and S3-compatible stores such as Storj and Wasabi, Google Cloud Storage, Azure Blob Storage), plus Vector and private endpoints inside your tailnet so an internal collector never needs public exposure (private endpoints use MagicDNS hostnames or IPv6, not IPv4). Compression (zstd default, or gzip, or none) and upload frequency (1 minute to 24 hours, default 1 minute) are configurable. Log streaming is a Premium and Enterprise feature; configuring it requires Owner, Admin, Network admin, or IT admin (checked 2026-08-10).

The reasoning is retention and correlation. Tailscale holds audit logs 90 days and flow logs 30. Your SIEM is where tailnet events get joined against everything else you log, and your bucket is where they live for seven years if your auditor says so.

<div class="diagram-wrap">
<svg viewBox="0 0 720 300" role="img" aria-label="Log pipeline from tailnet events through log types to streaming destinations">
  <title>Tailnet log pipeline: sources, log types, destinations</title>
  <rect x="20" y="40" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Console + API edits</text>
  <rect x="20" y="200" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Client flow reports</text>
  <rect x="270" y="40" width="180" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="360" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Config audit log</text>
  <text x="360" y="78" text-anchor="middle" fill="var(--diagram-text)" font-size="11">90 days, all plans</text>
  <rect x="270" y="200" width="180" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="360" y="220" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Network flow log</text>
  <text x="360" y="238" text-anchor="middle" fill="var(--diagram-text)" font-size="11">30 days, Premium+</text>
  <rect x="550" y="30" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="625" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13">SIEM (HEC, etc)</text>
  <rect x="550" y="120" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="625" y="150" text-anchor="middle" fill="var(--diagram-text)" font-size="13">S3 / GCS / Blob</text>
  <rect x="550" y="210" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="625" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Private endpoint</text>
  <line x1="170" y1="65" x2="270" y2="65" stroke="var(--diagram-line)"/>
  <line x1="170" y1="225" x2="270" y2="225" stroke="var(--diagram-line)"/>
  <line x1="450" y1="65" x2="550" y2="55" stroke="var(--diagram-accent)"/>
  <line x1="450" y1="65" x2="550" y2="140" stroke="var(--diagram-accent)"/>
  <line x1="450" y1="225" x2="550" y2="150" stroke="var(--diagram-accent)"/>
  <line x1="450" y1="225" x2="550" y2="235" stroke="var(--diagram-accent)"/>
  <text x="500" y="30" text-anchor="middle" fill="var(--diagram-text)" font-size="11">stream (Premium+)</text>
</svg>
</div>

### SCIM: the IdP owns the user lifecycle

SCIM (System for Cross-domain Identity Management) is the protocol that lets your identity provider push user and group state into Tailscale. Supported IdPs are Okta, Microsoft Entra ID, and Google Workspace; the feature is available on the Standard, Premium, and Enterprise plans (checked 2026-08-10). A SCIM API key, generated in the admin console, serves the whole tailnet.

Analogy: without SCIM, Tailscale is a hotel where anyone with a company badge can check in, and checkout is manual. With SCIM, the HR system owns the guest list: hired means provisioned, terminated means suspended, and group membership follows you when you change teams. Mechanism: the IdP calls Tailscale's SCIM endpoint on lifecycle events. Provisioning creates or updates users; synced groups become referenceable in the policy file (for example `group:security-team@example.com`), which means access changes ride on IdP group membership with zero policy edits. Deprovisioning behavior is IdP-specific: Okta deactivation suspends the Tailscale user (Okta deletion does not sync); Entra ID soft delete suspends, with the hard delete syncing roughly 30 days later; Google Workspace suspension or deletion suspends. You cannot manually delete a synced user in Tailscale, because the next sync would just recreate them.

> [!GOTCHA] Suspension stops future authentication, but a suspended user's devices remain logged in and retain network access until their node keys expire. If offboarding must be immediate, do not stop at IdP deactivation: expire or delete the user's devices too. This is the single most common enterprise offboarding hole, and it is documented behavior, not a bug (checked 2026-08-10).

Failure mode beyond the key expiry gap: using one IdP app for both SSO and SCIM means only users assigned to that app can sign in at all, which surprises teams who expected domain-wide signup. And synced groups cannot assign console roles; roles remain a Tailscale-side setting.

### User roles: separating who runs what

Tailscale ships a fixed role set. On every plan you get Owner (the account's root; exactly one, transferable with limitations), Admin (full console control), and Member (network user, no console). On Standard, Premium, and Enterprise you additionally get Network admin (policy file, DNS, and network settings, read-only elsewhere), IT admin (users and devices: approvals, removals, general settings, no network config or billing), Billing admin (billing only, read-only elsewhere), and Auditor (read-only everything) (checked 2026-08-10).

The design maps to real org boundaries: the network team gets Network admin and cannot delete users; helpdesk gets IT admin and cannot edit the policy file; security and compliance get Auditor and can investigate without any blast radius. The mechanism is enforcement at the control plane: every console page and API call checks the caller's role. The failure mode is role inflation: granting Admin "temporarily" because a task straddled two roles, then never walking it back. The audit log records role changes, so make a habit of querying for them.

### Device approval at scale

Device approval, available on all plans, means a new node authenticates but stays blocked until an Owner, Admin, or IT admin approves it. Approval attaches to the physical device, not the (user, device) pair, so a shared workstation is approved once.

At scale, nobody clicks approve five hundred times. The mechanisms that make it scale: pre-approved auth keys (which an Owner, Admin, IT admin, or Network admin can generate) for fleets you image yourself; the device authorization API endpoint (`POST /api/v2/device/{deviceId}/authorized`) for programmatic approval; and the `nodeNeedsApproval` webhook, which lets you wire approval to your own logic, such as checking the device against an MDM inventory before calling the API to approve it. For requirements beyond "is this device known," device posture management layers on top.

> [!GOTCHA] Device approval and Tailnet Lock are mutually exclusive; the Tailnet Lock documentation lists device approval among its incompatibilities (checked 2026-08-10). They solve overlapping problems with different trust anchors: approval trusts an admin's console click, Tailnet Lock trusts signatures from nodes you control. Pick per tailnet, not per device.

### Tailnet Lock: removing the control plane from the trust boundary

Everything so far assumes the coordination server is honest. Module 02 showed that the control plane distributes node public keys: node-a trusts that the key it received for node-b is really node-b's because the coordination server said so. A compromised control plane (or a coerced operator) could therefore inject an attacker's key as "a new node" and join your network. Tailnet Lock exists to make that attack fail.

Analogy first: without Tailnet Lock, the control plane is a locksmith who both cuts keys and decides whose keys open your doors. Tailnet Lock demotes the locksmith to a courier: it still delivers keys, but each key must arrive in an envelope wax-sealed by someone in your own household, and every node checks the seal before trusting the key.

The mechanism: at initialization you designate signing nodes, at least 2 and at most 20. Each holds a Tailnet Lock key (TLK), a key pair separate from its node key; the private half never leaves the node. The tailnet key authority (TKA) is a signed, chained log of which TLK public keys are trusted, and every node in the tailnet keeps a copy. From then on, a node key distributed by the control plane is only honored by peers if it carries a valid signature from a trusted TLK. New nodes get signed via `tailscale lock sign` on a signing node, via signing links or QR codes in the macOS, Windows, and iOS apps, or in advance via pre-signed auth keys so provisioning pipelines need no post-hoc step. The control plane cannot forge these signatures because it never holds a TLK. That is the entire point: an attacker who owns the coordination server can distribute an unsigned key, but every honest node rejects it, so the attacker gets no WireGuard sessions with anyone.

> [!HOW-IT-WORKS] Trust shifts from "the server said so" to "a node I already trust signed it." This is trust-on-first-use bootstrapped into a chain: the initial signing nodes are trusted at initialization, and everything afterward must trace a signature path back to them through the TKA's log.

Recovery and disablement: initialization generates ten disablement secrets, long one-time passwords. Disabling Tailnet Lock requires presenting one, via console or CLI. Store them offline and separately; you can optionally deposit one with Tailscale support, and if you decline and lose all ten, there is no unlock path. Constraints worth knowing before rollout: 2 to 20 signing nodes, Android devices cannot be signing nodes, TLK rotation is limited to once per year (to bound TKA growth), availability is on the Personal and Enterprise plans, and Tailnet Lock does not protect against a compromised signing node or extraction of keys from an already-compromised device (checked 2026-08-10).

Failure mode: treating signing nodes as ordinary infrastructure. If all your signing nodes are laptops that get rebuilt, or VMs in one account that gets deleted, you can reach a state where no trusted TLK exists to sign anything new, and your only exit is a disablement secret. Treat signing nodes like offline CA material: few, durable, documented.

<div class="diagram-wrap">
<svg viewBox="0 0 720 330" role="img" aria-label="Tailnet Lock sequence showing a signed key accepted and an unsigned injected key rejected">
  <title>Tailnet Lock: signature check defeats a compromised control plane</title>
  <rect x="20" y="30" width="140" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="90" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="13">signing node</text>
  <rect x="290" y="30" width="140" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="360" y="52" text-anchor="middle" fill="var(--diagram-text)" font-size="13">control plane</text>
  <text x="360" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="11">(untrusted courier)</text>
  <rect x="560" y="30" width="140" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="630" y="58" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a (peer)</text>
  <line x1="90" y1="76" x2="90" y2="300" stroke="var(--diagram-line)"/>
  <line x1="360" y1="76" x2="360" y2="300" stroke="var(--diagram-line)"/>
  <line x1="630" y1="76" x2="630" y2="300" stroke="var(--diagram-line)"/>
  <line x1="90" y1="110" x2="360" y2="110" stroke="var(--diagram-accent)"/>
  <text x="225" y="102" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node-b key + TLK signature</text>
  <line x1="360" y1="150" x2="630" y2="150" stroke="var(--diagram-accent)"/>
  <text x="495" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">deliver signed key</text>
  <text x="630" y="185" text-anchor="end" fill="var(--diagram-text)" font-size="12">verify sig vs TKA: OK, peer trusted</text>
  <line x1="360" y1="230" x2="630" y2="230" stroke="var(--diagram-line)" stroke-dasharray="6 4"/>
  <text x="495" y="222" text-anchor="middle" fill="var(--diagram-text)" font-size="12">inject attacker key (no signature)</text>
  <text x="630" y="265" text-anchor="end" fill="var(--diagram-text)" font-size="12">verify sig: FAIL, key rejected</text>
  <text x="630" y="285" text-anchor="end" fill="var(--diagram-text)" font-size="12">no WireGuard session formed</text>
</svg>
</div>

### The public API and GitOps for the policy file

The public API automates what the console does: devices, keys, users, DNS, and the policy file. Authentication is either an API access token generated in the admin console (available to Owner, Admin, IT admin, Network admin; expiry configurable from 1 to 90 days, then you regenerate) or OAuth clients with fine-grained scopes, which are the right choice for automation because a leaked credential exposes only its scopes (checked 2026-08-10).

The flagship automation is GitOps for the tailnet policy file. The workflow, using Tailscale's `gitops-acl-action@v1` for GitHub Actions (Bitbucket and GitLab CI are also supported): the policy file lives in a repo (default path `policy.hujson`); pull requests trigger the action with `action: test`, which validates the file and runs your policy tests without applying anything; merge to main triggers `action: apply`, which validates, tests, and then pushes the policy to the control plane. Credentials arrive as repository secrets: `TS_TAILNET` plus one of three options: `TS_OAUTH_ID` and `TS_OAUTH_SECRET` for an OAuth client, `TS_API_KEY` for an API access token, or an OAuth client ID plus an audience for federated identity (workload identity federation, generally available as of 2026, checked 2026-08-10), which avoids storing any long-lived secret at all. If both OAuth and API key are supplied, the OAuth credentials win.

Why this matters is the same reason network teams left "configure the router by telnet" behind: review before change, tests as a gate, history as an audit trail, rollback as `git revert`. One behavior to internalize before adopting it: the sync is one-directional. Manual policy edits made in the admin console are not reflected back into the repo, and the next time the action runs `apply`, the repo's version overwrites them (checked 2026-08-10). That makes the pipeline the only legitimate writer, and it makes the audit log your reconciliation tool: every policy update is recorded with actor and a full old/new diff, so a console edit is never lost evidence, only lost deployment.

> [!FROM-THE-FIELD] The steady state that works: repo is the source of truth, console editor is read-only by convention, Network admin role for humans, a narrowly scoped OAuth client for the pipeline, and an audit log query for policy edits whose actor is not the pipeline's OAuth client. That last query is your drift alarm, because the pipeline itself will not warn you before it steamrolls a console edit.

Failure mode: scoping the pipeline credential too broadly. A CI system holding a full-permission API token is a tailnet-wide compromise waiting on one leaked secret. Scope the OAuth client to policy file access, nothing else.

<div class="diagram-wrap">
<svg viewBox="0 0 720 310" role="img" aria-label="GitOps flow for the tailnet policy file showing one-directional sync and console edits being overwritten">
  <title>gitops-acl workflow: test on PR, apply on merge, console edits overwritten</title>
  <rect x="20" y="30" width="130" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="85" y="60" text-anchor="middle" fill="var(--diagram-text)" font-size="13">pull request</text>
  <rect x="210" y="30" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="285" y="53" text-anchor="middle" fill="var(--diagram-text)" font-size="13">action: test</text>
  <text x="285" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="11">validate + ACL tests</text>
  <rect x="20" y="130" width="130" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="85" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="13">merge to main</text>
  <rect x="210" y="130" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="285" y="153" text-anchor="middle" fill="var(--diagram-text)" font-size="13">action: apply</text>
  <text x="285" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">OAuth client</text>
  <rect x="460" y="130" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="535" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="13">deployed policy</text>
  <rect x="460" y="240" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="535" y="263" text-anchor="middle" fill="var(--diagram-text)" font-size="13">console edit</text>
  <text x="535" y="280" text-anchor="middle" fill="var(--diagram-text)" font-size="11">out of band</text>
  <rect x="460" y="30" width="150" height="50" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="535" y="53" text-anchor="middle" fill="var(--diagram-text)" font-size="13">audit log</text>
  <text x="535" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="11">both writes recorded</text>
  <line x1="150" y1="55" x2="210" y2="55" stroke="var(--diagram-line)"/>
  <line x1="150" y1="155" x2="210" y2="155" stroke="var(--diagram-line)"/>
  <line x1="360" y1="155" x2="460" y2="155" stroke="var(--diagram-accent)"/>
  <text x="410" y="147" text-anchor="middle" fill="var(--diagram-text)" font-size="11">repo wins</text>
  <line x1="535" y1="240" x2="535" y2="180" stroke="var(--diagram-line)" stroke-dasharray="6 4"/>
  <text x="640" y="215" text-anchor="middle" fill="var(--diagram-text)" font-size="11">overwritten on</text>
  <text x="640" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="11">next apply</text>
  <line x1="535" y1="130" x2="535" y2="80" stroke="var(--diagram-accent)"/>
</svg>
</div>

### Aperture: the tailnet identity layer, pointed at AI

Aperture is Tailscale's AI gateway. It was introduced in early 2026 and became self-serve, still labeled an early alpha of an experimental product, on March 23, 2026; it can be purchased separately from the paid Tailscale plans (checked 2026-08-10, and expect this section to rot fastest).

Analogy: Aperture is to LLM provider APIs what an exit node is to the public internet, a single governed egress point, except this one also knows exactly who each request belongs to. Mechanism: Aperture is a reverse proxy between LLM clients (coding assistants, chat UIs, automated agents) and upstream providers (OpenAI, Anthropic, Gemini, plus OpenAI-compatible APIs). Because clients reach it over the tailnet, the request already carries a verified identity from Module 04's machinery, so Aperture identifies the user and device automatically, injects the real provider credential server-side, and routes by requested model name. Nobody distributes API keys to laptops. Every request is attributed: user, model, token counts (input, output, cached, reasoning), with guardrails that can inspect, modify, or block requests before they leave your network (PII scrubbing, tool restrictions, content policies) and full request/response capture with configurable retention, including a zero data retention mode that keeps prompts and responses off disk entirely.

Why it belongs in an enterprise operations module: it is the same operational pattern as everything above, identity from the IdP, policy at a choke point, attribution in logs, applied to a new class of traffic. Failure mode: forgetting that Aperture is young. It is an alpha-stage product with documented limitations around provider format changes, subscription passthrough, and quota handling, and instances are currently hosted in the European Union with more locations planned; treat the details here as a snapshot dated 2026-08-10, not a contract.

### Plan gating summary

Feature availability by plan, as of 2026-08-10:

| Feature | Availability |
|---|---|
| Configuration audit logs | All plans, on by default, 90 day retention |
| Network flow logs | Premium, Enterprise (30 day retention, API or streaming only) |
| Log streaming (audit and flow) | Premium, Enterprise |
| SCIM user and group provisioning | Standard, Premium, Enterprise |
| Advanced roles (Network admin, IT admin, Billing admin, Auditor) | Standard, Premium, Enterprise |
| Basic roles (Owner, Admin, Member) | All plans |
| Device approval | All plans |
| Tailnet Lock | Personal, Enterprise |
| Public API, GitOps workflow | All plans (scopes and roles still apply) |
| Aperture | Alpha; self-serve since 2026-03-23; purchased separately from Tailscale plans |

Plan boundaries move; re-check the pricing page before promising an auditor anything.

## On the wire

Enterprise operations is mostly logs and API calls, so "on the wire" here means what those actually look like.

Initializing Tailnet Lock on a signing node:

```
$ tailscale lock init tlpub:1f8a...c3d9 tlpub:88e2...74ab
...
Disablement secrets:
        disablement-secret:E3E2...5C11
        disablement-secret:A1B2...9F04
        (10 total; store each in a separate safe place)
Initialization complete.
```

Checking lock status and signing a new node:

```
$ tailscale lock status
Tailnet lock is ENABLED.
This node is accessible under tailnet lock. Node signing key: tlpub:1f8a...
Trusted signing keys: 2

$ tailscale lock sign nodekey:4a5f...e2d1 tlpub:9e2c...77aa
```

A node that the control plane delivered without a valid signature shows up flagged, and peers refuse it; `tailscale lock status` on a signing node lists such nodes so you can decide whether to sign or investigate.

Pulling configuration audit logs from the API with a scoped token:

```
$ curl -s -u "tskey-api-xxxxx:" \
  "https://api.tailscale.com/api/v2/tailnet/-/logging/configuration?start=2026-08-01T00:00:00Z&end=2026-08-10T00:00:00Z"
{
  "logs": [
    {
      "eventGroupID": "9c7af5c4...",
      "action": "UPDATE",
      "actor": "amelia@example.com",
      "target": "policy file",
      "old": "...\"src\": [\"group:eng@example.com\"]...",
      "new": "...\"src\": [\"group:eng@example.com\", \"group:sre@example.com\"]..."
    }
  ]
}
```

The GitHub Actions workflow that owns the policy file:

```yaml
name: Sync tailnet policy
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  acls:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy policy
        uses: tailscale/gitops-acl-action@v1
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_ID }}
          oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
          tailnet: ${{ secrets.TS_TAILNET }}
          action: ${{ github.event_name == 'push' && 'apply' || 'test' }}
```

And a flow log record, once it lands in your SIEM, reduces to something shaped like: `start`, `end`, `src: 100.x.y.z:port`, `dst: 100.a.b.c:port`, `proto: 6`, `txBytes`, `rxBytes`, plus node context, one record per flow per reporting interval, uploaded on your configured cadence.

## Failure modes

1. **Offboarded user still connects.** IdP deactivation suspended the user, but their devices keep working until node keys expire. Symptom: flow logs show traffic from a suspended user's node days after termination. Fix: expire or remove their devices at offboarding time; SCIM suspension alone is not immediate revocation.
2. **Compliance asks for month-old flow data that no longer exists.** Flow logs retain 30 days, audit logs 90, and nobody configured streaming. Symptom: the API returns nothing for the requested window. Fix: stream both log types to a bucket from day one; it is Premium/Enterprise gated, so plan for that.
3. **A console hotfix silently disappears.** Someone edits the policy file in the admin console; the sync is one-directional, so the next merge to main runs `action: apply` and the repo's version overwrites the console edit. Symptom: access that "was just fixed" breaks again right after a routine merge, and the audit log shows a policy update by the pipeline's credential immediately after the human's. Fix: treat the repo as the only writer, commit console emergencies back to Git immediately, and alert on audit log policy edits whose actor is not the pipeline.
4. **All signing nodes lost.** The VMs holding TLKs were rebuilt during an unrelated migration. Symptom: new nodes authenticate but stay locked out, and no remaining node can sign them. Fix: use a disablement secret to turn Tailnet Lock off, then re-initialize with durable signing nodes. If the secrets are also lost and none was shared with support, there is no fix; this is the scenario you design storage around.
5. **New fleet nodes blocked in the approval queue.** Device approval is on, and an imaging pipeline used a plain auth key. Symptom: hundreds of nodes show "awaiting approval," provisioning stalls. Fix: pre-approved auth keys for the pipeline, or the `nodeNeedsApproval` webhook plus the device authorization API for policy-driven approval.
6. **Automation dies quietly after weeks of working.** An API access token hit its 1 to 90 day expiry. Symptom: HTTP 401 in CI, no config change anywhere. Fix: use OAuth clients for anything long-lived; reserve personal tokens for interactive experiments.
7. **A "temporary" Admin grant becomes permanent.** Symptom: an Auditor role review, or an audit log query for role changes, shows helpdesk staff with full Admin from an incident three months ago. Fix: least-privilege roles as policy, and a recurring audit log query for role modification events.
8. **Two features, one slot.** Tailnet Lock enabled, then someone tries to enable device approval, or the reverse. Symptom: the console will not enable the second feature; they are documented as incompatible. Fix: decide which trust anchor the tailnet needs, admin click or node signature, and standardize.
9. **Flow logs trusted as gospel during an incident.** Flow reporting is client-side with no server-side validation, so a compromised node can under-report its own flows. Symptom: node-a's reported flows do not match node-b's for the same connections. Fix: this asymmetry is itself the signal; corroborate from the trustworthy side, which is exactly why both endpoints report independently.

## Check yourself

1. **Your security team says: "If Tailscale the company were fully compromised, could the attacker get a node onto our network?" What is your answer with and without Tailnet Lock, and what new operational risks does enabling it create?**

Answer: Without Tailnet Lock, yes. The coordination server distributes node public keys, and peers trust what it delivers; a compromised control plane could inject an attacker's node key into your netmap, and your nodes would build WireGuard sessions with it (the control plane never sees traffic, but a joined node is inside your ACL-permitted reachability). With Tailnet Lock, the attack fails at signature verification: every node key must carry a signature from a Tailnet Lock key held by one of your 2 to 20 signing nodes, checked against the tailnet key authority's chain that every node holds. The control plane never possesses a TLK private key, so it cannot forge the signature, and honest nodes reject the injected key. The new risks are operational: you have created cryptographic material that Tailscale cannot recover for you. Lose all signing nodes and all ten disablement secrets (having declined to share one with support), and the lock cannot be disabled. You also give up device approval, since the two are mutually exclusive, and you take on process overhead: every new node needs a signature via a signing node, a signing link, or a pre-signed auth key baked into provisioning. And Tailnet Lock does not help against a compromised signing node itself; that key must be revoked separately.

2. **An employee was terminated at 09:00. At 09:05 the IdP admin deactivated them in Okta, which is wired to Tailscale via SCIM. At 14:00, flow logs show their laptop pulling data from an internal file server. Walk through why this happened and what a correct offboarding runbook looks like.**

Answer: SCIM did its job: Okta deactivation suspended the Tailscale user, which blocks future authentication. But suspension does not tear down existing device state; the laptop's node key was issued before suspension and remains valid until it expires, so the WireGuard sessions it can establish under existing ACLs keep working. This is documented behavior, not a sync failure. A correct runbook treats SCIM as the identity layer and adds a device layer: at termination, an Owner, Admin, or IT admin (or an automation against the API) expires or deletes the user's devices immediately, which invalidates the node keys and cuts connectivity now rather than at natural key expiry. The runbook should also confirm in the flow logs that traffic from those nodes stopped, and note that the SCIM sync means you cannot simply delete the user object in Tailscale, since the next sync recreates it; suspension plus device removal is the pattern.

3. **At 10:00 a teammate "fixed prod access for the data team" by editing the policy file directly in the admin console. At 11:00 an unrelated pull request merged and your GitOps pipeline (gitops-acl-action, OAuth client) ran `action: apply` successfully. At 11:05 the data team reports access is broken again. What happened, how do you resolve it, and how do you find who did what?**

Answer: The GitOps sync is one-directional: manual policy changes in the admin console are never reflected back into the repo, and the documentation is explicit that the next run of the sync action overwrites them. The 11:00 merge applied the repo's version of the policy, which did not contain the teammate's console edit, so the control plane reverted to the repo's state and the data team's access disappeared. The PR's `action: test` run gave no warning because it only validates and tests the candidate file; it does not compare against out-of-band console state. Resolution: recover exactly what the teammate changed from the configuration audit log, which records every policy update with actor, timestamp, and a full diff of old and new contents (console Logs page, or the API with a `logs:configuration:read` token). Turn that diff into a commit, open a pull request so the policy tests gate it, merge, and let the pipeline apply it as the legitimate writer. Attribution falls out of the same audit log: the 10:00 update shows the teammate's identity as actor, the 11:00 update shows the pipeline's OAuth client. The durable fix is social plus technical: the repo is the source of truth, console policy edits are for emergencies only and must be committed back immediately, and any audit log policy edit whose actor is not the pipeline's credential triggers an alert.

## What you now have

1. A map of the admin console's five surfaces and the least-privileged role for each team that touches them.
2. The two-log model: configuration audit logs (who changed the tailnet, 90 days, all plans) and network flow logs (who talked to whom, 30 days, Premium/Enterprise), both streamable to SIEM or object storage because Tailscale's own retention is short.
3. The SCIM lifecycle, including the one gap that matters: suspension is not device revocation.
4. Tailnet Lock as a trust transplant: signature verification against your own signing nodes replaces blind trust in the control plane, at the cost of real key-custody obligations.
5. Device approval at scale via pre-approved keys, webhooks, and the API, and the fact that it excludes Tailnet Lock.
6. The policy file as code: scoped OAuth credentials, test on PR, apply on merge, and the one-directional sync rule: console edits get overwritten, and the audit log is your drift alarm.
7. Aperture as the 2026 extension of the same doctrine, identity-attributed, policy-gated, fully logged access, applied to AI providers.

## Cross references

- Module 02, The control plane: everything in this module manages state that the coordination server distributes; Tailnet Lock exists precisely because Module 02's trust model has a single point of coercion.
- Module 04, Identity and auth: SCIM extends the IdP relationship from login into full lifecycle; Aperture reuses the same identity layer for AI requests.
- Module 05, Policy: ACLs and grants: the GitOps pipeline here deploys the policy file whose syntax and semantics Module 05 covers; SCIM-synced groups become that file's vocabulary.
- Module 06, MagicDNS and split DNS: the console's DNS surface configures what Module 06 explains.
- Module 01, WireGuard foundations: flow logs record metadata only because the payload encryption described there makes content inspection impossible by design.
- Module 08, Exposing services: pre-approved and pre-signed auth keys used in provisioning pipelines connect to the service deployment patterns there.
- Module 11, Troubleshooting and observability: audit and flow logs are the enterprise-grade inputs to the debugging workflows in that module.
