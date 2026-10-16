/**
 * keymoment-hits — segment the reference into MOVES (key moments).
 *
 * A move ends at a "hit": the moment the dancer arrives at a pose after moving, i.e. a local
 * minimum of the reference's body-segment angular speed that follows enough movement. The move's
 * motion segment is the stretch since the previous hit (clamped to [minSegment, maxSegment]).
 * Genuine pauses produce no hits (nothing is scored while the dancer holds still, apart from the
 * pose they arrived in), so standing still through a pause is neither rewarded nor punished.
 */
import type { SeqFeatures } from './features'
import { BONE_WEIGHT, NB } from './features'
import { PARAMS } from './params'

/** Gaussian smoothing of the speed curve (seconds). */
const SPEED_SMOOTH_S = 0.06

export interface Move {
  /** Reference frame index of the hit */
  index: number
  /** Hit time (reference clock, s) */
  time: number
  /** Motion segment length (s) */
  segment: number
  /** Body-segment change over the move (weighted RMS of unit-vector differences) */
  displacement: number
}

/** Weighted RMS difference of segment directions between two frames (shared visible bones only). */
export function frameDistance(f: SeqFeatures, i: number, j: number): number {
  let num = 0
  let den = 0
  for (let b = 0; b < NB; b++) {
    if (!f.vis[i * NB + b] || !f.vis[j * NB + b]) continue
    const dx = f.ux[i * NB + b] - f.ux[j * NB + b]
    const dy = f.uy[i * NB + b] - f.uy[j * NB + b]
    num += BONE_WEIGHT[b] * (dx * dx + dy * dy)
    den += BONE_WEIGHT[b]
  }
  return den > 0 ? Math.sqrt(num / den) : 0
}

function gaussianSmooth(x: Float64Array, sigma: number): Float64Array {
  if (sigma <= 0) return x.slice()
  const r = Math.max(1, Math.ceil(3 * sigma))
  const w: number[] = []
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)))
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let s = 0
    let ws = 0
    for (let k = -r; k <= r; k++) {
      const j = i + k
      if (j < 0 || j >= x.length) continue
      s += w[k + r] * x[j]
      ws += w[k + r]
    }
    out[i] = s / ws
  }
  return out
}

/** Smoothed angular speed of the reference (per second). */
export function referenceSpeed(ref: SeqFeatures): Float64Array {
  const speed = new Float64Array(ref.n)
  for (let i = 1; i < ref.n; i++) {
    const dt = ref.times[i] - ref.times[i - 1]
    speed[i] = dt > 0 ? frameDistance(ref, i, i - 1) / dt : 0
  }
  if (ref.n > 1) speed[0] = speed[1]
  const dt = ref.n > 1 ? (ref.times[ref.n - 1] - ref.times[0]) / (ref.n - 1) : 1 / 30
  return gaussianSmooth(speed, SPEED_SMOOTH_S / Math.max(dt, 1e-3))
}

/** Detect the moves of a reference sequence. */
export function detectMoves(ref: SeqFeatures): Move[] {
  if (ref.n < 3) return []
  const speed = referenceSpeed(ref)
  const end = ref.times[ref.n - 1] - PARAMS.endMargin
  const moves: Move[] = []
  let prev = 0
  let peak = 0
  for (let i = 1; i < ref.n - 1; i++) {
    peak = Math.max(peak, speed[i])
    const isMin = speed[i] <= speed[i - 1] && speed[i] < speed[i + 1]
    if (!isMin || ref.times[i] > end) continue
    if (ref.times[i] - ref.times[prev] < PARAMS.minHitGap) continue
    if (speed[i] > PARAMS.brakeRatio * peak) continue
    const displacement = frameDistance(ref, i, prev)
    if (displacement < PARAMS.minHitDisplacement) continue
    const segment = Math.min(PARAMS.maxSegment, Math.max(PARAMS.minSegment, ref.times[i] - ref.times[prev]))
    moves.push({ index: i, time: ref.times[i], segment, displacement })
    prev = i
    peak = speed[i]
  }
  return moves
}
