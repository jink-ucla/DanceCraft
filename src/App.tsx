import { useState, useRef, useCallback, useEffect } from 'react'
import { HomeScreen } from './components/HomeScreen'
import type { DanceInfo } from './components/HomeScreen'
import { DanceMode } from './components/DanceMode'
import { ResultsScreen } from './components/ResultsScreen'
import { Settings } from './components/Settings'
import { History } from './components/History'
import { AddDance } from './components/AddDance'
import { computePostDanceScore } from './scoring/dtw'
import { computeRank } from './scoring/dtw'
import { saveScore } from './storage/scores'
import type { DTWResult, TimestampedPose } from './scoring/dtw'
import type { Pose } from './scoring/types'
import './App.css'

const API_BASE = 'http://localhost:3001'

const BUNDLED_DANCES: DanceInfo[] = [
  {
    id: 'ive-cover',
    title: 'IVE Dance Cover',
    poseDataUrl: '/dances/ive-cover.json',
    videoUrl: '/dances/ive-cover.mp4',
    duration: '3:09',
    source: 'bundled',
  },
  {
    id: 'sample-dance',
    title: 'Sample Dance',
    poseDataUrl: '/dances/sample-dance.json',
    duration: '0:30',
    source: 'bundled',
  },
]

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

interface ApiDance {
  id: number
  youtubeUrl: string
  title: string
  duration: number
  channel: string
  thumbnailPath: string | null
  poseDataPath: string | null
  videoPath: string | null
  audioPath: string | null
  status: string
  createdAt: string
}

function apiDanceToDanceInfo(dance: ApiDance): DanceInfo {
  const videoId = extractYoutubeVideoId(dance.youtubeUrl)
  const thumbnail = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : undefined

  return {
    id: `api-${dance.id}`,
    title: dance.title,
    thumbnail,
    poseDataUrl: `${API_BASE}/api/dances/${dance.id}/poses`,
    videoUrl: `${API_BASE}/api/dances/${dance.id}/video`,
    duration: formatDuration(dance.duration),
    source: 'api',
  }
}

type View =
  | { screen: 'home' }
  | { screen: 'dance'; dance: DanceInfo }
  | { screen: 'results'; dance: DanceInfo; result: DTWResult }
  | { screen: 'settings' }
  | { screen: 'history' }

function App() {
  const [view, setView] = useState<View>({ screen: 'home' })
  const [showAddDance, setShowAddDance] = useState(false)
  const [apiDances, setApiDances] = useState<DanceInfo[]>([])
  const [dancesLoading, setDancesLoading] = useState(true)
  const [dancesError, setDancesError] = useState<string | null>(null)
  const userPosesRef = useRef<TimestampedPose[]>([])
  const referencePosesRef = useRef<TimestampedPose[]>([])

  const fetchDances = useCallback(async () => {
    setDancesLoading(true)
    setDancesError(null)
    try {
      const res = await fetch(`${API_BASE}/api/dances`)
      if (!res.ok) throw new Error('Failed to fetch dances')
      const data: ApiDance[] = await res.json()
      const completed = data.filter((d) => d.status === 'complete')
      setApiDances(completed.map(apiDanceToDanceInfo))
    } catch {
      setDancesError('Could not connect to server. Showing pre-bundled dances.')
      setApiDances([])
    } finally {
      setDancesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDances()
  }, [fetchDances])

  // Merge API dances (newest first) with bundled dances as fallback
  const allDances = dancesError
    ? BUNDLED_DANCES
    : [...apiDances, ...BUNDLED_DANCES]

  const handleDeleteDance = useCallback(async (dance: DanceInfo) => {
    const apiId = dance.id.replace('api-', '')
    try {
      const res = await fetch(`${API_BASE}/api/dances/${apiId}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        setApiDances((prev) => prev.filter((d) => d.id !== dance.id))
      }
    } catch {
      // Silently fail — dance stays in the list
    }
  }, [])

  const handleDanceFinish = useCallback((_score: number, _hits: number, _total: number) => {
    if (view.screen !== 'dance') return

    const result = computePostDanceScore(
      referencePosesRef.current,
      userPosesRef.current,
    )

    const scorePct = result.overallScore * 100

    // Save to score history
    saveScore({
      danceId: view.dance.id,
      danceName: view.dance.title,
      score: scorePct,
      rank: computeRank(result.overallScore),
      date: new Date().toISOString(),
    })

    setView({ screen: 'results', dance: view.dance, result })
  }, [view])

  const handleRecordPose = useCallback((pose: Pose, time: number) => {
    userPosesRef.current.push({ time, pose })
  }, [])

  if (view.screen === 'history') {
    return (
      <div className="app">
        <History onBack={() => setView({ screen: 'home' })} />
      </div>
    )
  }

  if (view.screen === 'settings') {
    return (
      <div className="app">
        <Settings onBack={() => setView({ screen: 'home' })} />
      </div>
    )
  }

  if (view.screen === 'results') {
    return (
      <div className="app">
        <ResultsScreen
          result={view.result}
          danceName={view.dance.title}
          onRetry={() => {
            userPosesRef.current = []
            setView({ screen: 'dance', dance: view.dance })
          }}
          onHome={() => setView({ screen: 'home' })}
        />
      </div>
    )
  }

  if (view.screen === 'dance') {
    return (
      <div className="app">
        <DanceMode
          referencePoseUrl={view.dance.poseDataUrl}
          referenceVideoUrl={view.dance.videoUrl}
          onFinish={handleDanceFinish}
          onRecordPose={handleRecordPose}
          onReferencePosesLoaded={(poses) => {
            referencePosesRef.current = poses
          }}
        />
        <button
          className="back-button"
          onClick={() => setView({ screen: 'home' })}
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <HomeScreen
        dances={allDances}
        loading={dancesLoading}
        error={dancesError}
        onSelectDance={(dance) => {
          userPosesRef.current = []
          setView({ screen: 'dance', dance })
        }}
        onDeleteDance={handleDeleteDance}
        onSettings={() => setView({ screen: 'settings' })}
        onHistory={() => setView({ screen: 'history' })}
        onAddDance={() => setShowAddDance(true)}
      />
      {showAddDance && (
        <AddDance
          onClose={() => setShowAddDance(false)}
          onDanceAdded={() => {
            fetchDances()
          }}
        />
      )}
    </div>
  )
}

export default App
