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

1. **Prepare:** create a detached worktree, snapshot source and its baseline Git tree, allocate distinct loopback ports, and assign a disposable database.
2. **Plan:** a read-only session records ordinary defaults and maps every acceptance ID to named Node checks and required browser cases.
3. **Checks:** a worker adds missing scoped tests without changing implementation or any original test bytes. A fresh read-only session reviews their coverage. Rejected new checks receive the findings and may be repaired up to the task's `maxAttempts`, within the same total deadline. Each revision requires fresh review; exhaustion blocks implementation. The controller freezes file hashes only after approval. Numbered `test-report-*.json` and `acceptance-review-*.json` retain every decision alongside the latest report.
4. **Red proof:** execute each named Node check. Require an assertion failure for missing behavior, or an actual named pass when already satisfied. Imports, environment failures, skipped tests, and absent names do not qualify.
5. **Implement and verify:** a worker implements scoped slices. The owner runs a copied trusted verifier against the candidate, reads machine reports, and checks protected files and source identity.
6. **Review or repair:** a fresh read-only session reviews the candidate and verification receipt. Failures feed a repair session within the attempt/time budget. Protected-file edits or invalid orchestration responses block the task immediately.
7. **Integrate when enabled:** apply the patch to the latest target in a separate worktree, run full owner verification and fresh independent review, record the verified tree/commit, and fast-forward the local target. Rebuild and revalidate when the target moves; never overwrite a dirty checkout.
8. **Deliver:** write `ready` for a delivery-only candidate, `merged` for a proven local integration, or `blocked` with the actual reason. Generate `delivery.json` and `delivery.md` from owner records in every case. A worker's completion statement cannot establish readiness.

`AGENTS.md` supplies persistent agent conventions; `agent.ts` supplies phase-specific English prompts; runtime contracts and controller checks enforce the executable parts. A prose instruction alone cannot guarantee that a required check ran.

Conversation-origin plans use the shared `src/submission.ts` runtime contract and `scripts/submit-plan.ts` client. Intake atomically preserves the submitted original goal, source, issue graph, and plan hash. Its `plan_review` job obtains independent coverage approval against exact target source before releasing existing child IDs. It does not invoke decomposition again. `startIssue` cannot bypass unapproved plan admission; HTTP retries only return existing work. See [conversation intake](../docs/conversation-intake.md).

## Maintenance ownership

Feature code and additive checks share one issue, with checks independently reviewed and frozen before implementation. Acceptance-contract and harness changes use separate issues and dependencies. Version-two plans declare `changeKind` as `feature`, `acceptance_contract`, or `harness`; version-one plans retain their exact canonical representation.

Declarations are descriptive. The ordinary queue cannot claim `maintenance` jobs. Protected control-plane source includes workflow admission, submission validation, evidence access, instance ownership, and target identity. Labels and submitted metadata never expand feature scope. Maintenance uses the owner inspect, red-proof, implement, full-verification, independent-review, and verified local integration workflow. The maintenance tickets are audit records, not inputs granting feature-executor scope. Pin the run's verifier identity and explicitly review contract revisions; activate revised controls only for later runs.

After the independently reviewed commit is on the enrolled target, record its delivery with actual machine reports and a review receipt containing `approved`, an empty `findings` array, and matching `sourceHash` or `reviewedSourceHash`:

```sh
node --import tsx scripts/record-maintenance.ts --database <platform.sqlite> --issue <id> --commit <exact-sha> --verification <summary.json> --review <review.json>
```

The recorder validates committed hashes, required cases, gate results, executed counts, review identity, dependencies, and target ancestry before claiming work. It retains evidence and generates a standard indexed delivery. There is no HTTP attestation endpoint. This is a cooperative local ownership protocol, not hostile-worker isolation.

## Ownership and evidence

`.data/evidence/<task-id>-<uuid>/` is outside the worker checkout. Queue jobs use their durable run UUID under the application database's evidence directory. It contains `task.json`, `plan.json`, `baseline.json`, `accepted-checks.json`, `state.json`, per-phase prompts/schemas/output/process receipts, red-check reports, verifier logs/reports, and the final patch. `state.json` is updated atomically and records phases, attempt IDs, workspace, ports, source identity, review decisions, and failure reasons.

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

The local application is the authoritative requirement and issue source. `queue.ts` owns serial dispatch, dependency order, final requirement verification, and outcome indexing. `planner.ts` supplies read-only decomposition/review sessions with bounded structured-response repair. `integration.ts` owns serialized verified local merges, `delivery.ts` generates reports, and `recovery.ts` reconciles proven merges after interruption. There is no GitHub polling, remote publishing, credential broker, hostile-worker isolation, parallel queue, or statistical evidence across many model runs. `tickets/` remains a portable CLI snapshot format.

Owner review receipts must include `coveredIssues: [{ issueId, contractHash }]`, using `maintenanceIdentity(issue)` for the exact title, goal, work assignment, and acceptance contract. A generic source approval cannot complete unrelated work.
