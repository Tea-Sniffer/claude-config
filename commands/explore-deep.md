---
description: Deep codebase exploration via a multi-agent workflow — multi-modal sweep, dedup, adversarial verify, synthesize. For impact-analysis and codebase-wide sweeps; use /explore for simple lookups.
argument-hint: <broad question, e.g. "what breaks if I rename Quote::total?">
---

Investigate this codebase question using the **`explore-deep`** workflow:

$ARGUMENTS

## When to use this vs. /explore

`explore-deep` fans out multiple explorer agents and verifies every hit, so it
costs more and runs longer. Use it only when breadth pays off:

- **Impact-analysis** — "what breaks if I change/rename/remove X?"
- **Codebase-wide convention sweeps** — "everywhere we do X", "all the places that follow/break pattern Y"

For a simple **location** ("where is X?") or a serial **flow-trace** ("how does
Y flow end to end?"), stop and use `/explore` instead — a single explorer agent
is faster and the fan-out adds nothing. If the question is clearly one of those,
say so and suggest `/explore` rather than running this workflow.

## Dispatch

Invoke the `Workflow` tool with `name: "explore-deep"` and pass the question via
`args`:

```json
{ "question": "<the full question, verbatim>" }
```

The workflow returns:

```json
{
  "questionType": "impact-analysis",
  "answer": "<direct answer>",
  "evidence": ["file:line — what it shows", ...],
  "caveats": ["..."],
  "confirmedCount": 12
}
```

## Presenting the result

When the workflow completes, render the answer in the standard explorer format —
**do not paste raw JSON**:

```
## Answer
<answer>

## Evidence
- <each evidence entry>

## Caveats
- <each caveat>   (omit the section if there are none)
```

Close with a one-line note: "(explore-deep: N findings confirmed across the
sweep)". If `confirmedCount` is 0, say the sweep found nothing it could verify
and suggest narrowing or rephrasing the question.
