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

## Inactive revision for the preserved requirement candidate

Owner acceptance-contract issue 47 stages [the exact-base patch](../tickets/012-requirement-identity-observations.patch) and [its hash-bound record](../tickets/012-requirement-identity-observations.json). The affected file belongs to the preserved blocked requirement 14 / issue 46 candidate, not the current main tree. No feature implementation is imported by this maintenance.

| Previous observation | Staged replacement and retained requirement |
| --- | --- |
| Whole requirement row text matched a number followed by a word boundary. | Locate the row's value-independent `requirement-identity` field, require its expected text and visibility, and retain the existing title, status, pagination and merge-progress assertions. |
| Whole inspection text matched the requirement number. | Locate the inspection's value-independent `requirement-identity` field and require its expected text and visibility. |
| Whole inspection text matched the repository number. | Locate the `requirement-repository-identity` field, check its exact normalized `Repository #number` value and require visibility. Existing repository-name and provenance assertions remain intact. |

The patch adds three nonvisual stable field hooks in `src/ui/Requirements.tsx`, including an inline span around repository identity. Rendered wording and behavior stay the same. The field locators deliberately reject duplicate identity fields through locator strictness. Browser probes should show adjacent elements and equivalent wrappers/spacing pass, while identity-shaped titles remain valid and missing, wrong, hidden and duplicate requirement or repository identity fields fail, including fractional numbers such as `Repository #1.5`. The original failures and candidate remain unchanged evidence. The patch preserves all seven case identities and every assertion outside the three identity observations; the current state checks already distinguish opposite states and are not rewritten.

This revision is inactive. A future explicit owner continuation must validate the exact base file, apply the reviewed revision separately from the original checkpoint, obtain fresh source-bound acceptance evidence, and freeze the revised inventory before product repair. Keep cumulative budget and ownership history. This maintenance does not authorize that continuation, repair the two known product defects, establish whole-goal success or publish the feature.
