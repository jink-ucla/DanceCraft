import { useEffect, useMemo, useState } from 'react'
import { Hero } from './Hero'
import { CrownIcon } from './Leaderboard'
import { getHostForDance } from '../storage/arena'
import type { ArenaPlayer } from '../storage/arena'
import { loadDanceSettings, setDanceMirror } from '../storage/danceSettings'
import './Arena.css'
import './DanceCard.css'

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
  /** Who is dancing on this device (shown as a chip in the hero). */
  currentPlayer?: ArenaPlayer | null
}

function getPersonalBest(danceId: string): number | null {
  try {
    const stored = localStorage.getItem(`groovy_best_${danceId}`)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
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
  currentPlayer = null,
}: HomeScreenProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  // Per-dance mirror flag (saved in dance settings); local overrides re-render after a toggle.
  const [mirrorOverrides, setMirrorOverrides] = useState<Record<string, boolean>>({})
  const mirrors = useMemo(
    () => Object.fromEntries(dances.map((d) => [d.id, mirrorOverrides[d.id] ?? loadDanceSettings(d.id).mirror])),
    [dances, mirrorOverrides],
  )

  // Personal bests + host challenge per dance, read from localStorage.
  // HomeScreen remounts every time the player returns home, so this is fresh.
  const bests = useMemo(() => {
    const scores: Record<string, number | null> = {}
    for (const dance of dances) {
      scores[dance.id] = getPersonalBest(dance.id)
    }
    return scores
  }, [dances])

  const hostChallenges = useMemo(() => {
    const hosts: Record<string, { name: string; score: number } | null> = {}
    for (const dance of dances) {
      hosts[dance.id] = dance.processing ? null : getHostForDance(dance.id)
    }
    return hosts
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
    <div className="home-screen home-screen-hero">
      <header className="home-header">
        <h1>DanceCraft</h1>
        <p className="home-subtitle">AI Motion Arena · powered by Claude</p>
        {/* "+ Add Dance" lives in the hero CTAs (one button, so text locators stay unique). */}
        <div className="home-nav-buttons">
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

      <Hero
        dances={dances}
        loading={loading}
        currentPlayer={currentPlayer}
        onSelectDance={onSelectDance}
        onPracticeDance={onPracticeDance}
        onAddDance={onAddDance}
      />

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
          <p className="home-empty-text">
            {onAddDance
              ? 'Use the Add Dance button above to paste a YouTube link or upload a clip.'
              : 'Add your first dance by pasting a YouTube URL!'}
          </p>
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
                <h3 title={dance.title}>{dance.title}</h3>
                {!dance.processing && (
                  <>
                    <span className="dance-card-duration">{dance.duration}</span>
                    {bests[dance.id] != null && (
                      <span className="dance-card-best">
                        Best: {Math.floor(bests[dance.id]!)}
                      </span>
                    )}
                    {hostChallenges[dance.id] && (
                      <span className="dance-card-to-beat">
                        <CrownIcon size={12} />
                        <span>Score to beat:</span>
                        <span className="dance-card-to-beat-name">{hostChallenges[dance.id]!.name}</span>
                        <span>{Math.round(hostChallenges[dance.id]!.score * 100)}%</span>
                      </span>
                    )}
                    <button
                      className={`dance-card-mirror-btn ${mirrors[dance.id] ? 'active' : ''}`}
                      title="Flip the video so it can be copied like a mirror (saved for this dance)"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = !mirrors[dance.id]
                        setDanceMirror(dance.id, next)
                        setMirrorOverrides((prev) => ({ ...prev, [dance.id]: next }))
                      }}
                    >
                      ⇋ Mirror {mirrors[dance.id] ? 'on' : 'off'}
                    </button>
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
