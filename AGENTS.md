# Repository map

This is stage one of a closed-loop engineering lab: a functioning app and a reproducible verifier, not an autonomous controller.

## Commands

- Bootstrap: `npm run setup`.
- Development: `npm run dev`.
- Instance identity: `npm run doctor`.
- Complete verification: `npm run verify`.
- Reset disposable demo data: stop the app, then `npm run reset -- --confirm`.

## Boundaries

- `src/domain.ts` owns validation and issue types. It does not import HTTP, storage, or browser code.
- `src/storage.ts` owns parameterized SQLite operations.
- `src/api.ts` owns HTTP translation and error responses.
- `src/server.ts` owns process startup, loopback binding, and database ownership.
- `src/ui/` owns browser behavior. It may import domain types; it must not import the server or storage.
- `acceptance/` owns externally observable behavior checks.
- `scripts/` owns repeatable operating procedures.

## Workflow

1. Inspect the relevant code and documentation.
2. Add one failing behavior check and run it. Confirm the failure is for the expected reason.
3. Implement the smallest change, run the check, then the regression suite.
4. Run `npm run verify`. Read `.runs/latest.json` and the referenced summary; do not claim success from prose or a screenshot alone.
5. Inspect the diff and use independent review before committing.

Do not weaken existing acceptance checks, disable verification steps, or alter required criteria to make a feature pass. Propose changes to the verification contract separately. Stop before publishing a repository, force-pushing, deploying, or operating on non-disposable data without authorization.

## Context

- Architecture: `docs/architecture.md`.
- Driving and proving the app: `docs/verification.md`.
- Next exercise: `docs/exercises.md`.
- Automation boundary: `factory/README.md`.

Give every parallel worker its own worktree, ports, and database. Never drive the user's live browser profile for acceptance tests. Never kill processes by name. Keep evidence after cleanup.
