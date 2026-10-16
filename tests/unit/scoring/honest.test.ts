import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computeHonestScore, computeHonestRank } from '../../../src/scoring/honest'
import type { TimestampedPose } from '../../../src/scoring/dtw'

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'scoring')
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))

const refTimeline = load('ref-ineedu-15s.json') as { keyframes: { time: number; keypoints: TimestampedPose['pose']['keypoints'] }[] }
const reference: TimestampedPose[] = refTimeline.keyframes.map((k) => ({ time: k.time, pose: { keypoints: k.keypoints } }))

const shift = (seq: TimestampedPose[], dt: number) => seq.map((f) => ({ ...f, time: f.time + dt }))
const hideLegs = (seq: TimestampedPose[]) => seq.map((f) => ({
  time: f.time,
  pose: { keypoints: f.pose.keypoints.map((k) => (/knee|ankle|heel|foot/.test(k.name) ? { ...k, score: 0 } : k)) },
}))

describe('computeHonestScore', () => {
  it('gives a perfect copy full marks', () => {
    const r = computeHonestScore(reference, reference)
    expect(r.overallScore).toBeGreaterThanOrEqual(0.95)
    expect(r.rank).toBe('S')
    expect(r.coverage).toBe(1)
  })

  it('tolerates normal camera/reaction lag (<= 0.5 s)', () => {
    expect(computeHonestScore(reference, shift(reference, 0.25)).overallScore).toBeGreaterThanOrEqual(0.9)
    expect(computeHonestScore(reference, shift(reference, 0.5)).overallScore).toBeGreaterThanOrEqual(0.85)
  })

  it('penalises dancing well over a second late (legacy DTW gave 100%)', () => {
    const r = computeHonestScore(reference, shift(reference, 1.5))
    expect(r.overallScore).toBeLessThan(0.5)
    expect(r.rank).toBe('C')
  })

  it.each([
    ['user-still-upperbody-session1.json'],
    ['user-session2-upperbody.json'],
    ['user-session3.json'],
  ])('scores the real "did nothing" session %s as C (legacy gave A)', (file) => {
    const r = computeHonestScore(reference, load(file))
    expect(r.overallScore).toBeLessThan(0.15)
    expect(r.rank).toBe('C')
    expect(r.notes.length).toBeGreaterThan(0)
  })

  it('scores a frozen pose and reversed choreography low', () => {
    const frozen = reference.map((f) => ({ time: f.time, pose: reference[0].pose }))
    const reversed = reference.map((f, i) => ({ time: f.time, pose: reference[reference.length - 1 - i].pose }))
    expect(computeHonestScore(reference, frozen).overallScore).toBeLessThan(0.35)
    expect(computeHonestScore(reference, reversed).overallScore).toBeLessThan(0.45)
  })

  it('penalises (but does not zero) legs out of frame and says so', () => {
    const r = computeHonestScore(reference, hideLegs(reference))
    expect(r.overallScore).toBeGreaterThan(0.3)
    expect(r.overallScore).toBeLessThan(0.7)
    const legs = r.bodyPartScores.find((b) => b.name === 'Legs')!
    expect(legs.tracked).toBe(false)
    expect(r.notes.some((n) => /legs/i.test(n))).toBe(true)
  })

  it('handles missing data', () => {
    expect(computeHonestScore([], reference).overallScore).toBe(0)
    const r = computeHonestScore(reference, [])
    expect(r.overallScore).toBe(0)
    expect(r.rank).toBe('C')
  })
})

describe('computeHonestRank', () => {
  it('uses stricter thresholds than the legacy ranks', () => {
    expect(computeHonestRank(0.9)).toBe('S')
    expect(computeHonestRank(0.75)).toBe('A')
    expect(computeHonestRank(0.6)).toBe('B')
    expect(computeHonestRank(0.55)).toBe('B')
    expect(computeHonestRank(0.49)).toBe('C')
  })
})

describe('computeHonestScore — mirror-style dancing', () => {
  const swap = (n: string) => (n.startsWith('left_') ? 'right_' + n.slice(5) : n.startsWith('right_') ? 'left_' + n.slice(6) : n)
  const mirrorStyle = reference.map((f) => ({
    time: f.time,
    pose: { keypoints: f.pose.keypoints.map((k) => ({ ...k, x: 1 - k.x, name: swap(k.name) })) },
  }))

  it('gives a mirror-style perfect copy full marks (it scored 46% before orientation detection)', () => {
    const r = computeHonestScore(reference, mirrorStyle)
    expect(r.overallScore).toBeGreaterThanOrEqual(0.95)
    expect(r.mirrored).toBe(true)
  })

  it('does not report mirroring for a normal copy', () => {
    expect(computeHonestScore(reference, reference).mirrored).toBe(false)
  })
})
