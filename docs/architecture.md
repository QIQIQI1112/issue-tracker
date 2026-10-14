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
| `POST /api/issues/:id/start` | Queue a frozen issue snapshot. |
| `GET /api/runs/:id` | Run metadata and standard delivery report. |
| `GET /api/runs/:id/evidence?file=<manifest-path>` | Download unchanged, manifest-listed evidence. |

Errors use `{ error: string }`, with `400` for invalid requests and `404` for missing issues. The app is loopback-only and rejects unrelated browser origins. There is no login or multi-user authorization; do not expose it to the network.

Automated callers may condition API mutations with `X-Issue-Tracker-Target: encodeURIComponent(JSON.stringify([instanceId, databasePath]))`. The pair identifies the expected launch and exact resolved database path. For `POST`, `PATCH`, and `DELETE` under `/api`, a provided value that differs from the API's captured instance/store identity (including malformed or empty values) receives `409 { error: 'Owned API target identity mismatch. Refusing mutation.' }` before any storage write. The comparison and SQLite write are synchronous at the API boundary, not a separate health-check-before-write race. An absent header preserves ordinary manual use. This is accidental wrong-target protection, **not authentication**: the identity is public and callers can omit the condition.

## Persistence and ownership

`IssueStore` applies ordered migrations inside an initialization transaction using `PRAGMA user_version`. Version 2 adds labels; version 3 adds workbench tables without deleting issues. Unknown newer versions are rejected without resetting them. SQLite is a file under `.data/` by default. API and queue have distinct exclusive lock files, and reset checks both. WAL and atomic claims support their concurrent connections. The test suite checks reopening, upgrade preservation, and real process restarts.

## Engineering control plane

`factory/daemon.ts` owns one durable serial queue. `factory/planner.ts` uses fresh read-only sessions for decomposition and requirement review. `factory/controller.ts` owns issue phases and protected admission checks; `factory/integration.ts` verifies combined changes before advancing a target. `factory/delivery.ts` generates standard reports. `factory/recovery.ts` reconciles durable merge receipts after interruption. Execution records live in `.data/evidence/`, outside candidate checkouts; the API exposes their read-only reports and hashed files. Application code does not import the factory. Read [the controller boundary](../factory/README.md).

## Explicit omissions

No GitHub synchronization, remote publishing, authentication, cloud deployment, parallel scheduling, or automatic stale-lock removal. Enrolled local targets can merge automatically after machine verification and independent agent review. Candidate source, application metadata, and execution evidence have separate owners.
