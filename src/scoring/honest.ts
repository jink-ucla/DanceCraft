/**
 * Interim "honest" post-dance scorer for DanceCraft.
 *
 * The legacy computePostDanceScore (dtw.ts) is timing-blind: unconstrained DTW
 * warps whatever frames were recorded over the whole song, skips joints the
 * user doesn't show, and never checks that the user moved. Standing still
 * scored ~64% (rank A). This scorer replaces it until scoring v3 lands:
 *
 *  - Timing: each reference moment (every GRID_STEP s) is matched only against
 *    user frames within ±LOCAL_WINDOW of (moment + latency); one global latency
 *    in [0, MAX_LATENCY] s is estimated per session (camera/display/reaction lag).
 *  - Coverage: reference time with no tracked user frame scores 0.
 *  - Missing joints: joints visible in the reference but not tracked on the user
 *    count as misses (upper-body-only framing is penalised, not ignored).
 *  - Motion: where the reference is moving, the pose score is scaled by how well
 *    the user's joint-angle change over the preceding MOTION_WINDOW matches
 *    (compareMoveVelocity) — standing still earns only MOTION_FLOOR of the pose score.
 *  - Stricter ranks (computeHonestRank).
 *
 * Timing window + motion gating follow the user's REA research candidate and
 * Codex's pulse judge (groovy-research/rea-justdance-20261015, experiments/pulse-party).
 */
import type { Pose } from './types'
import { comparePoses, compareMoveVelocity } from './comparison'
import { extractJointAngles } from './angles'
import type { BodyPartScore, DTWResult, SectionScore, TimestampedPose } from './dtw'

type Rank = DTWResult['rank']

const GRID_STEP = 0.1
const MAX_LATENCY = 0.3
const LATENCY_STEP = 0.1
const LOCAL_WINDOW = 0.2
const MOTION_WINDOW = 0.3
/** How far the "before" frame of a motion pair may sit from its ideal time. */
const MOTION_TOLERANCE = 0.1
/** Same threshold compareMoveVelocity uses to ignore negligible joint motion (rad). */
const MIN_JOINT_MOTION = 0.15
const MOTION_FLOOR = 0.25
/** A body part counts as tracked if its joints were visible in this share of the dance. */
const TRACKED_SHARE = 0.3

const BODY_PARTS: Record<string, string[]> = {
  Arms: ['left_elbow', 'right_elbow', 'left_shoulder', 'right_shoulder'],
  Legs: ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
}

export interface HonestResult extends DTWResult {
  scoringVersion: 'interim-1'
  /** Share of the dance (0-1) where the user was tracked at all. */
  coverage: number
  /** Mean motion match (0-1) over moments where the reference moves. */
  motionMatch: number
  /** Global latency compensation applied, in ms. */
  latencyMs: number
  /** True when the user danced mirror-style (their left = the dancer's right). */
  mirrored: boolean
  /** Plain-language explanations of the biggest penalties. */
  notes: string[]
  bodyPartScores: (BodyPartScore & { tracked: boolean })[]
}

/** Ranks for the honest score (legacy computeRank gave A from 55%). */
export function computeHonestRank(score: number): Rank {
  const pct = score * 100
  if (pct >= 85) return 'S'
  if (pct >= 70) return 'A'
  if (pct >= 50) return 'B'
  return 'C'
}

interface Frame {
  time: number
  pose: Pose
  angles: Map<string, number>
}

interface RefPoint {
  time: number
  frame: Frame
  expected: Record<string, number>
  moving: boolean
}

interface PointResult {
  score: number
  tracked: boolean
  motion: number | null
  /** Per reference-visible joint similarity (0 when the user lacks the joint), motion-scaled. */
  joints: Map<string, number>
  userJoints: Set<string>
}

function swapSide(name: string): string {
  if (name.startsWith('left_')) return 'right_' + name.slice(5)
  if (name.startsWith('right_')) return 'left_' + name.slice(6)
  return name
}

/**
 * Mirror-style performance: the user copies the screen like a mirror, so their
 * left limbs follow the dancer's right. Flip x and relabel left/right.
 */
function mirrorSequence(seq: TimestampedPose[]): TimestampedPose[] {
  return seq.map((f) => ({
    ...f,
    pose: { keypoints: (f.pose?.keypoints ?? []).map((k) => ({ ...k, x: -k.x, name: swapSide(k.name) })) },
  }))
}

function prepare(seq: TimestampedPose[]): Frame[] {
  return seq
    .filter((f) => Number.isFinite(f.time) && f.pose?.keypoints?.length)
    .map((f) => ({
      time: f.time,
      pose: f.pose,
      angles: new Map(extractJointAngles(f.pose).map((a) => [a.name, a.angle])),
    }))
    .sort((a, b) => a.time - b.time)
}

/** First index whose time is >= t. */
function lowerBound(frames: Frame[], t: number): number {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function nearest(frames: Frame[], t: number, tolerance = Infinity): Frame | null {
  if (frames.length === 0) return null
  const i = lowerBound(frames, t)
  let best: Frame | null = null
  for (const j of [i - 1, i]) {
    const f = frames[j]
    if (f && (!best || Math.abs(f.time - t) < Math.abs(best.time - t))) best = f
  }
  return best && Math.abs(best.time - t) <= tolerance ? best : null
}

function angleChange(before: Map<string, number>, after: Map<string, number>): Record<string, number> {
  const change: Record<string, number> = {}
  for (const [name, angle] of after) {
    const start = before.get(name)
    if (start !== undefined) change[name] = angle - start
  }
  return change
}

function buildRefPoints(ref: Frame[]): RefPoint[] {
  const duration = ref[ref.length - 1].time
  const points: RefPoint[] = []
  for (let k = 0; k * GRID_STEP <= duration + 1e-9; k++) {
    const time = k * GRID_STEP
    const frame = nearest(ref, time)!
    const before = nearest(ref, time - MOTION_WINDOW, MOTION_TOLERANCE)
    const expected = before ? angleChange(before.angles, frame.angles) : {}
    const moving = Object.values(expected).some((v) => Math.abs(v) >= MIN_JOINT_MOTION)
    points.push({ time, frame, expected, moving })
  }
  return points
}

function evaluatePoint(point: RefPoint, user: Frame[], latency: number): PointResult {
  const center = point.time + latency
  const refJoints = [...point.frame.angles.keys()]
  let best: PointResult | null = null

  for (let i = lowerBound(user, center - LOCAL_WINDOW); i < user.length && user[i].time <= center + LOCAL_WINDOW; i++) {
    const u = user[i]
    const cmp = comparePoses(point.frame.pose, u.pose)
    const matched = refJoints.filter((j) => u.angles.has(j)).length
    const jointCoverage = refJoints.length > 0 ? matched / refJoints.length : 1

    let motion: number | null = null
    let factor = 1
    if (point.moving) {
      const before = nearest(user, u.time - MOTION_WINDOW, MOTION_TOLERANCE)
      motion = before ? compareMoveVelocity(point.expected, before.pose, u.pose) : 0
      factor = MOTION_FLOOR + (1 - MOTION_FLOOR) * motion
    }

    const score = cmp.overallScore * jointCoverage * factor
    if (!best || score > best.score) {
      const sims = new Map(cmp.jointScores.map((j) => [j.name, j.similarity]))
      const joints = new Map(refJoints.map((j) => [j, (sims.get(j) ?? 0) * factor]))
      best = { score, tracked: true, motion, joints, userJoints: new Set(u.angles.keys()) }
    }
  }

  return best ?? {
    score: 0,
    tracked: false,
    motion: point.moving ? 0 : null,
    joints: new Map(refJoints.map((j) => [j, 0])),
    userJoints: new Set(),
  }
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function emptyResult(notes: string[]): HonestResult {
  return {
    overallScore: 0,
    sectionScores: [],
    bodyPartScores: Object.keys(BODY_PARTS).map((name) => ({ name, score: 0, tracked: false })),
    rank: 'C',
    alignment: [],
    scoringVersion: 'interim-1',
    coverage: 0,
    motionMatch: 0,
    latencyMs: 0,
    mirrored: false,
    notes,
  }
}

/**
 * Honest post-dance score. Same inputs as computePostDanceScore: reference poses
 * on the video clock and user poses on the recording clock (which starts when the
 * reference video starts playing).
 */
export function computeHonestScore(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
): HonestResult {
  const ref = prepare(reference)
  const usr = prepare(user)
  if (ref.length === 0) return emptyResult([])
  if (usr.length === 0) return emptyResult(['We could not see you during the dance — make sure you are in front of the camera.'])

  const points = buildRefPoints(ref)

  // Estimate one global latency and the orientation (as-is vs mirror-style) on
  // a coarse subset, then score every moment with the winner. Taking the better
  // orientation is not exploitable: the choreography still has to match.
  const variants = [
    { mirrored: false, frames: usr },
    { mirrored: true, frames: prepare(mirrorSequence(user)) },
  ]
  const coarse = points.filter((_, i) => i % 3 === 0)
  let latency = 0
  let chosen = variants[0]
  let bestMean = -1
  for (const variant of variants) {
    for (let l = 0; l <= MAX_LATENCY + 1e-9; l += LATENCY_STEP) {
      const m = mean(coarse.map((p) => evaluatePoint(p, variant.frames, l).score))
      if (m > bestMean + 1e-6) {
        bestMean = m
        latency = l
        chosen = variant
      }
    }
  }
  const results = points.map((p) => evaluatePoint(p, chosen.frames, latency))

  const overallScore = mean(results.map((r) => r.score))
  const coverage = mean(results.map((r) => (r.tracked ? 1 : 0)))
  const motions = results.filter((r) => r.motion !== null).map((r) => r.motion as number)
  const motionMatch = motions.length > 0 ? mean(motions) : 1

  const duration = ref[ref.length - 1].time
  const sectionScores: SectionScore[] = []
  const numSections = Math.max(1, Math.ceil(duration / sectionDuration))
  for (let s = 0; s < numSections; s++) {
    const startTime = s * sectionDuration
    const endTime = Math.min((s + 1) * sectionDuration, duration)
    const isLast = s === numSections - 1
    const inSection = results.filter((_, i) => {
      const t = points[i].time
      return t >= startTime && (t < endTime || (isLast && t <= endTime + 1e-9))
    })
    sectionScores.push({ startTime, endTime, score: mean(inSection.map((r) => r.score)) })
  }

  const bodyPartScores = Object.entries(BODY_PARTS).map(([name, joints]) => {
    const sims: number[] = []
    let visible = 0
    for (const r of results) {
      for (const j of joints) {
        const sim = r.joints.get(j)
        if (sim !== undefined) sims.push(sim)
      }
      if (joints.some((j) => r.userJoints.has(j))) visible++
    }
    return { name, score: mean(sims), tracked: visible / results.length >= TRACKED_SHARE }
  })

  const notes: string[] = []
  if (coverage < 0.8) {
    notes.push(`We could only track you for ${Math.round(coverage * 100)}% of the dance — stay in frame from start to finish.`)
  }
  for (const part of bodyPartScores) {
    if (!part.tracked) {
      notes.push(part.name === 'Legs'
        ? 'Your legs were out of frame — step back so your full body is visible.'
        : `Your ${part.name.toLowerCase()} were out of frame for most of the dance.`)
    }
  }
  if (motions.length > 0 && motionMatch < 0.35) {
    notes.push("You weren't moving with the dance for most of the song — match the reference's motion, not just its poses.")
  }
  if (latency >= MAX_LATENCY - 1e-9) {
    notes.push('You were consistently behind the music — try to anticipate the next move.')
  }

  return {
    overallScore,
    sectionScores,
    bodyPartScores,
    rank: computeHonestRank(overallScore),
    alignment: [],
    scoringVersion: 'interim-1',
    coverage,
    motionMatch,
    latencyMs: Math.round(latency * 1000),
    mirrored: chosen.mirrored,
    notes,
  }
}
