/**
 * F0 smoke-test (#289) — proves the @dopadone/core consumption seam end-to-end.
 *
 * Imports the PURE primitives the bash→TS port will rely on, exercises a few at
 * runtime, and exits 0 on success. The point is twofold:
 *   1. Runtime: the primitives execute in a plain Node context (this file, once
 *      esbuild-bundled to CJS, runs under `node dist/f0-smoke.cjs`).
 *   2. Bundle cleanliness: `pnpm build:smoke` emits dist/meta.json; the audit
 *      asserts the bundle drags ZERO node:fs / crypto / path / vault / connectors
 *      code (the `.` entry is verified pure, so esbuild inlines only pure code).
 *
 * This is the permanent regression check for the seam — kept as `build:smoke`.
 */
import {
  BUILTIN_SLEEP_PHASES,
  evaluateEnforcement,
  formatFormula,
  parseFormula,
  type PlanItem,
  phaseFor,
  phaseFormula,
  surfacingProbability
} from '@dopadone/core'

function main(): void {
  // Fixed wall-clock instant so the output is deterministic: 22:30 local = wrap-up phase.
  const now = new Date()
  now.setHours(22, 30, 0, 0)

  const phase = phaseFor(now)
  const activePhaseFormula = phaseFormula(now)

  // parseFormula → formatFormula round-trip (the serialized DSL the hook reads/writes).
  const parsed = parseFormula('hard-block-before:30')
  const reserialized = parsed ? formatFormula(parsed) : '(null)'

  // A synthetic plan item to drive the enforcement + probability engine.
  const item: PlanItem = {
    task_id: 'f0-smoke',
    source_type: 'habit',
    content: 'F0 smoke item',
    added_at: now.toISOString(),
    window_start: 22 * 60 + 45, // 22:45 → within the hard-block-before:30 run-up
    formula: 'hard-block-before:30'
  }
  const enforcement = evaluateEnforcement(item, now)
  const probability = surfacingProbability(item, now)

  console.log('[F0 smoke] @dopadone/core pure primitives imported + executed:')
  console.log('  phases:', BUILTIN_SLEEP_PHASES.map((p) => p.id).join(', '))
  console.log('  phaseFor(22:30):', phase.id)
  console.log('  phaseFormula(22:30):', activePhaseFormula ? formatFormula(activePhaseFormula) : '(null)')
  console.log('  parseFormula→formatFormula round-trip:', reserialized)
  console.log('  evaluateEnforcement:', JSON.stringify(enforcement))
  console.log('  surfacingProbability:', JSON.stringify(probability))

  // Hard assertions so a regression FAILS loudly (non-zero exit), not just logs.
  const checks: Array<[string, boolean]> = [
    ['four built-in phases', BUILTIN_SLEEP_PHASES.length === 4],
    ['phaseFor(22:30) === wrapup', phase.id === 'wrapup'],
    ['formula round-trips', reserialized === 'hard-block-before:30'],
    ['enforcement is hard-block in run-up', enforcement.posture === 'hard-block'],
    ['surfacing probability is finite [0,1]', probability.probability >= 0 && probability.probability <= 1]
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length > 0) {
    console.error('[F0 smoke] FAILED:', failed.join('; '))
    process.exit(1)
  }
  console.log('[F0 smoke] OK')
}

main()
