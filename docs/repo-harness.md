# Inspect repository harness configuration

Select an enrolled repository, then **Repo harness**. The overview identifies the repository, target branch and actual committed revision used by the read. Counts describe supplied sources, configured commands and named profile requirements. They do not establish execution or passing results. When named Node requirements are absent, runner discovery remains unknown; this does not establish an absence of Node tests.

**Configuration and check manifests** groups package scripts and the separate full and CI profiles. **Workflow and documentation** contains runner sources, the enrolled CI workflow and repository documents. Source summaries show availability, including missing, malformed, unsupported, oversized and unreadable states, without opening them. A failed source does not prevent inspecting valid sources.

Click a source summary, or reach it with Tab or Shift+Tab and press Enter or Space, to inspect its commands, requirements, explanation and exact path, commit, blob and byte provenance when supplied. Each source opens independently. Use its secondary **Committed source text** disclosure to read the complete supplied file as plain text. Opening sources never runs commands or executes embedded markup.

**Refresh harness** reads committed configuration again and collapses the inspected sources while retaining keyboard focus on the read control. **Retry harness read** recovers a failed or unavailable read. Changing repositories retains the selected subview and clears the previous content and disclosure state. **All repositories** returns to Issues. The Issues subview remains available during reads and failures.
