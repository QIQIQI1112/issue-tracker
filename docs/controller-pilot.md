# Controller integration pilot

Historical evidence note: the owner requested clearing `.runs/` on 2026-10-14. The pilot reports, logs, patch, and disposable candidate worktree described below were removed. This document preserves the experiment narrative; the historical paths no longer provide inspectable evidence. New verification runs generate separate records.

## Completed live run

The final focused pilot used real, fresh Codex CLI sessions for planning, check preparation, acceptance review, implementation, and final review. The owner intentionally removed label lowercasing in a disposable seed repository; the main checkout and product database were not used as test targets. This was a repair of an isolated defect after the complete labels implementation, not a fresh implementation benchmark.

The controller returned **ready** after one implementation attempt in 686 seconds. Both planned Node checks first failed with the expected assertions. The worker restored lowercasing before validation and deduplication. Owner verification passed all five gates, 92 Node tests, both pinned Node cases, and all 14 required browser cases. A fresh read-only session approved the candidate and confirmed the code inventory still matched the verified snapshot. The delivered patch changes only one line in src/domain.ts.

Local evidence was recorded under .runs/live-controller-pilot/seed/.runs/factory/labels-normalization-pilot-cc187c8a-680e-4ab5-a65c-bf6586ffaaa1/:

- task.json and plan.json: approved goal, defaults, slices, and named checks.
- red-0.jsonl and red-1.jsonl: actual missing-behavior assertion failures.
- verification-1/summary.json, node-results.jsonl, and browser-results.json: owner-run admission evidence.
- state.json: final ready decision, attempt identity, source hashes, and approved review.
- patch.diff: the reviewable change relative to the immutable baseline.

The owned candidate worktree was recorded at the workspace path in state.json and was removed during the owner-requested cleanup. No candidate was committed, merged, pushed, or deployed. Only disposable fixture repositories received setup commits. Reports and scratch repositories were local and ignored by Git.

## Failures that improved the harness

Earlier runs were recorded in .runs/live-controller-pilot/seed/.runs/factory/ and the pilot-*.log files:

| Observation | Harness correction |
| --- | --- |
| A checks worker treated missing product behavior as a blocker. | Phase prompts distinguish expected red assertions from unresolved task problems. |
| Broad planning/check phases exceeded their budget. | Use explicit phase budgets, keep the task focused, reuse equivalent checks, and return a structured response before the deadline. The sample task now allows five minutes per phase and thirty minutes total. |
| Worker HTTP tests hit loopback EPERM. | Record sandbox-only verification limits in the worker summary; the owner executes the full HTTP/browser suite outside the worker sandbox. |
| Nested verifier fixtures inherited the owner's output directory. | Every fixture selects its own fresh verification directory instead of inheriting VERIFY_RUN_DIR. |
| Independent review reproduced a nested termination race. | Capture owned descendant process groups before termination, signal those exact groups directly, and verify that they stop. Regressions cover two wrappers, handler delay, and a 100ms grace window. |
| Resetting the index hid uncommitted baseline additions from patch capture. | Reconcile every present verified source file into the disposable index before diffing the immutable baseline tree. |

These observations were made while authoring the harness. They are not a statistical estimate of model success or cost. The authoring agent corrected the harness; the final focused controller run required no human relay of logs or implementation decisions.

## Independent review and current verification

The full independent review identified concrete blocking defects rather than approving prose. Patch reconciliation was approved on recheck. The final process cleanup recheck approved PID ownership, shutdown timing, and failure admission with no blocking findings; its receipt was .runs/review-process-final-1791970017443/review.json. Review worktrees were initially cleaned up while retaining reports; the owner-requested cleanup later removed those reports.

For the current main checkout, read .runs/latest.json and the referenced summary. The completed pilot attests to its own isolated snapshot; a different checkout or later edit needs new verification. See [the controller workflow](../factory/README.md) for commands, ownership, budgets, and prototype limits.
