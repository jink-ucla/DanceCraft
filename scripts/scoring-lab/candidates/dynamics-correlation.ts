/**
 * Candidate post-dance scorer "dynamics-correlation" (scoring v3 proposal).
 *
 * Dynamics first: a dancer is judged mainly on whether their body MOVES like the reference at the
 * right time (velocity correlation of segment directions), and on whether the pose is right
 * (chance-normalized static similarity). Standing still, random motion, reversed or wrong
 * choreography all produce ~0 velocity correlation, so they score ~0 no matter how "average" the
 * held pose is.
 *
 * Pipeline (parameters in DEFAULT_PARAMS):
 *  1. Geometry: reference x * width, y * height (options.referenceGeometry); users are webcam pixels.
 *  2. Features (dynamics-correlation/features.ts): signed image-plane directions of 13 segments and
 *     mid-shoulder travel (torso lengths) on a 30 Hz grid, Gaussian-smoothed (sigma `smooth`),
 *     central-difference velocities, soft-compressed v / sqrt(1 + (v / v0)^2) so detector flips and
 *     spikes cannot dominate, down-weighted while a segment is foreshortened.
 *  3. Orientation + global timing: for the user as-is AND mirror-style (x flip + left/right swap),
 *     G(l) = 2 <r, u_l> / (|r|^2 + |u_l|^2) (velocity concordance over the whole dance, absent user
 *     time keeps its reference energy) for every lag l in [lagMin, lagMax]; the pair maximizing
 *     G(l) * T(l) wins. Timing factor T(l) = 1 inside the free compensation zone
 *     [freeLatMin, freeLatMax] (one global latency, <= 0.3 s), else 2^(-excess / timingHalfLife).
 *  4. Per 0.5 s segment: a local offset delta in [-localTol, +localTol] around the global lag is
 *     chosen on a 2.5 s window (timing-jitter tolerance), then on a 1.5 s window:
 *       K  = velocity concordance = cosine x amplitude match of the weighted velocity vectors
 *       K' = clamp((K - kDead) / (1 - kDead), 0, 1)
 *       P  = sum_d w_d (s_d - c_d) / sum_d w_d (1 - c_d) clamped to [0, 1];
 *            s_d = exp(-dTheta^2 / (2 poseSigma^2)), c_d = the reference's own chance similarity for
 *            channel d (reference vs itself >= 2 s apart) -> a "typical" pose earns ~0
 *       lambda = E / (E + restSpeed^2), E = mean squared reference velocity (moving vs resting)
 *       V  = 1 - sum_part W_part * hiddenShare_part (arms 0.5, legs 0.35: explicit penalty for body
 *            parts the camera does not see while the reference shows them; their channels are
 *            excluded from K and P so they are not counted twice)
 *       S  = coverage * V * (lambda * (K' P)^(gamma / 2) + (1 - lambda) * P^gamma)
 *  5. overallScore = T(l*) * mean over reference time of S (absent / untracked time counts 0).
 */
import type { TimestampedPose } from '../../../src/scoring/dtw'
import type { Stream, StreamOptions } from './dynamics-correlation/features'
import { CHANNELS, NC, buildStream, sequenceFeatures, wrap } from './dynamics-correlation/features'

export const name = 'dynamics-correlation (velocity concordance + chance-normalized pose, clamped latency)'

/** Every loop iteration recorded; frames with no detection = { keypoints: [] } (explicit absence). */
export const recordPolicy = 'all'

type Rank = 'S' | 'A' | 'B' | 'C'

export interface Params {
  /** Grid step (s) */
  dt: number
  /** Keypoint confidence needed for a segment to count as visible */
  visConf: number
  /** Max time between two user frames that may be interpolated (s) */
  maxGap: number
  /** A single frame may stand for grid times this close (s) */
  hold: number
  /** Gaussian smoothing sigma (s) */
  smooth: number
  /** Central-difference half span (s) */
  diffHalf: number
  /** Foreshortening: velocity weight = min(1, length / (foreshorten * median length)) */
  foreshorten: number
  /** Velocity soft-compression knee for angle channels (rad/s) */
  compressAngle: number
  /** Velocity soft-compression knee for body travel (torso lengths/s) */
  compressPos: number
  /** Free global latency compensation zone (s) */
  freeLatMin: number
  freeLatMax: number
  /** Global lag search range (s) */
  lagMin: number
  lagMax: number
  /** Timing factor halves for every timingHalfLife seconds beyond the free zone */
  timingHalfLife: number
  /** Local offset tolerance around the global lag (s) */
  localTol: number
  segment: number
  evalWin: number
  selectWin: number
  poseSigma: number
  chanceMinShift: number
  chanceMax: number
  kDead: number
  /** Score curve exponent applied per segment (gamma < 1 = more generous in the mid range) */
  gamma: number
  /** Reference speed (rad/s, weighted RMS per channel) at which a window counts half "moving" */
  restSpeed: number
  /** Share of the score lost when a body part is hidden for the whole dance */
  hiddenPenalty: { arms: number; legs: number }
  /** Velocity weights per channel name */
  velWeights: Record<string, number>
  /** Static pose weights per channel name (angle channels only) */
  poseWeights: Record<string, number>
  rankS: number
  rankA: number
  rankB: number
}

export const DEFAULT_PARAMS: Params = {
  dt: 1 / 30,
  visConf: 0.3,
  maxGap: 0.25,
  hold: 0.07,
  smooth: 0.08,
  diffHalf: 0.067,
  foreshorten: 0.4,
  compressAngle: 3,
  compressPos: 1.5,
  freeLatMin: -0.1,
  freeLatMax: 0.3,
  lagMin: -1.0,
  lagMax: 3.5,
  timingHalfLife: 1.25,
  localTol: 0.2,
  segment: 0.5,
  evalWin: 1.5,
  selectWin: 2.5,
  poseSigma: 0.5,
  chanceMinShift: 2.0,
  chanceMax: 0.9,
  kDead: 0.1,
  gamma: 0.6,
  restSpeed: 0.3,
  hiddenPenalty: { arms: 0.5, legs: 0.35 },
  velWeights: {
    left_upper_arm: 1, right_upper_arm: 1, left_forearm: 1, right_forearm: 1, left_hand: 0, right_hand: 0,
    left_thigh: 0.8, right_thigh: 0.8, left_shin: 0.8, right_shin: 0.8,
    torso: 0.8, shoulder_line: 0.5, head: 0.3, body_x: 0.5, body_y: 0.5,
  },
  poseWeights: {
    left_upper_arm: 1, right_upper_arm: 1, left_forearm: 1, right_forearm: 1, left_hand: 0.3, right_hand: 0.3,
    left_thigh: 0.8, right_thigh: 0.8, left_shin: 0.8, right_shin: 0.8,
    torso: 0.8, shoulder_line: 0.5, head: 0.3,
  },
  rankS: 90,
  rankA: 70,
  rankB: 40,
}

export function computeRankV3(score: number, p: Params = DEFAULT_PARAMS): Rank {
  const pct = score * 100
  if (pct >= p.rankS) return 'S'
  if (pct >= p.rankA) return 'A'
  if (pct >= p.rankB) return 'B'
  return 'C'
}

export interface MoveScore {
  /** Reference (video) time of the move segment centre (s) */
  time: number
  score: number
  rating: string
  /** Where the user's matching motion was found relative to the reference (ms, + = late); null = not tracked */
  offsetMs: number | null
}

export interface DynamicsResult {
  overallScore: number
  sectionScores: { startTime: number; endTime: number; score: number }[]
  bodyPartScores: { name: string; score: number; tracked: boolean }[]
  rank: Rank
  alignment: [number, number][]
  scoringVersion: 3
  /** Share of the dance (0-1) where the user was tracked */
  coverage: number
  /** Timing factor actually applied (1 = within the free latency compensation) */
  timingAccuracy: number
  /** Global latency compensation applied (ms, clamped to the free zone) */
  latencyMs: number
  /** Estimated global offset of the user vs the reference (ms, + = late) */
  timingOffsetMs: number
  /** Mean absolute local timing deviation around the global offset (ms) */
  localTimingMs: number
  /** Motion (velocity) match where the reference moves (0-1) */
  motionMatch: number
  /** Chance-normalized pose match (0-1) */
  poseMatch: number
  /** Share of the tracked time each body part was visible (0-1) */
  visibility: { arms: number; legs: number }
  mirrored: boolean
  geometryRestored: boolean
  moveScores: MoveScore[]
  notes: string[]
}

interface Options {
  referenceGeometry?: { width: number; height: number }
  [key: string]: unknown
}

/** Body parts with an explicit visibility rule: 0 = arms, 1 = legs */
const PART_NAMES = ['Arms', 'Legs'] as const
const PART_OF: number[] = CHANNELS.map((ch) => (ch.part === 'arms' ? 0 : ch.part === 'legs' ? 1 : -1))

function timingFactor(lag: number, p: Params): number {
  const excess = lag > p.freeLatMax ? lag - p.freeLatMax : lag < p.freeLatMin ? p.freeLatMin - lag : 0
  return Math.pow(2, -excess / p.timingHalfLife)
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function emptyResult(notes: string[], geometryRestored: boolean): DynamicsResult {
  return {
    overallScore: 0,
    sectionScores: [],
    bodyPartScores: PART_NAMES.map((n) => ({ name: n, score: 0, tracked: false })),
    rank: 'C',
    alignment: [],
    scoringVersion: 3,
    coverage: 0,
    timingAccuracy: 0,
    latencyMs: 0,
    timingOffsetMs: 0,
    localTimingMs: 0,
    motionMatch: 0,
    poseMatch: 0,
    visibility: { arms: 0, legs: 0 },
    mirrored: false,
    geometryRestored,
    moveScores: [],
    notes,
  }
}

/** Reference chance level per angle channel: mean similarity of the reference with itself >= minShift apart. */
function chanceLevels(ref: Stream, p: Params): Float64Array {
  const c = new Float64Array(NC)
  const n = ref.n
  const dur = n * p.dt
  const minShift = Math.max(0.5, Math.min(p.chanceMinShift, dur / 3))
  const shifts: number[] = []
  for (let s = minShift; s <= dur - minShift + 1e-9; s += 0.5) shifts.push(Math.round(s / p.dt))
  if (shifts.length === 0) shifts.push(Math.max(1, Math.round(n / 2)))
  const inv = 1 / (2 * p.poseSigma * p.poseSigma)
  for (let d = 0; d < NC; d++) {
    if (CHANNELS[d].kind !== 'angle') continue
    let sum = 0
    let cnt = 0
    for (const sh of shifts) {
      for (let k = 0; k < n; k += 3) {
        const a = k * NC + d
        const b = ((k + sh) % n) * NC + d
        if (!ref.valid[a] || !ref.valid[b]) continue
        const e = wrap(ref.value[a] - ref.value[b])
        sum += Math.exp(-e * e * inv)
        cnt++
      }
    }
    c[d] = cnt > 0 ? Math.min(p.chanceMax, sum / cnt) : p.chanceMax
  }
  return c
}

/** Per sample and part (2 per sample): 1 when at least half of the part's weighted segments are visible. */
function partVisibility(s: Stream, wV: Float64Array, wP: Float64Array): Uint8Array {
  const out = new Uint8Array(s.n * 2)
  for (let k = 0; k < s.n; k++) {
    for (let part = 0; part < 2; part++) {
      let tot = 0
      let vis = 0
      for (let d = 0; d < NC; d++) {
        if (PART_OF[d] !== part || CHANNELS[d].kind !== 'angle' || (wV[d] <= 0 && wP[d] <= 0)) continue
        tot++
        if (s.valid[k * NC + d]) vis++
      }
      out[k * 2 + part] = tot > 0 && vis * 2 >= tot ? 1 : 0
    }
  }
  return out
}

interface Ctx {
  ref: Stream
  usr: Stream
  wV: Float64Array
  wP: Float64Array
  chance: Float64Array
  poseInv: number
  refPart: Uint8Array
  usrPart: Uint8Array
}

interface WindowStats {
  num: number
  er: number
  eu: number
  pNum: number
  pDen: number
  present: number
  /** Present samples where the reference shows the part / where the user hides it */
  partRef: [number, number]
  partHidden: [number, number]
}

/**
 * Sums over reference samples k in [k0, k1) against user samples j = k + off, restricted to channels
 * in `mask`. Only samples where the user is present contribute. Channels of a body part that the user
 * hides at that sample (while the reference shows it) are skipped and counted in partHidden instead.
 */
function windowStats(c: Ctx, off: number, k0: number, k1: number, mask: Uint8Array): WindowStats {
  const { ref, usr, wV, wP, chance, poseInv, refPart, usrPart } = c
  const st: WindowStats = { num: 0, er: 0, eu: 0, pNum: 0, pDen: 0, present: 0, partRef: [0, 0], partHidden: [0, 0] }
  for (let k = Math.max(0, k0); k < Math.min(ref.n, k1); k++) {
    const j = k + off
    if (j < 0 || j >= usr.n || !usr.present[j]) continue
    st.present++
    const skip0 = refPart[k * 2] === 1 && usrPart[j * 2] === 0
    const skip1 = refPart[k * 2 + 1] === 1 && usrPart[j * 2 + 1] === 0
    if (refPart[k * 2]) {
      st.partRef[0]++
      if (skip0) st.partHidden[0]++
    }
    if (refPart[k * 2 + 1]) {
      st.partRef[1]++
      if (skip1) st.partHidden[1]++
    }
    const rb = k * NC
    const ub = j * NC
    for (let d = 0; d < NC; d++) {
      if (!mask[d]) continue
      const part = PART_OF[d]
      if ((part === 0 && skip0) || (part === 1 && skip1)) continue
      const w = wV[d]
      if (w > 0 && ref.vvalid[rb + d]) {
        const r = ref.vel[rb + d]
        st.er += w * r * r
        if (usr.vvalid[ub + d]) {
          const u = usr.vel[ub + d]
          st.num += w * r * u
          st.eu += w * u * u
        }
      }
      const wp = wP[d]
      if (wp > 0 && ref.valid[rb + d]) {
        st.pDen += wp * (1 - chance[d])
        if (usr.valid[ub + d]) {
          const e = wrap(ref.value[rb + d] - usr.value[ub + d])
          st.pNum += wp * (Math.exp(-e * e * poseInv) - chance[d])
        }
      }
    }
  }
  return st
}

function concordance(s: WindowStats): number {
  const den = s.er + s.eu
  return den > 1e-12 ? (2 * s.num) / den : 0
}

function poseScore(s: WindowStats): number {
  return s.pDen > 0 ? clamp01(s.pNum / s.pDen) : 0
}

export function scoreWithParams(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
  options?: Options,
  p: Params = DEFAULT_PARAMS,
): DynamicsResult {
  const geo = options?.referenceGeometry
  const geometryRestored = !!(geo && geo.width > 0 && geo.height > 0)
  const sx = geometryRestored ? geo!.width : 1
  const sy = geometryRestored ? geo!.height : 1
  const dt = p.dt
  const so: StreamOptions = {
    dt, maxGap: p.maxGap, hold: p.hold, smooth: p.smooth, diffHalf: p.diffHalf, foreshorten: p.foreshorten,
    compressAngle: p.compressAngle, compressPos: p.compressPos,
  }

  // 1-2) reference features
  const refF = sequenceFeatures(reference, sx, sy, false, p.visConf)
  if (refF.length < 2) return emptyResult([], geometryRestored)
  const r0 = Math.round(refF[0].t / dt)
  const r1 = Math.round(refF[refF.length - 1].t / dt) + 1
  const ref = buildStream(refF, r0, r1, so)
  const N = ref.n

  let userSeq = user
  let userFrames = sequenceFeatures(userSeq, 1, 1, false, p.visConf)
  if (userFrames.length === 0) {
    return emptyResult(['We could not see you during the dance — make sure you are in front of the camera.'], geometryRestored)
  }
  // Broken recording clock (e.g. page uptime instead of dance time): no user frame anywhere near the
  // reference -> assume the recording started with the dance.
  const notes: string[] = []
  const refT0 = refF[0].t
  const refT1 = refF[refF.length - 1].t
  const overlaps = userFrames.some((f) => f.t >= refT0 + p.lagMin - 1 && f.t <= refT1 + p.lagMax + 1)
  if (!overlaps) {
    const shift = userFrames[0].t - refT0
    userSeq = user.map((f) => ({ time: f.time - shift, pose: f.pose && { ...f.pose, videoTime: undefined } }))
    userFrames = sequenceFeatures(userSeq, 1, 1, false, p.visConf)
    notes.push('The recording clock did not match the video; timing was aligned to the start of the dance.')
  }

  const wV = new Float64Array(NC)
  const wP = new Float64Array(NC)
  CHANNELS.forEach((ch, d) => {
    wV[d] = p.velWeights[ch.name] ?? 0
    wP[d] = ch.kind === 'angle' ? p.poseWeights[ch.name] ?? 0 : 0
  })
  const chance = chanceLevels(ref, p)
  const poseInv = 1 / (2 * p.poseSigma * p.poseSigma)
  const refPart = partVisibility(ref, wV, wP)

  // user features, both orientations, on a grid covering every lag + local offset
  const lagMinIdx = Math.round(p.lagMin / dt)
  const lagMaxIdx = Math.round(p.lagMax / dt)
  const tolIdx = Math.round(p.localTol / dt)
  const u0 = r0 + lagMinIdx - tolIdx - 2
  const u1 = r1 + lagMaxIdx + tolIdx + 2
  const variants = [false, true].map((mirrored) => {
    const stream = buildStream(mirrored ? sequenceFeatures(userSeq, 1, 1, true, p.visConf) : userFrames, u0, u1, so)
    return { mirrored, stream, part: partVisibility(stream, wV, wP) }
  })

  // 3) orientation + global lag: maximize G(l) * T(l)
  let erAll = 0
  for (let k = 0; k < N; k++) {
    for (let d = 0; d < NC; d++) if (ref.vvalid[k * NC + d]) erAll += wV[d] * ref.vel[k * NC + d] ** 2
  }
  let best = { value: -Infinity, lag: 0, variant: variants[0] }
  for (const v of variants) {
    const usr = v.stream
    for (let l = lagMinIdx; l <= lagMaxIdx; l++) {
      let num = 0
      let eu = 0
      const off = r0 - usr.start + l
      for (let k = 0; k < N; k++) {
        const j = k + off
        if (j < 0 || j >= usr.n || !usr.present[j]) continue
        const rb = k * NC
        const ub = j * NC
        for (let d = 0; d < NC; d++) {
          if (!ref.vvalid[rb + d] || !usr.vvalid[ub + d]) continue
          const u = usr.vel[ub + d]
          num += wV[d] * ref.vel[rb + d] * u
          eu += wV[d] * u * u
        }
      }
      const g = erAll + eu > 1e-12 ? (2 * num) / (erAll + eu) : 0
      const t = timingFactor(l * dt, p)
      // tiny tie-breaker toward the free zone when nothing correlates
      const value = Math.max(0, g) * t + 1e-9 * t - 1e-12 * Math.abs(l)
      if (value > best.value + 1e-12) best = { value, lag: l, variant: v }
    }
  }
  const usr = best.variant.stream
  const usrPart = best.variant.part
  const lagIdx = best.lag
  const lag = lagIdx * dt
  const tFactor = timingFactor(lag, p)
  const baseOff = r0 - usr.start + lagIdx
  const ctx: Ctx = { ref, usr, wV, wP, chance, poseInv, refPart, usrPart }

  // 4) segments
  const segLen = Math.max(1, Math.round(p.segment / dt))
  const nSeg = Math.ceil(N / segLen)
  const evalHalf = Math.round(p.evalWin / 2 / dt)
  const selHalf = Math.round(p.selectWin / 2 / dt)
  const restE = p.restSpeed * p.restSpeed
  const allMask = new Uint8Array(NC).fill(1)
  const partMasks = [0, 1].map((part) => Uint8Array.from(PART_OF.map((x) => (x === part ? 1 : 0))))
  const penalty = [p.hiddenPenalty.arms, p.hiddenPenalty.legs]
  const deltaOrder: number[] = [0]
  for (let dd = 1; dd <= tolIdx; dd++) deltaOrder.push(dd, -dd)

  const segScore = new Float64Array(nSeg)
  const segCov = new Float64Array(nSeg)
  const segKp = new Float64Array(nSeg)
  const segP = new Float64Array(nSeg)
  const segLambda = new Float64Array(nSeg)
  const segDelta = new Int32Array(nSeg)
  const partSeg = [new Float64Array(nSeg), new Float64Array(nSeg)]
  const partRefTotal = [0, 0]
  const partHiddenTotal = [0, 0]

  const curve = (Kp: number, P: number, lambda: number) =>
    lambda * Math.pow(Kp * P, p.gamma / 2) + (1 - lambda) * Math.pow(P, p.gamma)
  const kPrime = (K: number) => clamp01((K - p.kDead) / (1 - p.kDead))

  for (let s = 0; s < nSeg; s++) {
    const a = s * segLen
    const b = Math.min(N, a + segLen)
    const c = Math.floor((a + b) / 2)
    // local offset (timing jitter tolerance) on the longer selection window
    let bestDelta = 0
    let bestQ = -Infinity
    for (const dd of deltaOrder) {
      const st = windowStats(ctx, baseOff + dd, c - selHalf, c + selHalf + 1, allMask)
      if (st.present === 0) continue
      const q = concordance(st) + poseScore(st)
      if (q > bestQ + 1e-9) {
        bestQ = q
        bestDelta = dd
      }
    }
    segDelta[s] = bestDelta
    const off = baseOff + bestDelta
    // coverage + body-part visibility over the segment's own samples
    let presentInSeg = 0
    for (let k = a; k < b; k++) {
      const j = k + off
      if (j < 0 || j >= usr.n || !usr.present[j]) continue
      presentInSeg++
      for (let part = 0; part < 2; part++) {
        if (!refPart[k * 2 + part]) continue
        partRefTotal[part]++
        if (!usrPart[j * 2 + part]) partHiddenTotal[part]++
      }
    }
    const cov = presentInSeg / (b - a)
    // how much the reference moves here (all samples of the evaluation window)
    let eRef = 0
    let wRef = 0
    for (let k = Math.max(0, c - evalHalf); k < Math.min(N, c + evalHalf + 1); k++) {
      for (let d = 0; d < NC; d++) {
        if (wV[d] > 0 && CHANNELS[d].kind === 'angle' && ref.vvalid[k * NC + d]) {
          eRef += wV[d] * ref.vel[k * NC + d] ** 2
          wRef += wV[d]
        }
      }
    }
    const lambda = wRef > 0 ? eRef / wRef / (eRef / wRef + restE) : 0
    const st = windowStats(ctx, off, c - evalHalf, c + evalHalf + 1, allMask)
    const Kp = st.present > 0 ? kPrime(concordance(st)) : 0
    const P = st.present > 0 ? poseScore(st) : 0
    let vis = 1
    for (let part = 0; part < 2; part++) {
      if (st.partRef[part] > 0) vis -= penalty[part] * (st.partHidden[part] / st.partRef[part])
    }
    segKp[s] = Kp
    segP[s] = P
    segCov[s] = cov
    segLambda[s] = lambda
    segScore[s] = cov * Math.max(0, vis) * curve(Kp, P, lambda)
    for (let part = 0; part < 2; part++) {
      const ps = windowStats(ctx, off, c - evalHalf, c + evalHalf + 1, partMasks[part])
      const shown = ps.partRef[part] > 0 ? 1 - ps.partHidden[part] / ps.partRef[part] : 1
      partSeg[part][s] = ps.present > 0 ? cov * shown * curve(kPrime(concordance(ps)), poseScore(ps), lambda) : 0
    }
  }

  // 5) aggregate per reference sample
  const sampleMean = (arr: Float64Array, k0: number, k1: number) => {
    let sum = 0
    let cnt = 0
    for (let k = Math.max(0, k0); k < Math.min(N, k1); k++) {
      sum += arr[Math.floor(k / segLen)]
      cnt++
    }
    return cnt > 0 ? sum / cnt : 0
  }
  const overallScore = clamp01(tFactor * sampleMean(segScore, 0, N))
  const coverage = sampleMean(segCov, 0, N)

  let mSum = 0
  let mW = 0
  let pSum = 0
  let pW = 0
  let dSum = 0
  for (let s = 0; s < nSeg; s++) {
    if (segCov[s] <= 0) continue
    const len = Math.min(N, (s + 1) * segLen) - s * segLen
    mSum += segLambda[s] * len * segKp[s]
    mW += segLambda[s] * len
    pSum += segP[s] * len
    pW += len
    dSum += Math.abs(segDelta[s]) * len
  }
  const motionMatch = mW > 0 ? mSum / mW : 0
  const poseMatch = pW > 0 ? pSum / pW : 0
  const shownShare = [0, 1].map((part) => (partRefTotal[part] > 0 ? 1 - partHiddenTotal[part] / partRefTotal[part] : 1))
  const visibility = { arms: shownShare[0], legs: shownShare[1] }

  const refStart = r0 * dt
  const duration = N * dt
  const sectionScores: DynamicsResult['sectionScores'] = []
  const nSections = Math.max(1, Math.ceil((duration - 1e-9) / sectionDuration))
  for (let i = 0; i < nSections; i++) {
    const startTime = refStart + i * sectionDuration
    const endTime = Math.min(refStart + (i + 1) * sectionDuration, refStart + duration)
    const k0 = Math.round((startTime - refStart) / dt)
    const k1 = Math.round((endTime - refStart) / dt)
    sectionScores.push({ startTime, endTime, score: clamp01(tFactor * sampleMean(segScore, k0, k1)) })
  }
  const bodyPartScores = PART_NAMES.map((n, part) => ({
    name: n,
    score: clamp01(tFactor * sampleMean(partSeg[part], 0, N)),
    tracked: partRefTotal[part] === 0 || shownShare[part] >= 0.5,
  }))

  // per-move evidence: segments where the reference clearly moves
  const moveScores: MoveScore[] = []
  for (let s = 0; s < nSeg; s++) {
    if (segLambda[s] < 0.5) continue
    const a = s * segLen
    const b = Math.min(N, a + segLen)
    const sc = clamp01(tFactor * segScore[s])
    const tracked = segCov[s] >= 0.5
    moveScores.push({
      time: Math.round((refStart + ((a + b) / 2) * dt) * 100) / 100,
      score: Math.round(sc * 1000) / 1000,
      rating: !tracked ? 'TRACKING LOST' : sc >= 0.85 ? 'PERFECT' : sc >= 0.6 ? 'GOOD' : sc >= 0.35 ? 'OK' : 'MISS',
      offsetMs: tracked ? Math.round((lagIdx + segDelta[s]) * dt * 1000) : null,
    })
  }

  const compensation = Math.min(p.freeLatMax, Math.max(p.freeLatMin, lag))
  if (!geometryRestored) notes.push('Reference video size unknown — body proportions may be slightly distorted.')
  if (coverage < 0.9) {
    notes.push(`We could only track you for ${Math.round(coverage * 100)}% of the dance — stay in frame from start to finish.`)
  }
  PART_NAMES.forEach((n, part) => {
    if (partRefTotal[part] === 0 || shownShare[part] > 0.9) return
    const hidden = Math.round((1 - shownShare[part]) * 100)
    notes.push(n === 'Legs'
      ? `Legs were not visible for ${hidden}% of the time you were tracked — step back so your full body is in frame.`
      : `Arms were out of frame for ${hidden}% of the time you were tracked.`)
  })
  const refMoves = mW / Math.max(1, pW) > 0.3
  if (coverage > 0.2 && refMoves && motionMatch < 0.3) {
    notes.push("Your movement didn't follow the dance — copy the moves as they happen, not just the poses.")
  } else if (tFactor < 0.97) {
    notes.push(lag > 0
      ? `You were about ${lag.toFixed(1)} s behind the music (${Math.round((1 - tFactor) * 100)}% timing penalty).`
      : `You were about ${(-lag).toFixed(1)} s ahead of the music (${Math.round((1 - tFactor) * 100)}% timing penalty).`)
  }
  if (best.variant.mirrored && motionMatch >= 0.3) notes.push("You danced mirror-style (your left = the dancer's right); scored as a mirror image.")

  return {
    overallScore,
    sectionScores,
    bodyPartScores,
    rank: computeRankV3(overallScore, p),
    alignment: [],
    scoringVersion: 3,
    coverage,
    timingAccuracy: tFactor,
    latencyMs: Math.round(compensation * 1000),
    timingOffsetMs: Math.round(lag * 1000),
    localTimingMs: pW > 0 ? Math.round((dSum / pW) * dt * 1000) : 0,
    motionMatch,
    poseMatch,
    visibility,
    mirrored: best.variant.mirrored,
    geometryRestored,
    moveScores,
    notes,
  }
}

export function score(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
  options?: Options,
): DynamicsResult {
  return scoreWithParams(reference, user, sectionDuration, options, DEFAULT_PARAMS)
}
