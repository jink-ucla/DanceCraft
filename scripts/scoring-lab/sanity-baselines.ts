/**
 * Sanity checks for the ported baseline candidates on the SAME controlled inputs their authors
 * used (not the lab's synthetic users):
 *
 *   npx tsx scripts/scoring-lab/sanity-baselines.ts
 *
 * 1. research-window vs the user's temporal-experiment.mts (full rate, evidence/temporal-experiment-fullrate.json):
 *    user = geometry-restored reference * 0.25 + (60, 20) on the reference clock, then shifted / frozen / reversed / gapped.
 * 2. pulse-keypoints vs Codex's test.mts controlled 30 Hz benchmark (1400 = 14 events x 100):
 *    (a) the ported PulseJudge fed exactly like test.mts (canonical reference poses), and
 *    (b) the candidate's score() fed webcam-pixel users (reference * 0.25 + offset).
 * 3. analyze.ts (motion-only port of analyze.py) vs the Python curves stored in the analysis JSON.
 * Exit code 1 if a result deviates from the published number by more than the tolerance.
 */
import type { TimestampedPose } from './data'
import { REF_INEEDU_GEOMETRY, REF_PULSE_ANALYSIS_FIXTURE, fixturePath, loadJson, loadReference } from './data'
import { score as researchScore } from './candidates/research-window'
import { score as pulseScore } from './candidates/pulse-keypoints'
import type { Kp, PosePx, PulseData } from './candidates/pulse-keypoints/core'
import { BONES, PulseJudge, canonicalize, pixelPose, prepareReference, sample } from './candidates/pulse-keypoints/core'
import { chartMotionOnly } from './candidates/pulse-keypoints/analyze'
import { comparePoses, compareMoveVelocity } from './baseline/scoring/comparison'
import { checkPresence } from './baseline/scoring/presence'
import { extractJointAngles } from './baseline/scoring/angles'
import { computePostDanceScore } from './baseline/scoring/dtw'

let failures = 0
function report(label: string, got: number, expected: number, tol: number, extra = ''): void {
  const ok = Math.abs(got - expected) <= tol
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(40)} got ${got.toFixed(1).padStart(6)}  published ${expected.toFixed(1).padStart(6)}  (tol ${tol})${extra ? '  ' + extra : ''}`)
}

const { poses: raw } = loadReference()
const G = REF_INEEDU_GEOMETRY
const geometry = (p: TimestampedPose['pose']) => ({ keypoints: p.keypoints.map((k) => ({ ...k, x: k.x * G.width, y: k.y * G.height })) })
const webcam = (p: TimestampedPose['pose']) => ({ keypoints: p.keypoints.map((k) => ({ ...k, x: k.x * 0.25 + 60, y: k.y * 0.25 + 20 })) })
const ref = raw.map((f) => ({ time: f.time, pose: geometry(f.pose) }))
const correct: TimestampedPose[] = ref.map((f) => ({ time: f.time, pose: webcam(f.pose) }))

// ---------------------------------------------------------------------------
console.log('1. research-window vs temporal-experiment.mts (30 Hz, evidence/temporal-experiment-fullrate.json)')
{
  let seed = 104729
  const jitter = () => {
    seed = (seed * 16807) % 2147483647
    return (seed / 2147483647 - 0.5) * 0.5
  }
  const scenarios: { name: string; user: TimestampedPose[]; published: number; legacy: number }[] = [
    { name: 'same_dance', user: correct, published: 100, legacy: 95.9 },
    { name: 'sensor_latency_100ms_uncalibrated', user: correct.map((f) => ({ ...f, time: f.time + 0.1 })), published: 100, legacy: 95.9 },
    { name: 'dance_1500ms_late', user: correct.map((f) => ({ ...f, time: f.time + 1.5 })), published: 41.5, legacy: 95.9 },
    { name: 'dance_3000ms_late', user: correct.map((f) => ({ ...f, time: f.time + 3 })), published: 39.5, legacy: 95.9 },
    { name: 'frozen_pose', user: correct.map((f) => ({ ...f, pose: correct[75].pose })), published: 33.6, legacy: 68.6 },
    { name: 'reverse_choreography', user: correct.map((f, i) => ({ ...f, pose: correct[correct.length - 1 - i].pose })), published: 47.4, legacy: 75.0 },
    { name: 'three_second_camera_gap', user: correct.filter((f) => f.time < 5 || f.time >= 8), published: 80.2, legacy: 94.1 },
    {
      name: 'same_dance_with_subpixel_jitter',
      user: correct.map((f) => ({ ...f, pose: { keypoints: f.pose.keypoints.map((k) => ({ ...k, x: k.x + jitter(), y: k.y + jitter() })) } })),
      published: 95.3, legacy: 95.8,
    },
  ]
  for (const s of scenarios) {
    const r = researchScore(raw, s.user, 10, { referenceGeometry: G })
    const legacy = computePostDanceScore(raw, s.user).overallScore * 100
    report(`research-window ${s.name}`, r.overallScore * 100, s.published, 0.15,
      `coverage ${(r.coverage * 100).toFixed(1)}%   legacy ${legacy.toFixed(1)} (published ${s.legacy})`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n2a. ported PulseJudge fed like test.mts (canonical reference poses, 30 Hz)')
const analysis = loadJson<PulseData & { duration: number; fps: number; curves: Record<string, number[]> }>(fixturePath(REF_PULSE_ANALYSIS_FIXTURE))
const prepared = prepareReference(analysis, extractJointAngles)
const api = { comparePoses, compareMoveVelocity, checkPresence }
const cref = prepared.frames
console.log(`events: ${prepared.events.length} prepared of ${analysis.events.length} in the analysis`)
function ratioVariant(pose: PosePx): PosePx {
  const source = new Map(pose.keypoints.map((p) => [p.name, p]))
  const p: PosePx = structuredClone(pose)
  const out = new Map(p.keypoints.map((k) => [k.name, k]))
  for (const [a, b, f] of [['left_shoulder', 'right_shoulder', 1.4], ['left_hip', 'right_hip', 0.75]] as [string, string, number][]) {
    const x = source.get(a)!
    const y = source.get(b)!
    const cx = (x.x + y.x) / 2
    const cy = (x.y + y.y) / 2
    Object.assign(out.get(a)!, { x: cx + (x.x - cx) * f, y: cy + (x.y - cy) * f })
    Object.assign(out.get(b)!, { x: cx + (y.x - cx) * f, y: cy + (y.y - cy) * f })
  }
  BONES.forEach(([a, b], i) => {
    const x = source.get(a)
    const y = source.get(b)
    const anchor = out.get(a)
    if (x && y && anchor) Object.assign(out.get(b)!, { x: anchor.x + (y.x - x.x) * (i % 2 ? 1.35 : 0.65), y: anchor.y + (y.y - x.y) * (i % 2 ? 1.35 : 0.65) })
  })
  return p
}
function runJudge(transform: (time: number, index: number) => PosePx | null) {
  const judge = new PulseJudge(prepared.events, api)
  for (let i = 0; i < cref.length; i++) judge.feed(cref[i].time, transform(cref[i].time, i))
  judge.advance(analysis.duration + 1)
  return judge.summary()
}
const px = (i: number) => pixelPose(analysis.frames[i] as { keypoints: Kp[] }, analysis.width, analysis.height)
const pulseRows: [string, (t: number, i: number) => PosePx | null, number, string?][] = [
  ['same_dance', (_, i) => cref[i].pose, 1400],
  ['scale_and_translation', (_, i) => canonicalize({ keypoints: px(i).keypoints.map((k) => ({ ...k, x: k.x * 0.35 + 200, y: k.y * 0.35 + 100 })) }), 1400],
  ['different_body_ratios', (_, i) => canonicalize(ratioVariant(px(i))), 1400],
  ['delay_100ms', (t) => sample(cref, Math.max(0, t - 0.1))!.pose, 1400],
  ['late_600ms', (t) => sample(cref, Math.max(0, t - 0.6))!.pose, 0],
  ['late_1500ms', (t) => sample(cref, Math.max(0, t - 1.5))!.pose, 0],
  ['frozen_pose', () => cref[75].pose, 0],
  ['reverse_choreography', (_, i) => cref[cref.length - i - 1].pose, 0],
  ['camera_gap_5_to_8', (t) => (t >= 5 && t < 8 ? null : sample(cref, t)!.pose), 1200],
  ['no_person', () => null, 0, 'TRACKING LOST 14'],
]
for (const [label, transform, published, note] of pulseRows) {
  const s = runJudge(transform)
  report(`PulseJudge ${label}`, s.points, published, 0.5,
    `P/G/M/L ${s.ratings.PERFECT}/${s.ratings.GOOD}/${s.ratings.MISS}/${s.ratings['TRACKING LOST']}${note ? ` (published ${note})` : ''}`)
}

console.log('\n2b. pulse-keypoints score() with webcam-pixel users (reference * 0.25 + (60, 20)), x1400')
{
  const user = (fn: (t: number, i: number) => TimestampedPose['pose'] | null): TimestampedPose[] =>
    correct.map((f, i) => ({ time: f.time, pose: fn(f.time, i) ?? { keypoints: [] } }))
  const at = (t: number) => correct[Math.max(0, Math.min(correct.length - 1, Math.round(t * 30)))].pose
  const rows: [string, TimestampedPose[], number][] = [
    ['same_dance', correct, 1400],
    ['delay_100ms', user((t) => at(Math.max(0, t - 0.1))), 1400],
    ['late_600ms', user((t) => at(Math.max(0, t - 0.6))), 0],
    ['late_1500ms', user((t) => at(Math.max(0, t - 1.5))), 0],
    ['frozen_pose', user(() => correct[75].pose), 0],
    ['reverse_choreography', user((_, i) => correct[correct.length - 1 - i].pose), 0],
    ['camera_gap_5_to_8', user((t, i) => (t >= 5 && t < 8 ? null : correct[i].pose)), 1200],
  ]
  for (const [label, u, published] of rows) {
    const r = pulseScore(raw, u, 10, { referenceGeometry: G })
    report(`pulse-keypoints ${label}`, r.overallScore * 1400, published, 0.5, `ratings P/G/M/L ${r.ratings}  source: ${r.eventSource}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n3. analyze.ts motion-only port vs Python curves (ref-ineedu-15s.pulse-analysis.json)')
{
  const frames = analysis.frames as { time: number; keypoints: Kp[] }[]
  const { events, curves } = chartMotionOnly(frames, analysis.width, analysis.height, analysis.fps)
  const py = analysis.curves
  const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  for (const key of ['speed', 'salience', 'coverage', 'motionDelta'] as const) {
    const d = maxDiff(curves[key], py[key])
    const ok = d < 1e-6
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  curve ${key.padEnd(12)} max |TS - Python| = ${d.toExponential(2)}`)
  }
  const elig = curves.eligible.filter((v, i) => (v ? 1 : 0) !== py.eligible[i]).length
  if (elig) failures++
  console.log(`${elig ? 'FAIL' : 'PASS'}  curve eligible     mismatching frames: ${elig}`)
  const pyEvents = analysis.events as { time: number; motionPeak: number; audioAligned: boolean }[]
  console.log(`Python (motion + audio snap): ${pyEvents.length} events, motion peaks ${pyEvents.map((e) => e.motionPeak.toFixed(3)).join(' ')}`)
  console.log(`TS motion-only (no audio):    ${events.length} events, times        ${events.map((e) => e.time.toFixed(3)).join(' ')}`)
  const pyPeaks = new Set(pyEvents.map((e) => e.motionPeak.toFixed(4)))
  const common = events.filter((e) => pyPeaks.has(e.time.toFixed(4))).length
  console.log(`motion peaks shared: ${common} of ${events.length} (differences come only from audio snapping / audio-weighted selection)`)
}

console.log(failures === 0 ? '\nsanity-baselines OK' : `\nsanity-baselines: ${failures} deviation(s)`)
process.exit(failures === 0 ? 0 : 1)
