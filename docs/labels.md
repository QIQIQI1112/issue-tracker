# Issue labels contract

Labels categorize issues and provide an exact label filter that combines with existing title/description search and status filters.

## Recorded defaults

- Labels are an array of strings. Creation defaults to an empty array.
- Trim surrounding whitespace, lowercase values, and deduplicate while preserving first occurrence order. This makes spelling and filtering predictable.
- Accept at most 10 supplied labels, each containing 1–20 Unicode code points after normalization. Empty entries and non-string values are rejected.
- An omitted patch preserves labels. An explicit empty array removes all labels.
- The form accepts comma-separated labels. Commas and control characters are rejected by both the API and form so labels round-trip without changing meaning.
- A new issue clears active filters so the newly created record is visible.

## Persistence

Schema version 2 adds a JSON label array to each issue. Ordered migrations run in SQLite transactions; existing version-one records receive empty label arrays without changing their IDs or other fields. Newer schema versions are refused rather than downgraded. Reset is not a migration strategy.

## Acceptance extension

The original title, description, status, priority, and immutable-field requirements remain. The existing creation-default assertion is extended with `labels: []`, preserving every previous expected value. New checks cover normalization, boundaries, API rejection without writes, schema upgrades, browser editing/filtering/clearing, and full server restart persistence.

Task input is recorded in `tickets/001-labels.json`. The controller freezes its approved acceptance snapshot and requires the corresponding tests; changing a criterion creates a new contract revision.
