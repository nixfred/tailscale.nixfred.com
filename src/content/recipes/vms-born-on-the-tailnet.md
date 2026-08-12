---
slug: vms-born-on-the-tailnet
title: Make every new VM join the tailnet before you ever log in
description: A first boot script that enrolls a fresh cloud VM, then locks ingress to the tailnet only, so the box is never reachable from the public internet at any point in its life.
level: advanced
payoff: New machines arrive already on the tailnet, already firewalled, with no manual step and no window of exposure.
order: 1
words: 2050
sources:
  - id: kb-auth-keys
    url: https://tailscale.com/docs/features/access-control/auth-keys
    title: Auth keys
    checked: 2026-08-11
  - id: kb-tags
    url: https://tailscale.com/docs/features/tags
    title: Tags
    checked: 2026-08-11
  - id: kb-install-linux
    url: https://tailscale.com/docs/install/linux
    title: Install Tailscale on Linux
    checked: 2026-08-11
  - id: kb-firewall-ports
    url: https://tailscale.com/docs/reference/faq/firewall-ports
    title: What firewall ports should I open to use Tailscale?
    checked: 2026-08-11
  - id: kb-acl-autoapprovers
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-11
  - id: kb-cli
    url: https://tailscale.com/docs/reference/tailscale-cli
    title: Tailscale CLI
    checked: 2026-08-11
---

## What you get

A brand new virtual machine that is already a tailnet member the first time you can reach it, with a firewall that accepts inbound traffic only from the tailnet. You never SSH to a public address, never paste an auth key by hand, and never have a window where a fresh box is sitting on the internet with a default configuration.

The pattern generalizes to any provider that runs a script on first boot: cloud-init user data, an image bake step, a provider level default setup script, a container entrypoint. What matters is not the provider mechanism. What matters is the order of operations and one specific way this setup lies to you after a reboot, covered in the gotchas.

## How it works

Three things have to happen in a strict order, and the order is the whole recipe.

First the machine joins the tailnet, using a pre-authorized key so no human has to approve anything. Second, and only after the join is confirmed, the firewall closes to everything except the tailnet interface. Third, the rules are made to re-apply on every subsequent boot, because the thing that enables them at install time is not necessarily the thing that survives a restart.

Inverting the first two steps is how people lock themselves out. If you close the firewall before the machine is on the tailnet, and the join then fails, you have created a box with no ingress path at all.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="First boot ordering: install and join the tailnet, verify the join succeeded, then close the firewall to tailnet only, then persist the rules with a boot unit">
  <title>The order of operations on first boot</title>
  <rect x="20" y="20" width="170" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="105" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">1 install</text>
  <text x="105" y="64" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">and join, tagged key</text>

  <rect x="215" y="20" width="170" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="300" y="45" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">2 verify joined</text>
  <text x="300" y="64" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">the gate for step 3</text>

  <rect x="410" y="20" width="170" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="495" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">3 close ingress</text>
  <text x="495" y="64" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">tailnet interface only</text>

  <rect x="605" y="20" width="135" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="672" y="45" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">4 persist</text>
  <text x="672" y="64" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">own boot unit</text>

  <g stroke="var(--diagram-accent)" stroke-width="2" fill="none">
    <path d="M190 49 L215 49 M385 49 L410 49 M580 49 L605 49"/>
  </g>

  <path d="M300 78 L300 108" stroke="var(--diagram-line)" stroke-width="1.5" stroke-dasharray="5 5" fill="none"/>
  <rect x="150" y="108" width="300" height="46" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="300" y="128" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">join failed: STOP</text>
  <text x="300" y="145" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">leave ingress open, do not orphan the box</text>

  <rect x="20" y="190" width="720" height="86" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="40" y="214" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">why this cannot lock you out</text>
  <text x="40" y="236" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">the provider console arrives on loopback, and a host firewall always permits loopback,</text>
  <text x="40" y="254" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">so the out of band path survives every rule you add. verify that claim on YOUR provider</text>
  <text x="40" y="270" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">before you trust it, on a throwaway machine.</text>
</svg>
</div>

> [!HOW-IT-WORKS] A pre-authorized key is what removes the human from the loop. An auth key can carry tags and pre-approval, so the node registers with a machine identity and an already approved state instead of waiting in a queue for someone to click approve. That is the difference between a machine that is useful in ninety seconds and one that is useful when you get around to it.

## Build it

1. **Mint a tagged auth key.** Create it in the admin console or through the API as reusable, tagged with the role the machine will have, and pre-approved if your tailnet requires device approval. Tagging matters for a second reason covered in the gotchas: a device that receives a tag has its key expiry disabled by default, so a long lived server does not silently fall off the tailnet in six months.

2. **Put the key somewhere the script can read, and nowhere else.** It goes into the provisioning system as a secret, injected at render time. It never lands in the repository that holds the script. Treat a reusable tagged auth key as a credential that can mint tailnet members, because that is exactly what it is.

3. **Install and join, in the first boot script.**

    ```bash
    curl -fsSL https://tailscale.com/install.sh | sh
    tailscale up \
      --authkey="${TAILSCALE_AUTHKEY:?authkey required}" \
      --hostname="$(hostname -s)" \
      --ssh
    ```

4. **Gate everything that follows on the join actually succeeding.** Do not assume. Ask:

    ```bash
    if ! tailscale status --json | grep -q '"BackendState": *"Running"'; then
      echo "tailscale did not reach Running; leaving ingress open" >&2
      exit 0
    fi
    ```

5. **Close ingress to the tailnet interface only.** Inbound denied by default, outbound untouched, the tailnet interface allowed, and the port Tailscale uses for direct connections allowed so peers can still reach you directly rather than being forced onto a relay.

    ```bash
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow in on tailscale0
    ufw allow 41641/udp
    ufw --force enable
    ```

    Leaving outbound alone is deliberate. This locks the front door. Package installs, container pulls, and outbound API calls keep working.

6. **Make the rules re-apply on every boot with a unit you own.** This step looks redundant. It is not, and the gotchas explain why in detail.

    ```ini
    [Unit]
    Description=Re-assert host firewall rules at boot
    After=network-online.target tailscaled.service

    [Service]
    Type=oneshot
    ExecStart=/usr/local/sbin/vm-firewall
    RemainAfterExit=yes

    [Install]
    WantedBy=multi-user.target
    ```

7. **Make the whole script exactly once.** Many providers re-run the provisioning script on every restart, not just at creation. Guard it:

    ```bash
    [ -e /etc/vm-provisioned ] && exit 0
    # ... everything above ...
    touch /etc/vm-provisioned
    ```

8. **Auto approve the machine's routes if it advertises any**, using autoApprovers in the policy file, so a subnet router or exit node born this way is useful immediately instead of waiting for a human to approve its routes.

## Verify it

Verification is the part people skip, and it is the part that matters, because the most dangerous outcome here is a machine that reports healthy and is not protected.

1. **Prove it joined**, from another tailnet member, not from the machine itself: `tailscale ping <new-host>` and `tailscale status | grep <new-host>`.

2. **Prove the firewall is loaded**, which is not the same as enabled. Read the actual packet filter rules, not the tool's own status summary.

    ```bash
    sudo iptables -S | head
    sudo ufw status verbose
    ```

3. **Reboot the machine and check both again.** This is not optional. See gotcha 1.

4. **Prove the public path is closed** from off the tailnet entirely, ideally from a network that has nothing to do with your setup. A closed port from a machine that is on the tailnet proves nothing.

> [!GOTCHA] A firewall that reports healthy and filters nothing is worse than no firewall, because it ends the investigation. Any check that reads a configuration file, or reads the firewall tool's own opinion of itself, can pass while zero rules are loaded in the kernel. Assert on the loaded rules, after a reboot.

## Gotchas

1. **Enabling a firewall is not the same as it surviving a reboot, and it will lie to you about the difference.** On one hosting platform, enabling the firewall at install time worked perfectly and did not survive a restart: the service enablement was stripped across the reboot, so afterwards the configuration file still declared the firewall enabled while the service manager reported it disabled and the kernel had no rules loaded at all. Every configuration level check passed. The machine was open. The fix is step 6: a unit you create, which does persist, that re-asserts the rules on every boot. The test that catches it is a reboot followed by an assertion on loaded rules, and it belongs in your provisioning test suite as a first class case.

2. **Order matters, and the failure path matters more.** Close ingress only after the tailnet join is confirmed. If the join fails and you have already closed the door, the machine is unreachable by every path you built. Failing open here is the correct choice: a machine that is briefly reachable is recoverable, a machine that is unreachable may not be.

3. **Know your out of band path before you need it.** The reason this is safe on some platforms is that the provider console arrives over loopback, which a host firewall always permits, so it survives any ingress rule you write. That is a property of a specific platform, verified on a throwaway instance, not a law of nature. If your provider's console is a normal inbound SSH connection, these rules will lock you out of it. Test on a machine you are willing to lose.

4. **Provisioning scripts often re-run on restart.** Without an exactly once guard you get user creation, key installs, and firewall resets repeating on every boot, which is at best noisy and at worst destructive.

5. **`tailscale logout` will sever the session you are running it in.** If a provisioning or teardown script logs out, run it detached, or you will kill your own connection partway through and leave the machine half configured.

6. **Watch the size limit on provider hosted scripts.** Some platforms cap the setup script. Strip comments at render time rather than deleting documentation from the source, so the repository stays readable and the deployed artifact stays small.

7. **A tagged machine leaves `autogroup:self`.** If your SSH policy rules are scoped to `autogroup:self`, tagging a machine silently removes SSH access to it, because tagging replaces user identity with tag identity. Pair every tag decision with the policy rule that grants access to that tag, in the same change.

> [!FROM-THE-FIELD] The real prize is not automation, it is the elimination of a state. There is never a moment when a machine exists, is reachable from the internet, and is not yet configured. That window is where a lot of bad things historically happen, and this pattern deletes it rather than shortening it.

## Where to take it next

1. Make the provisioning suite assert the post reboot state, not just the post install state. Any check that cannot survive a restart is not a check.
2. Give different machine classes different tags at birth, then express your entire access policy in terms of those tags rather than individual machines.
3. Have the machine advertise routes or exit node capability at birth and pair it with autoApprovers, so a new site router is useful the moment it exists.
4. Consider ephemeral auth keys for machines that are genuinely disposable, so that the tailnet cleans up after them automatically instead of accumulating dead entries.
