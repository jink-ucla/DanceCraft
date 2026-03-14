import { useEffect, useState } from 'react'

export interface DanceInfo {
  id: string
  title: string
  thumbnail?: string
  poseDataUrl: string
  videoUrl?: string
  duration: string
}

interface HomeScreenProps {
  dances: DanceInfo[]
  onSelectDance: (dance: DanceInfo) => void
  onSettings?: () => void
  onHistory?: () => void
  onAddDance?: () => void
  processingCount?: number
}

function getPersonalBest(danceId: string): number | null {
  const stored = localStorage.getItem(`groovy_best_${danceId}`)
  return stored ? JSON.parse(stored) : null
}

export function HomeScreen({ dances, onSelectDance, onSettings, onHistory, onAddDance, processingCount = 0 }: HomeScreenProps) {
  const [bests, setBests] = useState<Record<string, number | null>>({})

  useEffect(() => {
    const scores: Record<string, number | null> = {}
    for (const dance of dances) {
      scores[dance.id] = getPersonalBest(dance.id)
    }
    setBests(scores)
  }, [dances])

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
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
