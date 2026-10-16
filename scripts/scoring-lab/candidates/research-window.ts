/**
 * Baseline candidate "research-window": faithful port of the user's REA research candidate
 * (C:/Users/jink/groovy-research/rea-justdance-20261015/scripts/temporal-experiment.mts,
 * anchoredScore(user, sensorLatency = 0, localWindow = true), full-rate variant = the numbers in
 * evidence/temporal-experiment-fullrate.json).
 *
 * Algorithm (unchanged from the experiment):
 * - Geometry restore: reference x * width, y * height (the experiment hard-coded 406x720; here
 *   options.referenceGeometry — without it the reference is used as-is, i.e. no restore).
 * - For each reference frame i, candidates = user frames with |t_user - t_ref| <= 0.16 s; none -> 0.
 * - Motion: expected joint-angle change from reference frame i - round(0.3 s * fps) to i
 *   (extractJointAngles end - start; 9 frames at 30 fps). The reference "moves" when any |change| >= 0.15 rad.
 * - Candidate score = comparePoses(ref, user).overallScore; when the reference moves it is
 *   multiplied by (0.4 + 0.6 * compareMoveVelocity(expected, uBefore, user)), where uBefore is the
 *   user frame nearest to t_user - (t_ref[i] - t_ref[before]) within 0.16 s (none -> motion 0).
 * - Score = mean over ALL reference frames of the best candidate score (uncovered frames count 0).
 *
 * Lab adaptations (no scoring change): frozen ../baseline/scoring imports (= src/scoring @ 7aebdba),
 * user frames without keypoints are treated as not recorded, nearest / window lookups use binary
 * search on time-sorted user frames (same result as the experiment's linear scans: ties pick the
 * earlier frame), rank = legacy computeRank (what App.tsx applies to overallScore), and section
 * scores / coverage / perfect-frame rate are reported. The experiment had no sensor-latency
 * estimate in the uncalibrated case, so latency = 0.
 */
import type { Pose } from '../baseline/scoring/types'
import type { TimestampedPose } from '../baseline/scoring/dtw'
import { computeRank } from '../baseline/scoring/dtw'
import { comparePoses, compareMoveVelocity } from '../baseline/scoring/comparison'
import { extractJointAngles } from '../baseline/scoring/angles'

export const name = 'research-window (user REA candidate, temporal-experiment.mts port)'

/** Every frame where the detector returned a pose (the experiment scored whatever it was given). */
export const recordPolicy = 'detected'

/** Research parameters (temporal-experiment.mts) */
const MATCH_WINDOW = 0.16
const MOTION_WINDOW = 0.3
const MOTION_FLOOR = 0.4
const MOTION_WEIGHT = 0.6
const MIN_EXPECTED_CHANGE = 0.15
const PERFECT_FRAME = 0.8

interface Geometry {
  width: number
  height: number
}

interface Options {
  referenceGeometry?: Geometry
  [key: string]: unknown
}

function geometry(p: Pose, g: Geometry): Pose {
  return { keypoints: p.keypoints.map((k) => ({ ...k, x: k.x * g.width, y: k.y * g.height })) }
}

/** First index with times[idx] >= t (times sorted ascending). */
function lowerBound(times: number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Nearest frame to t within MATCH_WINDOW (ties -> earlier frame, like the experiment's strict '<' scan). */
function nearest(frames: TimestampedPose[], times: number[], t: number): TimestampedPose | undefined {
  if (frames.length === 0) return undefined
  const idx = lowerBound(times, t)
  let best = -1
  let gap = Infinity
  for (const j of [idx - 1, idx]) {
    if (j < 0 || j >= frames.length) continue
    const d = Math.abs(times[j] - t)
    if (d < gap) {
      gap = d
      best = j
    }
  }
  return best >= 0 && gap <= MATCH_WINDOW ? frames[best] : undefined
}

function medianStep(times: number[]): number {
  const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0).sort((a, b) => a - b)
  return d.length ? d[Math.floor(d.length / 2)] : 1 / 30
}

export function score(reference: TimestampedPose[], user: TimestampedPose[], sectionDuration = 10, options?: Options) {
  const geo = options?.referenceGeometry
  const ref = reference.map((f) => ({ time: f.time, pose: geo ? geometry(f.pose, geo) : f.pose }))
  const corrected = user
    .filter((f) => Number.isFinite(f.time) && (f.pose?.keypoints?.length ?? 0) > 0)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.time - b.f.time || a.i - b.i)
    .map(({ f }) => f)
  const times = corrected.map((f) => f.time)
  const backFrames = Math.max(1, Math.round(MOTION_WINDOW / medianStep(ref.map((f) => f.time))))
  const refAngles = ref.map((f) => extractJointAngles(f.pose))

  let total = 0
  let matched = 0
  let moving = 0
  const scores: number[] = []
  for (let i = 0; i < ref.length; i++) {
    const t = ref[i].time
    const lo = lowerBound(times, t - MATCH_WINDOW)
    const candidates: TimestampedPose[] = []
    for (let j = lo; j < corrected.length && times[j] <= t + MATCH_WINDOW; j++) {
      if (Math.abs(times[j] - t) <= MATCH_WINDOW) candidates.push(corrected[j])
    }
    if (!candidates.length) {
      scores.push(0)
      continue
    }
    matched++
    const before = Math.max(0, i - backFrames)
    const startAngles = refAngles[before]
    const endAngles = refAngles[i]
    const expected = Object.fromEntries(endAngles.map((end) => [
      end.name, end.angle - (startAngles.find((a) => a.name === end.name)?.angle ?? end.angle),
    ]))
    const referenceMoving = Object.values(expected).some((v) => Math.abs(v) >= MIN_EXPECTED_CHANGE)
    if (referenceMoving) moving++
    const best = Math.max(...candidates.map((u) => {
      const poseScore = comparePoses(ref[i].pose, u.pose).overallScore
      if (!referenceMoving) return poseScore
      const uBefore = nearest(corrected, times, u.time - (ref[i].time - ref[before].time))
      const motion = uBefore ? compareMoveVelocity(expected, uBefore.pose, u.pose) : 0
      return poseScore * (MOTION_FLOOR + MOTION_WEIGHT * motion)
    }))
    scores.push(best)
    total += best
  }

  const overallScore = ref.length ? total / ref.length : 0
  const duration = ref.length ? ref[ref.length - 1].time : 0
  const sectionScores: { startTime: number; endTime: number; score: number }[] = []
  const nSections = Math.max(1, Math.ceil(duration / sectionDuration))
  for (let s = 0; s < nSections; s++) {
    const startTime = s * sectionDuration
    const endTime = Math.min(startTime + sectionDuration, duration)
    const last = s === nSections - 1
    const inSection = scores.filter((_, i) => ref[i].time >= startTime && (last || ref[i].time < endTime))
    sectionScores.push({ startTime, endTime, score: inSection.length ? inSection.reduce((a, b) => a + b, 0) / inSection.length : 0 })
  }
  return {
    overallScore,
    rank: computeRank(overallScore),
    sectionScores,
    coverage: ref.length ? matched / ref.length : 0,
    perfectFrameRate: ref.length ? scores.filter((s) => s >= PERFECT_FRAME).length / ref.length : 0,
    referenceMovingFrames: moving,
    geometryRestored: !!geo,
  }
}
