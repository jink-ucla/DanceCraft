/** TUNING seed only: print notes / body parts for selected scenarios. */
import { TUNING_SEED, buildScenarios, userPosesFor } from '../../scenarios'
import type { Params } from './scorer-core'
import { scoreWith } from './scorer-core'

const filter = new RegExp(process.argv[2] ?? '.')
const params = JSON.parse(process.argv[3] ?? '{}') as Partial<Params>
for (const sc of buildScenarios({ seed: TUNING_SEED, perf: false, filter })) {
  const r = scoreWith(sc.reference, userPosesFor(sc, 'all'), 10, { referenceGeometry: sc.referenceGeometry }, params)
  console.log(`${sc.id}: ${(r.overallScore * 100).toFixed(1)} ${r.rank} parts=${JSON.stringify(r.bodyPartScores.map((b) => [b.name, Math.round(b.score * 100), b.tracked]))}`)
  for (const n of r.notes) console.log(`   - ${n}`)
  console.log(`   moves: ${r.moveScores.map((m) => `${m.time}:${Math.round(m.score * 100)}${m.rating[0]}${m.offsetMs ?? '-'}`).join(' ')}`)
}
