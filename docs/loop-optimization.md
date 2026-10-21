# Serial loop optimization

The optimization has four parts: coverage-preserving consolidation, adaptive execution, source-bound handoffs and bounded recovery, and whole-requirement proof reuse with observable costs. The controller-owned `factory/execution-policy.json` enables `adaptive-v2` only after owner integration. Removing it restores legacy queue routing; explicit version-one tasks and their checkpoint semantics remain supported. Unknown policy fails closed. Submission format versions and task execution versions are separate contracts.

## Test content and new checks

[Consolidation mapping](test-consolidation.md) records each removed duplicate or brittle assertion and its retained proof. Critical CI and the full required-case manifest remain intact. New feature checks belong with their feature issue; contract changes and harness changes retain separate maintenance ownership. Choose the cheapest layer that observes the behavior: pure validation in Node, persistence/API behavior in Node integration, browser interaction in Playwright. Add a check for a missing behavior or an uncovered reproducible defect, not because a code file changed. Harness changes still require targeted safety regressions.

A small requirement normally has one issue. Version-two controller plans declare `coverage: { mode: "reuse" | "extend", reason }`. Each acceptance ID needs a named check, using Node, browser, or both. Browser entries include `acceptanceIds`; Node checks cover their slice's IDs. Reject empty coverage, unknown IDs, unsafe paths and duplicate identities.

## Execution paths

| Stage | Existing coverage (`reuse`) | Coverage gap (`extend`) |
| --- | --- | --- |
| Plan | Select existing named checks and explain relevance. | Select existing checks and the minimum missing cases. |
| Admission | Owner executes named baseline proofs and freezes the entire existing test/helper inventory. | Tests role adds missing checks; owner proves expected failures; independent acceptance review approves before freezing. |
| Implement | Always invoke implementation, even when old checks pass. | Implement against frozen accepted checks. |
| Diagnose | Run selected named checks. Diagnostics never authorize completion. | Same. |
| Integrate | Apply to latest enrolled target; run one fresh full verifier and final independent code review. | Same. |
| Review finding | Use ordinary repair for existing failing coverage; add scoped regression tests and independent acceptance review for an uncovered reproducible defect. | Same. |

A delivery-only task still runs full candidate verification and independent review. Target movement requires new integrated verification/review. Frozen files, control-plane ownership, serial claims, source checks, budgets and process cleanup apply to both paths. A baseline reuse receipt uses purpose `baseline-coverage-reuse`; it does not pretend an independent acceptance agent ran. Final review must assess the goal and coverage relevance, not merely passing old tests.

## Handoffs and recovery

Every adaptive invocation receives `context-index.json` and complete `context-feedback.txt`, bound by byte counts, SHA-256 and source hash. The index references the original task/whole goal, acceptance, plan/defaults, relevant paths and actual owner reports. Large feedback is referenced in full instead of repeatedly copied into the prompt. Independent reviewers retain source and full evidence access. Sessions remain ephemeral; this change does not claim persistent model memory.

Named proof failures, verifier summaries, original outputs and diagnoses remain in the run. A settled real Node assertion is recorded as product feedback. Successful process execution with missing or invalid required reports is a test-contract failure and stops for owner maintenance. Unknown timeouts are not assumed to be infrastructure. Only an actual settled spawn resource failure (`EAGAIN` or `ENFILE`) can consume one separately persisted infrastructure retry. A retry keeps identical source/environment/contract and the same cumulative time budget; it writes a new report directory and retains the first failure. Assertions and missing/malformed reports do not receive this shortcut. Accepted checkpoints preserve planning, exact tests, proofs, lineage and used implementation attempts; invalid identities restart from an untouched baseline without resetting the ledger.

## Requirement completion

Before each adaptive full verification, the controller fingerprints the actual installed inputs and records `verification-input.json` with the before/after identities and actual summary hash. It requires unchanged inputs through final review and certificate capture. Only generated root `node_modules/.vite`, `.vite-temp` and `.cache` directories are excluded; installed package sources, binaries, metadata and nested package caches remain bound. Missing or changed stamps cannot authorize reuse.

After a child merge, the owner may issue `integrated-verification-certificate.json`, binding the actual complete machine reports, named-case contract, integrated review, committed source, target and runtime/dependencies/engine. The requirement job can reuse this evidence only for an unchanged exact target and its actual merged child. A mismatch runs fresh verification. Copied reports preserve their original bytes, run ID and timestamps; `verification-reuse.json` identifies their provenance. This is same-requirement reuse, not a global cache.

For the sole immutable child, the final integrated reviewer can explicitly approve `integrated-code-and-whole-goal`, bound to the exact requirement ID, original goal and child's acceptance identity. Only that approval can replace an additional whole-goal review. Multiple children, a changed goal or generic code approval still require independent whole-goal judgment. GitHub publication retains exact-head CI, protected merge and local synchronization.

## Measure actual costs

`delivery.json` and `delivery.md` expose `execution` and `efficiency`: route/reason, actual agent and authoring invocation counts, full verifier executions/retries/reuses, elapsed time and phase durations. Whole-requirement reuse reports count no new verifier execution and retain the original run separately. Failed attempts are evidence, never silently converted to success.

Deterministic controller fixtures execute the real small Node/Playwright verifier and validate route, immutable inventory, one final full run, goal review, checkpoint recovery and tamper rejection. These prove orchestration. They do not measure model latency or promise a fixed end-to-end task duration. Compare future real runs using these owner-generated metrics before making further changes.
