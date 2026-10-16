import { useEffect, useMemo, useState } from 'react'
import type { CoachPlan, CoachRequest, CoachResponse } from '../coach/types'
import { isAbortError, requestCoachPlan } from '../api/coach'
import { DancingCharacter } from './DancingCharacter'
import './Coach.css'

export interface CoachPanelProps {
  /** Scores + context sent to POST /api/coach. Re-requested only when its content changes. */
  request: CoachRequest
  /** Reference pose JSON URL — enables the "Here's the move" character demo. */
  poseDataUrl?: string
  /** Starts PracticeMode driven by the plan. Drill button is hidden without it. */
  onStartCoachDrill?: (plan: CoachPlan) => void
  className?: string
}

/** Small delay so StrictMode's mount/unmount/mount never fires two requests. */
const REQUEST_DEBOUNCE_MS = 120

/**
 * Latest settled response per request content, kept at module scope so it
 * survives remounts: Results -> Replay -> back (or Practice -> back) shows the
 * same plan instantly instead of asking Claude again. "Ask again" always
 * refetches and replaces the entry.
 */
const responseCache = new Map<string, CoachResponse>()
const MAX_CACHED_RESPONSES = 20

function rememberResponse(requestJson: string, response: CoachResponse) {
  responseCache.delete(requestJson)
  responseCache.set(requestJson, response)
  if (responseCache.size > MAX_CACHED_RESPONSES) {
    const oldest = responseCache.keys().next().value
    if (oldest !== undefined) responseCache.delete(oldest)
  }
}

interface CoachState {
  key: string
  response: CoachResponse | null
  error: string | null
}

function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatSpeed(speed: number): string {
  return `${speed}x`
}

export function CoachPanel({ request, poseDataUrl, onStartCoachDrill, className }: CoachPanelProps) {
  // Serialise so a parent re-render with an equal-but-new object doesn't refetch.
  const requestJson = useMemo(() => JSON.stringify(request), [request])
  const [askCount, setAskCount] = useState(0)
  const [state, setState] = useState<CoachState | null>(null)
  const currentKey = `${askCount}:${requestJson}`

  // First ask for a request we already answered (remount): reuse that answer
  const cachedResponse = askCount === 0 ? responseCache.get(requestJson) : undefined

  useEffect(() => {
    if (askCount === 0 && responseCache.has(requestJson)) return
    const key = `${askCount}:${requestJson}`
    const controller = new AbortController()
    const timer = setTimeout(() => {
      requestCoachPlan(JSON.parse(requestJson) as CoachRequest, controller.signal)
        .then((response) => {
          rememberResponse(requestJson, response)
          if (!controller.signal.aborted) setState({ key, response, error: null })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return
          console.error('Coach plan failed:', err)
          setState({ key, response: null, error: 'The coach tripped over its own feet. Try asking again.' })
        })
    }, REQUEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [askCount, requestJson])

  const settled = state !== null && state.key === currentKey
  const loading = !settled && !cachedResponse
  const response = settled ? state.response : cachedResponse ?? null
  const error = settled ? state.error : null
  const plan = response?.plan ?? null
  const prevScore = request.previousAttempt?.overallScore
  const improvementDelta = prevScore === undefined
    ? 0
    : Math.round(request.attempt.overallScore * 100) - Math.round(prevScore * 100)
  const improvementTone = improvementDelta > 0 ? 'up' : improvementDelta < 0 ? 'down' : 'flat'

  const rootClass = ['coach-panel', loading ? 'coach-panel--loading' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <section className={rootClass} aria-live="polite" aria-busy={loading}>
      <header className="coach-header">
        <div className="coach-title">
          <span className="coach-title-icon" aria-hidden="true">✦</span>
          <h3>AI Coach</h3>
        </div>
        {response && <CoachSourceBadge response={response} />}
      </header>

      {loading && (
        <div className="coach-loading">
          <DancingCharacter character="buddy" size={120} className="coach-character coach-character--idle" />
          <p className="coach-loading-text">
            Coach is analyzing your moves…
          </p>
        </div>
      )}

      {!loading && error && (
        <div className="coach-error">
          <p>{error}</p>
        </div>
      )}

      {!loading && plan && (
        <div className="coach-body">
          <div className="coach-lead">
            {poseDataUrl && (
              <div className="coach-demo">
                <DancingCharacter
                  character="buddy"
                  poseDataUrl={poseDataUrl}
                  startTime={plan.startTime}
                  endTime={plan.endTime}
                  speed={plan.playbackSpeed}
                  size={120}
                  label="Here's the move"
                  className="coach-character"
                />
              </div>
            )}
            <div className="coach-lead-text">
              <p className="coach-summary">{plan.summary}</p>
              <div className="coach-focus">
                <span className="coach-label">Focus</span>
                <span className="coach-focus-value">{plan.focus}</span>
              </div>
            </div>
          </div>

          <ul className="coach-drill-stats">
            <li>
              <span className="coach-stat-value">
                {formatSeconds(plan.startTime)}–{formatSeconds(plan.endTime)}
              </span>
              <span className="coach-stat-label">section</span>
            </li>
            <li>
              <span className="coach-stat-value">{formatSpeed(plan.playbackSpeed)}</span>
              <span className="coach-stat-label">speed</span>
            </li>
            <li>
              <span className="coach-stat-value">×{plan.repeats}</span>
              <span className="coach-stat-label">reps</span>
            </li>
          </ul>

          <p className="coach-cue">
            <span className="coach-label">Cue</span>
            {plan.cue}
          </p>

          {plan.improvement && (
            <p className={`coach-improvement coach-improvement--${improvementTone}`}>{plan.improvement}</p>
          )}
          {plan.encouragement && <p className="coach-encouragement">{plan.encouragement}</p>}
        </div>
      )}

      <div className="coach-actions">
        {plan && onStartCoachDrill && (
          <button
            type="button"
            className="coach-drill-btn"
            disabled={loading}
            onClick={() => onStartCoachDrill(plan)}
          >
            Practice this · {formatSpeed(plan.playbackSpeed)} · {plan.repeats} {plan.repeats === 1 ? 'rep' : 'reps'}
          </button>
        )}
        <button
          type="button"
          className="coach-retry-btn"
          disabled={loading}
          onClick={() => setAskCount((n) => n + 1)}
        >
          Ask again
        </button>
      </div>
    </section>
  )
}

function CoachSourceBadge({ response }: { response: CoachResponse }) {
  if (response.source === 'claude') {
    const text = response.model ? `Claude · ${response.model}` : 'Claude'
    return (
      <span className="coach-source coach-source--claude" title={response.warning ?? 'Plan written by Claude from your real scores'}>
        {text}
      </span>
    )
  }
  return (
    <span className="coach-source coach-source--fallback" title={response.warning ?? 'Deterministic built-in coach'}>
      Built-in coach
    </span>
  )
}
