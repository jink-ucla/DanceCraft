import { describe, it, expect } from 'vitest'
import {
  advanceDrill,
  clampRepeats,
  createDrillState,
  currentRepNumber,
  effectiveLoopEnd,
  formatClock,
  formatDrillRange,
  formatSpeed,
  isValidDrillLoop,
  LOOP_END_EPSILON,
  repProgress,
  resetDrill,
  resolveDrillRange,
  restartRep,
  shouldWrapLoop,
} from '../../../src/coach/drill'
import type { DrillState } from '../../../src/coach/drill'
import { MAX_DRILL_REPEATS, MIN_DRILL_REPEATS, MIN_DRILL_SECONDS } from '../../../src/coach/types'

const LOOP = { loopStart: 10, loopEnd: 20 }

/** One normal pass: play from just after loopStart to the loop end. */
function playOnePass(state: DrillState) {
  const mid = advanceDrill(state, { prevTime: 10, currentTime: 15, ...LOOP })
  return advanceDrill(mid.state, { prevTime: 15, currentTime: 20.01, ...LOOP })
}

/**
 * Simulates PracticeMode's rAF loop: playback advances by `dt` per tick and
 * the caller wraps to loopStart whenever advanceDrill says so.
 */
function simulate(state: DrillState, ticks: number, dt: number, loop = LOOP) {
  let t = loop.loopStart
  let s = state
  let completions = 0
  let counted = 0
  for (let i = 0; i < ticks && !s.completed; i++) {
    const prev = t
    t += dt
    const step = advanceDrill(s, { prevTime: prev, currentTime: t, ...loop })
    s = step.state
    if (step.counted) counted++
    if (step.completed) completions++
    if (step.wrapped) t = loop.loopStart
  }
  return { state: s, completions, counted }
}

describe('createDrillState / clampRepeats', () => {
  it('starts armed with zero reps', () => {
    expect(createDrillState({ repeats: 4 })).toEqual({
      repeats: 4,
      completedReps: 0,
      completed: false,
      armed: true,
    })
  })

  it('clamps and rounds repeats into the allowed range', () => {
    expect(clampRepeats(0)).toBe(MIN_DRILL_REPEATS)
    expect(clampRepeats(-3)).toBe(MIN_DRILL_REPEATS)
    expect(clampRepeats(99)).toBe(MAX_DRILL_REPEATS)
    expect(clampRepeats(3.6)).toBe(4)
    expect(clampRepeats(Number.NaN)).toBe(MIN_DRILL_REPEATS)
    expect(createDrillState({ repeats: 50 }).repeats).toBe(MAX_DRILL_REPEATS)
  })
})

describe('advanceDrill — wrap counting', () => {
  it('does nothing while playing inside the loop', () => {
    const s = createDrillState({ repeats: 3 })
    const step = advanceDrill(s, { prevTime: 12, currentTime: 12.03, ...LOOP })
    expect(step).toEqual({ state: s, wrapped: false, counted: false, completed: false })
    expect(step.state).toBe(s)
  })

  it('counts a rep and wraps when playback reaches loopEnd', () => {
    const step = playOnePass(createDrillState({ repeats: 3 }))
    expect(step.wrapped).toBe(true)
    expect(step.counted).toBe(true)
    expect(step.completed).toBe(false)
    expect(step.state.completedReps).toBe(1)
    expect(step.state.armed).toBe(true)
  })

  it('treats playback within LOOP_END_EPSILON of the end as reaching it', () => {
    const s = createDrillState({ repeats: 3 })
    const step = advanceDrill(s, { prevTime: 19.9, currentTime: 20 - LOOP_END_EPSILON / 2, ...LOOP })
    expect(step.wrapped).toBe(true)
    expect(step.counted).toBe(true)
  })

  it('does not mutate the input state', () => {
    const s = createDrillState({ repeats: 3 })
    const snapshot = { ...s }
    playOnePass(s)
    expect(s).toEqual(snapshot)
  })

  it('reports the current rep number', () => {
    let s = createDrillState({ repeats: 2 })
    expect(currentRepNumber(s)).toBe(1)
    s = playOnePass(s).state
    expect(currentRepNumber(s)).toBe(2)
    s = playOnePass(s).state
    expect(currentRepNumber(s)).toBe(2)
  })
})

describe('advanceDrill — completion', () => {
  it('completes exactly when completedReps reaches repeats', () => {
    let s = createDrillState({ repeats: 3 })
    const steps = [playOnePass(s)]
    s = steps[0].state
    steps.push(playOnePass(s))
    s = steps[1].state
    steps.push(playOnePass(s))
    s = steps[2].state

    expect(steps.map((st) => st.completed)).toEqual([false, false, true])
    expect(s.completedReps).toBe(3)
    expect(s.completed).toBe(true)
    expect(s.armed).toBe(false)
  })

  it('stops counting after completion', () => {
    let s = createDrillState({ repeats: 1 })
    s = playOnePass(s).state
    expect(s.completed).toBe(true)
    const after = playOnePass(s)
    expect(after.counted).toBe(false)
    expect(after.completed).toBe(false)
    expect(after.state).toBe(s)
    expect(after.state.completedReps).toBe(1)
  })

  it('fires completion once over a simulated 30fps drill', () => {
    const run = simulate(createDrillState({ repeats: 4 }), 10_000, 1 / 30)
    expect(run.completions).toBe(1)
    expect(run.counted).toBe(4)
    expect(run.state.completedReps).toBe(4)
    expect(run.state.completed).toBe(true)
  })

  it('works at reduced playback speed (smaller time steps)', () => {
    const run = simulate(createDrillState({ repeats: 2 }), 10_000, 0.5 / 60)
    expect(run.counted).toBe(2)
    expect(run.completions).toBe(1)
  })
})

describe('advanceDrill — manual seeks', () => {
  it('ignores a seek past the loop end (wraps but does not count)', () => {
    const s = createDrillState({ repeats: 3 })
    const step = advanceDrill(s, { prevTime: 12, currentTime: 25, seeked: true, ...LOOP })
    expect(step.wrapped).toBe(true)
    expect(step.counted).toBe(false)
    expect(step.state.completedReps).toBe(0)
    // after the wrap the next full pass counts again
    expect(step.state.armed).toBe(true)
    expect(playOnePass(step.state).counted).toBe(true)
  })

  it('ignores a seek to before the loop, then counts once playback enters the loop', () => {
    let s = createDrillState({ repeats: 3 })
    let step = advanceDrill(s, { prevTime: 15, currentTime: 4, seeked: true, ...LOOP })
    s = step.state
    expect(s.armed).toBe(false)

    // jumping straight from outside the loop to its end never counts
    expect(advanceDrill(s, { prevTime: 5, currentTime: 20.01, ...LOOP }).counted).toBe(false)

    // playing naturally into the loop re-arms it
    step = advanceDrill(s, { prevTime: 9.98, currentTime: 10.01, ...LOOP })
    s = step.state
    expect(s.armed).toBe(true)
    step = advanceDrill(s, { prevTime: 19.98, currentTime: 20.01, ...LOOP })
    expect(step.counted).toBe(true)
    expect(step.state.completedReps).toBe(1)
  })

  it('a forward seek inside the loop skips the current rep', () => {
    let s = createDrillState({ repeats: 3 })
    s = advanceDrill(s, { prevTime: 11, currentTime: 18, seeked: true, ...LOOP }).state
    expect(s.armed).toBe(false)
    const end = advanceDrill(s, { prevTime: 19.98, currentTime: 20.01, ...LOOP })
    expect(end.wrapped).toBe(true)
    expect(end.counted).toBe(false)
    // the wrap re-arms, so the following full pass counts
    expect(playOnePass(end.state).counted).toBe(true)
  })

  it('a backward seek inside the loop keeps the rep', () => {
    let s = createDrillState({ repeats: 3 })
    s = advanceDrill(s, { prevTime: 16, currentTime: 12, seeked: true, ...LOOP }).state
    expect(s.armed).toBe(true)
    expect(advanceDrill(s, { prevTime: 19.98, currentTime: 20.01, ...LOOP }).counted).toBe(true)
  })

  it('a seek that lands exactly on the loop end does not count', () => {
    const s = createDrillState({ repeats: 3 })
    const step = advanceDrill(s, { prevTime: 19.9, currentTime: 20, seeked: true, ...LOOP })
    expect(step.wrapped).toBe(true)
    expect(step.counted).toBe(false)
  })
})

describe('advanceDrill — MIN_DRILL_SECONDS', () => {
  it('never counts reps on loops shorter than MIN_DRILL_SECONDS', () => {
    const shortLoop = { loopStart: 10, loopEnd: 10 + MIN_DRILL_SECONDS - 0.5 }
    const run = simulate(createDrillState({ repeats: 2 }), 2_000, 1 / 30, shortLoop)
    expect(run.counted).toBe(0)
    expect(run.state.completed).toBe(false)
  })

  it('counts on a loop of exactly MIN_DRILL_SECONDS', () => {
    const loop = { loopStart: 10, loopEnd: 10 + MIN_DRILL_SECONDS }
    const run = simulate(createDrillState({ repeats: 2 }), 2_000, 1 / 30, loop)
    expect(run.counted).toBe(2)
    expect(run.state.completed).toBe(true)
  })

  it('isValidDrillLoop checks length and finiteness', () => {
    expect(isValidDrillLoop(0, MIN_DRILL_SECONDS)).toBe(true)
    expect(isValidDrillLoop(0, MIN_DRILL_SECONDS - 0.1)).toBe(false)
    expect(isValidDrillLoop(5, 2)).toBe(false)
    expect(isValidDrillLoop(0, Number.NaN)).toBe(false)
  })
})

describe('resetDrill', () => {
  it('clears reps and completion but keeps the target', () => {
    let s = createDrillState({ repeats: 2 })
    s = playOnePass(playOnePass(s).state).state
    expect(s.completed).toBe(true)
    const again = resetDrill(s)
    expect(again).toEqual({ repeats: 2, completedReps: 0, completed: false, armed: true })
    expect(playOnePass(again).counted).toBe(true)
  })
})

describe('restartRep', () => {
  it('re-arms a pass that a forward seek had disarmed', () => {
    let s = createDrillState({ repeats: 3 })
    s = advanceDrill(s, { prevTime: 11, currentTime: 18, seeked: true, ...LOOP }).state
    expect(s.armed).toBe(false)
    const rearmed = restartRep(s)
    expect(rearmed.armed).toBe(true)
    expect(advanceDrill(rearmed, { prevTime: 19.98, currentTime: 20.01, ...LOOP }).counted).toBe(true)
  })

  it('returns the same object when nothing changes', () => {
    const armed = createDrillState({ repeats: 1 })
    expect(restartRep(armed)).toBe(armed)
    const done = playOnePass(armed).state
    expect(done.completed).toBe(true)
    expect(restartRep(done)).toBe(done)
  })
})

describe('loop helpers', () => {
  it('shouldWrapLoop', () => {
    expect(shouldWrapLoop(19.9, 10, 20)).toBe(false)
    expect(shouldWrapLoop(20, 10, 20)).toBe(true)
    expect(shouldWrapLoop(25, 10, 20)).toBe(true)
    expect(shouldWrapLoop(5, 10, 20)).toBe(false)
    // inverted loop never wraps (avoids a wrap on every frame)
    expect(shouldWrapLoop(30, 20, 10)).toBe(false)
  })

  it('effectiveLoopEnd clamps to a known duration', () => {
    expect(effectiveLoopEnd(30, 29.5)).toBe(29.5)
    expect(effectiveLoopEnd(20, 29.5)).toBe(20)
    expect(effectiveLoopEnd(20, Number.NaN)).toBe(20)
    expect(effectiveLoopEnd(20)).toBe(20)
    expect(effectiveLoopEnd(20, 0)).toBe(20)
  })

  it('repProgress is clamped to 0..1', () => {
    expect(repProgress(15, 10, 20)).toBe(0.5)
    expect(repProgress(5, 10, 20)).toBe(0)
    expect(repProgress(25, 10, 20)).toBe(1)
    expect(repProgress(15, 20, 20)).toBe(0)
    expect(repProgress(Number.NaN, 10, 20)).toBe(0)
  })
})

describe('resolveDrillRange', () => {
  it('keeps a valid plan range', () => {
    expect(resolveDrillRange({ startTime: 10, endTime: 20 }, 60)).toEqual({ start: 10, end: 20 })
  })

  it('stretches ranges shorter than MIN_DRILL_SECONDS', () => {
    expect(resolveDrillRange({ startTime: 10, endTime: 11 }, 60)).toEqual({
      start: 10,
      end: 10 + MIN_DRILL_SECONDS,
    })
  })

  it('clamps to the video and keeps the minimum length by moving the start back', () => {
    expect(resolveDrillRange({ startTime: 28, endTime: 35 }, 30)).toEqual({
      start: 30 - MIN_DRILL_SECONDS,
      end: 30,
    })
    expect(resolveDrillRange({ startTime: 20, endTime: 30.4 }, 29.97)).toEqual({ start: 20, end: 29.97 })
  })

  it('handles negative / non-finite input and unknown duration', () => {
    expect(resolveDrillRange({ startTime: -5, endTime: 8 })).toEqual({ start: 0, end: 8 })
    expect(resolveDrillRange({ startTime: Number.NaN, endTime: Number.NaN }, Number.NaN)).toEqual({
      start: 0,
      end: MIN_DRILL_SECONDS,
    })
  })
})

describe('formatting', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9.9)).toBe('0:09')
    expect(formatClock(75.9)).toBe('1:15')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })

  it('formatDrillRange uses an en dash', () => {
    expect(formatDrillRange(10, 20)).toBe('0:10–0:20')
  })

  it('formatSpeed', () => {
    expect(formatSpeed(0.5)).toBe('0.5x')
    expect(formatSpeed(0.75)).toBe('0.75x')
    expect(formatSpeed(1)).toBe('1x')
  })
})
