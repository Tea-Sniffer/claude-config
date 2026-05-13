# Planning workflow

A multi-step planning loop that combines codebase exploration, plan drafting,
and adversarial review before any code is written. The goal is to surface gaps,
risks, and over-engineering *before* implementation, and to leave behind a
durable plan artifact in `plans/<slug>.md`.

## Typical session flow

```
1. /explore <focused question about the codebase>
     → exploration output stays in conversation context

2. /plan <implementation goal>
     → slug derived from goal (e.g. create-booking-endpoint)
     → plan written to /tmp/plan-<slug>.md (sections: Goal, Context,
       Constraints, Plan, Open questions)
     → terse summary in conversation: "N steps, M open questions"

3. Loop until the plan is approved:
     a. Plan has open questions → Claude surfaces them → you answer →
        answers added to Constraints → Plan re-dispatched.
     b. Plan has no open questions → reviewer-skeptic and reviewer-optimistic
        run in parallel against /tmp/plan-<slug>.md → findings shown
        separately (skeptic first, then optimist) → you approve or revise.
     c. Revise → feedback added to Constraints → Plan re-dispatched → back to 3a.

4. On approve:
     → confirm slug (rename if you want)
     → write final plan to plans/<slug>.md
     → exit planning mode

5. New turn:
     → "implement the plan at plans/<slug>.md"
```

## Actors

| Name | File | Role |
| --- | --- | --- |
| `/explore` | `commands/explore.md` | Investigates a focused question; output feeds into `/plan` |
| `/plan` | `commands/plan.md` | Orchestrates the loop. Dispatches subagents; manages the plan file |
| Plan (built-in) | — | Drafts the implementation plan from goal + context + constraints |
| `reviewer-skeptic` | `agents/reviewer-skeptic.md` | Adversarial review: risks, gaps, what breaks in prod |
| `reviewer-optimistic` | `agents/reviewer-optimistic.md` | Simplifier: over-engineering, scope to cut, existing reuse |

## File locations

- **Working file**: `/tmp/plan-<slug>.md` — overwritten on every iteration, OS-cleaned.
- **Final artifact**: `plans/<slug>.md` — written once, on approval. `plans/` is created on demand.

The plan file is self-contained (Goal, Context, Constraints, Plan, Open
questions), so reviewers need only its path — no other context-stuffing in
their prompts.

## Design notes

- **Each Plan dispatch is fresh.** No `SendMessage` in this harness, so every
  iteration re-sends the full goal + exploration + prior plan + constraints +
  reviewer feedback. That's the intended pattern, not a workaround.
- **Skeptic and optimist run in parallel** in a single message (two `Agent`
  calls).
- **Findings are not merged.** Skeptic and optimist views are surfaced
  separately — the whole point is to keep both perspectives visible.
- **Claude does not refine the plan itself.** Always re-dispatches the Plan
  subagent.
- **Implementation is a separate turn.** `/plan` exits cleanly after writing
  `plans/<slug>.md`; no code is written in planning mode.

## Tips

- Run `/explore` first when the goal touches unfamiliar code. The exploration
  output becomes the Context section in the plan file.
- If you `/clear` mid-session, the temp file remains but Claude loses the
  workflow context. Re-invoke `/plan` to resume.
- The slug can be renamed at save time — Claude will offer the current one and
  accept a different name.
- For very small changes, planning is overhead. Use `/plan` when the work spans
  multiple files or has non-obvious tradeoffs.
