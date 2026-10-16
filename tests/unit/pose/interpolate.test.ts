import { describe, it, expect } from 'vitest'
import { findKeyframeIndex, poseAtTime } from '../../../src/pose/interpolate'
import type { PoseKeyframe } from '../../../src/pose/interpolate'
import type { Keypoint } from '../../../src/scoring/types'
import { KEYPOINT_NAMES } from '../../../src/scoring/types'
import {
  DEFAULT_STANDING_POSE,
  bodyScaleOf,
  characterBounds,
  computePoseFrame,
  headGeometry,
  idlePoseAt,
} from '../../../src/components/characters'

function kp(name: string, x: number, y: number, score = 1): Keypoint {
  return { name, x, y, score }
}

function frame(time: number, points: [number, number, number?][]): PoseKeyframe {
  return {
    time,
    keypoints: points.map(([x, y, score], i) => kp(`kp_${i}`, x, y, score ?? 1)),
  }
}

describe('findKeyframeIndex', () => {
  const frames = [frame(0, []), frame(1, []), frame(2, []), frame(3, [])]

  it('returns the last keyframe at or before t', () => {
    expect(findKeyframeIndex(frames, 0)).toBe(0)
    expect(findKeyframeIndex(frames, 1.5)).toBe(1)
    expect(findKeyframeIndex(frames, 2)).toBe(2)
    expect(findKeyframeIndex(frames, 10)).toBe(3)
  })

  it('returns -1 before the first keyframe or for an empty list', () => {
    expect(findKeyframeIndex(frames, -0.1)).toBe(-1)
    expect(findKeyframeIndex([], 1)).toBe(-1)
  })
})

describe('poseAtTime', () => {
  const frames = [
    frame(0, [[0, 0, 0], [10, 10, 1]]),
    frame(1, [[10, 20, 1], [10, 10, 1]]),
    frame(3, [[30, 0, 0.5], [0, 0, 0]]),
  ]

  it('returns null for an empty keyframe list', () => {
    expect(poseAtTime([], 0)).toBeNull()
  })

  it('returns the exact keyframe at a keyframe time', () => {
    const pose = poseAtTime(frames, 1)!
    expect(pose.keypoints[0]).toEqual(kp('kp_0', 10, 20, 1))
  })

  it('linearly interpolates x, y and score and keeps the name', () => {
    const pose = poseAtTime(frames, 0.25)!
    expect(pose.keypoints).toHaveLength(2)
    expect(pose.keypoints[0].name).toBe('kp_0')
    expect(pose.keypoints[0].x).toBeCloseTo(2.5)
    expect(pose.keypoints[0].y).toBeCloseTo(5)
    expect(pose.keypoints[0].score).toBeCloseTo(0.25)
    expect(pose.keypoints[1]).toEqual(kp('kp_1', 10, 10, 1))
  })

  it('interpolates across uneven keyframe spacing', () => {
    const pose = poseAtTime(frames, 2)! // halfway between t=1 and t=3
    expect(pose.keypoints[0].x).toBeCloseTo(20)
    expect(pose.keypoints[0].y).toBeCloseTo(10)
    expect(pose.keypoints[0].score).toBeCloseTo(0.75)
    expect(pose.keypoints[1].x).toBeCloseTo(5)
  })

  it('clamps before the first and after the last keyframe', () => {
    expect(poseAtTime(frames, -5)!.keypoints[0]).toEqual(kp('kp_0', 0, 0, 0))
    expect(poseAtTime(frames, 99)!.keypoints[0]).toEqual(kp('kp_0', 30, 0, 0.5))
    expect(poseAtTime(frames, Infinity)!.keypoints[0]).toEqual(kp('kp_0', 30, 0, 0.5))
    expect(poseAtTime(frames, Number.NaN)!.keypoints[0]).toEqual(kp('kp_0', 0, 0, 0))
  })

  it('works with a single keyframe', () => {
    const single = [frame(2, [[1, 2, 0.9]])]
    expect(poseAtTime(single, 0)!.keypoints[0]).toEqual(kp('kp_0', 1, 2, 0.9))
    expect(poseAtTime(single, 5)!.keypoints[0]).toEqual(kp('kp_0', 1, 2, 0.9))
  })

  it('never mutates or aliases the input keyframes', () => {
    const before = JSON.stringify(frames)
    const clamped = poseAtTime(frames, -1)!
    clamped.keypoints[0].x = 999
    const mid = poseAtTime(frames, 0.5)!
    mid.keypoints[1].x = 999
    expect(JSON.stringify(frames)).toBe(before)
  })

  it('tolerates keypoint-count mismatch by using the nearer frame length', () => {
    const mixed = [
      frame(0, [[0, 0], [5, 5], [7, 7]]), // 3 keypoints
      frame(1, [[10, 10]]), // 1 keypoint
    ]
    const early = poseAtTime(mixed, 0.2)!
    expect(early.keypoints).toHaveLength(3)
    expect(early.keypoints[0].x).toBeCloseTo(2)
    expect(early.keypoints[1]).toEqual(kp('kp_1', 5, 5, 1))
    expect(early.keypoints[2]).toEqual(kp('kp_2', 7, 7, 1))

    const late = poseAtTime(mixed, 0.8)!
    expect(late.keypoints).toHaveLength(1)
    expect(late.keypoints[0].x).toBeCloseTo(8)
  })

  it('handles duplicate timestamps without dividing by zero', () => {
    const dup = [frame(0, [[0, 0]]), frame(1, [[10, 0]]), frame(1, [[20, 0]]), frame(2, [[30, 0]])]
    for (const t of [0.5, 1, 1.5]) {
      const pose = poseAtTime(dup, t)!
      expect(Number.isFinite(pose.keypoints[0].x)).toBe(true)
    }
    expect(poseAtTime(dup, 1.5)!.keypoints[0].x).toBeCloseTo(25)
  })

  it('handles realistic 33-keypoint MediaPipe frames', () => {
    const a = { time: 0, keypoints: DEFAULT_STANDING_POSE.keypoints }
    const b = { time: 1, keypoints: idlePoseAt(0.3).keypoints }
    const pose = poseAtTime([a, b], 0.5)!
    expect(pose.keypoints).toHaveLength(33)
    pose.keypoints.forEach((p, i) => {
      expect(p.name).toBe(KEYPOINT_NAMES[i])
      expect(p.x).toBeCloseTo((a.keypoints[i].x + b.keypoints[i].x) / 2)
    })
  })
})

describe('character poses', () => {
  it('DEFAULT_STANDING_POSE has 33 keypoints in KEYPOINT_NAMES order', () => {
    expect(DEFAULT_STANDING_POSE.keypoints).toHaveLength(33)
    DEFAULT_STANDING_POSE.keypoints.forEach((p, i) => {
      expect(p.name).toBe(KEYPOINT_NAMES[i])
      expect(p.score).toBeGreaterThan(0.5)
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(1)
    })
  })

  it('DEFAULT_STANDING_POSE is upright: head above shoulders above hips above feet', () => {
    const y = (name: string) => DEFAULT_STANDING_POSE.keypoints.find((p) => p.name === name)!.y
    expect(y('nose')).toBeLessThan(y('left_shoulder'))
    expect(y('left_shoulder')).toBeLessThan(y('left_hip'))
    expect(y('left_hip')).toBeLessThan(y('left_knee'))
    expect(y('left_knee')).toBeLessThan(y('left_ankle'))
  })

  it('idlePoseAt is deterministic, keeps feet planted and moves the arms', () => {
    const a = idlePoseAt(0.3)
    const b = idlePoseAt(0.3)
    expect(a).toEqual(b)
    expect(a.keypoints).toHaveLength(33)

    const later = idlePoseAt(0.9)
    const ankle = 27
    const wrist = 15
    expect(later.keypoints[ankle]).toEqual(a.keypoints[ankle])
    expect(Math.abs(later.keypoints[wrist].x - a.keypoints[wrist].x)).toBeGreaterThan(0.01)
    // Does not mutate the default pose
    expect(DEFAULT_STANDING_POSE.keypoints[wrist].x).toBe(0.612)
  })

  it('idlePoseAt tolerates non-finite time', () => {
    expect(idlePoseAt(Number.NaN)).toEqual(idlePoseAt(0))
  })
})

describe('character geometry', () => {
  it('bodyScaleOf returns the torso length for the standing pose', () => {
    expect(bodyScaleOf(DEFAULT_STANDING_POSE.keypoints)).toBeCloseTo(0.27, 2)
    expect(bodyScaleOf([])).toBeNull()
  })

  it('headGeometry faces forward for the standing pose and turns with the nose', () => {
    const unit = bodyScaleOf(DEFAULT_STANDING_POSE.keypoints)!
    const head = headGeometry(DEFAULT_STANDING_POSE.keypoints, unit)!
    expect(head.yaw).toBeCloseTo(0, 5)
    expect(head.upY).toBeLessThan(-0.9)
    expect(head.cy).toBeLessThan(DEFAULT_STANDING_POSE.keypoints[0].y)

    const turned = DEFAULT_STANDING_POSE.keypoints.map((p) => ({ ...p }))
    turned[0].x += 0.03 // nose toward image-right
    expect(headGeometry(turned, unit)!.yaw).toBeGreaterThan(0.3)
    turned[0].x -= 0.06 // nose toward image-left
    expect(headGeometry(turned, unit)!.yaw).toBeLessThan(-0.3)

    const noNose = DEFAULT_STANDING_POSE.keypoints.map((p, i) => (i === 0 ? { ...p, score: 0 } : p))
    expect(headGeometry(noNose, unit)).toBeNull()
  })

  it('characterBounds includes the cartoon head and accessory', () => {
    const mannequin = characterBounds(DEFAULT_STANDING_POSE, 'mannequin')!
    const host = characterBounds(DEFAULT_STANDING_POSE, 'host')!
    expect(host.minY).toBeLessThan(mannequin.minY)
    expect(host.minX).toBeLessThan(mannequin.minX)
    expect(host.maxY).toBeGreaterThan(mannequin.maxY)
  })

  it('characterBounds rejects poses with too few visible keypoints', () => {
    const hidden = { keypoints: DEFAULT_STANDING_POSE.keypoints.map((p) => ({ ...p, score: 0 })) }
    expect(characterBounds(hidden, 'buddy')).toBeNull()
    expect(computePoseFrame([hidden], 'buddy')).toBeNull()
  })

  it('computePoseFrame covers every pose of an idle loop with one stable body scale', () => {
    const poses = Array.from({ length: 10 }, (_, i) => idlePoseAt(i * 0.125))
    const f = computePoseFrame(poses, 'buddy')!
    expect(f.bodyScale).toBeGreaterThan(0)
    for (const p of poses) {
      const b = characterBounds(p, 'buddy', f.bodyScale)!
      expect(b.minX).toBeGreaterThanOrEqual(f.minX - 1e-9)
      expect(b.maxX).toBeLessThanOrEqual(f.maxX + 1e-9)
      expect(b.minY).toBeGreaterThanOrEqual(f.minY - 1e-9)
      expect(b.maxY).toBeLessThanOrEqual(f.maxY + 1e-9)
    }
  })
})
