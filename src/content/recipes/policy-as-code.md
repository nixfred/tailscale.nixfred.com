---
slug: policy-as-code
title: Put your access policy in git and let tests block the bad merge
description: Move the tailnet policy file out of the admin console into a git repository where every change arrives as a reviewable diff and an automated check refuses to ship a policy that would remove access to something you cannot afford to lose.
level: advanced
payoff: A policy change that would lock you out of your own network fails a check instead of taking effect.
order: 5
words: 1980
sources:
  - id: docs-policy-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Syntax reference for the tailnet policy file
    checked: 2026-08-11
  - id: kb-acl-syntax
    url: https://tailscale.com/docs/reference/syntax/policy-file
    title: Tailnet policy file syntax
    checked: 2026-08-11
  - id: kb-gitops
    url: https://tailscale.com/docs/gitops
    title: GitOps for Tailscale
    checked: 2026-08-11
  - id: kb-gitops-github
    url: https://tailscale.com/docs/integrations/github/gitops
    title: GitOps for Tailscale with GitHub Actions
    checked: 2026-08-11
  - id: gh-gitops-action
    url: https://github.com/tailscale/gitops-acl-action
    title: tailscale/gitops-acl-action
    checked: 2026-08-11
  - id: kb-edit-policies
    url: https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies
    title: Edit access control policies in your tailnet policy file
    checked: 2026-08-11
  - id: api-tailnet
    url: https://github.com/tailscale/tailscale/blob/v1.74.0/publicapi/tailnet.md
    title: Tailscale API, tailnet endpoints
    checked: 2026-08-11
  - id: kb-oauth
    url: https://tailscale.com/docs/features/oauth-clients
    title: OAuth clients
    checked: 2026-08-11
---

## What you get

The tailnet policy file living in a git repository, changing only through pull requests, with an automated check that reads every proposed version, validates it, and runs your access assertions against it before anything reaches the tailnet. Reviewers read a diff with reasons attached instead of squinting at a text box. A change that would silently remove access to something important turns the check red and never merges.

The reason to do this is not tidiness. The policy file is the one piece of configuration in your network where a single careless edit can remove your own ability to undo the edit. Delete the grant that lets your operators reach the management hosts, and the path you would use to restore the grant is the path you just deleted. Every other misconfiguration in this guide is recoverable by walking over to a machine. This one is recoverable by opening a support ticket.

Tests in the policy file are the specific answer to that specific failure. They are assertions that run every time the policy changes, and a failed assertion causes Tailscale to reject the new policy file with an error. That is the whole idea: you cannot delete the door you came in through, because a test is standing in front of it.

## How it works

Three mechanisms stack, and each one is doing a distinct job.

The **format** is HuJSON, human JSON, which permits comments and trailing commas. That is not cosmetic. Comments let a rule carry the reason it exists on the line directly above it, which is the single highest value thing a reviewer can be given. Trailing commas mean adding an entry to a list produces a one line diff instead of a two line diff that also touches the previous line to add a comma. Review quality is a function of diff noise, and HuJSON removes a whole category of it.

The **assertions** are the `tests` and `sshTests` sections inside the policy file itself. They are not a separate test suite in a separate language. They travel with the thing they describe, in the same file, in the same commit, so the rule and the proof of the rule can never drift apart.

The **pipeline** is the official GitOps action, `tailscale/gitops-acl-action`. On a pull request it runs with `action: test`, which sends the proposed policy file to Tailscale to determine whether the policy is valid and whether all tests pass. On a push to the main branch it runs with `action: apply`, which validates and tests again, and only then updates the tailnet.

<div class="diagram-wrap">
<svg viewBox="0 0 760 300" role="img" aria-label="Policy as code pipeline: a branch edits policy.hujson, a pull request triggers the test action, Tailscale validates and runs the assertions, a failure blocks the merge and leaves the tailnet unchanged, a pass allows the merge which triggers the apply action">
  <title>Where the policy change is stopped, and by whom</title>
  <rect x="20" y="24" width="165" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="102" y="49" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">policy.hujson</text>
  <text x="102" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">on a branch</text>

  <rect x="205" y="24" width="165" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="287" y="49" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">pull request</text>
  <text x="287" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">human review</text>

  <rect x="390" y="24" width="165" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="472" y="49" text-anchor="middle" fill="var(--diagram-text)" font-size="13" font-family="var(--font-mono)">action: test</text>
  <text x="472" y="68" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">uploads the file</text>

  <rect x="575" y="24" width="165" height="58" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2.5"/>
  <text x="657" y="49" text-anchor="middle" fill="var(--diagram-accent)" font-size="13" font-family="var(--font-mono)">Tailscale runs</text>
  <text x="657" y="68" text-anchor="middle" fill="var(--diagram-accent)" font-size="11" font-family="var(--font-mono)">the assertions</text>

  <g stroke="var(--diagram-accent)" stroke-width="2" fill="none">
    <path d="M185 53 L205 53 M370 53 L390 53 M555 53 L575 53"/>
  </g>

  <path d="M657 82 L657 112 L250 112 L250 142" stroke="var(--diagram-line)" stroke-width="1.5" fill="none"/>
  <path d="M657 112 L570 112 L570 142" stroke="var(--diagram-accent)" stroke-width="2" fill="none"/>

  <rect x="110" y="142" width="280" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="250" y="164" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">an assertion failed</text>
  <text x="250" y="182" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">no merge, tailnet unchanged</text>

  <rect x="430" y="142" width="280" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-accent)" stroke-width="2"/>
  <text x="570" y="164" text-anchor="middle" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">all assertions passed</text>
  <text x="570" y="182" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">merge to main</text>

  <path d="M570 194 L570 222" stroke="var(--diagram-accent)" stroke-width="2" fill="none"/>
  <rect x="430" y="222" width="280" height="52" rx="8" fill="var(--diagram-bg)" stroke="var(--diagram-line)" stroke-width="1.5"/>
  <text x="570" y="244" text-anchor="middle" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">action: apply</text>
  <text x="570" y="262" text-anchor="middle" fill="var(--diagram-text)" font-size="11" font-family="var(--font-mono)">validates again, then ships</text>

  <text x="40" y="232" fill="var(--diagram-accent)" font-size="12" font-family="var(--font-mono)">the gate is on Tailscale's side,</text>
  <text x="40" y="250" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">not in your runner. the runner only</text>
  <text x="40" y="268" fill="var(--diagram-text)" font-size="12" font-family="var(--font-mono)">carries the file and reports the verdict.</text>
</svg>
</div>

> [!HOW-IT-WORKS] Your continuous integration runner does not evaluate the policy. It uploads the file and reports back what Tailscale says. That distinction has a consequence people find surprising the first time: a test can start failing on a pull request that did not touch the policy at all, because the assertion is evaluated against live identity state. Remove someone from a group in your identity provider and an assertion that named that group can go red on the next unrelated change. That is the system working. Access is a property of the policy and the directory together, and only one of those two lives in your repository.

## Build it

1. **Move the current policy into a repository, unchanged.** Copy the contents of the Access controls page in the admin console into a file named `policy.hujson` at the repository root, commit it, and change nothing else in the first commit. That commit is your baseline. If the pipeline later disagrees with the tailnet, you want the disagreement to be about a change you made, not about a transcription error.

2. **Mint the credential the pipeline will use.** Create an OAuth client and give it the `policy_file` scope, which permits reading, validating, and modifying the policy file. If you want a credential that can only run the pull request check and can never ship, use `policy_file:read`, which permits reading and validating. OAuth access tokens are issued from the client ID and secret and expire after one hour, so the pipeline mints a fresh one on every run and there is nothing long lived sitting in a runner.

3. **Store the secrets under the names the action expects:** `TS_TAILNET` for the tailnet name, plus `TS_OAUTH_ID` and `TS_OAUTH_SECRET` for the client. Keep them repository secrets. A credential with `policy_file` scope can rewrite who reaches what in your entire network.

4. **Add the workflow.** Two steps, one guarded to pull requests and one guarded to pushes.

    ```yaml
    name: Sync Tailscale ACLs

    on:
      push:
        branches: [ "main" ]
      pull_request:
        branches: [ "main" ]

    jobs:
      acls:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v6

          - name: Deploy ACL
            if: github.event_name == 'push'
            id: deploy-acl
            uses: tailscale/gitops-acl-action@v1
            with:
              oauth-client-id: ${{ secrets.TS_OAUTH_ID }}
              oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
              tailnet: ${{ secrets.TS_TAILNET }}
              action: apply

          - name: Test ACL
            if: github.event_name == 'pull_request'
            id: test-acl
            uses: tailscale/gitops-acl-action@v1
            with:
              oauth-client-id: ${{ secrets.TS_OAUTH_ID }}
              oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
              tailnet: ${{ secrets.TS_TAILNET }}
              action: test
    ```

    The action reads `policy.hujson` from the repository root by default. If you keep the file somewhere else, pass the `policy-file` input.

5. **Write the assertions that name what you cannot lose.** A test runs from the perspective of a device authenticated as the given identity. Destinations are written as `host:port` with a single numeric port. `proto` is optional and, when omitted, the check covers TCP or UDP access.

    ```json
    "tests": [
      {
        "src": "group:operators",
        "proto": "tcp",
        "accept": ["lab-vm-1:22", "cloud-1:22"],
        "deny":   ["node-b:5432"],
      },
    ],
    ```

6. **Write the lockout assertion first and treat it as untouchable.** This is the whole point of the exercise. Name the identity that repairs the network and the hosts it repairs the network from, and assert that path in both directions of the argument: the repair path is accepted, and the paths that must never open are denied. Put a HuJSON comment above it saying, in words, that removing this test is itself the outage.

    ```json
    // Removing this test is the incident. The operators group must keep
    // a path to the management hosts, because that path is how any bad
    // policy merge gets reverted.
    {
      "src": "group:operators",
      "accept": ["lab-vm-1:22"],
    },
    ```

7. **Cover SSH separately, because ACL tests do not cover it.** `sshTests` asserts on the SSH user that an identity may become, with `accept` for users allowed outright, `check` for users that require a further authentication check, and `deny` for users never permitted.

    ```json
    "sshTests": [
      {
        "src": "group:operators",
        "dst": ["lab-vm-1"],
        "accept": ["ops"],
        "check":  ["admin"],
        "deny":   ["root"],
      },
    ],
    ```

8. **Make the check mandatory in the forge, not merely present.** Require the test check to pass and require at least one review before merge. Without branch protection the action is a suggestion. With it, the action is a gate.

9. **Give reviewers a local dry run.** The API validates a proposed policy without changing anything, at `POST /api/v2/tailnet/{tailnet}/acl/validate`. Send a policy object and it validates the syntax and runs the tests included in it, or send an array of test objects and it runs those against the current policy.

    ```sh
    curl "https://api.tailscale.com/api/v2/tailnet/example.com/acl/validate" \
      -u "${TS_API_TOKEN}:" \
      -H "Content-Type: application/json" \
      --data-binary '[{"src": "group:operators", "accept": ["lab-vm-1:22"]}]'
    ```

## Verify it

1. **Run a negative control before you trust a green result.** Open a pull request that deliberately deletes the grant your lockout test depends on. The check must go red and must name the failing assertion. A pipeline that has never been observed failing is not a pipeline, it is decoration.

2. **Run the positive control.** Merge a change that only adds a HuJSON comment, then confirm the admin console shows that comment. That proves the apply step has the write scope and is actually reaching your tailnet, which the test step alone never proves.

3. **Prove which side is authoritative.** Make a small edit directly in the admin console, then merge any change from the repository. The apply step ships the repository version, so your console edit disappears. Watch that happen once, deliberately, on a change you do not care about, so nobody discovers it during an incident.

4. **Know what failure looks like.** The validate endpoint returns a 200 status even when tests fail, and the outcome is in the response body. Any wrapper you build yourself must read the body rather than the status code, or it will report success on every broken policy you ever write.

> [!GOTCHA] An empty `tests` section passes forever. So does a `tests` section full of assertions about hosts nobody depends on. The check being green tells you only that the things you thought to assert are still true. Every time an outage teaches you that some path mattered, the fix is two commits: the repair, and the assertion that would have caught it.

## Gotchas

1. **The disaster this prevents has a specific shape.** Someone tightens a rule, the change looks correct in review, and it removes access to the exact hosts an operator would need in order to revert it. There is no local console, no out of band path, and the person who can fix it in the admin console is on a plane. A single test naming that path costs one commit and prevents that entire evening.

2. **Tests only assert what you wrote down.** They cannot infer intent. Treat coverage of the repair path, the monitoring path, and the backup path as mandatory and everything else as nice to have.

3. **The admin console stays writable.** Adopting GitOps does not lock the web form, so drift is possible in the window between a console edit and the next apply. If you script your own updates instead of using the action, the API supports an `If-Match` header carrying the ETag from a prior read, so a concurrent change causes a rejection instead of a silent overwrite.

4. **API keys expire in ninety days.** The action documentation is explicit that if you use an API key you should schedule a monthly rotation, or use a trust credential such as an OAuth client or federated identity instead. A pipeline that fails closed on an expired key on a Friday afternoon is a self inflicted wound.

5. **Pick the narrower scope where you can.** `policy_file:read` can validate but never modify. If your review workflow runs in a less trusted context than your deploy workflow, that difference is worth the extra client.

6. **Asking the API for JSON costs you your comments.** A read returns HuJSON by default and returns plain JSON when you ask for `application/json`. Comments do not survive the JSON representation. This is another reason the repository, not a round trip through the API, is the source of truth.

7. **Assertions reference identities that must exist.** A test naming a group that your identity provider no longer syncs will fail, and it will fail on whatever pull request happens to be open at the time. That is correct behavior with confusing timing.

> [!FROM-THE-FIELD] The review discipline is what converts this from ceremony into safety, and it is small. Require a reason comment in HuJSON for any rule that widens access. Require the author to state, in the pull request body, which existing test proves the change did not break the repair path. Require a second pair of eyes on anything touching `tagOwners`, because tag ownership decides who can mint machines that inherit access. Three habits, no tooling, and they catch the failures that syntax validation never will.

## Where to take it next

1. Add posture conditions to your assertions with `srcPostureAttrs`, so the tests describe not only who may reach a host but from what kind of device, and a posture rule change cannot quietly widen a path.
2. Use the preview endpoint to generate review evidence automatically: post a comment on each pull request listing what a named identity can reach under the proposed policy, so reviewers compare outcomes instead of reading diffs of rules.
3. Mirror the same pipeline in whichever forge you actually use. The identical workflow exists for GitLab CI and Bitbucket, and the credential model is the same, so there is no reason to hand roll a script.
4. Extend the pattern to the rest of your tailnet configuration. Once the access policy is reviewable, the fact that tags, auth keys, and device approvals still change by hand starts to look like the anomaly it is.
