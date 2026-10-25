# Repository map

This is a local autonomous development workbench with a reproducible verifier, a persistent serial queue, independent agent review, and verified local integration. Application metadata and controller evidence have separate owners.

## Commands

- Bootstrap: `npm run setup`.
- Development: `npm run dev`.
- Instance identity: `npm run doctor`.
- Complete verification: `npm run verify`.
- Frozen owner maintenance verification: `npm run factory -- verify-maintenance <request.json>`.
- Bounded owner continuation: `npm run factory -- owner-resume <request.json> [--validate]`.
- Validate a task: `npm run factory -- tickets/001-labels.json --validate`.
- Execute a bounded task: `npm run factory -- tickets/001-labels.json`.
- Execute and integrate into an enrolled clean target: `npm run factory -- tickets/001-labels.json --merge main`.
- Process one queued job: `npm run worker -- --once`.
- Execute one explicitly authorized maintenance job: `npm run worker -- --once --owner-authorization /absolute/authorization.json` (same exclusive queue lease).
- Discover the conversation intake target: `npm run submit-plan -- --list`.
- Submit an entire conversation plan: `npm run submit-plan -- <plan.json>`.
- Read submitted work: `npm run submit-plan -- --status <submission-id>`.
- Reset disposable demo data: stop the app, then `npm run reset -- --confirm`.

## Boundaries

- `src/domain.ts` owns validation and issue types. It does not import HTTP, storage, or browser code.
- `src/storage.ts` owns parameterized SQLite operations.
- `src/workflow.ts` owns pure workbench types and validation; `src/workflow-store.ts` owns transactional metadata, admission, and claims.
- `src/submission.ts` owns the shared pure decomposition and conversation-submission contract. `scripts/submit-plan.ts` owns the pinned local API client.
- `src/api.ts` owns HTTP translation and error responses.
- `src/server.ts` owns process startup, loopback binding, and database ownership.
- `src/ui/` owns browser behavior. It may import domain types; it must not import the server or storage.
- `tests/` owns deterministic Node, API, storage, process and controller checks. Browser acceptance is retired under the owner-authorized code-only contract.
- `scripts/` owns repeatable operating procedures.
- `factory/runner.ts` owns the single orchestration path; `stages.ts` owns typed proof-gated progress, `agent-session.ts` role invocation, `scope-guard.ts` frozen scope, and `profiles.ts` explicit maintenance authority and pinned supervisors. `controller.ts` preserves compatibility exports.
- `factory/verifier.ts` and `evidence.ts` own trusted verification and common machine-proof admission. Application code must not import `factory/`.

## Minimum necessary implementation

- Apply the same minimum-necessary standard to product code, tests and fixtures. Every added capability, optional API, state, abstraction, dependency or helper needs the current requirement, an actual caller or an existing documented contract. Do not add unused modes or extension points for hypothetical future needs.
- Preserve necessary validation, error handling, accessibility, security and accepted quality obligations. Minimal means the simplest maintainable implementation of the current contract, not the fewest lines or deletion of an untriggered safeguard.
- New permanent defect checks require a confirmed significant OR recurring project defect and worthwhile deterministic prevention that outweighs authoring, maintenance and execution cost. Minor one-off findings may use existing meaningful coverage plus repair and independent review with `needsRegression: false`. New business behavior still needs meaningful acceptance; significant harness safety changes retain targeted regressions. Record the judgment in existing plan defaults and review/coverage summaries, without another role, registry, schema or gate.
- Reuse meaningful existing checks and helpers. Keep fixtures and mocks limited to necessary data and external boundaries; do not add or expand framework/browser reimplementations or introduce private framework API use for tests. Record retained existing fixture limitations without turning a scoped cleanup into an unrelated framework migration.
- Existing planning, test authoring, coverage review and final code review assess this necessity inside the changed scope. Explain real tradeoffs in existing defaults or review summaries; add no role, gate or report schema for this rule.

## Workflow

Whole-task scope never grants phase-local write permission. Planning is read-only and must allocate test authoring to the tests phase and requested documentation to implementation after independent inventory approval and freeze. Tests and regression-tests write only authorized files under `tests/` or `acceptance/`; they never write documentation, AGENTS.md, product code or controls, even when owner scope includes them. Put rationale and prose summaries in the structured report. Harness tests and regression-tests add new scoped files only; only explicitly authorized acceptance-contract test authoring may revise existing tests or fixtures before approval. Implementation and repair preserve every frozen test byte. ScopeGuard and the pinned supervisor remain authoritative.

1. Inspect the relevant code and documentation.
2. Inspect equivalent implementations and shared components. If standards conflict, select one reasonable uniform repository standard and record its rationale before implementation and checks. Enforce that standard consistently through lint, types, relevant Node tests and independent review. Select meaningful existing coverage; add a failing behavior check only for a coverage gap. New checks need owner red proofs and independent coverage review before implementation. Tool migrations additionally inspect affected fixture paths, commands, reports and check identities, with focused setup/baseline execution and actual named assertion proofs before freezing; setup failure is not a behavior proof. Harness changes retain targeted deterministic regression checks.
3. Implement the smallest change and run related named checks. Await each check and owned-process cleanup before editing the same source, tests, configuration or executing engine. To edit sooner, cancel the owned check and wait for it to settle. Source/input drift invalidates its proof and does not establish a product defect. An adaptive integrated task runs one fresh complete verifier on the final integrated source; diagnostics alone cannot authorize delivery.
4. Run `npm run verify` on the final candidate or integrated tree. Reuse whole-requirement proof only through the exact-source owner certificate rules in `docs/adaptive-execution-contract.md`. Read `.runs/latest.json` and the referenced summary; do not claim success from prose or a screenshot alone.
5. Inspect the diff and use independent review before committing.

The owner-authorized code-only revision retires browser acceptance. Ordinary tasks must not weaken the remaining checks, disable verification steps, or alter required criteria to make a feature pass. Propose changes to the verification contract separately. Stop before publishing a repository, force-pushing, deploying, or operating on non-disposable data without authorization.

## Autonomous execution

- For new product behavior, use `.agents/skills/issue-tracker-submit/SKILL.md` to turn the authorized conversation into a complete submitted plan unless the user explicitly requests direct implementation. Harness/platform engineering and repository maintenance use the normal workflow above.
- Persist one submission ID and the full original goal, source summary, acceptance conditions, defaults, and dependency graph before submitting. The platform independently reviews coverage before releasing implementation jobs. Do not run a second executor against submitted work.
- Submission receipt and worker prose do not prove delivery. Read the platform's current run reports and whole-requirement outcome; HTTP replay must never restart blocked work.
- Ordinary untargeted queue claims may append one successor for a latest cascade-blocked ordinary feature job with no run ID or issue run history, after every existing dependencyReady condition holds. The issue must remain Blocked with unchanged admitted title, description, assignment, dependencies and acceptance; submitted work still needs approval. Preserve old jobs and reasons. Exclude maintenance, closed/done work, completed requirements, active/newer work and genuine attempts. Cross-requirement GitHub dependencies still require confirmed publication. This continuation uses startIssue, serial ownership and the original task budget; attempted work retains explicit recovery.
- Derive independently verifiable slices from the business goal. Prefer one issue for a small cohesive requirement. Map every acceptance ID to meaningful named Node checks. Browser checks are retired; `browserChecks` remains an empty compatibility field.
- Choose reasonable defaults for ordinary implementation details, record each decision and reason, and continue without asking about every detail.
- Ask only when an unresolved choice materially changes the business goal or exceeds the authorized scope.
- Reuse equivalent frozen baseline coverage when sufficient. Invoke tests and independent acceptance coverage review only for new or revised unapproved checks. Include relevant negative cases and boundaries for actual risk; avoid duplicating established controller enforcement in feature tests. Confirm a new check fails because the requested behavior is missing, not because the environment is broken.
- A worker report is a proposal. Only the controller can mark a task ready after verification and independent review.
- The queue may automatically integrate into its explicitly enrolled local target after a fresh full check and independent review of the integrated tree. Worker agents must not commit or merge. Completion requires a recorded verified merge; human sampling is not a gate.
- Whole-requirement verification must prove the original business goal after all child merges. Dependency readiness requires merge evidence, not manually edited status.
- Keep the controller-owned verification contract and existing required tests intact. New criteria become a separately reviewed contract revision.
- Keep additive business checks with their feature issue and review them before implementation. Track acceptance-contract and harness changes as separate maintenance issues, with explicit dependencies and independent deliveries. Version-two plans may declare `changeKind`; declarations never grant scope or approval.
- Ordinary classification cannot authorize maintenance or protected writes. The owner maintenance workflow validates explicit issue/base/engine/contract/scope authority before native claim and executes the same runner under a pinned pre-change supervisor. Settle the same serial queue lease before owner dispatch. Activate revised controls only after full verification, independent source-bound review, verified integration and quiescent handoff.
- Native authorized maintenance records actual claim-to-completion evidence through the queue. The owner recorder remains compatible with previously verified and integrated owner work; its receipt time is not historical engineering time. Never mark an issue Done from labels, worker prose, or fabricated receipts.
- Record assumptions, changes, run IDs, exact evidence paths, and unresolved blockers. Never reuse a passing report for changed code.
- Write documentation, harness instructions, schemas, prompts, and reports in English.
- Code comments and inline lint overrides are prohibited by the existing lint contract. Put design explanations in documentation.

## Context

- Architecture: `docs/architecture.md`.
- Driving and proving the app: `docs/verification.md`.
- Next exercise: `docs/exercises.md`.
- Automation boundary: `factory/README.md`.
- Repository enrollment, queue operation, reports, and recovery: `docs/workbench.md`.
- Codex conversation intake and versioned plan format: `docs/conversation-intake.md`.

Give every parallel worker its own worktree, ports, and database. Do not install, launch or request Playwright/browser acceptance checks in the current code-only profile. Never kill processes by name. Keep evidence after cleanup.

For review purpose, checkpoint reuse, cumulative budgets, and ownership recovery, follow `docs/harness-reliability.md`. Ordinary integration uses one final independent code review after full integrated verification; whole-requirement acceptance remains required. Tests are independently reviewed after owner red proofs and frozen before implementation. Every retry must retain ownership lineage and cannot reset its issue budget.

When independent code review confirms a significant OR recurring defect missing deterministic coverage, request regression tests before repair only when deterministic prevention outweighs authoring, maintenance and execution cost. Minor one-off uncovered findings use ordinary repair, existing meaningful coverage and independent review with needsRegression false. The tests role adds new scoped test files only; controller-owned red proofs and independent acceptance review precede freezing and repair. Existing files, accepted assertions, roles, full verification gates, and cumulative retry budgets remain protected. See `docs/harness-reliability.md` for the pending and accepted checkpoint rules.

For explicitly GitHub-enrolled requirements, child integration targets the reserved requirement branch. Whole-goal acceptance precedes publication; completion requires a confirmed GitHub PR merge, exact-head CI evidence and local target synchronization. Publication is controller-owned and `.github/` verification controls remain protected. Never force-push or bypass GitHub checks/reviews. Existing local-only requirements and standalone issues retain their enrolled local target. Follow `docs/github-delivery.md` for owner enrollment and recovery.

Adaptive execution is enabled only by controller-owned `factory/execution-policy.json`; missing policy and version-one tasks keep legacy behavior. Baseline reuse records real named proofs and a distinct owner receipt, always invokes implementation, and cannot change frozen tests. Keep a fresh complete integrated verifier and independent final source review. Same-requirement evidence reuse additionally binds exact target/source/runtime/engine/contract/reports; sole-child whole-goal review reuse requires an explicit exact-goal receipt. Only positively identified settled spawn resource faults permit one persistent budgeted verification retry. Read `docs/adaptive-execution-contract.md` and `docs/loop-optimization.md`.

Owner harness maintenance uses `docs/owner-workflow.md` and `docs/execution-kernel.md`: freeze independently approved complete test inventory before implementation; finish focused diagnostics before one final frozen full verifier. Explicit acceptance-contract revisions may retire checks only under independently approved equivalent coverage; freeze the exact remaining inventory. Use the existing owner-resume command for explicit 0/0 continuation within remaining original capacity or an explicit idempotent positive budget grant and native selected-job continuation; maintenance retains its original owner authorization. Never copy the controller loop or edit canonical task limits. `run-state.json` is typed active progress; `state.json` remains its detailed compatibility projection.

The current complete verifier has four mandatory gates: lint, typecheck, all Node tests, and production build. CI has the same four gates with its approved critical Node selection. Final source, runtime, controls, reports and independent approval remain bound together. Browser appearance and interaction are not established by this profile; do not claim otherwise. See `docs/code-only-verification.md`.

Harness plan/tests instructions require NEW scoped test files only; never append to or revise an existing test or helper. Select baseline checks unchanged. Only explicitly authorized acceptance-contract authoring may revise existing tests before independent approval; every frozen test byte remains immutable. Focused-failure triage assesses the actual authorized task contract, including scoped harness source compatibility defects. Approved source repair preserves accepted diagnostics; uncertain causes and actual test-contract faults remain blocked for proper maintenance.
