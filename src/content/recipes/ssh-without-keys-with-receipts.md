---
slug: ssh-without-keys-with-receipts
title: Replace SSH keys with identity, then record the sessions
description: Run Tailscale SSH with no key distribution, force re-authentication at the door of sensitive hosts with action check, and stream privileged sessions to a recorder node so they can be audited afterward.
level: advanced
payoff: No authorized_keys to manage, a fresh identity proof before every privileged login, and a greppable recording of what was typed.
order: 4
words: 1980
sources:
  - id: kb-ssh
    url: https://tailscale.com/docs/features/tailscale-ssh
    title: Tailscale SSH
    checked: 2026-08-11
  - id: docs-ssh
    url: https://tailscale.com/docs/features/tailscale-ssh
    title: Tailscale SSH (Tailscale Docs)
    checked: 2026-08-11
  - id: kb-recording
    url: https://tailscale.com/docs/features/tailscale-ssh/tailscale-ssh-session-recording
    title: Tailscale SSH session recording
    checked: 2026-08-11
  - id: kb-acl-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-11
  - id: kb-targets
    url: https://tailscale.com/docs/reference/targets-and-selectors
    title: Policy file targets and autogroups
    checked: 2026-08-11
  - id: kb-tags
    url: https://tailscale.com/docs/features/tags
    title: Tags
    checked: 2026-08-11
  - id: ts-pricing
    url: https://tailscale.com/pricing
    title: Tailscale pricing and plans
    checked: 2026-08-11
  - id: ts-changelog
    url: https://tailscale.com/changelog
    title: Tailscale changelog
    checked: 2026-08-11
---

## What you get

Key distribution is the part of SSH nobody enjoys owning. Public keys accumulate in `authorized_keys` files across a fleet, nobody remembers which laptop a given key lives on, and removing access means finding every host that ever trusted it. Tailscale SSH replaces that entirely: the connecting device is already authenticated to the tailnet, so the policy file decides who may reach which host as which local user, and there is no key material to hand out or claw back. Revocation becomes a policy edit rather than a fleet sweep.

Then you add the two things almost nobody turns on. First, `action: check`, which forces the user back through your identity provider before a session to a sensitive host, and which "may also trigger any identity provider multifactor authentication (MFA) or other risk-based challenges" (kb-ssh). Second, session recording, which streams the terminal to a recorder node in asciinema format, producing "newline-delimited JSON files that can be searched as text" (kb-recording). The result is an SSH story with a beginning you can prove and a middle you can read back.

## How it works

Enabling Tailscale SSH on a host makes tailscaled claim "port `22` for the Tailscale IP address (that is, only for traffic coming from your tailnet)" and route that traffic "to an SSH server run by Tailscale, instead of your standard SSH server" (kb-ssh, docs-ssh). The mechanism is netstack port interception plus just-in-time configuration, not a rewrite of your host. The documentation is explicit that your `/etc/ssh/sshd_config` and `~/.ssh/authorized_keys` "will not be modified, which means that other SSH connections to the same host, not made over Tailscale, will still work" (kb-ssh). Your existing sshd stays exactly where it was, on every other address, which is what makes this safe to switch on before you trust it.

Access is decided by the `ssh` section of the tailnet policy file, evaluated per connection against the peer's identity. `action` is either `"accept"`, which accepts authenticated tailnet users, or `"check"`, which requires periodic reauthentication (kb-acl-syntax). When a rule also carries a `recorder` field, the session is streamed to the tagged recorder nodes it names.

<div class="diagram-wrap">
<svg viewBox="0 0 760 470" role="img" aria-label="Topology diagram showing node-b connecting on port 22 to node-a, where tailscaled intercepts port 22 on the Tailscale IP while sshd continues serving other addresses, the tailnet policy ssh rule decides accept or check, and the session is streamed to a recorder node tagged session recorder that writes cast files to disk or S3">
  <title>Tailscale SSH: who decides, who serves, and where the recording goes</title>
  <rect x="40" y="20" width="230" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="155" y="46" text-anchor="middle" fill="var(--diagram-text)" font-size="15">node-b (any platform)</text>
  <text x="155" y="66" text-anchor="middle" fill="var(--diagram-text)" font-size="11">ssh someuser@node-a</text>
  <line x1="155" y1="84" x2="155" y2="132" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="167" y="112" fill="var(--diagram-text)" font-size="11">TCP 22, Tailscale IP only</text>
  <rect x="40" y="132" width="440" height="150" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="60" y="156" fill="var(--diagram-text)" font-size="15">node-a</text>
  <rect x="60" y="170" width="190" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="155" y="198" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tailscaled SSH server</text>
  <rect x="270" y="170" width="190" height="46" rx="6" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="365" y="191" text-anchor="middle" fill="var(--diagram-text)" font-size="11">your sshd, untouched,</text>
  <text x="365" y="207" text-anchor="middle" fill="var(--diagram-text)" font-size="11">on every other address</text>
  <text x="60" y="242" fill="var(--diagram-text)" font-size="11">netstack intercepts port 22 for the Tailscale IP</text>
  <text x="60" y="264" fill="var(--diagram-text)" font-size="11">sshd_config and authorized_keys are not modified</text>
  <line x1="480" y1="180" x2="530" y2="180" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="530" y="132" width="200" height="96" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="630" y="158" text-anchor="middle" fill="var(--diagram-text)" font-size="14">policy file ssh rule</text>
  <text x="630" y="180" text-anchor="middle" fill="var(--diagram-text)" font-size="11">src, dst, users</text>
  <text x="630" y="200" text-anchor="middle" fill="var(--diagram-text)" font-size="11">action accept or check</text>
  <text x="630" y="220" text-anchor="middle" fill="var(--diagram-text)" font-size="11">recorder, enforceRecorder</text>
  <text x="530" y="252" fill="var(--diagram-text)" font-size="11">check sends the user to</text>
  <text x="530" y="270" fill="var(--diagram-text)" font-size="11">a sign in URL first</text>
  <line x1="155" y1="282" x2="155" y2="330" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="167" y="310" fill="var(--diagram-text)" font-size="11">terminal stream</text>
  <rect x="40" y="330" width="280" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="180" y="356" text-anchor="middle" fill="var(--diagram-text)" font-size="14">recorder node</text>
  <text x="180" y="376" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tag:session-recorder</text>
  <line x1="320" y1="362" x2="380" y2="362" stroke="var(--diagram-line)" stroke-width="2"/>
  <rect x="380" y="330" width="300" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="530" y="356" text-anchor="middle" fill="var(--diagram-text)" font-size="14">local disk or S3</text>
  <text x="530" y="376" text-anchor="middle" fill="var(--diagram-text)" font-size="11">.cast, newline delimited JSON</text>
  <text x="40" y="428" fill="var(--diagram-text)" font-size="11">enforceRecorder true: recorder unreachable means the session is denied or stopped.</text>
</svg>
</div>

> [!HOW-IT-WORKS]
> Port 22 is claimed only for the Tailscale IP address, which is why this is additive rather than a migration. Your existing sshd keeps answering on the LAN address and the console, so if the policy file is wrong you have not locked yourself out of the machine. Note the flip side: Tailscale SSH supports only port 22, and "there is no way to configure Tailscale SSH to use a different port" (kb-ssh).

## Build it

1. **Enable the SSH server on the destination node.** The documented command is:

   ```shell
   tailscale set --ssh
   ```

   The `--ssh` flag also exists on `tailscale up`, which is how the docs show a key rotation: `tailscale up --ssh --force-reauth` (kb-ssh). The server side runs on "Linux and macOS open source `tailscale` + `tailscaled` CLI devices only" and requires Tailscale v1.24 or later; clients can be any device running Tailscale (kb-ssh).

2. **Write the baseline rule.** A new tailnet ships with this default (kb-ssh):

   ```json
   "ssh": [
     {
       "action": "check",
       "src":    ["autogroup:member"],
       "dst":    ["autogroup:self"],
       "users":  ["autogroup:nonroot", "root"]
     }
   ]
   ```

   `src` accepts a user, group, tag, `user:*@<domain>`, or an autogroup, and cannot be a bare `*`. `dst` accepts a user, tag, or autogroup, also never a bare `*`, and needs no port because only 22 applies. `users` is "the set of allowed usernames on the host" and accepts `autogroup:nonroot` or `localpart:*@<domain>` (kb-ssh, kb-acl-syntax). The relevant autogroups: `autogroup:self` "includes all devices owned by the same user," `autogroup:member` "includes all members of the tailnet," `autogroup:tagged` "includes all devices that have at least one tag," and `autogroup:nonroot` is SSH specific, meaning "a user can log in as any user except root" (kb-targets).

3. **Split sensitive destinations onto a check rule.** Give the hosts that matter their own tag and their own rule:

   ```json
   {
     "action":      "check",
     "src":         ["group:platform"],
     "dst":         ["tag:prod"],
     "users":       ["autogroup:nonroot"],
     "checkPeriod": "1h"
   }
   ```

   `checkPeriod` has a "minimum of one minute and a maximum of 168 hours (one week)" and defaults to 12 hours; `"always"` is also accepted (kb-ssh). Choose the number deliberately: it is how long a single identity proof stays good for that destination.

4. **Create the recorder tag.** Session recording routes to tagged nodes, so declare the tag first (kb-recording):

   ```json
   "tagOwners": {
     "tag:session-recorder": ["<tag-owner>"],
   }
   ```

5. **Run the recorder.** The documented container invocation is:

   ```shell
   docker run --name tsrecorder --rm -it \
     -e TS_AUTHKEY=$TS_AUTHKEY \
     -v $HOME/tsrecorder:/data \
     tailscale/tsrecorder:stable \
     /tsrecorder --dst=/data/recordings --statedir=/data/state --ui
   ```

   `--dst` "specifies where recordings will be saved" and "accepts a local file path or an S3 region URL"; `--statedir` is where the recorder keeps internal state; `--ui` "enables the recorder container web UI for viewing recorded SSH sessions" (kb-recording). Use an auth key that applies `tag:session-recorder`, and for S3 add `--bucket` with `--access-key` and `--secret-key`.

6. **Attach the recorder to the rule.** The documented shape (kb-recording):

   ```json
   {
     "action":          "check",
     "src":             ["group:platform"],
     "dst":             ["tag:prod"],
     "users":           ["autogroup:nonroot"],
     "checkPeriod":     "1h",
     "recorder":        ["tag:session-recorder"],
     "enforceRecorder": true
   }
   ```

   `recorder` is an "optional field; specify the tag attached to your recorder node." `enforceRecorder` is an "optional field; defaults to false; if session recorder node is unavailable, should the session be denied?" (kb-recording).

## Verify it

Prove three separate things, because they fail independently.

**Prove the identity path.** From node-b, `ssh someuser@node-a` against a host covered by the check rule. Check mode gives the user "a URL for signing in" and may add MFA or other risk-based challenges; after that the user reaches the device without re-verification for the `checkPeriod`, defaulting to 12 hours (kb-ssh, docs-ssh). If you get a shell with no prompt at all, your connection matched an `accept` rule somewhere else in the list, not the rule you just wrote.

**Prove the recording path.** Do something distinctive in the session, then find it in the recording. Because the format is asciinema, a `.cast` file is newline delimited JSON with a header and timestamped output entries, and the documented example of searching one is simply:

```shell
grep "sudo" <session-recording.cast>
```

You can also replay it with `play <session-recording.cast>` using asciinema, or open the recorder web UI at `https://{recorder-name}.{tailnet-dns-name}.ts.net` (kb-recording).

**Prove the enforcement path.** This is the test everybody skips. Stop the recorder and try to connect again. With `enforceRecorder: true`, "Tailscale SSH sessions will be refused. Any active Tailscale SSH sessions will be terminated" (kb-recording). If the session succeeds instead, `enforceRecorder` is not set on the rule your connection actually matched, and your recording coverage is best effort.

Failure signatures worth recognizing: an access denial usually means no rule matched, not that the daemon is broken; a MagicDNS resolution failure produces connection errors because you cannot connect using non-Tailscale IP addresses; and a session that dies mid command with "Access revoked" is a policy change, not a network fault.

## Gotchas

1. **Tagging a node removes it from `autogroup:self`, silently.** "Applying a tag to a device removes any user-based authentication," and "it's impossible for a user account identity and a tag identity to exist on the same device" (kb-tags). Since `autogroup:self` means devices owned by the same user (kb-targets), a device you just tagged no longer has an owning user and stops matching. The Tailscale SSH documentation states directly that tagged devices cannot use `autogroup:self` (kb-ssh). The default policy uses `dst: ["autogroup:self"]`, so the day someone tags a lab machine for a different reason, SSH to it stops working and nothing in the policy file looks wrong.

2. **Policy changes cut live sessions.** Restricting a user's SSH access "will stop existing SSH connections the user has established. The user will receive a message, 'Access revoked'" (kb-ssh). Clients respond to new rules within seconds (docs-ssh). Do not edit the policy file mid maintenance window and expect the person on the console to survive it.

3. **Restarting tailscaled ends sessions too.** Upgrades count. That is an availability property of putting the SSH server inside the daemon (kb-ssh).

4. **`checkPeriod: "always"` breaks automation.** It "may cause unexpected behavior with automation tools that open many SSH connections in a short time span, like Ansible" (kb-ssh). Use it on a jump destination a human touches, not on anything a tool loops over.

5. **Widen `dst` and you must revisit `users`.** The docs warn that if you change `dst` from `autogroup:self` to some other destination, you should "also consider replacing `autogroup:nonroot`" (kb-ssh), because a users list that was safe for your own devices is not automatically safe for shared infrastructure.

6. **Any OS user on the client machine inherits the access.** There is no local key file authentication, so on a multi-user client "any OS user on the client machine can connect to SSH servers over Tailscale" (kb-ssh). Shared client machines are the weak point of the whole design.

7. **`enforceRecorder` defaults to false.** Without it, "Tailscale will allow a Tailscale SSH session to connect when session recording is enabled for its SSH access rule even if the recorder nodes are unreachable" (kb-recording). A recording policy you cannot depend on is a compliance claim you cannot make. Set it to true where the receipts actually matter, and accept that you have chosen audit over availability.

> [!GOTCHA]
> Plan availability differs between the two halves of this recipe, and the sources do not read identically. Tailscale SSH itself is "available for all plans" (kb-ssh). For recording, the documentation says "Tailscale SSH session recording is available for the Personal and Enterprise plans" (kb-recording), while the pricing page presents Personal, Standard, Premium, and Enterprise, puts advanced Tailscale SSH capabilities on the higher tiers, and groups SSH recording under a Privileged Access Management platform extension (ts-pricing). Confirm against the pricing page for your own tailnet before you promise anyone an audit trail.

> [!FROM-THE-FIELD]
> Order your `ssh` rules as deliberately as firewall rules and test with the destination you care about, not a convenient one. The common self inflicted wound is a broad `accept` rule written months earlier that quietly matches first, so the shiny new `check` and `recorder` rule never evaluates. Nothing errors. You simply get an unrecorded session and a false sense of coverage, which is worse than having no recording at all.

## Where to take it next

Separate recorder storage from recorder compute. Point `--dst` at an S3 region URL with a bucket whose retention and object lock are managed outside the tailnet, so a compromised node cannot erase its own transcript. That is the difference between a recording and evidence.

Build a two tier destination model. Tag the majority of hosts for `accept` with a generous `checkPeriod` nowhere in sight, and reserve `check` plus `enforceRecorder` for a small set of tagged production destinations. Fewer prompts on low value hosts means people stop treating the prompt as noise on the ones that matter.

Push identity further down the stack. As of 2026 workload identity federation is generally available, letting you authenticate Tailscale API requests with federated OIDC workload identities from third party providers, and Tailscale Services and Peer Relays are generally available as well (ts-changelog). The same instinct that removed `authorized_keys` from your hosts removes static API credentials from your automation.

Make the recordings answer questions on a schedule. Since `.cast` files are newline delimited JSON, a nightly pass that greps for privilege escalation and unexpected binaries turns a passive archive into a detection surface, using tools you already have.
