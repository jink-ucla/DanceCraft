/**
 * keymoment-hits — similarity, motion and timing of one moment.
 *
 * Pose credit (per body part p, then weighted by the part's reference-visible weight):
 *   bone similarity  s_b = exp(-(1 - cos theta_b) / kappa)            (theta = direction error)
 *   raw_p            = sum_b w_b s_b / sum_b w_b    over bones the REFERENCE shows; bones the user
 *                      does not show count 0 (missing body parts earn nothing)
 *   credit_p         = ramp(raw_p; chance_p, 1), chance_p = mean raw_p between reference frames
 *                      >= 2 s apart (what an unrelated pose of the same dance gets), clamped to
 *                      [chanceMin, chanceMax]; a pose that does not match the move earns nothing
 * Motion agreement over the moment's segment, split in two halves (bones visible on both sides):
 *   M = sum 2 dr.du / (sum |dr|^2 + |du|^2 + eps)   dr/du = change of the unit directions
 *   (1 = same change, 0 = no or orthogonal change, < 0 = opposite -> 0)
 *   motionFactor = motionFloor + (1 - motionFloor) * ramp(M; motionZero, motionFull)
 * Timing: offset o = userTime - refTime; free band [L_c - freeTol, L_c + freeTol] around the
 *   global compensation L_c in [0, maxLatency]; beyond it the credit falls linearly,
 *   timingFactor = max(0, 1 - distance / timingZero).
 * Moment credit = poseCredit * motionFactor * timingFactor.
 */
import type { SeqFeatures } from './features'
import { BONE_PART, BONE_WEIGHT, NB, NP, lowerBound, nearestIndex } from './features'
import { PARAMS } from './params'

/** Reference frames at least this far apart are treated as unrelated poses for the chance level. */
const CHANCE_GAP_S = 2
/** Regularizer of the motion agreement (weighted squared unit-vector change). */
const MOTION_EPS = 0.05
/** Nearest-frame tolerance for the start / middle of a user motion segment (s). */
const NEAR_TOL = 0.08

export function ramp(x: number, lo: number, hi: number): number {
  if (x <= lo) return 0
  if (x >= hi) return 1
  return (x - lo) / (hi - lo)
}

export function clampLatency(lag: number): number {
  return Math.min(PARAMS.maxLatency, Math.max(0, lag))
}

export function timingFactor(offset: number, latency: number): number {
  const lo = latency - PARAMS.freeTol
  const hi = latency + PARAMS.freeTol
  const e = offset < lo ? lo - offset : offset > hi ? offset - hi : 0
  return e > 0 ? Math.max(0, 1 - e / PARAMS.timingZero) : 1
}

const sumScratch = new Float64Array(NP)
const userWScratch = new Float64Array(NP)

/**
 * Raw per-part similarity (0-1) of ref frame i and user frame j into `out`, reference-visible
 * part weights into `refW`, user-visible ones into `userW`. Returns false when the reference
 * frame shows nothing.
 */
export function rawParts(ref: SeqFeatures, i: number, usr: SeqFeatures, j: number, out: Float64Array, refW: Float64Array, userW: Float64Array): boolean {
  const kappa = PARAMS.kappa
  sumScratch.fill(0)
  refW.fill(0)
  userW.fill(0)
  let any = false
  const ri = i * NB
  const uj = j * NB
  for (let b = 0; b < NB; b++) {
    if (!ref.vis[ri + b]) continue
    const p = BONE_PART[b]
    const w = BONE_WEIGHT[b]
    refW[p] += w
    any = true
    if (!usr.vis[uj + b]) continue
    userW[p] += w
    const dot = ref.ux[ri + b] * usr.ux[uj + b] + ref.uy[ri + b] * usr.uy[uj + b]
    sumScratch[p] += w * Math.exp(-(1 - dot) / kappa)
  }
  for (let p = 0; p < NP; p++) out[p] = refW[p] > 0 ? sumScratch[p] / refW[p] : 0
  return any
}

/** Per-part chance levels of a reference, clamped to [chanceMin, chanceMax]. */
export function chanceLevels(ref: SeqFeatures): Float64Array {
  const sums = new Float64Array(NP)
  const counts = new Float64Array(NP)
  const raw = new Float64Array(NP)
  const refW = new Float64Array(NP)
  const userW = new Float64Array(NP)
  const stride = Math.max(1, Math.round(ref.n / 200))
  for (let i = 0; i < ref.n; i += stride) {
    for (let j = (i * 7) % stride; j < ref.n; j += stride) {
      if (Math.abs(ref.times[i] - ref.times[j]) < CHANCE_GAP_S) continue
      if (!rawParts(ref, i, ref, j, raw, refW, userW)) continue
      for (let p = 0; p < NP; p++) {
        if (refW[p] <= 0 || userW[p] < refW[p]) continue
        sums[p] += raw[p]
        counts[p]++
      }
    }
  }
  const chance = new Float64Array(NP)
  for (let p = 0; p < NP; p++) {
    const c = counts[p] > 0 ? sums[p] / counts[p] : PARAMS.chanceMax
    chance[p] = Math.min(PARAMS.chanceMax, Math.max(PARAMS.chanceMin, c))
  }
  return chance
}

const rawScratch = new Float64Array(NP)
const refWPose = new Float64Array(NP)

/**
 * Pose credit (0-1) of user frame j for reference frame i. Optional outputs: ramped per-part
 * credit, reference-visible and user-visible part weights.
 */
export function poseCredit(
  ref: SeqFeatures, i: number, usr: SeqFeatures, j: number, chance: Float64Array,
  parts?: Float64Array, partWeights?: Float64Array, partUserW?: Float64Array,
): number {
  if (!rawParts(ref, i, usr, j, rawScratch, refWPose, partUserW ?? userWScratch)) return 0
  let total = 0
  let tw = 0
  for (let p = 0; p < NP; p++) {
    const w = refWPose[p]
    const c = w > 0 ? ramp(rawScratch[p], chance[p], 1) : 0
    if (parts) parts[p] = c
    if (partWeights) partWeights[p] = w
    total += w * c
    tw += w
  }
  return tw > 0 ? total / tw : 0
}

/** Reference frame index nearest to time t (frames sorted). */
export function refIndexAt(ref: SeqFeatures, t: number): number {
  const i = lowerBound(ref.times, t)
  if (i <= 0) return 0
  if (i >= ref.n) return ref.n - 1
  return t - ref.times[i - 1] <= ref.times[i] - t ? i - 1 : i
}

/** Reference motion magnitude over [t - seg, t] (two halves, all reference-visible bones). */
export function referenceMotion(ref: SeqFeatures, i1: number, seg: number): number {
  const t = ref.times[i1]
  const i0 = refIndexAt(ref, t - seg)
  const im = refIndexAt(ref, t - seg / 2)
  let mag = 0
  for (const [a0, a1] of [[i0, im], [im, i1]]) {
    for (let b = 0; b < NB; b++) {
      const k0 = a0 * NB + b
      const k1 = a1 * NB + b
      if (!ref.vis[k0] || !ref.vis[k1]) continue
      const dx = ref.ux[k1] - ref.ux[k0]
      const dy = ref.uy[k1] - ref.uy[k0]
      mag += BONE_WEIGHT[b] * (dx * dx + dy * dy)
    }
  }
  return mag
}

/** Motion agreement between reference [t_i - seg, t_i] and user [u_j - seg, u_j]. */
export function motionAgreement(ref: SeqFeatures, i1: number, usr: SeqFeatures, j1: number, seg: number): number {
  const t = ref.times[i1]
  const u = usr.times[j1]
  const i0 = refIndexAt(ref, t - seg)
  const im = refIndexAt(ref, t - seg / 2)
  const j0 = nearestIndex(usr.times, u - seg, NEAR_TOL)
  const jm = nearestIndex(usr.times, u - seg / 2, NEAR_TOL)
  let num = 0
  let den = MOTION_EPS
  const halves: [number, number, number, number][] = [[i0, im, j0, jm], [im, i1, jm, j1]]
  for (const [a0, a1, b0, b1] of halves) {
    if (b0 < 0 || b1 < 0) continue
    for (let b = 0; b < NB; b++) {
      const k0 = a0 * NB + b
      const k1 = a1 * NB + b
      const l0 = b0 * NB + b
      const l1 = b1 * NB + b
      if (!ref.vis[k0] || !ref.vis[k1] || !usr.vis[l0] || !usr.vis[l1]) continue
      const w = BONE_WEIGHT[b]
      const rx = ref.ux[k1] - ref.ux[k0]
      const ry = ref.uy[k1] - ref.uy[k0]
      const ux = usr.ux[l1] - usr.ux[l0]
      const uy = usr.uy[l1] - usr.uy[l0]
      num += w * 2 * (rx * ux + ry * uy)
      den += w * (rx * rx + ry * ry + ux * ux + uy * uy)
    }
  }
  return Math.max(0, num / den)
}

export function motionFactor(agreement: number): number {
  const p = PARAMS
  return p.motionFloor + (1 - p.motionFloor) * ramp(agreement, p.motionZero, p.motionFull)
}
