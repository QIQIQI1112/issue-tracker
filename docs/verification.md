# Verification contract

The current owner-authorized [code-only contract](code-only-verification.md) retires Playwright/browser checking. Run `npm run verify` from the repository root. It executes lint, TypeScript checking, all Node tests and the production build in sequence. Any failed or timed-out gate exits nonzero. Read `.runs/latest.json` and its referenced `summary.json`; terminal prose is insufficient evidence.

GitHub runs `npm run verify:ci`, the separately reviewed [critical Node profile](ci-critical.md), and records `.runs/ci-latest.json`. Local final integration still requires the complete Node suite. Browser rendering and interaction are outside this profile.

## Coverage and source standards

Select existing meaningful named checks by changed behavior. Add deterministic coverage for a real gap or confirmed defect, using Node computations, real API/storage integration or owned process outcomes. Inspect equivalent functionality and select one reasonable uniform repository/component standard before enforcing implementation consistency. Record the decision and rationale; explicit structure conventions are valid. Avoid mechanical source snapshots and unrecorded test preferences.

Every acceptance ID maps to named Node checks. Plans and regression reports use `browserChecks: []`; nonempty browser obligations are rejected. New checks need actual owner assertion proofs and independent coverage approval before freezing. Imports, setup failures, missing names and timeouts are not behavior proofs. Baseline reuse freezes real existing named checks through a distinct owner receipt. Harness changes retain focused deterministic safety regressions. Independent source review confirms applicability to the actual change.

## Complete verification and reuse

The active full manifest is schema version 2, `profile: "code-only"`, nonempty `requiredNodeTests`, and empty `requiredBrowserTests`. Four distinct gates must pass: lint, typecheck, test and build. The real Node report must have complete passing counts, zero failed/cancelled/skipped/todo cases and every required exact file/title. Code and contract bytes must remain unchanged through the run. No browser report or browser installation is required.

Full admission and initial/focused named proofs share the Node report interpretation in `factory/evidence.ts`. Genuine suite containers are excluded from case counts and cannot satisfy a required leaf identity. The complete summary must agree with the actual case outcomes. Named proof additionally requires one exact file/title leaf and a settled matching process outcome; assertion red must come from that leaf's assertion error or its cause. Missing, inconsistent, ambiguous or unrelated evidence is a verification failure and cannot authorize product repair. Rejected named proofs retain the established "named behavior assertion" diagnostic envelope alongside the detailed verification cause for compatibility with existing admission checks. The nested-suite regressions use real Node subprocesses; their existing disposable orchestration fixture uses no-op quality commands and does not establish candidate source quality.

Adaptive integrated tasks run focused diagnostics before one fresh complete integrated verifier and independent source review. Diagnostic checks cannot authorize delivery. Legacy tasks retain their existing candidate/integration ordering using the same current four-gate profile. Whole-requirement verification may reuse source-bound v2 code-only proof only when exact target, source, runtime, dependencies, controls, parsed contract, actual reports and independent approval still match. Original report IDs and timestamps remain unchanged. Otherwise verify afresh. Sole-child combined original-goal review reuse remains explicitly bound; multi-child original-goal review remains required.

## Budgets and ownership

| Variable | Default | Meaning |
| --- | --- | --- |
| `VERIFY_STEP_TIMEOUT_MS` | `300000` | Maximum time for an individual full gate. |
| `VERIFY_TOTAL_TIMEOUT_MS` | `600000` | Total gate budget. |
| `VERIFY_GRACE_MS` | `6000` | TERM-to-KILL grace for an owned process group. |
| `VERIFY_RUN_DIR` | Unique `.runs/verify-*` | Must be new; prevents stale report reuse. |
| `VERIFY_CONTRACT_PATH` | `factory/verification-contract.json` | Owner-selected named Node requirements. |
| `NODE_TEST_TIMEOUT_MS` | `180000` | Node test subprocess budget. |

Budgets are positive integer milliseconds. Keep exact PID/process-group receipts and settle owned groups before cleanup. Never kill processes by name or run on a user's live data for tests. Independent isolated worktrees, loopback ports and disposable databases remain required where applicable. Preserve failed reports and cumulative retry history. See [owner maintenance](owner-workflow.md) and [review/recovery](harness-reliability.md).

## Evidence

Full summaries identify `profile: "code-only"` and list actual gate statuses/durations, source hashes, commit/dirty state and Node counts. CI summaries identify `profile: "ci-critical"` and `verificationProfile: "code-only"`. Keep Node JSONL, logs, process receipts, exact contracts, independent receipts and integration records. Missing or malformed evidence cannot pass. Task, whole-goal, frozen owner and compatibility attestation routes use the shared trusted verifier preparation and typed `completeVerification` admission. Each route retains its own ownership, target, contract and review guards; shared parsing does not grant authority. Existing historical browser artifacts remain readable and are never relabeled as current execution.
