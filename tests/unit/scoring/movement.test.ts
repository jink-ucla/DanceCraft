import { describe, it, expect } from 'vitest'
import { MovementTracker } from '../../../src/scoring/movement'
import {
  STANDING_POSE,
  T_POSE,
  ARMS_UP_SQUAT,
  makeStandingStillSequence,
  makeDancingSequence,
} from './fixtures'

describe('MovementTracker', () => {
  it('returns 0 energy with no frames', () => {
    const tracker = new MovementTracker()
    expect(tracker.getMovementEnergy()).toBe(0)
    expect(tracker.isMoving()).toBe(false)
  })

  it('returns 0 energy with a single frame', () => {
    const tracker = new MovementTracker()
    tracker.addFrame(STANDING_POSE, 0)
    expect(tracker.getMovementEnergy()).toBe(0)
    expect(tracker.isMoving()).toBe(false)
  })

  it('returns ~0 energy for standing still sequence', () => {
    const tracker = new MovementTracker()
    const frames = makeStandingStillSequence()
    for (const frame of frames) {
      tracker.addFrame(frame.pose, frame.time)
    }
    expect(tracker.getMovementEnergy()).toBeLessThan(0.001)
    expect(tracker.isMoving()).toBe(false)
    expect(tracker.getMovementFactor()).toBeLessThan(0.1)
  })

  it('returns high energy for dancing sequence', () => {
    const tracker = new MovementTracker()
    const frames = makeDancingSequence()
    for (const frame of frames) {
      tracker.addFrame(frame.pose, frame.time)
    }
    expect(tracker.getMovementEnergy()).toBeGreaterThan(0.02)
    expect(tracker.isMoving()).toBe(true)
    expect(tracker.getMovementFactor()).toBeGreaterThan(0.5)
  })

  it('getMovementFactor clamps to 1.0 for very high energy', () => {
    const tracker = new MovementTracker()
    // Rapidly alternating between very different poses
    for (let i = 0; i < 30; i++) {
      const pose = i % 2 === 0 ? STANDING_POSE : ARMS_UP_SQUAT
      tracker.addFrame(pose, i * 0.033)
    }
    expect(tracker.getMovementFactor()).toBeLessThanOrEqual(1.0)
  })

  it('prunes old frames outside the rolling window', () => {
    const tracker = new MovementTracker()
    // Add frames from 0 to 3 seconds
    for (let i = 0; i < 90; i++) {
      const pose = i % 2 === 0 ? STANDING_POSE : T_POSE
      tracker.addFrame(pose, i / 30)
    }
    // Energy should only reflect frames within the 1.5s window
    const energy = tracker.getMovementEnergy()
    expect(energy).toBeGreaterThan(0)
  })

  it('reset clears all frames', () => {
    const tracker = new MovementTracker()
    tracker.addFrame(STANDING_POSE, 0)
    tracker.addFrame(T_POSE, 0.5)
    expect(tracker.getMovementEnergy()).toBeGreaterThan(0)

    tracker.reset()
    expect(tracker.getMovementEnergy()).toBe(0)
    expect(tracker.isMoving()).toBe(false)
  })
})
