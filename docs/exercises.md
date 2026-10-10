# Exercise 001: issue labels

## Goal

Add short labels to issues and let the user filter by a label. Keep the UI, API, and persistent state consistent.

## Work in vertical slices

1. Add a failing behavior check for assigning one label; run it and explain the failure.
2. Implement the domain, storage, and API path for that one behavior. Re-run the check and existing suite.
3. Add a failing browser check for editing labels and filtering by one label. Implement and verify it.
4. Add a server-restart check that proves labels persist.
5. Run `npm run verify`, inspect the result and diff, and obtain independent review.

Acceptance: changing labels through the UI survives a full server restart; selecting a label filter shows matching issues only; empty/overlong labels are rejected; existing issue behavior still works. Do not change old required assertions to get a passing result.

## Observe the human bottleneck

Record every time you have to relay a log, find a command, explain an architecture boundary, or rescue stale state. Convert repeatable actions into scripts and missing context into repository documentation. Do not jump to many parallel agents yet.

## Next milestone

A small controller reads one approved ticket, launches a worker in an isolated worktree, invokes a controller-owned acceptance contract, captures results, and either returns a verified patch or a blocked report. It must not accept the worker's 'done' message as completion.
