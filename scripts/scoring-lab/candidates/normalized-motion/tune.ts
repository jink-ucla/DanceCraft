/**
 * Tuning harness for normalized-motion — TUNING SEED ONLY (seed 1). Never point it at the
 * reporting seeds.
 *
 *   npx tsx scripts/scoring-lab/candidates/normalized-motion/tune.ts '<json params override>' ['<json>' ...]
 *
 * Prints one compact row per variant: key scenario scores, target pass count, sweep checks.
 */
import type { LoadedScorer } from '../../scorer'
import { DEFAULT_LIVE_DEPS } from '../../live'
import { TUNING_SEED, buildScenarios } from '../../scenarios'
import { checkSweeps, evaluateAll, summarize } from '../../evaluate'
import type { Params } from './scorer-core'
import { scoreWith } from './scorer-core'

const KEY = [
  'perfect', 'perfect-lag0.25', 'good', 'good-lag0.6', 'good-lag1.0', 'late-1.5s', 'late-3s', 'sloppy', 'beginner',
  'upper-body-arms', 'late-joiner', 'dropout-3s-mid', 'geometry-640x480', 'geometry-320x240', 'mirror-style',
  'mirror-style-640x480', 'still-full', 'still-upper', 'real-still', 'real-session2', 'real-session3', 'real-frozen',
  'frozen-ref-frame', 'hold-ref-pose', 'idle-sway', 'flail', 'hold-tpose', 'hold-arms-up', 'reversed-choreo', 'wrong-choreo',
]
const SHORT: Record<string, string> = {
  perfect: 'perf', 'perfect-lag0.25': 'p.25', good: 'good', 'good-lag0.6': 'g.6', 'good-lag1.0': 'g1.0', 'late-1.5s': 'l1.5',
  'late-3s': 'l3', sloppy: 'slop', beginner: 'begn', 'upper-body-arms': 'uppr', 'late-joiner': 'ljn', 'dropout-3s-mid': 'drop',
  'geometry-640x480': 'g640', 'geometry-320x240': 'g320', 'mirror-style': 'mirr', 'mirror-style-640x480': 'mi64',
  'still-full': 'stF', 'still-upper': 'stU', 'real-still': 'r1', 'real-session2': 'r2', 'real-session3': 'r3',
  'real-frozen': 'rfz', 'frozen-ref-frame': 'frz', 'hold-ref-pose': 'hrp', 'idle-sway': 'sway', flail: 'flai',
  'hold-tpose': 'tpos', 'hold-arms-up': 'aup', 'reversed-choreo': 'rev', 'wrong-choreo': 'wrng',
}

const scenarios = buildScenarios({ seed: TUNING_SEED, perf: false })
const variants: Partial<Params>[] = process.argv.slice(2).map((a) => JSON.parse(a) as Partial<Params>)
if (variants.length === 0) variants.push({})

console.log(KEY.map((k) => (SHORT[k] ?? k).padStart(5)).join('') + '  pass  sweeps  failed')
for (const v of variants) {
  const scorer: LoadedScorer = {
    name: JSON.stringify(v),
    path: 'tune',
    kind: 'score',
    score: (r, u, s, o) => scoreWith(r, u, s, { referenceGeometry: o?.referenceGeometry }, v),
    recordPolicy: 'all',
    liveDeps: DEFAULT_LIVE_DEPS,
  }
  const results = evaluateAll(scorer, scenarios)
  const by = new Map(results.map((r) => [r.id, r]))
  const sum = summarize(results)
  const sweeps = checkSweeps(results)
  const sweepOk = sweeps.flatMap((s) => s.checks).filter((c) => c.pass).length
  const sweepTotal = sweeps.flatMap((s) => s.checks).length
  const cells = KEY.map((k) => {
    const r = by.get(k)
    if (!r) return '    -'
    const mark = r.pass === false ? '!' : ' '
    return (r.score.toFixed(0) + mark).padStart(5)
  })
  console.log(`${cells.join('')}  ${sum.targetPass}/${sum.targetTotal}  ${sweepOk}/${sweepTotal}  ${JSON.stringify(v)}`)
  const lag = sweeps.find((s) => s.name === 'lag')
  const blend = sweeps.find((s) => s.name === 'blend')
  const noise = sweeps.find((s) => s.name === 'noise')
  const jit = sweeps.find((s) => s.name === 'jitter')
  const f = (s: typeof lag) => (s ? s.scores.map((x) => x.toFixed(0)).join('/') : '-')
  const margins = results
    .filter((r) => r.target && r.pass !== null)
    .map((r) => ({ id: r.id, m: Math.min(r.target!.min !== undefined ? r.score - r.target!.min : Infinity, r.target!.max !== undefined ? r.target!.max - r.score : Infinity) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 6)
  console.log(`      lag ${f(lag)}  blend ${f(blend)}  noise ${f(noise)}  jitter ${f(jit)}  failed: ${sum.failed.filter((x) => !KEY.includes(x)).join(',')}`)
  console.log(`      worst margins: ${margins.map((x) => `${SHORT[x.id] ?? x.id} ${x.m.toFixed(1)}`).join(', ')}`)
}
