# Architecture

```text
React UI → same-origin /api → Express HTTP boundary
                                 ↓
                            domain validation
                                 ↓
                          SQLite IssueStore
```

## Data model

An issue has a numeric stable ID, title, description, status, priority, labels, created timestamp, and updated timestamp. Status is `open | in_progress | blocked | closed | done`; priority is `low | medium | high`. Closed issues additionally expose `closure: { reason, closedAt, supersededBy? }`. Trimmed titles contain 1–120 characters; descriptions contain at most 2,000 characters. IDs, closure metadata and timestamps are not client-editable. Labels are trimmed, lowercased, and deduplicated; see [labels](labels.md) for limits and PATCH semantics.

Schema version 3 adds repositories with local Git roots and target branches, business requirements, optional issue assignments, dependency IDs, acceptance conditions, persistent jobs, and run indexes. `src/workflow.ts` owns their pure types and validation. `src/workflow-store.ts` owns transactional admission, claims, dependencies, and outcome indexing. An execution's machine evidence remains owned by the separate factory process. See [the workbench](workbench.md).

Version 4 adds immutable conversation plan submissions with canonical hashes, source summaries, and issue-key mappings. `src/submission.ts` owns the pure shared graph/plan contract. Codex submits through `scripts/submit-plan.ts`; the controller independently reviews the plan before issue execution. See [conversation intake](conversation-intake.md).

Version 5 adds maintenance change classifications. Version 6 adds optional GitHub enrollment, immutable requirement publication identities and deferred publication scheduling. `DATABASE_SCHEMA_VERSION` in `src/storage.ts` declares the current supported version; migrations preserve existing history.

Version 7 extends the issue status constraint and adds closure reason, timestamp and a replacement foreign key. It follows SQLite's [generalized table migration procedure](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes): foreign keys are disabled before the transaction, the replacement table receives existing rows, then the old table is replaced without renaming its references. Existing indexes/triggers and AUTOINCREMENT high-water state are retained; foreign-key integrity is checked before commit and enforcement is restored afterward. Only inactive, unmerged legacy issues whose latest job is blocked are backfilled; active ownership and original jobs/runs/plans/evidence are preserved.

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
| `GET /api/repos/:id/harness` | Inspect bounded committed configuration at the enrolled target; does not execute checks. |
| `GET /api/requirements`, `POST /api/requirements` | List and create business requirements. |
| `POST /api/requirements/:id/start` | Queue decomposition or retry unfinished issues. |
| `POST /api/plan-submissions` | Atomically create a submitted plan and independent-review job; replay returns the existing IDs. |
| `GET /api/plan-submissions/:id` | Immutable original plan, current Requirement/issues/jobs/runs. |
| `POST /api/issues/:id/start` | Queue a frozen issue snapshot. |
| `POST /api/issues/:id/close` | `200 { issue: Issue }`; explicit closure with reason and optional replacement. |
| `GET /api/runs/:id` | Run metadata, bounded matching typed progress (or null historically), and standard delivery report. |
| `GET /api/runs/:id/evidence?file=<manifest-path>` | Download unchanged, manifest-listed evidence. |

Errors use `{ error: string }`, with `400` for invalid requests and `404` for missing issues. The app is loopback-only and rejects unrelated browser origins. There is no login or multi-user authorization; do not expose it to the network.

Automated callers may condition API mutations with `X-Issue-Tracker-Target: encodeURIComponent(JSON.stringify([instanceId, databasePath]))`. The pair identifies the expected launch and exact resolved database path. For `POST`, `PATCH`, and `DELETE` under `/api`, a provided value that differs from the API's captured instance/store identity (including malformed or empty values) receives `409 { error: 'Owned API target identity mismatch. Refusing mutation.' }` before any storage write. The comparison and SQLite write are synchronous at the API boundary, not a separate health-check-before-write race. An absent header preserves ordinary manual use. This is accidental wrong-target protection, **not authentication**: the identity is public and callers can omit the condition.

## Persistence and ownership

`IssueStore` applies ordered migrations inside an initialization transaction using `PRAGMA user_version`. Unknown newer versions are rejected without resetting them. SQLite is a file under `.data/` by default. API and queue have distinct exclusive lock files, and reset checks both. WAL and atomic claims support their concurrent connections. The test suite checks reopening, upgrade preservation, and real process restarts.

`resolveDatabasePath` in `src/instance.ts` resolves supported paths and rejects database-file symlinks, including dangling links, and files with multiple hard links before storage, API ownership, queue leasing or reset. Doctor and conversation intake apply the same policy. Existing directory symlinks and new nested database paths remain supported; path identity retains its existing resolved spelling. Do not add file aliases to an active database or replace its path while an owner is running.

## Engineering control plane

`factory/daemon.ts` owns one durable serial queue. `factory/planner.ts` uses fresh read-only sessions for decomposition and requirement review. `factory/runner.ts` owns the single task orchestration path, `stages.ts` typed proof-gated progress, `agent-session.ts` role invocation and `scope-guard.ts` frozen scope. `profiles.ts` admits explicit owner authority and captures the pre-change supervisor; `controller.ts` keeps compatibility exports. Shared `verifier.ts` preparation and `evidence.ts` admission validate actual four-gate and raw named reports; `factory/integration.ts` verifies combined changes before advancing a target. `factory/delivery.ts` generates standard reports. `factory/recovery.ts` reconciles durable merge receipts after interruption. Execution records live in `.data/evidence/`, outside candidate checkouts; the API exposes their read-only reports and hashed files. Application code does not import the factory. Read [the controller boundary](../factory/README.md). The [execution kernel](execution-kernel.md) documents current module ownership, profiles and durable state. Feature and authorized maintenance jobs share the serial queue lifecycle; labels and classifications grant no control authority. Candidate controls never replace their running supervisor. Historical completion-only attestations remain readable without fabricated phase timing.

The current [review and recovery protocol](harness-reliability.md) runs owner red proofs before independent acceptance review and freezing. An adaptive integrated task finishes focused diagnostics before one fresh complete integrated verifier and one final independent code review of the integrated source. Legacy tasks retain candidate and integrated full verification. Whole-goal verification and review remain required. Explicit GitHub enrollment additionally requires exact-head CI, confirmed PR merge and clean local synchronization before requirement completion; see [GitHub delivery](github-delivery.md).

## Explicit omissions

No authentication, hosted multi-user authorization, cloud deployment, parallel development scheduling or hostile-worker isolation. API and integration locks require owner inspection after a crash. Queue execution leases can be reclaimed only under the serialized admission guard when the recorded PID is absent; a stale admission guard still requires explicit inspection. GitHub publication is available only for explicitly enrolled new requirements. Local-only requirements and standalone maintenance retain their enrolled local target.

## Issue inspection

The issue title and LOC identifier open one read-only diagnostics dialog. The browser offers inspection, navigation, filtering and read retries. The empty workspace directs creation and management through the agent. Creation, editing, deletion and execution admission use the existing APIs and conversation CLI; the browser has no mutation forms, operation buttons or Current execution card. There is no Workbench page. Diagnostics combine persisted issue metadata with owned jobs, issue runs and requirement audit runs from the existing APIs. Issue metadata refreshes every two seconds independently of job transitions, retaining existing rows and active controls during background reads. Current execution reasons and limitations remain separate from selected historical reports. Manifest text evidence previews use the existing verified evidence endpoint, render escaped plain text, enforce a 1 MiB received-byte bound and abort obsolete loads. Every manifest artifact retains its download link. Missing report/review data cannot establish verified delivery.

## Repository navigation and harness inspection

On phones, repository navigation has a bounded height and scrolls independently. Growing the enrolled registry therefore keeps the issue search and rows near the top of the page; every repository and its subviews remain reachable by scrolling or keyboard focus.

Workspace views starts with All repositories, including unassigned issues. Its Repositories group lists enrolled repositories and marks exactly one primary selection with `aria-pressed`. A selected repository exposes Issues and Repo harness, with the active subview marked by `aria-current`. The breadcrumb identifies the repository. Switching enrolled repositories retains the current subview and clears search, status, label, sort, details, pending harness reads and disclosure state. All repositories and Reset filters return to Issues. Subview switches retain issue filters. Totals and label options use the repository scope before applying the remaining filters; matching counts use all filters.

`GET /api/repos/:id/harness` is an application-owned read operation. `src/harness.ts` owns response types and pure configuration parsing; `src/harness-reader.ts` reads committed sources without importing the factory. Invalid positive-safe-integer IDs and any query overrides receive 400; unknown enrolled IDs receive 404. An unavailable repository or target branch returns a sanitized 200 response with `status: unavailable`, repository identity and no source contents. Available responses identify the repository, enrolled target branch, one immutable resolved commit and every file's status, commit, blob identity and byte size when available. Responses are not cached.

The fixed sources are `package.json`, `AGENTS.md`, `README.md`, `scripts/verify.mjs`, `scripts/verify-ci.mjs`, `scripts/test.mjs`, `factory/verification-contract.json`, `factory/ci-verification-contract.json`, `docs/architecture.md`, `docs/verification.md`, `docs/ci-critical.md`, `docs/workbench.md`, `docs/harness-reliability.md` and `docs/github-delivery.md`. CI inspection adds `.github/workflows/verify.yml`, replaced by the validated enrolled workflow basename when configured. There is no recursive discovery or caller-selected path. Symlinks, directories and submodules are not read. Git reads use direct argument arrays and bounded output/time, disable lazy fetching and resolve the target branch once; dirty files and the current HEAD branch do not supply content.

Each source is limited to 256 KiB of UTF-8 bytes, aggregate admitted source bytes to 2 MiB, and each manifest to 1000 combined named Node/browser cases. Exactly bounded sources are accepted; excess sources are withheld completely. Missing, malformed, oversized, unsupported and unreadable sources have individual diagnostics without erasing other valid sections. The active schema-version-two code-only and ci-critical manifests are supported; historical schema-version-one full/ci-critical metadata remains readable. Active code-only manifests require named Node cases and an empty browser list. Invalid field types, case paths and duplicate identities reject the entire manifest. The full profile may omit named Node requirements; this does not establish an absence of Node tests, because the runner may discover files. Package script categories describe configured entry points, not an inferred execution graph. Runner and CI configuration remain escaped source text and are never evaluated. Source references in manifests are not followed.

Repo harness explicitly describes configuration, not recorded execution success. Existing issue diagnostics remain the source of recorded run and evidence inspection. UI reads are abortable; repository changes unmount obsolete harness and details views so delayed success or failure cannot populate a different selection. Loading, metadata failure, empty registry, unavailable repository and read retry states leave Issues reachable. Navigation uses native keyboard controls, retains focus through refresh, and wraps long repository names and source text on narrow screens.

## UI composition and iteration

UI ownership is divided into `src/ui/theme`, `components`, `layout`, `features` and `shared`. App composes repository navigation and feature screens; shared hooks own workbench refresh and issue collection state. Existing direct UI imports remain compatible with Node static rendering. The isolated development preview at `/__ui/components` uses the same primitives without mounting application data reads. See [UI ownership and visual iteration](ui-iteration.md) for token, component, feature and preview workflows.

Current verification follows [the code-only contract](code-only-verification.md): lint, TypeScript, Node tests and build; no browser execution. Historical browser report metadata is retained.
