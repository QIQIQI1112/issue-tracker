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

## Follow-up state and progress revision

Owner acceptance-contract issue 49 stages a [separate exact-base patch](../tickets/014-requirement-state-observations.patch) and [hash-bound record](../tickets/014-requirement-state-observations.json) after the authorized continuation's coverage review found additional observation gaps. It checks the visible opener title separately from its accessible name, complete visible recorded/publication states instead of aggregate substrings, and complete visible child merge ratios instead of unanchored count fragments. `Not done`, `Not merged`, `11/2` and `11/10` cannot satisfy the corresponding positive observations. Rendered text checks ignore hidden descendants and retain equivalent whitespace and inline markup.

The seven existing case identities and all unrelated assertions remain intact. The two additive product-defect regressions remain with feature issue 46 and are excluded from this maintenance patch. Direct activation by the feature tests worker was rejected and retained as evidence. This follow-up stays inactive until its own complete baseline verification, independent issue-bound source review and local integration, followed by fresh feature coverage approval and frozen-inventory capture. It changes no original business criterion, execution role, verifier gate, public task limit or existing budget history.

The follow-up preserves the previously accepted zero-child alternatives (`No child issues` in the list and `No child` or `No child issues` in inspection) as anchored visible whole-field values. Stable value-independent field IDs are required for recorded status, merge progress and publication state; the hash-bound ticket records their scopes. Extra explanatory paragraphs, CSS changes and incidental matching prose cannot change the observed field. These nonvisual hooks are applied only during later feature execution. Duplicate fields remain rejected by locator strictness.

Inspection progress retains the previously accepted exact bare ratios such as `1/1` and `1 of 2`; the optional merge wording does not permit wrong numerators, denominators or incidental prose. List progress retains its established merged wording.

## Current child fields and rendered status values

Follow-up owner acceptance-contract issue 50 stages [the exact-base patch](../tickets/015-requirement-current-observations.patch) and [hash-bound record](../tickets/015-requirement-current-observations.json) for the consolidated three remaining concrete review findings. Owned child rows expose separate stable current recorded-status and merge-state fields; historical badges or other prose cannot satisfy these assertions. The existing refresh case observes the dedicated integration field before and after normal polling, requiring an exact 0/1 to 1/1 transition while retaining its focus and pagination checks.

Current acceptance and delivery observations read rendered `innerText`, collapse whitespace and trim before whole-value matching. Equivalent inline wrappers, line breaks and surrounding whitespace remain valid; hidden expected text cannot establish the visible state. Retain single-field and visibility checks, contrary-state rejection, zero-child alternatives, all seven case identities and every unrelated assertion. The two separately additive defect cases use the same helper while still requiring actual owner red proofs. No verifier gate, public limit, role or business criterion changes. Activation requires this separate maintenance delivery followed by fresh feature coverage approval and freezing; all prior evidence and cumulative budgets remain retained.

Both positive values and retained opposite-state exclusions observe the same dedicated child merge-state field. Valid titles such as `Merged` or `Not merged`, and independently identified historical badges, cannot override or invalidate the current field. Opposite current states, hidden fields and duplicate fields still fail.
