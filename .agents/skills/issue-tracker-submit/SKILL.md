---
name: issue-tracker-submit
description: Turn a user's authorized business requirement from a Codex conversation into a complete issue-tracker plan, submit it to the local workbench, and retrieve execution status. Use for delivery through the workbench; direct repository maintenance and harness engineering follow the normal repository workflow.
---

# Submit a conversation requirement

Keep the user in the conversation. Capture the business goal, necessary constraints, ordinary defaults with reasons, and independently verifiable issues with dependencies. Preserve the original goal for whole-requirement acceptance. Read [the submission contract](../../../docs/conversation-intake.md) for the JSON format and commands.

Locate the platform checkout and running API. From that checkout, run `npm run submit-plan -- --list`. For a nondefault instance, supply `--url` and `--database`. Choose the enrolled repository matching the user's intended target. Never infer a repository ID from its position or register a different target without authorization.

Ask about unresolved business choices only when necessary. When the user authorizes execution, create one complete version-one plan under `.runs/submissions/`. Generate a UUID submissionId once and persist it before any request. Use the actual conversation ID or a stable local conversation reference, with a concise agreed-goal summary. Do not copy the entire chat. Use lowercase issue keys and key-based dependencies; make the graph acyclic. Use English harness records while preserving requested product language and behavior.

Validate offline with `npm run submit-plan -- <plan.json> --validate`, then submit with `npm run submit-plan -- <plan.json>`. Submission automatically queues independent coverage review. Report the returned Requirement and issue IDs, receipt path, and current status. A queued receipt establishes submission, not verified delivery.

The existing queue owns implementation, verification, independent review, and local integration. Do not develop the same submitted issues in the conversation checkout or start a competing executor. The controller chooses protected scope, budgets, and verification commands; the submitted plan cannot override them.

If a response is lost, query `npm run submit-plan -- --status <submissionId>` or retry the exact saved plan. A retry with the same ID and content returns the existing work. Changed content needs a new submission ID. A replay never restarts failed work. Inspect a Blocked report before requesting a retry; revised business work is a new immutable plan.

Retrieve status with `--status` and inspect the returned run report URLs or retained receipt. Claim Done only when the platform records whole-requirement completion after verified child merges and original-goal acceptance. This local integration does not publish or merge a GitHub PR.
