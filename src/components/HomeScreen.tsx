import { useEffect, useState } from 'react'

export interface DanceInfo {
  id: string
  title: string
  thumbnail?: string
  poseDataUrl: string
  videoUrl?: string
  duration: string
  source?: 'api' | 'bundled'
}

interface HomeScreenProps {
  dances: DanceInfo[]
  onSelectDance: (dance: DanceInfo) => void
  onPracticeDance?: (dance: DanceInfo) => void
  onSettings?: () => void
  onHistory?: () => void
  onAddDance?: () => void
  onDeleteDance?: (dance: DanceInfo) => void
  processingCount?: number
  loading?: boolean
  error?: string | null
}

function getPersonalBest(danceId: string): number | null {
  const stored = localStorage.getItem(`groovy_best_${danceId}`)
  return stored ? JSON.parse(stored) : null
}

export function HomeScreen({
  dances,
  onSelectDance,
  onPracticeDance,
  onSettings,
  onHistory,
  onAddDance,
  onDeleteDance,
  processingCount = 0,
  loading = false,
  error = null,
}: HomeScreenProps) {
  const [bests, setBests] = useState<Record<string, number | null>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    const scores: Record<string, number | null> = {}
    for (const dance of dances) {
      scores[dance.id] = getPersonalBest(dance.id)
    }
    setBests(scores)
  }, [dances])

  const handleDelete = (e: React.MouseEvent, dance: DanceInfo) => {
    e.stopPropagation()
    if (deleteConfirm === dance.id) {
      onDeleteDance?.(dance)
      setDeleteConfirm(null)
    } else {
      setDeleteConfirm(dance.id)
    }
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1>Groovy</h1>
        <p className="home-subtitle">Dance along to any video with real-time pose feedback</p>
        <div className="home-nav-buttons">
          {onAddDance && (
            <button className="home-nav-btn home-add-btn" onClick={onAddDance}>
              + Add Dance
            </button>
          )}
          {onHistory && (
            <button className="home-nav-btn" onClick={onHistory}>
              History
            </button>
          )}
          {onSettings && (
            <button className="home-nav-btn" onClick={onSettings}>
              Settings
            </button>
          )}
        </div>
      </header>

      {processingCount > 0 && (
        <div className="home-processing-indicator">
          <div className="home-processing-spinner" />
          <span>{processingCount} dance{processingCount > 1 ? 's' : ''} processing...</span>
        </div>
      )}

      {error && (
        <div className="home-error">
          <p>{error}</p>
        </div>
      )}

      {loading && (
        <div className="dance-cards">
          {[1, 2, 3].map((i) => (
            <div key={i} className="dance-card-skeleton">
              <div className="dance-card-skeleton-thumb" />
              <div className="dance-card-skeleton-info">
                <div className="dance-card-skeleton-title" />
                <div className="dance-card-skeleton-duration" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && dances.length === 0 && !error && (
        <div className="home-empty">
          <p className="home-empty-title">No dances yet</p>
          <p className="home-empty-text">Add your first dance by pasting a YouTube URL!</p>
          {onAddDance && (
            <button className="home-empty-btn" onClick={onAddDance}>
              + Add Dance
            </button>
          )}
        </div>
      )}

      {!loading && dances.length > 0 && (
        <div className="dance-cards">
          {dances.map((dance) => (
            <button
              key={dance.id}
              className="dance-card"
              onClick={() => onSelectDance(dance)}
            >
              <div className="dance-card-thumbnail">
                {dance.thumbnail ? (
                  <img src={dance.thumbnail} alt={dance.title} />
                ) : (
                  <div className="dance-card-placeholder-thumb" />
                )}
              </div>
              <div className="dance-card-info">
                <h3>{dance.title}</h3>
                <span className="dance-card-duration">{dance.duration}</span>
                {bests[dance.id] != null && (
                  <span className="dance-card-best">
                    Best: {Math.floor(bests[dance.id]!)}
                  </span>
                )}
                {onPracticeDance && (
                  <button
                    className="dance-card-practice-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPracticeDance(dance)
                    }}
                  >
                    Practice
                  </button>
                )}
              </div>
              {onDeleteDance && dance.source === 'api' && (
                <button
                  className={`dance-card-delete ${deleteConfirm === dance.id ? 'dance-card-delete-confirm' : ''}`}
                  onClick={(e) => handleDelete(e, dance)}
                  title={deleteConfirm === dance.id ? 'Click again to confirm' : 'Delete dance'}
                >
                  {deleteConfirm === dance.id ? 'Confirm?' : '×'}
                </button>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
