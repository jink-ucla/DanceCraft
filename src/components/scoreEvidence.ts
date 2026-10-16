/**
 * "Why this score" — the honest scorer's evidence (src/scoring/honest.ts) for
 * the results screen and the coach request. Every field is optional: legacy
 * DTW results, older arena attempts and hand-made mocks may carry none of it.
 */
import type { AttemptSummary } from '../coach/types'
import type { BodyPartScore, DTWResult } from '../scoring/dtw'

/** Optional evidence fields (HonestResult / AttemptSummary). */
export interface ScoreEvidence {
  /** Share of the song (0-1) where the user was tracked at all. */
  coverage?: number
  /** Mean motion match (0-1) where the reference moves. */
  motionMatch?: number
  /** Global latency compensation applied (ms). */
  latencyMs?: number
  /** The user danced mirror-style (their left = the dancer's right). */
  mirrored?: boolean
  /** Body parts that were out of frame for most of the dance. */
  untrackedBodyParts?: string[]
  /** Plain-language scorer explanations of the biggest penalties. */
  notes?: string[]
}

/** A body part score that may say whether the part was in frame at all. */
export type EvidenceBodyPartScore = BodyPartScore & { tracked?: boolean }

/** A DTWResult plus optional evidence; a HonestResult fits as-is. */
export type ScoredResult = Omit<DTWResult, 'bodyPartScores'> & ScoreEvidence & {
  bodyPartScores: EvidenceBodyPartScore[]
}

/** Anything with attempt scores and (maybe) evidence: ScoredResult or AttemptSummary. */
export type AttemptLike = Pick<AttemptSummary, 'overallScore' | 'rank' | 'sectionScores'> & ScoreEvidence & {
  bodyPartScores: EvidenceBodyPartScore[]
}

// Kept within the server's request bounds (server/coach/schemas.ts) so a
// sanitized attempt can never be rejected with a 400.
export const MAX_EVIDENCE_NOTES = 6
export const MAX_EVIDENCE_NOTE_CHARS = 200
export const MAX_UNTRACKED_PARTS = 4
const MAX_PART_NAME_CHARS = 20
const MAX_LATENCY_MS = 2000

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function capText(value: string, maxChars: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1).trimEnd()}…` : trimmed
}

/** Untracked part names from bodyPartScores[i].tracked === false plus any explicit list. */
function untrackedParts(source: Partial<AttemptLike>): string[] {
  const names: string[] = []
  for (const part of Array.isArray(source.bodyPartScores) ? source.bodyPartScores : []) {
    if (part && part.tracked === false && typeof part.name === 'string') names.push(part.name)
  }
  for (const name of Array.isArray(source.untrackedBodyParts) ? source.untrackedBodyParts : []) {
    if (typeof name === 'string') names.push(name)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = capText(raw, MAX_PART_NAME_CHARS)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= MAX_UNTRACKED_PARTS) break
  }
  return out
}

/**
 * Sanitized evidence fields only (absent / invalid fields are omitted):
 * scores clamped to 0-1, latency to 0-2000 ms, at most 6 notes of 200 chars
 * and 4 untracked part names of 20 chars.
 */
export function extractEvidence(source: Partial<AttemptLike>): ScoreEvidence {
  const out: ScoreEvidence = {}
  if (isFiniteNumber(source.coverage)) out.coverage = clamp(source.coverage, 0, 1)
  if (isFiniteNumber(source.motionMatch)) out.motionMatch = clamp(source.motionMatch, 0, 1)
  if (isFiniteNumber(source.latencyMs)) out.latencyMs = Math.round(clamp(source.latencyMs, 0, MAX_LATENCY_MS))
  if (typeof source.mirrored === 'boolean') out.mirrored = source.mirrored
  const untracked = untrackedParts(source)
  if (untracked.length > 0) out.untrackedBodyParts = untracked
  if (Array.isArray(source.notes)) {
    const notes = source.notes
      .filter((n): n is string => typeof n === 'string')
      .map((n) => capText(n, MAX_EVIDENCE_NOTE_CHARS))
      .filter((n) => n.length > 0)
      .slice(0, MAX_EVIDENCE_NOTES)
    if (notes.length > 0) out.notes = notes
  }
  return out
}

/**
 * The coach-facing AttemptSummary: plain scores (no alignment array, no
 * per-part `tracked` flag) plus the sanitized evidence fields.
 */
export function toCoachAttempt(a: AttemptLike): AttemptSummary {
  return {
    overallScore: a.overallScore,
    rank: a.rank,
    sectionScores: (a.sectionScores ?? []).map(({ startTime, endTime, score }) => ({ startTime, endTime, score })),
    bodyPartScores: (a.bodyPartScores ?? []).map(({ name, score }) => ({ name, score })),
    ...extractEvidence(a),
  }
}

/** True when the body part was out of frame (greyed "out of frame" bar, not a red 0%). */
export function isOutOfFrame(part: EvidenceBodyPartScore, evidence: ScoreEvidence): boolean {
  if (part.tracked === false) return true
  const name = part.name.toLowerCase()
  return (evidence.untrackedBodyParts ?? []).some((n) => n.toLowerCase() === name)
}

export type EvidenceTone = 'good' | 'warn' | 'bad' | 'info'

export interface EvidenceMeter {
  id: 'coverage' | 'motion'
  label: string
  /** 0-1 */
  value: number
  tone: EvidenceTone
  hint: string
}

export interface EvidenceChip {
  id: 'latency' | 'mirrored'
  label: string
  tone: EvidenceTone
  hint: string
}

export interface EvidenceView {
  meters: EvidenceMeter[]
  chips: EvidenceChip[]
  tips: string[]
}

function pct(v: number): number {
  return Math.round(v * 100)
}

function tone(v: number, good: number, warn: number): EvidenceTone {
  if (v >= good) return 'good'
  if (v >= warn) return 'warn'
  return 'bad'
}

/** Display model for the "Why this score?" block; empty lists when there is no evidence. */
export function describeEvidence(evidence: ScoreEvidence): EvidenceView {
  const meters: EvidenceMeter[] = []
  const chips: EvidenceChip[] = []

  if (evidence.coverage !== undefined) {
    meters.push({
      id: 'coverage',
      label: `Tracked ${pct(evidence.coverage)}% of the song`,
      value: evidence.coverage,
      tone: tone(evidence.coverage, 0.8, 0.5),
      hint: 'Share of the song where the camera could see you. Moments you were not tracked score 0.',
    })
  }
  if (evidence.motionMatch !== undefined) {
    meters.push({
      id: 'motion',
      label: `Moving with the dance: ${pct(evidence.motionMatch)}%`,
      value: evidence.motionMatch,
      tone: tone(evidence.motionMatch, 0.6, 0.35),
      hint: "How well your movement matched the dancer's movement while they move. Holding a pose or standing still keeps this low.",
    })
  }
  if (evidence.latencyMs !== undefined) {
    chips.push(evidence.latencyMs > 0
      ? {
        id: 'latency',
        label: `Latency compensated: ${evidence.latencyMs} ms`,
        tone: evidence.latencyMs >= 300 ? 'warn' : 'info',
        hint: `Your moves were compared ${evidence.latencyMs} ms later than the video to allow for camera and reaction lag — no penalty.`,
      }
      : {
        id: 'latency',
        label: 'No latency compensation needed',
        tone: 'good',
        hint: 'Your moves lined up with the video without any time shift.',
      })
  }
  if (evidence.mirrored) {
    chips.push({
      id: 'mirrored',
      label: 'Mirror-style detected',
      tone: 'info',
      hint: "You danced like a mirror (your left = the dancer's right). We scored it that way — no penalty.",
    })
  }

  return { meters, chips, tips: evidence.notes ?? [] }
}
