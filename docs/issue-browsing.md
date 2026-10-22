# Browsing issues

The Issues view shows compact, read-only summaries with the title, identifier, status, priority and creation date. Titles occupy at most two lines. Each row shows up to two shortened labels and a count of additional labels. Open either the title or identifier to inspect the complete description, all labels, diagnostics, logs and audit evidence. Close the dialog with Escape or Close dialog to return focus to its opener.

Use the repository sidebar to scope the collection, then combine title/description search, status and label filters. Label choices include the entire selected repository. Newest, priority and title sorting apply to all matches before pagination. Each page contains up to 10 issues; the result range and Previous/Next buttons expose the full matching collection. No matches shows an empty range and offers Reset filters.

Changing search, status, label, sort or repository starts at page 1. Switching between Issues and Repo harness for the same repository keeps browsing state. Background refresh keeps the current page when valid, moves to the last available page if results shrink, and retains previously loaded rows after a read failure. Empty results use page 1 so newly arriving matches are visible.

Scroll within the bounded issue list to inspect rows while its heading and pagination remain outside the scrolling area. Search, filters, row openers and pagination support keyboard navigation at desktop and phone widths. Paging uses the loaded collection locally and sends no issue changes or execution requests.
