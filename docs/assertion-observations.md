# Observe behavior at the right boundary

Use the existing tests, regression-tests and acceptance-review phases. Before freezing a check, identify the user-visible result, its narrowest meaningful observation and a concrete incorrect result that the check must reject. This guidance changes neither the execution workflow nor its budgets, permissions, schemas, full verification gates or independent review requirements.

## Select observations

Prefer accessible roles, names and labels for interactive or labelled content. Use a scoped stable test ID when the interface has no suitable semantic locator. Select an identity or state field independently of its expected value, then assert that value separately. Identity-shaped titles and historical text must not stand in for the actual field. A test ID identifies a region; it does not prove its contents are correct or visible. Check the actual rendered value and visibility as appropriate.

| Behavior | Observation |
| --- | --- |
| Identity | Locate the identity field, check the expected identifier and its visibility. Keep title coverage separate. |
| Current state | Observe the dedicated current-state field and distinguish opposite states, including `Verified` versus `Unverified` and `Merged` versus `Not merged`. Historical reports and fixture text cannot substitute for this field. |
| Prose | Scoped content checks remain appropriate for descriptions and reports. Exact equality is useful when the whole value is contractual; it is not required for every paragraph. |
| Interaction | Observe the resulting selected records, input value, focus, expanded state or destination. Synchronize asynchronous checks to the relevant request or observable state, rather than fixed sleeps. |
| Layout | Ordinary equivalent wrappers, classes and spacing should preserve a functional check. Measure layout only when readability, overflow or another visual property is part of the requirement. |

Avoid aggregate row or container text as a substitute for one field. Adjacent elements can render with a clear CSS gap while their `textContent` has no separator. Conversely, a broad substring can accept a wrong state or unrelated historical text. `toContainText` and regular expressions remain valid when their scope and matching rule actually express the requirement. Do not replace every assertion mechanically.

Pure rule matrices belong primarily in Node or API checks. Browser checks establish rendering and interaction; they should not repeat every lower-layer combination. Check observable outcomes rather than CSS classes, nesting, internal functions or incidental control totals unless those properties are themselves required.

## Review both counterexamples

Within the existing coverage review, inspect whether an incorrect or contradictory result could still pass, and whether correct behavior could fail only because equivalent presentation changed. Use the relevant counterexamples, not a new mandatory matrix for every assertion. Return all confirmed actionable coverage gaps together, with the observation, misleading result and expected behavior. Existing accepted checks remain frozen; this guidance cannot authorize their modification.

Adapter regressions prove that these instructions reach the three existing roles with their original sandbox and response schema. They do not prove that every generated test is good. Owner behavior proofs, coverage review, complete verification and final independent source review remain necessary. Assess future effectiveness using false reports, rejected drafts and repair round trips rather than test count.

## Keep checks proportional to risk

One exact positive observation is sufficient when it already excludes the opposite value on the same visible current field. Add a separate negative scenario for a distinct business risk, not to repeat the positive assertion in reverse. Prefer existing semantic locators; stable IDs are useful where needed, rather than mandatory for every widget. Do not require an exhaustive DOM mutation matrix. Preserve strict identity, ownership, current-state and actual defect checks.

Coverage review blocks confirmed actionable gaps with a concrete incorrect business outcome, the affected requirement and a reproducible counterexample. Put speculative presentation preferences in summary. Consolidate known related findings across positive and negative paths in one review. Do not turn general advice into new acceptance criteria after checks are frozen.

Issue 51 removes same-field opposite-state checks already implied by anchored positive values in the nine requirement browser cases. All case identities and scenarios remain, including ownership exclusion, latest evidence, polling focus and historical local delivery. The complete current positive expectations continue to distinguish verification, publication and merge states.

## Historical requirement revisions

Issues 47, 49 and 50 introduced the identity, rendered-state and current-child observations used by the subsequently delivered requirement browser. Their exact-base patches and hash records remain audit artifacts in `tickets/012-requirement-identity-observations.*`, `tickets/014-requirement-state-observations.*` and `tickets/015-requirement-current-observations.*`. They are historical revisions, not instructions to reapply patches or reopen the original requirement. Current accepted checks remain protected during ordinary feature work.

See [owner workflow](owner-workflow.md) for reviewed assertion maintenance, frozen complete verification and bounded native continuation.
