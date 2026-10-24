# Code-only autonomous verification

The owner explicitly retired Playwright and real-browser checks in Issue 69. This revision changes the verification contract; it does not claim equivalent visual or interaction coverage.

## Current execution

Setup installs locked npm dependencies only. The full verifier runs exactly four mandatory gates: lint, TypeScript checking, every discovered Node test, and the production build. Critical CI runs the same four gates with its separately approved named Node selection. No setup, test fixture, proof, queue, maintenance command or CI step launches a browser or requires a browser report. Playwright dependencies, configuration, specs and browser-only scripts are removed.

The active full contract is schema version 2 with `profile: "code-only"`, a nonempty list of required named Node tests and `requiredBrowserTests: []`. Critical CI uses schema version 2 and `profile: "ci-critical"`. Plan and regression JSON retain `browserChecks: []` for compatibility; nonempty browser obligations are rejected before execution. Every acceptance ID needs meaningful named Node coverage. Historical v1 metadata remains readable through the repository harness inspector, but cannot authorize current execution.

Node tests retain real API, SQLite, process, target identity, ownership, queue, budget, review, checkpoint, inventory and evidence-integrity checks. Browser-dependent harness fixtures are converted to Node proofs where the underlying guarantee is independent of rendering. Browser-only checks are retired intentionally. Their Git history and existing delivery artifacts remain available; no application data or historical evidence is reset.

## Consistent implementation standards

Before implementing or checking equivalent functionality, inspect existing repository conventions and shared components. When implementations use conflicting conventions, select one reasonable uniform standard based on maintainability, type safety, ownership boundaries and existing reuse. Record the selected standard and rationale in plan assumptions, then implement and enforce it consistently.

Explicit code and component structure conventions are valid requirements. Existing lint and types, relevant deterministic Node tests and independent source review enforce them. Do not silently accept two competing implementations merely because their output appears equivalent. Do not turn an unrecorded test implementation preference into a mandatory convention. Reuse shared helpers and components; avoid mechanical source-string snapshots for every UI change.

## Admission and delivery

The tests role authors only meaningful gaps. Owner named red proofs and independent acceptance coverage review precede freezing. Ordinary implementation cannot change frozen tests or controls. Focused Node diagnostics precede one final fresh complete verifier on the integrated source. Independent exact-source code review, original-goal acceptance, verified target integration and enrolled GitHub delivery rules remain in force. Serial execution, ownership and cumulative retry budgets are unchanged.

Complete success requires four unique passing gates, a complete real Node report with every required file/title, no failed/cancelled/skipped/todo cases, unchanged source/contract/runtime inputs and independent approval. Missing reports, invented counts or worker prose cannot establish success. New full summaries identify the code-only profile; v2 certificates bind actual Node reports and review artifacts. Old profile certificates are rejected. Historical browser counts in existing reports remain historical data.

## Limits and evidence

This profile establishes the checks it actually executes. It does not establish live rendering, layout, animation, focus, responsive behavior or user interactions. SSR and build checks do not substitute for browser evidence. Reports must state the scope honestly and must not describe zero browser cases as a successful browser run.

Verification retains `.runs/latest.json`, the referenced summary, Node JSONL, process receipts and logs. CI retains its separate pointer and artifacts. The Issue 69 evidence directory records the owner authorization, test retirement/migration map, named red proofs, independent coverage approval, frozen source verification, independent source review and local integration receipt.

## Retirement and retained guarantees

| Previous browser-dependent check | Current treatment |
| --- | --- |
| Live UI, focus, layout, glyph, theme and animation specs | Retired intentionally; existing Git history and evidence remain. |
| Controller and regression fixture using Playwright to assert a value | Real named Node value assertions, with independent proofs/review/freeze/repair and actual integration retained. |
| Browser-based target replacement fixture | Real pinned HTTP mutations and replacement SQLite/sequence no-write assertions. |
| Chromium dependency-cache fixture | Real Vite optimizer/HTTP requests and cache/package isolation assertions. |
| Browser proof/report parser fixtures | Retired; four-gate/Node report completeness and named identity rejection remain mandatory. |
| Historical harness metadata | Read-only legacy parsing remains; active v2 code-only metadata has its own API regression. |

Test migrations preserve exact acceptance identities where still meaningful. Fixture-only corrections retain the actual safety assertion rather than accepting setup failures. The complete retirement map and original/final inventories are retained in the Issue 69 owner evidence.
