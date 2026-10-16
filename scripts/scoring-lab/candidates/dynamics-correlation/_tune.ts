// Tuning helper (seed 1 only): npx tsx _tune.ts '<json overrides>' ['<json overrides>' ...]
import { buildScenarios, userPosesFor } from '../../scenarios'
import { inTarget } from '../../evaluate'
import type { Params } from '../dynamics-correlation'
import { DEFAULT_PARAMS, scoreWithParams } from '../dynamics-correlation'

const seed = Number(process.env.SEED ?? 1)
const filter = process.env.FILTER ? new RegExp(process.env.FILTER) : undefined
const scenarios = buildScenarios({ seed, perf: false, filter })
const users = scenarios.map((s) => userPosesFor(s, 'all'))
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['{}']
const cols: { name: string; scores: number[]; pass: number; fails: string[] }[] = []
for (const v of variants) {
  const over = JSON.parse(v) as Partial<Params>
  const p: Params = { ...DEFAULT_PARAMS, ...over,
    velWeights: { ...DEFAULT_PARAMS.velWeights, ...(over.velWeights ?? {}) },
    poseWeights: { ...DEFAULT_PARAMS.poseWeights, ...(over.poseWeights ?? {}) },
    hiddenPenalty: { ...DEFAULT_PARAMS.hiddenPenalty, ...(over.hiddenPenalty ?? {}) } }
  const scores: number[] = []
  let pass = 0
  const fails: string[] = []
  scenarios.forEach((s, i) => {
    const r = scoreWithParams(s.reference, users[i], 10, { referenceGeometry: s.referenceGeometry }, p)
    const sc = r.overallScore * 100
    scores.push(sc)
    const ok = inTarget(sc, s.target)
    if (ok === true) pass++
    if (ok === false) fails.push(s.id)
  })
  cols.push({ name: v, scores, pass, fails })
}
const tgt = (s: (typeof scenarios)[number]) => s.target ? `${s.target.min ?? ''}-${s.target.max ?? ''}` : 'rep'
scenarios.forEach((s, i) => {
  console.log(s.id.padEnd(22) + tgt(s).padStart(7) + cols.map((c) => {
    const ok = inTarget(c.scores[i], s.target)
    return (c.scores[i].toFixed(1) + (ok === false ? '!' : ' ')).padStart(8)
  }).join(''))
})
cols.forEach((c, i) => console.log(`#${i} pass ${c.pass}/${scenarios.filter((s) => s.target).length}  ${c.name}\n   fails: ${c.fails.join(', ')}`))
