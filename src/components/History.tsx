import { useState, useEffect, useCallback } from 'react'
import { getScoreHistory, removeScore } from '../storage/scores'

interface Session {
  id: number
  danceId: number
  score: number
  rank: string
  videoPath: string | null
  posesPath: string | null
  createdAt: string
}

// Unified entry: either a backend session (with replay) or a localStorage score
interface HistoryEntry {
  key: string
  danceName: string
  score: number
  rank: string
  date: string
  difficulty?: string
  // Only for backend sessions with recordings
  session?: Session
  thumbnailUrl?: string
  // Index in localStorage (for local-only entries)
  localIndex?: number
}

interface HistoryProps {
  apiBase?: string
  onBack: () => void
  onReplay?: (session: Session) => void
}

const RANK_COLORS: Record<string, string> = {
  S: '#00ff88',
  A: '#00ccff',
  B: '#ffcc00',
  C: '#ff6b6b',
}

export function History({ apiBase = 'http://localhost:3001', onBack, onReplay }: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const loadEntries = useCallback(async () => {
    const allEntries: HistoryEntry[] = []

    // Load backend sessions + dance names
    try {
      const [sessRes, danceRes] = await Promise.all([
        fetch(`${apiBase}/api/sessions`),
        fetch(`${apiBase}/api/dances`),
      ])

      const danceNames: Record<number, string> = {}
      if (danceRes.ok) {
        const dances: { id: number; title: string }[] = await danceRes.json()
        for (const d of dances) danceNames[d.id] = d.title
      }

      if (sessRes.ok) {
        const sessions: Session[] = await sessRes.json()
        for (const s of sessions) {
          allEntries.push({
            key: `session-${s.id}`,
            danceName: danceNames[s.danceId] || `Dance #${s.danceId}`,
            score: s.score,
            rank: s.rank,
            date: s.createdAt,
            session: s,
            thumbnailUrl: s.videoPath ? `${apiBase}/api/sessions/${s.id}/video` : undefined,
          })
        }
      }
    } catch { /* server unavailable */ }

    // Load localStorage scores (these don't have recordings)
    const localScores = getScoreHistory()
    for (let i = 0; i < localScores.length; i++) {
      const entry = localScores[i]
      // Avoid duplicates: skip localStorage entries that match a session by date (within 5s)
      const isDuplicate = allEntries.some(e => {
        const timeDiff = Math.abs(new Date(e.date).getTime() - new Date(entry.date).getTime())
        return timeDiff < 5000 && Math.abs(e.score - entry.score) < 1
      })
      if (!isDuplicate) {
        allEntries.push({
          key: `local-${entry.date}-${i}`,
          danceName: entry.danceName,
          score: entry.score,
          rank: entry.rank,
          date: entry.date,
          difficulty: entry.difficulty,
          localIndex: i,
        })
      }
    }

    // Sort by date, newest first
    allEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    setEntries(allEntries)
    setLoading(false)
  }, [apiBase])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleDelete = useCallback(async (entry: HistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation() // Don't trigger replay

    if (entry.session) {
      // Delete backend session
      try {
        await fetch(`${apiBase}/api/sessions/${entry.session.id}`, { method: 'DELETE' })
      } catch { /* ignore */ }
    }

    if (entry.localIndex !== undefined) {
      // Delete from localStorage
      removeScore(entry.localIndex)
    }

    // Also try to remove matching localStorage entry for session-based entries
    if (entry.session) {
      const localScores = getScoreHistory()
      const matchIdx = localScores.findIndex(ls => {
        const timeDiff = Math.abs(new Date(ls.date).getTime() - new Date(entry.date).getTime())
        return timeDiff < 5000 && Math.abs(ls.score - entry.score) < 1
      })
      if (matchIdx >= 0) removeScore(matchIdx)
    }

    // Remove from UI
    setEntries(prev => prev.filter(e => e.key !== entry.key))
  }, [apiBase])

  return (
    <div className="history-screen">
      <div className="history-header">
        <button className="history-back-btn" onClick={onBack}>Back</button>
        <h2>History</h2>
      </div>

      {loading ? (
        <p className="history-empty">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="history-empty">No scores yet. Start dancing!</p>
      ) : (
        <div className="history-list">
          {entries.map((entry) => {
            const canReplay = !!entry.session && !!entry.session.videoPath && !!onReplay

            return (
              <div
                key={entry.key}
                className={`history-entry ${canReplay ? 'history-entry-clickable' : ''}`}
                onClick={() => canReplay && onReplay!(entry.session!)}
              >
                {/* Thumbnail from user recording */}
                <div className="history-thumbnail">
                  {entry.thumbnailUrl ? (
                    <video
                      src={entry.thumbnailUrl}
                      className="history-thumbnail-video"
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget
                        v.currentTime = Math.min(2, v.duration * 0.1)
                      }}
                    />
                  ) : (
                    <div className="history-thumbnail-placeholder">
                      {entry.rank}
                    </div>
                  )}
                </div>

                <div className="history-entry-info">
                  <span className="history-dance-name">{entry.danceName}</span>
                  <span className="history-date">
                    {new Date(entry.date).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                    {entry.difficulty && (
                      <span className={`history-difficulty history-difficulty-${entry.difficulty}`}>
                        {' '}{entry.difficulty}
                      </span>
                    )}
                  </span>
                </div>

                <div className="history-entry-right">
                  <span className="history-score">
                    {Math.round(entry.score)}%
                  </span>
                  <span
                    className="history-rank"
                    style={{ color: RANK_COLORS[entry.rank] }}
                  >
                    {entry.rank}
                  </span>
                </div>

                <button
                  className="history-delete-btn"
                  onClick={(e) => handleDelete(entry, e)}
                  title="Delete"
                >
                  &times;
                </button>

                {canReplay && (
                  <div className="history-replay-arrow">&#9654;</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type { Session }
