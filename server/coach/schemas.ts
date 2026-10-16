/**
 * Request-body validation for the coach API (zod). Bounds keep prompts small
 * and reject garbage before it reaches Claude.
 */
import { z } from 'zod'
import type {
  AttemptSummary,
  BattleContender,
  BattleRequest,
  CoachRequest,
} from '../../src/coach/types.ts'

export const MAX_ITEMS = 200
export const MAX_TEXT = 200
export const MAX_NAME = 40
export const MAX_DURATION_SECONDS = 3600
/** Honest-scoring evidence bounds (src/scoring/honest.ts searches 0-300 ms). */
export const MAX_LATENCY_MS = 2000
export const MAX_UNTRACKED_PARTS = 4
export const MAX_PART_NAME = 20
export const MAX_NOTES = 8
export const MAX_NOTE = 240
/** Section boundaries may run slightly past the reference duration. */
const MAX_SECTION_TIME = MAX_DURATION_SECONDS * 2

const score = z.number().min(0).max(1)
const name = z.string().trim().max(MAX_NAME)
const text = z.string().trim().max(MAX_TEXT)
const rank = z.enum(['S', 'A', 'B', 'C'])
const seconds = z.number().min(0).max(MAX_SECTION_TIME)

const sectionScore = z.object({
  startTime: seconds,
  endTime: seconds,
  score,
})

const bodyPartScore = z.object({
  name,
  score,
})

const untrackedBodyParts = z.array(z.string().trim().max(MAX_PART_NAME)).max(MAX_UNTRACKED_PARTS)
const notes = z.array(z.string().trim().max(MAX_NOTE)).max(MAX_NOTES)

const attemptSummary = z.object({
  overallScore: score,
  rank,
  sectionScores: z.array(sectionScore).max(MAX_ITEMS),
  bodyPartScores: z.array(bodyPartScore).max(MAX_ITEMS),
  // Optional honest-scoring evidence (AttemptSummary in src/coach/types.ts).
  coverage: score.nullish(),
  motionMatch: score.nullish(),
  latencyMs: z.number().min(0).max(MAX_LATENCY_MS).nullish(),
  mirrored: z.boolean().nullish(),
  untrackedBodyParts: untrackedBodyParts.nullish(),
  notes: notes.nullish(),
})

export const CoachRequestSchema = z.object({
  danceTitle: text,
  durationSeconds: z.number().gt(0).max(MAX_DURATION_SECONDS),
  playerName: name.nullish(),
  attempt: attemptSummary,
  previousAttempt: attemptSummary.nullish(),
  hostName: name.nullish(),
  hostScore: score.nullish(),
})

const battleContender = z.object({
  name,
  score,
  rank: rank.nullish(),
  sectionScores: z.array(sectionScore).max(MAX_ITEMS).nullish(),
  bodyPartScores: z.array(bodyPartScore).max(MAX_ITEMS).nullish(),
  coverage: score.nullish(),
  motionMatch: score.nullish(),
  untrackedBodyParts: untrackedBodyParts.nullish(),
})

export const BattleRequestSchema = z.object({
  danceTitle: text,
  host: battleContender,
  challenger: battleContender,
  leaderboard: z.array(z.object({ name, score })).max(MAX_ITEMS).nullish(),
})

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Battle contender plus the optional scorer evidence the battle prompt can use.
 * Server-side extension: BattleContender (src/coach/types.ts) does not declare
 * these yet, so any BattleRequest is also a valid EvidenceBattleRequest.
 */
export type EvidenceBattleContender = BattleContender & Pick<AttemptSummary, 'coverage' | 'motionMatch' | 'untrackedBodyParts'>
export interface EvidenceBattleRequest extends BattleRequest {
  host: EvidenceBattleContender
  challenger: EvidenceBattleContender
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid request body'
  const path = issue.path.map(String).join('.')
  return `Invalid request body${path ? ` at ${path}` : ''}: ${issue.message}`.slice(0, MAX_TEXT)
}

/** Drop empty strings (after trimming) from a validated string list. */
function nonEmpty(list: string[]): string[] {
  return list.filter((item) => item !== '')
}

function toAttempt(a: z.infer<typeof attemptSummary>): AttemptSummary {
  const out: AttemptSummary = {
    overallScore: a.overallScore,
    rank: a.rank,
    sectionScores: a.sectionScores,
    bodyPartScores: a.bodyPartScores,
  }
  if (a.coverage != null) out.coverage = a.coverage
  if (a.motionMatch != null) out.motionMatch = a.motionMatch
  if (a.latencyMs != null) out.latencyMs = a.latencyMs
  if (a.mirrored != null) out.mirrored = a.mirrored
  if (a.untrackedBodyParts != null) out.untrackedBodyParts = nonEmpty(a.untrackedBodyParts)
  if (a.notes != null) out.notes = nonEmpty(a.notes)
  return out
}

function toContender(c: z.infer<typeof battleContender>): EvidenceBattleContender {
  const out: EvidenceBattleContender = { name: c.name, score: c.score }
  if (c.rank != null) out.rank = c.rank
  if (c.sectionScores != null) out.sectionScores = c.sectionScores
  if (c.bodyPartScores != null) out.bodyPartScores = c.bodyPartScores
  if (c.coverage != null) out.coverage = c.coverage
  if (c.motionMatch != null) out.motionMatch = c.motionMatch
  if (c.untrackedBodyParts != null) out.untrackedBodyParts = nonEmpty(c.untrackedBodyParts)
  return out
}

/** Validate a POST /api/coach body (null optionals are treated as absent). */
export function parseCoachRequest(body: unknown): ValidationResult<CoachRequest> {
  const result = CoachRequestSchema.safeParse(body)
  if (!result.success) return { ok: false, error: describeIssue(result.error) }
  const b = result.data
  const value: CoachRequest = {
    danceTitle: b.danceTitle,
    durationSeconds: b.durationSeconds,
    attempt: toAttempt(b.attempt),
  }
  if (b.playerName) value.playerName = b.playerName
  if (b.previousAttempt != null) value.previousAttempt = toAttempt(b.previousAttempt)
  if (b.hostName) value.hostName = b.hostName
  if (b.hostScore != null) value.hostScore = b.hostScore
  return { ok: true, value }
}

/** Validate a POST /api/coach/battle body (null optionals are treated as absent). */
export function parseBattleRequest(body: unknown): ValidationResult<EvidenceBattleRequest> {
  const result = BattleRequestSchema.safeParse(body)
  if (!result.success) return { ok: false, error: describeIssue(result.error) }
  const b = result.data
  const value: EvidenceBattleRequest = {
    danceTitle: b.danceTitle,
    host: toContender(b.host),
    challenger: toContender(b.challenger),
  }
  if (b.leaderboard != null) value.leaderboard = b.leaderboard
  return { ok: true, value }
}
