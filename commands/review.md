---
description: Review code using the code-reviewer subagent. Defaults to staged changes, or pass a target.
argument-hint: [optional: git range, file path, directory, glob, or feature description]
---

Use the **code-reviewer** subagent to review code.

Target: $ARGUMENTS

If the target above is empty, review staged changes (or the most recent commit
if nothing is staged). Otherwise, review whatever was specified — the subagent
knows how to handle git ranges, file paths, directories, globs, and feature
descriptions.

State which scope you reviewed at the top of the output.

**This command is read-only. Report findings only — do NOT modify code.**
Do not edit files, apply fixes, or run formatters/auto-fixers — not even for
"obvious" or "trivial" findings, and not even when the review surfaces a bug in
work you were mid-way through. Surface each finding with its `file:line`,
severity, and a *described* fix (or a fenced code suggestion), then stop and wait.
Only act on findings if the user explicitly asks you to in a later message.