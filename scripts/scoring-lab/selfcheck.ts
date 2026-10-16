/**
 * Scoring lab integrity checks (exit code 1 on failure):
 *   npx tsx scripts/scoring-lab/selfcheck.ts
 * - deterministic scenario generation per seed, different data across seeds
 * - forward-kinematics round trip is exact
 * - a zero-lag / zero-noise synthetic copy (aspect 1) matches the reference frame by frame
 * - the frozen baseline scorer reproduces the app: real still user 63.6% A, its first frame
 *   frozen 50.8% B, reference vs itself 100% S
 * - visibility masks / recording policy behave as documented
 * - reference geometry sidecar (406x720 normalized), geometry-exact copies match the
 *   geometry-restored reference, mirror-style users are the exact mirror (x flip + label swap)
 * - all three real sessions load and the legacy scorer ranks them A (as in the app)
 * - every revised target row has a scenario; the runner passes options.referenceGeometry
 */
import { createHash } from 'node:crypto'
import { TARGET_ROWS, buildScenarios, getReferenceBundle, userPosesFor } from './scenarios'
import { compose, createRng, decompose, synthesizeUser, recordSession } from './synth'
import {
  KP, LEG_KEYPOINTS, REAL_SESSION_FIXTURES, REF_FIXTURE, REF_INEEDU_GEOMETRY, denormalizePose, loadRealSession,
  loadRealStillUser, loadReferenceMeta, mirrorPose,
} from './data'
import type { RealSessionKey } from './data'
import { comparePoses } from './baseline/scoring/comparison'
import { computePostDanceScore } from './baseline/scoring/dtw'
import { evaluateScenario } from './evaluate'
import type { LoadedScorer, ScoreOptions } from './scorer'
import { DEFAULT_LIVE_DEPS } from './live'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

function hashFrames(frames: unknown): string {
  return createHash('sha1').update(JSON.stringify(frames)).digest('hex').slice(0, 12)
}

// 1. determinism
const filter = /^(good|flail|sweep-lag-0.5|upper-body-arms)$/
const a = buildScenarios({ seed: 1, perf: false, filter })
const b = buildScenarios({ seed: 1, perf: false, filter })
const c = buildScenarios({ seed: 2, perf: false, filter })
check('same seed -> identical frames', a.every((s, i) => hashFrames(s.frames) === hashFrames(b[i].frames)))
check('different seed -> different frames', a.every((s, i) => hashFrames(s.frames) !== hashFrames(c[i].frames)))
const solo = buildScenarios({ seed: 1, perf: false, filter: /^flail$/ })[0]
check('scenario data independent of which other scenarios are built', hashFrames(solo.frames) === hashFrames(a.find((s) => s.id === 'flail')!.frames))

// 2. FK round trip
for (const aspect of [1, 9 / 16]) {
  const bundle = getReferenceBundle(aspect)
  let maxErr = 0
  for (const body of bundle.ctx.bodies) {
    const r = compose(decompose(body))
    for (let i = 0; i < 33; i++) maxErr = Math.max(maxErr, Math.hypot(r.x[i] - body.x[i], r.y[i] - body.y[i]))
  }
  check(`FK round trip exact (aspect ${aspect.toFixed(3)})`, maxErr < 1e-9, `max err ${maxErr.toExponential(1)}`)
}

// 3. zero-noise copy
{
  const bundle = getReferenceBundle(1)
  const s = synthesizeUser(bundle.ctx, { motion: { kind: 'reference' }, jitter: 0, wander: 0 }, createRng(5))
  let sum = 0
  let n = 0
  for (const f of s.frames) {
    if (!f.pose) continue
    const idx = Math.max(0, Math.min(bundle.reference.length - 1, Math.round(f.videoTime * bundle.timeline.fps)))
    sum += comparePoses(bundle.reference[idx].pose, f.pose).overallScore
    n++
  }
  check('zero-lag zero-noise copy (aspect 1) matches reference per frame', sum / n > 0.98, `mean ${(sum / n).toFixed(4)}`)
}

// 4. baseline reproduces the app
{
  const bundle = getReferenceBundle()
  const real = loadRealStillUser()
  const r1 = computePostDanceScore(bundle.reference, real)
  check('baseline: real still user = 63.6% A', Math.abs(r1.overallScore * 100 - 63.6) < 0.05 && r1.rank === 'A', `${(r1.overallScore * 100).toFixed(2)} ${r1.rank}`)
  const frozen = buildScenarios({ seed: 1, perf: false, filter: /^real-frozen$/ })[0]
  const r2 = computePostDanceScore(bundle.reference, userPosesFor(frozen, 'presence'))
  check('baseline: real first frame frozen = 50.8% B', Math.abs(r2.overallScore * 100 - 50.8) < 0.1 && r2.rank === 'B', `${(r2.overallScore * 100).toFixed(2)} ${r2.rank}`)
  const r3 = computePostDanceScore(bundle.reference, bundle.reference)
  check('baseline: reference vs itself = 100% S', Math.abs(r3.overallScore - 1) < 1e-9 && r3.rank === 'S', `${(r3.overallScore * 100).toFixed(2)} ${r3.rank}`)
}

// 5. visibility / recording
{
  const upper = a.find((s) => s.id === 'upper-body-arms')!
  const poses = upper.frames.filter((f) => f.pose).map((f) => f.pose!)
  const legsHidden = poses.every((p) => LEG_KEYPOINTS.every((n) => p.keypoints[KP[n]].score < 0.05))
  const hipConf = poses.map((p) => p.keypoints[KP.left_hip].score)
  const meanHip = hipConf.reduce((x, y) => x + y, 0) / hipConf.length
  check('upper framing: legs conf ~0', legsHidden)
  check('upper framing: hips conf ~0.7', Math.abs(meanHip - 0.7) < 0.05, `mean ${meanHip.toFixed(3)}`)
  const presence = recordSession(upper.frames, 'presence').length
  const detected = recordSession(upper.frames, 'detected').length
  const all = recordSession(upper.frames, 'all').length
  check('record policies: presence <= detected <= all = frames', presence <= detected && detected <= all && all === upper.frames.length,
    `${presence} / ${detected} / ${all}`)
  const good = a.find((s) => s.id === 'good')!
  const span = good.frames[good.frames.length - 1].recTime - good.frames[0].recTime
  check('synthetic full-length user starts near 0 on the recording clock', good.frames[0].recTime < 0.05 && span > 14.5,
    `first ${good.frames[0].recTime.toFixed(3)} s, span ${span.toFixed(2)} s`)
}

// 6. reference geometry, geometry-exact copy, mirror-style
{
  const meta = loadReferenceMeta(REF_FIXTURE)
  check('reference meta sidecar = 406x720 normalized', !!meta && meta.width === 406 && meta.height === 720 && meta.coordinateSpace === 'normalized',
    JSON.stringify(meta))
  const bundle = getReferenceBundle()
  check('default reference geometry = sidecar 406x720', bundle.geometry.width === 406 && bundle.geometry.height === 720 &&
    REF_INEEDU_GEOMETRY.width === 406)
  const cam = { width: 640, height: 480, placement: 'random' as const }
  const exact = synthesizeUser(bundle.ctx, { motion: { kind: 'reference' }, jitter: 0, wander: 0, frameJitter: 0, camera: cam }, createRng(11))
  let restored = 0
  let rawNorm = 0
  let n = 0
  const refs = bundle.reference
  for (const f of exact.frames) {
    if (!f.pose || f.videoTime >= refs[refs.length - 1].time) continue
    // reference linearly interpolated at the frame's video time (what the synthetic copy samples)
    const lo = Math.max(0, Math.min(refs.length - 2, Math.floor(f.videoTime * bundle.timeline.fps)))
    const w = (f.videoTime - refs[lo].time) / (refs[lo + 1].time - refs[lo].time)
    const refPose = {
      keypoints: refs[lo].pose.keypoints.map((k, j) => {
        const b = refs[lo + 1].pose.keypoints[j]
        return { ...k, x: k.x + w * (b.x - k.x), y: k.y + w * (b.y - k.y) }
      }),
    }
    restored += comparePoses(denormalizePose(refPose, bundle.geometry), f.pose).overallScore
    rawNorm += comparePoses(refPose, f.pose).overallScore
    n++
  }
  check('geometry-exact 640x480 copy == geometry-restored reference (comparePoses ~1)', n > 0 && restored / n > 0.995,
    `restored ${(restored / Math.max(1, n)).toFixed(4)} vs raw normalized ${(rawNorm / Math.max(1, n)).toFixed(4)} over ${n} frames`)
  const spec = { motion: { kind: 'reference' as const }, jitter: 0, wander: 0, lag: 0.1 }
  const plain = synthesizeUser(bundle.ctx, spec, createRng(12)).frames
  const mirrored = synthesizeUser(bundle.ctx, { ...spec, mirror: true }, createRng(12)).frames
  let maxErr = 0
  plain.forEach((f, i) => {
    const m = mirrored[i].pose
    if (!f.pose || !m) return
    const expected = mirrorPose(f.pose)
    expected.keypoints.forEach((k, j) => {
      maxErr = Math.max(maxErr, Math.hypot(k.x - m.keypoints[j].x, k.y - m.keypoints[j].y))
    })
  })
  check('mirror-style user = x flip + left/right label swap of the plain copy', maxErr < 1e-6, `max err ${maxErr.toExponential(1)} px`)
}

// 7. real sessions
{
  const bundle = getReferenceBundle()
  const expectedFrames: Record<RealSessionKey, number> = { session1: 152, session2: 51, session3: 107 }
  for (const key of Object.keys(REAL_SESSION_FIXTURES) as RealSessionKey[]) {
    const poses = loadRealSession(key)
    const r = computePostDanceScore(bundle.reference, poses)
    check(`real ${key}: ${expectedFrames[key]} frames, legacy rank A`, poses.length === expectedFrames[key] && r.rank === 'A',
      `${poses.length} frames, ${(r.overallScore * 100).toFixed(1)} ${r.rank}`)
  }
}

// 8. target rows covered, options passed to scorers
{
  const all = buildScenarios({ seed: 1, perf: false })
  const missing = TARGET_ROWS.filter((row) => !row.reportOnly && !all.some((sc) => sc.row === row.key && !sc.reportOnly)).map((r) => r.key)
  check('every revised target row has a judged scenario', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${TARGET_ROWS.length} rows`)
  let seen: ScoreOptions | undefined
  const probe: LoadedScorer = {
    name: 'probe', path: 'probe', kind: 'score', recordPolicy: 'presence', liveDeps: DEFAULT_LIVE_DEPS,
    score: (_r, _u, _s, options) => {
      seen = options
      return { overallScore: 0, rank: 'C' }
    },
  }
  const sc = all.find((x) => x.id === 'perfect')!
  evaluateScenario(probe, sc)
  check('runner passes options.referenceGeometry (+ options.lab)', seen?.referenceGeometry?.width === 406 && seen?.referenceGeometry?.height === 720 &&
    seen?.lab?.scenarioId === 'perfect', JSON.stringify(seen?.referenceGeometry))
  evaluateScenario(probe, sc, { passGeometry: false })
  check('--no-geometry omits options.referenceGeometry', seen !== undefined && seen.referenceGeometry === undefined)
}

console.log(failures === 0 ? '\nselfcheck OK' : `\nselfcheck: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
