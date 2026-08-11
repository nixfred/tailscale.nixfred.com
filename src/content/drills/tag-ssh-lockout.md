---
slug: tag-ssh-lockout
title: Tagging a server kills Tailscale SSH to it
description: Applying tag:server replaces the node's user identity, the node leaves autogroup:self, and every self scoped SSH rule stops matching while connectivity stays perfect.
area: identity
difficulty: 2
symptom: "I tagged the machine and SSH died the same second. Ping works, status says active. Tailscale SSH is broken."
words: 1450
sources:
  - id: kb-tags
    url: https://tailscale.com/kb/1068/tags
    title: Group devices with tags
    checked: 2026-08-10
  - id: kb-tailscale-ssh
    url: https://tailscale.com/kb/1193/tailscale-ssh
    title: Tailscale SSH
    checked: 2026-08-10
  - id: kb-acl-syntax
    url: https://tailscale.com/kb/1337/acl-syntax
    title: Syntax reference for the tailnet policy file
    checked: 2026-08-10
  - id: kb-autogroups
    url: https://tailscale.com/kb/1396/targets
    title: Targets and selectors
    checked: 2026-08-10
  - id: cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-10
---

## The ticket

Tuesday afternoon, inventory hygiene. An ops admin applies `tag:server` to a lab web box, node-a, so ACLs can target it by role instead of by owner. The admin runs the tag command from an SSH session that is itself running over Tailscale SSH. That session dies instantly, and every reconnect attempt is refused. A deploy window opens in an hour, so urgency is high. The tailnet is about 40 nodes, Tailscale SSH is enabled on all servers, and the policy file is managed in the admin console. The Customer opens the ticket with:

> "Nothing on the network changed. I tagged the machine and SSH died the same second. Ping works, status says active. Tailscale SSH is broken."

## Evidence provided

The first responder collected four pieces of evidence. First, the moment of failure, captured in the admin's scrollback:

```
ops@node-a:~$ sudo tailscale login --advertise-tags=tag:server

To authenticate, visit:

	https://login.tailscale.com/a/1a2b3c4d5e6f

Access revoked.
Connection to node-a closed.
```

Second, connectivity from the admin's laptop is perfect:

```
$ tailscale ping node-a
pong from node-a (100.64.0.11) via 198.51.100.23:41641 in 9ms

$ ssh ops@node-a
Connection closed by 100.64.0.11 port 22
```

Third, the status line for node-a, as seen from the laptop:

```
$ tailscale status | grep node-a
100.64.0.11  node-a  tagged-devices  linux  active; direct 198.51.100.23:41641, tx 18244 rx 96410
```

Fourth, the `ssh` section of the tailnet policy file, unchanged for months:

```jsonc
"ssh": [
  {
    "action": "accept",
    "src":    ["autogroup:member"],
    "dst":    ["autogroup:self"],
    "users":  ["autogroup:nonroot"]
  },
  {
    "action": "check",
    "src":    ["group:admins"],
    "dst":    ["autogroup:self"],
    "users":  ["root"]
  }
]
```

## Hypothesis tree

The symptom pair is the whole story: SSH refused, ping fine, and the failure is time locked to the tag command. Four hypotheses cover the space. Watch how expensive each branch is to close. The network branch costs one command. The policy branch, which is the right one, costs two reads: one status line and one policy section. A responder who knows that the owner column in `tailscale status` is identity evidence closes this in under five minutes.

<div class="diagram-wrap">
<svg viewBox="0 0 780 330" role="img" aria-label="Hypothesis tree: SSH to node-a denied seconds after tagging, four branches, policy branch confirmed">
<title>Hypothesis tree for the tag SSH lockout</title>
<rect x="215" y="14" width="350" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="390" y="36" text-anchor="middle" fill="var(--diagram-text)" font-size="14">SSH to node-a denied seconds after tagging</text>
<text x="390" y="54" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tailscale ping still gets pong on a direct path</text>
<line x1="390" y1="66" x2="100" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="293" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="487" y2="130" stroke="var(--diagram-line)"/>
<line x1="390" y1="66" x2="680" y2="130" stroke="var(--diagram-accent)"/>
<rect x="11" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="100" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Data plane broken</text>
<text x="100" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">NAT, DERP, firewall</text>
<rect x="204" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="293" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Host sshd or OS broken</text>
<text x="293" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">daemon crash, config</text>
<rect x="398" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
<text x="487" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">Node auth state</text>
<text x="487" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">expired or logged out</text>
<rect x="591" y="130" width="178" height="54" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
<text x="680" y="152" text-anchor="middle" fill="var(--diagram-text)" font-size="12">SSH policy no longer</text>
<text x="680" y="170" text-anchor="middle" fill="var(--diagram-text)" font-size="11">matches this node</text>
<text x="100" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">pong, direct path</text>
<text x="100" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">closed in one command</text>
<text x="293" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Tailscale SSH owns port 22</text>
<text x="293" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">auth.log is empty</text>
<text x="487" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">status: active</text>
<text x="487" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">not NeedsLogin</text>
<text x="680" y="210" text-anchor="middle" fill="var(--diagram-text)" font-size="11">owner column: tagged-devices</text>
<text x="680" y="226" text-anchor="middle" fill="var(--diagram-text)" font-size="11">every ssh dst: autogroup:self</text>
<text x="100" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 1</text>
<text x="293" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 6</text>
<text x="487" y="258" text-anchor="middle" fill="var(--diagram-text)" font-size="12">RULED OUT: step 2</text>
<text x="680" y="258" text-anchor="middle" fill="var(--diagram-accent)" font-size="12">CONFIRMED: steps 3 to 5</text>
</svg>
</div>

## Investigation

1. **Confirm the data plane.** `tailscale ping node-a` returns `pong from node-a (100.64.0.11) via 198.51.100.23:41641 in 9ms`. That is a direct WireGuard path, no DERP relay. This rules out the entire NAT traversal and connectivity branch (Module 03) in one command. A pong with dead SSH means the failure lives above the tunnel.

2. **Confirm node auth state.** The status line shows `active` with live tx and rx counters, not `NeedsLogin`, not offline. And there is a second reason this branch was always weak: when a device receives its first tag, its key expiry is disabled by default (kb-tags), so a tag operation makes expiry less likely, not more. Auth state branch closed.

3. **Read the owner column.** Yesterday this line read `100.64.0.11 node-a ops@ linux ...`. Today the same column reads `tagged-devices`. That column is the owner login, truncated at the @ by the CLI, which is why a user owned node shows `ops@`; a tagged node has no owning user to show, so it renders under the shared tagged-devices identity instead. Nothing about connectivity changed. Who the node is changed. This is the pivot observation of the whole drill.

4. **Ask the control plane directly.** `tailscale whois 100.64.0.11` from the laptop:

   ```
   Machine:
     Name:       node-a.tail0ab12.ts.net
     ID:         nXYZ123CNTRL
     Addresses:  [100.64.0.11/32 fd7a:115c:a1e0::b/128]
     Tags:       tag:server
   ```

   No user block at all, just a machine with a tag. On an untagged node this same command prints a `User:` section with the owner's login name; here there is nothing to print. The control plane confirms the identity replacement (Module 04).

5. **Match the policy against the new identity.** Both SSH rules have `"dst": ["autogroup:self"]`. Per kb-autogroups, `autogroup:self` is all devices owned by the same user. Per kb-tags, applying a tag removes user-based authentication from the device, so after the tag lands node-a is owned by no user and there is no user for `autogroup:self` to match it under. No SSH rule matches, and unmatched means denied (Module 05). Confirmed.

6. **Negative check on the host branch.** Via the cloud provider's serial console: `journalctl -u ssh` and `/var/log/auth.log` show no connection attempts at the failure timestamps. That is expected: with Tailscale SSH enabled, tailscaled intercepts tailnet traffic to port 22 (kb-tailscale-ssh), and the rejection happened at policy evaluation before any host process was involved. Host branch closed without ever suspecting the box.

## Root cause

Tagging is not a label, it is an identity transplant. The tags KB states it plainly: "Applying a tag to a device removes any user-based authentication" (kb-tags). Before the change, node-a's identity was `ops@example.com`, so it sat inside `autogroup:self`, which the policy reference defines as the devices owned by the same user (kb-autogroups). After the change, its identity is `tag:server` and no user owns it, so nothing puts it back inside that autogroup.

The SSH policy grammar makes the miss total. An SSH rule's `dst` can be a tag, `autogroup:self` (only when the src is users or groups), or a single named user (kb-acl-syntax). This tailnet's policy used only the `autogroup:self` form. The moment node-a's identity changed shape, rule matching went from "yes, via self" to nothing at all, and Tailscale's default deny did the rest. The already open session died at the same moment because policy updates stop existing SSH connections with an "Access revoked" message (kb-tailscale-ssh), which is exactly what the admin's scrollback captured.

> [!HOW-IT-WORKS] Tailscale SSH authorizes by identity, not by network reachability. The WireGuard tunnel (Module 01) answers "can packets flow", the policy engine (Module 05) answers "may this identity open this session". Those layers fail independently, which is why a healthy ping proves almost nothing about SSH.

## Fix and prevention

**Immediate fix.** The policy file lives in the admin console, so the repair path needs zero access to the locked out node. That is your out of band session: log in to the admin console from anywhere and add a rule that matches the node's new identity:

```jsonc
{
  "action": "accept",
  "src":    ["group:admins"],
  "dst":    ["tag:server"],
  "users":  ["autogroup:nonroot", "root"]
}
```

Save, wait a few seconds for propagation, retest. If you need on box access before the policy edit can happen (say the console admin is unreachable), the cloud provider serial console is the fallback, because Tailscale SSH never touched the host's own login stack.

**Prevention.** Treat a tag change and its policy rules as one atomic change, in this order: first commit the ACL and SSH rules that reference the new tag (rules referencing a tag no device carries match nothing, so staging them is safe), then apply the tag. Never the reverse. While you are in the file, audit every `"dst": ["autogroup:self"]` SSH rule: self scoping is the right default for personal devices and the wrong one for shared infrastructure that will ever be tagged.

> [!GOTCHA] Do not plan on untagging your way out of a mistake. You cannot remove tags using the `--advertise-tags` flag if the device uses an auth key; the KB's instruction is to generate a new auth key with the new set of tags and re-authenticate (kb-tags). The policy fix is faster and does not touch the node.

## The handoff package

**Summary:** Tailscale SSH to node-a denied immediately after `tag:server` applied; connectivity intact; consistent with documented autogroup:self semantics, not a product defect.
**Repro:** (1) Node with user identity, SSH policy where all dst are autogroup:self. (2) `sudo tailscale login --advertise-tags=tag:server`. (3) All SSH to node denied; existing sessions cut with "Access revoked".
**Log evidence:** 2026-08-10T14:22:31Z tag applied; same second, open session prints "Access revoked."; 14:23:05Z client `ssh ops@node-a` gets "Connection closed by 100.64.0.11 port 22"; `tailscale whois 100.64.0.11` shows `Tags: tag:server`, machine ID nXYZ123CNTRL; host auth.log empty across the window.
**Version matrix:** node-a Tailscale 1.86.4, Ubuntu 24.04 amd64; client laptop 1.86.2, macOS; policy file last modified 2026-08-10T14:22Z (tag commit only, ssh section unchanged since 2026-03).
**Impact scope:** one node, all SSH users of it; latent for every future node tagged under this policy.
**Ruled out:** data plane (direct pong), node auth state (active, expiry disabled by tagging), host sshd (no connection attempts logged).
**Proposed owning area:** none, behaves as designed; if escalated anyway, control plane policy evaluation.

## The trap

The weak version of this investigation hears "SSH broken, ping fine" and dives into the host: restart sshd, restart tailscaled, reboot the box, then pivot to an hour of `tailscale netcheck` and NAT theory, because networking is where muscle memory lives. Every one of those checks was already answered by evidence in the ticket. The direct pong closed the network branch before the investigation started, and the owner column had already announced the identity change in plain text. The other trap is the panic revert: strip the tag to restore access. It fails outright on auth key devices (kb-tags), and where it works it silently undoes the inventory change, so someone re-tags the box during the next deploy window and recreates the outage with an audience. Cost: hours of misdirected debugging plus a scheduled repeat incident. On any Tailscale SSH failure with healthy connectivity, read the identity columns first: `tailscale status` and `tailscale whois` are policy evidence, not just network evidence.
