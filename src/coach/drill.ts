/**
 * DanceCraft AI Coach — pure drill logic for PracticeMode.
 *
 * A coach drill loops one section of the reference video (CoachPlan.startTime
 * to CoachPlan.endTime) at a reduced speed for CoachPlan.repeats reps. The
 * component feeds every animation-frame tick into advanceDrill(); this module
 * decides when the playhead must wrap back to the loop start, whether that
 * wrap earns a rep, and when the drill is complete. No DOM / React here so it
 * can be unit-tested in the node environment.
 */
import type { CoachPlan } from './types'
import { MAX_DRILL_REPEATS, MIN_DRILL_REPEATS, MIN_DRILL_SECONDS } from './types'

/**
 * Playback this close (seconds) to the loop end counts as reaching it. Covers
 * frame jitter and videos whose real duration is a hair shorter than loopEnd.
 */
export const LOOP_END_EPSILON = 0.05

/** Float tolerance when checking a loop against MIN_DRILL_SECONDS. */
const LENGTH_TOLERANCE = 1e-3

export interface DrillState {
  /** Reps needed to finish (MIN_DRILL_REPEATS..MAX_DRILL_REPEATS). */
  repeats: number
  completedReps: number
  /** True once completedReps reached repeats; no further counting. */
  completed: boolean
  /**
   * The current pass started at the loop start (drill start, wrap, or playing
   * into the loop) and was not skipped by a forward/outside seek, so reaching
   * the loop end earns a rep.
   */
  armed: boolean
}

export interface DrillTick {
  /** Reference-video time at the previous tick (after any wrap). */
  prevTime: number
  /** Reference-video time now. */
  currentTime: number
  loopStart: number
  /** Effective loop end (already clamped to the video duration). */
  loopEnd: number
  /** True when the user manually seeked since the previous tick. */
  seeked?: boolean
}

export interface DrillStep {
  state: DrillState
  /** Playhead reached the loop end: the caller must seek back to loopStart. */
  wrapped: boolean
  /** A rep was credited on this tick. */
  counted: boolean
  /** This tick credited the final rep (true exactly once per drill run). */
  completed: boolean
}

/** Clamp a plan's repeat count into MIN_DRILL_REPEATS..MAX_DRILL_REPEATS. */
export function clampRepeats(repeats: number): number {
  if (!Number.isFinite(repeats)) return MIN_DRILL_REPEATS
  return Math.min(MAX_DRILL_REPEATS, Math.max(MIN_DRILL_REPEATS, Math.round(repeats)))
}

export function createDrillState(plan: Pick<CoachPlan, 'repeats'>): DrillState {
  return {
    repeats: clampRepeats(plan.repeats),
    completedReps: 0,
    completed: false,
    armed: true,
  }
}

/** "Drill Again": same target, zero reps, playhead back at the loop start. */
export function resetDrill(state: DrillState): DrillState {
  return { ...state, completedReps: 0, completed: false, armed: true }
}

/**
 * The user put the loop start at the playhead (new A point): the pass that
 * follows is a full rep even if an earlier seek had disarmed it.
 */
export function restartRep(state: DrillState): DrillState {
  return state.completed || state.armed ? state : { ...state, armed: true }
}

/** A loop long enough to drill (and to count reps on). */
export function isValidDrillLoop(loopStart: number, loopEnd: number): boolean {
  return (
    Number.isFinite(loopStart) &&
    Number.isFinite(loopEnd) &&
    loopEnd - loopStart >= MIN_DRILL_SECONDS - LENGTH_TOLERANCE
  )
}

/** Loop end clamped to the video duration (when known). */
export function effectiveLoopEnd(loopEnd: number, duration?: number): number {
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
    return Math.min(loopEnd, duration)
  }
  return loopEnd
}

/** True when playback has reached the end of an A/B loop and must wrap. */
export function shouldWrapLoop(currentTime: number, loopStart: number, loopEnd: number): boolean {
  return loopEnd > loopStart && currentTime >= loopEnd - LOOP_END_EPSILON
}

/**
 * Advance the drill by one tick. Rules:
 * - Reaching the loop end always wraps (wrapped=true), but only earns a rep
 *   when the pass was armed, the previous tick was inside the loop and the
 *   user did not seek this tick (seeking past the end never counts).
 * - A manual seek forward or outside the loop disarms the current pass; a seek
 *   backwards inside the loop keeps it. Playing into the loop from before its
 *   start re-arms. Every wrap re-arms (the next pass starts at loopStart).
 * - Loops shorter than MIN_DRILL_SECONDS never count.
 * - Once completed, nothing is counted any more.
 */
export function advanceDrill(state: DrillState, tick: DrillTick): DrillStep {
  const { prevTime, currentTime, loopStart, loopEnd, seeked = false } = tick
  const wrapped = shouldWrapLoop(currentTime, loopStart, loopEnd)

  if (state.completed || !isValidDrillLoop(loopStart, loopEnd)) {
    return { state, wrapped, counted: false, completed: false }
  }

  const inLoop = (t: number) => t >= loopStart - LOOP_END_EPSILON && t < loopEnd
  let armed = state.armed
  if (seeked) {
    const backwardInLoop = inLoop(currentTime) && currentTime <= prevTime
    if (!backwardInLoop) armed = false
  } else if (prevTime < loopStart && currentTime >= loopStart) {
    armed = true
  }

  if (!wrapped) {
    const next = armed === state.armed ? state : { ...state, armed }
    return { state: next, wrapped: false, counted: false, completed: false }
  }

  const counted = armed && !seeked && inLoop(prevTime)
  const completedReps = counted ? state.completedReps + 1 : state.completedReps
  const completed = completedReps >= state.repeats
  return {
    state: { ...state, completedReps, completed, armed: !completed },
    wrapped: true,
    counted,
    completed: counted && completed,
  }
}

/** 1-based rep currently being danced, for "Rep 2 / 4". */
export function currentRepNumber(state: DrillState): number {
  return Math.min(state.completedReps + 1, state.repeats)
}

/** Progress (0-1) through the current pass of the loop. */
export function repProgress(currentTime: number, loopStart: number, loopEnd: number): number {
  const length = loopEnd - loopStart
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(currentTime)) return 0
  return Math.min(1, Math.max(0, (currentTime - loopStart) / length))
}

/**
 * The loop PracticeMode should use for a plan: inside [0, duration] and at
 * least MIN_DRILL_SECONDS long (when the video allows it).
 */
export function resolveDrillRange(
  plan: Pick<CoachPlan, 'startTime' | 'endTime'>,
  duration?: number,
): { start: number; end: number } {
  let start = Number.isFinite(plan.startTime) ? Math.max(0, plan.startTime) : 0
  let end = Number.isFinite(plan.endTime) ? plan.endTime : start + MIN_DRILL_SECONDS
  if (end - start < MIN_DRILL_SECONDS) end = start + MIN_DRILL_SECONDS

  if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
    end = Math.min(end, duration)
    if (end - start < MIN_DRILL_SECONDS) start = Math.max(0, end - MIN_DRILL_SECONDS)
  }
  return { start, end }
}

/** m:ss (floored), e.g. 75.9 -> "1:15". */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** "0:10–0:20" */
export function formatDrillRange(start: number, end: number): string {
  return `${formatClock(start)}–${formatClock(end)}`
}

/** 0.5 -> "0.5x" */
export function formatSpeed(speed: number): string {
  return `${speed}x`
}
