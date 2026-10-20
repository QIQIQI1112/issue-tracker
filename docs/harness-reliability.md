# Change ownership, review, and recovery

Requirement planning and review retain each invocation's complete evidence string as `evidence.txt`, including response repair attempts. Prompts identify its absolute path, UTF-8 byte count and SHA-256. Evidence up to 64 KiB also remains inline for small-context compatibility; larger manifests are read from the retained file to keep CLI input bounded. Reviewers inspect complete retained evidence, actual source and underlying machine reports rather than approve from summaries. No evidence is truncated, and review schemas, sandbox, deadlines, retry counts and approval gates remain unchanged. Failed invocations retain their evidence for diagnosis.

## Plan changes by responsibility

Keep new behavior checks in their feature issue. The tests worker adds the checks; an independent acceptance reviewer evaluates their coverage before implementation. A new test is not automatically a new issue.

Create a separate `acceptance_contract` issue when changing an existing required assertion, required case, verification gate, or acceptance criterion. Create a separate `harness` issue when changing the controller, verifier, review policy, recovery, budgets, or protected workbench controls. Declare dependencies explicitly. Version-two conversation plans accept `changeKind`; version-one plans retain their original canonical identity. A classification never expands a worker's write permissions.

The ordinary queue leaves maintenance jobs awaiting owner verification. Maintenance is implemented in an isolated owner worktree with its own failing checks, full verification, independent review, and verified local integration. The owner recorder requires actual machine reports for the exact committed source and independent approval covering the exact issue goal and acceptance contract. A generic approval or an old passing build cannot complete unrelated work. Owner maintenance is a cooperative local protocol, not a sandbox for hostile maintainers.

## Review the right evidence at each stage

Ordinary integrated feature execution follows this order:

1. Plan acceptance coverage and named behavior checks.
2. Add or repair only unapproved scoped checks.
3. Run controller-owned named red proofs, distinguishing missing behavior from environment/import failures and already-satisfied behavior.
4. Independently review coverage, assertions, boundary cases, and the actual red proofs. Repeat steps 2–4 within the acceptance budget when rejected.
5. Freeze accepted checks, implement, and run the complete verifier.
6. Apply the patch to the latest enrolled target and run the complete verifier again.
7. Independently review that integrated code and its evidence. Repair a rejected candidate within the implementation budget, then repeat verification and final review.
8. Advance the local target only to the exact verified and reviewed tree.
9. Verify and independently review the original whole requirement after all child merges.

There is one authoritative code review for each integrated candidate. Candidate verification, integrated verification, and whole-requirement verification remain mandatory. A delivery without a merge target retains its independent candidate code review. Maintenance retains its separate owner review and admission requirements.

Owner receipts bind review purpose, source hash, canonical plan identity, acceptance identity, verification contract, and evidence path. Rejected reviews and earlier test generations retain separate evidence. Workers cannot approve themselves by writing a hash or claiming completion.

Initial acceptance runs controller-owned Playwright proofs for every planned browser case in a new or changed spec file, including appended specs. Unchanged baseline browser files retain their existing coverage and still run in full verification. A named assertion failure establishes missing behavior; an exact single-case passing report records already-satisfied behavior for independent review. Import errors, setup errors, missing cases, skips, retries and timeouts cannot authorize freezing. Assertion detection reads the diagnostic before the source excerpt, including custom assertion explanations, rather than matching an `expect` call in an unrelated setup error's code frame. Invalid browser evidence returns to the tests role within the existing cumulative acceptance budget; process ownership errors and cancellation still block. Missing browser behavior prevents skipping implementation even when all Node proofs pass.

### Improve drafts inside the existing tests phase

The `tests` and `regression-tests` prompts include a short self-check based on observed acceptance rework. It adds no role, phase, gate or budget. Apply only relevant checks to the planned behavior:

| Risk in a draft | Stronger behavior proof |
| --- | --- |
| Clicking a missing control ends in an action timeout. | Assert its presence with a bounded named `expect` before acting. |
| Only matching data is present, or state is dismissed before testing cleanup. | Include confounding and excluded records; change scope while active details and pending state still exist, then assert cleanup. |
| Raw fixture words can satisfy an assertion about a generated explanation. | Assert the application-generated observation separately from displayed source text. |
| A rejection diagnostic alone appears to prove a boundary. | Assert that the rejected payload is not admitted and that the exact valid limit is accepted. |
| Programmatic focus appears to prove keyboard access. | Traverse with normal Tab and Shift+Tab and assert the reachable control. |

Baseline and accepted bytes remain protected. Before approval, the initial tests role may revise only its current unapproved appended regions or new scoped files; the regression-tests role may revise only its own new scoped files. Keep planned and reported check identities aligned rather than accumulating unmapped replacement scenarios after feedback. Record a known sandbox startup `EPERM` once, stop repeated server/browser launches, and leave owner red proofs to the controller.

Adapter regressions verify that both roles actually receive this guidance with their existing response schemas and permissions. They prove prompt delivery, not guaranteed model output quality. Controller-owned red proofs, independent acceptance review, frozen checks, complete verification and final source review remain authoritative. Observe future draft rejection and repair evidence before claiming reduced rework.

Acceptance and final code reviews may correct a malformed structured response once within the same phase. The correction shares the original phase deadline, attempt number, source, plan and evidence. Both responses count toward active execution time; no planning or tests generation restarts and no budget resets. The controller retains the original response and validation error in `phase-*/contract-error.json`. A valid rejection follows the existing repair path. Failed or timed-out processes are not format errors. Read-only source checks run after every response or invocation failure, before format correction or approval. An approved review requires an empty blocking-findings array; the controller never deletes findings to manufacture approval.

## Retry without losing accepted work

Checkpoints live in the run evidence directory, outside disposable worktrees. They include a reconstructable binary patch, added and deleted source, baseline identities, plan, accepted test hashes, review, and named red-proof hashes. A retry receives a new run ID and preserves its predecessor. Ownership checks follow the full predecessor lineage and all earlier issue runs; repeated retry cannot hide an older live process.

The controller can reuse accepted planning/test evidence only when the goal, criteria, scope, budget, controls, original tests, dependency lock, runtime, active harness, and proof hashes match. It records every invalidation reason. Unapproved drafts remain evidence and cannot authorize implementation. Every restored draft gets fresh full verification and code review. Verified merge recovery runs before replay so a crash after integration cannot apply the change twice.

Delivery-only baseline reconstruction uses the recorded immutable `baselineTree`, which may contain original uncommitted modifications and new files absent from `baseCommit`. Restore that tree before applying `checkpoint.patch`, then validate the exact source and frozen test inventory. Keep the original baseline as the final patch/change-attribution boundary. Set `resume.reused` only after reconstruction and enforcement succeed; a failed restoration remains false and blocks without consuming a new implementation attempt. Clean-target queue admission, cumulative budgets and fresh verification/review remain unchanged.

Accepted checkpoints retain initial browser logs, machine reports and `browserRedChecks`, bound to the independent acceptance receipt and approved spec hashes. Missing, emptied, altered or orphaned browser proof metadata rejects reuse. A control revision invalidates older checkpoints through the existing environment identity; absent browser metadata is never treated as approval. Successful restoration copies the original browser proof files into the new run without regenerating planning or accepted checks; fresh complete verification and final review remain mandatory.

Acceptance attempts, implementation attempts, and active execution time are cumulative per issue. Waiting between completed runs is not charged. A hard crash conservatively spends its active phase reservation. Retry cannot silently increase budgets or alter criteria. Exhaustion requires a separate owner decision.

Owned subprocess receipts include all discovered process groups and their cleanup state. Recovery refuses unsettled groups and retains unsafe workspaces for owner inspection. Stale execution lease reclamation is serialized. A crash while holding the short admission guard requires explicit inspection of that guard; automatic concurrent guard reclamation is deliberately unavailable. Inspect exact recorded PIDs and identities before cleanup, never process names.

## Read a delivery

The issue report presents the goal, result, changed files, decisions, named behavior checks, verification counts, review outcome, merge commit, execution timeline, cumulative budget, predecessor, and reuse decision. Legacy reports remain readable without the new optional fields.

The controller's final Result and current limitations reflect its outcome and actual failure reason. Optional `workerObservations` preserves each implementation summary in an explicitly historical UI/Markdown section, alongside the original worker JSON. Sandbox-only or pending worker observations are not current blockers after owner verification passes. If later queue admission or recovery changes a proposal to Blocked, its Result must also show the owner blocker. Existing historical evidence is retained as recorded rather than rewritten.

For workflow improvement, retain `state.json`, `task.json`, `plan.json`, review receipts, checkpoint manifests/patches, machine reports, and phase logs. The evidence manifest provides file sizes and hashes. Successful browser tests do not retain full traces; failed tests keep their debugging artifacts. Read the compact delivery first and open detailed evidence only for a concrete question.

A final reviewer that ignores cancellation must keep its exact integration worktree through both cleanup paths. The owner records the retained workspace and safety reason, and queue cleanup also preserves the candidate worktree. This rule is covered by real controller and queue interruption regressions; settled successful and rejected reviewers still clean up normally. Requirement-level review can block an otherwise passing delivery and create a separately reviewed corrective issue without changing the frozen original requirement membership or acceptance criteria.

Process-group inspection treats only `ESRCH` as confirmed absence. `EPERM` and other probe errors remain unsafe and are retried within the existing cleanup window. A persistent error returns a structured failure with `settled: false`; it cannot escape from an exit callback or prevent the ownership receipt from being finalized. The result and receipt use the same final observation. Receipts retain bounded diagnostic probe errors even when a later probe confirms absence. On Darwin, a zombie-only group can produce `EPERM` ([Apple XNU signal implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1612-L1621)); this possibility does not authorize treating `EPERM` as dead or weakening the positive-PID cancellation assertions.

## Close a confirmed coverage gap

A final independent code reviewer sets `needsRegression: true` only when a blocking, reproducible product defect lacks deterministic coverage. The finding states the trigger and expected behavior. Existing failing checks use ordinary repair. Speculative improvements and new business goals do not enter this branch.

The controller sends that finding to the existing tests role as `regression-tests`. It may create new scoped Node test files or browser spec files only. Every existing file, including accepted tests and the defective implementation, remains unchanged. The response lists exact new file names and test titles. No defect registry, additional issue hierarchy, or new service is required.

The controller runs each named new check against the reviewed defective candidate. A passing check, missing case, import failure, setup failure, skip, or timeout cannot establish a regression red proof. Browser proofs use an owned disposable server/database and machine JSON reports; Node proofs use the trusted reporter. An independent acceptance reviewer reads the finding, checks, and actual red proofs. Rejected drafts can be revised within the existing cumulative acceptance budget. Only approved checks are frozen and added to the effective verification contract. The repair worker then fixes the product while all accepted checks remain immutable.

Candidate verification, integrated verification, final independent code review, verified local merge, and whole-requirement acceptance keep their existing responsibilities. An integrated review of a newer target cannot authorize red proofs against a different worker snapshot: the controller blocks for owner rebase when the reviewed source differs. Scope and criteria never expand through a regression request.

Before regression generation, a checkpoint retains the rejected reviewed candidate and pending request. Unapproved test drafts remain evidence and are never promoted by interruption recovery. Retry regenerates those drafts and repeats red proofs and independent acceptance review. After approval, checkpoints retain the new check hashes, red logs and machine reports, and source-bound coverage receipt; retry restores these checks frozen and runs fresh complete verification and code review. Orphan regression proof files or review receipts reject reuse, so missing pending or accepted regression metadata cannot silently authorize repair. Acceptance attempts, implementation attempts, elapsed execution time, and ownership lineage remain cumulative. Exhaustion still requires an explicit owner decision.

Delivery reports include the added behavior checks, coverage receipt, phase timing, and proof paths. New test files are discovered by the ordinary test commands after integration, so later tasks run the regression automatically. `acceptance/refresh-focus.spec.ts` is the permanent regression for issue opener retention and focus restoration during a job-triggered background refresh, covering success/failure and title/identifier entry controls.

The frozen contract includes the complete approved file inventory under `tests/` and `acceptance/`, including helpers. Implementation and repair cannot add test files after coverage approval. Only the initial tests phase or the independently reviewed `regression-tests` branch can extend that inventory. Accepted checkpoints read the controller-owned `accepted-checks.json` inventory and verify exact file membership and hashes before writing a patch or manifest. Interrupted draft capture uses the same checkpoint gate; unreviewed files cannot become accepted through recovery. The approved inventory is itself a hashed checkpoint proof; loaded checkpoint metadata must match it before reuse. Restoration also checks exact membership. A rejected capture retains the last valid checkpoint and its proof bytes.

## Publish accepted requirements

GitHub-enrolled requirements freeze their repository, remote, workflow, branch, base and accepted head. Feature children integrate into that requirement branch; owner maintenance derives the same target. Whole-goal verification remains mandatory and binds publication to the current owned report and exact committed source. A local acceptance or child merge cannot establish GitHub delivery. Cross-requirement dependencies require the predecessor's confirmed publication; internal dependencies retain ordinary child merge readiness.

Publication uses bounded owner processes and persistent `requirement_publish` jobs, without another agent or service. Pending CI defers a poll; restart reconciles interrupted publication only. Lost create/merge responses reuse the reserved PR and stored CI identity. The publisher verifies the latest configured workflow, PR/head/base identity, all returned jobs/checks/statuses and strict required-check/admin protection before a SHA-conditioned merge. GitHub enforces the target race boundary. It records the confirmed remote merge and synchronizes the clean local target before requirement completion. `.github/` joins protected controls. Failed CI, changed identities and unresolved Git operations block without weakening gates, force-pushing, resetting budgets or silently publishing legacy requirements. See [GitHub delivery](github-delivery.md).

Whole-goal approval metadata and its successful run outcome commit in one SQLite transaction. Retry selects publication only for the current owned passed whole-goal run; partial or interrupted approval metadata returns to whole verification. Prior publication process ownership must settle before any further job uses the shared repository. Ambiguous Git push destinations are rejected before spawning push. Pending additional checks/statuses defer observation, while terminal failures block. The merged publication state is written only after confirmed remote merge and successful local synchronization.
