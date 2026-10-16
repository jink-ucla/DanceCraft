import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { DancingCharacter } from './DancingCharacter'
import { CrownIcon } from './Leaderboard'
import { getHostForDance, getLeaderboard, isSamePlayer } from '../storage/arena'
import type { ArenaPlayer } from '../storage/arena'
import type { DanceInfo } from './HomeScreen'
import './Hero.css'

interface HeroProps {
  dances: DanceInfo[]
  loading?: boolean
  currentPlayer?: ArenaPlayer | null
  onSelectDance: (dance: DanceInfo) => void
  onPracticeDance?: (dance: DanceInfo) => void
  onAddDance?: () => void
}

const STEPS = [
  { title: 'Dance with your webcam', text: 'Copy the host’s routine, full body in frame.', icon: 'cam' },
  { title: 'Claude finds your weakest moves', text: 'and builds a focused drill just for them.', icon: 'spark' },
  { title: 'Retry and beat the host’s score', text: 'Climb the leaderboard and take the crown.', icon: 'trophy' },
] as const

type StepIcon = (typeof STEPS)[number]['icon']

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

function Icon({ name }: { name: StepIcon | 'play' }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'play':
      return (
        <svg {...common} width={18} height={18}>
          <path d="M7 4.5v15l12.5-7.5L7 4.5z" fill="currentColor" />
        </svg>
      )
    case 'cam':
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
          <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
        </svg>
      )
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
        </svg>
      )
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
          <path d="M8 6H4.5a3.5 3.5 0 0 0 3.8 4M16 6h3.5a3.5 3.5 0 0 1-3.8 4" />
          <path d="M12 13v4M8.5 20h7M9.5 17h5" />
        </svg>
      )
  }
}

/**
 * Home-screen hero: headline + CTAs on the left, the coach (and host)
 * dancing the first ready dance on a spotlit stage on the right, the
 * "score to beat" with a mini top-3, and a 3-step "how it works" strip.
 */
export function Hero({ dances, loading = false, currentPlayer = null, onSelectDance, onPracticeDance, onAddDance }: HeroProps) {
  const firstDance = useMemo(() => dances.find((d) => !d.processing) ?? null, [dances])
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const narrow = useMediaQuery('(max-width: 640px)')
  const short = useMediaQuery('(max-height: 780px)')
  const buddySize = narrow ? 196 : short ? 224 : 256
  const hostSize = Math.round(buddySize * 0.6)
  // Lets the CSS centre the coach under the spotlight with the host beside it.
  const lineupStyle = { '--hero-host-w': `${hostSize}px` } as CSSProperties

  // Arena data is in localStorage; HomeScreen remounts on every return home.
  const host = useMemo(() => (firstDance ? getHostForDance(firstDance.id) : null), [firstDance])
  const top3 = useMemo(() => (firstDance ? getLeaderboard(firstDance.id, 3) : []), [firstDance])
  const manifestHost = firstDance && 'hostName' in firstDance && typeof firstDance.hostName === 'string'
    ? firstDance.hostName
    : null
  const hostName = host?.name ?? manifestHost
  const target = host ?? (top3[0] ? { name: top3[0].name, score: top3[0].score } : null)
  const targetIsHost = !!host

  const hasDance = !!firstDance
  const poseDataUrl = firstDance?.poseDataUrl || undefined

  return (
    <section className={`hero ${hasDance ? '' : 'hero-empty'}`.trim()} aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="hero-eyebrow">
          <span className="hero-eyebrow-dot" aria-hidden="true" />
          AI dance arena · coached by Claude
        </p>
        <h2 id="hero-title" className="hero-title">
          <span>Dance it.</span>{' '}
          <span>Get coached by Claude.</span>{' '}
          <span className="hero-title-accent">Beat the host.</span>
        </h2>
        <p className="hero-lede">
          The host sets a score on a real routine. Copy it on your webcam, let Claude coach your
          weak spots, then come back and take the top of the leaderboard.
        </p>

        <div className="hero-ctas">
          {loading && !hasDance && (
            <button className="hero-cta hero-cta-primary" disabled>
              Loading dances…
            </button>
          )}
          {hasDance && (
            <button className="hero-cta hero-cta-primary" onClick={() => onSelectDance(firstDance)}>
              <Icon name="play" />
              Start the challenge
            </button>
          )}
          {hasDance && onPracticeDance && (
            <button className="hero-cta hero-cta-secondary" onClick={() => onPracticeDance(firstDance)}>
              Practice
            </button>
          )}
          {onAddDance && (
            <button
              className={`hero-cta ${hasDance || loading ? 'hero-cta-tertiary' : 'hero-cta-primary'}`}
              onClick={onAddDance}
            >
              + Add Dance
            </button>
          )}
        </div>

        {!hasDance && !loading && (
          <p className="hero-empty-hint">
            Paste a YouTube link or upload a clip. We extract the moves, then the arena opens.
          </p>
        )}

        {currentPlayer ? (
          <span className={`home-player-chip ${currentPlayer.isHost ? 'home-player-chip-host' : ''}`.trim()}>
            {currentPlayer.isHost && <CrownIcon size={14} />}
            <span>Dancing as</span>
            <strong>{currentPlayer.name}</strong>
            {currentPlayer.isHost && <span className="home-player-chip-tag">Host</span>}
          </span>
        ) : hasDance ? (
          <span className="home-player-chip home-player-chip-empty">
            Pick a dance to step into the arena
          </span>
        ) : null}
      </div>

      <div className="hero-visual">
        <div
          className="hero-stage"
          style={{ minHeight: buddySize + 46 }}
          role="img"
          aria-label={firstDance
            ? `Coach Buddy${hostName ? ` and ${hostName}` : ''} dancing ${firstDance.title}`
            : 'Coach Buddy warming up'}
        >
          <div className="hero-stage-spot" aria-hidden="true" />
          <div className="hero-stage-floor" aria-hidden="true" />
          <div className="hero-stage-tag" aria-hidden="true">
            <span className="hero-stage-live">{hasDance ? 'On stage' : 'Warming up'}</span>
            {/* Title via CSS attr(): the same text sits in the dance card below, and
                text-based e2e locators (getByText(title)) must keep resolving to one element. */}
            {firstDance && (
              <span className="hero-stage-title" data-title={firstDance.title} title={firstDance.title} />
            )}
          </div>
          <div className="home-hero-character" style={lineupStyle} aria-hidden="true">
            <div className="hero-dancer hero-dancer-buddy">
              <DancingCharacter
                character="buddy"
                poseDataUrl={poseDataUrl}
                size={buddySize}
                paused={reducedMotion}
              />
              <span className="hero-dancer-tag">Coach Buddy</span>
            </div>
            <div className="hero-dancer hero-dancer-host">
              <DancingCharacter
                character="host"
                poseDataUrl={poseDataUrl}
                size={hostSize}
                paused={reducedMotion}
              />
              <span className="hero-dancer-tag hero-dancer-tag-host">
                <CrownIcon size={11} />
                {hostName ?? 'The host'}
              </span>
            </div>
          </div>
        </div>

        <div className="hero-board">
          <div className="hero-board-target">
            <span className="hero-board-label">Score to beat</span>
            {target ? (
              <>
                <span className="hero-board-score">
                  {Math.round(target.score * 100)}
                  <small>%</small>
                </span>
                <span className="hero-board-holder">
                  {targetIsHost && <CrownIcon size={12} />}
                  <span className="hero-board-holder-name">{target.name}</span>
                  <span className="hero-board-holder-role">{targetIsHost ? 'host' : 'leader'}</span>
                </span>
              </>
            ) : (
              <>
                <span className="hero-board-score hero-board-score-empty">--</span>
                <span className="hero-board-holder">
                  {hasDance ? 'No run yet: set the bar' : 'Add a dance to open the arena'}
                </span>
              </>
            )}
          </div>
          <div className="hero-board-top">
            <span className="hero-board-label">Top 3</span>
            {top3.length > 0 ? (
              <ol className="hero-board-list">
                {top3.map((entry, i) => {
                  const isMe = !!currentPlayer && isSamePlayer(entry.name, currentPlayer.name)
                  return (
                    <li
                      key={`${entry.name.toLowerCase()}-${i}`}
                      className={`hero-board-row ${isMe ? 'hero-board-row-me' : ''}`.trim()}
                    >
                      <span className={`hero-board-pos hero-board-pos-${i + 1}`}>{i + 1}</span>
                      <span className="hero-board-name">
                        <span className="hero-board-name-text">{entry.name}</span>
                        {entry.isHost && <CrownIcon size={11} label="Host" />}
                      </span>
                      <span className="hero-board-pct">{Math.round(entry.score * 100)}%</span>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="hero-board-empty">
                {hasDance ? 'Empty board. The first run claims #1.' : 'Scores show up here.'}
              </p>
            )}
          </div>
        </div>
      </div>

      <ol className="hero-steps" aria-label="How it works">
        {STEPS.map((step, i) => (
          <li key={step.title} className="hero-step">
            <span className="hero-step-icon" aria-hidden="true">
              <Icon name={step.icon} />
              <span className="hero-step-num">{i + 1}</span>
            </span>
            <span className="hero-step-text">
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
