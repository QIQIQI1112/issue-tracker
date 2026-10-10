# Verification contract

## Full check

Run `npm run verify` from the repository root. It executes lint, type checks, Node behavior tests, the production build, and Chromium acceptance checks in sequence. A failed step stops the run and causes a nonzero exit. The verifier records each step's exit code and elapsed time.

Look up `.runs/latest.json`, then read the referenced `summary.json`. Status must be `passed`, every executed check must have exit code zero, and the browser report must contain no failures or skipped acceptance checks. Reports include the checkout's commit and dirty flag; verification on dirty files is evidence of those working files, not proof of a different committed revision.

## Instance health

`npm run doctor` checks the API at `API_PORT`. It verifies the package version and resolved `DB_PATH`, plus `INSTANCE_ID` if supplied. Without an expected `INSTANCE_ID`, matching version and database do not establish launch identity or rule out a stale server. The ordinary developer instance and browser-test instances use different ports and database files.

## Browser checks

Playwright starts its own API and frontend with `reuseExistingServer: false`; it does not silently reuse a developer server. Chromium contexts isolate browser state. Each run uses its own backend database when invoked through the verifier. Individual tests should create and clean up their own records.

The workspace fixture sets `X-Issue-Tracker-Target` on browser and fixture request contexts from that test's actual `project.metadata.instanceId` and `databasePath`, including custom regression configurations. Its URI-encoded JSON pair conditions every issue mutation at the receiving API; `409` rejects a mismatched provided identity before SQLite writes. Context headers survive the existing `page.route` delay/body-error tests. Health checks still diagnose setup/cleanup mismatches, but are not the write guard. Replacement regressions pause real browser create/edit/delete requests, replace only the disposable API, collide numeric IDs, and compare both records and `sqlite_sequence` before/after. The optional header is target-safety, not authentication; unguarded manual requests remain supported.

Expected behavior includes create/edit/status changes, empty-title validation, search/filter/sort, deletion/cancellation, and navigation on a narrow viewport. The separate restart check launches an owned server from the production build, writes and renames a record, terminates that exact process, restarts with the same database, and verifies the title through the browser.

## Evidence

- `*.log`: exact tool output for each gate.
- `summary.json`: gate results and checkout identity.
- `browser-results.json`: machine-readable Playwright results.
- `report/index.html`: readable browser report.
- `artifacts/**/trace.zip`: recorded browser actions and DOM/network state.
- Screenshots for failures and the persistence acceptance check.

Use `node node_modules/playwright/cli.js show-trace <trace.zip>` to inspect a trace. Cleanup stops only processes created by the test and does not delete evidence. Unit tests remove only their own disposable scratch directories.

## Failure diagnosis

Port already occupied: choose another `TEST_API_PORT` / `TEST_UI_PORT` or identify the owner. Database locked: inspect the lock's PID and stop its owner; never delete a live owner's lock. No Chromium: run `npm run setup` again or `node node_modules/playwright/cli.js install chromium`.
