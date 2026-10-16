import { useMemo } from 'react'
import type { AttemptSummary, BattleContender, CoachPlan, CoachRequest, CoachSectionScore } from '../coach/types'
import { CoachPanel } from './CoachPanel'
import { BattlePanel } from './BattlePanel'
import { describeEvidence, extractEvidence, isOutOfFrame, toCoachAttempt } from './scoreEvidence'
import type { EvidenceView, ScoredResult } from './scoreEvidence'
import './Coach.css'
import './Results.css'

interface ResultsScreenProps {
  /** DTWResult or HonestResult; the optional evidence fields feed "Why this score?". */
  result: ScoredResult
  danceName: string
  onRetry: () => void
  onHome: () => void
  /** Side-by-side replay of the recording (absent when there is no clip). */
  onReplay?: () => void
  /** Object URL of this attempt's recording (or a stand-in clip in the dev preview). */
  clipUrl?: string | null
  /** Badge on the clip, e.g. "Preview clip" when the video is not the user's recording. */
  clipLabel?: string
  /** "All clips" link: the History screen with every saved session. */
  onOpenHistory?: () => void
  danceId?: string
  /** Reference pose JSON URL — used by the coach's DancingCharacter preview. */
  poseDataUrl?: string
  /** Reference video duration (s); falls back to the last section's endTime. */
  durationSeconds?: number
  playerName?: string
  previousAttempt?: AttemptSummary | null
  /** Host's best score (0-1) on this dance. */
  host?: { name: string; score: number } | null
  /** This attempt was by the host. */
  isHostAttempt?: boolean
  /** Best first, 0-1. */
  leaderboard?: { name: string; score: number }[]
  onStartCoachDrill?: (plan: CoachPlan) => void
}

const RANK_MESSAGES: Record<string, string> = {
  S: 'Amazing! You nailed it!',
  A: 'Great job! Keep it up!',
  B: 'Nice effort! You\'re getting there!',
  C: 'Good start! Practice makes perfect!',
}

const RANK_COLORS: Record<string, string> = {
  S: '#00ff88',
  A: '#00ccff',
  B: '#ffcc00',
  C: '#ff6b6b',
}

function scoreToColor(score: number): string {
  if (score >= 0.8) return '#00ff88' // green
  if (score >= 0.6) return '#ffcc00' // yellow
  return '#ff6b6b' // red
}

/** Percentage-point difference, rounded, e.g. 0.74 vs 0.62 -> 12. */
function deltaPoints(current: number, previous: number): number {
  return Math.round(current * 100) - Math.round(previous * 100)
}

function formatDelta(points: number): string {
  if (points > 0) return `+${points}%`
  if (points < 0) return `−${Math.abs(points)}%`
  return '±0%'
}

function deltaTone(points: number): 'up' | 'down' | 'flat' {
  if (points > 0) return 'up'
  if (points < 0) return 'down'
  return 'flat'
}

/** Find the previous attempt's score for the same time window. */
function matchPreviousSection(
  section: CoachSectionScore,
  index: number,
  previous: CoachSectionScore[],
): CoachSectionScore | undefined {
  const byTime = previous.find((p) => Math.abs(p.startTime - section.startTime) < 1)
  if (byTime) return byTime
  return previous.length > index ? previous[index] : undefined
}

function weakestSectionIndex(sections: CoachSectionScore[]): number {
  if (sections.length < 2) return -1
  let worst = 0
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].score < sections[worst].score) worst = i
  }
  return worst
}

/** "Why this score?": honest-scoring evidence; renders nothing for legacy results. */
function WhyThisScore({ view }: { view: EvidenceView }) {
  if (view.meters.length === 0 && view.chips.length === 0 && view.tips.length === 0) return null
  return (
    <section className="results-why" aria-label="Why this score">
      <h3>Why this score?</h3>
      {view.meters.map((meter) => (
        <div key={meter.id} className={`results-why-meter results-why-meter--${meter.tone}`} title={meter.hint}>
          <span className="results-why-meter-label">{meter.label}</span>
          <div className="results-why-meter-track" aria-hidden="true">
            <div className="results-why-meter-fill" style={{ width: `${Math.round(meter.value * 100)}%` }} />
          </div>
        </div>
      ))}
      {view.chips.length > 0 && (
        <div className="results-why-chips">
          {view.chips.map((chip) => (
            <span key={chip.id} className={`results-why-chip results-why-chip--${chip.tone}`} title={chip.hint}>
              {chip.label}
            </span>
          ))}
        </div>
      )}
      {view.tips.length > 0 && (
        <ul className="results-why-tips">
          {view.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface ClipCardProps {
  clipUrl?: string | null
  clipLabel?: string
  onReplay?: () => void
  onOpenHistory?: () => void
}

/** This attempt's recording, right on the results screen: muted inline loop + replay button. */
function ClipCard({ clipUrl, clipLabel, onReplay, onOpenHistory }: ClipCardProps) {
  return (
    <section className="results-clip" aria-label="Your clip" data-testid="results-clip">
      <div className="results-clip-header">
        <h3>Your clip</h3>
        {onOpenHistory && (
          <button type="button" className="results-clip-all" onClick={onOpenHistory}>
            All clips
          </button>
        )}
      </div>
      {clipUrl ? (
        <div className="results-clip-frame">
          <video
            className="results-clip-video"
            src={clipUrl}
            muted
            playsInline
            controls
            loop
            preload="metadata"
          />
          {clipLabel && <span className="results-clip-badge">{clipLabel}</span>}
        </div>
      ) : (
        <p className="results-clip-empty">
          No clip was recorded this time. Allow camera access and dance to the end to get one.
        </p>
      )}
      {onReplay && (
        <button type="button" className="results-clip-replay-btn" onClick={onReplay}>
          <span aria-hidden="true">▶</span> Watch side-by-side replay
        </button>
      )}
    </section>
  )
}

export function ResultsScreen({
  result,
  danceName,
  onRetry,
  onHome,
  onReplay,
  clipUrl,
  clipLabel,
  onOpenHistory,
  danceId,
  poseDataUrl,
  durationSeconds,
  playerName,
  previousAttempt,
  host,
  isHostAttempt = false,
  leaderboard,
  onStartCoachDrill,
}: ResultsScreenProps) {
  const pct = Math.round(result.overallScore * 100)
  const sections = result.sectionScores
  const lastEnd = sections.length > 0 ? sections[sections.length - 1].endTime : 0
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : lastEnd
  const weakestIdx = weakestSectionIndex(sections)
  const weakest = weakestIdx >= 0 ? sections[weakestIdx] : null
  const overallDelta = previousAttempt ? deltaPoints(result.overallScore, previousAttempt.overallScore) : null
  const trimmedPlayer = playerName?.trim() || undefined

  // Strip the (potentially huge) alignment array — the coach needs scores + evidence.
  const attempt = useMemo(() => toCoachAttempt(result), [result])
  const evidence = useMemo(() => extractEvidence(result), [result])
  const evidenceView = useMemo(() => describeEvidence(evidence), [evidence])

  const coachRequest = useMemo<CoachRequest>(() => {
    const req: CoachRequest = {
      danceTitle: danceName,
      durationSeconds: duration,
      attempt,
    }
    if (trimmedPlayer) req.playerName = trimmedPlayer
    if (previousAttempt) req.previousAttempt = toCoachAttempt(previousAttempt)
    if (host && !isHostAttempt) {
      req.hostName = host.name
      req.hostScore = host.score
    }
    return req
  }, [danceName, duration, attempt, trimmedPlayer, previousAttempt, host, isHostAttempt])

  const challenger = useMemo<BattleContender>(() => ({
    name: trimmedPlayer ?? 'Challenger',
    score: attempt.overallScore,
    rank: attempt.rank,
    sectionScores: attempt.sectionScores,
    bodyPartScores: attempt.bodyPartScores,
    // Evidence (already sanitized by toCoachAttempt) so the announcer never blames an out-of-frame part
    ...(attempt.coverage !== undefined ? { coverage: attempt.coverage } : {}),
    ...(attempt.motionMatch !== undefined ? { motionMatch: attempt.motionMatch } : {}),
    ...(attempt.untrackedBodyParts ? { untrackedBodyParts: attempt.untrackedBodyParts } : {}),
  }), [attempt, trimmedPlayer])

  // A full battle card (host challenge or leaderboard) earns its own column on wide screens.
  const hasBattleCard = !!host || isHostAttempt || (leaderboard?.length ?? 0) > 0

  return (
    <div className="results-screen results-screen--arena" data-dance-id={danceId}>
      <div className={`results-arena-grid${hasBattleCard ? ' results-arena-grid--battle' : ''}`}>
        <div className="results-main">
          <div className="results-header">
            <h2>Dance Complete!</h2>
            <p className="results-dance-name">
              {danceName}
              {trimmedPlayer && <span className="results-player-chip">{trimmedPlayer}</span>}
              {isHostAttempt && <span className="results-player-chip results-player-chip--host">HOST RUN</span>}
            </p>
          </div>

          <div className="results-score-section">
            <div
              className="results-rank"
              style={{ color: RANK_COLORS[result.rank] }}
            >
              {result.rank}
            </div>
            <div className="results-percentage">{pct}%</div>
            {overallDelta !== null && (
              <div
                className={`results-delta results-delta--${deltaTone(overallDelta)}`}
                title={`Last try: ${Math.round((previousAttempt?.overallScore ?? 0) * 100)}%`}
              >
                {formatDelta(overallDelta)} vs last try
              </div>
            )}
            <p className="results-message">{RANK_MESSAGES[result.rank]}</p>
          </div>

          <WhyThisScore view={evidenceView} />

          {/* Timeline bar */}
          <div className="results-timeline">
            <h3>Performance Timeline</h3>
            <div className="timeline-bar">
              {sections.map((section, i) => {
                const prev = previousAttempt
                  ? matchPreviousSection(section, i, previousAttempt.sectionScores)
                  : undefined
                const sectionDelta = prev ? deltaPoints(section.score, prev.score) : null
                const isWeakest = i === weakestIdx
                let title = `${Math.round(section.startTime)}s - ${Math.round(section.endTime)}s: ${Math.round(section.score * 100)}%`
                if (sectionDelta !== null) title += ` (${formatDelta(sectionDelta)} vs last try)`
                if (isWeakest) title += ' — weakest section'
                return (
                  <div
                    key={i}
                    className={`timeline-segment${isWeakest ? ' timeline-segment--weakest' : ''}`}
                    style={{
                      flex: section.endTime - section.startTime,
                      backgroundColor: scoreToColor(section.score),
                    }}
                    title={title}
                  >
                    <span className="timeline-segment-label">
                      {Math.round(section.score * 100)}%
                    </span>
                    {sectionDelta !== null && sectionDelta !== 0 && (
                      <span className={`timeline-segment-delta timeline-segment-delta--${deltaTone(sectionDelta)}`}>
                        {sectionDelta > 0 ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="timeline-labels">
              <span>0s</span>
              {sections.length > 0 && (
                <span>
                  {Math.round(lastEnd)}s
                </span>
              )}
            </div>
            {weakest && (
              <p className="results-weakest-note">
                <span className="results-weakest-dot" aria-hidden="true" />
                Weakest: {Math.round(weakest.startTime)}s–{Math.round(weakest.endTime)}s
                {' '}({Math.round(weakest.score * 100)}%)
              </p>
            )}
          </div>

          {/* Body part breakdown */}
          <div className="results-breakdown">
            <h3>Body Part Scores</h3>
            <div className="breakdown-bars">
              {result.bodyPartScores.map((part) => isOutOfFrame(part, evidence) ? (
                <div
                  key={part.name}
                  className="breakdown-item breakdown-item--untracked"
                  title={`Your ${part.name.toLowerCase()} were out of frame for most of the dance, so they could not be scored.`}
                >
                  <span className="breakdown-label">{part.name}</span>
                  <div className="breakdown-bar-track breakdown-bar-track--untracked">
                    <span className="breakdown-untracked-label">out of frame</span>
                  </div>
                  <span className="breakdown-value breakdown-value--untracked">—</span>
                </div>
              ) : (
                <div key={part.name} className="breakdown-item">
                  <span className="breakdown-label">{part.name}</span>
                  <div className="breakdown-bar-track">
                    <div
                      className="breakdown-bar-fill"
                      style={{
                        width: `${part.score * 100}%`,
                        backgroundColor: scoreToColor(part.score),
                      }}
                    />
                  </div>
                  <span className="breakdown-value">
                    {Math.round(part.score * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="results-side">
          <div className="results-side-stack">
            <ClipCard clipUrl={clipUrl} clipLabel={clipLabel} onReplay={onReplay} onOpenHistory={onOpenHistory} />
            <BattlePanel
              danceTitle={danceName}
              challenger={challenger}
              host={host}
              isHostAttempt={isHostAttempt}
              leaderboard={leaderboard}
              playerName={trimmedPlayer}
            />
          </div>
          <CoachPanel
            request={coachRequest}
            poseDataUrl={poseDataUrl}
            onStartCoachDrill={onStartCoachDrill}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="results-actions">
        <button className="results-btn results-btn-retry" onClick={onRetry}>
          Try Again
        </button>
        {onReplay && (
          <button className="results-btn results-btn-replay" onClick={onReplay}>
            Watch Replay
          </button>
        )}
        <button className="results-btn results-btn-home" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  )
}
