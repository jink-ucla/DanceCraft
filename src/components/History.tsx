import { useState } from 'react'
import { getScoreHistory, getDanceHistory } from '../storage/scores'
import type { ScoreEntry } from '../storage/scores'

interface HistoryProps {
  danceId?: string
  onBack: () => void
}

const RANK_COLORS: Record<string, string> = {
  S: '#00ff88',
  A: '#00ccff',
  B: '#ffcc00',
  C: '#ff6b6b',
}

export function History({ danceId, onBack }: HistoryProps) {
  const [entries] = useState<ScoreEntry[]>(() =>
    danceId ? getDanceHistory(danceId) : getScoreHistory()
  )

  return (
    <div className="history-screen">
      <h2>{danceId ? 'Dance History' : 'Score History'}</h2>

      {entries.length === 0 ? (
        <p className="history-empty">No scores yet. Start dancing!</p>
      ) : (
        <div className="history-list">
          {entries.map((entry, i) => (
            <div key={i} className="history-entry">
              <div className="history-entry-left">
                <span className="history-dance-name">{entry.danceName}</span>
                <span className="history-date">
                  {new Date(entry.date).toLocaleDateString()}
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
            </div>
          ))}
        </div>
      )}

      <button className="history-back-btn" onClick={onBack}>
        Back
      </button>
    </div>
  )
}
