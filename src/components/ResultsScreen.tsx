import type { DTWResult } from '../scoring/dtw'

interface ResultsScreenProps {
  result: DTWResult
  danceName: string
  onRetry: () => void
  onHome: () => void
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

export function ResultsScreen({ result, danceName, onRetry, onHome }: ResultsScreenProps) {
  const pct = Math.round(result.overallScore * 100)

  return (
    <div className="results-screen">
      <div className="results-header">
        <h2>Dance Complete!</h2>
        <p className="results-dance-name">{danceName}</p>
      </div>

      <div className="results-score-section">
        <div
          className="results-rank"
          style={{ color: RANK_COLORS[result.rank] }}
        >
          {result.rank}
        </div>
        <div className="results-percentage">{pct}%</div>
        <p className="results-message">{RANK_MESSAGES[result.rank]}</p>
      </div>

      {/* Timeline bar */}
      <div className="results-timeline">
        <h3>Performance Timeline</h3>
        <div className="timeline-bar">
          {result.sectionScores.map((section, i) => (
            <div
              key={i}
              className="timeline-segment"
              style={{
                flex: section.endTime - section.startTime,
                backgroundColor: scoreToColor(section.score),
              }}
              title={`${Math.round(section.startTime)}s - ${Math.round(section.endTime)}s: ${Math.round(section.score * 100)}%`}
            >
              <span className="timeline-segment-label">
                {Math.round(section.score * 100)}%
              </span>
            </div>
          ))}
        </div>
        <div className="timeline-labels">
          <span>0s</span>
          {result.sectionScores.length > 0 && (
            <span>
              {Math.round(result.sectionScores[result.sectionScores.length - 1].endTime)}s
            </span>
          )}
        </div>
      </div>

      {/* Body part breakdown */}
      <div className="results-breakdown">
        <h3>Body Part Scores</h3>
        <div className="breakdown-bars">
          {result.bodyPartScores.map((part) => (
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

      {/* Actions */}
      <div className="results-actions">
        <button className="results-btn results-btn-retry" onClick={onRetry}>
          Try Again
        </button>
        <button className="results-btn results-btn-home" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  )
}
