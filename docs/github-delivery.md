# Requirement delivery through GitHub

GitHub publication is an explicit owner enrollment for a local repository. New requirements snapshot that enrollment and receive a persistent unique `codex/requirement-<id>-<suffix>` branch. Existing requirements and repositories without enrollment retain local delivery. Standalone issues still use the enrolled local target. This migration never publishes historical work automatically.

## Enroll a repository

Install and authenticate the GitHub CLI on the worker host. The configured Git remote must resolve to the same `github.com/owner/repository` for fetch and push. The target must permit merge commits. Add `.github/workflows/verify.yml` to that repository: the workflow must run for `pull_request`, run the full verifier in a job named `verify`, and preserve machine reports. This repository includes an executable pinned-action example. Its disposable CI checkout names the tested PR merge tree `main` locally so existing repository-enrollment checks see an actual local target; this never pushes or changes the GitHub target.

After the workflow is on the GitHub target, run from the platform checkout:

```sh
node --import tsx scripts/enroll-github.ts --database .data/issues.sqlite --repo 1 --github OWNER/REPOSITORY --configure-protection
```

The owner command checks the remote identity, permissions and workflow, configures strict required `verify` CI with administrator enforcement, and persists the enrollment. For an existing protection it preserves other required checks, review requirements and restrictions. Omit `--configure-protection` to validate an already configured target without changing its rules. Existing mandatory human reviews remain mandatory on GitHub; the publisher never bypasses them. Enrollment evidence is retained under `.data/evidence/github-enrollment-*`.

The equivalent `github` metadata is accepted when explicitly registering a new repo through the API. The worker still requires the matching remote, workflow, successful CI and strict server protection before merging. The optional configuration is `{ "repository": "OWNER/REPOSITORY", "remote": "origin", "workflow": "verify.yml" }`. Configuration changes apply to new requirements only.

## Execution and completion

1. The serial queue creates the reserved requirement branch from the fetched GitHub target. A local target can advance only by a clean fast-forward; divergent or dirty targets block execution.
2. Each child runs the existing planning, red checks, independent acceptance review, frozen-test implementation, complete verification, integrated verification and independent code review. Integration advances the requirement branch. Owner maintenance children use that same derived target.
3. After every child has recorded merge evidence, the queue runs the complete verifier and independent original-goal review on the exact requirement head. A passed local review queues `requirement_publish`; it does not mark the requirement Done.
4. The owner publisher validates the current owned whole-goal report, source hash and child integration ancestry. It pushes the exact approved head without force, finds or creates one PR for the reserved head/base, and retains the PR URL and number. The body summarizes the original goal, child deliveries, changed files and verification.
5. Each publication job performs one bounded observation. Missing or unfinished workflow results defer a new poll for 30 seconds, allowing other ready work to run. The waiting budget is 24 hours from whole-goal acceptance. Each observation retains its own run and evidence.
6. Admission requires the latest configured `pull_request` workflow run for this PR, exact head and original base to succeed. Its `verify` job and all returned jobs/checks must complete successfully, with no skipped checks; reported commit statuses must also succeed. Missing or oversized reports fail closed. The target must require strict `verify` CI with administrator enforcement. GitHub therefore also rejects a merge when the base moves between observation and merge.
7. The merge request conditions on the approved head SHA. The publisher reads back the merged PR, retains the merge SHA, fetches the target, verifies merge ancestry and fast-forwards the clean local target. Only the confirmed remote outcome completes the requirement. Cross-requirement dependencies wait for that outcome; dependencies within one requirement use its child merges.

The platform exposes branch, PR/CI links, merge SHA, publication state and failures in issue diagnostics and delivery reports. `Whole-goal verification` and `GitHub publication` retain separate run histories. Human sampling is optional; the existing independent review roles and verification gates remain required.

## Recovery and limits

Publication is a controller operation; implementation workers cannot push, approve their own work, or edit `.github/` verification controls. There is no new agent role, service, webhook receiver or parallel executor.

A worker restart requeues only an interrupted publication observation after ownership is settled. It does not rerun development. A lost PR-create response is reconciled by the reserved head/base; a lost merge response is reconciled from the same PR and the stored exact-head CI approval. Completed remote merges are never inferred from worker prose. Explicit retry of a blocked requirement reuses its accepted publication identity. HTTP submission replay still cannot restart blocked work.

Failed CI, closed or changed PRs, dirty/divergent targets, missing protection, API errors and identity mismatches block with retained evidence. New code cannot be attached to an already accepted publication head. A moved base needs owner rebase and fresh acceptance, or a new follow-up requirement; this minimal version does not rewrite branches or automatically resolve conflicts. Do not reset frozen identities or retry budgets to work around a rejection. GitHub rules requiring additional approvals can also block automatic merge and remain in force.

Keep `github-pr-input.json`, `github-pr.json`, workflow/jobs/check/status/protection reports, merge response, publication metadata and process ownership receipts together with the existing requirement verification and child deliveries. Successful browser runs retain no full traces. CI uploads verification reports for seven days and browser debugging artifacts on failure. Both uploads explicitly include hidden files because their scoped paths live under `.runs/`.
