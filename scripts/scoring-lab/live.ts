/**
 * Scoring lab — offline replica of DanceMode's live key-pose judging.
 *
 * Mirrors src/components/DanceMode.tsx danceLoop (as of commit 7aebdba) frame by frame:
 *   - key poses: detectKeyPoses(timeline, { minGapSeconds: 3.0, heldFrameCount: 8, distinctiveThreshold: 1.0 })
 *   - elapsed = refVideo.currentTime (DetectorFrame.videoTime)
 *   - presence gate: checkPresence(userPose); only present frames feed MovementTracker
 *     (addFrame(pose, elapsed)) and can score
 *   - only the NEXT key pose is judged; window = [ts - windowBefore, ts + windowAfter]
 *   - 'move' key poses: (0.6 * compareMoveVelocity(expectedVelocity, getRecentPose(moveWindow ?? 0.3), pose, focus)
 *                        + 0.4 * comparePoses(...).overallScore) * movementFactor
 *   - other key poses: comparePoses(kp.pose, pose, { focusJoints, focusWeight, nonFocusWeight }).overallScore * movementFactor
 *   - >= perfectThreshold -> perfect, >= goodThreshold -> good (advance); present frame past the
 *     window -> miss; absent frame with elapsed > ts + 0.5 -> miss
 *   - loop ends when the video ends or (all key poses judged and elapsed > last ts + 2)
 *   - points: 100 per perfect / 50 per good. DanceMode's combo multiplier reads a stale
 *     `combo` captured when the rAF loop started (always 0), so it never applies.
 *
 * Dependencies are injectable (LiveDeps) so a candidate can plug in changed comparison /
 * movement / presence code without editing this file. Update this replica if DanceMode's
 * judging logic changes.
 */
import type { Pose, PoseTimeline } from './data'
import type { DetectorFrame } from './synth'
import type { KeyPose, KeyPoseConfig } from '../../src/scoring/keyPoseDetection'
import type { CompareOptions } from '../../src/scoring/comparison'
import type { PoseComparisonResult } from '../../src/scoring/types'
import type { Difficulty, DifficultyConfig } from '../../src/storage/scores'
import { detectKeyPoses } from '../../src/scoring/keyPoseDetection'
import { comparePoses, compareMoveVelocity } from '../../src/scoring/comparison'
import { checkPresence } from '../../src/scoring/presence'
import { MovementTracker } from '../../src/scoring/movement'
import { DIFFICULTY_CONFIGS } from '../../src/storage/scores'

export type { Difficulty, DifficultyConfig, KeyPose }

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']

/** detectKeyPoses options used by DanceMode when no custom key poses are saved. */
export const DANCE_MODE_KEYPOSE_OPTIONS: Partial<KeyPoseConfig> = {
  minGapSeconds: 3.0,
  heldFrameCount: 8,
  distinctiveThreshold: 1.0,
}

export interface MovementTrackerLike {
  addFrame(pose: Pose, time: number): void
  getMovementFactor(): number
  getRecentPose(secondsAgo: number): Pose | null
  reset(): void
}

export interface LiveDeps {
  detectKeyPoses: (timeline: PoseTimeline, config?: Partial<KeyPoseConfig>) => KeyPose[]
  comparePoses: (reference: Pose, user: Pose, options?: CompareOptions) => PoseComparisonResult
  compareMoveVelocity: (expected: Record<string, number>, before: Pose, after: Pose, focusJoints?: string[]) => number
  checkPresence: (pose: Pose | null) => { present: boolean }
  createMovementTracker: () => MovementTrackerLike
  difficultyConfigs: Record<Difficulty, DifficultyConfig>
  keyPoseOptions: Partial<KeyPoseConfig>
}

export const DEFAULT_LIVE_DEPS: LiveDeps = {
  detectKeyPoses,
  comparePoses,
  compareMoveVelocity,
  checkPresence,
  createMovementTracker: () => new MovementTracker(),
  difficultyConfigs: DIFFICULTY_CONFIGS,
  keyPoseOptions: DANCE_MODE_KEYPOSE_OPTIONS,
}

export type Judgement = 'perfect' | 'good' | 'miss' | 'unjudged'

export interface KeyPoseOutcome {
  timestamp: number
  type: KeyPose['type']
  result: Judgement
  /** Video time of the judgement (NaN if unjudged) */
  judgedAt: number
  /** Best effective score seen inside the window (after movementFactor) */
  bestEffective: number
  /** Raw score (before movementFactor) at the best effective frame */
  bestRaw: number
  /** movementFactor at the best effective frame */
  bestMovementFactor: number
  /** Present frames evaluated inside the window */
  framesInWindow: number
}

export interface LiveResult {
  difficulty: Difficulty
  perfect: number
  good: number
  miss: number
  unjudged: number
  total: number
  /** (perfect + good) / total */
  hitRate: number
  points: number
  /** Video time when the loop finished */
  endedAt: number
  keyPoses: KeyPoseOutcome[]
}

export interface LiveInput {
  timeline: PoseTimeline
  frames: DetectorFrame[]
  difficulty: Difficulty
  keyPoses?: KeyPose[]
}

export type LiveSimulator = (input: LiveInput) => LiveResult

const keyPoseCache = new WeakMap<PoseTimeline, Map<LiveDeps, KeyPose[]>>()

/** Key poses DanceMode would auto-detect for this timeline (cached per timeline + deps). */
export function danceModeKeyPoses(timeline: PoseTimeline, deps: LiveDeps = DEFAULT_LIVE_DEPS): KeyPose[] {
  let byDeps = keyPoseCache.get(timeline)
  if (!byDeps) {
    byDeps = new Map()
    keyPoseCache.set(timeline, byDeps)
  }
  let kps = byDeps.get(deps)
  if (!kps) {
    kps = deps.detectKeyPoses(timeline, deps.keyPoseOptions)
    byDeps.set(deps, kps)
  }
  return kps
}

/** Video time at which DanceMode's loop stops (video end, or last key pose + 2 s). */
export function danceEndVideoTime(keyPoses: KeyPose[], duration: number): number {
  if (keyPoses.length === 0) return duration
  return Math.min(duration, keyPoses[keyPoses.length - 1].timestamp + 2 + 1e-6)
}

export function simulateDanceModeLive(input: LiveInput, deps: LiveDeps = DEFAULT_LIVE_DEPS): LiveResult {
  const { timeline, frames, difficulty } = input
  const cfg = deps.difficultyConfigs[difficulty]
  const keyPoses = input.keyPoses ?? danceModeKeyPoses(timeline, deps)
  const tracker = deps.createMovementTracker()
  tracker.reset()

  const outcomes: KeyPoseOutcome[] = keyPoses.map((kp) => ({
    timestamp: kp.timestamp,
    type: kp.type,
    result: 'unjudged',
    judgedAt: NaN,
    bestEffective: 0,
    bestRaw: 0,
    bestMovementFactor: 0,
    framesInWindow: 0,
  }))

  let nextIdx = 0
  let points = 0
  let endedAt = frames[frames.length - 1]?.videoTime ?? 0
  const lastTs = keyPoses[keyPoses.length - 1]?.timestamp
  const videoDuration = Math.max(timeline.duration, timeline.keyframes[timeline.keyframes.length - 1]?.time ?? 0)

  const judge = (result: Judgement, elapsed: number) => {
    outcomes[nextIdx].result = result
    outcomes[nextIdx].judgedAt = elapsed
    if (result === 'perfect') points += 100 // 100 * (1 + combo * 0.1) with stale combo = 0
    if (result === 'good') points += 50 // 50 * (1 + combo * 0.05) with stale combo = 0
    nextIdx++
  }

  for (const frame of frames) {
    const elapsed = frame.videoTime
    const userPose = frame.pose
    const presence = deps.checkPresence(userPose)

    if (userPose && presence.present) {
      tracker.addFrame(userPose, elapsed)
      const movementFactor = tracker.getMovementFactor()

      if (nextIdx < keyPoses.length) {
        const kp = keyPoses[nextIdx]
        const timeUntilHit = kp.timestamp - elapsed
        if (timeUntilHit <= cfg.windowBefore && timeUntilHit >= -cfg.windowAfter) {
          let raw: number
          const compareOpts: CompareOptions = {
            focusJoints: kp.focusJoints,
            focusWeight: cfg.focusWeight,
            nonFocusWeight: cfg.nonFocusWeight,
          }
          if (kp.type === 'move' && kp.expectedVelocity) {
            const pastPose = tracker.getRecentPose(kp.moveWindow ?? 0.3)
            const velocityScore = pastPose
              ? deps.compareMoveVelocity(kp.expectedVelocity, pastPose, userPose, kp.focusJoints)
              : 0
            const poseResult = deps.comparePoses(kp.pose, userPose, compareOpts)
            raw = 0.6 * velocityScore + 0.4 * poseResult.overallScore
          } else {
            raw = deps.comparePoses(kp.pose, userPose, compareOpts).overallScore
          }
          const effective = raw * movementFactor
          const o = outcomes[nextIdx]
          o.framesInWindow++
          if (effective > o.bestEffective || o.framesInWindow === 1) {
            o.bestEffective = effective
            o.bestRaw = raw
            o.bestMovementFactor = movementFactor
          }
          if (effective >= cfg.perfectThreshold) judge('perfect', elapsed)
          else if (effective >= cfg.goodThreshold) judge('good', elapsed)
          else if (elapsed > kp.timestamp + cfg.windowAfter) judge('miss', elapsed) // unreachable in DanceMode too
        } else if (elapsed > kp.timestamp + cfg.windowAfter) {
          judge('miss', elapsed)
        }
      }
    } else if (nextIdx < keyPoses.length) {
      const kp = keyPoses[nextIdx]
      if (elapsed > kp.timestamp + 0.5) judge('miss', elapsed)
    }

    const videoEnded = elapsed >= videoDuration - 1e-9 || elapsed >= timeline.duration - 1e-9
    const pastLastPose = nextIdx >= keyPoses.length && lastTs !== undefined && elapsed > lastTs + 2
    if (videoEnded || pastLastPose) {
      endedAt = elapsed
      break
    }
  }

  const count = (r: Judgement) => outcomes.filter((o) => o.result === r).length
  const perfect = count('perfect')
  const good = count('good')
  return {
    difficulty,
    perfect,
    good,
    miss: count('miss'),
    unjudged: count('unjudged'),
    total: keyPoses.length,
    hitRate: keyPoses.length > 0 ? (perfect + good) / keyPoses.length : 0,
    points,
    endedAt,
    keyPoses: outcomes,
  }
}
