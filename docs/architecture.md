# Architecture

```text
React UI → same-origin /api → Express HTTP boundary
                                 ↓
                            domain validation
                                 ↓
                          SQLite IssueStore
```

## Data model

An issue has a numeric stable ID, title, description, status, priority, created timestamp, and updated timestamp. Status is `open | in_progress | done`; priority is `low | medium | high`. Titles contain 1–120 non-whitespace characters; descriptions contain at most 2,000 characters. IDs and timestamps are not client-editable.

The server validates every write. SQL statements use placeholders for values. Database constraints repeat critical domain invariants. The UI handles filtering, text search, and sorting on the small list returned by the API.

## HTTP contract

| Method and path | Result |
| --- | --- |
| `GET /api/health` | App identity, version, database path, record count. |
| `GET /api/issues` | `{ issues: Issue[] }`. |
| `POST /api/issues` | `201 { issue: Issue }`. |
| `PATCH /api/issues/:id` | `200 { issue: Issue }`. Omitted fields are preserved. |
| `DELETE /api/issues/:id` | `204`. |

Errors use `{ error: string }`, with `400` for invalid requests and `404` for missing issues. The app is loopback-only and rejects unrelated browser origins. There is no login or multi-user authorization; do not expose it to the network.

Automated callers may condition issue writes with `X-Issue-Tracker-Target: encodeURIComponent(JSON.stringify([instanceId, databasePath]))`. The pair identifies the expected launch and exact resolved database path. For `POST`, `PATCH`, and `DELETE` under `/api/issues`, a provided value that differs from the API's captured instance/store identity (including malformed or empty values) receives `409 { error: 'Owned API target identity mismatch. Refusing mutation.' }` before any storage write. The comparison and SQLite write are synchronous at the API boundary, not a separate health-check-before-write race. An absent header preserves ordinary manual use. This is accidental wrong-target protection, **not authentication**: the identity is public and callers can omit the condition.

## Persistence and ownership

The schema is initialized by `IssueStore`. SQLite is a file under `.data/` by default. The server owns an exclusive lock file so reset cannot silently replace a running instance's data. WAL enables normal SQLite durability behavior; the test suite checks reopening the database and restarting the real server.

## Explicit omissions

No GitHub sync, authentication, cloud deployment, background coding agents, automatic PR merges, or automatic stale-lock recovery. Those are future exercises. Application records, engineering requests, and controller execution state remain separate.
