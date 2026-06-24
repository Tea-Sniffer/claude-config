export const meta = {
  name: 'explore-deep',
  description: 'Deep codebase exploration: multi-modal sweep, dedup, adversarial verify, synthesize a cited answer',
  whenToUse:
    'For broad impact-analysis ("what breaks if I change X?") and codebase-wide convention sweeps where a single explorer agent would miss sites. Overkill for a simple "where is X" lookup — use /explore for those.',
  phases: [
    { title: 'Sweep', detail: 'one explorer per search modality, each blind to the others' },
    { title: 'Verify', detail: 'adversarially confirm each deduped finding is real and wired up' },
    { title: 'Completeness', detail: 'critic finds uncovered search directions; one targeted re-sweep if needed' },
    { title: 'Synthesize', detail: 'merge confirmed findings into a cited answer' },
  ],
}

// ── Input ───────────────────────────────────────────────────────────────────
// The /explore-deep skill passes the codebase question verbatim. Depending on
// the dispatch path, `args` can arrive as an object ({question}), a JSON-encoded
// string of that object, or the bare question string. Normalise all three — a
// silent fallback here makes every explorer drift to "what's interesting in the
// repo" (i.e. the git diff), which is exactly the failure this guards against.
function resolveQuestion(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') {
    return raw.question ?? raw.q ?? raw.prompt ?? null
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    if (s.startsWith('{')) {
      try {
        const parsed = JSON.parse(s)
        return parsed.question ?? parsed.q ?? parsed.prompt ?? s
      } catch {
        return s // not JSON after all — treat the whole string as the question
      }
    }
    return s // bare question string
  }
  return null
}

const question = resolveQuestion(args)
if (!question) {
  throw new Error(
    'explore-deep: no question was passed in `args`. Expected `args: {question: "..."}` ' +
      '(or a bare question string). Refusing to run a blind sweep — re-dispatch with the question.',
  )
}
log(`Question: ${question}`)

// ── Search modalities ───────────────────────────────────────────────────────
// Each lens searches a DIFFERENT way and is blind to the others. The point is
// coverage: one angle alone reliably misses sites the others catch.
const LENSES = [
  {
    key: 'by-symbol',
    how: 'Search by SYMBOL: class, function, method, constant, interface, and type names related to the question. Grep identifiers, then follow each definition to its call sites. Distinguish the real implementation from look-alikes.',
  },
  {
    key: 'by-content',
    how: 'Search by CONTENT: string literals, log/error messages, comments, config keys, and route paths that mention the concept. These pin down behavior that symbol names hide.',
  },
  {
    key: 'by-wiring',
    how: 'Search by WIRING: service containers, providers, DI registrations, route tables, event subscribers, middleware, schedulers, and config files. Establish which implementation is actually reachable vs. dead code.',
  },
  {
    key: 'by-convention',
    how: 'Search by CONVENTION & STRUCTURE: directory layout, naming patterns, and analogous sibling features. Find how this kind of thing is usually done in THIS codebase and every place that follows (or breaks) the pattern.',
  },
  {
    key: 'by-history',
    how: 'Search by HISTORY: use git log / git blame / git show on the relevant files and symbols to find when and why the current behavior was introduced, and any related code that moved or was deprecated.',
  },
]

// ── Schemas ──────────────────────────────────────────────────────────────────
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'evidence', 'confidence'],
        properties: {
          claim: { type: 'string', description: 'One sentence: what is true and relevant to the question' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string' },
                line: { type: 'integer' },
                note: { type: 'string' },
              },
            },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['confirmed', 'reason'],
  properties: {
    confirmed: { type: 'boolean', description: 'true only if the evidence actually supports the claim AND the code is reachable' },
    reason: { type: 'string' },
    correctedEvidence: { type: 'string', description: 'If the claim was right but the file/line was off, the corrected reference' },
  },
}

const GAPS_SCHEMA = {
  type: 'object',
  required: ['complete', 'gaps'],
  properties: {
    complete: { type: 'boolean' },
    gaps: {
      type: 'array',
      items: { type: 'string', description: 'A specific, actionable search direction not yet covered' },
    },
  },
}

const ANSWER_SCHEMA = {
  type: 'object',
  required: ['answer', 'evidence', 'caveats'],
  properties: {
    questionType: { type: 'string', enum: ['location', 'flow-trace', 'impact-analysis', 'convention-discovery', 'other'] },
    answer: { type: 'string', description: 'Lead with the direct answer to the question' },
    evidence: { type: 'array', items: { type: 'string', description: 'file:line — what it shows' } },
    caveats: { type: 'array', items: { type: 'string' } },
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const seen = new Set()
const keyOf = (f) => {
  const e = (f.evidence && f.evidence[0]) || {}
  return e.file ? `${e.file}:${e.line ?? ''}` : (f.claim || '').toLowerCase().trim()
}

// One full sweep → dedup-vs-seen → adversarial verify. Reused for the re-sweep.
async function sweepAndVerify(directives, round) {
  // Sweep — barrier: we need every modality's findings before deduping.
  const swept = await parallel(
    directives.map((d) => () =>
      agent(
        `Investigate this codebase question:\n\n${question}\n\n` +
          `Your assigned approach for this pass:\n${d.how}\n\n` +
          `Return concrete findings, each with file/line evidence. Read enough to be confident; do not guess. ` +
          `If your approach surfaces nothing relevant, return an empty findings list.`,
        { label: `sweep:${d.key} (r${round})`, phase: 'Sweep', agentType: 'codebase-explorer', schema: FINDINGS_SCHEMA },
      ),
    ),
  )
  const all = swept.filter(Boolean).flatMap((r) => r.findings || [])
  const fresh = []
  for (const f of all) {
    const k = keyOf(f)
    if (!seen.has(k)) {
      seen.add(k)
      fresh.push(f)
    }
  }
  log(`Round ${round}: ${all.length} raw findings → ${fresh.length} fresh after dedup`)
  if (!fresh.length) return []

  // Verify — barrier. Default to NOT confirmed when the evidence is weak.
  const verified = await parallel(
    fresh.map((f) => () =>
      agent(
        `Adversarially verify a finding about this codebase. Try to REFUTE it. ` +
          `Open the cited files and check the evidence actually supports the claim, and that the code is reachable ` +
          `(wired up, not dead). Default to confirmed=false if you cannot positively confirm it.\n\n` +
          `Question context: ${question}\n\nClaim: ${f.claim}\nEvidence: ${JSON.stringify(f.evidence)}`,
        { label: `verify (r${round})`, phase: 'Verify', agentType: 'codebase-explorer', schema: VERDICT_SCHEMA },
      ).then((verdict) => ({ ...f, verdict })),
    ),
  )
  return verified.filter(Boolean).filter((f) => f.verdict?.confirmed)
}

// ── Phase 1+2: Sweep & verify (round 1) ──────────────────────────────────────
phase('Sweep')
const confirmed = []
confirmed.push(...(await sweepAndVerify(LENSES, 1)))

// ── Phase 3: Completeness critic → one bounded re-sweep ───────────────────────
phase('Completeness')
const critique = await agent(
  `You are a completeness critic for a codebase investigation. Given the question and the confirmed findings ` +
    `so far, name SPECIFIC search directions that have not been covered — a modality not run, a call chain not ` +
    `followed, a subsystem not checked, a claim that should exist but is missing. If coverage is genuinely ` +
    `complete, set complete=true and return no gaps.\n\n` +
    `Question: ${question}\n\nConfirmed findings:\n${JSON.stringify(
      confirmed.map((f) => ({ claim: f.claim, evidence: f.evidence })),
      null,
      2,
    )}`,
  { label: 'completeness-critic', phase: 'Completeness', agentType: 'codebase-explorer', schema: GAPS_SCHEMA },
)

if (!critique.complete && (critique.gaps || []).length) {
  log(`Completeness critic flagged ${critique.gaps.length} gap(s); running one targeted re-sweep`)
  const gapDirectives = critique.gaps.map((g, i) => ({ key: `gap${i + 1}`, how: g }))
  confirmed.push(...(await sweepAndVerify(gapDirectives, 2)))
} else {
  log('Completeness critic: coverage sufficient, no re-sweep')
}

// ── Phase 4: Synthesize ───────────────────────────────────────────────────────
phase('Synthesize')
const answer = await agent(
  `Synthesize the final answer to a codebase question from the verified findings below. ` +
    `Lead with the direct answer. Back it with file:line evidence. Note caveats (dead code, alternate paths, ` +
    `subtle differences). Classify the question type. Use ONLY the verified findings — do not invent references.\n\n` +
    `Question: ${question}\n\nVerified findings:\n${JSON.stringify(
      confirmed.map((f) => ({ claim: f.claim, evidence: f.evidence, confidence: f.confidence })),
      null,
      2,
    )}`,
  { label: 'synthesize', phase: 'Synthesize', schema: ANSWER_SCHEMA },
)

return { ...answer, confirmedCount: confirmed.length }
