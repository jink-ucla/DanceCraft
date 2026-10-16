/**
 * Claude-backed coach. Every path ends in a valid response: when Claude is not
 * configured, offline, erroring, refusing or returning junk we fall back to
 * the deterministic built-in coach from src/coach/plan.ts.
 *
 * Env is read at REQUEST time (server/app.ts runs dotenv.config() on import),
 * and the SDK client is created lazily on first use.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type {
  BattleResponse,
  CoachPlan,
  CoachRequest,
  CoachResponse,
  CoachStatus,
} from '../../src/coach/types.ts'
import {
  buildFallbackPlan,
  buildFallbackVerdict,
  decideBattle,
  diagnoseAttempt,
  sanitizeBattleVerdict,
  sanitizeCoachPlan,
} from '../../src/coach/plan.ts'
import {
  BATTLE_SYSTEM_PROMPT,
  COACH_SYSTEM_PROMPT,
  buildBattleUserContent,
  buildCoachUserContent,
} from './prompts.ts'
import type { EvidenceBattleRequest } from './schemas.ts'

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'
export const COACH_EFFORTS = ['low', 'medium', 'high'] as const
export type CoachEffort = (typeof COACH_EFFORTS)[number]

const MAX_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 20_000

export const COACH_WARNINGS = {
  noKey: 'Claude API key not configured — using built-in coach',
  offline: 'Coach offline mode is on (COACH_OFFLINE=1) — using built-in coach',
  refusal: 'Claude declined this request — using built-in coach',
  empty: 'Claude returned no usable answer — using built-in coach',
  auth: 'Claude rejected the API key — using built-in coach',
  rateLimit: 'Claude is busy right now (rate limited) — using built-in coach',
  timeout: 'Claude took too long to answer — using built-in coach',
  aborted: 'Request was cancelled — using built-in coach',
  connection: 'Could not reach Claude — using built-in coach',
  api: 'Claude API error — using built-in coach',
  unexpected: 'Claude returned an unexpected response — using built-in coach',
  internal: 'Coach error — using built-in coach',
} as const

export interface CoachConfig {
  /** ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set (non-empty). */
  hasCredentials: boolean
  /** COACH_OFFLINE=1 forces the built-in coach. */
  offline: boolean
  /** Claude will actually be called. */
  enabled: boolean
  model: string
  effort: CoachEffort
}

function envValue(name: string): string {
  return (process.env[name] ?? '').trim()
}

/** Snapshot of the coach env vars (read on every request, never cached). */
export function readCoachConfig(): CoachConfig {
  const hasCredentials = Boolean(envValue('ANTHROPIC_API_KEY') || envValue('ANTHROPIC_AUTH_TOKEN'))
  const offlineFlag = envValue('COACH_OFFLINE').toLowerCase()
  const offline = offlineFlag === '1' || offlineFlag === 'true'
  // COACH_* names avoid Claude Code's own env (it exports CLAUDE_EFFORT to child
  // processes, which would silently override .env). CLAUDE_MODEL kept as an alias.
  const model = (envValue('COACH_MODEL') || envValue('CLAUDE_MODEL')).slice(0, 100) || DEFAULT_CLAUDE_MODEL
  const effortValue = envValue('COACH_EFFORT').toLowerCase()
  const effort = (COACH_EFFORTS as readonly string[]).includes(effortValue) ? effortValue as CoachEffort : 'low'
  return { hasCredentials, offline, enabled: hasCredentials && !offline, model, effort }
}

export function getCoachStatus(): CoachStatus {
  const config = readCoachConfig()
  return { claudeEnabled: config.enabled, model: config.model }
}

// ---------------------------------------------------------------------------
// Structured-output schemas sent to Claude. Deliberately loose (no numeric
// bounds): sanitizeCoachPlan / sanitizeBattleVerdict enforce every bound.
// ---------------------------------------------------------------------------

export const LlmPlanSchema = z.object({
  summary: z.string().describe('1-2 sentences reading the attempt, grounded in the scores'),
  focus: z.string().describe('Short drill label, e.g. "Arms · 10s–20s"'),
  startTime: z.number().describe('Drill loop start, seconds'),
  endTime: z.number().describe('Drill loop end, seconds'),
  playbackSpeed: z.number().describe('0.5, 0.75 or 1'),
  repeats: z.number().describe('Loop count, whole number 2-5'),
  cue: z.string().describe('One concrete physical instruction for the weakest body part'),
  improvement: z.string().describe('Comparison with previousAttempt; only when it was provided').optional(),
  encouragement: z.string().describe('Short hype line, about beating the host when provided').optional(),
})

export const LlmVerdictSchema = z.object({
  headline: z.string().describe('Announcer headline, at most 80 characters'),
  commentary: z.string().describe('2-3 sentences, at most 300 characters'),
})

// ---------------------------------------------------------------------------
// Client (lazy, cached per credential so a changed env gets a fresh client)
// ---------------------------------------------------------------------------

let cached: { key: string; client: Anthropic } | null = null

function getClient(): Anthropic {
  const apiKey = envValue('ANTHROPIC_API_KEY') || null
  const authToken = envValue('ANTHROPIC_AUTH_TOKEN') || null
  const key = `${apiKey ?? ''}\n${authToken ?? ''}`
  if (!cached || cached.key !== key) {
    cached = { key, client: new Anthropic({ apiKey, authToken }) }
  }
  return cached.client
}

/** Drop the cached SDK client (tests / credential rotation). */
export function resetCoachClient(): void {
  cached = null
}

/** Map an SDK error to a short, secret-free warning (most specific first). */
export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return COACH_WARNINGS.auth
  if (err instanceof Anthropic.RateLimitError) return COACH_WARNINGS.rateLimit
  if (err instanceof Anthropic.APIConnectionTimeoutError) return COACH_WARNINGS.timeout
  if (err instanceof Anthropic.APIConnectionError) return COACH_WARNINGS.connection
  if (err instanceof Anthropic.APIUserAbortError) return COACH_WARNINGS.aborted
  if (err instanceof Anthropic.APIError) {
    return typeof err.status === 'number'
      ? `Claude API error (${err.status}) — using built-in coach`
      : COACH_WARNINGS.api
  }
  if (err instanceof Anthropic.AnthropicError) return COACH_WARNINGS.unexpected
  return COACH_WARNINGS.internal
}

function logFailure(what: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err
  const status = err instanceof Anthropic.APIError && err.status ? ` ${err.status}` : ''
  const message = err instanceof Error ? `: ${err.message.slice(0, 200)}` : ''
  console.warn(`[coach] ${what} failed (${name}${status})${message}`)
}

type ClaudeResult = { ok: true; parsed: unknown; model: string } | { ok: false; warning: string }

async function callClaude(
  config: CoachConfig,
  what: string,
  schema: z.ZodType,
  system: string,
  userContent: string,
  signal?: AbortSignal,
): Promise<ClaudeResult> {
  try {
    const response = await getClient().beta.messages.parse({
      model: config.model,
      max_tokens: MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: config.effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: userContent }],
    }, { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1, signal })

    if (response.stop_reason === 'refusal') {
      console.warn(`[coach] ${what}: Claude declined (${response.stop_details?.category ?? 'no category'})`)
      return { ok: false, warning: COACH_WARNINGS.refusal }
    }
    if (response.parsed_output === null || response.parsed_output === undefined) {
      console.warn(`[coach] ${what}: no parsed output (stop_reason ${response.stop_reason})`)
      return { ok: false, warning: COACH_WARNINGS.empty }
    }
    return { ok: true, parsed: response.parsed_output, model: response.model || config.model }
  } catch (err) {
    logFailure(what, err)
    return { ok: false, warning: describeClaudeError(err) }
  }
}

// ---------------------------------------------------------------------------
// Public entry points (never throw for Claude problems)
// ---------------------------------------------------------------------------

export async function generateCoachPlan(req: CoachRequest, signal?: AbortSignal): Promise<CoachResponse> {
  const config = readCoachConfig()
  const fallback = (warning: string): CoachResponse => ({ plan: buildFallbackPlan(req), source: 'fallback', warning })

  if (config.offline) return fallback(COACH_WARNINGS.offline)
  if (!config.hasCredentials) return fallback(COACH_WARNINGS.noKey)

  const result = await callClaude(
    config, 'coach plan', LlmPlanSchema, COACH_SYSTEM_PROMPT, buildCoachUserContent(req), signal,
  )
  if (!result.ok) return fallback(result.warning)

  const plan: CoachPlan = sanitizeCoachPlan(result.parsed, req.durationSeconds, req.attempt.sectionScores)
  // Rebuilding movement (low coverage / motion match) is always drilled at half speed.
  if (diagnoseAttempt(req.attempt).primaryProblem !== 'technique') plan.playbackSpeed = 0.5
  // "improvement" only makes sense with a previous attempt; fill gaps from the built-in coach.
  if (!req.previousAttempt) {
    delete plan.improvement
  } else if (!plan.improvement) {
    const builtIn = buildFallbackPlan(req).improvement
    if (builtIn) plan.improvement = builtIn
  }
  return { plan, source: 'claude', model: result.model }
}

export async function generateBattleVerdict(req: EvidenceBattleRequest, signal?: AbortSignal): Promise<BattleResponse> {
  const config = readCoachConfig()
  const fallback = (warning: string): BattleResponse => ({ verdict: buildFallbackVerdict(req), source: 'fallback', warning })

  if (config.offline) return fallback(COACH_WARNINGS.offline)
  if (!config.hasCredentials) return fallback(COACH_WARNINGS.noKey)

  const decided = decideBattle(req.host, req.challenger)
  const result = await callClaude(
    config, 'battle verdict', LlmVerdictSchema, BATTLE_SYSTEM_PROMPT, buildBattleUserContent(req, decided), signal,
  )
  if (!result.ok) return fallback(result.warning)

  // Winner + margin are ALWAYS the server's decision, whatever the model wrote.
  return {
    verdict: { ...sanitizeBattleVerdict(result.parsed, req), ...decided },
    source: 'claude',
    model: result.model,
  }
}
