# Autonomous task controller and serial queue

This local controller reads a frozen business contract, starts fresh Codex sessions, runs owner verification, requests bounded repairs, and obtains independent review. Direct CLI runs return a patch by default. Enrolled queue jobs automatically verify and review the integrated tree before advancing a local target. Human audit is optional. See [the workbench](../docs/workbench.md) for enrollment and operation.

## Run one task

Use Node 24+, a Unix host with process groups and ps, installed project dependencies, and an authenticated Codex CLI. The adapter uses `codex exec` with JSON events and a structured output schema. `FACTORY_CODEX_BIN` can specify the executable when `codex` is not on PATH. It retains the CLI's configured model; no model is selected by the harness. See official [noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode) documentation.

```sh
npm run factory -- tickets/001-labels.json --validate
npm run factory -- tickets/001-labels.json
```

Validation does not launch a worker. Delivery-only execution includes current working files, including uncommitted changes, in a detached owned worktree. Queue execution and `--merge <branch>` require a clean repository and start from the exact target tree. They do not copy the current checkout's different harness into that baseline. To start application code at a particular Git revision while retaining the current protected harness and required checks:

```sh
npm run factory -- tickets/001-labels.json --base <commit-or-ref>
```

The baseline may already satisfy the task. Named checks then record `already_passed`; full verification and review are still required. The controller does not invent a new change just to produce a patch. Starting from an older revision requires compatible tests and runnable missing-behavior assertions; import or setup failures do not count as a useful red check.

## Task contract and phases

`contracts.ts` validates versioned tasks, plans, worker reports, and review responses at runtime. A task contains a business goal, acceptance IDs, approved file scope, a pinned verification command, and budgets. The labels ticket allows three implementation attempts, five minutes per agent phase, and thirty minutes total. General contracts allow one to five attempts, at most ten minutes per agent phase, and at most one hour total.

The following numbered phases describe legacy version-one execution. The adaptive profile below changes which stages run, while preserving the final full verification and approval responsibilities.

1. **Prepare:** create a detached worktree, snapshot source and its baseline Git tree, allocate distinct loopback ports, and assign a disposable database.
2. **Plan:** a read-only session records ordinary defaults and maps every acceptance ID to named Node checks and required browser cases.
3. **Checks and red proofs:** a worker adds missing scoped tests without changing implementation or any original test bytes. The controller executes each named Node check and planned browser check in a new or changed spec. Require an assertion failure for missing behavior, or an actual named pass when already satisfied. Imports, setup failures, skips, retries, missing names and timeouts do not establish useful proofs.
4. **Acceptance review and freeze:** a fresh read-only session reviews coverage, assertions and actual owner proofs. Rejected unapproved checks receive findings and can be repaired within the existing acceptance and time budgets. Every revision needs fresh owner proofs and independent review. Freeze hashes only after approval; exhaustion blocks implementation. Numbered test reports and acceptance reviews retain every decision. Unchanged baseline browser specs still run during complete verification.
5. **Implement and verify:** a worker implements scoped slices. The owner runs a copied trusted verifier against the candidate, reads machine reports, and checks protected files and source identity.
6. **Select the final review context:** delivery-only runs receive an independent candidate code review after full verification. Integrated runs proceed to the latest target for their authoritative code review. Verification failures or review rejections feed bounded repair; accepted checks and criteria remain frozen. Malformed review responses get only the existing bounded format correction, and integrity/ownership failures block.
7. **Integrate when enabled:** apply the patch to the latest target in a separate worktree, run full owner verification and one final independent code review of that integrated source, record the verified tree/commit, and fast-forward the local target. A passing candidate verifier does not replace integrated verification. Rebuild and revalidate when the target moves; never overwrite a dirty checkout.
8. **Deliver:** write `ready` for a delivery-only candidate, `merged` for a proven local integration, or `blocked` with the actual reason. Generate `delivery.json` and `delivery.md` from owner records in every case. A worker's completion statement cannot establish readiness.

### Adaptive version two

The queue reads the owner-controlled `factory/execution-policy.json`: `{ "schemaVersion": 1, "mode": "adaptive-v2" }` enables version-two tasks, missing policy retains `legacy-v1`, and malformed policy blocks. Conversation-plan schema version two remains a separate classification contract. Neither a worker nor a submission can grant itself this route or additional write permissions.

Planning identifies changed behavior, impact and named existing coverage. Every acceptance ID needs meaningful executable coverage in Node/API checks, browser checks or both. In `coverage.mode: reuse`, the controller resolves existing checks, records a distinct bound baseline receipt and freezes their complete inventory. It does not launch tests authoring or a new-test acceptance reviewer; final independent code review must confirm coverage of the actual change. In `extend`, the existing tests role, owner red proofs, independent acceptance review and freeze remain mandatory.

Development executes related named checks for early feedback. An integrated adaptive task runs one fresh complete verifier and independent code review on the final combined target candidate before advancing the branch. Focused passes never authorize delivery. Direct delivery-only tasks still require fresh full candidate verification and independent code review; legacy tasks keep both candidate and integrated full runs.

Small cohesive requirements default to one issue. Existing tests can be reused without creating work solely to add tests. Ordinary features do not duplicate unchanged controller enforcement; changes to harness invariants still require scoped deterministic regressions and owner maintenance.

After integration, the owner may capture `integrated-verification-certificate.json`. Whole-requirement acceptance can reuse only the latest owned child report matching the exact target/source, running engine/runtime, dependency installation, controls, effective required-check contract and unchanged actual summary/Node/browser/review artifacts. Missing or changed inputs cause fresh verification. Exact sole-child original-goal combined approval can also satisfy whole-goal review; other requirements receive fresh independent goal review. The durable whole-goal job always remains, and provenance preserves original report bytes, run IDs and timestamps. GitHub publication and CI rules remain unchanged.

`AGENTS.md` supplies persistent agent conventions; `agent.ts` supplies phase-specific English prompts; runtime contracts and controller checks enforce the executable parts. A prose instruction alone cannot guarantee that a required check ran.

Conversation-origin plans use the shared `src/submission.ts` runtime contract and `scripts/submit-plan.ts` client. Intake atomically preserves the submitted original goal, source, issue graph, and plan hash. Its `plan_review` job obtains independent coverage approval against exact target source before releasing existing child IDs. It does not invoke decomposition again. `startIssue` cannot bypass unapproved plan admission; HTTP retries only return existing work. See [conversation intake](../docs/conversation-intake.md).

## Maintenance ownership

Feature code and necessary additive checks share one issue, with new checks independently reviewed and frozen before implementation. Reused baseline checks have a distinct owner receipt and unchanged frozen inventory; this does not permit a worker to approve a coverage extension. Acceptance-contract and harness changes use separate issues and dependencies. Version-two plans declare `changeKind` as `feature`, `acceptance_contract`, or `harness`; version-one plans retain their exact canonical representation.

Declarations are descriptive. The ordinary queue cannot claim `maintenance` jobs. Protected control-plane source includes workflow admission, submission validation, evidence access, instance ownership, and target identity. Labels and submitted metadata never expand feature scope. Maintenance uses the owner inspect, red-proof, implement, full-verification, independent-review, and verified local integration workflow. The maintenance tickets are audit records, not inputs granting feature-executor scope. Pin the run's verifier identity and explicitly review contract revisions; activate revised controls only for later runs.

After the independently reviewed commit is on the enrolled target, record its delivery with actual machine reports and a review receipt containing `approved`, an empty `findings` array, and matching `sourceHash` or `reviewedSourceHash`:

```sh
node --import tsx scripts/record-maintenance.ts --database <platform.sqlite> --issue <id> --commit <exact-sha> --verification <summary.json> --review <review.json>
```

The recorder validates committed hashes, required cases, gate results, executed counts, review identity, dependencies, and target ancestry before claiming work. It retains evidence and generates a standard indexed delivery. There is no HTTP attestation endpoint. This is a cooperative local ownership protocol, not hostile-worker isolation.

## Ownership and evidence

`.data/evidence/<task-id>-<uuid>/` is outside the worker checkout. Queue jobs use their durable run UUID under the application database's evidence directory. It contains `task.json`, `plan.json`, `baseline.json`, `accepted-checks.json`, `state.json`, per-phase prompts/schemas/output/process receipts, red-check reports, verifier logs/reports, and the final patch. `state.json` is updated atomically and records phases, attempt IDs, workspace, ports, source identity, review decisions, and failure reasons. `context-index.json` references complete raw role feedback and owner evidence with byte counts and hashes. Optional execution/efficiency fields record actual route, agent/test-authoring calls, verification executions/retries/reuses and durations; deterministic adapter timings do not measure real model latency.

Harness files, configuration, and task snapshots are protected. The checks phase may append scoped tests while preserving every original byte; a fresh review approves the extension. All initial and newly reviewed tests are frozen before implementation. Only scoped product files and newly approved tests/docs may change. The verifier and required-case manifest are copied outside the worker checkout. Candidate hashes must still match after verification and read-only review. Before patch capture, the owner reconciles every verified source file into the disposable index. The final patch is compared against an immutable Git tree so staging or resetting the index cannot hide changes or delete unchanged baseline additions.

Codex uses `read-only` for planning/review and `workspace-write` for test/implementation phases, with approval policy `never`. The owner passes a small environment allowlist and assigned ports/database. Each CLI session is ephemeral; process groups have explicit budgets, output limits, cancellation, and TERM/KILL cleanup. Before termination, the owner records descendant process groups from the OS process tree and signals those exact groups directly. Nested runners also relay termination with smaller grace windows; process receipts retain the spawned PID. Worker sandboxes may refuse loopback binding. Workers record those verification limitations in their summaries; the owner executes the full HTTP/browser suite outside the worker sandbox. Product or task blockers still stop delivery. Workers must stop all processes they start before returning. No live browser profile or non-disposable data is used.

## Inspect and clean up

Read `state.json`, its verification `summary.json`, and its review response before accepting a result. CLI exit zero means `ready` or `merged`; exit nonzero means validation or execution was blocked. Delivery-only patches require a separate integration action against their baseline. Enrolled jobs integrate automatically using fresh verification and review; inspect the standard delivery report, integration receipt, and evidence for retrospective audit.

Keep the workspace while reviewing it. When finished, remove only the exact owned worktree path recorded in state:

```sh
git worktree remove --force <owned-workspace-path>
```

This deletes that disposable checkout and its local candidate; preserve `patch.diff` first. Other run artifacts remain. Do not remove a user checkout or use process-name-wide cleanup.

## What the prototype proves

The completed [live integration pilot](../docs/controller-pilot.md) records real Codex phase execution, red assertions, owner verification, independent review, and a ready patch.

`tests/controller.test.ts` uses deterministic worker adapters and actual isolated Node/Playwright reports to prove pass, staged patch capture, an index reset with uncommitted baseline additions, omitted planned Node cases, repair, exhaustion, protected-file rejection, review rejection, read-only mutation rejection, and timeout decisions. `tests/agent.test.ts` uses a fake executable to prove CLI arguments, context delivery, structured response handling, and owned hung-worker cleanup. These fixtures prove orchestration, not model performance or application browser behavior. The application's acceptance suite supplies the latter.

This is an ownership protocol for cooperative local workers, not a security boundary against hostile code. Dependencies are shared through a symlink; the Git object store and host account are shared. File hashes detect changes at checkpoints but cannot prevent changing and restoring a file between them. A process that detaches and reparents before ownership inspection can still escape cleanup. Strong isolation needs separate dependencies and credentials, containers/OS boundaries, and an independently protected execution service.

The local application is the authoritative requirement and issue source. `queue.ts` owns serial dispatch, dependency order, whole-requirement verification, outcome indexing and bounded publication jobs. `planner.ts` supplies read-only decomposition/review sessions with bounded structured-response repair. `integration.ts` owns serialized verified local merges, `delivery.ts` generates reports, `recovery.ts` reconciles proven merges after interruption, and `github.ts` owns explicitly enrolled GitHub PR publication and CI observation. There is no credential broker, hostile-worker isolation, parallel development queue, or statistical evidence across many model runs. `tickets/` remains a portable CLI snapshot format.

Owner review receipts must include `coveredIssues: [{ issueId, contractHash }]`, using `maintenanceIdentity(issue)` for the exact title, goal, work assignment, and acceptance contract. A generic source approval cannot complete unrelated work.

## Durable retry checkpoints

The controller owns `checkpoint.json` and `checkpoint.patch` outside disposable worktrees. The binary patch includes added files. Accepted checkpoints bind the goal, criteria, scope, budget, original controls/checks, runtime and active harness, accepted test bytes, plan, review receipt, and named red-proof files. Partial work is saved only after scope enforcement. Queue recovery can capture a quiescent interrupted draft before deleting its worktree. A damaged patch or proof, changed contract/control/runtime, or changed goal invalidates reuse and records the reason. Unapproved test drafts remain evidence; they cannot authorize implementation. Every resumed candidate receives fresh full verification and code review.

For supported direct delivery-only runs, the immutable `baselineTree` can contain original uncommitted files absent from `baseCommit`. Retry first reconstructs that exact baseline tree, then applies the saved delta and validates source and frozen-test hashes. The baseline remains the patch/change-attribution boundary, so unchanged original user work is not delivered as a task change. `resume.reused` becomes true only after successful restoration and inventory enforcement; metadata admission alone cannot claim reuse. Clean-target queue admission remains unchanged.

Runs remain immutable history. A retry gets a new run ID and records its predecessor; the owner selects the safe restart stage from validated evidence, never from a worker-supplied phase string. Automatic merge recovery is checked before any replay. Integration verification or review rejection feeds a bounded repair attempt; source mutation, scope violations, and unsafe ownership remain blockers.

The serial queue uses a durable per-repository/issue budget ledger and an exclusive lease. A positive structured `EAGAIN`/`ENFILE` spawn failure with a matching failed gate and settled cleanup may spend one separate infrastructure retry. That retry preserves source and failed evidence, charges active time and cannot reset or consume a new implementation attempt. Unknown timeouts, output prose, product failures and invalid test contracts do not authorize infrastructure retry. Acceptance and implementation attempt counts and active execution time survive retry. Idle time between finished runs is not charged. A crashed phase conservatively spends its remaining reserved time; it does not reset the budget. Existing live leases block concurrent work. Lease admission is serialized by an atomic guard before stale-owner inspection and acquisition. A stale execution lease can be removed automatically only when its recorded PID no longer exists. A crash during the short admission critical section leaves a guard for explicit owner inspection; never reclaim a guard concurrently. Criteria/budget changes require an owner decision and a distinct authorized task; ordinary HTTP retry cannot reset them.

Subprocess receipts record the exact spawned PID, all discovered owned process groups, process identity, command, and cleanup outcome. Recovery and workspace deletion refuse to proceed while an unsettled owned group or controller is present. The agent must settle after cancellation before draft capture. If it does not cooperate, retain the workspace and record the cleanup blocker for owner inspection. Never kill by process name or infer ownership from a reused PID.

## Purpose-specific review

See `docs/harness-reliability.md` for the current ordered protocol. Owner red proofs precede acceptance review. Ordinary integrated tasks receive one authoritative final code review against the latest verified target; delivery-only tasks retain candidate review. Legacy tasks retain candidate, integrated and whole-goal full runs. Adaptive integrated tasks require a fresh complete final integrated verifier; whole-goal verification may reference that report only after artifact-backed eligibility checks. Independent code and original-goal approval remain required. Source-bound receipts, phase timings, predecessor lineage, cumulative budgets, and invalidation reasons are included in JSON/Markdown deliveries and the issue report UI.

Final controller delivery results and current limitations come from owner outcome/reason records. Implementation summaries are retained in optional `workerObservations`, their original worker JSON and evidence, and an explicitly historical UI/Markdown section. A worker's pending browser check or sandbox restriction is not a current blocker after owner verification succeeds. Queue admission/recovery that changes a proposed delivery to Blocked also replaces its Result with the owner reason. Historical reports without the optional field remain readable and are not rewritten.

Integration cleanup checks both the current controller settlement state and all recorded owned groups before removing its worktree. Both nested cleanup paths fail closed, retain `integration-workspace`, and write `integration-cleanup.json` when safety is unknown. Queue cleanup applies the same quiescence rule to both candidate and integration worktrees. An active controller uses the subprocess-only check; previous-run recovery additionally checks controller ownership and the full predecessor lineage.

GitHub publication for new requirements is optional explicit owner enrollment. The queue derives a requirement branch for child integration, preserves whole-goal verification and independent review, then uses persistent bounded publication jobs to create/reconcile one PR, verify exact-head CI and strict target protection, confirm the remote merge and update the platform. Local-only repositories and standalone issues retain their previous targets. Workers do not publish. `.github/` is protected control-plane source. See [GitHub delivery](../docs/github-delivery.md).
