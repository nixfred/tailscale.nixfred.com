---
module: 5
slug: policy-acls-grants
title: "Policy: ACLs and grants"
description: How the tailnet policy file works, from HuJSON and legacy ACLs through grants, autogroups, tags, SSH rules, posture, and the tests that gate every save.
order: 5
words: 4500
sources:
  - id: kb-acls
    url: https://tailscale.com/docs/features/access-control/acls
    title: Manage permissions using ACLs
    checked: 2026-08-10
  - id: kb-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-10
  - id: kb-grants
    url: https://tailscale.com/docs/features/access-control/grants
    title: Grants
    checked: 2026-08-10
  - id: blog-grants-ga
    url: https://tailscale.com/blog/grants-ga
    title: Grants generally available as an easier option to ACL syntax
    checked: 2026-08-10
  - id: kb-autogroups
    url: https://tailscale.com/docs/reference/targets-and-selectors
    title: Autogroups
    checked: 2026-08-10
  - id: kb-ssh
    url: https://tailscale.com/docs/features/tailscale-ssh
    title: Tailscale SSH
    checked: 2026-08-10
  - id: kb-posture
    url: https://tailscale.com/docs/features/device-posture
    title: Device posture
    checked: 2026-08-10
  - id: kb-tags
    url: https://tailscale.com/docs/features/tags
    title: Tags
    checked: 2026-08-10
  - id: blog-how-works
    url: https://tailscale.com/blog/how-tailscale-works
    title: How Tailscale works
    checked: 2026-08-10
---

## The promise

1. You will be able to read and write a tailnet policy file in HuJSON, and explain why a new tailnet allows everything while a tailnet with one written rule denies everything not listed.
2. You will be able to translate between legacy ACL syntax and grants, and say precisely what grants add: the `ip` field, the `app` field, `via`, and posture integration in one unified rule shape.
3. You will be able to recite the exact semantics of every autogroup that matters (`member`, `self`, `tagged`, `internet`, `admin`, `owner`, and friends) including where each is legal.
4. You will be able to explain why tagging a node changes its policy identity, and why that silently breaks SSH rules scoped to `autogroup:self`, then write the paired rule that prevents the lockout.
5. You will be able to attach posture conditions to rules and write ACL tests that make bad policy edits fail at save time instead of at 2 a.m.
6. You will be able to trace a policy change from the admin console to the packet filter running inside `tailscaled` on every node, and explain where enforcement actually happens.

## Foundation

You already know firewall policy. You have written access lists on routers, security groups in a cloud console, and iptables rules on hosts. Three instincts from that world carry over directly, and one does not.

Carries over: first match semantics do not apply here, because Tailscale policy is purely additive. Every rule is an `accept`. There is no `deny` action and no rule ordering to reason about. Anything not accepted by some rule is dropped. This is the security group model, not the router ACL model.

Carries over: identity beats IP. You have watched IP-based firewall rules rot as DHCP leases churned. Tailscale policy is written against users, groups, and tags, and the control plane resolves those to the stable 100.x.y.z addresses from Module 02 at compile time, so the rules never rot when devices come and go.

Carries over: centralized definition, distributed enforcement. Like a firewall manager pushing policy to many enforcement points, the coordination server compiles your one policy file into a per-node packet filter and ships it to every device.

Does not carry over: there is no middlebox. No chokepoint appliance sees the traffic. Enforcement happens on the receiving node itself, inside the WireGuard boundary from Module 01. If you are used to hairpinning traffic through a firewall to apply policy, unlearn that here.

## Core content

### One file, and it is HuJSON

The entire access policy for a tailnet lives in one document, the tailnet policy file, written in HuJSON: JSON plus comments plus trailing commas. That sounds like a small ergonomic detail. It is not. Comments mean the policy file can carry its own rationale ("this rule exists because the backup jobs on node-b pull from node-a"), and trailing commas mean diffs stay one line per change, which matters because the sane way to run this file at any scale is through version control. The file is edited in the admin console's Access controls page, through the API, or through a GitOps flow where the repo is the source of truth and CI pushes the file on merge.

The file has more sections than most people ever open: `acls`, `grants`, `ssh`, `groups`, `hosts`, `tagOwners`, `autoApprovers`, `nodeAttrs`, `postures`, `ipsets`, `tests`, and `sshTests`. This module covers the access control core; `autoApprovers` returns in Module 07 when routes and exit nodes need approving.

### Default allow, then deny by omission

A brand new tailnet ships with a policy that permits every device to reach every other device. Concretely, the starter file contains one rule: allow everything from everyone. The same permissive default applies if the policy file has no `acls` or `grants` section at all.

```json
{
  "acls": [
    // Default: allow all connections. Comments are legal, this is HuJSON.
    {"action": "accept", "src": ["*"], "dst": ["*:*"]},
  ],
}
```

The moment you replace that wildcard with real rules, the ground shifts under you. There is no deny action in the language because deny is the substrate. Every packet is dropped unless some rule accepts it. Delete the wildcard rule, write one narrow rule, and you have implicitly written ten thousand deny rules for everything else.

Analogy: the policy file is a guest list, not a bouncer's rulebook. A bouncer's rulebook has admit and eject instructions and order matters. A guest list only has names. Not on the list, not getting in, and it does not matter what order the names were written in.

Mechanism: because rules are purely additive, evaluation is order independent. The union of all accepting rules defines reachability. This is why you can safely append rules without re-reading the whole file, and why reviews of policy diffs are tractable: an added line can only add access, never remove it.

Failure mode: the classic first-week incident is someone "tightening" the default file by replacing `"src": ["*"]` with a specific group, and instantly cutting off every device not in that group, including subnet router access and their own second machine. Deny by omission means your first real rule is also your first real outage risk. The `tests` section, covered below, exists precisely for this moment.

> [!GOTCHA] Access rules are directional. A rule allowing node-a to reach node-b:443 does not allow node-b to open connections to node-a. Return traffic on an established connection flows fine, but the reverse direction needs its own rule. Engineers coming from flat LANs get bitten by this weekly.

### Legacy ACL syntax

The original rule shape, still fully supported, lives in the `acls` array:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["group:eng"],
      "proto": "tcp",
      "dst": ["tag:prod:443,8443"],
    },
  ],
}
```

`action` is always `"accept"`. `src` takes users, groups, tags, autogroups, Tailscale IPs, CIDR ranges, or names from the `hosts` section. `dst` takes the same, with `:port` appended: a single port, a comma list, a range like `1000-2000`, or `*`. `proto` is optional; omit it and the rule covers all TCP and UDP. Name a protocol (`tcp`, `udp`, `sctp`, `gre`, `esp`, `ah`, `igmp`, or a raw IANA number from 1 to 255) and the rule narrows to it. Only TCP, UDP, and SCTP can carry port restrictions; every other protocol takes only `*` as its port. ICMP rides along automatically: if any rule allows any traffic between an IP pair, ping works between them, which is a deliberate debuggability choice.

### Grants: the unified modern syntax

Grants became generally available in May 2025 and are the recommended syntax for most use cases going forward (checked 2026-08-10). A grant is what the ACL rule grows up into: same identity-based `src` and `dst`, but the "what are you allowed to do" part splits into layers. A grant must carry at least one permission layer, `ip` or `app`.

```json
{
  "grants": [
    {
      "src": ["group:eng"],
      "dst": ["tag:prod"],
      "ip": ["tcp:443", "tcp:8443"],
      "app": {
        "tailscale.com/cap/tailsql": [{"dataSrc": ["metrics"]}],
      },
      "srcPosture": ["posture:managedLaptop"],
    },
  ],
}
```

Four things distinguish a grant from a legacy ACL rule:

The `ip` field replaces the port suffix bolted onto `dst`. Protocol and port live together (`"tcp:443"`, `"udp:53"`, or `"*"`), and destination selectors stay clean identity expressions. This is more than tidiness: it means one rule can carry several protocol and port pairs without duplicating the destination list.

The `app` field is the genuinely new layer. It grants application capabilities: named, structured permissions in the form `domain/capabilityName`, carrying JSON payloads that the policy engine treats as opaque (it validates only that they are valid JSON). Tailscale itself does not interpret these. An application running on the destination (Golink, TailSQL, your own service using the Tailscale client API) reads which capabilities the connecting peer holds and enforces accordingly. Policy about who can write to a database moves out of the database's config and into the same file that says who can reach it at all.

The `via` field adds routing awareness: a grant can define which exit nodes, subnet routers, or app connectors devices must use when reaching particular resources, which Module 07 picks up in detail.

`srcPosture` attaches device health conditions, covered below. Posture applies only to the source of a grant, never the destination.

Analogy: a legacy ACL rule is a door key. A grant is a hotel keycard: it opens the door (`ip`), and it also encodes what you may do inside, whether the minibar unlocks and whether the gym works (`app`), and the front desk can refuse to encode it onto a card reported stolen (`srcPosture`).

Mechanism: for network access, grants can do everything ACLs can, and the two syntaxes can coexist in one policy file; the union of both governs reachability, so you never have to rewrite existing ACL rules to start using grants. For the `app` layer, the control plane delivers the capability names and payloads to the destination alongside the peer they describe, and applications on that node read them through the local client API to authorize the requester.

Failure mode: writing a grant with an `app` field but no `ip` field and expecting network access. App capabilities do not open ports. If nothing grants the `ip` layer (this grant, another grant, or a legacy ACL), the TCP connection never establishes and the beautifully scoped capability payload never gets consulted.

<div class="diagram-wrap">
<svg viewBox="0 0 740 260" role="img" aria-label="Layered gate model of a grant: posture check, then netmap inclusion, then the ip packet filter, then app capability enforcement by the application">
  <title>The layers a connection passes through under a grant</title>
  <rect x="20" y="90" width="150" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">srcPosture</text>
  <text x="95" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="12">device healthy?</text>
  <rect x="210" y="90" width="150" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="285" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">netmap</text>
  <text x="285" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="12">peer even visible?</text>
  <rect x="400" y="90" width="150" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="475" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">ip filter</text>
  <text x="475" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="12">proto and port open?</text>
  <rect x="590" y="90" width="130" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="655" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="13">app layer</text>
  <text x="655" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="12">capability held?</text>
  <line x1="170" y1="125" x2="210" y2="125" stroke="var(--diagram-line)"/>
  <line x1="360" y1="125" x2="400" y2="125" stroke="var(--diagram-line)"/>
  <line x1="550" y1="125" x2="590" y2="125" stroke="var(--diagram-accent)"/>
  <text x="285" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="12">enforced by control and tailscaled</text>
  <text x="655" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="12">enforced by the app itself</text>
  <text x="370" y="220" text-anchor="middle" fill="var(--diagram-text)" font-size="12">fail any layer on the left and the layers to the right are never consulted</text>
</svg>
</div>

### Autogroups: the built-in nouns

Autogroups are groups Tailscale maintains for you, and their exact semantics are load-bearing (all semantics checked 2026-08-10):

**`autogroup:member`**: every member of the tailnet. Usable in `src` and `dst`. As a destination it means "devices belonging to members," which excludes tagged devices. External users who accepted a sharing invitation are matched by `autogroup:shared`, not by `member`.

**`autogroup:self`**: the strangest and most important one. Valid only as a destination (in access rules and SSH rules), and it does not name a fixed set. It re-evaluates per source: "devices owned by the same user as the source device." The rule `src: ["autogroup:member"], dst: ["autogroup:self:*"]` means every member can reach their own devices, and nobody else's. Because `self` resolves through user identity, the `src` of such a rule must be user-shaped: individual users, groups, or role autogroups. Tags cannot appear there, and tagged devices can never match either end, because a tagged device has no owning user. Hold that thought.

**`autogroup:tagged`**: every device carrying at least one tag. The natural complement to `member`: your fleet of servers as opposed to your fleet of humans.

**`autogroup:internet`**: destination only. Matches all public IP addresses, and is the mechanism behind exit node policy: granting `dst: ["autogroup:internet:*"]` is what permits a user to route to the wider internet through an exit node (Module 07).

**`autogroup:admin`, `autogroup:owner`, `autogroup:network-admin`, `autogroup:it-admin`, `autogroup:billing-admin`, `autogroup:auditor`**: role autogroups, matching users holding the corresponding console role. These make policy follow the org chart: grant `autogroup:admin` SSH everywhere once, and new admins inherit it the day the role is assigned.

**`autogroup:shared`**: devices belonging to users who accepted a sharing invitation to your tailnet, for policies on shared nodes.

**`autogroup:nonroot`**: special, valid only in the SSH `users` field, meaning any host account except root.

**`autogroup:danger-all`**: everything, including devices outside your tailnet. The name is the documentation. It exists for backward compatibility and should not appear in new policy.

Failure mode: assuming `autogroup:member` includes servers. It includes people. A cron job on a tagged node cannot reach a destination whose only accepting rule has `src: ["autogroup:member"]`, and the failure looks like a network outage rather than the identity mismatch it is.

### Tags are policy identity, not labels

If you internalize one idea from this module: a tag is not metadata stuck onto a device. Applying a tag replaces the device's identity. The docs are blunt: applying a tag removes user-based authentication from the device, authenticating with a user account removes all tags, and a device cannot simultaneously have a user and a tag.

This is the right design for servers. A production database should not have access because an engineer's account happens to be signed in on it; that engineer will leave, their key will expire, and the database should not care. Tagging cuts the node loose from any human: policy references `tag:prod-db`, and key expiry is disabled by default when a device is first tagged and authenticated, because servers should not go dark when a 180-day timer fires.

Who may apply a tag is itself policy, in `tagOwners`:

```json
{
  "tagOwners": {
    "tag:prod": ["group:sre"],
    "tag:ci-runner": ["tag:prod"],   // tags can own tags
    "tag:sensitive": [],             // empty list = admin roles only
  },
}
```

Every tag is implicitly owned by the tailnet's Owners, Admins, and Network admins, so an empty owner list means only those roles can apply it. Tags get applied with the `--advertise-tags=tag:prod` flag on `tailscale login` (or `tailscale up`), baked into auth keys, or set per device in the admin console.

Analogy: tagging is corporate incorporation. Before, the node was you, legally: your identity, your permissions, your key expiry. After, it is its own legal person. Your old personal privileges do not transfer to it, and rules that referred to "you" no longer describe it.

Failure mode: the incorporation has a side effect people hit constantly, and it deserves its own section.

### The ssh section, and the self trap

Tailscale SSH (Module 04 covered the auth side) is policed by the `ssh` array. Rules look like ACLs plus a `users` field naming which host accounts are permitted, and an `action` that has two real values:

```json
{
  "ssh": [
    {
      "action": "check",
      "src": ["autogroup:member"],
      "dst": ["autogroup:self"],
      "users": ["autogroup:nonroot", "root"],
    },
  ],
}
```

That block is the conservative default the docs give new tailnets (checked 2026-08-10): members may SSH to their own machines as root or any nonroot user, with `check` requiring a fresh identity-provider re-authentication in the browser before the session opens. `accept` skips the recheck and trusts standing tailnet auth. `checkPeriod` tunes how long a check verification lasts: default 12 hours, minimum 1 minute, maximum 168 hours, or `"always"` to force a browser round trip on every single connection, which will break Ansible and anything else that opens many sessions. Rules are evaluated most restrictive first, check before accept, so when both match a connection, check wins; you cannot accidentally tunnel under a check requirement by adding a sloppier accept rule.

Two structural constraints follow from tags being identity. First, a tagged device can only SSH into other tagged devices, never into user-owned ones, and a rule whose `src` is a tag cannot use `check` (there is no human identity to re-verify). Second, the trap promised at the top of this module:

> [!GOTCHA] The autogroup:self lockout. You have been SSHing into your build box all month under the default rule (src member, dst autogroup:self). Today you tag it tag:ci to give it server policy. The tag removes its user identity. A node with no owning user can never match autogroup:self, so the only SSH rule that admitted you no longer matches, and your next connection is refused by policy. Nothing warned you, because the tag change was valid and the SSH rule is still valid; they just no longer intersect. The fix is pairing: every time a tag enters your tailnet, add the matching SSH rule in the same policy edit, for example src group:sre, dst tag:ci, users a deliberately chosen list. Treat "new tag" and "new ssh rule" as one atomic change, and encode the expectation in sshTests so the file cannot save without it.

There is a second, quieter trap in the same rule. `autogroup:self` is doing double duty in the default: it restricts destinations and it implicitly scopes `users`, because on your own machine, being any nonroot user is fine. The docs warn that if you widen `dst` from `autogroup:self` to something like a tag, you should also reconsider `autogroup:nonroot` in `users` in the same breath: leaving it in place means anyone permitted by `src` can SSH in as any nonroot account on shared servers, which is a privilege grant nobody consciously made.

<div class="diagram-wrap">
<svg viewBox="0 0 720 300" role="img" aria-label="State flow showing how tagging a node breaks SSH rules scoped to autogroup:self and the paired rule that fixes it">
  <title>The autogroup:self tagging lockout and its fix</title>
  <rect x="20" y="40" width="200" height="90" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b</text>
  <text x="120" y="92" text-anchor="middle" fill="var(--diagram-text)" font-size="12">owner: alice</text>
  <text x="120" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="12">matches self: YES</text>
  <rect x="280" y="40" width="180" height="90" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="370" y="80" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tailscale login</text>
  <text x="370" y="100" text-anchor="middle" fill="var(--diagram-text)" font-size="13">--advertise-tags=tag:ci</text>
  <rect x="520" y="40" width="180" height="90" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="70" text-anchor="middle" fill="var(--diagram-text)" font-size="14">node-b</text>
  <text x="610" y="92" text-anchor="middle" fill="var(--diagram-text)" font-size="12">identity: tag:ci</text>
  <text x="610" y="112" text-anchor="middle" fill="var(--diagram-text)" font-size="12">matches self: NO</text>
  <line x1="220" y1="85" x2="280" y2="85" stroke="var(--diagram-line)"/>
  <line x1="460" y1="85" x2="520" y2="85" stroke="var(--diagram-line)"/>
  <rect x="20" y="190" width="320" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="180" y="218" text-anchor="middle" fill="var(--diagram-text)" font-size="13">ssh rule: member to autogroup:self</text>
  <text x="180" y="242" text-anchor="middle" fill="var(--diagram-text)" font-size="13">no longer matches: SSH REFUSED</text>
  <rect x="380" y="190" width="320" height="80" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="540" y="218" text-anchor="middle" fill="var(--diagram-text)" font-size="13">paired fix in same edit:</text>
  <text x="540" y="242" text-anchor="middle" fill="var(--diagram-text)" font-size="13">ssh rule: group:sre to tag:ci</text>
  <line x1="610" y1="130" x2="200" y2="190" stroke="var(--diagram-line)"/>
  <line x1="610" y1="130" x2="540" y2="190" stroke="var(--diagram-accent)"/>
</svg>
</div>

### Posture: rules that check the device, not just the identity

Posture conditions let a rule ask "is the connecting device itself in acceptable shape?" You define named postures over device attributes, then reference them from grants via `srcPosture`:

```json
{
  "postures": {
    "posture:managedLaptop": [
      "node:os IN ['macos', 'windows']",
      "node:tsVersion >= '1.84'",
      "node:tsStateEncrypted == true",
    ],
  },
  "defaultSrcPosture": ["posture:managedLaptop"],
}
```

Built-in attributes in the `node:` namespace (`node:os`, `node:osVersion`, `node:tsVersion`, `node:tsAutoUpdate`, `node:tsReleaseTrack`, `node:tsStateEncrypted`) are available on all plans; `ip:country` geolocation needs Standard and up, third-party attributes fed from MDM and EDR integrations (Intune, Jamf Pro, CrowdStrike Falcon, SentinelOne, and others) need Standard and up, and fully custom `custom:` attributes pushed through the API need Premium and up (plan mapping checked 2026-08-10). Operators are the obvious set: `==`, `!=`, `IN`, `NOT IN`, `IS SET`, `NOT SET`, and numeric or version comparisons for attributes that support them. All conditions inside one posture must hold; listing multiple postures on a rule is OR.

`defaultSrcPosture` sets a floor for every rule that does not name its own `srcPosture`, and here is the sharp edge: an explicit `srcPosture` on a rule replaces the default, it does not add to it.

Failure mode: posture is evaluated for the Tailscale node originating the traffic. Devices behind a subnet router are not posture-restricted; if they match the IP-based conditions of a rule, they are permitted, so a posture gate on `tag:prod` does not constrain a LAN host reaching it through an advertised route. Posture narrows tailnet-native sources; it is not a perimeter scanner.

### Tests: the save gate

The `tests` and `sshTests` sections are assertions about the policy, living inside the policy:

```json
{
  "tests": [
    {
      "src": "dave@example.com",
      "proto": "tcp",
      "accept": ["node-a:22"],
      "deny": ["lab-vm-1:443"],
    },
  ],
  "sshTests": [
    {
      "src": "group:sre",
      "dst": ["tag:ci"],
      "accept": ["ubuntu"],
      "deny": ["root"],
    },
  ],
}
```

The semantics are the whole point: every save path, console, API, or GitOps, evaluates every test against the candidate policy, and if any assertion fails, the save is rejected with an error. The bad policy never becomes the live policy. `deny` assertions are the underrated half: "the contractor group must never reach tag:prod" written as a test is a guardrail that outlives every future refactor of the rules above it. Tests can also pin posture behavior by supplying `srcPostureAttrs` to simulate a device with given attributes, and SSH tests distinguish `accept`, `check`, and `deny` outcomes per host user.

> [!FROM-THE-FIELD] Treat tests as the policy file's regression suite and write one per invariant you would page on: admins can always SSH somewhere, the lockout pair for every tag exists, the deny list of your compliance story holds. A policy file with rich tests can be refactored fearlessly; one without them is a museum nobody dares touch.

### Distribution and enforcement: where policy becomes packets

This ties directly to Module 02. The coordination server does not enforce anything; it compiles. On every policy save, it recomputes, for each node, a packet filter: the subset of rules relevant to that node, resolved from identities down to concrete Tailscale IPs. That filter ships to each node inside its netmap over the control connection, alongside keys and peer endpoints. Distribution is automatic and typically takes effect in seconds.

Enforcement then happens at the destination. Each device enforces incoming connections using the access rules distributed to it, with no further involvement from the coordination server: a connection from node-a to node-b is admitted or dropped by node-b's own incoming packet filter, applied at decryption time inside `tailscaled`. Every node is its own firewall for inbound tailnet traffic; there is no middlebox to hairpin through, no chokepoint to scale, and a node that goes offline enforces nothing because it also receives nothing.

> [!HOW-IT-WORKS] Control also prunes what each node can even see. The coordination server gives each node the public keys of only the nodes that are supposed to connect to it, so if policy permits no traffic at all between two nodes, each is simply omitted from the other's netmap. No WireGuard key exchange, no endpoint discovery, no encrypted path is ever set up between them. Deny by omission is not a dropped packet; for fully disallowed pairs it is a peer that, from the node's perspective, does not exist.

<div class="diagram-wrap">
<svg viewBox="0 0 740 320" role="img" aria-label="Sequence showing a policy edit flowing through tests and compilation to per-node packet filters enforced at the destination">
  <title>Policy distribution: edit, test gate, compile, push, enforce</title>
  <rect x="20" y="30" width="150" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="95" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="13">admin edit</text>
  <text x="95" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="12">console / API / GitOps</text>
  <rect x="230" y="30" width="130" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="295" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tests run</text>
  <text x="295" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="12">fail = save rejected</text>
  <rect x="420" y="30" width="150" height="60" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="495" y="55" text-anchor="middle" fill="var(--diagram-text)" font-size="13">control compiles</text>
  <text x="495" y="75" text-anchor="middle" fill="var(--diagram-text)" font-size="12">per-node filters</text>
  <line x1="170" y1="60" x2="230" y2="60" stroke="var(--diagram-line)"/>
  <line x1="360" y1="60" x2="420" y2="60" stroke="var(--diagram-line)"/>
  <rect x="150" y="180" width="180" height="100" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="240" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-a</text>
  <text x="240" y="232" text-anchor="middle" fill="var(--diagram-text)" font-size="12">netmap + filter</text>
  <rect x="430" y="180" width="180" height="100" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="520" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="13">node-b</text>
  <text x="520" y="232" text-anchor="middle" fill="var(--diagram-text)" font-size="12">netmap + filter</text>
  <text x="520" y="254" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ENFORCES inbound</text>
  <line x1="470" y1="90" x2="250" y2="180" stroke="var(--diagram-line)"/>
  <line x1="510" y1="90" x2="520" y2="180" stroke="var(--diagram-line)"/>
  <line x1="330" y1="240" x2="430" y2="240" stroke="var(--diagram-accent)"/>
  <text x="380" y="230" text-anchor="middle" fill="var(--diagram-text)" font-size="12">WireGuard</text>
  <text x="380" y="305" text-anchor="middle" fill="var(--diagram-text)" font-size="12">packet from a is judged by b's local filter, not by any middlebox</text>
</svg>
</div>

## On the wire

Policy failures have a distinctive fingerprint at the CLI, and learning it saves hours.

A fully disallowed peer is invisible. Before a restrictive policy, node-a sees the fleet:

```
$ tailscale status
100.64.0.1   node-a        alice@   linux   -
100.64.0.7   node-b        alice@   linux   active; direct 203.0.113.9:41641
100.64.0.12  lab-vm-1      tagged   linux   idle
100.64.0.19  cloud-1       tagged   linux   idle
```

After a policy edit that grants node-a no path to cloud-1 at all, cloud-1 simply vanishes from the list and from the netmap; there is no "blocked" marker, because control never told node-a the peer exists. Direct traffic attempts fail name resolution or route lookup, not filtering.

A partially allowed peer behaves differently: it is visible, ping works, and only disallowed ports die. Suppose policy grants `ip: ["tcp:443"]` to lab-vm-1 but you try SSH:

```
$ tailscale ping lab-vm-1
pong from lab-vm-1 (100.64.0.12) via 198.51.100.4:41641 in 12ms

$ nc -vz -w 3 lab-vm-1 443
Connection to lab-vm-1 port 443 [tcp/https] succeeded!

$ nc -vz -w 3 lab-vm-1 22
nc: connectx to lab-vm-1 port 22 (tcp) failed: Operation timed out
```

That triple, path alive, allowed port opens, other port times out silently, is the signature of a packet filter drop on the destination. There is no RST and no ICMP rejection; the receiving `tailscaled` discards the SYN. Contrast a service that is simply not listening, which typically answers with connection refused. Timeout says policy, refused says application.

For SSH check mode, the enforcement is visible in the session itself:

```
$ ssh ubuntu@lab-vm-1
# To authenticate, visit:
#
#     https://login.tailscale.com/a/1a2b3c4d5e6f7
#
```

The connection parks until the browser re-authentication completes, then the shell opens. Under `action: accept`, none of that appears and the session opens directly.

> [!ON-THE-WIRE] tailscale ping succeeding while TCP times out is not a contradiction. ICMP is permitted between any IP pair that has at least one accepting rule for anything, and tailscale ping itself exercises the tunnel path. Reachability of the node and reachability of a port are governed by different lines of your policy file. Debug them separately.

## Failure modes

1. **The first-rule cliff.** Replacing the default `*` rule with a narrow rule silently denies everything else. Symptom: fleet-wide unreachability immediately after a policy save, while `tailscale status` on each node shows a nearly empty peer list.
2. **The self-tagging SSH lockout.** A node is tagged; SSH rules with `dst: ["autogroup:self"]` stop matching it. Symptom: SSH to that one node refused or hanging right after a tag change, while SSH to untagged machines still works. Fix: paired tag-scoped SSH rule, ideally enforced by an `sshTests` entry.
3. **The nonroot widening.** Changing an SSH rule's `dst` from `autogroup:self` to a tag while leaving `users: ["autogroup:nonroot"]`. Symptom: nothing breaks, which is the problem; everyone matched by `src` can now log in as any nonroot account on shared servers. Found in audits, not incidents.
4. **Member-versus-tagged confusion.** A tagged node's traffic fails because the accepting rule's `src` is `autogroup:member` or a user group. Symptom: a service works when tested from a laptop but the server-to-server cron job times out.
5. **Directionality surprise.** node-a can reach node-b, so someone assumes node-b can reach node-a. Symptom: one-way connection failures; each side's outbound tests give opposite results.
6. **App grant without ip grant.** Capability configured, port never opened. Symptom: TCP timeout to the app while the capability JSON looks perfect in review.
7. **Posture override, not append.** A rule given its own `srcPosture` no longer inherits `defaultSrcPosture`. Symptom: a device failing the tailnet-wide posture floor still reaches the one destination whose rule named a weaker posture.
8. **Posture blind spot.** Devices behind subnet routers are not posture-restricted and are permitted if they match IP-based conditions. Symptom: a device you expected posture to block connects fine because it arrives through a subnet router (Module 07 territory).
9. **check mode versus automation.** `checkPeriod: "always"` or short periods break non-interactive SSH. Symptom: Ansible and scp stall waiting on a browser URL nobody sees.
10. **Stale propagation assumptions.** Rarely, a node with a wedged control connection (Module 02) keeps enforcing an old filter. Symptom: policy behaves correctly from every node but one; restarting `tailscaled` on the straggler resyncs the netmap and clears it.

## Check yourself

**1. You tag your workstation's sibling build machine with tag:ci during a Friday cleanup. Monday, your SSH to it hangs at connection, but HTTPS to the service it hosts still works. Every other machine is fine. What happened, in exact policy terms, and what is the correct fix?**

Answer: The tag replaced the machine's user identity. Your SSH access rode on the default rule `src: ["autogroup:member"], dst: ["autogroup:self"]`, and `autogroup:self` matches only devices owned by the same user as the source; a tagged device has no owning user, so it can never match `autogroup:self` again. The SSH rule did not change and the tag operation was legal; their intersection just became empty, which is why nothing warned you. HTTPS still works because that access comes from a different line, an ACL or grant whose `dst` names the tag or a broader selector, and network rules are evaluated independently of SSH rules. The fix is to add an SSH rule scoped to the new identity, for example `src: ["group:sre"]` or your user, `dst: ["tag:ci"]`, with a deliberately chosen `users` list (do not blindly carry over `autogroup:nonroot` now that the destination is not your own machine). Then encode the invariant as an `sshTests` entry asserting your user gets `accept` for the expected host account on `tag:ci`, so any future refactor that drops the rule fails at save time. The durable habit: every tag change ships in the same policy edit as its matching SSH rule.

**2. From node-a, `tailscale ping cloud-1` resolves nothing and cloud-1 is absent from `tailscale status`, but your teammate sees it fine from her laptop. Meanwhile lab-vm-1 shows in your status, answers tailscale ping, accepts port 443, and times out on port 5432. Explain both symptoms from policy mechanics.**

Answer: These are the two distinct enforcement layers. cloud-1's absence means the compiled policy gives node-a no permitted traffic to cloud-1 whatsoever, so the coordination server omitted cloud-1 from node-a's netmap entirely: no key, no endpoints, no DNS presence, effectively no peer. Your teammate's device matches some accepting rule (different user, group, or posture), so her netmap includes it. lab-vm-1 is the partial-allowance case: at least one rule accepts some traffic from node-a, so the peer is in the netmap, WireGuard paths establish, and ICMP is permitted because an accepting rule exists for the pair. Port 443 is opened by that rule's `ip`/port scope; port 5432 has no accepting line, so lab-vm-1's own `tailscaled` silently drops the SYN, which presents as a timeout rather than a refusal. The debugging heuristic falls out directly: peer missing means no rule at all for the pair, port timing out while ping works means a rule exists but not for that port, connection refused means policy passed and the application is not listening.

**3. Your compliance requirement says only company-managed macOS or Windows devices running a current client may reach tag:payroll, and contractors must never reach it. Sketch how you express this so it survives future edits by people who have never read the requirement.**

Answer: Three parts. First, a posture: define `posture:managedCorp` in `postures` with conditions like `node:os IN ['macos', 'windows']` and a version floor such as `node:tsVersion >= '1.84'`, adding an MDM-sourced attribute (Standard plan or above) if "company-managed" must mean more than OS strings. Second, the grant: `src` limited to the employee group, `dst: ["tag:payroll"]`, an `ip` list of exactly the needed ports, and `srcPosture: ["posture:managedCorp"]`. Remember that naming `srcPosture` on the rule replaces `defaultSrcPosture` rather than adding to it, so this posture must be complete on its own. Third, and this is what protects the requirement from future editors: tests. Add a `tests` entry with `src` set to a contractor account and `deny: ["tag:payroll:443"]`, and another with an employee `src` plus `srcPostureAttrs` simulating a non-compliant device (say `node:os: "linux"`) also asserting deny, plus a positive test asserting a compliant employee is accepted. Because every save path evaluates tests and rejects the file on any failure, a later edit that accidentally reopens payroll to contractors cannot become live policy; the requirement now enforces itself. One honest caveat to document: posture does not restrict devices arriving through subnet routers, so payroll access must be tailnet-native for the gate to hold.

## What you now have

1. One HuJSON file governs the tailnet: allow-all at birth, deny-by-omission the moment you write real rules, with every rule additive and order-free.
2. Two syntaxes for network access, legacy `acls` and modern `grants`, coexisting in one file with the union of both governing, and grants adding `ip`, `app` capabilities, `via`, and posture in one shape.
3. Exact autogroup semantics, including the per-source re-evaluation of `autogroup:self` and the member-versus-tagged identity split.
4. Tags as identity replacement, the SSH `check` machinery, and the paired-edit discipline that prevents the self-scoping lockout.
5. Posture conditions as device-health gates, and their subnet-router blind spot.
6. Tests as a save-time gate that makes policy invariants self-enforcing.
7. The enforcement model: control compiles and pushes per-node filters, netmaps omit fully denied peers, and the destination node drops what policy does not accept.

## Cross references

- Module 02, The control plane: the netmap that carries your compiled packet filter, and why a wedged control connection means stale policy on one node.
- Module 01, WireGuard foundations: enforcement happens on decrypted packets inside the tunnel boundary; policy never weakens the cryptography.
- Module 04, Identity and auth: users, IdP re-verification behind SSH `check`, and the auth keys that carry tags onto servers.
- Module 07, Routing: `autogroup:internet`, exit nodes, `autoApprovers`, `via` grants, and why subnet-routed traffic bypasses posture.
- Module 08, Exposing services: app capabilities meet real services, and policy for shared and funneled endpoints.
- Module 10, Enterprise operations: GitOps for the policy file, plan tiers for posture attributes, and role autogroups at org scale.
- Module 11, Troubleshooting and observability: the timeout-versus-refused fingerprint and netmap pruning as first-line diagnosis.
