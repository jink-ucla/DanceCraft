/**
 * normalized-motion — scoring core (design summary in ../normalized-motion.ts).
 *
 * Notation: reference frames i (time t_i), user frames j (time u_j), bones b with weights w_b.
 *
 *  1. Features (features.ts): unit bone directions d_b in isotropic pixels (reference geometry
 *     restored first) and motion vectors m_b = signed bone rotation over the preceding 0.3 s.
 *  2. Bone similarity  s_b(i, j) = ((1 + d_ib . d_jb) / 2) ^ kernelPower.
 *  3. Chance level  c_ib = max(rest_ib, min(chanceMax, typical_ib)):
 *       rest_ib    = s(reference bone, neutral standing direction)   — what standing still earns
 *       typical_ib = E_k s(reference bone at frame k, reference bone at frame i) — what holding a
 *                    random pose of the same dance earns
 *     Frame maximum (distinctiveness)  D_i = sum_b w_b (1 - c_ib)  over reference-visible bones.
 *  4. Pose gain  G(i, j) = max(0, sum_b w_b (s_b - c_ib))  over reference-visible bones the user
 *     shows (a hidden bone earns nothing but its share of D_i is still lost).
 *  5. Motion match (regularized Dice, weighted over bones visible in both motion vectors):
 *       M(i, j) = max(0, (2 m_u.m_r + eps^2 W) / (|m_u|^2 + |m_r|^2 + eps^2 W))
 *     (1 = same motion; 0 = still while the dancer moves, opposite or unrelated motion; when the
 *     dancer holds still, holding still also scores 1).
 *     Pair credit  P(i, j) = G(i, j) * (motionFloor + (1 - motionFloor) * M(i, j)).
 *  6. Alignment: for a global offset D and orientation (as-is / mirror-style), reference frame i may
 *     use user frames with |u_j - (t_i + D)| <= localWindow, weighted by a local timing kernel
 *     k(delta) (1 within +/-localFlat, linear down to localEdge at +/-localWindow). A monotonic DP
 *     (user index non-decreasing along the reference) maximizes sum_i P(i, j_i) k(delta_i).
 *     D is searched on a grid over [offsetMin, offsetMax]; the (D, orientation) maximizing
 *     (sum / sum_i D_i) * g(D) wins.
 *  7. Score: per creditWindow-second window w: r_w = sum_{i in w} P k / sum_{i in w} D_i,
 *     credit f(r) = 1 - (1 - r)^creditPower (partial credit: half a move earns ~3/4 of its points;
 *     untracked windows stay 0).  raw = sum_w D_w f(r_w) / sum_w D_w.
 *     overall = raw * bodyCoverage^bodyCoveragePower * g(D),
 *     g(D) = exp(-e / timingTau), e = seconds of D outside [minLatency, maxLatency].
 */
import type { TimestampedPose } from '../../../../src/scoring/dtw'
import type { BodyPart, FeatureSet, Geometry } from './features'
import { BONES, BONE_WEIGHTS, NB, extractFeatures, lowerBound, upperBound } from './features'

export type Rank = 'S' | 'A' | 'B' | 'C'

export interface Params {
  /** Minimum keypoint confidence for a bone endpoint */
  minConfidence: number
  /** Bone similarity s = ((1 + cos dtheta) / 2) ^ kernelPower */
  kernelPower: number
  /** Upper clamp on the "typical" chance term (keeps static / short references scorable) */
  chanceMax: number
  /** Motion window and tolerance for the earlier frame (s) */
  motionWindow: number
  motionTolerance: number
  /** Per-bone RMS rotation (rad) under which motion counts as "holding still" */
  motionEps: number
  /** Share of the pose gain kept when the user's motion does not match at all */
  motionFloor: number
  /** Window (s) for the concave partial-credit curve and for per-move feedback */
  creditWindow: number
  /** Partial credit f(r) = 1 - (1 - x)^creditPower, x = max(0, r - creditDeadZone) / (1 - creditDeadZone) */
  creditPower: number
  creditDeadZone: number
  /** 'uniform': every move window counts the same (time coverage on a fixed grid); 'distinct': by distinctiveness */
  windowWeighting: 'uniform' | 'distinct'
  /** Windows whose distinctiveness is below this share of the mean are rest (not scored) */
  restWindowShare: number
  /** overall *= bodyCoverage ^ bodyCoveragePower (share of the main limbs the user shows) */
  bodyCoveragePower: number
  /** Free global latency compensation interval (s) */
  minLatency: number
  maxLatency: number
  /** Global offset search range and step (s) */
  offsetMin: number
  offsetMax: number
  offsetStep: number
  /** Local timing kernel: 1 within +/-localFlat, linear down to localEdge at +/-localWindow, 0 beyond */
  localFlat: number
  localWindow: number
  localEdge: number
  /** Timing penalty g = exp(-e / timingTau), e = seconds outside the free latency interval */
  timingTau: number
  /** Rank thresholds on overallScore x 100 */
  rankS: number
  rankA: number
  rankB: number
  /** Tuning only: attach per-frame diagnostics to the result */
  debug?: boolean
}

export const DEFAULT_PARAMS: Params = {
  minConfidence: 0.5,
  kernelPower: 1,
  chanceMax: 0.9,
  motionWindow: 0.3,
  motionTolerance: 0.1,
  motionEps: 0.1,
  motionFloor: 0.25,
  creditWindow: 1,
  creditPower: 2.25,
  creditDeadZone: 0,
  windowWeighting: 'uniform',
  restWindowShare: 0.25,
  bodyCoveragePower: 0.5,
  minLatency: 0,
  maxLatency: 0.3,
  offsetMin: -1,
  offsetMax: 3,
  offsetStep: 0.05,
  localFlat: 0.1,
  localWindow: 0.25,
  localEdge: 0.5,
  timingTau: 1.6,
  rankS: 90,
  rankA: 70,
  rankB: 40,
}

export interface SectionScore {
  startTime: number
  endTime: number
  score: number
}

export interface BodyPartResult {
  name: string
  score: number
  /** False when the user showed this part in < 30% of the matched frames */
  tracked: boolean
}

export interface MoveScore {
  /** Window start (reference / video time, s) */
  time: number
  score: number
  rating: 'PERFECT' | 'GOOD' | 'OK' | 'MISS' | 'TRACKING LOST'
  /** Median user offset vs the reference inside the window (ms, includes the global offset) */
  offsetMs: number | null
}

export interface DebugFrame {
  r: number
  motion: number
  matched: boolean
  denom: number
}

// A type alias (not an interface) so it is assignable to index-signature result types
export type NormalizedMotionResult = {
  overallScore: number
  sectionScores: SectionScore[]
  bodyPartScores: BodyPartResult[]
  rank: Rank
  alignment: [number, number][]
  scoringVersion: 3
  /** Share of the dance (reference frames) with a tracked user frame inside the timing band */
  coverage: number
  /** Timing quality 0-1: global timing penalty x mean local timing kernel along the path */
  timingAccuracy: number
  /** Global latency compensation applied (ms, within [minLatency, maxLatency]) */
  latencyMs: number
  /** Global offset found (ms); the part outside the free latency interval was penalized */
  offsetMs: number
  /** Mean motion match (0-1) where the reference moves */
  motionMatch: number
  /** Share of the main limbs (torso, upper arms, forearms, thighs, shins) the user showed */
  bodyCoverage: number
  /** True when the user danced mirror-style (scored after flipping) */
  mirrored: boolean
  /** Score before the timing and body-coverage factors (0-1) */
  rawScore: number
  /** Timing penalty factor g (0-1) */
  timingFactor: number
  /** Weighted mean chance level of the reference (0-1) */
  chanceLevel: number
  moveScores: MoveScore[]
  notes: string[]
  debugFrames?: DebugFrame[]
}

interface ScoreOpts {
  referenceGeometry?: Geometry
}

export function computeRankWith(score: number, p: Params): Rank {
  const pct = score * 100
  if (pct >= p.rankS) return 'S'
  if (pct >= p.rankA) return 'A'
  if (pct >= p.rankB) return 'B'
  return 'C'
}

/** cos(dtheta) -> ((1 + cos) / 2) ^ power, via a lookup table. */
function makeKernel(power: number): (cos: number) => number {
  const N = 16384
  const lut = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) lut[i] = Math.pow(i / N, power)
  return (cos: number) => {
    const u = ((cos + 1) / 2) * N
    if (u <= 0) return lut[0]
    if (u >= N) return lut[N]
    const i = u | 0
    return lut[i] + (lut[i + 1] - lut[i]) * (u - i)
  }
}

const PART_INDEX: Record<BodyPart, number> = { torso: 0, arms: 1, legs: 2 }
const BONE_PART = Int32Array.from(BONES.map((b) => PART_INDEX[b.part]))
const MAIN_BONE = Uint8Array.from(BONES.map((b) => (b.main || b.name === 'torso' ? 1 : 0)))

/** Chance level per reference frame and bone: max(rest, min(chanceMax, typical)). */
function chanceLevels(ref: FeatureSet, kernel: (c: number) => number, p: Params): Float64Array {
  const BINS = 72
  const out = new Float64Array(ref.n * NB)
  const binCos = new Float64Array(BINS)
  for (let k = 0; k < BINS; k++) binCos[k] = Math.cos((2 * Math.PI * k) / BINS)
  const binOf = (at: number): [number, number] => {
    const u = ((Math.atan2(ref.dy[at], ref.dx[at]) / (2 * Math.PI)) * BINS + BINS) % BINS
    const k0 = Math.floor(u) % BINS
    return [k0, u - Math.floor(u)]
  }
  for (let b = 0; b < NB; b++) {
    const hist = new Float64Array(BINS)
    let total = 0
    for (let i = 0; i < ref.n; i++) {
      const at = i * NB + b
      if (!ref.vis[at]) continue
      const [k0, f] = binOf(at)
      hist[k0] += 1 - f
      hist[(k0 + 1) % BINS] += f
      total++
    }
    const typical = new Float64Array(BINS)
    if (total > 0) {
      for (let k = 0; k < BINS; k++) {
        let s = 0
        for (let q = 0; q < BINS; q++) if (hist[q] > 0) s += hist[q] * kernel(binCos[(k - q + BINS) % BINS])
        typical[k] = s / total
      }
    }
    const bone = BONES[b]
    for (let i = 0; i < ref.n; i++) {
      const at = i * NB + b
      if (!ref.vis[at]) continue
      const [k0, f] = binOf(at)
      const typ = typical[k0] * (1 - f) + typical[(k0 + 1) % BINS] * f
      const rest = kernel(ref.dx[at] * bone.nx + ref.dy[at] * bone.ny)
      out[at] = Math.max(rest, Math.min(p.chanceMax, typ))
    }
  }
  return out
}

/** Pose gain G(i, j); optionally the per-part (torso, arms, legs) gains, each clipped at 0. */
function poseGain(
  ref: FeatureSet, usr: FeatureSet, i: number, j: number, chance: Float64Array, kernel: (c: number) => number,
  parts?: Float64Array,
): number {
  const ri = i * NB
  const uj = j * NB
  let gain = 0
  if (parts) parts.fill(0)
  for (let b = 0; b < NB; b++) {
    if (!ref.vis[ri + b] || !usr.vis[uj + b]) continue
    const cos = ref.dx[ri + b] * usr.dx[uj + b] + ref.dy[ri + b] * usr.dy[uj + b]
    const g = BONE_WEIGHTS[b] * (kernel(cos) - chance[ri + b])
    gain += g
    if (parts) parts[BONE_PART[b]] += g
  }
  if (parts) for (let k = 0; k < 3; k++) parts[k] = Math.max(0, parts[k])
  return Math.max(0, gain)
}

/** Motion match M(i, j) (regularized Dice over bones visible in both motion vectors). */
function motionSimilarity(ref: FeatureSet, usr: FeatureSet, i: number, j: number, eps2: number): number {
  if (!ref.hasMot[i]) return 1
  const ri = i * NB
  const uj = j * NB
  let rr = 0
  let uu = 0
  let ur = 0
  let wsum = 0
  let refE = 0
  let refW = 0
  for (let b = 0; b < NB; b++) {
    if (!ref.motVis[ri + b]) continue
    const w = BONE_WEIGHTS[b]
    const mr = ref.mot[ri + b]
    refE += w * mr * mr
    refW += w
    if (!usr.hasMot[j] || !usr.motVis[uj + b]) continue
    const mu = usr.mot[uj + b]
    rr += w * mr * mr
    uu += w * mu * mu
    ur += w * mu * mr
    wsum += w
  }
  if (wsum === 0) return refW > 0 && refE > eps2 * refW ? 0 : 1
  const e2 = eps2 * wsum
  return Math.max(0, (2 * ur + e2) / (uu + rr + e2))
}

function refMoving(ref: FeatureSet, i: number, eps2: number): boolean {
  if (!ref.hasMot[i]) return false
  let e = 0
  let w = 0
  for (let b = 0; b < NB; b++) {
    if (!ref.motVis[i * NB + b]) continue
    e += BONE_WEIGHTS[b] * ref.mot[i * NB + b] ** 2
    w += BONE_WEIGHTS[b]
  }
  return w > 0 && e > eps2 * w
}

/** Pair credits for every (ref frame, user frame) inside the widest band (all offsets). */
interface PairTable {
  jlo: Int32Array
  jhi: Int32Array
  base: Int32Array
  score: Float32Array
}

function pairTable(ref: FeatureSet, usr: FeatureSet, chance: Float64Array, kernel: (c: number) => number, p: Params): PairTable {
  const n = ref.n
  const jlo = new Int32Array(n)
  const jhi = new Int32Array(n)
  const base = new Int32Array(n)
  let total = 0
  for (let i = 0; i < n; i++) {
    jlo[i] = lowerBound(usr.times, ref.times[i] + p.offsetMin - p.localWindow)
    jhi[i] = upperBound(usr.times, ref.times[i] + p.offsetMax + p.localWindow) - 1
    base[i] = total
    total += Math.max(0, jhi[i] - jlo[i] + 1)
  }
  const score = new Float32Array(total)
  const eps2 = p.motionEps * p.motionEps
  for (let i = 0; i < n; i++) {
    for (let j = jlo[i]; j <= jhi[i]; j++) {
      const gain = poseGain(ref, usr, i, j, chance, kernel)
      if (gain <= 0) continue
      score[base[i] + j - jlo[i]] = gain * (p.motionFloor + (1 - p.motionFloor) * motionSimilarity(ref, usr, i, j, eps2))
    }
  }
  return { jlo, jhi, base, score }
}

function localKernel(delta: number, p: Params): number {
  const a = Math.abs(delta)
  if (a <= p.localFlat) return 1
  if (a > p.localWindow) return 0
  return 1 - ((1 - p.localEdge) * (a - p.localFlat)) / (p.localWindow - p.localFlat)
}

export function timingPenalty(offset: number, p: Params): number {
  const e = offset < p.minLatency ? p.minLatency - offset : offset > p.maxLatency ? offset - p.maxLatency : 0
  return Math.exp(-e / p.timingTau)
}

function partialCredit(r: number, p: Params): number {
  const x = Math.max(0, Math.min(1, (r - p.creditDeadZone) / (1 - p.creditDeadZone)))
  return p.creditPower === 1 ? x : 1 - Math.pow(1 - x, p.creditPower)
}

/**
 * Monotonic banded DP for one global offset. P[j] = best total over the reference frames so far
 * with the last used user index <= j. Returns the total and (optionally) the matched user index
 * per reference frame (-1 = none).
 */
function runDP(ref: FeatureSet, usr: FeatureSet, pt: PairTable, offset: number, p: Params, withPath: boolean): { total: number; match?: Int32Array } {
  const n = ref.n
  const m = usr.n
  const P = new Float64Array(m)
  let filled = -1
  let tail = 0
  let lo = 0
  let hi = -1
  const loArr = withPath ? new Int32Array(n) : undefined
  const hiArr = withPath ? new Int32Array(n) : undefined
  const rows: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const t = ref.times[i] + offset
    while (lo < m && usr.times[lo] < t - p.localWindow) lo++
    if (hi < lo - 1) hi = lo - 1
    while (hi + 1 < m && usr.times[hi + 1] <= t + p.localWindow) hi++
    if (loArr && hiArr) {
      loArr[i] = lo
      hiArr[i] = hi
    }
    if (hi < lo) {
      if (withPath) rows.push(new Uint8Array(0))
      continue
    }
    for (let j = filled + 1; j <= hi; j++) P[j] = tail
    if (hi > filled) filled = hi
    let left = lo > 0 ? P[lo - 1] : 0
    const row = withPath ? new Uint8Array(hi - lo + 1) : undefined
    const jlo = pt.jlo[i]
    const b0 = pt.base[i]
    for (let j = lo; j <= hi; j++) {
      const s = pt.score[b0 + j - jlo]
      const old = P[j]
      // row codes: 0 = from the left (j - 1), 1 = frame i matched to j, 2 = frame i unmatched
      if (s > 0 && old + s * localKernel(usr.times[j] - t, p) >= left) {
        P[j] = old + s * localKernel(usr.times[j] - t, p)
        if (row) row[j - lo] = 1
      } else if (old > left) {
        P[j] = old
        if (row) row[j - lo] = 2
      } else {
        P[j] = left
      }
      left = P[j]
    }
    tail = P[filled]
    if (row) rows.push(row)
  }
  const total = filled >= 0 ? P[filled] : 0
  if (!withPath || !loArr || !hiArr) return { total }
  const match = new Int32Array(n).fill(-1)
  let j = filled
  for (let i = n - 1; i >= 0 && j >= 0; i--) {
    const l = loArr[i]
    const h = hiArr[i]
    if (h < l || j < l) continue
    if (j > h) j = h
    const row = rows[i]
    while (j >= l && row[j - l] === 0) j--
    if (j >= l && row[j - l] === 1) match[i] = j
  }
  return { total, match }
}

function emptyResult(notes: string[], p: Params): NormalizedMotionResult {
  return {
    overallScore: 0,
    sectionScores: [],
    bodyPartScores: [
      { name: 'Arms', score: 0, tracked: false },
      { name: 'Legs', score: 0, tracked: false },
    ],
    rank: computeRankWith(0, p),
    alignment: [],
    scoringVersion: 3,
    coverage: 0,
    timingAccuracy: 0,
    latencyMs: 0,
    offsetMs: 0,
    motionMatch: 0,
    bodyCoverage: 0,
    mirrored: false,
    rawScore: 0,
    timingFactor: 1,
    chanceLevel: 0,
    moveScores: [],
    notes,
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function scoreWith(
  reference: TimestampedPose[], user: TimestampedPose[], sectionDuration = 10, options: ScoreOpts = {}, params: Partial<Params> = {},
): NormalizedMotionResult {
  const p: Params = { ...DEFAULT_PARAMS, ...params }
  const geo = options.referenceGeometry
  const okGeo = !!geo && geo.width > 0 && geo.height > 0
  const common = { minConfidence: p.minConfidence, motionWindow: p.motionWindow, motionTolerance: p.motionTolerance }
  const ref = extractFeatures(reference, { ...common, sx: okGeo ? geo.width : 1, sy: okGeo ? geo.height : 1 })
  if (ref.n === 0) return emptyResult([], p)
  const variants = [
    { mirrored: false, usr: extractFeatures(user, common) },
    { mirrored: true, usr: extractFeatures(user, { ...common, mirror: true }) },
  ]
  if (variants[0].usr.n === 0) {
    return emptyResult(['We could not see you during the dance — make sure you are in front of the camera.'], p)
  }

  const kernel = makeKernel(p.kernelPower)
  const chance = chanceLevels(ref, kernel, p)
  const denom = new Float64Array(ref.n)
  let denomTotal = 0
  let chanceSum = 0
  let chanceW = 0
  for (let i = 0; i < ref.n; i++) {
    for (let b = 0; b < NB; b++) {
      if (!ref.vis[i * NB + b]) continue
      denom[i] += BONE_WEIGHTS[b] * (1 - chance[i * NB + b])
      chanceSum += BONE_WEIGHTS[b] * chance[i * NB + b]
      chanceW += BONE_WEIGHTS[b]
    }
    denomTotal += denom[i]
  }
  if (!(denomTotal > 1e-9)) return emptyResult(['This reference has no movement to score.'], p)

  // One global offset and one orientation per session
  let best = { value: -1, offset: 0, variant: 0 }
  const tables: PairTable[] = []
  const steps = Math.round((p.offsetMax - p.offsetMin) / p.offsetStep)
  for (let v = 0; v < variants.length; v++) {
    const pt = pairTable(ref, variants[v].usr, chance, kernel, p)
    tables.push(pt)
    for (let k = 0; k <= steps; k++) {
      const offset = p.offsetMin + k * p.offsetStep
      const value = (runDP(ref, variants[v].usr, pt, offset, p, false).total / denomTotal) * timingPenalty(offset, p)
      if (value > best.value + 1e-9) best = { value, offset, variant: v }
    }
  }

  const chosen = variants[best.variant]
  const usr = chosen.usr
  const pt = tables[best.variant]
  const match = runDP(ref, usr, pt, best.offset, p, true).match!
  const tFactor = timingPenalty(best.offset, p)
  const eps2 = p.motionEps * p.motionEps

  // Per-frame values along the alignment path
  const lin = new Float64Array(ref.n)
  const delta = new Float64Array(ref.n).fill(NaN)
  const partLin = [new Float64Array(ref.n), new Float64Array(ref.n), new Float64Array(ref.n)]
  const partDen = [new Float64Array(ref.n), new Float64Array(ref.n), new Float64Array(ref.n)]
  const partsBuf = new Float64Array(3)
  const partSeen = [0, 0, 0]
  const debugFrames: DebugFrame[] = []
  let covered = 0
  let matched = 0
  let kernelSum = 0
  let kernelW = 0
  let motionSum = 0
  let motionW = 0
  let bodySum = 0
  let bodyW = 0
  let lo = 0
  for (let i = 0; i < ref.n; i++) {
    const t = ref.times[i] + best.offset
    while (lo < usr.n && usr.times[lo] < t - p.localWindow) lo++
    if (lo < usr.n && usr.times[lo] <= t + p.localWindow) covered++
    for (let b = 0; b < NB; b++) {
      if (ref.vis[i * NB + b]) partDen[BONE_PART[b]][i] += BONE_WEIGHTS[b] * (1 - chance[i * NB + b])
    }
    const j = match[i]
    if (j < 0) {
      if (p.debug) debugFrames.push({ r: 0, motion: 0, matched: false, denom: denom[i] })
      continue
    }
    matched++
    const d = usr.times[j] - t
    const k = localKernel(d, p)
    const g = poseGain(ref, usr, i, j, chance, kernel, partsBuf)
    const ms = motionSimilarity(ref, usr, i, j, eps2)
    const mf = p.motionFloor + (1 - p.motionFloor) * ms
    lin[i] = pt.score[pt.base[i] + j - pt.jlo[i]] * k
    delta[i] = d
    for (let q = 0; q < 3; q++) partLin[q][i] = partsBuf[q] * mf * k
    kernelSum += denom[i] * k
    kernelW += denom[i]
    if (refMoving(ref, i, eps2)) {
      motionSum += denom[i] * ms
      motionW += denom[i]
    }
    let refMain = 0
    let shown = 0
    const seen = [false, false, false]
    for (let b = 0; b < NB; b++) {
      if (usr.vis[j * NB + b] && BONES[b].main) seen[BONE_PART[b]] = true
      if (!MAIN_BONE[b] || !ref.vis[i * NB + b]) continue
      refMain += BONE_WEIGHTS[b]
      if (usr.vis[j * NB + b]) shown += BONE_WEIGHTS[b]
    }
    for (let q = 0; q < 3; q++) if (seen[q]) partSeen[q]++
    if (refMain > 0) {
      bodySum += denom[i] * (shown / refMain)
      bodyW += denom[i]
    }
    if (p.debug) debugFrames.push({ r: denom[i] > 0 ? g / denom[i] : 0, motion: ms, matched: true, denom: denom[i] })
  }

  // Windowed partial credit
  const duration = ref.times[ref.n - 1]
  const nWin = Math.max(1, Math.floor(duration / p.creditWindow) + 1)
  const winNum = new Float64Array(nWin)
  const winDen = new Float64Array(nWin)
  const winPartNum = [new Float64Array(nWin), new Float64Array(nWin), new Float64Array(nWin)]
  const winPartDen = [new Float64Array(nWin), new Float64Array(nWin), new Float64Array(nWin)]
  const winMatched = new Int32Array(nWin)
  const winDeltas: number[][] = Array.from({ length: nWin }, () => [])
  for (let i = 0; i < ref.n; i++) {
    const w = Math.min(nWin - 1, Math.max(0, Math.floor(ref.times[i] / p.creditWindow)))
    winNum[w] += lin[i]
    winDen[w] += denom[i]
    for (let q = 0; q < 3; q++) {
      winPartNum[q][w] += partLin[q][i]
      winPartDen[q][w] += partDen[q][i]
    }
    if (match[i] >= 0) {
      winMatched[w]++
      winDeltas[w].push(delta[i])
    }
  }
  // Window weights: 'uniform' = each move window counts the same; rest windows are not scored
  const meanWinDen = denomTotal / nWin
  const winWeight = new Float64Array(nWin)
  const winCredit = new Float64Array(nWin)
  let rawNum = 0
  let rawDen = 0
  for (let w = 0; w < nWin; w++) {
    if (winDen[w] <= 0 || winDen[w] < p.restWindowShare * meanWinDen) continue
    winWeight[w] = p.windowWeighting === 'uniform' ? 1 : winDen[w]
    winCredit[w] = partialCredit(winNum[w] / winDen[w], p)
    rawNum += winWeight[w] * winCredit[w]
    rawDen += winWeight[w]
  }
  const raw = rawDen > 0 ? rawNum / rawDen : 0
  const bodyCoverage = bodyW > 0 ? bodySum / bodyW : matched > 0 ? 1 : 0
  const bodyFactor = Math.pow(bodyCoverage, p.bodyCoveragePower)
  const overallScore = Math.max(0, Math.min(1, raw * bodyFactor * tFactor))
  const coverage = covered / ref.n
  const motionMatch = motionW > 0 ? motionSum / motionW : 1
  const timingAccuracy = tFactor * (kernelW > 0 ? kernelSum / kernelW : 0)
  const latency = Math.max(p.minLatency, Math.min(p.maxLatency, best.offset))

  // Sections (window credits grouped by section)
  const sectionScores: SectionScore[] = []
  const nSections = Math.max(1, Math.ceil(duration / sectionDuration - 1e-9))
  for (let s = 0; s < nSections; s++) {
    const startTime = s * sectionDuration
    const endTime = Math.min((s + 1) * sectionDuration, duration)
    let num = 0
    let den = 0
    for (let w = 0; w < nWin; w++) {
      const mid = (w + 0.5) * p.creditWindow
      const inside = mid >= startTime && (mid < endTime || s === nSections - 1)
      if (!inside) continue
      num += winWeight[w] * winCredit[w]
      den += winWeight[w]
    }
    sectionScores.push({ startTime, endTime, score: den > 0 ? Math.min(1, (num / den) * bodyFactor * tFactor) : 0 })
  }

  // Body parts: same windowed credit per part. Arms / Legs always present (Legs flagged untracked)
  const partScore = (q: number) => {
    let num = 0
    let den = 0
    for (let w = 0; w < nWin; w++) {
      if (winPartDen[q][w] <= 0 || winWeight[w] <= 0) continue
      const weight = p.windowWeighting === 'uniform' ? 1 : winPartDen[q][w]
      num += weight * partialCredit(winPartNum[q][w] / winPartDen[q][w], p)
      den += weight
    }
    return den > 0 ? Math.min(1, (num / den) * tFactor) : 0
  }
  const bodyPartScores: BodyPartResult[] = [
    { name: 'Arms', score: partScore(PART_INDEX.arms), tracked: matched > 0 && partSeen[PART_INDEX.arms] / matched >= 0.3 },
    { name: 'Legs', score: partScore(PART_INDEX.legs), tracked: matched > 0 && partSeen[PART_INDEX.legs] / matched >= 0.3 },
  ]

  // Per-move feedback (credit windows; windows where the dancer is not distinctive are skipped)
  const moveScores: MoveScore[] = []
  for (let w = 0; w < nWin; w++) {
    if (winWeight[w] <= 0) continue
    const score = Math.min(1, winCredit[w] * tFactor)
    const ds = winDeltas[w].sort((a, b) => a - b)
    const off = ds.length ? ds[ds.length >> 1] + best.offset : null
    const rating: MoveScore['rating'] = winMatched[w] === 0 ? 'TRACKING LOST'
      : score >= 0.85 ? 'PERFECT' : score >= 0.6 ? 'GOOD' : score >= 0.3 ? 'OK' : 'MISS'
    moveScores.push({ time: Math.round(w * p.creditWindow * 1000) / 1000, score, rating, offsetMs: off === null ? null : Math.round(off * 1000) })
  }

  const alignment: [number, number][] = []
  for (let i = 0; i < ref.n; i++) if (match[i] >= 0) alignment.push([ref.src[i], usr.src[match[i]]])

  // Plain-language notes on the biggest penalties
  const notes: string[] = []
  const meaningful = raw >= 0.15
  if (coverage < 0.85) notes.push(`We could only see you for ${pct(coverage)} of the dance — time you are not tracked scores 0.`)
  const legsSeen = matched > 0 ? partSeen[PART_INDEX.legs] / matched : 0
  if (matched > 0 && legsSeen < 0.7) {
    const legShare = partDen[PART_INDEX.legs].reduce((a, b) => a + b, 0) / denomTotal
    notes.push(`Your legs were not visible for ${pct(1 - legsSeen)} of the time we tracked you — leg moves (${pct(legShare)} of this dance) counted as missed and your score was scaled by ${bodyFactor.toFixed(2)}. Step back so your whole body is in frame.`)
  }
  if (meaningful && best.offset - p.maxLatency > 0.1) {
    notes.push(`You were about ${best.offset.toFixed(1)} s behind the music (up to ${p.maxLatency.toFixed(1)} s of delay is compensated automatically) — that cost ${pct(1 - tFactor)} of your score.`)
  } else if (meaningful && p.minLatency - best.offset > 0.1) {
    notes.push(`You were about ${(-best.offset).toFixed(1)} s ahead of the music — that cost ${pct(1 - tFactor)} of your score.`)
  }
  if (coverage > 0.2 && motionW > 0 && motionMatch < 0.4) {
    notes.push(`You were not moving like the dancer for most of the song (motion match ${pct(motionMatch)}) — standing still or holding a pose earns almost nothing.`)
  }
  if (meaningful && chosen.mirrored) notes.push('You danced mirror-style (your left side followed the dancer\'s right), so we scored you as a mirror image.')
  if (coverage >= 0.85 && overallScore < 0.3 && motionMatch >= 0.4) notes.push('Your poses rarely matched the dancer\'s — follow the arm positions more closely.')

  return {
    overallScore,
    sectionScores,
    bodyPartScores,
    rank: computeRankWith(overallScore, p),
    alignment,
    scoringVersion: 3,
    coverage,
    timingAccuracy,
    latencyMs: Math.round(latency * 1000),
    offsetMs: Math.round(best.offset * 1000),
    motionMatch,
    bodyCoverage,
    mirrored: chosen.mirrored,
    rawScore: raw,
    timingFactor: tFactor,
    chanceLevel: chanceW > 0 ? chanceSum / chanceW : 0,
    moveScores,
    notes,
    ...(p.debug ? { debugFrames } : {}),
  }
}
