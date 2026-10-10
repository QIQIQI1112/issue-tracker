# Loop — local issue tracker

A small local application for learning closed-loop engineering. It has a real React UI, an HTTP API, and SQLite persistence. Its verification harness starts isolated app instances and records evidence. It is not an autonomous coding factory yet.

## Quick start

Use Node.js 24 or newer and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm run setup
npm run reset -- --confirm
npm run dev
```

Open http://127.0.0.1:5173. The API runs at http://127.0.0.1:4310. Both bind to loopback only. Demo records are explicitly disposable sample data, not a real engineering backlog. The app also works with an empty database.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install locked dependencies and Chromium for browser checks. |
| `npm run dev` | Start the API and Vite together; Ctrl+C stops both. |
| `npm run doctor` | Confirm API identity, database path, and package version. |
| `npm run reset -- --confirm` | Replace the stopped local database with demo records. Refuses a locked database. |
| `npm test` | Run domain, SQLite, API, and ownership tests. |
| `npm run test:e2e` | Start separate test servers and exercise the browser. Run `npm run build` first for the restart acceptance check. |
| `npm run verify` | Lint, typecheck, tests, build, and browser checks; nonzero exit on failure. |
| `npm run build && npm start` | Serve the built UI and API together at http://127.0.0.1:4310. |

Verification writes `.runs/verify-*/summary.json`, logs, a browser report, and traces. `.runs/latest.json` points to the latest summary. The summary records the Git commit and whether the checkout was dirty. A passing result with `dirty: true` does not attest to an immutable commit.

## Stack

- **TypeScript** for shared issue types and static checks across browser, server, and tests.
- **React** for a small component-based, accessible interface.
- **Vite** for the frontend development server and production bundle. `/api` is proxied locally during development, so the browser uses one origin.
- **Express** for a thin HTTP boundary. Request validation stays in `src/domain.ts`.
- **SQLite via Node's built-in `node:sqlite`** for persistent local data without a database service, ORM, or native addon build.
- **Node's test runner** for behavior, persistence, and HTTP checks. **Playwright** drives Chromium through actual user-facing controls and records traces.
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

For another checkout, give it distinct ports and a distinct database path. Browser contexts do not isolate backend data. `.data/`, `.runs/`, and dependencies are ignored by Git.

The server holds an exclusive `<database>.lock` containing its PID and instance ID. Graceful shutdown removes it. A crash can leave a stale lock: inspect its PID and stop any surviving owner before manually removing the lock. Automatic crash recovery is a later exercise, not something this version claims to implement.

## Learning path

1. Read [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md).
2. Run the app and verification harness.
3. Try [exercise 001](docs/exercises.md): add issue labels using test-first vertical slices.
4. Add a deterministic ticket controller only after a single agent can implement and prove one change.

Use GitHub Issues for real development requests once you publish this repository. `tickets/001-labels.json` is a portable example brief, not a second authoritative backlog. The local app's records are product data, not controller state.
