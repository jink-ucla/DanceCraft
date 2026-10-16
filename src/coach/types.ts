/**
 * DanceCraft AI Coach — shared contract between the React client and the
 * Express coach API (server/routes/coach.ts). Pure types + constants only:
 * this file is compiled by both the browser (tsconfig.app) and the server
 * (tsconfig.server), so it must not touch DOM or Node APIs.
 *
 * All scores in this contract are 0-1 (same scale as DTWResult).
 */

/** Playback speeds supported by PracticeMode's speed buttons. */
export const COACH_SPEEDS = [0.5, 0.75, 1] as const
export type CoachSpeed = (typeof COACH_SPEEDS)[number]

/** PracticeMode refuses A/B loops shorter than this (see KeyB handler). */
export const MIN_DRILL_SECONDS = 3
export const MIN_DRILL_REPEATS = 1
export const MAX_DRILL_REPEATS = 8

export type Rank = 'S' | 'A' | 'B' | 'C'

export interface CoachSectionScore {
  startTime: number
  endTime: number
  score: number
}

export interface CoachBodyPartScore {
  name: string
  score: number
}

/** The slice of a DTWResult the coach needs (no alignment array). */
export interface AttemptSummary {
  overallScore: number
  rank: Rank
  sectionScores: CoachSectionScore[]
  bodyPartScores: CoachBodyPartScore[]
  // --- Optional honest-scoring evidence (src/scoring/honest.ts and later v3) ---
  /** Share of the dance (0-1) where the user was tracked at all. */
  coverage?: number
  /** Mean motion match (0-1) where the reference moves; low = mostly standing still. */
  motionMatch?: number
  /** Global latency compensation applied (ms). */
  latencyMs?: number
  /** User danced mirror-style (their left = the dancer's right). */
  mirrored?: boolean
  /** Body parts that were out of frame for most of the dance (e.g. ['Legs']). */
  untrackedBodyParts?: string[]
  /** Plain-language scorer explanations of the biggest penalties. */
  notes?: string[]
}

// ---------------------------------------------------------------------------
// POST /api/coach  — personalised practice plan
// ---------------------------------------------------------------------------

export interface CoachRequest {
  danceTitle: string
  /** Reference video duration in seconds (bounds startTime/endTime). */
  durationSeconds: number
  playerName?: string
  attempt: AttemptSummary
  /** Same player's previous attempt on this dance, for "did I improve?". */
  previousAttempt?: AttemptSummary
  /** "Beat Wasil" target — the host's best score on this dance. */
  hostName?: string
  hostScore?: number
}

export interface CoachPlan {
  /** 1-2 sentence read of the attempt, grounded in the actual scores. */
  summary: string
  /** Short label for what to drill, e.g. "Arms · 10s–20s". */
  focus: string
  /** Drill loop, seconds. Always within [0, durationSeconds], length >= MIN_DRILL_SECONDS. */
  startTime: number
  endTime: number
  playbackSpeed: CoachSpeed
  /** Loop count before the drill auto-stops. MIN_DRILL_REPEATS..MAX_DRILL_REPEATS. */
  repeats: number
  /** One concrete body cue to think about while drilling. */
  cue: string
  /** Comparison with previousAttempt; only present when one was sent. */
  improvement?: string
  /** Short hype line (e.g. about beating the host). */
  encouragement?: string
}

export interface CoachResponse {
  plan: CoachPlan
  /** 'fallback' = deterministic built-in coach (no API key, API error, refusal). */
  source: 'claude' | 'fallback'
  model?: string
  /** Human-readable reason when source === 'fallback'. */
  warning?: string
}

// ---------------------------------------------------------------------------
// POST /api/coach/battle  — "Beat Wasil" verdict / commentary
// ---------------------------------------------------------------------------

export interface BattleContender {
  name: string
  score: number
  rank?: Rank
  sectionScores?: CoachSectionScore[]
  bodyPartScores?: CoachBodyPartScore[]
  // --- Optional honest-scoring evidence (same meaning as on AttemptSummary) ---
  coverage?: number
  motionMatch?: number
  /** Out-of-frame parts: never praised or blamed in the commentary. */
  untrackedBodyParts?: string[]
}

export interface BattleRequest {
  danceTitle: string
  host: BattleContender
  challenger: BattleContender
  /** Optional top scores on this dance, best first. */
  leaderboard?: { name: string; score: number }[]
}

export interface BattleVerdict {
  /** Decided by the server from the scores, never by the model. */
  winner: 'host' | 'challenger' | 'tie'
  /** challenger.score - host.score, in percentage points (e.g. +4.2). */
  marginPoints: number
  /** Short announcer-style headline. */
  headline: string
  /** 2-3 sentences of playful commentary grounded in the scores. */
  commentary: string
}

export interface BattleResponse {
  verdict: BattleVerdict
  source: 'claude' | 'fallback'
  model?: string
  warning?: string
}

// ---------------------------------------------------------------------------
// GET /api/coach/status
// ---------------------------------------------------------------------------

export interface CoachStatus {
  /** True when ANTHROPIC_API_KEY (or other SDK credentials) is configured. */
  claudeEnabled: boolean
  model: string
}

// ---------------------------------------------------------------------------
// Pure helpers implemented in src/coach/plan.ts (used by server AND client):
//
//   sanitizeCoachPlan(raw: unknown, durationSeconds: number, sectionScores: CoachSectionScore[]): CoachPlan
//     Clamp/repair any model output into a valid CoachPlan (times inside the
//     video, >= MIN_DRILL_SECONDS long, speed snapped to COACH_SPEEDS,
//     repeats clamped, strings trimmed/length-capped, fallbacks for missing text).
//
//   buildFallbackPlan(req: CoachRequest): CoachPlan
//     Deterministic coach: weakest section + weakest body part -> plan.
//
//   decideBattle(host: BattleContender, challenger: BattleContender): Pick<BattleVerdict, 'winner' | 'marginPoints'>
//   buildFallbackVerdict(req: BattleRequest): BattleVerdict
// ---------------------------------------------------------------------------
