# Safe owner maintenance and continuation

Current profile: [code-only verification](code-only-verification.md) supersedes earlier browser-specific examples. Four code gates, named Node proofs, frozen inventory and independent reviews remain mandatory; browser obligations and execution are retired.
Feature and explicitly authorized maintenance jobs share the [serial execution kernel](execution-kernel.md). Owner authorization configures bounded control scope under a pinned pre-change supervisor; it does not create another executor or change roles, acceptance criteria, the full verifier or final independent review.

## Admit owner work before implementation

Create the separately classified maintenance issue and enqueue it through the existing `POST /api/issues/:id/start` entry point before starting owner work. Retain the issue and job IDs with the original authorization. Ordinary workers exclude maintenance jobs, so enqueueing does not start a competing feature executor. Keep verified dependency evidence and all normal serial ownership guards.

Before dispatch, prepare an absolute-path authorization request as specified in [Authority profiles](execution-kernel.md#authority-profiles): UUID, exact issue identity, harness or acceptance-contract profile, safe explicit scope, original authorization, loaded engine/source hash, active contract hash and exact target base commit. Validate these identities before native claim; a maintenance label or submitted classification cannot grant authority.

Settle and stop the exact idle ordinary daemon first, then use its existing exclusive queue lease:

```sh
DB_PATH=/absolute/platform.sqlite npm run worker -- --once --owner-authorization /absolute/authorization.json
```

The queue claims the existing native job before role work, captures the verified pre-change supervisor and runs the same typed stage pipeline. Coverage reuse or independently approved extension, focused diagnostics, fresh complete verification, final independent source review and actual integration remain mandatory. The outcome is indexed natively with actual queue waiting, claim-to-completion and phase timing. Restart ordinary service only after this owner dispatch settles. Candidate controls activate only after accepted integration and a quiescent handoff.

`scripts/record-maintenance.ts` remains a compatibility attestation for owner work already verified, independently approved and integrated under the previous owner route. Its read-only queue eligibility preflight precedes Git/evidence access, and its eventual transactional claim repeats eligibility. It cannot enqueue, restart work, manufacture earlier role timing or establish readiness from prose. Retain exact committed-source reports and issue-bound approval. New native maintenance does not need this late completion recorder.

An issue with no execution history needs explicit enqueueing through the existing entry point. For blocked, failed, completed or closed work, inspect retained outcomes and use applicable owner recovery or follow-up workflow; never restart terminal work to satisfy a receipt command.

## Minimum necessary scope

Apply the minimum-necessary rules in AGENTS.md to application changes, tests and helpers. Require a current goal, actual caller or existing documented contract before adding an optional capability. Existing coverage and source reviewers assess scaffolding necessity alongside behavior; preserve necessary correctness, accessibility, security and all accepted quality gates. Use current defaults and summaries for rationale, without another role, approval stage or report field. Deterministic prompt checks establish instruction delivery only; they do not prove agent compliance.

For existing fixtures, trim only demonstrated unused capabilities under reviewed coverage equivalence. Preserve accepted assertions and independently freeze the complete inventory before product edits. Do not add or expand custom framework/browser runtime imitations or private framework API use. Record any retained limitation and keep an unrelated fixture-framework replacement outside a scoped cleanup.

## Freeze before complete verification

Inspect relevant source and select existing meaningful coverage. For a coverage gap, the harness tests role adds NEW scoped test files only, never appending to or revising existing tests or helpers; baseline checks are selected unchanged. Ordinary feature authoring retains its scoped append/new-file permissions. For either profile, the owner captures actual named assertion reds and an independent coverage reviewer approves before implementation. An accepted assertion revision belongs to a separate acceptance-contract issue with an equivalence review. Freeze the complete tests/acceptance inventory, including helpers. An explicit acceptance-contract author may revise or retire only authorized paths while preparing the unapproved draft. Independent coverage approval freezes the exact remaining inventory and any replacement checks. Later implementation cannot change any frozen test bytes. Modern checkpoints preserve both ordinary tracked deletions and approved retirements; recovery validates the reconstructed exact source and inventory.

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

Read `readiness.json`, `owner-verification.json`, `verification/summary.json`, raw reports and process receipts. A passing outcome updates the source checkout's `.runs/latest.json`. All four code gates and required named cases remain mandatory. Retain evidence on failure; unsafe process ownership retains the worktree. A fresh independent final source review and verified local integration still precede native completion or compatible `scripts/record-maintenance.ts` attestation. The command does not commit or authorize a different source tree.

## Diagnose a failed focused check

An adaptive integrated task sends an actual named focused assertion failure to the existing read-only acceptance reviewer with purpose `focused-failure-triage` before another product repair. Passing focused checks add no agent invocation. This is a failure disposition using the existing Review response, not a new role or acceptance approval. Approval permits source repair within the actual authorized task contract when the original goal, frozen check, current source and actual machine report demonstrate a concrete defect. This includes scoped harness source compatibility repair under admitted owner authority; preserve established accepted diagnostics when source repair suffices. A suspected test-contract defect or uncertain cause blocks for owner maintenance. A failed assertion alone does not establish which side is wrong.

The controller retains unique `failure-proof-<runId>-<attempt>` report/log copies, their hashes, a source-bound review receipt and `failure-triage-<attempt>.json`. Its accepted checkpoint holds the failure before invoking review, so malformed responses, cancellation and interrupted review cannot release a repair. Interrupted draft capture preserves an already checkpointed hold even when `state.json` predates it. Matching checkpoint recovery re-triages that exact held source before consuming another implementation attempt. A valid approval releases only source repair within the admitted task scope; rejection preserves the hold. Historical failure copies cannot be overwritten by later focused runs.

Inspect the disposition and original proof before authorizing maintenance or continuation. Correct an accepted observation only through a separately reviewed acceptance-contract issue; never edit its frozen checkpoint or reset the ledger. Reviewed control revisions still invalidate incompatible native reuse. Version-one verification and other existing failure paths retain their current handling. Complete integrated verification, final independent source review, whole-goal acceptance and enrolled GitHub delivery remain mandatory.

## Resume one blocked feature or authorized maintenance job

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

Preview with `npm run factory -- owner-resume request.json --validate`; execute with the same command without `--validate`. Both fields must be explicit. `additionalAttempts: 0` and `additionalTimeMs: 0` request continuation within remaining original capacity, without an owner grant or new allowance. Positive grants retain attempts from zero to five and time from zero to one hour, with at least one positive; `validateOwnerGrant` and `grantExecutionBudget` remain positive-grant operations. Preview does not grant budget, claim or enqueue jobs. For authorized maintenance, additionally supply `ownerAuthorizationPath` pointing to the original unchanged authorization request. Engine, contract, issue, base and scope identities must still match before any grant; profile classification alone cannot release work. New owner decisions use new UUIDs; recovery of the same decision reuses its exact request and UUID.

The command checks the original canonical task, assignment, clean enrolled target and predecessor process lineage. Before any new journal, grant or enqueue write, admission reads the task-bound ledger and effective limits without settling or writing it, conservatively charging a crashed phase reservation. A positive request is evaluated with its explicit proposed allowance, without persisting it during preview; 0/0 adds no allowance. It requires implementation and time capacity. A valid accepted checkpoint remains eligible at its acceptance-attempt limit; absent or unapproved coverage, including a pending regression draft, still requires acceptance capacity. Claimed accepted checkpoint proof must validate before durable admission. Exhaustion or invalid identity/proof blocks without a job. Budget grants append to the existing task-bound ledger, preserving spent time, implementation/acceptance counters and public task limits. A crashed reservation is conservatively settled before a grant. Original task/checkpoint bytes are never rewritten to manufacture reuse; native identity validation decides whether reuse remains valid.

A persistent journal under `evidence/owner-resumes/<requestId>` precedes grants and enqueueing. The queued payload binds its owner request ID, so recovery cannot adopt another decision's job. Replay reconciles the recorded job and actual platform outcome; it cannot grant twice or restart terminal work. The existing queue claims only that job through its normal admission and dependency guards, leaving queued siblings untouched. A dead interrupted execution uses native recovery and returns its blocked or merged outcome; another attempt requires a new explicit decision. Live owners, changed goals, ambiguous history and unresolved ownership fail closed. Restart the normal worker only after the owner command settles.

Maintenance uses the same selected-job continuation and pinned supervising engine with its original explicit authority. Requirement verification and GitHub publication remain normal later queue jobs; an owner continuation of one child does not claim that the whole requirement is delivered.

## Selective regressions and dependent activation

New permanent defect checks require a confirmed significant OR recurring project defect and worthwhile deterministic prevention that outweighs authoring, maintenance and execution cost. Minor one-off findings may use existing meaningful coverage plus repair and independent review with `needsRegression: false`. New business behavior still needs meaningful acceptance; significant harness safety changes retain targeted regressions. Record the judgment in existing plan defaults and review/coverage summaries, without another role, registry, schema or gate.

Dependent owner maintenance activates in order: finish the predecessor through fresh complete verification, independent approval and native integration; settle the serial lease and processes; then capture that released engine for the dependent issue. Issue87 was natively integrated at `7f2bed7ceb63a3ff194dea89bc67459715a538ff` before Issue88 dispatch. Its run `6c1d8d5e-eb48-4bed-a85d-966f0911e113` is predecessor evidence, not Issue88 proof. The prior Issue88 interruption and same cumulative ledger remain historical evidence; unapproved drafts never become accepted by activation. No additional attempts or time follow from switching to the verified predecessor. Use the same native dispatcher and original authority, never compatibility completion. See [the fixed baseline and pending observations](stability-observation.md).

## Adopt an approved revision of retained tests

A blocked maintenance issue may add `acceptedRevisionPath` to its existing positive-allowance owner-resume request. This absolute owner-local JSON path contains `schemaVersion: 1`, `artifact: { path, hash }`, `contractRunId`, and `transition`. The transition binds `originalAuthorization` and `currentAuthorization` as absolute `{ path, hash }` records and the unchanged runtime `{ node, platform, arch }`. Supply the same current authorization through `ownerAuthorizationPath`. Its engine and target base may advance explicitly; original issue identity, profile, protected implementation scope and verification contract remain unchanged. This route does not authorize zero allowance or change task limits.

The artifact must already belong to a genuinely merged native acceptance-contract run. Its enrollment may use another checkout, but both enrollments must resolve to the same Git common directory and effective integration branch. Admission validates the actual integration commit, complete verification, independent integrated-source approval, historical task/checkpoint/patch/proofs, pinned historical supervisor, reviewed full source snapshots, complete test inventories and replacement contents. Only replacement of existing accepted tests is supported. Pending regression or failure-triage holds, accepted regression combinations, missing-path drafts, additions, retirements, production-changing revisions and unexplained shared-test changes fail closed. The staged patch must reconstruct exactly the reviewed replacement source.

Historical environment admission recomputes the original Git baseline controls and the actual clean enrolled checkout controls under the validated pinned historical supervisor and unchanged current runtime. The enrolled context uses canonical `environmentIdentity(repo.path, supervisor.directory)`: its checkout may remain on main while the integration branch advances. The stored identity must exactly match one of these two computed contexts; checkpoint loading uses that computed match. An unknown context fails before durable admission writes.

Use `owner-resume request.json --validate` first. Invalid evidence or exhausted cumulative acceptance/implementation capacity fails before a journal, grant or queued job is written. The ordinary positive grant remains explicit and task-bound. The existing journal pins all admitted evidence hashes; exact replay checks those bytes and returns the native recorded outcome without executing again, including after an interrupted coverage review. A new decision requires a new request ID.

Native preparation reconstructs the historical candidate, carries only its authorized draft onto the current target and installs approved test replacements. Newly delivered target controls and tests survive. Overlapping authorized implementation files are recorded in the new run's `accepted-revision.json` for ordinary repair and final review. The old plan and named check identities remain. Fresh named proofs and the existing independent acceptance-coverage review approve the actual complete combined inventory before freezing, consuming the original acceptance counter. A failed or interrupted review cannot manufacture acceptance. Implementation or repair, fresh complete integrated verification, independent source review and native integration still run normally. Historical checkpoints, authority, reports and spent usage remain immutable; this is not evidence reuse for revised bytes.
