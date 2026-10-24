# UI ownership and visual iteration

The application uses React and plain CSS. Start the existing development server with `npm run dev`. Open `/` for the application or `/__ui/components` on that same frontend origin for the component preview. The preview has static samples and local state; it does not mount application reads, polling, reports, evidence loaders or mutation paths. It works without a backend. Its dynamic modules and stylesheet are gated by `import.meta.env.DEV` in the browser entry and are excluded from production output.

## File ownership

| Location | Responsibility |
| --- | --- |
| `src/ui/theme/tokens.css` | Semantic colors, spacing and type scales, component aliases, radii and font families. |
| `src/ui/components/` | Shared native Button, Icon, Modal, Badge, Pagination and EmptyState primitives. |
| `src/ui/layout/WorkspaceLayout.tsx` | Workspace shell, repository navigation and breadcrumb markup. Receives data and navigation callbacks. |
| `src/ui/features/issues/` | Issue list, toolbar, rows and read-only issue diagnostics. |
| `src/ui/features/requirements/` | Requirement list and original-goal inspection. |
| `src/ui/features/reports/` | Selected delivery reports and bounded, abortable evidence previews. |
| `src/ui/features/harness/` | Committed repository harness inspection and disclosures. |
| `src/ui/features/preview/` | Development-only sample content, local modal/pagination interactions and gallery layout. |
| `src/ui/shared/` | API translation, workbench reads and refresh coordination, issue collection state, focus intent and pure ownership/progress calculations. |
| `src/ui/App.tsx` | Repository/subview selection, diagnostics selection and screen composition. |
| `src/ui/styles.css` | Production selectors and responsive rules, retaining their existing specificity and order. |
| `src/ui/main.tsx` | Browser initialization, central production style imports and gated preview loading. |

The former top-level UI modules remain thin compatibility re-exports. Existing direct imports such as `App`, `IssueRow`, `DeliveryView` and `workbench-state` continue to support Node static rendering. Feature modules, components and shared hooks do not import CSS or perform browser initialization at module evaluation.

## Choosing the change location

Change theme tokens for a shared color, type, radius or spacing decision. Colors are named by purpose, including distinct status, evidence, warning, source and navigation treatments. The size scales retain the original measured values; semantic aliases such as `--radius-control`, `--space-panel-padding` and `--font-size-control` express common roles. Preserve distinctions between existing shades unless a visual change is intentional.

Change a shared component for behavior or markup used by several real screens. Button preserves native attributes and refs, and its loading state disables activation and exposes `aria-busy`. Badge preserves a native span and accepts the existing status class hooks. EmptyState owns the common message frame. Pagination owns the exact range and boundary controls; Issues, Requirements and the preview supply their own collection and page state. Modal preserves native dialog semantics, neutral initial focus, trapped bidirectional Tab navigation, Escape dismissal and return to its connected opener. Focus outlines are enabled by intentional Tab input through the shared focus-intent hook.

Change feature markup and its existing CSS selectors for screen-specific layout. Keep component primitives independent of backend reads. Keep workspace navigation presentation in the layout and navigation decisions in App. `useWorkbenchData` retains the existing abort signals, job-change refresh trigger, two-second metadata polling, retry behavior and previously loaded issues. `useIssueCollection` owns repository scoping, filter/search/sort, page resets, clamping and list scroll reset. Requirements retain their own selection and focus recovery when refreshed rows move across pages.

Production CSS stays centrally loaded: tokens first, then the existing rule sequence, including later report/harness refinements and responsive overrides. Moving rules into per-component styles can change the cascade; review that separately. Do not introduce CSS imports into compatibility entry points. Keep preview styles and fixtures behind the development gate.

## Preview and verification

The preview displays normal, disabled, loading, error, empty and long-content samples using the same production primitives. Activate the local action, open the modal, traverse with Tab and Shift+Tab, dismiss with Escape or Close, and page through the finite sample collection. Inspect at desktop width and at 390px; long identifiers must wrap without page clipping or horizontal overflow.

Run `npm run typecheck`, the relevant existing Node checks and the frozen production browser checks for the affected behavior. The accepted `tests/ui-preview-build.test.ts` inspects actual production artifacts and included modules; `acceptance/ui-components.spec.ts` observes API isolation through entry, interactions, polling intervals and cleanup, modal focus return, pagination and narrow layouts. Preserve all existing acceptance assertions and quality controls. The controller still owns final full verification, independent source review, integration, exact-head GitHub CI and publication. A worker's focused checks do not establish delivery.
