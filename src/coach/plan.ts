/**
 * DanceCraft AI Coach — pure, isomorphic plan helpers (see contract in ./types).
 *
 * Used by the Express coach API (to repair Claude output and to build the
 * offline fallback) and by the client (to re-validate whatever the server
 * returns before it drives PracticeMode). No DOM or Node APIs in here.
 */
import {
  COACH_SPEEDS,
  MAX_DRILL_REPEATS,
  MIN_DRILL_REPEATS,
  MIN_DRILL_SECONDS,
} from './types'
import type {
  AttemptSummary,
  BattleContender,
  BattleRequest,
  BattleVerdict,
  CoachBodyPartScore,
  CoachPlan,
  CoachRequest,
  CoachSectionScore,
  CoachSpeed,
} from './types'

/** Max lengths for CoachPlan / BattleVerdict strings (UTF-16 units). */
export const COACH_TEXT_LIMITS = {
  summary: 280,
  focus: 48,
  cue: 160,
  improvement: 220,
  encouragement: 140,
  headline: 80,
  commentary: 300,
} as const

/** Used when the duration is unusable and there are no sections to infer it from. */
const DEFAULT_DURATION_SECONDS = 10
/** Default drill length when we have nothing better (no sections). */
const DEFAULT_DRILL_SECONDS = 10
/** |marginPoints| below this is a tie. */
const TIE_THRESHOLD_POINTS = 0.5

/** Below this share of the song tracked, staying in frame is the main problem. */
export const LOW_COVERAGE = 0.6
/** Below this motion match the player was mostly standing still. */
export const LOW_MOTION_MATCH = 0.35

const DEFAULT_CUE = 'Count the beat out loud and hit every pose right on the count — make each shape big and sharp.'
const ARMS_CUE = 'Lock each arm shape at full extension and freeze it for a split second before the next move.'
const LEGS_CUE = 'Bend your knees and plant every step fully — sink your weight into the floor on each count.'
// Movement-first cues: rebuild motion before polishing shapes.
const MOVE_CUE = 'Keep moving with the dancer on every beat — big, loose moves the whole loop, even if the shapes aren\'t perfect yet.'
const MOVE_ARMS_CUE = 'Copy every arm move big and on the beat — whenever the dancer moves, you move. Keep going even if the shapes aren\'t perfect yet.'
const MOVE_LEGS_CUE = 'Bounce your knees on every beat and copy each step — keep your legs moving the whole loop, even if the steps aren\'t perfect yet.'
const FRAME_CUE = 'Start centred in front of the camera and stay inside the frame for the whole loop — every second out of view scores zero.'

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

/** Whole percentage for display (0.734 -> 73). */
function pct(score: number): number {
  return Math.round(clamp01(score) * 100)
}

/** Seconds label for display (9.97 -> "10s"). */
function secs(seconds: number): string {
  return `${Math.round(seconds)}s`
}

/**
 * Collapse whitespace, trim and cap a string. Over-long strings are cut and
 * end with an ellipsis; the result never exceeds `max` and is idempotent.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  let cut = text.slice(0, Math.max(0, max - 1))
  // Never leave half of a surrogate pair (emoji) at the cut point.
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** Sections with finite numbers only (scores clamped to 0-1). */
function validSections(sections: readonly CoachSectionScore[] | undefined): CoachSectionScore[] {
  if (!Array.isArray(sections)) return []
  const out: CoachSectionScore[] = []
  for (const s of sections) {
    if (!isRecord(s)) continue
    const startTime = finiteOrNull(s.startTime)
    const endTime = finiteOrNull(s.endTime)
    const score = finiteOrNull(s.score)
    if (startTime === null || endTime === null || score === null) continue
    out.push({ startTime, endTime, score: clamp01(score) })
  }
  return out
}

/** Lowest-scoring section; ties go to the earliest one. */
function findWeakestSection(sections: readonly CoachSectionScore[] | undefined): CoachSectionScore | null {
  let weakest: CoachSectionScore | null = null
  for (const s of validSections(sections)) {
    if (
      weakest === null
      || s.score < weakest.score
      || (s.score === weakest.score && s.startTime < weakest.startTime)
    ) {
      weakest = s
    }
  }
  return weakest
}

function validBodyParts(parts: readonly CoachBodyPartScore[] | undefined): CoachBodyPartScore[] {
  if (!Array.isArray(parts)) return []
  const out: CoachBodyPartScore[] = []
  for (const p of parts) {
    if (!isRecord(p)) continue
    const score = finiteOrNull(p.score)
    const name = cleanText(p.name, 40)
    if (score === null || !name) continue
    out.push({ name, score: clamp01(score) })
  }
  return out
}

/** Lowest-scoring body part; ties go to the first one listed. */
function findWeakestBodyPart(parts: readonly CoachBodyPartScore[] | undefined): CoachBodyPartScore | null {
  let weakest: CoachBodyPartScore | null = null
  for (const p of validBodyParts(parts)) {
    if (weakest === null || p.score < weakest.score) weakest = p
  }
  return weakest
}

/** Highest-scoring body part; ties go to the first one listed. */
function findStrongestBodyPart(parts: readonly CoachBodyPartScore[] | undefined): CoachBodyPartScore | null {
  let strongest: CoachBodyPartScore | null = null
  for (const p of validBodyParts(parts)) {
    if (strongest === null || p.score > strongest.score) strongest = p
  }
  return strongest
}

/** The evidence fields diagnoseAttempt reads (battle contenders may carry them too). */
export type AttemptEvidence = Pick<AttemptSummary, 'coverage' | 'motionMatch' | 'untrackedBodyParts'>

/** Untracked body part names as sent (trimmed, de-duplicated case-insensitively). */
function untrackedNames(attempt: AttemptEvidence | undefined): string[] {
  const list = attempt?.untrackedBodyParts
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const name = cleanText(raw, 40)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Lowest-scoring body part the camera could actually see. An untracked part's
 * score measures the framing, not the dancing, so it is never coached.
 */
export function findWeakestTrackedBodyPart(attempt: AttemptSummary | undefined): CoachBodyPartScore | null {
  const untracked = new Set(untrackedNames(attempt).map((n) => n.toLowerCase()))
  return findWeakestBodyPart(validBodyParts(attempt?.bodyPartScores).filter((p) => !untracked.has(p.name.toLowerCase())))
}

/** What the coach should fix first. */
export type CoachProblem = 'coverage' | 'motion' | 'coverage+motion' | 'technique'

export interface AttemptDiagnosis {
  /** coverage < LOW_COVERAGE: the camera lost the player for much of the song. */
  lowCoverage: boolean
  /** motionMatch < LOW_MOTION_MATCH: the player was barely moving with the dancer. */
  lowMotion: boolean
  /** Framing/movement problems outrank technique. */
  primaryProblem: CoachProblem
  /** Body parts that were out of frame (names as sent, de-duplicated). */
  untrackedBodyParts: string[]
}

/**
 * Read the honest-scoring evidence on an attempt. Missing evidence (older
 * clients, legacy scores) means "technique" — the pre-evidence behaviour.
 */
export function diagnoseAttempt(attempt: AttemptEvidence | undefined): AttemptDiagnosis {
  const coverage = finiteOrNull(attempt?.coverage)
  const motion = finiteOrNull(attempt?.motionMatch)
  const lowCoverage = coverage !== null && coverage < LOW_COVERAGE
  const lowMotion = motion !== null && motion < LOW_MOTION_MATCH
  let primaryProblem: CoachProblem = 'technique'
  if (lowCoverage && lowMotion) primaryProblem = 'coverage+motion'
  else if (lowCoverage) primaryProblem = 'coverage'
  else if (lowMotion) primaryProblem = 'motion'
  return { lowCoverage, lowMotion, primaryProblem, untrackedBodyParts: untrackedNames(attempt) }
}

/** Usable video duration: the given one, else the last section end, else 10s. */
function resolveDuration(durationSeconds: number, sections: readonly CoachSectionScore[]): number {
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) return durationSeconds
  let lastEnd = 0
  for (const s of validSections(sections)) lastEnd = Math.max(lastEnd, s.endTime)
  return lastEnd > 0 ? lastEnd : DEFAULT_DURATION_SECONDS
}

/** Speed rule shared by the fallback coach and the Claude prompt. */
function speedForScore(score: number): CoachSpeed {
  if (score < 0.5) return 0.5
  if (score < 0.75) return 0.75
  return 1
}

function repeatsForScore(score: number): number {
  return score < 0.4 ? 4 : 3
}

function snapSpeed(speed: number): CoachSpeed {
  let best: CoachSpeed = COACH_SPEEDS[0]
  for (const candidate of COACH_SPEEDS) {
    // Strict "<" keeps the slower speed on exact ties (e.g. 0.625).
    if (Math.abs(candidate - speed) < Math.abs(best - speed)) best = candidate
  }
  return best
}

/**
 * Clamp a [start, end] window into [0, duration] with length >= MIN_DRILL_SECONDS
 * (or the whole clip when it is shorter than that). Values that are already
 * valid are returned untouched, so the function is idempotent.
 */
function fitWindow(rawStart: number, rawEnd: number, duration: number): [number, number] {
  if (duration < MIN_DRILL_SECONDS) return [0, duration]

  let start = rawStart
  let end = rawEnd
  if (end < start) [start, end] = [end, start]

  const maxStart = Math.max(0, duration - MIN_DRILL_SECONDS)
  start = clamp(start, 0, maxStart)
  end = clamp(end, 0, duration)

  if (end - start < MIN_DRILL_SECONDS) {
    end = start + MIN_DRILL_SECONDS
    if (end > duration) {
      end = duration
      start = Math.max(0, duration - MIN_DRILL_SECONDS)
    }
  }

  // Floating point: (a + 3) - a can come out as 2.9999999999999996. Nudge
  // until the length check PracticeMode performs really passes.
  for (let i = 0; i < 8 && end - start < MIN_DRILL_SECONDS; i++) {
    if (end < duration) end = Math.min(duration, end + 1e-9)
    else start = Math.max(0, start - 1e-9)
  }
  if (end - start < MIN_DRILL_SECONDS) return [0, duration]
  return [start, end]
}

function defaultSummary(start: number, end: number, weakest: CoachSectionScore | null): string {
  if (weakest) {
    return `Your toughest stretch was ${secs(weakest.startTime)}–${secs(weakest.endTime)} at ${pct(weakest.score)}%. Let's loop ${secs(start)}–${secs(end)} and lock it in.`
  }
  return `Nice run! Let's loop ${secs(start)}–${secs(end)} and make every move land.`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Repair ANY input (Claude output, stale client state, garbage) into a valid
 * CoachPlan. Idempotent: sanitizeCoachPlan(sanitizeCoachPlan(x, d, s), d, s)
 * deep-equals sanitizeCoachPlan(x, d, s).
 */
export function sanitizeCoachPlan(
  raw: unknown,
  durationSeconds: number,
  sectionScores: CoachSectionScore[],
): CoachPlan {
  const input = isRecord(raw) ? raw : {}
  const duration = resolveDuration(durationSeconds, sectionScores)
  const weakest = findWeakestSection(sectionScores)

  // Default drill window: the weakest section, else the opening seconds.
  const defStart = weakest ? weakest.startTime : 0
  const defEnd = weakest ? weakest.endTime : Math.min(duration, DEFAULT_DRILL_SECONDS)
  const defLength = Math.max(MIN_DRILL_SECONDS, defEnd - defStart)

  const rawStart = finiteOrNull(input.startTime)
  const rawEnd = finiteOrNull(input.endTime)
  let start: number
  let end: number
  if (rawStart !== null && rawEnd !== null) {
    start = rawStart
    end = rawEnd
  } else if (rawStart !== null) {
    start = rawStart
    end = rawStart + defLength
  } else if (rawEnd !== null) {
    start = rawEnd - defLength
    end = rawEnd
  } else {
    start = defStart
    end = defEnd
  }
  const [startTime, endTime] = fitWindow(start, end, duration)

  const weakScore = weakest ? weakest.score : 1
  const rawSpeed = finiteOrNull(input.playbackSpeed)
  const playbackSpeed = rawSpeed !== null ? snapSpeed(rawSpeed) : speedForScore(weakScore)

  const rawRepeats = finiteOrNull(input.repeats)
  const repeats = clamp(
    Math.round(rawRepeats !== null ? rawRepeats : repeatsForScore(weakScore)),
    MIN_DRILL_REPEATS,
    MAX_DRILL_REPEATS,
  )

  const plan: CoachPlan = {
    summary: cleanText(input.summary, COACH_TEXT_LIMITS.summary)
      || cleanText(defaultSummary(startTime, endTime, weakest), COACH_TEXT_LIMITS.summary),
    focus: cleanText(input.focus, COACH_TEXT_LIMITS.focus)
      || cleanText(`Drill · ${secs(startTime)}–${secs(endTime)}`, COACH_TEXT_LIMITS.focus),
    startTime,
    endTime,
    playbackSpeed,
    repeats,
    cue: cleanText(input.cue, COACH_TEXT_LIMITS.cue) || cleanText(DEFAULT_CUE, COACH_TEXT_LIMITS.cue),
  }

  const improvement = cleanText(input.improvement, COACH_TEXT_LIMITS.improvement)
  if (improvement) plan.improvement = improvement
  const encouragement = cleanText(input.encouragement, COACH_TEXT_LIMITS.encouragement)
  if (encouragement) plan.encouragement = encouragement

  return plan
}

function cueForBodyPart(name: string | undefined): string {
  const key = (name ?? '').toLowerCase()
  if (key.includes('arm')) return ARMS_CUE
  if (key.includes('leg')) return LEGS_CUE
  return DEFAULT_CUE
}

/** Movement-first cue: keep moving (low motion) or stay in frame (low coverage only). */
function movementCue(diagnosis: AttemptDiagnosis, name: string | undefined): string {
  if (!diagnosis.lowMotion) return FRAME_CUE
  const key = (name ?? '').toLowerCase()
  if (key.includes('arm')) return MOVE_ARMS_CUE
  if (key.includes('leg')) return MOVE_LEGS_CUE
  return MOVE_CUE
}

/** One sentence naming the framing/movement problem, quoting the evidence. */
function describeMovementProblem(attempt: AttemptSummary, diagnosis: AttemptDiagnosis): string {
  const coverage = pct(attempt.coverage ?? 0)
  const motion = pct(attempt.motionMatch ?? 0)
  if (diagnosis.lowCoverage && diagnosis.lowMotion) {
    return `The camera saw you for only ${coverage}% of the song and you were barely moving (${motion}% motion match) — stay in frame for the whole song and keep dancing.`
  }
  if (diagnosis.lowCoverage) {
    return `The camera saw you for only ${coverage}% of the song — stay in frame for the whole song before we polish technique.`
  }
  return `You were barely moving (${motion}% motion match) — dance along the whole way through before we polish technique.`
}

/** "Your legs were out of frame — step back …" (a framing tip, never a technique judgement). */
function describeUntracked(names: readonly string[]): string {
  const list = names.map((n) => n.toLowerCase())
  const last = list[list.length - 1]
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${last}` : last
  const plural = list.length > 1 || last.endsWith('s')
  return `Your ${joined} ${plural ? 'were' : 'was'} out of frame — step back so the camera can see ${plural ? 'them' : 'it'}.`
}

function signedPoints(points: number): string {
  return `${points > 0 ? '+' : ''}${points}`
}

/** Motion / framing change since last time, when either attempt had that problem. */
function describeEvidenceChange(attempt: AttemptSummary, previous: AttemptSummary): string {
  const now = diagnoseAttempt(attempt)
  const before = diagnoseAttempt(previous)
  const motionNow = finiteOrNull(attempt.motionMatch)
  const motionBefore = finiteOrNull(previous.motionMatch)
  if (motionNow !== null && motionBefore !== null && (now.lowMotion || before.lowMotion)) {
    return ` Motion match ${pct(motionBefore)}% → ${pct(motionNow)}%.`
  }
  const coverageNow = finiteOrNull(attempt.coverage)
  const coverageBefore = finiteOrNull(previous.coverage)
  if (coverageNow !== null && coverageBefore !== null && (now.lowCoverage || before.lowCoverage)) {
    return ` In frame for ${pct(coverageBefore)}% → ${pct(coverageNow)}% of the song.`
  }
  return ''
}

function describeImprovement(
  attempt: AttemptSummary | undefined,
  previous: AttemptSummary,
  drilled: CoachSectionScore | null,
): string {
  const now = pct(attempt?.overallScore ?? 0)
  const before = pct(previous.overallScore)
  const delta = now - before
  let text: string
  if (delta > 0) text = `Up ${delta} points from your last try (${before}% → ${now}%)!`
  else if (delta < 0) text = `Down ${-delta} points from your last try (${before}% → ${now}%) — totally normal while you're learning.`
  else text = `Same overall score as your last try (${now}%).`

  if (drilled) {
    const match = validSections(previous.sectionScores)
      .find((s) => Math.abs(s.startTime - drilled.startTime) < 0.5)
    if (match) {
      const sectionDelta = pct(drilled.score) - pct(match.score)
      text += ` ${secs(drilled.startTime)}–${secs(drilled.endTime)} went ${pct(match.score)}% → ${pct(drilled.score)}% (${signedPoints(sectionDelta)}).`
    }
  }
  if (attempt) text += describeEvidenceChange(attempt, previous)
  return text
}

function describeHostGap(attemptScore: number, hostScore: number, hostName: string): string {
  const gap = pct(hostScore) - pct(attemptScore)
  if (gap > 0) return `${hostName} is ${gap} points ahead — nail this drill and you can close the gap!`
  if (gap < 0) return `You're ${-gap} points ahead of ${hostName} — keep it locked in!`
  return `Dead even with ${hostName} — one clean run of this drill tips it your way!`
}

/**
 * Deterministic built-in coach. Priorities match the Claude prompt:
 *  1. Low coverage / low motion match is THE problem: name it, loop the weakest
 *     section (for a still or out-of-frame player that is where the dancer moves
 *     most) at 0.5x with a keep-moving / stay-in-frame cue.
 *  2. Untracked body parts are never coached: drill the weakest TRACKED part
 *     and tell the player to step back.
 *  3. Otherwise weakest section + weakest body part -> technique plan.
 * The result is already sanitized (sanitizeCoachPlan returns it unchanged).
 */
export function buildFallbackPlan(req: CoachRequest): CoachPlan {
  const attempt = req.attempt
  const sections = validSections(attempt?.sectionScores)
  const weakest = findWeakestSection(sections)
  const diagnosis = diagnoseAttempt(attempt)
  const movementFirst = diagnosis.primaryProblem !== 'technique'
  const bodyPart = findWeakestTrackedBodyPart(attempt)
  const overall = clamp01(attempt?.overallScore ?? 0)
  const drillScore = weakest ? weakest.score : overall

  const duration = resolveDuration(req.durationSeconds, sections)
  const [startTime, endTime] = weakest
    ? fitWindow(weakest.startTime, weakest.endTime, duration)
    : fitWindow(0, Math.min(duration, DEFAULT_DRILL_SECONDS), duration)

  const player = cleanText(req.playerName, 40)
  const rank = attempt?.rank ? ` (rank ${attempt.rank})` : ''
  let summary = `${player ? `${player}, you` : 'You'} scored ${pct(overall)}%${rank}.`
  if (movementFirst) {
    summary += ` ${describeMovementProblem(attempt, diagnosis)}`
  } else {
    if (weakest) summary += ` Your toughest stretch was ${secs(weakest.startTime)}–${secs(weakest.endTime)} at ${pct(weakest.score)}%`
    if (weakest && bodyPart) summary += `, and ${bodyPart.name} (${pct(bodyPart.score)}%) have the most room to grow.`
    else if (weakest) summary += '.'
    else if (bodyPart) summary += ` ${bodyPart.name} (${pct(bodyPart.score)}%) have the most room to grow.`
  }
  if (diagnosis.untrackedBodyParts.length > 0) summary += ` ${describeUntracked(diagnosis.untrackedBodyParts)}`

  const hostName = cleanText(req.hostName, 40) || 'The host'
  const hostScore = finiteOrNull(req.hostScore)
  let encouragement: string
  if (hostScore !== null) encouragement = describeHostGap(overall, hostScore, hostName)
  else if (movementFirst) encouragement = 'Big moves first, polish later — dance the whole song and watch your score climb!'
  else encouragement = 'Slow it down, nail it, then bring it back to full speed — you\'ve got this!'

  const fallbackFocus = movementFirst ? 'Movement' : 'Timing'
  const raw: CoachPlan = {
    summary,
    focus: `${bodyPart ? bodyPart.name : fallbackFocus} · ${secs(startTime)}–${secs(endTime)}`,
    startTime,
    endTime,
    playbackSpeed: movementFirst ? 0.5 : speedForScore(drillScore),
    repeats: repeatsForScore(drillScore),
    cue: movementFirst ? movementCue(diagnosis, bodyPart?.name) : cueForBodyPart(bodyPart?.name),
    encouragement,
  }
  if (req.previousAttempt) raw.improvement = describeImprovement(attempt, req.previousAttempt, weakest)

  return sanitizeCoachPlan(raw, duration, sections)
}

/**
 * Server-side battle decision. marginPoints = challenger - host in percentage
 * points rounded to 1 decimal; |margin| < 0.5 is a tie.
 */
export function decideBattle(
  host: BattleContender,
  challenger: BattleContender,
): Pick<BattleVerdict, 'winner' | 'marginPoints'> {
  const hostScore = clamp01(host?.score)
  const challengerScore = clamp01(challenger?.score)
  // "+ 0" turns -0 into 0.
  const marginPoints = Math.round((challengerScore - hostScore) * 1000) / 10 + 0
  if (Math.abs(marginPoints) < TIE_THRESHOLD_POINTS) return { winner: 'tie', marginPoints }
  return { winner: marginPoints > 0 ? 'challenger' : 'host', marginPoints }
}

function contenderName(c: BattleContender | undefined, fallback: string): string {
  return cleanText(c?.name, 40) || fallback
}

function pts(margin: number): string {
  const abs = Math.abs(margin)
  return `${abs.toFixed(1)} ${abs === 1 ? 'point' : 'points'}`
}

/** Fun but kind announcer verdict built only from the scores. */
export function buildFallbackVerdict(req: BattleRequest): BattleVerdict {
  const { winner, marginPoints } = decideBattle(req.host, req.challenger)
  const host = contenderName(req.host, 'The host')
  const challenger = contenderName(req.challenger, 'The challenger')
  const hostPct = pct(req.host?.score)
  const challengerPct = pct(req.challenger?.score)
  // Out-of-frame parts were never really scored: don't praise or blame them.
  const untracked = new Set(untrackedNames(req.challenger).map((n) => n.toLowerCase()))
  const trackedParts = validBodyParts(req.challenger?.bodyPartScores).filter((p) => !untracked.has(p.name.toLowerCase()))
  const strongest = findStrongestBodyPart(trackedParts)
  const weakest = findWeakestBodyPart(trackedParts)
  const diagnosis = diagnoseAttempt(req.challenger)

  let headline: string
  let commentary: string
  if (winner === 'challenger') {
    headline = `${challenger} beats ${host}!`
    commentary = `${challenger} takes it by ${pts(marginPoints)} (${challengerPct}% vs ${hostPct}%).`
    if (strongest) commentary += ` Those ${strongest.name} at ${pct(strongest.score)}% were on fire.`
    commentary += ` ${host}, the rematch is officially on!`
  } else if (winner === 'host') {
    headline = `${host} holds the crown!`
    commentary = `${host} keeps the title by ${pts(marginPoints)} (${hostPct}% vs ${challengerPct}%).`
    if (diagnosis.lowCoverage) commentary += ` ${challenger}, stay in frame for the whole song — that's where the missing points are!`
    else if (diagnosis.lowMotion) commentary += ` ${challenger}, keep moving with the dancer all the way through and come back swinging!`
    else if (weakest) commentary += ` ${challenger}, sharpen those ${weakest.name} (${pct(weakest.score)}%) and come back swinging!`
    else commentary += ` ${challenger}, one more practice loop and you're right there!`
  } else {
    headline = `Dead heat! ${challenger} and ${host} are neck and neck!`
    commentary = `Only ${pts(marginPoints)} between them (${challengerPct}% vs ${hostPct}%) — too close to call.`
    if (strongest) commentary += ` ${challenger}'s ${strongest.name} (${pct(strongest.score)}%) kept it tight.`
    commentary += ' Tiebreaker dance, anyone?'
  }

  return {
    winner,
    marginPoints,
    headline: cleanText(headline, COACH_TEXT_LIMITS.headline),
    commentary: cleanText(commentary, COACH_TEXT_LIMITS.commentary),
  }
}

/**
 * Repair a model-written verdict: winner/marginPoints ALWAYS come from
 * decideBattle; headline/commentary are trimmed + capped, with the built-in
 * announcer text when missing.
 */
export function sanitizeBattleVerdict(raw: unknown, req: BattleRequest): BattleVerdict {
  const input = isRecord(raw) ? raw : {}
  const fallback = buildFallbackVerdict(req)
  return {
    winner: fallback.winner,
    marginPoints: fallback.marginPoints,
    headline: cleanText(input.headline, COACH_TEXT_LIMITS.headline) || fallback.headline,
    commentary: cleanText(input.commentary, COACH_TEXT_LIMITS.commentary) || fallback.commentary,
  }
}
