/**
 * Browser client for the DanceCraft coach API (server/routes/coach.ts).
 *
 * Every call degrades gracefully: if the server is down, slow, returns a
 * non-2xx status or malformed JSON, we fall back to the deterministic
 * built-in coach from src/coach/plan.ts so the results screen always has a
 * plan to show. Aborts (component unmount / "Ask again") are re-thrown as
 * AbortError and never converted into fallbacks.
 */
import type {
  BattleRequest,
  BattleResponse,
  BattleVerdict,
  CoachRequest,
  CoachResponse,
  CoachStatus,
} from '../coach/types'
import {
  buildFallbackPlan,
  buildFallbackVerdict,
  decideBattle,
  sanitizeBattleVerdict,
  sanitizeCoachPlan,
} from '../coach/plan'

/** Backend origin. Override with VITE_API_BASE (e.g. to run beside another checkout on 3001). */
export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

export const COACH_FALLBACK_WARNING = 'Coach server unreachable — using built-in coach'

/** Client-side ceiling so a hung server never leaves the coach spinning forever. */
const PLAN_TIMEOUT_MS = 45_000
const BATTLE_TIMEOUT_MS = 45_000
const STATUS_TIMEOUT_MS = 5_000

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function abortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const err = new Error('The operation was aborted.')
  err.name = 'AbortError'
  return err
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1).trimEnd()}…` : trimmed
}

/**
 * fetch() + JSON parse with a timeout linked to the caller's signal.
 * Resolves to the parsed body, or throws:
 *   - AbortError when the CALLER aborted (must propagate)
 *   - anything else (network error, timeout, non-2xx, bad JSON) -> caller falls back
 */
async function fetchJson(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) throw abortError()

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal })
    if (!res.ok) throw new Error(`Coach API ${path} responded ${res.status}`)
    return await res.json()
  } catch (err) {
    if (signal?.aborted) throw abortError()
    // Our own timeout also surfaces as an AbortError — that one is a fallback case.
    if (isAbortError(err)) throw new Error(`Coach API ${path} timed out`, { cause: err })
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** GET /api/coach/status. Null when the server is unreachable or replies with junk. */
export async function fetchCoachStatus(signal?: AbortSignal): Promise<CoachStatus | null> {
  try {
    const data = await fetchJson('/api/coach/status', { method: 'GET' }, STATUS_TIMEOUT_MS, signal)
    if (!isRecord(data) || typeof data.claudeEnabled !== 'boolean') return null
    return {
      claudeEnabled: data.claudeEnabled,
      model: typeof data.model === 'string' ? data.model : '',
    }
  } catch (err) {
    if (isAbortError(err)) throw err
    return null
  }
}

/** Deterministic plan used whenever the server can't give us one. */
export function fallbackCoachResponse(req: CoachRequest, warning = COACH_FALLBACK_WARNING): CoachResponse {
  return {
    plan: sanitizeCoachPlan(buildFallbackPlan(req), req.durationSeconds, req.attempt.sectionScores),
    source: 'fallback',
    warning,
  }
}

/** POST /api/coach — personalised practice plan (always sanitised client-side too). */
export async function requestCoachPlan(req: CoachRequest, signal?: AbortSignal): Promise<CoachResponse> {
  let data: unknown
  try {
    data = await fetchJson('/api/coach', postInit(req), PLAN_TIMEOUT_MS, signal)
  } catch (err) {
    if (isAbortError(err)) throw err
    return fallbackCoachResponse(req)
  }

  if (!isRecord(data) || !isRecord(data.plan)) return fallbackCoachResponse(req)

  const source = data.source === 'claude' ? 'claude' : 'fallback'
  const response: CoachResponse = {
    plan: sanitizeCoachPlan(data.plan, req.durationSeconds, req.attempt.sectionScores),
    source,
  }
  const model = cleanString(data.model, 80)
  if (model) response.model = model
  const warning = cleanString(data.warning, 300)
  if (warning) response.warning = warning
  return response
}

/** Deterministic verdict used whenever the server can't give us one. */
export function fallbackBattleResponse(req: BattleRequest, warning = COACH_FALLBACK_WARNING): BattleResponse {
  return {
    verdict: { ...buildFallbackVerdict(req), ...decideBattle(req.host, req.challenger) },
    source: 'fallback',
    warning,
  }
}

/**
 * POST /api/coach/battle — "Beat the host" verdict + commentary.
 * The winner and margin are ALWAYS recomputed from the scores client-side;
 * the server/model only contributes the words.
 */
export async function requestBattleVerdict(req: BattleRequest, signal?: AbortSignal): Promise<BattleResponse> {
  let data: unknown
  try {
    data = await fetchJson('/api/coach/battle', postInit(req), BATTLE_TIMEOUT_MS, signal)
  } catch (err) {
    if (isAbortError(err)) throw err
    return fallbackBattleResponse(req)
  }

  if (!isRecord(data) || !isRecord(data.verdict)) return fallbackBattleResponse(req)

  // Text is trimmed/capped (built-in announcer fills gaps); the winner and
  // margin are re-decided from the scores no matter what the server said.
  const verdict: BattleVerdict = {
    ...sanitizeBattleVerdict(data.verdict, req),
    ...decideBattle(req.host, req.challenger),
  }

  const response: BattleResponse = {
    verdict,
    source: data.source === 'claude' ? 'claude' : 'fallback',
  }
  const model = cleanString(data.model, 80)
  if (model) response.model = model
  const warning = cleanString(data.warning, 300)
  if (warning) response.warning = warning
  return response
}
