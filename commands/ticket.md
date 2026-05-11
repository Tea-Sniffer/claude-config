---
description: Draft (and optionally create) a Jira ticket in the TP project format
argument-hint: <description of the work that needs a ticket>
---

Use the **tp-ticket-drafter** subagent to draft a Jira ticket for the
following work:

$ARGUMENTS

Follow the subagent's standard flow: gather context, draft the full ticket,
ask for confirmation before creating. Do not create the ticket without
explicit confirmation in this turn.
