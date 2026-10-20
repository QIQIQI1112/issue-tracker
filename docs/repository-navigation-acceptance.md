# Repository navigation acceptance revision

Requirement 6 replaces status-based sidebar navigation with repository selection and the Issues / Repo harness subviews. Its owner maintenance issue 24 adapts existing inspection checks before feature issue 25 executes. This revision supports the current UI as well as the requested UI; it does not implement or prove the new product behavior.

## Equivalent interaction contract

| Retired location or assumption | Retained observable check |
| --- | --- |
| Sidebar All issues / Open / In progress / Done buttons synchronized with the toolbar | Every status, including clearing to all, remains selectable through Filter by status. Exact included and excluded issue rows remain asserted. The legacy path still verifies synchronization while those buttons exist. |
| Toolbar Filter by repository select | Workspace views contains a group named Repositories. It offers All repositories and exact registered repository names as buttons, with one primary selection exposed through aria-pressed. Helpers resolve fixture IDs against the owned API registry, select the corresponding repository and assert the active state. The legacy select remains supported until replaced. |
| Initial All issues sidebar selection | The initial All repositories overview is explicitly active, with exactly one primary active button. All four status options remain available and initially select all. |
| Repository toolbar accessibility | The actual repository select or the named Repositories group must be visible; an arbitrary navigation element is insufficient. The new group must include its All repositories entry. |
| A search established before changing repositories | The test re-establishes its search after selecting a repository, allowing deliberate reset of stale filters on repository changes while retaining the same compound result assertions. |

The new sidebar keeps the accessible navigation name Workspace views. Subview selection must not add another primary aria-pressed selection; use aria-current or another appropriate subview state. Repository selection opens Issues. Switching between Issues and Repo harness within one repository preserves issue filters. Reset filters retains the existing global reset behavior: clear search, status, label and repository selection, returning to All repositories. Initial cross-repository and unassigned issue inspection remain available.

No expected issue, count, ownership, label, sort, persisted value, evidence link, read-only guarantee, keyboard focus or 390px assertion is removed. Existing browser checks still use disposable contexts, repositories and databases. The helper chooses a complete interaction path from the actual repository control and always performs the result assertions; missing controls or unknown fixture repositories fail.

## Exact evidence identity

The full required case in ui.spec.ts changes from `title and description search, both status controls, and all sort orders operate on real issues` to `title and description search, status filtering, and all sort orders operate on real issues`. The matching manifest entry changes with it. All 17 required browser cases remain mandatory. A new deterministic policy regression exercises the real browser-report inspector: complete evidence with the new identity is accepted, while otherwise complete evidence containing only the obsolete identity is rejected. Those synthetic policy inputs do not prove browser behavior.

The critical CI profile, existing verifier gates, independent roles, cumulative budgets and whole-requirement acceptance are unchanged. Feature issue 25 must separately add and obtain independent approval for real repository navigation and repository-specific harness checks, including failure, response ownership and narrow-screen behavior. Owner maintenance completion requires fresh full verification, independent review of the exact source and recorded integration into the reserved requirement branch before that feature runs.
