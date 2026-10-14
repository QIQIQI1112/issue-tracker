# Repository map

This is a local autonomous development workbench with a reproducible verifier, a persistent serial queue, independent agent review, and verified local integration. Application metadata and controller evidence have separate owners.

## Commands

- Bootstrap: `npm run setup`.
- Development: `npm run dev`.
- Instance identity: `npm run doctor`.
- Complete verification: `npm run verify`.
- Validate a task: `npm run factory -- tickets/001-labels.json --validate`.
- Execute a bounded task: `npm run factory -- tickets/001-labels.json`.
- Execute and integrate into an enrolled clean target: `npm run factory -- tickets/001-labels.json --merge main`.
- Process one queued job: `npm run worker -- --once`.
- Reset disposable demo data: stop the app, then `npm run reset -- --confirm`.

## Boundaries

- `src/domain.ts` owns validation and issue types. It does not import HTTP, storage, or browser code.
- `src/storage.ts` owns parameterized SQLite operations.
- `src/workflow.ts` owns pure workbench types and validation; `src/workflow-store.ts` owns transactional metadata, admission, and claims.
- `src/api.ts` owns HTTP translation and error responses.
- `src/server.ts` owns process startup, loopback binding, and database ownership.
- `src/ui/` owns browser behavior. It may import domain types; it must not import the server or storage.
- `acceptance/` owns externally observable behavior checks.
- `scripts/` owns repeatable operating procedures.
- `factory/` owns task contracts, evidence validation, process budgets, and controller orchestration. Application code must not import it.

## Workflow

1. Inspect the relevant code and documentation.
2. Add one failing behavior check and run it. Confirm the failure is for the expected reason.
3. Implement the smallest change, run the check, then the regression suite.
4. Run `npm run verify`. Read `.runs/latest.json` and the referenced summary; do not claim success from prose or a screenshot alone.
5. Inspect the diff and use independent review before committing.

Do not weaken existing acceptance checks, disable verification steps, or alter required criteria to make a feature pass. Propose changes to the verification contract separately. Stop before publishing a repository, force-pushing, deploying, or operating on non-disposable data without authorization.

## Autonomous execution

- Derive independently verifiable slices from the business goal. Map every acceptance ID to concrete behavior checks.
- Choose reasonable defaults for ordinary implementation details, record each decision and reason, and continue without asking about every detail.
- Ask only when an unresolved choice materially changes the business goal or exceeds the authorized scope.
- Include relevant negative cases and boundary checks. Confirm a new check fails because the requested behavior is missing, not because the environment is broken.
- A worker report is a proposal. Only the controller can mark a task ready after verification and independent review.
- The queue may automatically integrate into its explicitly enrolled local target after a fresh full check and independent review of the integrated tree. Worker agents must not commit or merge. Completion requires a recorded verified merge; human sampling is not a gate.
- Whole-requirement verification must prove the original business goal after all child merges. Dependency readiness requires merge evidence, not manually edited status.
- Keep the controller-owned verification contract and existing required tests intact. New criteria become a separately reviewed contract revision.
- Record assumptions, changes, run IDs, exact evidence paths, and unresolved blockers. Never reuse a passing report for changed code.
- Write documentation, harness instructions, schemas, prompts, and reports in English.
- Code comments and inline lint overrides are prohibited by the existing lint contract. Put design explanations in documentation.

## Context

- Architecture: `docs/architecture.md`.
- Driving and proving the app: `docs/verification.md`.
- Next exercise: `docs/exercises.md`.
- Automation boundary: `factory/README.md`.
- Repository enrollment, queue operation, reports, and recovery: `docs/workbench.md`.

Give every parallel worker its own worktree, ports, and database. Never drive the user's live browser profile for acceptance tests. Never kill processes by name. Keep evidence after cleanup.
