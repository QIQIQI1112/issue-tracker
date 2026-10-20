# Issue lifecycle acceptance revision

This revision was inactive at prerequisite delivery (owner maintenance issue35). It documents the approved behavior transition before activation by dependent owner issue36. The prerequisite changes neither runtime behavior nor existing acceptance assertions and must pass complete verification independently. The immutable staged record is `tickets/010-issue-lifecycle-acceptance.json`. Later activation is established by the exact implementation source, verification, review and integration receipts, not by changing this historical stage marker.

## Behavior and activation

Open means unstarted work. In progress means a claimed execution. Blocked means failed work requiring attention; failure and interrupted recovery must not return it to ordinary Open backlog. Closed means an explicit abandonment or supersession with a nonempty reason, owner timestamp and optional existing same-repository replacement. Closure is not successful delivery. Done retains the existing verified merge and completion rules.

The only existing assertion revised at activation is the interrupted-recovery case in `tests/queue.test.ts` named in the ticket: its exact Open status assertion becomes Blocked. Keep its identity and all other assertions unchanged. Keep full and critical manifests, all five verification gates, roles and cumulative budgets. New scoped regressions require owner red proofs and independent acceptance approval before repair. Activate the reviewed assertion atomically with the core implementation; obtain fresh complete verification, source-bound independent review and verified integration before owner attestation.

Closure uses the guarded agent API. It must preserve immutable plan content, prior jobs/runs/reports/evidence and consumed budgets. Queued/running or verified merged work cannot close. Closed issues cannot restart, mutate, delete or satisfy merge dependencies; a replacement merge cannot redirect the original dependency contract or complete its failed requirement. The website remains read-only.

## Post-publication owner acceptance

Pre-publication checks prove the capability with isolated data. After confirmed requirement9 GitHub PR merge, exact-head CI and safe activation, the conversation owner closes issue20 as superseded by issue22 through the pinned API. Retain before/after readback proving issue20 Closed with its durable reason and replacement22, issue22 Done and requirement4 still Blocked. Original immutable plan, jobs, runs, reports, evidence and cumulative budgets remain unchanged. Save the operation and comparison receipt under `.data/evidence/issue-lifecycle-20261020/`. This explicitly post-publication operation is not a child merge or publication prerequisite and cannot be claimed from passing fixture tests.
