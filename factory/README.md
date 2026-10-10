# Future controller boundary

No autonomous coding controller is implemented in this baseline. `scripts/verify.mjs` is an executable verification harness, not a worker dispatcher.

A future controller owns task state, attempt IDs, worktrees, ports, databases, acceptance snapshots, repair dispatch, review, integration, and final verification. Workers may propose changes but do not own the success criteria or completion state.

Use GitHub Issues as the real request source when a remote is configured. `tickets/` demonstrates a portable brief format. Keep controller state outside worker-owned files; never store it in the application database that tests reset.
