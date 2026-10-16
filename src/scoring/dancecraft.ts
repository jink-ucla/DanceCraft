import type { TimestampedPose } from './dtw'
import { score } from './keymoment-core'

/** Production entry for the held-out winner. Reference coordinates are normalized;
 * camera coordinates are pixels. Restore the reference video's aspect before judging. */
export function computeDanceCraftScore(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
  referenceGeometry?: { width: number; height: number },
) {
  const result = score(reference, user, sectionDuration > 0 ? sectionDuration : 10, { referenceGeometry })
  return { ...result, mirrored: result.orientation === 'mirror' }
}
