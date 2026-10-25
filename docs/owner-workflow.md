# Safe owner maintenance and continuation

Current profile: [code-only verification](code-only-verification.md) supersedes earlier browser-specific examples. Four code gates, named Node proofs, frozen inventory and independent reviews remain mandatory; browser obligations and execution are retired.
Use the existing owner maintenance workflow for harness and acceptance-contract changes. Feature jobs still use the serial queue/controller. These commands add admission and recovery around that controller; they do not create another executor or change its roles, acceptance criteria, full verifier or final independent review.

## Admit owner work before implementation

Create the separately classified maintenance issue and enqueue it through the existing `POST /api/issues/:id/start` entry point before starting owner work. Retain the issue and job IDs with the original authorization. Ordinary workers exclude maintenance jobs, so enqueueing does not start a competing feature executor. Keep verified dependency evidence and all normal serial ownership guards.

After full verification, independent exact-source approval and verified local integration, use the existing `scripts/record-maintenance.ts` command to record completion. It performs read-only queue eligibility before touching Git, acquiring an integration lock or opening evidence. The diagnostic identifies the requested issue/status, the missing queued job, unmet dependency IDs or the active job, and the appropriate next action. It does not enqueue, claim, restart or complete anything during this preflight. The eventual claim repeats the same eligibility rules in its existing transaction, so a preflight pass cannot authorize a later conflicting claim. All exact-source evidence and review checks remain mandatory.

An issue with no execution history needs explicit enqueueing through the existing entry point. For prior blocked, failed, completed or closed work, inspect the retained outcome and use the applicable owner recovery or follow-up workflow; never restart terminal work just to satisfy the receipt command.

## Minimum necessary scope

Apply the minimum-necessary rules in AGENTS.md to application changes, tests and helpers. Require a current goal, actual caller or existing documented contract before adding an optional capability. Existing coverage and source reviewers assess scaffolding necessity alongside behavior; preserve necessary correctness, accessibility, security and all accepted quality gates. Use current defaults and summaries for rationale, without another role, approval stage or report field. Deterministic prompt checks establish instruction delivery only; they do not prove agent compliance.

For existing fixtures, trim only demonstrated unused capabilities under reviewed coverage equivalence. Preserve accepted assertions and independently freeze the complete inventory before product edits. Do not add or expand custom framework/browser runtime imitations or private framework API use. Record any retained limitation and keep an unrelated fixture-framework replacement outside a scoped cleanup.

## Freeze before complete verification

Inspect relevant source and select existing meaningful coverage. For a coverage gap, the tests role adds scoped checks, the owner captures actual named assertion reds, and an independent coverage reviewer approves before implementation. An accepted assertion revision belongs to a separate acceptance-contract issue with an equivalence review. Freeze the complete tests/acceptance inventory, including helpers.

For a tool or fixture migration, inspect the affected fixtures for removed file references, obsolete startup commands, report paths and named check identities. Run only the affected fixture setup and known-good baseline checks; retain the commands and actual logs/reports in the existing tests summary and coverage feedback. Missing imports, missing files, setup failures and timeouts cannot substitute for a named behavior red. New requested behavior may remain intentionally red after setup succeeds. The existing coverage reviewer checks these focused results alongside owner assertion proofs before freezing. Keep corrections within the unapproved draft and avoid incidental fixed counts when exact case identities express the requirement. This adds no role, approval stage or full verification run.

The independent coverage receipt contains `approved: true`, an empty `findings` array, `sourceHash`, `snapshot: { hash, files }`, and `acceptedChecks: [{ path, hash }]`. Both source hashes must match the SHA-256 of the serialized snapshot files. The accepted inventory must exactly match its reviewed snapshot and the current complete test inventory. Optional `checks` contains exact Node file/title obligations added to the existing contract. Node files use repository-relative paths. `browserChecks`, when present, must be empty. The authoring snapshot can precede implementation, but its accepted test bytes cannot change.

During focused diagnostics as well as complete verification, await the running check and owned-process cleanup before changing the same source, tests, configuration or executing engine. A background or yielded process is still running. If an edit is necessary, cancel that owned check, wait for it to settle, then edit and explicitly run the related checks again. Inspect retained process receipts and logs after interruption; never treat an unresolved owned process as settled. Existing process ownership and source/input identity guards remain authoritative. Drift invalidates the proof and must not be sent into product repair as a demonstrated behavior defect or trigger an automatic retry.

Finish implementation and related named diagnostics before submitting an absolute-path request:

```json
{
  "schemaVersion": 1,
  "repository": "/absolute/repository",
  "runDirectory": "/absolute/evidence/new-maintenance-run",
  "coveragePath": "/absolute/evidence/coverage-review.json"
}
```

Run `npm run factory -- verify-maintenance request.json`. Admission rejects absent or invalid approval and changed test inventory before starting any gate. A checkout lease rejects concurrent complete runs. The command captures a Git tree using a temporary index, freezes it into an isolated worktree and invokes the existing trusted verifier with owned ports and database. Continue editing only after it returns: edits to the original checkout cannot change the frozen proof, but make that proof stale for delivery. No automatic rerun or retry follows a stale or unknown failure.

Read `readiness.json`, `owner-verification.json`, `verification/summary.json`, raw reports and process receipts. A passing outcome updates the source checkout's `.runs/latest.json`. All four code gates and required named cases remain mandatory. Retain evidence on failure; unsafe process ownership retains the worktree. A fresh independent final source review and verified local integration still precede `scripts/record-maintenance.ts` attestation. The command does not commit or authorize a different source tree.

## Diagnose a failed focused check

An adaptive integrated task sends an actual named focused assertion failure to the existing read-only acceptance reviewer with purpose `focused-failure-triage` before another product repair. Passing focused checks add no agent invocation. This is a failure disposition using the existing Review response, not a new role or acceptance approval. Approval permits ordinary product repair only when the original goal, frozen check, current source and actual machine report demonstrate a concrete product defect. A suspected test-contract defect or uncertain cause blocks for owner maintenance. A failed assertion alone does not establish which side is wrong.

The controller retains unique `failure-proof-<runId>-<attempt>` report/log copies, their hashes, a source-bound review receipt and `failure-triage-<attempt>.json`. Its accepted checkpoint holds the failure before invoking review, so malformed responses, cancellation and interrupted review cannot release a repair. Interrupted draft capture preserves an already checkpointed hold even when `state.json` predates it. Matching checkpoint recovery re-triages that exact held source before consuming another implementation attempt. A valid approval releases only ordinary repair; rejection preserves the hold. Historical failure copies cannot be overwritten by later focused runs.

Inspect the disposition and original proof before authorizing maintenance or continuation. Correct an accepted observation only through a separately reviewed acceptance-contract issue; never edit its frozen checkpoint or reset the ledger. Reviewed control revisions still invalidate incompatible native reuse. Version-one verification and other existing failure paths retain their current handling. Complete integrated verification, final independent source review, whole-goal acceptance and enrolled GitHub delivery remain mandatory.

## Resume one blocked feature

Stop the normal queue worker using its verified PID and identity before issuing a continuation. Do not kill processes by name or start a competing executor. Inspect the blocked report, original goal, accepted checkpoint and cumulative ledger first. If an unknown ownership or source identity problem remains, resolve it explicitly instead of granting attempts.

```json
{
  "schemaVersion": 1,
  "requestId": "11111111-2222-4333-8444-555555555555",
  "databasePath": "/absolute/platform.sqlite",
  "issueId": 123,
  "additionalAttempts": 1,
  "additionalTimeMs": 600000,
  "reason": "Owner authorizes one bounded continuation of the unchanged goal."
}
```

Preview with `npm run factory -- owner-resume request.json --validate`; execute with the same command without `--validate`. Each allowance is explicit: attempts range from zero to five, time from zero to one hour, and at least one is positive. Preview does not grant budget, claim or enqueue jobs. New owner decisions use new UUIDs; recovery of the same decision reuses its exact request and UUID.

The command checks the original canonical task, assignment, clean enrolled target and predecessor process lineage. Budget grants append to the existing task-bound ledger, preserving spent time, implementation/acceptance counters and public task limits. A crashed reservation is conservatively settled before a grant. Original task/checkpoint bytes are never rewritten to manufacture reuse; native identity validation decides whether reuse remains valid.

A persistent journal under `evidence/owner-resumes/<requestId>` precedes grants and enqueueing. The queued payload binds its owner request ID, so recovery cannot adopt another decision's job. Replay reconciles the recorded job and actual platform outcome; it cannot grant twice or restart terminal work. The existing queue claims only that job through its normal admission and dependency guards, leaving queued siblings untouched. A dead interrupted execution uses native recovery and returns its blocked or merged outcome; another attempt requires a new explicit decision. Live owners, changed goals, ambiguous history and unresolved ownership fail closed. Restart the normal worker only after the owner command settles.

Maintenance jobs remain separate owner deliveries. Requirement verification and GitHub publication remain normal later queue jobs; an owner continuation of one child does not claim that the whole requirement is delivered.
