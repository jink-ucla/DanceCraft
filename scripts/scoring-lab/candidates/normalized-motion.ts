/**
 * Candidate "normalized-motion": chance-normalized pose similarity + motion matching, with one
 * global latency compensation (<= 0.3 s free), a short local timing tolerance, a monotonic banded
 * alignment and progressive timing penalties.
 *
 * Design (formulas and parameters: candidates/normalized-motion/scorer-core.ts):
 *  - Geometry: reference x * width, y * height (options.referenceGeometry) before any comparison.
 *    Features are bone DIRECTIONS (canonical skeleton: position / scale / bone lengths removed,
 *    torso lean kept), so the user's webcam aspect and body proportions do not matter.
 *  - Bone similarity s = ((1 + cos dtheta) / 2) ^ 8   (~ Gaussian, sigma ~ 29 deg).
 *  - Chance level per reference frame and bone c = min(0.9, max(neutral, typical)): what standing
 *    still, or holding a random pose of the same dance, already earns. Only s - c counts; a frame's
 *    maximum is its distinctiveness D_i = sum_b w_b (1 - c_ib), so distinctive frames weigh more.
 *  - Reference-visible bones the user does not show earn 0 (but the frame's maximum still counts).
 *  - Motion: bone rotations over the preceding 0.3 s, user vs reference:
 *    motion = max(0, 1 - |m_u - m_r|^2 / (|m_r|^2 + eps^2)); pair = gain * (0.25 + 0.75 * motion).
 *  - Alignment: global offset D searched in [-1, 3] s (both orientations: as-is and mirror-style);
 *    ref frame i may use user frames within +/-0.25 s of t_i + D (full credit within +/-0.1 s,
 *    linear down to 0.5 at 0.25 s); a monotonic DP picks one user frame per ref frame (user frames
 *    cannot be reused out of order). Reference time without a tracked user frame scores 0.
 *  - score = [sum_i pair_i / sum_i D_i] * exp(-e / 1.6), e = seconds of D outside [0, 0.3].
 *  - Ranks: S >= 90, A >= 70, B >= 40, else C.
 */
import type { TimestampedPose } from '../../../src/scoring/dtw'
import type { Geometry } from './normalized-motion/features'
import type { NormalizedMotionResult, Params } from './normalized-motion/scorer-core'
import { DEFAULT_PARAMS, computeRankWith, scoreWith } from './normalized-motion/scorer-core'

export const name = 'normalized-motion (chance-normalized pose + motion, banded monotonic alignment)'

/** Record every DanceMode loop iteration; frames without a detection are `{ keypoints: [] }`. */
export const recordPolicy = 'all'

export { DEFAULT_PARAMS }
export type { NormalizedMotionResult, Params }

export interface NormalizedMotionOptions {
  /** Reference video pixel size; reference keypoints are x / width, y / height (0-1) */
  referenceGeometry?: Geometry
}

export function score(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
  options?: NormalizedMotionOptions,
): NormalizedMotionResult {
  return scoreWith(reference, user, sectionDuration, { referenceGeometry: options?.referenceGeometry })
}

/** Drop-in name used by the app. */
export const computePostDanceScore = score

/** Proposed rank thresholds (overallScore 0-1): S >= 0.90, A >= 0.70, B >= 0.40, else C. */
export function computeRank(overallScore: number): 'S' | 'A' | 'B' | 'C' {
  return computeRankWith(overallScore, DEFAULT_PARAMS)
}
