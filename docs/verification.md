# Verification contract

## Full check and admission

Run `npm run verify` from the repository root. It runs lint, type checks, Node behavior tests, the production build, and Chromium acceptance in sequence. A failed or timed-out gate stops the run with a nonzero exit. Read `.runs/latest.json` and its referenced `summary.json`; terminal prose is insufficient evidence.

Schema version 2 records a unique run ID, optional task/attempt IDs, gate status and duration, the Git commit and dirty flag, and a SHA-256 inventory of tracked and nonignored source files. Generated output, dependencies, `.runs`, `.data`, and `.env` are excluded. Success requires the source inventory and verification contract to remain unchanged for the entire run.

Node tests are discovered recursively under `tests/` and emit `node-results.jsonl` through the owner-selected reporter. Their final machine summary must contain at least one test, every test must pass, and failed, cancelled, skipped, and todo counts must be zero. In a controller run, each planned Node case must also appear as a passing event with its exact file and title. The browser report must contain executed cases, no report errors, no skips, failures, or flaky cases, and passing results for every case named in `factory/verification-contract.json`. Case counts must agree with the report. Missing, empty, malformed, or incomplete reports fail verification even when a command exits zero.

The browser manifest preserves the original 11 required cases, the three label cases, and the two workbench cases. The conversation-intake contract revision adds one case that submits through the real CLI and inspects imported provenance, issue IDs, and completed delivery in the browser. No prior case is removed or weakened. The migration regression now expects schema version 4 while preserving its existing record and label assertions. Review criteria changes separately from candidate implementation. `tests/verifier.test.ts` exercises skipped, missing, incomplete, timed-out, changed-source, and valid evidence using isolated executable fixtures.

## Budgets

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

Playwright starts its own API and frontend with `reuseExistingServer: false`. Chromium uses disposable contexts rather than the user's browser profile. The verifier assigns a distinct backend database to each run. Tests create and clean up their own records.

The workspace fixture sets `X-Issue-Tracker-Target` on browser and request contexts using the actual project metadata. Its URI-encoded `[instanceId, databasePath]` pair conditions each mutation at the receiving API; a mismatch receives `409` before any SQLite write. Delayed-request regressions replace only the disposable API, collide numeric IDs, and compare records and `sqlite_sequence`. The optional header prevents accidental wrong-target writes; it is not authentication.

Required cases cover create/edit/status changes, validation, search/filter/sort, deletion/cancellation, narrow-screen behavior, target replacement, labels, and persistence. Restart checks launch an owned production server, stop that exact process, restart with the same database, bind the new instance identity, and inspect the stored values through the browser.

## Evidence and diagnosis

- `summary.json`: admission result, gate receipts, source hashes, and task/attempt identity.
- `node-results.jsonl` and `browser-results.json`: machine-readable execution reports.
- `*.log`: retained gate output.
- `report/index.html`: readable browser report.
- `artifacts/**/trace.zip`: browser actions and DOM/network state for failed tests only. Passing traces are discarded; failure screenshots/videos and explicit acceptance screenshots are retained.

The default trace mode is `retain-on-failure`. Playwright still records each test, then discards successful traces; this reduces retained storage, not recording overhead. For targeted diagnosis, use `npm run test:e2e -- --trace on` to keep every trace in that run. With `retries: 0`, `on-first-retry` would not capture failures.

Use `node node_modules/playwright/cli.js show-trace <trace.zip>` to inspect a trace. Routine process/worktree cleanup retains evidence; deleting run artifacts requires an explicit owner request. Port occupied: choose distinct `TEST_API_PORT` and `TEST_UI_PORT` or identify its owner. Database locked: inspect the lock PID and stop its owner; never delete a live lock. Missing Chromium: run `npm run setup` or `node node_modules/playwright/cli.js install chromium`.
