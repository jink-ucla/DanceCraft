/** Factor isolation on the TUNING seed: which degradation costs how much. */
import { TUNING_SEED, PRESETS, getReferenceBundle } from '../../scenarios'
import type { UserSpec } from '../../synth'
import { createRng, recordSession, synthesizeUser } from '../../synth'
import type { Params } from './scorer-core'
import { scoreWith } from './scorer-core'

const params = JSON.parse(process.argv[2] ?? '{}') as Partial<Params>
const b = getReferenceBundle()
const base: UserSpec = { ...PRESETS.perfect }
const specs: [string, UserSpec][] = [
  ['perfect', base],
  ['blend .15', { ...base, blend: 0.15 }],
  ['blend .5', { ...base, blend: 0.5 }],
  ['begin blend', { ...base, blend: { arms: 0.35, torso: 0.6, legs: 0.85 } }],
  ['noise .12', { ...base, angleError: 0.12 }],
  ['noise .28', { ...base, angleError: 0.28 }],
  ['noise .30', { ...base, angleError: 0.3 }],
  ['tjit .08', { ...base, timingJitter: 0.08 }],
  ['tjit .15', { ...base, timingJitter: 0.15 }],
  ['tjit .20', { ...base, timingJitter: 0.2 }],
  ['lag .3', { ...base, lag: 0.3 }],
  ['lag .4', { ...base, lag: 0.4 }],
  ['lag .5', { ...base, lag: 0.5 }],
  ['good', { ...PRESETS.good }],
  ['good nodrop', { ...PRESETS.good, dropouts: undefined }],
  ['sloppy', { ...PRESETS.sloppy }],
  ['sloppy lag.1', { ...PRESETS.sloppy, lag: 0.1 }],
  ['sloppy tj0', { ...PRESETS.sloppy, timingJitter: 0 }],
  ['sloppy ae0', { ...PRESETS.sloppy, angleError: 0.02 }],
  ['sloppy bl0', { ...PRESETS.sloppy, blend: 0 }],
  ['beginner', { ...PRESETS.beginner }],
  ['begin tj0', { ...PRESETS.beginner, timingJitter: 0 }],
  ['begin ae0', { ...PRESETS.beginner, angleError: 0.02 }],
  ['begin lag.1', { ...PRESETS.beginner, lag: 0.1 }],
]
for (const [label, spec] of specs) {
  const s = synthesizeUser(b.ctx, spec, createRng(TUNING_SEED).fork('factors'))
  const r = scoreWith(b.reference, recordSession(s.frames, 'all'), 10, { referenceGeometry: b.geometry }, params)
  console.log(`${label.padEnd(14)} ${(r.overallScore * 100).toFixed(1).padStart(5)}  raw ${(r.rawScore * 100).toFixed(1).padStart(5)} off ${String(r.offsetMs).padStart(4)} mot ${r.motionMatch.toFixed(2)} tacc ${r.timingAccuracy.toFixed(2)} arms ${(r.bodyPartScores[0].score * 100).toFixed(0)} legs ${(r.bodyPartScores[1].score * 100).toFixed(0)}`)
}
