# Serial execution kernel

The application remains a local React, Express and SQLite workbench. One serial dispatcher executes feature and explicitly authorized maintenance jobs through the same stage runner. Profiles configure authority; they do not add agent roles or a second executor.

## Ownership and modules

| Owner | Responsibility |
| --- | --- |
| `src/workflow-store.ts` | Transactional admission, dependency readiness, native claims and outcome indexes. |
| `factory/queue.ts` | Serial dispatch, requirement targets, native outcome indexing and lifecycle timing. |
| `factory/controller.ts` | Compatibility exports for existing callers. |
| `factory/runner.ts` | The single task orchestration path, including coverage reuse, extension, repair and integration. |
| `factory/stages.ts` | Version-two discriminated state, legal stage transitions, source-bound proof admission and structured failures. |
| `factory/run-record.ts` | Shared terminal transition owner for typed progress, detailed state and standard delivery; the queue indexes the returned outcome and reason transactionally. |
| `factory/agent-session.ts` | Existing role invocation, context, deadlines, cancellation and settlement. |
| `factory/scope-guard.ts` | Authoring, frozen and regression scope modes and complete accepted inventory enforcement. |
| `factory/profiles.ts` | Explicit maintenance authority validation and immutable pre-change supervisor capture. |
| `factory/verifier.ts`, `factory/evidence.ts` | Shared trusted verifier preparation and typed four-gate/raw-report admission. |
| `factory/integration.ts`, `factory/github.ts` | Locked verified local integration and protected GitHub publication. |

The factory owns execution evidence outside candidate worktrees. SQLite owns scheduling and inspection indexes. The application imports no factory modules. `GET /api/runs/:id` projects bounded matching progress through application-owned types; reading progress cannot change execution or establish delivery.

## Stages and proof requirements

Admission leads to planning, check preparation, coverage review, implementation, focused diagnostics, full verification, independent source review, integration and completion. Reuse retains the existing controller-proven baseline receipt instead of repeating test authoring and coverage review. Extension obtains actual named red proofs and independent coverage approval before freezing. Regression requests use the existing additive tests role and review before repair.

`run-state.json` schema version two is the active stage/proof record. `state.json` remains the supported compatibility projection for detailed attempts, checkpoints and existing readers. This is one runner with two representations, not two modern execution paths. Legacy version-one task routing remains supported.

Entering implementation, diagnostics, verification or integration requires an unchanged approved test inventory. Source review requires an actual complete passing verifier summary and raw named report on the same source. Completion requires unchanged same-source verification and approving independent review artifacts; merged completion additionally requires the actual integration receipt. Every proof reference records its path, SHA-256 and source hash. Integration retries explicitly re-enter integration for the latest target candidate.

Failures retain their kind, originating stage and actionable message. A rejected source review is never an approving progression proof. Recovery reconciles an actual committed integration and matching typed proof bytes; it cannot infer success from prose or repeat integration blindly. Unsupported or damaged evidence blocks reuse.

Normal finalization, queue blocking and quiescent interrupted recovery use the same terminal-record owner. It reconciles typed progress before writing detailed state and regenerating the delivery manifest, including when delivery already exists. Recorded failure context and completed timing survive reconciliation; an active interval closes once at the established terminal instant or the actual reconciliation time. Proof identities, attempts and cumulative budgets remain intact. Legacy runs without typed progress remain readable without synthesizing modern evidence. Application reads remain projections and never repair persisted execution state.

## Authority profiles

Ordinary feature jobs retain existing scope restrictions and cannot modify controls or frozen tests. An issue's `changeKind`, label or HTTP payload is descriptive and grants no execution authority.

For maintenance, the trusted owner prepares an absolute request path containing `schemaVersion: 1`, a UUID `requestId`, `issueId`, `issueHash`, `profile`, safe relative `scope`, original `authorization`, `engineSourceHash`, `contractHash` and exact target `baseCommit`. `issueHash` is `maintenanceIdentity(issue)`; engine identity is the loaded repository snapshot and contract identity is the SHA-256 of its active verification-contract bytes. A stale issue, base, engine, contract or unsafe scope is rejected before claiming work. For GitHub requirements the reserved branch must already exist; the ordinary plan-review/decomposition job normally prepares it before releasing children. Explicit owner admission must retain the same prepared publication base.

The harness profile permits only its explicitly authorized control scope. The acceptance-contract profile permits explicit test, fixture, documentation and verification-manifest revisions; existing assertions may change only during that authorized authoring phase before independent review. New scoped checks may be authored when necessary. Once approved, every retained and new test byte is frozen; implementation cannot add, alter or remove tests. Selecting an existing check does not expand writable scope.

After admission the queue claims the native maintenance job before substantive work. It copies and verifies the complete pre-change supervising engine into the owned run, retains the request and supervisor identities, then invokes the same runner from that pinned engine. Candidate controls cannot replace the running kernel or its active admission contract. Candidate code is exercised by the tests and fresh verifier. The new engine is activated only after verified integration and quiescent owner handoff.

Run a prepared maintenance request through the existing dispatcher:

```sh
DB_PATH=/absolute/path/to/platform.sqlite npm run worker -- --once --owner-authorization /absolute/path/to/authorization.json
```

Use the existing queue lease. Settle and stop the exact idle ordinary daemon before this one-shot owner dispatch, then restart ordinary service afterward. Never operate two dispatchers concurrently or kill by name. This is a cooperative local ownership boundary with shared dependencies and Git objects, not hostile-code isolation.

## Timing, continuation and compatibility

Modern native deliveries record queue waiting time, claim-to-completion wall time, actual role invocations, verifier executions, phase durations and cumulative budget usage. Current phase is visible before a delivery exists. CI/publication waiting remains in separate native requirement publication records and does not become implementation time. Historical reports without phase or lifecycle timing remain explicitly unavailable; the system does not invent earlier work from a completion-only attestation.

Use the existing `owner-resume` command and request journal for bounded continuation. Maintenance requests additionally retain the original `ownerAuthorizationPath`. Validate authority before granting budget, retain the exact assignment and supervising engine, require quiescent predecessor ownership, and restore only valid accepted checkpoints. Both runs use the same issue budget key. An explicit grant extends the existing ledger without resetting attempts or elapsed usage; request replay returns its recorded outcome without another agent call or integration. Changed authority, base or engine requires explicit owner recovery, not an implicit upgrade.

`verify-maintenance` remains the frozen full-verification operation for supervised repository work. `scripts/record-maintenance.ts` remains a compatibility attestation for already verified and integrated owner work; its final receipt time does not measure the preceding engineering lifecycle. It is not the normal executor for newly authorized native maintenance.

## Bounded UI checks

UI behavior uses the public ReactDOM fixture for actual state, events, selection, dismissal and refresh. Exact approved design values use a small declared token/recipe contract with independent expected values and scoped incorrect-result controls. The handwritten CSS cascade, specificity, geometry and paint interpreter and its AST-based observer tests are retired under a separately approved migration. Static declarations and Node DOM checks do not establish real browser layout, painting, animation or native scrolling. Playwright and browser execution remain retired.

Every final integrated candidate still requires a fresh complete four-gate verifier and independent source review. Whole-requirement acceptance and explicitly enrolled GitHub exact-head CI, confirmed merge and local synchronization remain separate completion obligations.

## Source-bound accepted-test revision continuation

The existing owner-resume request optionally accepts `acceptedRevisionPath`; its owner-local redemption binds an actually merged acceptance-contract artifact and an explicit historical-to-current authority transition. The original issue, task, criteria, scope, profile, runtime and contract stay fixed. A separately enrolled contract checkout is permitted only within the same Git common directory and effective integration branch. Native integration, complete machine verification and independent integrated-source approval establish provenance; staging status or delivery prose does not.

Admission validates the retained checkpoint, reconstructed source, complete reviewed inventories, old/new hashes and replacement content before persistent admission writes. Only existing accepted test replacements are supported; holds, regression combinations, missing-path drafts, additions, retirements and arbitrary source changes are rejected. The owner journal binds evidence hashes for interruption and exact replay. Positive grants retain all cumulative usage and canonical limits.

The selected native job prepares the retained scoped draft against current target controls. Approved corrections and retained tests join newly delivered baseline tests; unexpected shared-test changes block. Overlapping authorized implementation edits remain visible to ordinary repair. Fresh named proofs and the existing independent coverage stage consume the original acceptance counter and freeze the actual complete inventory. Historical approval is not relabeled as approval of revised source. Implementation or repair, the complete integrated verifier, final independent source review and integration remain mandatory. See [owner workflow](owner-workflow.md#adopt-an-approved-revision-of-retained-tests) for the request and unsupported cases.
