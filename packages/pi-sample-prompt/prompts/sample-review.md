---
description: "Review staged or recent changes with a focused checklist"
argument-hint: "[focus]"
---
Review the staged changes (or recent commits if nothing is staged) in the current repository.

Primary focus: ${1:-correctness, security, and tests}
Additional scope or notes: ${@:2}
Full invocation arguments: $@

Inspect the relevant diff and surrounding files, then provide:
1. Summary of what changed and any assumptions.
2. Findings prioritized by severity (bugs, edge cases, regressions, or security risks) aligned with the primary focus.
3. Missing or weak test coverage and concrete follow-up checks.
