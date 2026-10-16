import type { TimestampedPose } from '../scoring/dtw'

export interface RecordingAnchor {
  videoTime: number
  referenceTime: number
}

/**
 * Keep the recording and the music on their own clocks. A slow inference or a
 * stalled reference player must not silently turn one clock into the other.
 * Metadata lives in the existing poses JSON, so old sessions remain readable.
 */
export function recordingAnchors(poses: TimestampedPose[]): RecordingAnchor[] {
  const anchors: RecordingAnchor[] = []
  for (const sample of poses) {
    const videoTime = sample.videoTime
    if (videoTime == null || !Number.isFinite(videoTime) || videoTime < 0 ||
        !Number.isFinite(sample.time) || sample.time < 0) continue
    const previous = anchors.at(-1)
    if (previous && (videoTime <= previous.videoTime || sample.time < previous.referenceTime)) continue
    anchors.push({ videoTime, referenceTime: sample.time })
  }
  return anchors
}

function mapClock(
  anchors: RecordingAnchor[],
  value: number,
  from: keyof RecordingAnchor,
  to: keyof RecordingAnchor,
): number {
  if (!Number.isFinite(value)) return 0
  if (anchors.length === 0) return Math.max(0, value)
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  // Extend at real-time speed at the edges. In particular, do not delete the
  // lead-in just because the detector did not find a person in the first frame.
  if (value <= first[from]) return Math.max(0, first[to] + value - first[from])
  if (value > last[from]) return Math.max(0, last[to] + value - last[from])

  let lo = 0
  let hi = anchors.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (anchors[mid][from] < value) lo = mid
    else hi = mid
  }
  const a = anchors[lo]
  const b = anchors[hi]
  const span = b[from] - a[from]
  if (span <= 0) return a[to]
  return a[to] + (value - a[from]) / span * (b[to] - a[to])
}

export function referenceTimeAtVideoTime(anchors: RecordingAnchor[], videoTime: number, legacyOffset = 0): number {
  return anchors.length > 0
    ? mapClock(anchors, videoTime, 'videoTime', 'referenceTime')
    : Math.max(0, videoTime + legacyOffset)
}

export function videoTimeAtReferenceTime(anchors: RecordingAnchor[], referenceTime: number, legacyOffset = 0): number {
  return anchors.length > 0
    ? mapClock(anchors, referenceTime, 'referenceTime', 'videoTime')
    : Math.max(0, referenceTime - legacyOffset)
}

/** Correct real playback drift, rather than assuming simultaneous play() calls stay in sync. */
export function needsPlaybackCorrection(actualTime: number, targetTime: number): boolean {
  return Number.isFinite(actualTime) && Number.isFinite(targetTime) && Math.abs(actualTime - targetTime) > 0.08
}
