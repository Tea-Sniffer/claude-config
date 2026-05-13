---
description: Plan an implementation with a reviewer feedback loop. Iterates plan ↔ reviewers ↔ user until approved, then writes to plans/<slug>.md.
argument-hint: <implementation goal>
---

Begin a planning session for the following goal:

$ARGUMENTS

The rules below define a workflow that **persists for the rest of this conversation** — follow them on every subsequent turn, not just this one, until the plan is saved and you explicitly exit planning mode.

## Setup (turn 1 only)

1. **Derive a slug** from the goal — short, kebab-case, descriptive (e.g., `create-booking-endpoint`). State it once so the user can object; you'll confirm/rename at save time.
2. **Set the temp path**: `/tmp/plan-<slug>.md`.
3. **Pull exploration context** from prior turns in this conversation (typically from a preceding `/explore` run). If the goal is non-trivial and exploration is absent, ask the user whether to run `/explore` first — do not invent context.

## Plan dispatch (every iteration)

Build a prompt for the built-in **Plan** subagent containing, in order:

- The original goal
- Exploration summary (or pointer to where it lives in the conversation)
- The most recent plan, if any — verbatim
- The user's accumulated Constraints (decisions locked in across iterations)
- Reviewer feedback from the most recent review pass, if any

Dispatch the Plan subagent. When it returns, **you (Claude) write the file** to `/tmp/plan-<slug>.md` using this structure:

```markdown
# Plan: <one-line goal>

## Goal
<original ask>

## Context
<exploration summary or pointer>

## Constraints
<user-locked decisions, accumulated across iterations>

## Plan
<step-by-step from the Plan subagent>

## Open questions
<from the Plan subagent — empty when ready for review>
```

In conversation, **do not paste the plan**. Report tersely: "Plan written to `/tmp/plan-<slug>.md` — N steps, M open questions."

## Branch: open questions

- **Open questions exist** → surface them verbatim to the user. Wait for answers. When the user answers, add the answers to Constraints and re-dispatch Plan (back to "Plan dispatch"). Loop until Open questions is empty.
- **No open questions** → go to review pass.

## Review pass

Dispatch `reviewer-skeptic` and `reviewer-optimistic` **in parallel** — both Agent calls in a single message. Each receives only the plan file path (`/tmp/plan-<slug>.md`); the file is self-contained so no other context is needed in their prompts.

When both return, present their findings to the user **separately, not merged**:

1. Skeptic's concerns first, grouped by severity as the agent returns them.
2. Optimist's suggestions second, grouped by type as the agent returns them.

Then ask: approve, or revise?

## Branch: user response

- **Approve** → confirm the slug (offer the current one, let the user rename), `mkdir -p plans/`, write the final plan content to `plans/<final-slug>.md`. State the path. Exit planning mode.
- **Revise** (any feedback, new constraints, scope change) → add the feedback to Constraints and re-dispatch Plan (back to "Plan dispatch"). The new plan goes through the same open-questions/review cycle.

## Hard rules — do not violate

- **Never refine the plan yourself.** Always re-dispatch the Plan subagent with full context.
- **The Plan subagent is one-shot.** Every dispatch includes the full goal, exploration, prior plan, constraints, and latest feedback. There is no SendMessage in this harness.
- **Reviewers run on every iteration where Open questions is empty** — not just once.
- **The plan file is the source of truth.** Overwrite `/tmp/plan-<slug>.md` on each iteration; reviewers always read the latest.
- **Implementation is NOT part of this command.** After save, tell the user to start a new turn to implement. Do not write code in planning mode.
