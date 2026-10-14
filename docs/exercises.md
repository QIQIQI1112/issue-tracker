# Closed-loop engineering practice

## Completed practice: issue labels

The business goal was to assign short labels and filter issues by one label while keeping UI, API, and persistence consistent. The agent selected ordinary defaults: trim and lowercase, preserve first-occurrence order, deduplicate, at most ten labels, and 1–20 Unicode code points per label. Commas and control characters are rejected because the form uses comma-separated input. See [labels](labels.md) for the complete behavior contract.

Implementation followed vertical slices: failing domain/API checks, domain and SQLite migrations, failing browser checks, UI editing/filtering, then a full server-restart proof. Existing required acceptance cases remain required; the original domain creation expectation was extended with `labels: []` rather than removing old assertions.

Retained local evidence:

- `.runs/labels-node-red.log`: missing label behavior before implementation.
- `.runs/labels-browser-red.log` and `.runs/labels-browser-red/`: the missing Labels form control before UI implementation.
- `.runs/labels-node-green.log` and `.runs/labels-browser-green/`: focused passing checks.
- `.runs/verify-2026-10-14T08-18-18-023Z-1dfcc0f9/summary.json`: completed labels run, 71 Node tests and all 14 required browser cases passed.

Later full runs include controller tests as well. Use `.runs/latest.json` to identify the current source snapshot rather than treating an older report as current evidence. Generated evidence is local and ignored by Git.

## Inspect the executable contract

Read `tickets/001-labels.json`, `factory/contracts.ts`, `AGENTS.md`, and [the controller workflow](../factory/README.md). Trace one acceptance ID through the plan, named tests, verifier receipt, review response, and final decision. Distinguish what is requested, what a worker claims, and what the owner checked.

Run `node --import tsx --test tests/verifier.test.ts tests/controller.test.ts tests/agent.test.ts`. Inspect how missing/skipped reports, changing code, protected-check edits, timeouts, failed candidates, and review rejection lead to failure or bounded repair. Deterministic worker fixtures test the controller; they do not replace application acceptance or prove a real model's success rate.

## Run a real worker

The completed [controller integration pilot](controller-pilot.md) records a real Codex repair, the owner-run verification and independent review, and the earlier failures that improved the harness.

Validate a reviewed ticket, then run `npm run factory -- <ticket.json>`. Keep one worker at a time. Review selected defaults and acceptance coverage before increasing autonomy. For an already completed labels ticket, the controller may correctly return a verified candidate without an implementation change.

Choose a small next business request, let the agent propose testable slices, and evaluate the delivered behavior. When human acceptance reveals a missing rule, add it as a separately reviewed criterion and a reproducible check, then use it in future runs. Do not edit criteria to hide a failed candidate.

Record actual human interventions, attempts, elapsed time, invalid evidence, review findings, and first-attempt success across several tasks. Use those observations to choose the next controller improvement. Integration, release, and non-disposable data access remain separate authorized actions.
