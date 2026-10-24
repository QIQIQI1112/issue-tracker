# Critical code-only CI

GitHub runs `npm run verify:ci`. The owner-authorized code-only revision removes browser installation, Playwright execution, browser case selection and browser debug uploads. Local final integration continues to run the complete Node suite.

The schema-version-two `ci-critical` contract explicitly selects Node files and required exact file/title identities. Selection must be nonempty, safe and duplicate-free. Every selected file needs a required case; every required case must belong to a selected file. Nonempty browser requirements are rejected.

CI runs four gates: lint, TypeScript checking, selected Node tests, and production build. Real Node report completeness and exact named proofs remain mandatory. Missing, skipped, failed, stale-source or changed-contract evidence fails. The process records `verificationProfile: "code-only"`; it never produces successful browser evidence.

CI retains `.runs/ci-latest.json`, `ci-summary.json`, Node JSONL, logs and process receipts for seven days, including hidden files. GitHub publication still requires the configured exact-head workflow, successful required checks, strict branch protection, confirmed merge and local target synchronization. No checks or reviews may be bypassed.
