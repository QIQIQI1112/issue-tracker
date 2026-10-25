# Inspect repository harness configuration

Select an enrolled repository in the left toolbar, then **Repo harness** in the upper page toolbar. The overview identifies the repository, target branch and actual committed revision used by the read. Counts describe supplied sources, configured commands and named profile requirements. They do not establish execution or passing results. When named Node requirements are absent, runner discovery remains unknown; this does not establish an absence of Node tests.

**Configuration and check manifests** groups package scripts and the separate full and CI profiles. **Workflow and documentation** contains runner sources, the enrolled CI workflow and repository documents. Source summaries show availability, including missing, malformed, unsupported, oversized and unreadable states, without opening them. A failed source does not prevent inspecting valid sources.

Click a source summary, or reach it with Tab or Shift+Tab and press Enter or Space, to inspect its commands, requirements, explanation and exact path, commit, blob and byte provenance when supplied. Each source opens independently. Use its secondary **Committed source text** disclosure to read the complete supplied file as plain text. Opening sources never runs commands or executes embedded markup.

**Refresh harness** reads committed configuration again and collapses the inspected sources while retaining keyboard focus on the read control. **Retry harness read** recovers a failed or unavailable read. Changing repositories opens the new repository Requirements and clears the previous harness content and disclosure state. The upper toolbar keeps Requirements and explicit Unassigned history available during reads and failures.
