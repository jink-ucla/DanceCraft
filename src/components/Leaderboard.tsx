import { isSamePlayer } from '../storage/arena'
import './Arena.css'

export interface LeaderboardRow {
  name: string
  /** 0-1 */
  score: number
  isHost: boolean
}

interface LeaderboardProps {
  entries: LeaderboardRow[]
  /** Player to highlight (case-insensitive), e.g. the challenger who just danced. */
  highlightPlayer?: string
  title?: string
  compact?: boolean
}

const MEDALS = ['gold', 'silver', 'bronze'] as const

/** Small inline crown used to mark the host. Decorative unless `label` is given. */
export function CrownIcon({ size = 14, className = '', label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={`arena-crown ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Leaderboard({ entries, highlightPlayer, title = 'Leaderboard', compact = false }: LeaderboardProps) {
  return (
    <div className={`arena-leaderboard ${compact ? 'arena-leaderboard-compact' : ''}`.trim()}>
      <h3 className="arena-leaderboard-title">{title}</h3>
      {entries.length === 0 ? (
        <p className="arena-leaderboard-empty">No scores yet. Be the first to dance!</p>
      ) : (
        <ol className="arena-leaderboard-list">
          {entries.map((entry, i) => {
            const pct = Math.round(Math.min(1, Math.max(0, entry.score)) * 100)
            const isMe = isSamePlayer(entry.name, highlightPlayer)
            const medal = i < MEDALS.length ? MEDALS[i] : null
            const rowClass = [
              'arena-leaderboard-row',
              isMe ? 'arena-leaderboard-row-me' : '',
              entry.isHost ? 'arena-leaderboard-row-host' : '',
            ].filter(Boolean).join(' ')
            return (
              <li key={`${entry.name.toLowerCase()}-${i}`} className={rowClass}>
                <span
                  className={`arena-lb-pos ${medal ? `arena-lb-medal arena-lb-medal-${medal}` : ''}`.trim()}
                  aria-label={`Rank ${i + 1}`}
                >
                  {i + 1}
                </span>
                <span className="arena-lb-name">
                  {entry.isHost && <CrownIcon className="arena-lb-crown" label="Host" />}
                  <span className="arena-lb-name-text">{entry.name}</span>
                  {isMe && <span className="arena-lb-you">you</span>}
                </span>
                {!compact && (
                  <span className="arena-lb-bar" aria-hidden="true">
                    <span className="arena-lb-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                )}
                <span className="arena-lb-score">{pct}%</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
