import type { TimestampedPose } from '../../../src/scoring/dtw'
import { computeDanceCraftScore } from '../../../src/scoring/dancecraft'

export const name = 'DanceCraft production v3'
export const recordPolicy = 'detected'
export function score(reference: TimestampedPose[], user: TimestampedPose[], section = 10, options?: { referenceGeometry?: { width: number; height: number } }) {
  return computeDanceCraftScore(reference, user, section, options?.referenceGeometry)
}
