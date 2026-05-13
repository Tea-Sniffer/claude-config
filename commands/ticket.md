---
description: Draft (or update) a Jira ticket in Raphael's format
argument-hint: <description> | <BOARD> <description> | <TP-123> [new info]
---

Use the **jira-ticket-drafter** subagent to handle the following request:

$ARGUMENTS

How to interpret the arguments (the subagent makes the final call — these are guidelines):

- If the first token matches `[A-Z]+-\d+` (e.g. `TP-1042`), this is an **update** request.
  - With additional text after the key → path A: fetch, fold in the new info, draft the update, confirm before editing.
  - With nothing after the key → path B: fetch and display the current ticket so the user can research. Do not propose changes yet.
- If the first token is a bare uppercase project key (e.g. `TPI`, `OPS`), treat it as a **board override** and create a new ticket on that project using the rest as the description.
- Otherwise, create a new ticket on the default board `TP`.

Always follow the subagent's standard flow: gather context, draft the full ticket (or updated ticket), ask for confirmation before mutating Jira. Do not create or edit without an explicit confirmation in this turn.