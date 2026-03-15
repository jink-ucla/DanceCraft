import { useEffect, useState } from 'react'

export interface DanceInfo {
  id: string
  title: string
  thumbnail?: string
  poseDataUrl: string
  videoUrl?: string
  duration: string
  source?: 'api' | 'bundled'
  processing?: boolean
  processingStatus?: string
}

interface HomeScreenProps {
  dances: DanceInfo[]
  onSelectDance: (dance: DanceInfo) => void
  onPracticeDance?: (dance: DanceInfo) => void
  onSettings?: () => void
  onHistory?: () => void
  onAddDance?: () => void
  onDeleteDance?: (dance: DanceInfo) => void
  onDebugDance?: (dance: DanceInfo) => void
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
  onDebugDance,
  processingCount = 0,
  loading = false,
  error = null,
}: HomeScreenProps) {
  const [bests, setBests] = useState<Record<string, number | null>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  useEffect(() => {
    const scores: Record<string, number | null> = {}
    for (const dance of dances) {
      scores[dance.id] = getPersonalBest(dance.id)
    }
    setBests(scores)
  }, [dances])

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = () => { setMenuOpen(null); setDeleteConfirm(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuOpen])

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
            <div
              key={dance.id}
              className={`dance-card ${dance.processing ? 'dance-card-processing' : ''}`}
              role="button"
              tabIndex={dance.processing ? undefined : 0}
              onClick={dance.processing ? undefined : () => onSelectDance(dance)}
              onKeyDown={dance.processing ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectDance(dance) }}
            >
              <div className="dance-card-thumbnail">
                {dance.thumbnail ? (
                  <img src={dance.thumbnail} alt={dance.title} />
                ) : (
                  <div className="dance-card-placeholder-thumb" />
                )}
                {dance.processing && dance.processingStatus?.startsWith('Error:') && (
                  <div className="dance-card-processing-overlay dance-card-error-overlay">
                    <span>{dance.processingStatus}</span>
                  </div>
                )}
                {dance.processing && !dance.processingStatus?.startsWith('Error:') && (() => {
                  const pctMatch = dance.processingStatus?.match(/(\d+)%/)
                  const pct = pctMatch ? parseInt(pctMatch[1], 10) : null
                  return (
                    <div className="dance-card-processing-overlay">
                      <div className="dance-card-processing-spinner" />
                      <span>{dance.processingStatus || 'Processing...'}</span>
                      {pct !== null && (
                        <div className="dance-card-progress-bar">
                          <div className="dance-card-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="dance-card-info">
                <h3>{dance.title}</h3>
                {!dance.processing && (
                  <>
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
                  </>
                )}
                {dance.processing && (
                  <span className="dance-card-duration">Importing...</span>
                )}
              </div>
              {!dance.processing && (
                <div className="dance-card-menu-container">
                  <button
                    className="dance-card-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(menuOpen === dance.id ? null : dance.id)
                      setDeleteConfirm(null)
                    }}
                    title="More options"
                  >
                    ···
                  </button>
                  {menuOpen === dance.id && (
                    <div className="dance-card-menu" onClick={(e) => e.stopPropagation()}>
                      {onDebugDance && (
                        <button
                          className="dance-card-menu-item"
                          onClick={() => {
                            setMenuOpen(null)
                            onDebugDance(dance)
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {onDeleteDance && (
                        <button
                          className={`dance-card-menu-item dance-card-menu-item-danger ${deleteConfirm === dance.id ? 'dance-card-menu-item-confirm' : ''}`}
                          onClick={(e) => handleDelete(e, dance)}
                        >
                          {deleteConfirm === dance.id ? 'Confirm delete?' : 'Delete'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
