/**
 * Candidate "keymoment-hits": Just Dance-style per-MOVE scoring windows (scoring v3 candidate).
 *
 * Pipeline (see ./keymoment-hits/{features,moves,judge}.ts for the formulas):
 * 1. Geometry: reference x * width, y * height (options.referenceGeometry); users are webcam pixels.
 *    Every frame becomes 10 body-segment directions (arms 4, legs 4, torso 2).
 * 2. Moves: the reference is cut at "hits" (the dancer arrives at a pose after moving). Each move =
 *    pose at the hit + the motion of the preceding segment. Pauses produce no moves.
 * 3. Orientation + timing: both orientations (as-is / mirror-style) and one global lag L in the
 *    range that can still earn timing credit are searched; L_c = clamp(L, 0, 0.3 s) is the free
 *    latency compensation.
 * 4. Each move is judged inside its own window around t + L (+/- PARAMS.window, clipped halfway to
 *    the neighbouring moves, so a user frame serves at most one move); the best
 *        credit = poseCredit * motionFactor * timingFactor
 *    wins (timing is free within +/- freeTol of t + L_c, then falls linearly). No user frame in
 *    the window = 0 ("lost").
 * 5. Continuous term: the same judge on every reference frame (pauses included, 0.4 s motion
 *    window) — time coverage, holds and in-between movement.
 * 6. overallScore = (1 - PARAMS.continuousWeight) * moveScore + PARAMS.continuousWeight * continuousScore.
 */
import type { BodyPartScore, SectionScore, TimestampedPose } from '../../../src/scoring/dtw'
import type { SeqFeatures } from './keymoment-hits/features'
import { NP, PARTS, buildFeatures, lowerBound } from './keymoment-hits/features'
import type { Move } from './keymoment-hits/moves'
import { detectMoves } from './keymoment-hits/moves'
import {
  clampLatency, motionAgreement, motionFactor, poseCredit, referenceMotion, timingFactor, chanceLevels,
} from './keymoment-hits/judge'
import { PARAMS, referenceParamsKey } from './keymoment-hits/params'

export { PARAMS }

export const name = 'keymoment-hits (per-move windows + continuous term, v3 candidate)'

/** DanceMode should record every loop iteration (no detection -> { keypoints: [] }). */
export const recordPolicy = 'all'

type Rank = 'S' | 'A' | 'B' | 'C'

/** Per-move rating thresholds on the move credit. */
const RATINGS: [number, string][] = [[0.85, 'perfect'], [0.7, 'super'], [0.5, 'good'], [0.3, 'ok'], [0, 'miss']]

/** Proposed v3 ranks (keep 'S'|'A'|'B'|'C'). */
export function computeRankV3(score: number): Rank {
  const pct = score * 100
  if (pct >= 85) return 'S'
  if (pct >= 70) return 'A'
  if (pct >= 40) return 'B'
  return 'C'
}

interface Geometry {
  width: number
  height: number
}

interface Options {
  referenceGeometry?: Geometry
  [key: string]: unknown
}

interface Moment {
  /** Reference frame index */
  index: number
  time: number
  segment: number
  /** Allowed offsets relative to time + L (window clipped halfway to the neighbours) */
  lo: number
  hi: number
  rest: boolean
}

interface RefPrep {
  feats: SeqFeatures
  moves: Move[]
  moveMoments: Moment[]
  denseMoments: Moment[]
  chance: Float64Array
  duration: number
}

const refCache = new WeakMap<TimestampedPose[], Map<string, RefPrep>>()

function prepareReference(reference: TimestampedPose[], geo: Geometry | undefined): RefPrep {
  const key = (geo ? `${geo.width}x${geo.height}` : 'none') + '|' + referenceParamsKey()
  let byGeo = refCache.get(reference)
  if (!byGeo) {
    byGeo = new Map()
    refCache.set(reference, byGeo)
  }
  const hit = byGeo.get(key)
  if (hit) return hit
  const feats = buildFeatures(reference, { scaleX: geo?.width ?? 1, scaleY: geo?.height ?? 1, mirror: false })
  const moves = detectMoves(feats)
  const moveMoments: Moment[] = moves.map((m, k) => {
    const prev = k > 0 ? moves[k - 1].time : -Infinity
    const next = k + 1 < moves.length ? moves[k + 1].time : Infinity
    return {
      index: m.index,
      time: m.time,
      segment: m.segment,
      lo: Math.max(-PARAMS.window, (prev - m.time) / 2),
      hi: Math.min(PARAMS.window, (next - m.time) / 2),
      rest: false,
    }
  })
  const duration = feats.n ? feats.times[feats.n - 1] : 0
  const denseMoments: Moment[] = []
  const step = feats.n > 1 ? Math.max(1, Math.round(0.066 / ((duration - feats.times[0]) / (feats.n - 1)))) : 1
  for (let i = 0; i < feats.n; i += step) {
    const t = feats.times[i]
    if (t > duration - PARAMS.maxLatency && t > feats.times[0]) continue
    denseMoments.push({
      index: i, time: t, segment: PARAMS.denseSegment, lo: -PARAMS.window, hi: PARAMS.window,
      rest: referenceMotion(feats, i, PARAMS.denseSegment) < PARAMS.restMotion,
    })
  }
  const prep: RefPrep = { feats, moves, moveMoments, denseMoments, chance: chanceLevels(feats), duration }
  byGeo.set(key, prep)
  return prep
}

/** Candidate user frames of one moment over the whole lag range, with their lag-free credit. */
interface Candidates {
  start: number
  offsets: Float64Array
  base: Float64Array
}

function momentBase(ref: RefPrep, m: Moment, usr: SeqFeatures, j: number): number {
  const pose = poseCredit(ref.feats, m.index, usr, j, ref.chance)
  if (pose <= 0) return 0
  return m.rest ? pose : pose * motionFactor(motionAgreement(ref.feats, m.index, usr, j, m.segment))
}

function candidatesFor(ref: RefPrep, m: Moment, usr: SeqFeatures, lagMin: number, lagMax: number): Candidates {
  const start = lowerBound(usr.times, m.time + lagMin + m.lo)
  const end = lowerBound(usr.times, m.time + lagMax + m.hi + 1e-9)
  const n = Math.max(0, end - start)
  const offsets = new Float64Array(n)
  const base = new Float64Array(n)
  for (let q = 0; q < n; q++) {
    const j = start + q
    offsets[q] = usr.times[j] - m.time
    base[q] = momentBase(ref, m, usr, j)
  }
  return { start, offsets, base }
}

interface Pick {
  credit: number
  /** user frame index (features), -1 = no frame in window */
  j: number
  offset: number
}

function bestInWindow(c: Candidates, m: Moment, lag: number, latency: number): Pick {
  const lo = lowerBound(c.offsets, lag + m.lo - 1e-9)
  let best: Pick = { credit: 0, j: -1, offset: NaN }
  for (let q = lo; q < c.offsets.length && c.offsets[q] <= lag + m.hi + 1e-9; q++) {
    const credit = c.base[q] * timingFactor(c.offsets[q], latency)
    if (best.j < 0 || credit > best.credit) best = { credit, j: c.start + q, offset: c.offsets[q] }
  }
  return best
}

interface Search {
  lag: number
  total: number
  cands: Candidates[]
}

/**
 * Lag search range: every lag that can still earn timing credit, i.e. up to timingZero beyond the
 * free band on either side ([-freeTol - timingZero, maxLatency + freeTol + timingZero]).
 */
export function lagRange(): [number, number] {
  return [-(PARAMS.freeTol + PARAMS.timingZero), PARAMS.maxLatency + PARAMS.freeTol + PARAMS.timingZero]
}

function searchLag(ref: RefPrep, moments: Moment[], usr: SeqFeatures): Search {
  const [lagMin, lagMax] = lagRange()
  const cands = moments.map((m) => candidatesFor(ref, m, usr, lagMin, lagMax))
  let bestLag = 0
  let bestTotal = -1
  const steps = Math.round((lagMax - lagMin) / PARAMS.lagStep)
  // Visit the free band first so ties prefer a lag that needs no timing penalty.
  const order: number[] = []
  for (let s = 0; s <= steps; s++) order.push(lagMin + s * PARAMS.lagStep)
  order.sort((a, b) => Math.abs(a - clampLatency(a)) - Math.abs(b - clampLatency(b)) || a - b)
  let bestSpread = Infinity
  for (const lag of order) {
    const latency = clampLatency(lag)
    let total = 0
    let spread = 0
    for (let k = 0; k < moments.length; k++) {
      const pick = bestInWindow(cands[k], moments[k], lag, latency)
      total += pick.credit
      if (pick.j >= 0) spread += pick.credit * Math.abs(pick.offset - lag)
    }
    // Near-ties (e.g. every lag whose free band covers the user) go to the lag that centres the picks.
    const tie = Math.abs(total - bestTotal) <= 1e-6 * (1 + bestTotal)
    if ((total > bestTotal && !tie) || (tie && spread < bestSpread)) {
      bestTotal = Math.max(total, bestTotal)
      bestLag = lag
      bestSpread = spread
    }
  }
  return { lag: bestLag, total: bestTotal, cands }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function rate(credit: number, tracked: boolean): string {
  if (!tracked) return 'lost'
  for (const [min, label] of RATINGS) if (credit >= min) return label
  return 'miss'
}

export interface MoveScore {
  time: number
  score: number
  rating: string
  /** Timing error vs the compensated time (ms); null when the user was not tracked */
  offsetMs: number | null
}

export interface KeymomentResult {
  overallScore: number
  sectionScores: SectionScore[]
  bodyPartScores: (BodyPartScore & { tracked: boolean })[]
  rank: Rank
  alignment: [number, number][]
  scoringVersion: 3
  coverage: number
  timingAccuracy: number
  latencyMs: number
  timingOffsetMs: number
  motionMatch: number
  poseMatch: number
  orientation: 'direct' | 'mirror'
  moveScore: number
  continuousScore: number
  moves: number
  moveScores: MoveScore[]
  notes: string[]
}

function emptyResult(ref: RefPrep | null, sectionDuration: number, notes: string[]): KeymomentResult {
  const duration = ref?.duration ?? 0
  const n = Math.max(1, Math.ceil(duration / sectionDuration))
  return {
    overallScore: 0,
    sectionScores: duration > 0 ? Array.from({ length: n }, (_, s) => ({
      startTime: s * sectionDuration, endTime: Math.min((s + 1) * sectionDuration, duration), score: 0,
    })) : [],
    bodyPartScores: [{ name: 'Arms', score: 0, tracked: false }, { name: 'Legs', score: 0, tracked: false }],
    rank: 'C',
    alignment: [],
    scoringVersion: 3,
    coverage: 0,
    timingAccuracy: 0,
    latencyMs: 0,
    timingOffsetMs: 0,
    motionMatch: 0,
    poseMatch: 0,
    orientation: 'direct',
    moveScore: 0,
    continuousScore: 0,
    moves: ref?.moves.length ?? 0,
    moveScores: (ref?.moves ?? []).map((m) => ({ time: m.time, score: 0, rating: 'lost', offsetMs: null })),
    notes,
  }
}

interface Judged {
  pick: Pick
  pose: number
  motion: number | null
  parts: Float64Array
  partW: Float64Array
  partUserW: Float64Array
  factor: number
}

function judgeAt(ref: RefPrep, m: Moment, usr: SeqFeatures, c: Candidates, lag: number): Judged {
  const latency = clampLatency(lag)
  const pick = bestInWindow(c, m, lag, latency)
  const parts = new Float64Array(NP)
  const partW = new Float64Array(NP)
  const partUserW = new Float64Array(NP)
  if (pick.j < 0) return { pick, pose: 0, motion: m.rest ? null : 0, parts, partW, partUserW, factor: 0 }
  const pose = poseCredit(ref.feats, m.index, usr, pick.j, ref.chance, parts, partW, partUserW)
  const motion = m.rest ? null : motionAgreement(ref.feats, m.index, usr, pick.j, m.segment)
  const factor = (motion === null ? 1 : motionFactor(motion)) * timingFactor(pick.offset, latency)
  return { pick, pose, motion, parts, partW, partUserW, factor }
}

export function score(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
  options?: Options,
): KeymomentResult {
  const geo = options?.referenceGeometry && options.referenceGeometry.width > 0 && options.referenceGeometry.height > 0
    ? options.referenceGeometry
    : undefined
  const ref = prepareReference(reference, geo)
  if (ref.feats.n === 0) return emptyResult(null, sectionDuration, [])
  const variants = [
    { orientation: 'direct' as const, feats: buildFeatures(user, { scaleX: 1, scaleY: 1, mirror: false }) },
    { orientation: 'mirror' as const, feats: buildFeatures(user, { scaleX: 1, scaleY: 1, mirror: true }) },
  ]
  if (variants[0].feats.n === 0) {
    return emptyResult(ref, sectionDuration, ['We could not see you during the dance - make sure your body is in front of the camera.'])
  }

  // Too few moves (very short or static reference): judge the continuous moments instead.
  const useMoves = ref.moveMoments.length >= 3
  const searchMoments = useMoves ? ref.moveMoments : ref.denseMoments.filter((_, i) => i % 3 === 0)

  let chosen = variants[0]
  let search: Search | null = null
  for (const v of variants) {
    const s = searchLag(ref, searchMoments, v.feats)
    if (!search || s.total > search.total + 1e-9) {
      search = s
      chosen = v
    }
  }
  const usr = chosen.feats
  const lag = search!.lag
  const latency = clampLatency(lag)

  // Moves
  const moveJudged = useMoves ? ref.moveMoments.map((m, k) => judgeAt(ref, m, usr, search!.cands[k], lag)) : []
  const moveCredits = moveJudged.map((j) => j.pick.credit)
  // Continuous term
  const denseJudged = ref.denseMoments.map((m) => judgeAt(ref, m, usr, candidatesFor(ref, m, usr, lag, lag), lag))
  const denseCredits = denseJudged.map((j) => j.pick.credit)
  const continuousScore = mean(denseCredits)
  const moveScore = useMoves ? mean(moveCredits) : continuousScore
  const overallScore = Math.min(1, Math.max(0, (1 - PARAMS.continuousWeight) * moveScore + PARAMS.continuousWeight * continuousScore))

  // Coverage / visibility (time based, continuous moments)
  const covered = denseJudged.filter((j) => j.pick.j >= 0)
  const coverage = denseJudged.length ? covered.length / denseJudged.length : 0
  const partVisible = PARTS.map((_, p) => {
    const shown = covered.filter((j) => j.partW[p] > 0)
    return shown.length ? shown.filter((j) => j.partUserW[p] >= 0.5 * j.partW[p]).length / shown.length : 0
  })

  // Motion / pose / timing summaries over tracked moves
  const trackedMoves = (useMoves ? moveJudged : denseJudged).filter((j) => j.pick.j >= 0)
  const motions = trackedMoves.filter((j) => j.motion !== null).map((j) => j.motion as number)
  const motionMatch = motions.length ? mean(motions) : 1
  const poseMatch = mean(trackedMoves.map((j) => j.pose))
  const timingAccuracy = trackedMoves.length ? mean(trackedMoves.map((j) => timingFactor(j.pick.offset, latency))) : 0

  // Sections
  const duration = ref.duration
  const nSections = Math.max(1, Math.ceil(duration / sectionDuration))
  const sectionScores: SectionScore[] = []
  for (let s = 0; s < nSections; s++) {
    const startTime = s * sectionDuration
    const endTime = Math.min((s + 1) * sectionDuration, duration)
    const last = s === nSections - 1
    const inSec = (t: number) => t >= startTime && (t < endTime || (last && t <= endTime + 1e-9))
    const dense = denseCredits.filter((_, i) => inSec(ref.denseMoments[i].time))
    const mv = moveCredits.filter((_, i) => inSec(ref.moveMoments[i].time))
    const d = mean(dense)
    const scoreS = mv.length ? (1 - PARAMS.continuousWeight) * mean(mv) + PARAMS.continuousWeight * d : d
    sectionScores.push({ startTime, endTime, score: scoreS })
  }

  // Body parts (moves; arms = arms, legs = legs)
  const partSource = useMoves ? moveJudged : denseJudged
  const bodyPartScores = (['Arms', 'Legs'] as const).map((label) => {
    const p = PARTS.indexOf(label === 'Arms' ? 'arms' : 'legs')
    const judged = partSource.filter((j) => j.partW[p] > 0 || j.pick.j < 0)
    const score = judged.length ? mean(judged.map((j) => j.parts[p] * j.factor)) : 0
    return { name: label, score, tracked: covered.length > 0 && partVisible[p] >= 0.5 }
  })

  const moveScores: MoveScore[] = moveJudged.map((j, k) => ({
    time: ref.moveMoments[k].time,
    score: Math.round(j.pick.credit * 1000) / 1000,
    rating: rate(j.pick.credit, j.pick.j >= 0),
    offsetMs: j.pick.j >= 0 ? Math.round((j.pick.offset - latency) * 1000) : null,
  }))

  const alignment: [number, number][] = []
  moveJudged.forEach((j, k) => {
    if (j.pick.j >= 0) alignment.push([ref.moveMoments[k].index, usr.orig[j.pick.j]])
  })

  // Notes: the biggest penalties in plain language
  const notes: string[] = []
  if (coverage < 0.9) {
    notes.push(`We could only see you for ${Math.round(coverage * 100)}% of the dance - stay in frame from start to finish.`)
  }
  const legsHidden = 1 - partVisible[PARTS.indexOf('legs')]
  if (covered.length > 0 && legsHidden >= 0.3 && covered.some((j) => j.partW[PARTS.indexOf('legs')] > 0)) {
    notes.push(`Your legs were not visible for ${Math.round(legsHidden * 100)}% of the time we could see you - step back so your whole body is in frame (legs count for about a third of the score).`)
  }
  // Timing / orientation are only meaningful when the moves were actually recognised.
  const recognised = poseMatch >= 0.5 && motionMatch >= 0.35
  const behind = lag - latency
  if (recognised && behind >= 0.25) notes.push(`You were about ${lag.toFixed(1)} s behind the music - try to hit each move on the beat.`)
  else if (recognised && lag <= -0.25) notes.push(`You were about ${(-lag).toFixed(1)} s ahead of the music - wait for the beat.`)
  if (motions.length > 0 && motionMatch < 0.35) {
    notes.push('You barely moved with the dancer - copy the movements, not just the poses.')
  } else if (trackedMoves.length > 0 && poseMatch < 0.4) {
    notes.push('Your poses were quite different from the dancer - watch the arm and leg positions at each move.')
  }
  if (recognised && chosen.orientation === 'mirror') notes.push('You danced mirror-style (your left = the dancer\'s right) - we scored it that way.')
  if (!geo) notes.push('The reference video size was unknown, so poses were compared without geometry correction.')

  return {
    overallScore,
    sectionScores,
    bodyPartScores,
    rank: computeRankV3(overallScore),
    alignment,
    scoringVersion: 3,
    coverage,
    timingAccuracy,
    latencyMs: Math.round(latency * 1000),
    timingOffsetMs: Math.round(lag * 1000),
    motionMatch,
    poseMatch,
    orientation: chosen.orientation,
    moveScore,
    continuousScore,
    moves: ref.moves.length,
    moveScores,
    notes,
  }
}
