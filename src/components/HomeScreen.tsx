import { useEffect, useState } from 'react'

export interface DanceInfo {
  id: string
  title: string
  thumbnail?: string
  poseDataUrl: string
  duration: string
}

interface HomeScreenProps {
  dances: DanceInfo[]
  onSelectDance: (dance: DanceInfo) => void
  onSettings?: () => void
}

function getPersonalBest(danceId: string): number | null {
  const stored = localStorage.getItem(`groovy_best_${danceId}`)
  return stored ? JSON.parse(stored) : null
}

export function HomeScreen({ dances, onSelectDance, onSettings }: HomeScreenProps) {
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
        {onSettings && (
          <button className="home-settings-btn" onClick={onSettings}>
            Settings
          </button>
        )}
      </header>

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
