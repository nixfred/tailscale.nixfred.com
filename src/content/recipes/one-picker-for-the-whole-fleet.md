---
slug: one-picker-for-the-whole-fleet
title: Stop typing hostnames and treat the whole fleet as one machine
description: A project picker that spans every machine on the tailnet, jumping you into persistent sessions locally or over SSH without you ever naming a host, plus fan out to run one command everywhere.
level: intermediate
payoff: You think in projects instead of hosts, and long running work survives reboots on every machine at once.
order: 2
words: 1850
sources:
  - id: kb-magicdns
    url: https://tailscale.com/kb/1081/magicdns
    title: MagicDNS
    checked: 2026-08-11
  - id: kb-ssh
    url: https://tailscale.com/kb/1193/tailscale-ssh
    title: Tailscale SSH
    checked: 2026-08-11
  - id: kb-cli
    url: https://tailscale.com/kb/1080/cli
    title: Tailscale CLI
    checked: 2026-08-11
  - id: kb-100x
    url: https://tailscale.com/kb/1015/100.x-addresses
    title: What are these 100.x.y.z addresses?
    checked: 2026-08-11
---

## What you get

A single picker that lists every project you have going, across every machine you own, with a live indicator of which ones are running. You select one and you are in it. If the work lives on the machine you are sitting at, you attach locally. If it lives on a machine three networks away, you land there over SSH. You never type a hostname, and you never think about where anything is.

Then the same registry gives you fan out: run one command across every project on every machine, in parallel, with all the output and exit codes collected together. Bulk operations across a fleet stop being a scripting exercise.

The tailnet is what makes this ordinary rather than clever. Stable names that work identically from home, from a coffee shop, and from a phone tether are the entire foundation. Without them you are maintaining a list of addresses that goes stale every time something moves.

## How it works

Three layers, each boring on its own.

The bottom layer is naming. Every machine has a stable name on the tailnet, and that name resolves the same way regardless of which network any of them is on. That is what lets a static registry stay correct.

The middle layer is a registry: a plain text file mapping a project name to a host, a directory, and a start command. Not a service, not a database. A file you can read.

The top layer is a picker that reads the registry, checks which sessions are live, and dispatches. Same machine means a local terminal multiplexer switch. Different machine means an SSH hop into the multiplexer session there. The dispatch decision is one comparison: does the host column match this machine.

<div class="diagram-wrap">
<svg viewBox="0 0 760 320" role="img" aria-label="A picker reads a registry of projects, checks live status, then either attaches locally or hops over the tailnet to the machine that owns the project">
  <title>Registry, picker, and the local versus remote dispatch</title>
  <rect x="20" y="18" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="120" y="42" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">registry file</text>
  <text x="120" y="61" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">name, host, dir,</text>
  <text x="120" y="77" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">start command</text>

  <rect x="280" y="18" width="200" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="380" y="42" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">picker</text>
  <text x="380" y="61" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">live status per row</text>
  <text x="380" y="77" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">fuzzy search</text>

  <g stroke="var(--diagram-accent)" stroke-width="2" fill="none">
    <path d="M220 53 L280 53"/>
  </g>

  <path d="M380 88 L380 118" stroke="var(--diagram-line)" stroke-width="1.5" fill="none"/>
  <rect x="270" y="118" width="220" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="380" y="143" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">host column == this machine?</text>

  <g stroke="var(--diagram-line)" stroke-width="1.5" fill="none">
    <path d="M300 158 L180 196 M460 158 L580 196"/>
  </g>

  <rect x="40" y="196" width="270" height="62" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="175" y="220" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">yes: attach locally</text>
  <text x="175" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">multiplexer switch, no network</text>

  <rect x="450" y="196" width="270" height="62" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="585" y="220" text-anchor="middle" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">no: hop over the tailnet</text>
  <text x="585" y="240" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">ssh to the MagicDNS name</text>

  <text x="380" y="296" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">the host column is BOTH the self check and the ssh target, so one name must satisfy both</text>
</svg>
</div>

> [!HOW-IT-WORKS] The reason a static registry does not rot is that tailnet names are identity, not location. A laptop that moves from home to a hotel keeps its name and its address, so a line in a text file written months ago still resolves to the right machine. Registries keyed on public addresses or local network names need constant maintenance; this one needs none.

## Build it

1. **Confirm names resolve before building anything on top of them.** From any machine, reach every other by name alone.

    ```bash
    tailscale status
    ssh node-b uptime
    ```

    If that needs an address or a config entry, fix naming first. Everything below assumes plain names work.

2. **Write the registry.** One line per project: a name, the host that owns it, the directory, and the command that starts the work. Tab separated is enough.

    ```
    api-rewrite    node-a     /home/pi/Projects/api      nvim .
    log-triage     lab-vm-1   /home/pi/Projects/logs     ./watch.sh
    site-build     cloud-1    /home/pi/Projects/site     npm run dev
    ```

3. **Make sessions persistent.** Each project gets a named terminal multiplexer session on its own host, so work survives disconnects and reboots. This is what turns a picker into a workspace.

4. **Write the dispatch.** For a selected project, compare the host column against this machine. Equal means attach or switch locally. Not equal means hop:

    ```bash
    if [ "$host" = "$(hostname -s)" ]; then
      tmux switch-client -t "$name" 2>/dev/null || tmux attach -t "$name"
    else
      ssh -t "$host" "tmux attach -t '$name' || tmux new -s '$name' -c '$dir'"
    fi
    ```

5. **Recreate sessions at boot**, idempotently, so a machine that restarts overnight comes back with its work running. A user level service unit on Linux, with lingering enabled so it starts without a login. The equivalent launch agent on macOS.

6. **Add fan out.** Same registry, different verb: run one command in every project directory on every host at once, remote ones over SSH, in parallel, and collect the output and exit codes together. Preview the list and confirm before it runs, because this is a loaded gun pointed at every machine you own.

7. **Optional, and the part that makes it feel like one machine:** have an interactive login on a fleet machine drop you straight into the picker when you are not already in a session.

## Verify it

1. From machine A, pick a project that lives on machine B. You should land in it without typing a name, and the session should already have your work in it.
2. Detach, then attach again from a third machine. Same session, same state.
3. Reboot a machine. Its sessions should come back on their own. If they do not, the boot unit is wired but not enabled, or lingering is off.
4. Run fan out with something harmless like `git status --short` and confirm every host reports, including the ones you forgot you had.

## Gotchas

1. **The system hostname and the tailnet name can disagree, and this design breaks when they do.** On one machine `hostname -s` returned a longer internal name while the name that actually resolved over the tailnet was a shorter one. Because the host column serves as both the self check and the SSH target, the two must be the same string. Pick which name is canonical, then make it true everywhere: either register the tailnet name and override what the machine calls itself, or add an alias so the system name resolves too. This is a fifteen minute problem that presents as an hour of confusion, because the picker will cheerfully SSH from a machine to itself and hang.

2. **A registry entry pointing at a directory that does not exist creates an empty session that looks fine.** Validate the directory as part of status, or you will attach to a shell in the wrong place and not notice.

3. **Fan out is genuinely dangerous.** One command against every machine you own is exactly as destructive as it sounds. Preview the target list, require confirmation, support filtering to a subset, and never let it run unattended the first time.

4. **Nested multiplexer sessions confuse everyone.** Hopping into a remote session from inside a local one means your key prefix now has two possible owners. Decide on a convention early.

5. **If you use Tailscale SSH for the hop, remember that policy changes cut live sessions.** An access policy edit while you are attached will drop you, which is correct behavior and still surprising the first time.

> [!GOTCHA] Do not build this on top of names that only resolve on your home network. The entire value proposition is that the same registry works from a hotel, a phone tether, and a machine in another country. The moment one entry depends on a local resolver, the tool becomes unreliable exactly when you need it most, which is when you are not home.

## Where to take it next

1. Add a live status column that distinguishes running, stopped, and unreachable, so a machine that is off is visibly different from a project that simply is not started.
2. Cache fleet status briefly. Probing every host on every keystroke of a fuzzy search is a good way to make a picker feel slow.
3. Teach fan out to detect completion rather than just collecting output, so you can use it for long running work rather than only quick queries.
4. Keep the registry in version control and treat adding a machine to the fleet as a reviewable change.
