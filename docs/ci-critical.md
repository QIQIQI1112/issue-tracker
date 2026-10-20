# Critical GitHub CI profile

The protected `factory/ci-verification-contract.json` defines the `ci-critical` remote selection: explicit Node test files and required file/title identities for every selected file, plus six browser behaviors. It covers validation, real API/SQLite behavior, ownership, budgets, conversation intake, persistence, focus regression and all GitHub publication admission/recovery cases. Additive CI policy and runner regressions test the profile itself.

This contract revision is inactive until the dependent harness issue enables `verify:ci`. The parser rejects unknown fields, empty selections, duplicate files/cases, unsafe paths and incomplete file/case mappings. The manifest is an owner-reviewed selection, not a worker-supplied filter. Changes to this selection require separate acceptance-contract review.

The full `factory/verification-contract.json`, `scripts/verify.mjs`, trusted controller verifier, existing tests and all local verification gates remain unchanged. Child verification, integrated verification and whole-requirement acceptance continue to run the complete suite with independent review. A critical CI result proves only the declared remote subset and cannot replace those reports.

The initial manifest includes the names of the forthcoming runner regression checks. The dependency keeps the remote profile inactive until those checks and its implementation are delivered together. This declaration does not change full test discovery or activate a partial controller verifier.
