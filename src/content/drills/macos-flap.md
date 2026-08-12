---
slug: macos-flap
title: The macOS tunnel dies 150 seconds after every tailscale up
description: A second GUI app instance keeps loading a stale VPN configuration that fails code signature validation, macOS removes the live configuration, and the restarted extension reloads a persisted WantRunning false that undoes every fix.
area: platform
difficulty: 3
symptom: "Every time I bring Tailscale up on my Mac it works for about two and a half minutes, then the menu bar says Not Connected. I have reconnected nine times today."
words: 1500
sources:
  - id: kb-macos-variants
    url: https://tailscale.com/docs/concepts/macos-variants
    title: Three ways to run Tailscale on macOS
    checked: 2026-08-10
  - id: kb-troubleshooting
    url: https://tailscale.com/docs/reference/troubleshooting
    title: Troubleshooting guide
    checked: 2026-08-10
  - id: docs-debug-menu
    url: https://tailscale.com/docs/reference/debug-menu
    title: Debug menu and options
    checked: 2026-08-10
  - id: src-bundle-ids
    url: https://github.com/tailscale/tailscale/blob/main/version/prop.go
    title: tailscale/tailscale version/prop.go (macOS bundle identifiers)
    checked: 2026-08-10
---

## The ticket

The Customer is a developer on a MacBook, node-a, who depends on the tailnet for SSH into build machines. Since a laptop migration last week, the tunnel dies roughly two and a half minutes after every manual `tailscale up`. The menu bar flips to Not Connected, SSH sessions freeze, and the cycle repeats identically every time. Reboots do not help. The Customer is on the standalone client and has already reinstalled it once, which changed nothing. Urgency is high: they have been reconnecting by hand all day.

> "It connects fine, works for exactly a couple of minutes, then just turns itself off. It is like something is switching it off behind my back."

"Exactly a couple of minutes, every time" is the gift in this ticket. Random failures suggest network weather. A repeating interval suggests a scheduled or triggered mechanism on the machine itself.

## Evidence provided

```
$ tailscale up
$ tailscale status | head -2
100.64.0.11   node-a    ops@   macOS   -
100.64.0.30   node-b    ops@   linux   idle; offers exit node

# 150 seconds later, unprompted:
$ tailscale status
Tailscale is stopped.
```

The unified log around one failure, collected with `log show`:

```
$ log show --last 10m --style compact \
    --predicate 'process CONTAINS "nesessionmanager" OR process CONTAINS "sysextd"'
14:31:40.112 Df sysextd[912]: activation request for io.tailscale.ipn.macos.network-extension
14:31:41.007 Df sysextd[912]: code signature validation failed for extension io.tailscale.ipn.macos.network-extension
14:31:41.020 Df nesessionmanager[734]: NESMVPNSession[Tailscale]: status changed to disconnected, last stop reason Plugin was disabled
14:31:41.031 Df nesessionmanager[734]: removing VPN configuration: The VPN app used by the VPN configuration is not installed
```

Note the bundle identifier: the failing extension is `io.tailscale.ipn.macos.network-extension`, which is the App Store network extension, but the installed standalone client uses `io.tailscale.ipn.macsys.network-extension`, the macsys system extension (src-bundle-ids). Two different identifiers means two different app variants are alive on this machine (kb-macos-variants).

## Hypothesis tree

A tunnel that dies on a timer has a few plausible killers, and they leave different fingerprints in the unified log.

<div class="diagram-wrap">
<svg viewBox="0 0 760 330" role="img" aria-label="Hypothesis tree for macOS tunnel dying on a timer"><title>Hypothesis tree: macOS tunnel dies 150 seconds after up</title><rect x="230" y="12" width="300" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="32" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Tunnel dies ~150 s after tailscale up</text><text x="380" y="50" text-anchor="middle" fill="var(--diagram-text)" font-size="11">same interval every cycle</text><line x1="380" y1="58" x2="130" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="380" y2="120" stroke="var(--diagram-line)"/><line x1="380" y1="58" x2="630" y2="120" stroke="var(--diagram-line)"/><rect x="20" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">A. Control plane or key</text><text x="130" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">expiry drops the node</text><rect x="270" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">B. System extension is</text><text x="380" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">crashing or unhealthy</text><rect x="520" y="120" width="220" height="64" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="630" y="142" text-anchor="middle" fill="var(--diagram-text)" font-size="12">C. A second app instance</text><text x="630" y="160" text-anchor="middle" fill="var(--diagram-text)" font-size="11">tears down the live VPN config</text><line x1="130" y1="184" x2="130" y2="224" stroke="var(--diagram-line)"/><line x1="380" y1="184" x2="380" y2="224" stroke="var(--diagram-line)"/><line x1="630" y1="184" x2="630" y2="224" stroke="var(--diagram-line)"/><rect x="20" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="130" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: log show shows</text><text x="130" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">a LOCAL teardown, no control</text><text x="130" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">plane disconnect or auth error</text><rect x="270" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/><text x="380" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: sysext status</text><text x="380" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">healthy, no crash reports,</text><text x="380" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">extension stays activated</text><rect x="520" y="224" width="220" height="78" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/><text x="630" y="246" text-anchor="middle" fill="var(--diagram-text)" font-size="11">Discriminator: two GUI processes</text><text x="630" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11">with different bundle IDs;</text><text x="630" y="278" text-anchor="middle" fill="var(--diagram-text)" font-size="11">scutil shows the config vanish</text></svg>
</div>

## Investigation

1. **Count the GUI instances.**

    ```
    $ pgrep -fl Tailscale | grep -v grep
    1043 /Applications/Tailscale.app/Contents/MacOS/Tailscale
    1187 /Applications/Tailscale-AppStore.app/Contents/MacOS/Tailscale
    ```

    Two running copies: the freshly installed standalone app, and the older Mac App Store copy, which the admin renamed rather than removed when installing the standalone build. Renaming leaves the bundle launchable and leaves its login item intact, so both start at boot. The macOS variants documentation is explicit: "Do not install the Mac App Store variant and the Standalone variant on the same machine. Having both variants running simultaneously can prevent the Tailscale extension from launching" (kb-macos-variants). This immediately rules out hypothesis A: key expiry and control plane behavior live in Module 02 and do not care how many local processes exist, and the log showed no auth error anyway.

2. **Check extension health.**

    ```
    $ tailscale configure sysext status
    System extension state: OK. For more detailed information, run `systemextensionsctl list`.
    ```

    The standalone system extension itself is healthy (docs-debug-menu points at this same command from the Debug menu's System Extension item), `systemextensionsctl list` shows `io.tailscale.ipn.macsys.network-extension` in state `[activated enabled]`, and there are no crash reports for it. That rules out hypothesis B: nothing is crashing. Something is administratively removing the tunnel out from under a healthy extension.

3. **Watch the VPN configuration across one failure cycle.**

    ```
    $ scutil --nc list
    Available network connection services in the current set (*=enabled):
    * (Connected)      8F2A11D0-51B2-4E2E-9B1C-0F44D2AA61C7 VPN (io.tailscale.ipn.macsys) "Tailscale"    [VPN:io.tailscale.ipn.macsys]

    # 150 seconds later
    $ scutil --nc list
    Available network connection services in the current set (*=enabled):
    ```

    The live VPN configuration does not disconnect; it is deleted. Combined with the `nesessionmanager` log line "removing VPN configuration," this confirms the mechanism is at the macOS configuration layer, not inside WireGuard or the network.

4. **Line up the log timeline.** The `sysextd` activation request for the App Store bundle ID fires at T+140 s after login item respawn, code signature validation fails one second later (the migrated app bundle is damaged), and `nesessionmanager` tears down the VPN configuration in the same second. The interval is not mysterious: it is the stale app's own retry cadence.

5. **Check what the daemon believes after a flap.**

    ```
    $ tailscale debug prefs | grep -i wantrunning
    	"WantRunning": false,
    ```

    This is the second half of the bug, and the reason the reinstall "changed nothing." When the extension restarts after the teardown, it does not resume the running state the Customer created with `tailscale up`. It reloads its persisted preferences from disk, and the persisted record now says WantRunning false, written during the forced stop. Runtime state said connected; persisted state said stopped; persisted state wins on every restart.

## Root cause

A chain, and every link is required. The laptop migration left a second Tailscale GUI variant on disk with a login item. The two variants are genuinely different programs: the App Store build is a sandboxed network extension, the standalone build is a system extension with different capabilities and different credential storage, which is the Module 09 platform matrix in action (kb-macos-variants). The stale App Store copy relaunches, registers its own VPN configuration, and fails macOS code signature validation because the migrated bundle is damaged. macOS responds by removing the VPN configuration, and that removal kills the LIVE tunnel, not just the stale one. The extension then restarts and loads persisted preferences in which WantRunning is false, so the machine settles into Not Connected instead of self-healing. Every manual `tailscale up` only flips runtime state; it never removes the process that keeps rewriting the outcome.

> [!HOW-IT-WORKS]
> Tailscale separates what you asked for right now (runtime state) from what should survive a restart (persisted preferences). WantRunning is persisted precisely so the tunnel comes back after reboots. That same persistence faithfully preserves a forced stop, which is why a fix that only touches runtime state evaporates on the next extension restart.

> [!GOTCHA]
> Never install more than one macOS variant at a time. The variants documentation warns that having both variants running simultaneously "can prevent the Tailscale extension from launching" (kb-macos-variants), and migration tools are the classic way a second copy sneaks on. "I only see one icon" is not evidence; `pgrep` is.

## Fix and prevention

**Immediate.** Quit both GUI instances. Delete the stale App Store copy and its login item so exactly one variant remains, as the variants documentation requires (kb-macos-variants). Then hold down Option, select the Tailscale icon in the menu bar to reveal the Debug menu, and use Reset, which "Deletes and reinstalls the macOS VPN configuration" (docs-debug-menu), clearing the damaged registration. Note the documented limit: Reset "won't work if your organization is deploying a VPN configuration profile on your Mac using an MDM solution" (docs-debug-menu). Run `tailscale up`.

**Verification, and this is the part that matters:** soak it. The failure signature was T+150 s, so a point check proves nothing. Watch for at least two full failure windows:

```
$ for i in $(seq 1 20); do date +%T; tailscale status --peers=false | head -1; sleep 15; done
```

Five minutes of Running, plus `scutil --nc list` still showing the configuration Connected, is a fix. Anything shorter is a guess. This is the Module 11 discipline: verify against the failure's own period, not against the moment of repair.

**Durable.** Add a post-migration check to laptop provisioning: exactly one Tailscale.app on disk, one bundle ID in login items. If a Customer reports repeat flapping, collect `tailscale bugreport` and the unified log first (kb-troubleshooting); the timeline is the diagnosis.

## The handoff package

Had this needed engineering:

- **Summary:** macOS standalone client tunnel torn down 150 s after up; second migrated App Store app instance fails code signature validation, macOS removes live VPN configuration; extension restart reloads persisted WantRunning false.
- **Repro:** install standalone, leave damaged App Store copy as login item, `tailscale up`, wait 150 s.
- **Log evidence:** node-a (100.64.0.11), 2026-08-10 14:31:40 to 14:31:41 UTC-4: sysextd code signature validation failure for io.tailscale.ipn.macos.network-extension; nesessionmanager "last stop reason Plugin was disabled" then configuration removal. `tailscale debug prefs` post-flap: WantRunning false.
- **Version matrix:** standalone 1.88.1 (system extension), stale App Store copy 1.82.0 (network extension), macOS 15.5.
- **Impact scope:** single machine; any Customer with a migrated duplicate variant is exposed.
- **Ruled out:** key expiry and control plane (no auth errors, teardown is local), extension crash (sysext healthy, no crash reports), network conditions (interval exact and survives network changes).
- **Proposed owning area:** macOS client, variant coexistence detection.

## The trap

The weak investigation fixes the symptom it can see: run `tailscale up`, watch the menu bar turn Connected, close the ticket. It passes the point check and dies 150 seconds later, nine times, burning the Customer's trust a little more each round. The second trap is reinstalling the visible app while never counting processes, so the invisible second instance survives every reinstall. The discipline this drill teaches: when a failure has a period, your verification must be longer than the period, and when state keeps reverting, ask who persists that state and when it is reloaded. Point checks validate moments. Soak checks validate mechanisms.
