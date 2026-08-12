---
module: 4
slug: identity-and-auth
title: Identity and auth
description: How users, devices, and workloads prove who they are in a tailnet, from SSO delegation through auth keys, tags, OAuth clients, and workload identity federation.
order: 4
words: 5300
sources:
  - id: sso-providers
    url: https://tailscale.com/docs/integrations/identity
    title: Identity providers
    checked: 2026-08-10
  - id: auth-keys
    url: https://tailscale.com/docs/features/access-control/auth-keys
    title: Auth keys
    checked: 2026-08-10
  - id: oauth-clients
    url: https://tailscale.com/docs/features/oauth-clients
    title: OAuth clients
    checked: 2026-08-10
  - id: tags
    url: https://tailscale.com/docs/features/tags
    title: Tags
    checked: 2026-08-10
  - id: key-expiry
    url: https://tailscale.com/docs/features/access-control/key-expiry
    title: Key expiry
    checked: 2026-08-10
  - id: device-approval
    url: https://tailscale.com/docs/features/access-control/device-management/device-approval
    title: Device approval
    checked: 2026-08-10
  - id: user-approval
    url: https://tailscale.com/docs/features/access-control/user-approval
    title: User approval
    checked: 2026-08-10
  - id: acl-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: ACL syntax reference
    checked: 2026-08-10
  - id: wif-docs
    url: https://tailscale.com/docs/features/workload-identity-federation
    title: Workload identity federation
    checked: 2026-08-10
  - id: wif-ga
    url: https://tailscale.com/blog/workload-identity-ga
    title: Workload identity federation GA blog post
    checked: 2026-08-10
---

## The promise

1. You will be able to explain the three distinct identities in a tailnet (user, device, tag), which credential establishes each one, and why a node holds exactly one of user identity or tag identity, never both.
2. You will be able to choose the correct auth key variant (one-off, reusable, ephemeral, pre-approved, tagged) for a given machine and defend the choice in terms of blast radius.
3. You will be able to describe exactly what Tailscale delegates to your identity provider and what it refuses to delegate, and predict what an IdP outage does and does not break.
4. You will be able to reason about node key expiry: what the default is, when to disable it, and what an expired key looks like from both ends of a dead connection.
5. You will be able to explain OAuth clients and workload identity federation as two generations of automation credentials, and say when static secrets can be eliminated entirely.
6. You will be able to trace a device approval or user approval stall to its cause instead of blaming the network.

## Foundation

You already run networks where identity is layered, even if you never used that word. 802.1X port authentication separates "who is this person" (RADIUS lookup against a directory) from "what is this machine" (the supplicant's certificate). A PKI enrollment token is a one-time secret that bootstraps a longer-lived certificate. Device roles in a NAC system ("printer", "camera", "server") change what policy applies regardless of who logged in last.

Tailscale's identity model maps onto all of that almost one to one. The identity provider plays the role of your directory plus RADIUS: it answers "who is this person" and Tailscale believes the answer. The node key (from Module 01, the WireGuard key pair every node generates) plays the role of the device certificate: it answers "which machine is this" and it never leaves the device. Auth keys are enrollment tokens. Tags are device roles, with one sharp twist this module spends a whole section on: in Tailscale, giving a device a role erases the person from it.

What you should carry in from Module 02: the coordination server is the registrar that binds identities to node keys and distributes the resulting network map. Everything in this module is about how that binding gets created, renewed, gated, and destroyed.

## Core content

### The three identities

Every device in a tailnet carries a stack of identity claims:

1. **User identity**: which human owns this node. Established by an interactive SSO login through an identity provider.
2. **Device identity**: which physical or virtual machine this is. Established by the node key pair the device generated locally, which the control plane binds to the login.
3. **Tag identity**: which role this node serves. Established by applying one or more tags, which replaces the user identity entirely.

The analogy: think of a fleet of vehicles. A personal car is registered to a person (user identity), has a unique VIN (device identity), and policy follows the person: your insurance, your parking spot. A company van keeps its VIN but is registered to the company under a fleet class like "delivery" (tag identity). Nobody asks who drove the van yesterday; policy follows the fleet class. And critically, a vehicle is registered one way or the other, never both.

The mechanism: the control plane stores, for each node key, either a user account or a set of tags as the owner. ACL rules and grants (Module 05) resolve against whichever one is present.

The failure mode: assuming a device has both. It never does. The tags KB is blunt: "Applying a tag to a device removes any user-based authentication," and re-authenticating interactively as a user removes all tags. Half the confusing policy bugs in real tailnets come from forgetting this substitution.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Decision tree for which identity and credential a node should get">
  <title>Choosing the right identity and credential</title>
  <rect x="290" y="10" width="180" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="35" text-anchor="middle" fill="var(--diagram-text)" font-size="14">New node: who is it?</text>
  <line x1="330" y1="50" x2="150" y2="100" stroke="var(--diagram-line)"/>
  <line x1="430" y1="50" x2="610" y2="100" stroke="var(--diagram-line)"/>
  <text x="200" y="80" fill="var(--diagram-text)" font-size="12">a human's machine</text>
  <text x="500" y="80" fill="var(--diagram-text)" font-size="12">infrastructure</text>
  <rect x="50" y="100" width="200" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="150" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="13">SSO login (user identity)</text>
  <rect x="510" y="100" width="200" height="40" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="610" y="125" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Tagged (tag identity)</text>
  <line x1="550" y1="140" x2="440" y2="190" stroke="var(--diagram-line)"/>
  <line x1="610" y1="140" x2="610" y2="190" stroke="var(--diagram-line)"/>
  <line x1="670" y1="140" x2="720" y2="190" stroke="var(--diagram-line)"/>
  <rect x="360" y="190" width="160" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="440" y="211" text-anchor="middle" fill="var(--diagram-text)" font-size="12">long-lived server:</text>
  <text x="440" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="12">tagged reusable key</text>
  <rect x="535" y="190" width="150" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="610" y="211" text-anchor="middle" fill="var(--diagram-text)" font-size="12">container / CI job:</text>
  <text x="610" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="12">ephemeral key</text>
  <rect x="700" y="190" width="55" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="727" y="211" text-anchor="middle" fill="var(--diagram-text)" font-size="12">cloud:</text>
  <text x="727" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="12">WIF</text>
  <rect x="50" y="190" width="220" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="160" y="211" text-anchor="middle" fill="var(--diagram-text)" font-size="12">API automation, no login:</text>
  <text x="160" y="228" text-anchor="middle" fill="var(--diagram-text)" font-size="12">OAuth client or WIF</text>
  <line x1="150" y1="140" x2="150" y2="190" stroke="var(--diagram-line)" stroke-dasharray="4 3"/>
  <text x="160" y="168" fill="var(--diagram-text)" font-size="11">needs the API too?</text>
</svg>
</div>

### SSO: renting the front door

The analogy: Tailscale runs a building but outsources the badge office. When you walk up, the guard does not check your ID; the guard sends you across the street to a badge office you already trust (Google, Microsoft, GitHub, Okta), and admits you if you come back with a fresh badge.

The mechanism: Tailscale has no passwords of its own and no email-and-password sign-up path; by design it is not an identity provider. Interactive login is always a browser redirect to an identity provider. Natively supported providers are Apple, Google, GitHub, Microsoft (including Entra ID), Okta, and OneLogin, plus custom OIDC providers for everything else. When the IdP hands the user back, Tailscale learns the user's email address and name, and for some providers a photo URL (it "stores the photo URL but not the photo itself"). With GitHub, it also reads team membership to decide tailnet membership, but "does not use any content in your repositories." That authenticated user is then bound to the node key the device generated, and the device becomes that user's node.

The delegation boundary matters more than the provider list. Passwords: IdP's problem. MFA: IdP's problem, and whatever MFA policy you enforce there automatically gates Tailscale, because Tailscale login is just an IdP login. Session risk policies, hardware keys, conditional access: all IdP-side. What Tailscale keeps for itself is device identity (node keys are generated on the device and never pass through the IdP) and everything downstream of identity: the binding of keys to users, the network map, and policy evaluation.

> [!HOW-IT-WORKS] The IdP authenticates a person; it never sees a key. The node key pair is generated on the device, the private half never leaves, and the control plane binds the public half to the identity the IdP vouched for. Compromising the IdP session gets an attacker the ability to enroll new devices as you; it does not hand them the keys of your existing devices.

The failure mode: an IdP outage. Because authentication is only consulted at login and re-authentication time, an IdP being down does not drop existing tunnels. Nodes with valid node keys keep working; per the key expiry KB, connections only stop when a node's key actually expires. What breaks during an IdP outage is enrollment of new devices and re-authentication of expiring ones. The nasty version of this failure is permanent: if your organization deletes a user in the IdP, or you built the tailnet on a personal account someone loses, the identity anchoring those devices is gone. Choose the IdP for a production tailnet as deliberately as you would choose a DNS registrar.

### Auth keys: enrollment without a browser

Servers do not have browsers, and cloud-init scripts cannot complete an OAuth dance. Auth keys exist so a machine can join the tailnet non-interactively.

The analogy: an auth key is a pre-signed enrollment slip from the admissions office. Whoever presents it gets registered, no questions asked. Everything about auth key hygiene follows from taking that analogy seriously: how many uses the slip allows, whether it expires, and what gets stamped on the student it admits.

The mechanism: a user with the Owner, Admin, IT admin, or Network admin role generates keys from the Keys page of the admin console (or via the API). Keys are case-sensitive strings prefixed `tskey-` and are presented at join time: `tailscale up --auth-key=tskey-...`. Every key has an expiry between 1 and 90 days; if you do not pick one, you get the maximum of 90. That expiry is for the key as an enrollment credential only. The auth keys KB states that if an auth key expires, any device authorized by it remains authorized until its node key expires; a device's lifetime is governed by its own node key expiry (next section), not by the auth key that admitted it.

The variants, and when each is right:

| Variant | Property | Right for |
|---|---|---|
| One-off | Valid for exactly one device, then self-revokes | A single cloud server, anything provisioned once |
| Reusable | Enrolls unlimited devices until it expires or is revoked | Fleet provisioning through config management, on-prem appliances |
| Ephemeral | Device is automatically removed after it goes offline | Containers, CI runners, serverless functions, anything disposable |
| Pre-approved | Device skips the device-approval queue | Automated provisioning in tailnets that gate humans with device approval |
| Tagged | Device joins with the key's tags already applied, so it has tag identity from the moment it joins | Effectively all infrastructure; policy applies the instant the node joins |

These are flags, not exclusive types: a typical production server key is reusable, tagged, and pre-approved; a typical CI key is reusable, tagged, ephemeral. (You will also see "pre-authorized" used informally for pre-approved keys; the admin console and current KB say pre-approved.)

The failure modes: two classics. First, the leaked reusable key. The KB warns "Be very careful with reusable keys! These can be very dangerous if stolen," because a stolen reusable tagged key lets an attacker enroll a device that instantly inherits whatever access that tag grants under your policy. Treat reusable keys like the credentials they are: secret stores, not wikis, not container images. Second, the revocation misunderstanding: "Revoking a key does not deauthorize nodes using the key." Revocation only stops future enrollments. If a key leaked, you revoke it and then audit and expel every node it admitted, individually, from the Machines page.

> [!GOTCHA] Auth key expiry and node key expiry are different clocks and people conflate them constantly. The auth key (max 90 days) is the enrollment slip. The node key (default 180 days) is the device's ongoing credential. A device enrolled on day 1 with a 7-day auth key is still healthy on day 100; a device whose node key expires goes dark even if you just minted the auth key yesterday.

### OAuth clients: the badge printer

If auth keys are enrollment slips, an OAuth client is the badge printer itself. You stop distributing slips and instead give automation the ability to print its own, on demand, with constraints baked in.

The mechanism: OAuth clients use the standard OAuth 2.0 client credentials flow against the Tailscale API. A client is an ID plus a secret; presenting them yields an access token that lives exactly one hour ("This time cannot be modified"). The client itself does not expire, which is precisely why it exists: the KB's answer to "how do I get a long-lived auth key" is that you cannot, "because they expire after 90 days," and the supported pattern is an OAuth client with the `auth_keys` scope that mints fresh short-lived keys whenever provisioning runs. Scopes constrain what the token can do (`dns:read`, `devices:core`, `auth_keys`, and so on), and an `auth_keys`-scoped client must be created with one or more tags: every auth key it mints carries those tags, so a compromised client can never mint itself broader identity than it was born with. An OAuth client secret can also be used directly with `tailscale up` in place of an auth key.

The failure mode: treating the client secret as less sensitive than a key. It is more sensitive: it is a non-expiring credential that manufactures credentials. Scope it minimally, tag it narrowly, store it in a secret manager, and rotate it if it ever touches a log line.

### Tags: the identity transplant

This is the concept most worth over-learning, because it changes policy semantics, key expiry, and SSH behavior all at once.

The analogy: converting your personal car into a company van. The moment the fleet registration is stamped, your name comes off the title. Not "your name plus a fleet sticker." Off.

The mechanism: tags are declared in the `tagOwners` section of the tailnet policy file, which "defines the tags assignable to devices and the list of users allowed to assign each tag" (Owners, Admins, and Network admins can apply any tag, even ones they do not own). You apply tags from the admin console Machines page, from the CLI with `tailscale login --advertise-tags=tag:name` (the device must be allowed to claim that tag), from the API, or by enrolling with a tagged auth key. Once tagged, the node's owner in the control plane is the tag set, full stop. ACLs written as `src: ["tag:ci"]` or `dst: ["tag:prod:443"]` match it; rules written against the former user do not.

<div class="diagram-wrap">
<svg viewBox="0 0 760 260" role="img" aria-label="State flow showing how a node moves between user identity and tag identity while the node key persists">
  <title>The identity transplant: user identity versus tag identity</title>
  <rect x="60" y="70" width="240" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="180" y="98" text-anchor="middle" fill="var(--diagram-text)" font-size="13">user identity</text>
  <text x="180" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="12">owner: alice@example.com</text>
  <rect x="460" y="70" width="240" height="70" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)"/>
  <text x="580" y="98" text-anchor="middle" fill="var(--diagram-text)" font-size="13">tag identity</text>
  <text x="580" y="120" text-anchor="middle" fill="var(--diagram-text)" font-size="12">owner: tag:prod</text>
  <line x1="300" y1="88" x2="450" y2="88" stroke="var(--diagram-accent)"/>
  <polygon points="450,83 460,88 450,93" fill="var(--diagram-accent)"/>
  <text x="378" y="78" text-anchor="middle" fill="var(--diagram-text)" font-size="12">apply tag</text>
  <text x="378" y="48" text-anchor="middle" fill="var(--diagram-text)" font-size="11">first time: key expiry disabled,</text>
  <text x="378" y="62" text-anchor="middle" fill="var(--diagram-text)" font-size="11">autogroup:self stops matching</text>
  <line x1="460" y1="122" x2="310" y2="122" stroke="var(--diagram-accent)"/>
  <polygon points="310,117 300,122 310,127" fill="var(--diagram-accent)"/>
  <text x="380" y="140" text-anchor="middle" fill="var(--diagram-text)" font-size="12">interactive user re-login</text>
  <text x="380" y="156" text-anchor="middle" fill="var(--diagram-text)" font-size="11">strips all tags, expiry clock resumes</text>
  <rect x="230" y="190" width="300" height="44" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="217" text-anchor="middle" fill="var(--diagram-text)" font-size="12">node key: same key pair in both states</text>
  <line x1="180" y1="140" x2="260" y2="190" stroke="var(--diagram-line)" stroke-dasharray="4 3"/>
  <line x1="580" y1="140" x2="500" y2="190" stroke="var(--diagram-line)" stroke-dasharray="4 3"/>
</svg>
</div>

Three concrete consequences, all documented and all regularly discovered the hard way:

1. **autogroup:self stops matching.** `autogroup:self` is the ACL selector that grants access to a user's own devices from their own devices, and the ACL syntax reference states flatly that it "only applies to user-owned devices. It does not apply to tagged devices." The moment you tag a machine, every convenience rule built on autogroup:self silently excludes it. This is the number one "I tagged my home server and now my laptop can't reach it" report.
2. **Key expiry is disabled on first tagging.** Per the key expiry KB, when you apply a tag to a device for the first time and authenticate it, "the tagged device will have key expiry disabled by default." Sensible for servers, but it means tagging quietly converts a 180-day credential into a permanent one. Know that you did it.
3. **Tailscale SSH boundaries shift.** Per the tags KB, devices with a tag-based identity can only SSH into other tagged devices; they cannot SSH into devices with a user-based identity. This is one reason the KB says to use tags only for non-human machines, never end-user laptops and phones.

And one asymmetry: you cannot strip tags with the `--advertise-tags` flag on a device that joined with an auth key (the KB's answer there is to mint a new key with the new tag set), and removing all tags requires re-authenticating the device interactively as a user, which strips the tags and restores user identity. Identity is transplanted whole in both directions.

> [!GOTCHA] Tag your servers, never your laptop. A tagged personal machine falls out of autogroup:self rules, loses its user attribution in the admin console, and cannot Tailscale-SSH to user-owned devices. If you want role-ish policy for humans, that is what groups in the policy file are for (Module 05), not tags.

### Node key expiry: the heartbeat of trust

The analogy: node keys are visitor badges with a printed expiration date. The building does not chase you down when the date passes; the doors just stop opening.

The mechanism: every node's key has an expiry, 180 days by default, configurable tailnet-wide from 1 to 180 days on all plans (checked 2026-08-10). Renewing means re-authenticating: interactively on client devices, or `tailscale up --force-reauth` from the CLI. Expiry can be disabled per device from the Machines page, the standard move for "trusted servers, subnet routers, or remote IoT devices that are hard to reach," and, as covered above, it is disabled automatically when a device is first tagged. For a device that expired somewhere awkward, an admin can temporarily extend the key's lifetime by 30 minutes from the admin console, enough for the owner to re-authenticate.

The failure mode is famous enough to have a shape: everything worked for six months, then one Tuesday a peer is unreachable and nothing else changed. That is the 180-day default biting. When a node key expires, "connections to/from the given endpoint will stop working," and from the far side it just looks like the peer went offline. The really sharp edge is `--force-reauth` itself: it tears down connectivity while it runs, so issuing it over an SSH session that rides the tailnet can saw off the branch you are sitting on. The KB warns against running it remotely over SSH or RDP without an alternate way back in.

> [!FROM-THE-FIELD] Do an expiry audit before expiry does it for you. The Machines page shows each node's expiry status; anything that is infrastructure should be tagged (expiry off by design) or have expiry explicitly disabled, and anything human should be left on the clock. The worst place to learn about the 180-day default is a subnet router at a site with no one technical on premises.

### Approval gates: two doors, not one

Enrollment can be gated twice, and the two gates are independent features with different scopes.

**Device approval** gates machines. When enabled (available on all plans, by an Owner, Admin, or IT admin), every new device lands in a pending state where it "cannot send or receive traffic on your Tailscale network until it is approved," and the same admin roles approve it from the Machines page. Pre-approved auth keys bypass the queue for automated provisioning, and for scale you can automate the gate itself: subscribe a webhook to `nodeNeedsApproval` events, check the device against your own inventory or MDM, and approve via the device authorization API.

**User approval** gates people. When enabled (available on all plans), a newly joining user "can connect their device to the Tailscale coordination server, but cannot connect to other devices in the tailnet," and shows a "User needs approval" badge until an Owner, Admin, or IT admin approves them. Version-qualify this one: tailnets created on or after May 22, 2025 have user approval enabled by default; older tailnets had it off (checked 2026-08-10). Also note the interlock: user approval and user-and-group provisioning (SCIM) are mutually exclusive; a tailnet can enable one or the other, not both, because with SCIM your IdP is already the authority on who belongs.

The failure mode for both gates is the same symptom: a node that authenticates successfully and then cannot reach anything. The logs show a healthy control connection, `tailscale status` runs fine, and traffic goes nowhere. Before debugging NAT traversal (Module 03) or ACLs (Module 05), check for a pending approval. It is a two-second check that saves an hour.

### Workload identity federation: deleting the secret

Everything above still involves a secret you create, store, and could leak: an auth key, an OAuth client secret. Workload identity federation (WIF) is the mechanism for cloud workloads to authenticate with no stored Tailscale secret at all. After a beta period, it became generally available in February 2026 (checked 2026-08-10).

The analogy: instead of Tailscale issuing your contractor a keycard to carry around (and lose), Tailscale signs a treaty with the contractor's government: "I will honor passports you issue, but only for citizens matching this exact description." The workload shows up with its cloud-issued passport and gets a short-lived visa on the spot. Nothing to store, nothing to rotate, nothing to leak.

The mechanism, in order:

1. **Trust setup (once).** A tailnet admin creates a federated identity: they specify the OIDC issuer to trust and define claim-matching rules that map specific workloads onto the tags and API scopes (such as `auth_keys` or `devices:core`) they should receive. Subject claim rules pin exactly which workload qualifies and support wildcards (AWS matches on role identity, GitHub Actions on the repository path); optional custom claim rules narrow access further. Tokens that fail to match these rules are rejected automatically. This is configurable in the admin console, via the Terraform provider, or via the API.
2. **Token issuance (per run).** The workload asks its own platform for an OIDC identity token: a signed JSON Web Token (JWT) that vouches for the workload's identity, specifies exactly which workload it represents, and declares the intended audience.
3. **Exchange.** The workload posts that JWT to `https://api.tailscale.com/api/v2/oauth/token-exchange`. Tailscale validates the token's signature against the issuer's published keys, checks the standard claims (issuer, audience, expiry), applies the claim-matching rules, and returns a short-lived API token carrying the configured scopes.
4. **Use.** That token drives the Tailscale API, including minting auth keys if the credential has the `auth_keys` scope; any tags the workload advertises at join time must be tags the federated identity was configured with.

Supported issuers at GA: AWS, Google Cloud, Azure, GitHub Actions, and custom OIDC issuers. The GA release also brought Terraform provider and tsnet library support, with Kubernetes operator support in beta. Client-side, version-qualify the flags: Tailscale v1.90.1 or later supports `--client-id` and `--id-token` for workload identity, and v1.94.0 or later adds `--audience` with automatic token discovery, where the client detects supported cloud and CI environments and retrieves the platform's identity token itself. On v1.94.0 or later, `tailscale up --client-id=... --audience=...` joins the tailnet with no long-lived credentials or secrets stored on disk or injected at runtime.

The failure mode: claim mismatch. Federation trades secret management for configuration precision. A repository renamed, a role changed, a wildcard one character off, or a wrong audience value, and the exchange endpoint rejects the JWT. The symptom is a workload that authenticated fine to its own cloud but gets an error from the token exchange; the fix is always in the claim-matching rules or the token request, never in the workload's "credentials," because there are none.

> [!ON-THE-WIRE] The WIF exchange is ordinary HTTPS to `api.tailscale.com`, not tunnel traffic. A CI job doing keyless join makes exactly two identity round trips: one to its own platform's metadata or OIDC endpoint for the JWT, one to Tailscale's token-exchange endpoint. Only after both succeed does anything from Modules 01 through 03 (keys, control plane, NAT traversal) begin.

<div class="diagram-wrap">
<svg viewBox="0 0 760 340" role="img" aria-label="Sequence of workload identity federation token exchange">
  <title>Workload identity federation: token exchange sequence</title>
  <line x1="120" y1="60" x2="120" y2="310" stroke="var(--diagram-line)"/>
  <line x1="380" y1="60" x2="380" y2="310" stroke="var(--diagram-line)"/>
  <line x1="640" y1="60" x2="640" y2="310" stroke="var(--diagram-line)"/>
  <rect x="50" y="20" width="140" height="34" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="120" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="13">workload (cloud-1)</text>
  <rect x="310" y="20" width="140" height="34" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="380" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="13">cloud OIDC issuer</text>
  <rect x="570" y="20" width="140" height="34" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)"/>
  <text x="640" y="42" text-anchor="middle" fill="var(--diagram-text)" font-size="13">Tailscale API</text>
  <line x1="120" y1="90" x2="380" y2="90" stroke="var(--diagram-accent)"/>
  <text x="250" y="82" text-anchor="middle" fill="var(--diagram-text)" font-size="12">request identity token</text>
  <line x1="380" y1="125" x2="120" y2="125" stroke="var(--diagram-accent)"/>
  <text x="250" y="117" text-anchor="middle" fill="var(--diagram-text)" font-size="12">signed JWT (sub, aud, exp)</text>
  <line x1="120" y1="170" x2="640" y2="170" stroke="var(--diagram-accent)"/>
  <text x="380" y="162" text-anchor="middle" fill="var(--diagram-text)" font-size="12">POST /oauth/token-exchange with JWT</text>
  <line x1="640" y1="205" x2="380" y2="205" stroke="var(--diagram-line)" stroke-dasharray="4 3"/>
  <text x="512" y="197" text-anchor="middle" fill="var(--diagram-text)" font-size="12">fetch issuer public keys</text>
  <line x1="640" y1="250" x2="120" y2="250" stroke="var(--diagram-accent)"/>
  <text x="380" y="242" text-anchor="middle" fill="var(--diagram-text)" font-size="12">short-lived API token (scoped, tagged)</text>
  <line x1="120" y1="290" x2="640" y2="290" stroke="var(--diagram-line)"/>
  <text x="380" y="282" text-anchor="middle" fill="var(--diagram-text)" font-size="12">mint auth key / join tailnet, no stored secret</text>
</svg>
</div>

## On the wire

Identity work is control plane work: HTTPS to the coordination infrastructure, never inside the WireGuard tunnel. Here is what the common flows look like from a shell.

Enrolling a server with a tagged, reusable, pre-approved key:

```
$ sudo tailscale up --auth-key=tskey-auth-kx7EXAMPLECNTRL-aBcDeFgHiJkLmNoPqRsTuVwXyZ012345
$ tailscale status
100.64.0.12   node-a       tag:prod     linux   -
100.64.0.7    node-b       alice@example.com  linux   active; direct 203.0.113.7:41641
100.64.0.19   lab-vm-1     tag:ci       linux   offline
```

Note the second column of ownership: node-a shows a tag where node-b shows a user. That column is the user-versus-tag identity split made visible.

Interactive login, by contrast, prints a URL because the IdP needs a browser:

```
$ sudo tailscale up
To authenticate, visit:
    https://login.tailscale.com/a/1a2b3c4d5e6f
```

An expired node key looks like absence, not error. On the expired node, `tailscale status` reports the machine as logged out or needing re-authentication and peers vanish; on every other node, the peer simply shows `offline`. Recovery is re-authentication:

```
$ sudo tailscale up --force-reauth
Warning: this will disconnect you from the tailnet while re-authenticating.
To authenticate, visit:
    https://login.tailscale.com/a/9f8e7d6c5b4a
```

(Run that from a console or out-of-band session, never from an SSH session carried by the tailnet itself.)

Automation flows are plain API traffic. An OAuth client trades its secret for a one-hour token, then mints a key:

```
$ curl -s -d "client_id=${TS_CLIENT_ID}" -d "client_secret=${TS_CLIENT_SECRET}" \
    https://api.tailscale.com/api/v2/oauth/token
{"access_token":"tskey-api-...","token_type":"Bearer","expires_in":3600}
```

A WIF-enabled workload on v1.94.0 or later skips even that, because the daemon fetches the platform token itself:

```
$ sudo tailscale up --client-id=twc-example123 \
    --audience=api.tailscale.com/example \
    --advertise-tags=tag:ci
```

In logs, approval gates are the quiet failure: the device authenticates, the control connection is healthy, and traffic goes nowhere until someone clicks approve. The admin console shows the machine with a pending badge; the packet capture shows nothing at all, because unapproved devices are simply absent from peers' network maps (Module 02).

## Failure modes

1. **Node key expired on schedule.** A device that worked for months goes unreachable; peers show it `offline`; its own client asks for re-authentication. Cause: the 180-day default nobody adjusted. Fix: re-authenticate; for infrastructure, disable expiry or tag the node.
2. **Auth key expired, mistaken for an outage.** New provisioning suddenly fails while every existing node is fine. Cause: the enrollment key hit its 90-day (or shorter) limit. Fix: mint a new key, or move provisioning to an OAuth client or WIF so keys are minted fresh per run.
3. **Revoked key, nodes still present.** You revoked a leaked key and assumed cleanup was done, but "Revoking a key does not deauthorize nodes using the key." Symptom: unfamiliar nodes still active. Fix: audit and remove every node the key enrolled.
4. **Leaked reusable tagged key.** An attacker enrolls a node that immediately holds your tag's access. Symptom: an unexpected machine with a legitimate-looking tag. Fix: revoke, expel, rotate, and move the secret into a secret store; consider ephemeral or WIF so there is less to steal.
5. **Tagged device fell out of autogroup:self.** After tagging a machine, its owner can no longer reach it under rules that grant users their own devices. Cause: tags replaced user identity, and autogroup:self "does not apply to tagged devices." Fix: write an explicit rule granting the user access to the tag (Module 05).
6. **Tagged laptop cannot SSH to user devices.** Someone tagged an end-user machine; Tailscale SSH to user-identity nodes now fails. Fix: re-authenticate interactively as the user, which strips tags; keep tags off human devices.
7. **Device approval limbo.** Node authenticates, control connection healthy, zero connectivity. Symptom: pending badge in the console. Fix: approve it, use pre-approved keys for automation, or wire the `nodeNeedsApproval` webhook to your inventory.
8. **User approval limbo.** Same symptom as above but the badge is on the person: "User needs approval." Version note: default-on for tailnets created on or after May 22, 2025, so brand-new tailnets hit this on their second user and mistake it for a broken install.
9. **Ephemeral node vanished with state.** A container enrolled with an ephemeral key went offline and was automatically removed, taking its IP and machine entry with it. That is the designed behavior; do not use ephemeral keys for anything whose identity should survive a restart.
10. **WIF claim mismatch.** The workload gets its cloud JWT fine but Tailscale's token exchange rejects it. Cause: subject or custom claim rules no longer match (renamed repo, changed role, wrong audience). Fix: compare the JWT's actual claims against the federated identity's matching rules; nothing on the workload itself needs rotating.
11. **Self-inflicted lockout via force-reauth.** An operator ran `tailscale up --force-reauth` over Tailscale SSH; the tunnel dropped mid-command and the pending login URL is now unreachable. Fix: out-of-band console access; prevention: the KB's own warning, plus the 30-minute admin-side expiry extension when you need breathing room.

## Check yourself

**1. A subnet router at a branch office dies exactly 180 days after install. The site has no technical staff. Walk through what happened, the immediate remediation, and the two designs that would have prevented it.**

Answer: The node key expired. The router was enrolled with user identity (probably an interactive login during setup) and nobody disabled key expiry, so the tailnet default of 180 days applied. On expiry, the control plane stops honoring the key, peers drop the node from their network maps, and every connection through that subnet router dies at once, which looks like a site outage rather than a credential event. Immediate remediation: an admin can temporarily extend the key's lifetime by 30 minutes from the admin console, then have anyone on site follow a re-authentication link, or you use whatever out-of-band access exists (console, LTE gateway). Prevention one: disable key expiry for that machine from the Machines page, the documented practice for subnet routers and hard-to-reach devices. Prevention two, the better design: enroll the router with a tagged auth key so it has tag identity from the start; first-time tagging disables key expiry by default, and policy then targets the tag rather than whoever set the box up.

**2. Your CI pipeline currently uses a reusable, ephemeral, tagged auth key stored as a repository secret, and it expires every 90 days, causing a quarterly outage ritual. Describe the two-step and the one-step modernization, and what each eliminates.**

Answer: The two-step modernization is an OAuth client with the `auth_keys` scope, created with the CI tag. The pipeline exchanges the client ID and secret for a one-hour API token, mints a fresh short-lived ephemeral auth key per run, and joins with it. This eliminates the 90-day ritual entirely, because OAuth clients do not expire, and it narrows blast radius, because each minted key can be single-purpose and short-lived and can only ever carry the client's tags. It still leaves one stored secret: the client secret itself. The one-step modernization is workload identity federation, GA since February 2026: configure a federated identity trusting your CI platform's OIDC issuer (for GitHub Actions, matched on the repository path in the subject claim) with the `auth_keys` scope and the CI tag. The job requests a platform-signed JWT at runtime, posts it to Tailscale's token-exchange endpoint, receives a short-lived scoped API token, and proceeds as before; on Tailscale v1.94.0 or later, `tailscale up --client-id --audience` does the whole dance itself. This eliminates the stored secret entirely. The residual risk moves from secret leakage to claim configuration, so a rename of the repository becomes your new failure mode to watch.

**3. Alice tags her home server `tag:home` so she can write "server-ish" ACLs for it. Her laptop, which reached the server yesterday through a rule granting users access to their own devices via autogroup:self, can no longer connect. The server also shows "Expiry disabled" in the console. Explain both observations and what Alice should have done.**

Answer: Both observations are direct consequences of the identity transplant. Applying a tag removes user-based authentication: the server's owner is now `tag:home`, not Alice, and autogroup:self, which "only applies to user-owned devices" and "does not apply to tagged devices," no longer matches it. Yesterday's rule granting Alice's devices access to Alice's devices now covers her laptop and phone but excludes the server, so the connection fails at policy evaluation, not at the network layer. The expiry change is the documented side effect of first-time tagging: tagged devices get key expiry disabled by default, on the theory that infrastructure should not go dark on a timer. What Alice should have done depends on her actual goal. If she wanted server-shaped policy, tagging was right, and the missing piece is an explicit ACL or grant giving `alice@...` access to `tag:home` (Module 05); autogroup:self was never going to cover a tagged node. If she wanted to keep the "my own devices" convenience, she should not have tagged it at all. Reversing the mistake requires re-authenticating the server interactively as Alice, since removing all tags requires an interactive user re-login, and that re-login strips the tags and restores user identity, putting the expiry clock back on.

## What you now have

1. A three-identity model: user (from SSO), device (node key that never leaves the machine), tag (role that replaces the user), and the rule that user and tag identity never coexist.
2. The delegation boundary: passwords and MFA belong to the IdP; key binding, network maps, and policy belong to Tailscale; an IdP outage stalls logins, not tunnels.
3. A decision procedure for auth key flags (one-off, reusable, ephemeral, pre-approved, tagged) driven by blast radius, plus the two rules people forget: revocation does not expel nodes, and auth key expiry is not node key expiry.
4. The automation ladder: static keys, then non-expiring OAuth clients that mint short-lived keys, then workload identity federation with no stored secret at all (GA February 2026).
5. The tag consequences chain: tagging disables expiry on first application, removes the node from autogroup:self, and shifts SSH boundaries.
6. The habit of checking approval gates (device and user) before debugging connectivity for a freshly enrolled node.

## Cross references

- Module 01 (WireGuard foundations) defines the node key pair whose binding, expiry, and rotation this module governs.
- Module 02 (The control plane) is where identity claims become network maps; approval gates work by withholding a node from peers' maps.
- Module 03 (NAT traversal, STUN, DERP, and Peer Relays) is what an enrolled, approved, unexpired node does next; rule out identity failures before debugging path failures.
- Module 05 (Policy: ACLs and grants) consumes every identity this module produces: users, groups, tags, autogroups, and the tagOwners section that authorizes tagging.
- Module 08 (Exposing services) leans on tag identity for almost every service node pattern.
- Module 10 (Enterprise operations) extends this module with SCIM provisioning (which is mutually exclusive with user approval), audit logging, and IdP lifecycle management.
- Module 11 (Troubleshooting and observability) turns this module's failure catalog into a diagnostic sequence: identity first, policy second, path third.
