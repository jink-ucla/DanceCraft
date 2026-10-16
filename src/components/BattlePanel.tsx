import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BattleContender, BattleRequest, BattleResponse } from '../coach/types'
import { decideBattle } from '../coach/plan'
import { isAbortError, requestBattleVerdict } from '../api/coach'
import { DancingCharacter } from './DancingCharacter'
import './Coach.css'

export interface BattlePanelProps {
  danceTitle: string
  /** This attempt. name = player name (or "Challenger"); score 0-1. */
  challenger: BattleContender
  /** Host's best score (0-1) on this dance. */
  host?: { name: string; score: number } | null
  /** This attempt was recorded by the host — shows "Challenge set!" instead of a battle. */
  isHostAttempt?: boolean
  /** Top scores on this dance, best first, 0-1. */
  leaderboard?: { name: string; score: number }[]
  /** Highlights this name in the mini leaderboard. */
  playerName?: string
  className?: string
}

const REQUEST_DEBOUNCE_MS = 120

/**
 * Settled verdicts per request content (module scope, survives remounts), so
 * returning to the results screen from Replay/Practice doesn't re-judge.
 */
const verdictCache = new Map<string, BattleResponse>()
const MAX_CACHED_VERDICTS = 20

function rememberVerdict(requestJson: string, response: BattleResponse) {
  verdictCache.delete(requestJson)
  verdictCache.set(requestJson, response)
  if (verdictCache.size > MAX_CACHED_VERDICTS) {
    const oldest = verdictCache.keys().next().value
    if (oldest !== undefined) verdictCache.delete(oldest)
  }
}
const LEADERBOARD_SIZE = 5
const CONFETTI_COLORS = ['var(--accent)', 'var(--blue)', 'var(--yellow)', 'var(--red)', '#c084fc']
const CONFETTI_COUNT = 18

function toPct(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function formatMargin(points: number): string {
  const rounded = Math.round(points * 10) / 10
  if (rounded === 0) return 'Dead even'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} pts`
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

interface VerdictState {
  key: string
  response: BattleResponse | null
}

export function BattlePanel({
  danceTitle,
  challenger,
  host,
  isHostAttempt = false,
  leaderboard,
  playerName,
  className,
}: BattlePanelProps) {
  const isBattle = !!host && !isHostAttempt

  const battleRequestJson = useMemo(() => {
    if (!host || isHostAttempt) return null
    const req: BattleRequest = {
      danceTitle,
      host: { name: host.name, score: host.score },
      challenger,
      leaderboard: leaderboard && leaderboard.length > 0
        ? leaderboard.slice(0, LEADERBOARD_SIZE).map(({ name, score }) => ({ name, score }))
        : undefined,
    }
    return JSON.stringify(req)
  }, [danceTitle, host, isHostAttempt, challenger, leaderboard])

  const [verdictState, setVerdictState] = useState<VerdictState | null>(null)

  useEffect(() => {
    if (!battleRequestJson || verdictCache.has(battleRequestJson)) return
    const key = battleRequestJson
    const controller = new AbortController()
    const timer = setTimeout(() => {
      requestBattleVerdict(JSON.parse(battleRequestJson) as BattleRequest, controller.signal)
        .then((response) => {
          rememberVerdict(key, response)
          if (!controller.signal.aborted) setVerdictState({ key, response })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return
          console.error('Battle verdict failed:', err)
          setVerdictState({ key, response: null })
        })
    }, REQUEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [battleRequestJson])

  const rootClass = (extra: string) => ['battle-panel', extra, className ?? ''].filter(Boolean).join(' ')
  const board = leaderboard && leaderboard.length > 0 ? (
    <MiniLeaderboard entries={leaderboard} playerName={playerName ?? challenger.name} hostName={host?.name} />
  ) : null

  // --- Host just set (or improved) the challenge -------------------------
  if (isHostAttempt) {
    const hostName = host?.name ?? playerName ?? challenger.name
    const scoreToBeat = Math.max(challenger.score, host?.score ?? 0)
    return (
      <section className={rootClass('battle-panel--host')}>
        <div className="battle-banner battle-banner--set">Challenge set!</div>
        <div className="battle-host-set">
          <DancingCharacter character="host" size={96} className="battle-character" />
          <div>
            <p className="battle-host-set-score">
              Score to beat: <strong>{toPct(scoreToBeat)}%</strong>
            </p>
            <p className="battle-host-set-hint">
              Challengers, step up and beat {hostName}!
            </p>
          </div>
        </div>
        {board}
      </section>
    )
  }

  // --- No host score yet ---------------------------------------------------
  if (!isBattle || !host) {
    if (!board) {
      return (
        <p className={rootClass('battle-panel--empty battle-hint')}>
          Ask the host to set a challenge
        </p>
      )
    }
    return (
      <section className={rootClass('battle-panel--empty')}>
        <p className="battle-hint">Ask the host to set a challenge</p>
        {board}
      </section>
    )
  }

  // --- Challenger vs host --------------------------------------------------
  // Winner is decided locally from the scores so styling shows instantly;
  // the server only supplies the headline + commentary.
  const decided = decideBattle({ name: host.name, score: host.score }, challenger)
  const cachedVerdict = battleRequestJson ? verdictCache.get(battleRequestJson) : undefined
  const settledFresh = verdictState !== null && verdictState.key === battleRequestJson
  const settled = settledFresh || !!cachedVerdict
  const response = settledFresh ? verdictState.response : cachedVerdict ?? null
  const verdict = response?.verdict ?? null
  const winner = decided.winner
  const challengerWon = winner === 'challenger'
  const hostLabel = host.name.toUpperCase()

  return (
    <section className={rootClass(`battle-panel--battle battle-panel--${winner}`)}>
      <div className="battle-banner">BEAT {hostLabel}?</div>

      {challengerWon && <Confetti />}

      <div className="battle-versus">
        <Contender
          side="challenger"
          name={challenger.name}
          score={challenger.score}
          state={winner === 'tie' ? 'tie' : challengerWon ? 'winner' : 'loser'}
        />
        <div className="battle-vs">
          <span className="battle-vs-text">VS</span>
          <span className={`battle-margin battle-margin--${winner}`}>{formatMargin(decided.marginPoints)}</span>
        </div>
        <Contender
          side="host"
          name={host.name}
          score={host.score}
          state={winner === 'tie' ? 'tie' : challengerWon ? 'loser' : 'winner'}
        />
      </div>

      <div className="battle-verdict" aria-live="polite">
        {!settled && <p className="battle-verdict-loading">The judges are deliberating…</p>}
        {settled && verdict && (
          <>
            <p className="battle-headline">{verdict.headline}</p>
            <p className="battle-commentary">{verdict.commentary}</p>
            <span
              className={`battle-source battle-source--${response?.source ?? 'fallback'}`}
              title={response?.warning ?? undefined}
            >
              {response?.source === 'claude'
                ? `Commentary · Claude${response.model ? ` · ${response.model}` : ''}`
                : 'Commentary · Built-in'}
            </span>
          </>
        )}
        {settled && !verdict && (
          <p className="battle-headline">
            {challengerWon ? `You beat ${host.name}!` : winner === 'tie' ? 'Dead heat!' : `${host.name} holds the crown`}
          </p>
        )}
      </div>

      {board}
    </section>
  )
}

function Contender({
  side,
  name,
  score,
  state,
}: {
  side: 'challenger' | 'host'
  name: string
  score: number
  state: 'winner' | 'loser' | 'tie'
}) {
  return (
    <div className={`battle-contender battle-contender--${side} is-${state}`}>
      {state === 'winner' && <span className="battle-crown" aria-label="Winner">👑</span>}
      <DancingCharacter
        character={side}
        size={84}
        paused={state === 'loser'}
        className="battle-character"
      />
      <span className="battle-contender-role">{side === 'host' ? 'Host' : 'Challenger'}</span>
      <span className="battle-contender-name" title={name}>{name}</span>
      <span className="battle-contender-score">{toPct(score)}%</span>
    </div>
  )
}

function Confetti() {
  return (
    <div className="battle-confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
        <span
          key={i}
          className="battle-confetti-piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 6) * 0.18}s`,
            animationDuration: `${2.2 + (i % 4) * 0.35}s`,
            '--confetti-spin': `${(i * 47) % 360}deg`,
          } as CSSProperties}
        />
      ))}
    </div>
  )
}

function MiniLeaderboard({
  entries,
  playerName,
  hostName,
}: {
  entries: { name: string; score: number }[]
  playerName?: string
  hostName?: string
}) {
  const top = entries.slice(0, LEADERBOARD_SIZE)
  return (
    <div className="battle-leaderboard">
      <h4>Leaderboard</h4>
      <ol>
        {top.map((entry, i) => {
          const isPlayer = sameName(entry.name, playerName)
          const isHost = sameName(entry.name, hostName)
          return (
            <li
              key={`${i}-${entry.name}`}
              className={['battle-leaderboard-row', isPlayer ? 'is-player' : '', isHost ? 'is-host' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="battle-leaderboard-pos">{i + 1}</span>
              <span className="battle-leaderboard-name">
                {entry.name}
                {isHost && <span className="battle-tag">HOST</span>}
                {isPlayer && !isHost && <span className="battle-tag battle-tag--you">YOU</span>}
              </span>
              <span className="battle-leaderboard-score">{toPct(entry.score)}%</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
