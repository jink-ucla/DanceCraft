/** Diagnostics on the TUNING seed only: component breakdown per scenario. */
import { TUNING_SEED, buildScenarios, userPosesFor } from '../../scenarios'
import type { Params } from './scorer-core'
import { scoreWith } from './scorer-core'

const filter = new RegExp(process.argv[2] ?? '.')
const params = JSON.parse(process.argv[3] ?? '{}') as Partial<Params>
for (const sc of buildScenarios({ seed: TUNING_SEED, perf: false, filter })) {
  const user = userPosesFor(sc, 'all')
  const r = scoreWith(sc.reference, user, 10, { referenceGeometry: sc.referenceGeometry }, params)
  console.log(`${sc.id.padEnd(22)} score ${(r.overallScore * 100).toFixed(1).padStart(5)} raw ${(r.rawScore * 100).toFixed(1).padStart(5)} tf ${r.timingFactor.toFixed(2)} off ${String(r.offsetMs).padStart(5)} cov ${r.coverage.toFixed(2)} mot ${r.motionMatch.toFixed(2)} tacc ${r.timingAccuracy.toFixed(2)} arms ${(r.bodyPartScores[0].score * 100).toFixed(0)} legs ${(r.bodyPartScores[1].score * 100).toFixed(0)} chance ${r.chanceLevel.toFixed(2)} mir ${r.mirrored}`)
}
