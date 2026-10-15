# Change ownership, review, and recovery

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

## Retry without losing accepted work

Checkpoints live in the run evidence directory, outside disposable worktrees. They include a reconstructable binary patch, added and deleted source, baseline identities, plan, accepted test hashes, review, and named red-proof hashes. A retry receives a new run ID and preserves its predecessor. Ownership checks follow the full predecessor lineage and all earlier issue runs; repeated retry cannot hide an older live process.

The controller can reuse accepted planning/test evidence only when the goal, criteria, scope, budget, controls, original tests, dependency lock, runtime, active harness, and proof hashes match. It records every invalidation reason. Unapproved drafts remain evidence and cannot authorize implementation. Every restored draft gets fresh full verification and code review. Verified merge recovery runs before replay so a crash after integration cannot apply the change twice.

Acceptance attempts, implementation attempts, and active execution time are cumulative per issue. Waiting between completed runs is not charged. A hard crash conservatively spends its active phase reservation. Retry cannot silently increase budgets or alter criteria. Exhaustion requires a separate owner decision.

Owned subprocess receipts include all discovered process groups and their cleanup state. Recovery refuses unsettled groups and retains unsafe workspaces for owner inspection. Stale execution lease reclamation is serialized. A crash while holding the short admission guard requires explicit inspection of that guard; automatic concurrent guard reclamation is deliberately unavailable. Inspect exact recorded PIDs and identities before cleanup, never process names.

## Read a delivery

The issue report presents the goal, result, changed files, decisions, named behavior checks, verification counts, review outcome, merge commit, execution timeline, cumulative budget, predecessor, and reuse decision. Legacy reports remain readable without the new optional fields.

For workflow improvement, retain `state.json`, `task.json`, `plan.json`, review receipts, checkpoint manifests/patches, machine reports, and phase logs. The evidence manifest provides file sizes and hashes. Successful browser tests do not retain full traces; failed tests keep their debugging artifacts. Read the compact delivery first and open detailed evidence only for a concrete question.
