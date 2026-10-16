/** TUNING seed only: per-frame r / motion distributions along the aligned path. */
import { TUNING_SEED, buildScenarios, userPosesFor } from '../../scenarios'
import type { Params } from './scorer-core'
import { scoreWith } from './scorer-core'

const filter = new RegExp(process.argv[2] ?? '.')
const params = { ...(JSON.parse(process.argv[3] ?? '{}') as Partial<Params>), debug: true }
const q = (xs: number[], f: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN
}
for (const sc of buildScenarios({ seed: TUNING_SEED, perf: false, filter })) {
  const res = scoreWith(sc.reference, userPosesFor(sc, 'all'), 10, { referenceGeometry: sc.referenceGeometry }, params)
  const fr = res.debugFrames ?? []
  const rs = fr.filter((f) => f.matched).map((f) => f.r)
  const ms = fr.filter((f) => f.matched).map((f) => f.motion)
  const wmean = fr.reduce((a, f) => a + f.r * f.denom, 0) / fr.reduce((a, f) => a + f.denom, 0)
  const zero = rs.filter((r) => r <= 0).length / Math.max(1, rs.length)
  console.log(`${sc.id.padEnd(20)} score ${(res.overallScore * 100).toFixed(1).padStart(5)} r: wmean ${wmean.toFixed(2)} zero ${zero.toFixed(2)} p25 ${q(rs, 0.25).toFixed(2)} p50 ${q(rs, 0.5).toFixed(2)} p75 ${q(rs, 0.75).toFixed(2)} p90 ${q(rs, 0.9).toFixed(2)} | motion p25 ${q(ms, 0.25).toFixed(2)} p50 ${q(ms, 0.5).toFixed(2)} p75 ${q(ms, 0.75).toFixed(2)}`)
}
