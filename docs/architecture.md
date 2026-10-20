# Architecture

```text
React UI → same-origin /api → Express HTTP boundary
                                 ↓
                            domain validation
                                 ↓
                          SQLite IssueStore
```

## Data model

An issue has a numeric stable ID, title, description, status, priority, labels, created timestamp, and updated timestamp. Status is `open | in_progress | done`; priority is `low | medium | high`. Trimmed titles contain 1–120 characters; descriptions contain at most 2,000 characters. IDs and timestamps are not client-editable. Labels are trimmed, lowercased, and deduplicated; see [labels](labels.md) for limits and PATCH semantics.

Schema version 3 adds repositories with local Git roots and target branches, business requirements, optional issue assignments, dependency IDs, acceptance conditions, persistent jobs, and run indexes. `src/workflow.ts` owns their pure types and validation. `src/workflow-store.ts` owns transactional admission, claims, dependencies, and outcome indexing. An execution's machine evidence remains owned by the separate factory process. See [the workbench](workbench.md).

Version 4 adds immutable conversation plan submissions with canonical hashes, source summaries, and issue-key mappings. `src/submission.ts` owns the pure shared graph/plan contract. Codex submits through `scripts/submit-plan.ts`; the controller independently reviews the plan before issue execution. See [conversation intake](conversation-intake.md).

The server validates every write. SQL statements use placeholders for values. Database constraints repeat critical domain invariants. The UI handles filtering, text search, and sorting on the small list returned by the API.

## HTTP contract

| Method and path | Result |
| --- | --- |
| `GET /api/health` | App identity, version, database path, record count. |
| `GET /api/issues` | `{ issues: Issue[] }`. |
| `POST /api/issues` | `201 { issue: Issue }`. |
| `PATCH /api/issues/:id` | `200 { issue: Issue }`. Omitted fields are preserved. |
| `DELETE /api/issues/:id` | `204`. |
| `GET /api/issues/:id` | Issue ownership and execution history. |
| `GET /api/workbench` | Repository, requirement, job, and run indexes. |
| `GET /api/repos`, `POST /api/repos` | List and register local repositories. |
| `GET /api/requirements`, `POST /api/requirements` | List and create business requirements. |
| `POST /api/requirements/:id/start` | Queue decomposition or retry unfinished issues. |
| `POST /api/plan-submissions` | Atomically create a submitted plan and independent-review job; replay returns the existing IDs. |
| `GET /api/plan-submissions/:id` | Immutable original plan, current Requirement/issues/jobs/runs. |
| `POST /api/issues/:id/start` | Queue a frozen issue snapshot. |
| `GET /api/runs/:id` | Run metadata and standard delivery report. |
| `GET /api/runs/:id/evidence?file=<manifest-path>` | Download unchanged, manifest-listed evidence. |

Errors use `{ error: string }`, with `400` for invalid requests and `404` for missing issues. The app is loopback-only and rejects unrelated browser origins. There is no login or multi-user authorization; do not expose it to the network.

Automated callers may condition API mutations with `X-Issue-Tracker-Target: encodeURIComponent(JSON.stringify([instanceId, databasePath]))`. The pair identifies the expected launch and exact resolved database path. For `POST`, `PATCH`, and `DELETE` under `/api`, a provided value that differs from the API's captured instance/store identity (including malformed or empty values) receives `409 { error: 'Owned API target identity mismatch. Refusing mutation.' }` before any storage write. The comparison and SQLite write are synchronous at the API boundary, not a separate health-check-before-write race. An absent header preserves ordinary manual use. This is accidental wrong-target protection, **not authentication**: the identity is public and callers can omit the condition.

## Persistence and ownership

`IssueStore` applies ordered migrations inside an initialization transaction using `PRAGMA user_version`. Version 2 adds labels; version 3 adds workbench tables; version 4 adds submissions without rewriting existing history. Unknown newer versions are rejected without resetting them. SQLite is a file under `.data/` by default. API and queue have distinct exclusive lock files, and reset checks both. WAL and atomic claims support their concurrent connections. The test suite checks reopening, upgrade preservation, and real process restarts.

## Engineering control plane

`factory/daemon.ts` owns one durable serial queue. `factory/planner.ts` uses fresh read-only sessions for decomposition and requirement review. `factory/controller.ts` owns issue phases and protected admission checks; `factory/integration.ts` verifies combined changes before advancing a target. `factory/delivery.ts` generates standard reports. `factory/recovery.ts` reconciles durable merge receipts after interruption. Execution records live in `.data/evidence/`, outside candidate checkouts; the API exposes their read-only reports and hashed files. Application code does not import the factory. Read [the controller boundary](../factory/README.md).

## Explicit omissions

No GitHub synchronization, remote publishing, authentication, cloud deployment, parallel scheduling, or automatic stale-lock removal. Enrolled local targets can merge automatically after machine verification and independent agent review. Candidate source, application metadata, and execution evidence have separate owners.

## Issue inspection

The issue title and LOC identifier open one read-only diagnostics dialog. The browser offers inspection, navigation, filtering and read retries. The empty workspace directs creation and management through the agent. Creation, editing, deletion and execution admission use the existing APIs and conversation CLI; the browser has no mutation forms, operation buttons or Current execution card. There is no Workbench page. Diagnostics combine persisted issue metadata with owned jobs, issue runs and requirement audit runs from the existing APIs. Current execution reasons and limitations remain separate from selected historical reports. Manifest text evidence previews use the existing verified evidence endpoint, render escaped plain text, enforce a 1 MiB received-byte bound and abort obsolete loads. Every manifest artifact retains its download link. Missing report/review data cannot establish verified delivery.

## Repository navigation and harness inspection

On phones, repository navigation has a bounded height and scrolls independently. Growing the enrolled registry therefore keeps the issue search and rows near the top of the page; every repository and its subviews remain reachable by scrolling or keyboard focus.

Workspace views starts with All repositories, including unassigned issues. Its Repositories group lists enrolled repositories and marks exactly one primary selection with `aria-pressed`. A selected repository exposes Issues and Repo harness, with the active subview marked by `aria-current`. The breadcrumb identifies the repository. Repository changes open Issues and clear search, status, label, sort, details and pending harness reads. Subview switches retain issue filters. Reset filters returns to All repositories. Totals and label options use the repository scope before applying the remaining filters; matching counts use all filters.

`GET /api/repos/:id/harness` is an application-owned read operation. `src/harness.ts` owns response types and pure configuration parsing; `src/harness-reader.ts` reads committed sources without importing the factory. Invalid positive-safe-integer IDs and any query overrides receive 400; unknown enrolled IDs receive 404. An unavailable repository or target branch returns a sanitized 200 response with `status: unavailable`, repository identity and no source contents. Available responses identify the repository, enrolled target branch, one immutable resolved commit and every file's status, commit, blob identity and byte size when available. Responses are not cached.

The fixed sources are `package.json`, `AGENTS.md`, `README.md`, `scripts/verify.mjs`, `scripts/verify-ci.mjs`, `scripts/test.mjs`, `playwright.config.ts`, `factory/verification-contract.json`, `factory/ci-verification-contract.json`, `docs/architecture.md`, `docs/verification.md`, `docs/ci-critical.md`, `docs/workbench.md`, `docs/harness-reliability.md` and `docs/github-delivery.md`. CI inspection adds `.github/workflows/verify.yml`, replaced by the validated enrolled workflow basename when configured. There is no recursive discovery or caller-selected path. Symlinks, directories and submodules are not read. Git reads use direct argument arrays and bounded output/time, disable lazy fetching and resolve the target branch once; dirty files and the current HEAD branch do not supply content.

Each source is limited to 256 KiB of UTF-8 bytes, aggregate admitted source bytes to 2 MiB, and each manifest to 1000 combined named Node/browser cases. Exactly bounded sources are accepted; excess sources are withheld completely. Missing, malformed, oversized, unsupported and unreadable sources have individual diagnostics without erasing other valid sections. Only schema-version-one full and ci-critical manifests are supported. Invalid field types, case paths and duplicate identities reject the entire manifest. The full profile may omit named Node requirements; this does not establish an absence of Node tests, because the runner may discover files. Package script categories describe configured entry points, not an inferred execution graph. Runner, browser and CI configuration remain escaped source text and are never evaluated. Source references in manifests are not followed.

Repo harness explicitly describes configuration, not recorded execution success. Existing issue diagnostics remain the source of recorded run and evidence inspection. UI reads are abortable; repository changes unmount obsolete harness and details views so delayed success or failure cannot populate a different selection. Loading, metadata failure, empty registry, unavailable repository and read retry states leave Issues reachable. Navigation uses native keyboard controls, retains focus through refresh, and wraps long repository names and source text on narrow screens.
