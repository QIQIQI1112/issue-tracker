# Conversation-to-workbench intake

Discuss a business requirement with Codex and ask it to submit the complete plan to the workbench. The repo skill is `.agents/skills/issue-tracker-submit/SKILL.md`; explicitly invoke `$issue-tracker-submit` when useful. The website is an inspection surface; operations belong to the agent and existing API/CLI. See the [read-only acceptance revision](read-only-acceptance.md) for the transition. Repository skills are discovered under `.agents/skills` according to [official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills).

Issues is the primary inspection workspace. Open an issue title or LOC identifier for read-only diagnostics; Escape or Close restores focus to the opener. Associated requirement context includes the original goal, repository, source kind/summary/reference, submission ID and plan hash. Standalone issues and unavailable provenance are explicit. Repository and requirement administration remain available through the existing API/CLI; the Workbench navigation and manual administration page have been removed. No website form or manual Start is needed for conversation submissions.

Select an issue execution or owned requirement audit run (decomposition, plan review or whole-goal verification) to read its report and retained evidence. Historical failed reports remain available after successful retries. Current job/run failures and delivery limitations are separate from selected historical reports. Loading, running without a report, terminal report unavailability and request errors are explained with read-retry controls. The website exposes no create/delete/edit or execution-start/retry actions. Issue and requirement retries use the existing API and preserve merged children and review gates; backend admission rejects duplicate execution. HTTP replay remains read-back and cannot retry blocked work.

Expand Evidence and select a manifest-listed log, JSON, Markdown, diff or supported text artifact to read escaped plain text inline, up to 1 MiB (1,048,576 received bytes). Loading, empty files, errors and retry are explicit. Binary, unsupported and oversized artifacts retain download links. Artifact/run/issue changes and dialog closure abort obsolete previews.

## Commands

Run commands from the platform checkout after `npm run dev`:

```sh
npm run submit-plan -- --list
npm run submit-plan -- .runs/submissions/plan.json --validate
npm run submit-plan -- .runs/submissions/plan.json
npm run submit-plan -- --status <submission-id>
```

`--list` returns the running API identity and enrolled repositories without submitting work. Use its actual repository ID. `--validate` checks the complete contract offline. Submission creates and queues the plan automatically; no website form or Start button is required. `--status` reads the current Requirement, issues, jobs, runs, and report URLs. A successful command means its API operation succeeded; it does not assert completed development. Inspect issue diagnostics and submitted work status for delivery evidence: recorded child merges and the latest completed whole-goal verification must agree before a goal is shown as verified. A manually selected Done status or passed plan review alone is insufficient.

For another local instance, supply `--url http://127.0.0.1:<port>` and `--database /absolute/path/to/issues.sqlite`. The client verifies the API database and pins its instance identity on the mutation. It rejects remote origins in this local version. `--receipt <path>` selects the retained full response; by default receipts and normalized input are saved under `.runs/submissions/<submission-id>/`. Both accepted plans and controller evidence also remain in the platform database and `.data/evidence/`.

## Version-one plan

Persist a fresh UUID once for each new immutable plan. Replace the illustrative ID, repository ID, source reference, and business content below with real values:

```json
{
  "schemaVersion": 1,
  "submissionId": "9ee94710-8443-42df-8ffd-63676f80e77d",
  "repoId": 1,
  "requirement": {
    "title": "Filter issues by priority",
    "goal": "Users can filter by High, Medium, or Low priority and combine it with existing status and label filters. All priorities is the default."
  },
  "source": {
    "kind": "codex",
    "reference": "actual-conversation-id-or-stable-local-reference",
    "summary": "The user requested priority filtering and agreed that refreshing may reset the selection."
  },
  "assumptions": [
    { "decision": "Keep filtering in the existing issue list", "reason": "The application already loads the complete local collection." }
  ],
  "issues": [
    {
      "key": "priority-filter",
      "title": "Add priority filtering",
      "description": "Add a priority selector to the list and combine its selection with the existing filters.",
      "acceptance": [
        "All priorities is initially selected and preserves the existing list.",
        "Each priority shows only matching issues.",
        "Priority combines with status and label filtering, including an accessible empty result."
      ],
      "dependsOn": []
    }
  ]
}
```

The schema allows 1–20 issues, at most 30 assumptions, and 1–30 acceptance conditions per issue. Titles have at most 120 characters, issue descriptions 2,000, the business goal 10,000, source summary 2,000, and individual acceptance conditions 1,000. Keys have 1–64 lowercase letters, digits, or hyphens. Dependencies reference keys from this same submission; duplicate keys, repeated dependencies, missing keys, and cycles are rejected. Source reference is at most 1,000 characters. Submission IDs contain 1–100 letters, digits, underscores, or hyphens. Serialized HTTP input is limited to 64 KiB. Unknown fields are rejected; plans cannot set execution status, scope, budgets, review approval, or verification commands.

## Admission and execution

`POST /api/plan-submissions` atomically stores the original goal, source summary, canonical plan hash, all issues, and resolved dependency IDs. It queues exactly one `plan_review` job, with no implementation jobs yet. The response includes the Requirement, key-to-ID mapping, jobs, and source record. New submissions return HTTP 201. Repeating the same ID and canonical content returns HTTP 200 with the same IDs; changing its content returns HTTP 409. `GET /api/plan-submissions/:id` reads the full immutable plan and current execution index.

SQLite schema version 4 adds `plan_submissions` without rewriting existing requirements, jobs, issues, labels, or run history. A database failure rolls back the whole intake transaction. Pending, rejected, and approved submitted-plan issues cannot be edited or removed. Revised work uses a new plan and submission ID. The source is descriptive provenance claimed by the submitting client, not an authenticated team identity.

The controller reviews the submitted plan against the original goal and exact target source; it does not ask another planner to replace the submitted decomposition. Admission requires an approved independent review without blocking findings and an unchanged source/target. It retains the submitted plan, source/hash record, review prompts/response, and a standard delivery report. Only successful review admission transactionally queues the submitted issues. Direct issue starts cannot bypass this gate.

Existing issue execution then proves behavior checks, verifies, reviews, integrates locally, and respects merge dependencies. The existing final requirement job checks the original goal after all child merges. Rejection, reviewer mutation, target movement, dirty targets, or interruption blocks the requirement and leaves its submitted issues unstarted. HTTP replay is read-back, not a retry action. Start the blocked requirement after addressing an infrastructure problem to obtain a new review or execution run while retaining existing IDs and completed merges. Business revisions need a new plan.

## Scope

This change provides conversation-origin submission into the existing local queue. It does not implement team authentication, remote worker leases, MCP hosting, GitHub PR publishing, or remote automatic merge. The Node/Playwright execution profile and local integration rules remain those in [the workbench](workbench.md). The client protocol can later sit behind an authenticated MCP tool without replacing the admission logic.

`tests/submission.test.ts` proves atomic intake, cross-connection/replayed requests, invalid/conflicting input, midway transaction rollback, immutable review gating, lost HTTP response recovery through the actual CLI, interrupted review, and the complete existing merge/whole-goal queue. Browser acceptance submits through the CLI and inspects the same imported Requirement and source without filling the website's creation form. Deterministic worker adapters prove orchestration; model quality remains a separate measurement.

## Classified maintenance plans

Version two adds an optional issue-level `changeKind`: `feature`, `acceptance_contract`, or `harness`, defaulting to feature. Unknown kinds and execution-authority fields are rejected. Version-one parsing and canonical plan hashes remain unchanged. Existing submissions and evidence are never rewritten. SQLite migration five stores classification separately from legacy issue context.

Additive business tests stay with their feature and receive independent review before implementation. Changed acceptance rules and harness changes need separate issues and explicit prerequisites. Maintenance jobs wait for the owner workflow; the ordinary queue cannot execute them. A declaration is not permission. The owner records a completed maintenance issue only from independently approved exact source, actual machine reports, verified dependencies, and a real target commit. Its standard delivery is visible through the existing report controls.

For a GitHub-enrolled repo, new requirements snapshot the owner publication settings and reserved branch. Existing conversation-plan fields and replay identities stay unchanged. The returned requirement includes optional publication metadata; Done requires the confirmed GitHub merge after whole-goal acceptance and CI. See [GitHub delivery](github-delivery.md).
