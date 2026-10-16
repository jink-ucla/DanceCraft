import { describe, expect, it } from 'vitest'
import type { TimestampedPose } from '../../../src/scoring/dtw'
import { recordingAnchors, referenceTimeAtVideoTime, videoTimeAtReferenceTime, needsPlaybackCorrection } from '../../../src/recording/timeline'

function sample(time: number, videoTime?: number): TimestampedPose {
  return { time, videoTime, pose: { keypoints: [] } }
}

describe('recording/music clock mapping', () => {
  it('preserves real startup delay instead of treating the first pose as music zero', () => {
    const anchors = recordingAnchors([sample(0.1, 0.6), sample(1.1, 1.6), sample(2.1, 2.6)])
    expect(referenceTimeAtVideoTime(anchors, 1.6)).toBeCloseTo(1.1)
    expect(videoTimeAtReferenceTime(anchors, 1.1)).toBeCloseTo(1.6)
    expect(referenceTimeAtVideoTime(anchors, 0)).toBe(0)
    expect(videoTimeAtReferenceTime(anchors, 0)).toBeCloseTo(0.5)
  })

  it('maps variable inference/capture intervals without compressing them to a nominal FPS', () => {
    const anchors = recordingAnchors([sample(0, 0.05), sample(0.1, 0.17), sample(0.3, 0.43), sample(1, 1.09)])
    expect(referenceTimeAtVideoTime(anchors, 0.3)).toBeCloseTo(0.2)
    expect(videoTimeAtReferenceTime(anchors, 0.2)).toBeCloseTo(0.3)
    expect(referenceTimeAtVideoTime(anchors, 1.09)).toBeCloseTo(1)
  })

  it('keeps reference playback stalls as flat music time while recording time advances', () => {
    const anchors = recordingAnchors([sample(0, 0), sample(1, 1), sample(1, 1.5), sample(2, 2.5)])
    expect(referenceTimeAtVideoTime(anchors, 1.3)).toBe(1)
    expect(referenceTimeAtVideoTime(anchors, 2)).toBe(1.5)
    expect(videoTimeAtReferenceTime(anchors, 1.5)).toBe(2)
    // Preserve the complete plateau's first frame when seeking to its start.
    expect(videoTimeAtReferenceTime(anchors, 1)).toBe(1)
    expect(videoTimeAtReferenceTime(recordingAnchors([sample(0, 0), sample(1, 1), sample(1, 1.5)]), 1)).toBe(1)
  })

  it('does not require a tracked person to preserve capture timing', () => {
    expect(recordingAnchors([sample(2, 2.8), sample(3, 3.8)])).toHaveLength(2)
  })

  it('retains legacy offset semantics, including inverse seek, for old pose arrays', () => {
    const anchors = recordingAnchors([sample(0.47), sample(1.47)])
    expect(anchors).toEqual([])
    expect(referenceTimeAtVideoTime(anchors, 1, 0.47)).toBeCloseTo(1.47)
    expect(videoTimeAtReferenceTime(anchors, 1.47, 0.47)).toBeCloseTo(1)
    expect(videoTimeAtReferenceTime(anchors, 0, 0.47)).toBe(0)
  })

  it('drops corrupt/nonmonotonic anchors instead of inventing negative playback rates', () => {
    const anchors = recordingAnchors([sample(0, 0), sample(1, 1), sample(2, NaN), sample(2, 1), sample(0.5, 2), sample(3, 3)])
    expect(anchors).toEqual([{ videoTime: 0, referenceTime: 0 }, { videoTime: 1, referenceTime: 1 }, { videoTime: 3, referenceTime: 3 }])
  })

  it('corrects an independently stalled decoder but tolerates sub-frame jitter', () => {
    expect(needsPlaybackCorrection(1, 1.04)).toBe(false)
    expect(needsPlaybackCorrection(1, 1.3)).toBe(true)
    expect(needsPlaybackCorrection(2, 1.3)).toBe(true)
    expect(needsPlaybackCorrection(NaN, 1)).toBe(false)
  })
})
