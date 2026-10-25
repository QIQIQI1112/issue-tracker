# Loop — local issue tracker

See [the serial execution kernel](docs/execution-kernel.md) for shared task and authorized maintenance execution, typed progress, pinned supervisors and compatibility boundaries. [Owner operations](docs/owner-workflow.md) describe admission, frozen verification and bounded continuation.

A local development workbench for learning closed-loop engineering. It tracks repositories, business requirements, issues, dependencies, executions, and delivery reports. A persistent serial queue dispatches Codex workers, independently verifies and reviews candidates, automatically integrates passing changes, and checks the complete business goal.

## Quick start

Use Node.js 24 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm run setup
npm run reset -- --confirm
npm run dev
```

Open http://127.0.0.1:5173. The API runs at http://127.0.0.1:4310. Both bind to loopback only. Development starts a separate queue worker. Select a repository to inspect Issues or Repo harness; open issue titles or IDs to read deliveries. The website is read-only. Submit work through Codex or the guarded local APIs. Reset is for disposable data only. Read [the workbench workflow](docs/workbench.md) before executing tasks.

You can describe a business requirement directly in Codex. The repo's `$issue-tracker-submit` skill prepares and submits a complete plan with issues, acceptance, defaults, and dependencies. Independent coverage review then releases those issues to the existing queue. Follow [conversation intake](docs/conversation-intake.md); the website shows the submitted goal, source, executions, and reports.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install locked npm dependencies. |
| `npm run dev` | Start the API, Vite, and queue worker; Ctrl+C stops their owned processes. |
| `npm run doctor` | Confirm API identity, database path, and package version. |
| `npm run reset -- --confirm` | Replace the stopped local database with demo records. Refuses a locked database. |
| `npm test` | Run domain, SQLite, API, and ownership tests. |
| `npm run verify:ci` | Run the fixed critical GitHub CI profile and write separate CI evidence. Full local acceptance still requires `npm run verify`. |
| `npm run verify` | Lint, typecheck, all Node tests and build; nonzero exit on failure. |
| `npm run factory -- tickets/001-labels.json --validate` | Validate the task contract without launching a worker. |
| `npm run factory -- tickets/001-labels.json` | Run a bounded Codex task in an owned worktree; requires an authenticated Codex CLI. |
| `npm run factory -- tickets/001-labels.json --merge main` | Independently verify/review and automatically integrate into a clean local target. |
| `npm run worker -- --once` | Process at most one runnable queued job without starting the app. |
| `npm run submit-plan -- --list` | Discover the owned API and actual enrolled repository IDs. |
| `npm run submit-plan -- <plan.json>` | Atomically submit a conversation plan and queue independent coverage review. |
| `npm run submit-plan -- --status <submission-id>` | Read current execution state and report URLs. |
| `npm run build && npm start` | Serve the built UI and API together at http://127.0.0.1:4310. |

Verification writes `.runs/verify-*/summary.json`, Node reports, logs and owned process receipts. `.runs/latest.json` points to the latest summary. Success requires complete reports, all required named Node cases, no skips, and unchanged source and contract snapshots. The summary records file hashes as well as the Git commit and dirty flag. Read [verification](docs/verification.md) for budgets and evidence rules.

Issues support normalized labels, combined label/status/search filters, and migration of existing databases. The defaults and acceptance checks are documented in [labels](docs/labels.md).

Issue lifecycle distinguishes Open, In progress, Blocked, Closed and Done. Failed work remains Blocked until retried or explicitly closed by the agent. Closed records retain their reason, time, optional replacement and original execution evidence; they cannot satisfy merge dependencies. See [lifecycle operations](docs/workbench.md#issue-lifecycle) and the [staged acceptance revision](docs/issue-lifecycle-contract.md).

## Stack

- **TypeScript** for shared issue types and static checks across browser, server, and tests.
- **React** for a small component-based, accessible interface.
- **Vite** for the frontend development server and production bundle. `/api` is proxied locally during development, so the browser uses one origin.
- **Express** for a thin HTTP boundary. Request validation stays in `src/domain.ts`.
- **SQLite via Node's built-in `node:sqlite`** for persistent local data without a database service, ORM, or native addon build.
- **Node's test runner** for behavior, persistence, HTTP, process and controller checks. The current [code-only verification profile](docs/code-only-verification.md) intentionally excludes browser rendering and interaction checks.
- **ESLint** for code checks and a few mechanically enforced import boundaries.

SQLite access is synchronous. That is deliberate for this single-user learning app, not a design for a high-throughput multi-user service. Node 24+ is required for the built-in database API. TypeScript is pinned to a version compatible with the ESLint toolchain rather than blindly selecting the newest release.

## Configuration and isolation

| Variable | Default |
| --- | --- |
| `API_PORT` | `4310` |
| `UI_PORT` | `5173` |
| `DB_PATH` | `.data/issues.sqlite` |
| `INSTANCE_ID` | Random UUID |
| `TEST_API_PORT` | `14310` |
| `TEST_UI_PORT` | `15173` |

For another checkout, give it distinct ports and a distinct database path. Use an original regular database file: database-file symlinks and hard links are rejected by storage, API/queue startup, reset, doctor and conversation intake. Ordinary directory symlinks and new nested database paths retain their existing behavior. Do not replace a database path or add file aliases while an owner is running. Browser contexts do not isolate backend data. `.data/`, `.runs/`, and dependencies are ignored by Git.

API and queue processes hold separate `<database>.lock` and `<database>.queue.lock` files with their PID and instance identity. Graceful shutdown removes them. API and integration locks require explicit owner inspection after a crash. Queue execution-lease reclamation uses a serialized admission guard and requires the recorded PID to be absent; a crashed admission guard requires inspection. Never remove a live lock. Queue startup reconciles interrupted runs with durable merge evidence. Explicitly enrolled GitHub requirements also reconcile publication observations and require confirmed remote merge plus local synchronization; see [GitHub delivery](docs/github-delivery.md).

## Learning path

1. Read [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md).
2. Run the app and verification harness.
3. Study the completed [labels practice](docs/exercises.md), including the failing checks and persistence proof.
4. Run the controller decision tests, inspect [the controller workflow](factory/README.md), then try one approved task.

The local workbench is the authoritative backlog. `tickets/001-labels.json` remains a portable CLI example. Jobs contain frozen request snapshots; controller evidence has a separate owner and is retained under `.data/evidence/`. Human review is an optional audit after automatic completion.
