export const meta = {
  name: 'plan-judge-panel',
  description: 'Generate N independent implementation plans from different angles, score them, and synthesize a winner',
  whenToUse: 'The plan-generation engine inside the /plan-deep skill, replacing a single Plan-subagent dispatch. Produces a stronger first draft per iteration.',
  phases: [
    { title: 'Draft', detail: 'one planner per angle, in parallel' },
    { title: 'Judge', detail: 'score every draft on multiple criteria' },
    { title: 'Synthesize', detail: 'merge the winner + best ideas from runners-up' },
  ],
}

// ── Inputs ────────────────────────────────────────────────────────────────
// The /plan-deep skill passes everything the Plan subagent would normally get,
// as a single object. Nothing here is user-gated — it runs start to finish.
//
// Robustness: the Workflow tool expects `args` as a real JSON value, but the
// caller sometimes hands it over as a JSON-encoded *string*. If we destructured
// a string we'd silently get all the "(no … provided)" defaults and run the
// whole panel on empty context. So coerce a string back into an object first.
const parsedArgs =
  typeof args === 'string'
    ? (() => {
        try {
          return JSON.parse(args)
        } catch {
          // A bare, non-JSON string is treated as the goal itself.
          return { goal: args }
        }
      })()
    : args ?? {}

const {
  goal = '(no goal provided)',
  exploration = '(no exploration context)',
  priorPlan = '(none — first iteration)',
  constraints = '(none yet)',
  feedback = '(none — first iteration)',
} = parsedArgs

// Fail loud instead of burning a panel run on empty context.
if (goal === '(no goal provided)') {
  throw new Error(
    'plan-judge-panel: no goal in args. Pass args as a JSON object ' +
      '{ goal, exploration, priorPlan, constraints, feedback } — not a stringified value.',
  )
}

// The angles that make the panel diverse. Each planner is blind to the others.
const ANGLES = [
  { key: 'mvp-first',  lens: 'Smallest correct change that ships value. Ruthlessly cut scope; defer anything not strictly required.' },
  { key: 'risk-first', lens: 'What breaks in production? Lead with the failure modes, migrations, and edge cases; design to de-risk them.' },
  { key: 'user-first', lens: 'Work backward from the developer/end-user experience and the public API surface; let that drive the internal design.' },
]

const sharedContext = `
# Goal
${goal}

# Exploration context
${exploration}

# Prior plan (verbatim, may be empty)
${priorPlan}

# Constraints (user-locked decisions)
${constraints}

# Latest reviewer / user feedback (may be empty)
${feedback}
`.trim()

// ── Schemas ───────────────────────────────────────────────────────────────
const PLAN_SCHEMA = {
  type: 'object',
  required: ['summary', 'steps', 'openQuestions'],
  properties: {
    summary: { type: 'string', description: 'One-line description of the approach' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const SCORE_SCHEMA = {
  type: 'object',
  required: ['correctness', 'simplicity', 'completeness', 'rationale'],
  properties: {
    correctness:  { type: 'integer', minimum: 1, maximum: 10 },
    simplicity:   { type: 'integer', minimum: 1, maximum: 10 },
    completeness: { type: 'integer', minimum: 1, maximum: 10 },
    rationale:    { type: 'string' },
    bestIdea:     { type: 'string', description: 'The single strongest idea in this plan, even if the plan loses overall' },
  },
}

const SYNTH_SCHEMA = PLAN_SCHEMA // synthesized output is just another (better) plan

// ── Phase 1: Draft — one planner per angle, concurrently ────────────────────
phase('Draft')
const drafts = await parallel(
  ANGLES.map((a) => () =>
    agent(
      `You are an implementation planner working under the "${a.key}" lens.\n\n${a.lens}\n\n` +
        `Produce a step-by-step implementation plan for the goal below. Respect every locked constraint. ` +
        `If something is genuinely undecidable, list it under openQuestions rather than guessing.\n\n${sharedContext}`,
      { label: `draft:${a.key}`, phase: 'Draft', agentType: 'Plan', schema: PLAN_SCHEMA },
    ).then((plan) => ({ angle: a.key, plan })),
  ),
)
const validDrafts = drafts.filter(Boolean)
log(`${validDrafts.length}/${ANGLES.length} drafts produced`)

// ── Phase 2: Judge — every draft scored by an independent panel ─────────────
// Barrier is justified here: synthesis needs ALL scores together to rank.
phase('Judge')
const judged = await parallel(
  validDrafts.map((d) => () =>
    agent(
      `Score this implementation plan on a 1–10 scale for correctness, simplicity, and completeness, ` +
        `relative to the goal and constraints. Be a harsh grader. Also name its single best idea.\n\n` +
        `## Goal & constraints\n${sharedContext}\n\n## Plan to score (angle: ${d.angle})\n${JSON.stringify(d.plan, null, 2)}`,
      { label: `judge:${d.angle}`, phase: 'Judge', schema: SCORE_SCHEMA },
    ).then((score) => ({ ...d, score, total: score.correctness + score.simplicity + score.completeness })),
  ),
)
const ranked = judged.filter(Boolean).sort((a, b) => b.total - a.total)
const winner = ranked[0]
const runnersUp = ranked.slice(1)
log(`Winner: ${winner.angle} (${winner.total}/30). Runners-up: ${runnersUp.map((r) => `${r.angle} ${r.total}`).join(', ')}`)

// ── Phase 3: Synthesize — winner + grafted best ideas ───────────────────────
phase('Synthesize')
const finalPlan = await agent(
  `Synthesize the strongest possible implementation plan. Start from the winning plan, then graft in the ` +
    `best ideas from the runners-up where they improve it without bloating scope. Keep it coherent — ` +
    `do not just concatenate. Carry forward every unresolved open question.\n\n` +
    `## Goal & constraints\n${sharedContext}\n\n` +
    `## Winning plan (${winner.angle}, scored ${winner.total}/30)\n${JSON.stringify(winner.plan, null, 2)}\n\n` +
    `## Best ideas from runners-up\n${runnersUp.map((r) => `- [${r.angle}] ${r.score.bestIdea}`).join('\n')}`,
  { label: 'synthesize', phase: 'Synthesize', agentType: 'Plan', schema: SYNTH_SCHEMA },
)

// Returned to the /plan skill, which writes it into /tmp/plan-<slug>.md exactly
// as it does today with the single-dispatch output.
return {
  plan: finalPlan,
  winningAngle: winner.angle,
  scoreboard: ranked.map((r) => ({ angle: r.angle, total: r.total, rationale: r.score.rationale })),
}