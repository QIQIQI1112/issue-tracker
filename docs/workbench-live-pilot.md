# Live autonomous queue pilot

The workbench was exercised with real Codex CLI sessions against an owned disposable Git repository on 2026-10-14. Its business requirement was to make the named export in `src/value.ts` equal `ready`, preserving the existing Node and Playwright checks. The application database and user checkout were not execution targets.

The final queue execution reached requirement status `done`. A real read-only decomposition session and a separate coverage reviewer approved one issue. Its controller sessions planned, prepared checks, reviewed acceptance, implemented the repair, and reviewed the verified candidate. The owner then verified the integrated tree and obtained a fresh integration review before fast-forwarding the fixture's `main` branch. A final whole-requirement verification and independent review completed the requirement without a human approval gate.

Successful issue run: `0a838d23-adab-486a-8a5b-f400461fb2b2`. Its target advanced from `5525ed4371add473dcf398f411cd1d53561251f0` to `b1ced77b4427938531d1c2f677bb3f9d0471e842`. The patch changes only the exported string in `src/value.ts`. Candidate and integration receipts each contain one passing Node case and one required passing Playwright case; the final requirement receipt contains the same counts. These are fixture behavior checks. Its lint/typecheck/build commands are no-op fixture gates, so this pilot demonstrates real model orchestration and Git integration, not production application coverage. The complete application verifier supplies that separate evidence.

Durable records are under `.data/evidence/autonomous-pilot/`:

- `pilot-summary.json`: requirement, jobs, and run indexes, including unsuccessful authoring attempts.
- `9729da73-9c0e-48bb-bcc2-8455d9b4ecc3/`: successful decomposition and independent coverage review.
- `0a838d23-adab-486a-8a5b-f400461fb2b2/`: real phase prompts/events/responses, red assertion, candidate verification, independent review, integration verification/review, standard delivery, and patch.
- `817a78de-9356-4943-866c-63d2de24b48b/`: final original-goal verification, independent review, and standard delivery.
- `pilot-repository.bundle`: the fixture's Git history, preserving the baseline and integrated source after scratch cleanup.

Initial authoring attempts found protocol mismatches: an uppercase decomposition key was rejected, and a repository-relative browser spec path was rejected by a basename-only plan contract. The authoring agent clarified key constraints, added a bounded structured-response repair with retained attempts, and canonicalized the safe `acceptance/` spec prefix without relaxing scope or case requirements. The fixture's test discovery was also revised in a separate setup commit to include future added behavior files. Existing assertions were preserved. These authoring interventions occurred before the final successful run; the final issue and whole-goal execution needed no human relay of logs, acceptance approval, or merge operation.

This is one focused pilot, not a success-rate estimate across projects or models. The queue's independent code review and deterministic regressions additionally cover membership freezing, failed sibling retry, cross-requirement cascades, dirty checkouts, moving targets, review rejection/mutation, evidence download integrity, and recovery admission.
