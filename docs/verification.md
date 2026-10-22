# Verification contract

## Full check and admission

Run `npm run verify` from the repository root. It runs lint, type checks, Node behavior tests, the production build, and Chromium acceptance in sequence. A failed or timed-out gate stops the run with a nonzero exit. Read `.runs/latest.json` and its referenced `summary.json`; terminal prose is insufficient evidence.

GitHub uses `npm run verify:ci`, a separately reviewed [critical profile](ci-critical.md), with `.runs/ci-latest.json` and `ci-summary.json`. It retains lint, type checks and build, but selects critical Node/browser cases. It is additional remote evidence. Final integrated verification always uses the full command above. An adaptive whole-requirement job may reuse that exact eligible report with explicit provenance; it does not replace the full suite with the critical profile.

Schema version 2 records a unique run ID, optional task/attempt IDs, gate status and duration, the Git commit and dirty flag, and a SHA-256 inventory of tracked and nonignored source files. Generated output, dependencies, `.runs`, `.data`, and `.env` are excluded. Success requires the source inventory and verification contract to remain unchanged for the entire run.

Node tests are discovered recursively under `tests/` and emit `node-results.jsonl` through the owner-selected reporter. Their final machine summary must contain at least one test, every test must pass, and failed, cancelled, skipped, and todo counts must be zero. In a controller run, each planned Node case must also appear as a passing event with its exact file and title. The browser report must contain executed cases, no report errors, no skips, failures, or flaky cases, and passing results for every case named in `factory/verification-contract.json`. Case counts must agree with the report. Missing, empty, malformed, or incomplete reports fail verification even when a command exits zero.

The browser manifest preserves 17 required case identities across the original behaviors, labels, workbench execution and conversation intake. The intake case submits through the real CLI and inspects imported provenance, issue IDs and completed delivery in the browser. Owner-reviewed interaction compatibility revisions retain underlying API, persistence, filtering, execution, report and ownership assertions while the website becomes a read-only inspection surface. Review criteria changes separately from candidate implementation. `tests/verifier.test.ts` exercises skipped, missing, incomplete, timed-out, changed-source, and valid evidence using isolated executable fixtures.

Historical interaction-contract revisions are recorded in [read-only acceptance](read-only-acceptance.md) and [repository navigation acceptance](repository-navigation-acceptance.md). The current UI exposes repository navigation, Issues, Repo harness and diagnostics, with no manual mutation or execution forms. Additive behavior checks still require owner red proofs and independent acceptance review before implementation; these historical revisions do not permit changing existing assertions in an ordinary feature task.

## Select checks by changed behavior

The [consolidation revision](test-consolidation.md) maps removed duplicate or historical-material assertions to preserved coverage and audit records. Required full/critical identities and all five gates stay intact. Use stable visible behavior and accessible regions rather than decorative classes, DOM nesting or incidental button totals. Share small fixture helpers rather than reconstructing the same diagnostic history in every feature.

Follow [assertion observations](assertion-observations.md) when choosing field locators and matching rules. A matching title, opposite state or historical report must not satisfy a current identity/state assertion, while equivalent layout and whitespace should preserve correct functional checks. Use the existing independent coverage review before freezing new checks; an accepted assertion revision remains separate owner maintenance.

Adaptive version-two plans first identify existing coverage and fill only actual gaps. Each acceptance ID needs meaningful named executable coverage; Node/API checks and browser checks may cover criteria independently. Pure computations and API-only rule matrices belong primarily in Node/integration checks; browser cases establish user-visible rendering and interaction. An ordinary feature does not re-test unchanged controller controls, while changed control-plane invariants require targeted regressions through owner maintenance.

A reuse-only plan freezes existing checks through a distinct owner baseline receipt and needs no tests generation or new-test review. Extensions retain owner red proofs, independent acceptance review and freezing. Final independent code review confirms the actual change is covered. Development checks remain diagnostic; fresh complete verification of the final integrated candidate and independent review authorize local integration. Legacy version-one runs keep full candidate and integrated verification. Direct delivery-only candidates still require fresh full verification and review.

Whole-goal acceptance remains a durable job. Eligible artifact-backed reuse validates target/source, runtime, engine, dependency installation, controls, effective contract, actual five-gate summary, Node/browser reports and independent approval. Any mismatch runs a fresh full verifier. Reused reports retain original bytes, run IDs and timestamps and are identified in `verification-reuse.json`; they are not a new execution. Only exact sole-child original-goal combined approval can also replace a fresh whole-goal review. See [review and recovery](harness-reliability.md).

## Budgets

The [repository navigation acceptance revision](repository-navigation-acceptance.md) maps retired status-sidebar and repository-toolbar assumptions to equivalent retained filtering checks. It preserves all 17 full required browser cases, with one explicitly renamed status-filtering identity, and leaves critical CI and all verification gates unchanged.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VERIFY_STEP_TIMEOUT_MS` | `180000` | Maximum time for an individual gate. |
| `VERIFY_TOTAL_TIMEOUT_MS` | `600000` | Total gate budget. |
| `VERIFY_GRACE_MS` | `6000` | Time between TERM and KILL for an owned process group. |
| `VERIFY_RUN_DIR` | Unique `.runs/verify-*` | Must be a new directory; prevents stale report reuse. |
| `VERIFY_CONTRACT_PATH` | `factory/verification-contract.json` | Owner-selected required-case manifest. |
| `NODE_TEST_TIMEOUT_MS` | `180000` | Budget for the Node test subprocess. |

Budgets must be positive integer milliseconds. Each subprocess has an output limit and retained logs. Cancellation and timeout terminate only the owned process group, including descendants that inherit it. Cleanup may extend slightly beyond the gate budget. Before termination, the owner inspects the numeric process tree and captures descendant groups, then signals those exact owned groups directly. Nested runners also relay owner termination; process receipts include the spawned PID. Deliberately detached worker processes require additional isolation; the controller boundary documents that limitation.

## Instance and browser ownership

`npm run doctor` checks the API at `API_PORT`. It verifies the package version and resolved `DB_PATH`, plus `INSTANCE_ID` if supplied. Without an expected instance ID, matching version and database do not establish launch identity. Developer and acceptance instances use different ports and databases.

Storage, API startup, queue startup, reset, doctor and intake share the database-file alias policy: reject file symlinks and multiple hard links before opening or operating on a database. Ordinary directory symlinks and new nested paths retain existing resolved identity. `tests/database-alias-ownership.test.ts` exercises actual API/daemon processes, reset, discovery, preserved data and explicit unsupported-alias diagnostics with disposable files.

Playwright starts its own API and frontend with `reuseExistingServer: false`. Chromium uses disposable contexts rather than the user's browser profile. The verifier assigns a distinct backend database to each run. Tests create and clean up their own records.

Vite optimizer caches belong to each checkout and configured UI port under `.runs/vite/<port>`, outside the shared dependency installation. Controller worktrees link installed packages; Vite's default `node_modules/.vite` would therefore let another checkout replace an active server's optimizer metadata. `tests/vite-cache-isolation.test.ts` checks actual concurrent servers across two disposable checkouts and two ports in one checkout using owned dependency links and real Chromium-loaded URLs. Full verification can run alongside the normal development frontend without stopping it.

The October 22 investigation reproduced shared optimizer metadata replacement. Valid captured dependency URLs continued returning HTTP 200; an earlier manually constructed URL used a missing per-dependency hash and its HTTP 504 is not valid interference evidence. This establishes a cache ownership defect, but does not prove the cause of the earlier websocket disconnect and page reload. Preserve those original failed traces and investigate a recurrence instead of automatically retrying browser assertions or treating a later pass as a root-cause proof.

The workspace fixture sets `X-Issue-Tracker-Target` on browser and request contexts using the actual project metadata. Its URI-encoded `[instanceId, databasePath]` pair conditions each mutation at the receiving API; a mismatch receives `409` before any SQLite write. Delayed-request regressions replace only the disposable API, collide numeric IDs, and compare records and `sqlite_sequence`. The optional header prevents accidental wrong-target writes; it is not authentication.

Required cases cover API create/edit/status changes, validation, search/filter/sort, deletion/cancellation semantics, read-only inspection, narrow-screen behavior, target replacement, labels and persistence. Restart checks launch an owned production server, stop that exact process, restart with the same database, bind the new instance identity, and inspect the stored values through the browser.

## Evidence and diagnosis

The adapter timeout case includes CLI/interpreter startup in its unchanged 1500 ms deadline. It obtains the actual spawned PID from `process.json` and matches the controller's `events.log.owner.json`: positive integer PID, command, working directory, process identity, group membership and settled cleanup. Timeout rejection, recorded timeout status and a real `ESRCH` liveness check remain required. A child-written `worker.pid` is optional diagnostic output and may never exist when startup exceeds the deadline; it is not ownership authority. A deterministic subprocess regression makes that marker unavailable while running the actual named adapter check, so correctness does not depend on CPU load or lucky reruns. Original case names, full and critical selections, production process behavior and budgets remain unchanged.

- `summary.json`: admission result, gate receipts, source hashes, task/attempt identity and available structured process failure diagnostics.
- `context-index.json` and `context-feedback.txt`: compact source-bound role input and complete retained feedback.
- `verification-reuse.json` and `integrated-verification-certificate.json`: reuse decision and the original artifact identities; no claim of fresh execution.
- `node-results.jsonl` and `browser-results.json`: machine-readable execution reports.
- `*.log`: retained gate output.
- `report/index.html`: readable browser report.
- `artifacts/**/trace.zip`: browser actions and DOM/network state for failed tests only. Passing traces are discarded; failure screenshots/videos and explicit acceptance screenshots are retained.

Only a recognized structured `EAGAIN`/`ENFILE` spawn failure with settled ownership can use the one persistent infrastructure retry. Unknown timeouts, logs containing those words and product/test-contract failures cannot authorize that path. Retain failed and retry reports; cumulative execution time and issue budgets remain in force.

The default trace mode is `retain-on-failure`. Playwright still records each test, then discards successful traces; this reduces retained storage, not recording overhead. For targeted diagnosis, use `npm run test:e2e -- --trace on` to keep every trace in that run. With `retries: 0`, `on-first-retry` would not capture failures.

Use `node node_modules/playwright/cli.js show-trace <trace.zip>` to inspect a trace. Routine process/worktree cleanup retains evidence; deleting run artifacts requires an explicit owner request. Port occupied: choose distinct `TEST_API_PORT` and `TEST_UI_PORT` or identify its owner. Database locked: inspect the lock PID and stop its owner; never delete a live lock. Missing Chromium: run `npm run setup` or `node node_modules/playwright/cli.js install chromium`.

## Supported schema marker contract

Maintenance issue #9 replaces the historical fixed marker `4` in the version-one migration check with the storage module's declared `DATABASE_SCHEMA_VERSION`. The expected behavior is that every configured migration completes and existing records survive. The supported-version declaration is separately checked against a real new database. Existing record-preservation, label-update, and unsupported-version rejection assertions remain unchanged. This is an owner-reviewed acceptance-contract revision required by additive metadata migrations, not permission to skip a migration or lower its data guarantees.

## Repository inspection checks

Feature issue 25 adds scoped frozen checks in `tests/repository-navigation.test.ts`, `tests/repository-harness.test.ts`, `acceptance/repository-navigation.spec.ts` and `acceptance/repository-harness.spec.ts`. The Node checks reach the real Express application in process with disposable committed Git repositories; no loopback socket is required. They distinguish enrolled target commits from HEAD and dirty files, compare different repositories, test missing and invalid configuration, exercise UTF-8 byte/aggregate/case boundaries, and prove configuration is neither executed nor followed to unrelated files. Boundary rejection must withhold both source contents and parsed commands/cases.

Browser checks cover repository-scoped rows/counts/labels, combined filters, retained subview state, delayed A-to-B-to-A reads, pending detail dismissal, accessible loading/empty/error/retry states, escaped source text, read-only network behavior and keyboard navigation at 390px. These use disposable contexts, enrolled repositories and owned databases. Existing inspection, filter, evidence and focus checks remain required. Run focused Node checks with `TSX_DISABLE_CACHE=1 node --import tsx --test tests/repository-navigation.test.ts tests/repository-harness.test.ts tests/inspection-state.test.ts tests/read-only-ui.test.ts tests/issue-diagnostics.test.ts`.

A worker's focused results are a proposal only. The controller independently verifies the exact candidate and integrated source using the full existing contract, reviews it, integrates the child into its enrolled target, and proves the whole original requirement. For GitHub-enrolled requirements, completion additionally requires exact-head CI, confirmed PR merge and local synchronization under the existing publication policy. Configuration inspection does not relax any delivery gate or establish a passing run.

## Engineering audit regressions

Owner maintenance issue 30 adds three new scoped test files without changing full/critical manifests, gates, budgets or roles. `tests/database-alias-ownership.test.ts` covers file-alias ownership and safe identity discovery. `tests/delivery-owner-outcome.test.ts` uses real controller verification/integration and queue recovery to distinguish final owner outcomes from historical worker observations; legacy report rendering stays supported. `tests/checkpoint-initial-baseline.test.ts` proves direct delivery-only restoration of original uncommitted baseline files and saved candidate additions/deletions, correct patch attribution, frozen checks, cumulative attempts, fresh complete verification/review and truthful reuse failures. Their initial owner run produced nine named assertion failures and one legacy compatibility pass before independent acceptance approval and freezing. Runtime red proofs, final verification and independent source review remain separate evidence.

The first complete run then exposed two existing `tests/integration.test.ts` cases that coupled retained worker prose to the final `summary` field. Separate acceptance-contract issue 31 independently reviews the narrow compatibility mapping before application: retain the same case titles, original prose regex and every other assertion, select attempt-one historical observations when present, and use the legacy summary only when that optional field is absent. Exact equality with the original `worker-1.json` additionally protects the complete retained text. Issue 30 depends on this reviewed revision. A failed full run is retained as failed evidence; only a fresh complete pass and final source-bound review can authorize either delivery.

## Issue lifecycle regressions

Owner issue35 independently delivers the inactive lifecycle acceptance revision, its machine-readable ticket and `tests/issue-lifecycle-contract.test.ts`; all prior runtime and checks remain unchanged at that prerequisite. Owner issue36 activates its exact single Open-to-Blocked assertion in the existing interrupted queue case together with implementation. Every other original assertion, required identity, full/critical manifest, role and budget remains intact.

The separately accepted `tests/issue-lifecycle.test.ts` and `tests/issue-lifecycle-migration.test.ts` cover failure/recovery/cascade/retry outcomes, persisted and idempotent closure, validation and API ownership, submitted-plan and report preservation, forbidden active/merged closure, closed admission/edits/deletion, replacement cycles, unchanged merge dependencies, and real version-six migration with IDs, foreign keys, publication, original evidence and deleted-ID sequence state. All14 initial named checks, including the prerequisite contract check, produced expected owner-run assertion failures before independent acceptance approval. The later [consolidation revision](test-consolidation.md) retires only that historical static-material case from routine regression while retaining its original document/ticket and generic lifecycle behavior checks. Only the contract check enters prerequisite verification; the remaining checks enter core implementation after that separate delivery. Fixture success cannot claim the post-publication live issue20 closure; that owner operation requires its own retained before/after readback.
