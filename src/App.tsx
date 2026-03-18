import { useState, useRef, useCallback, useEffect } from 'react'
import { HomeScreen } from './components/HomeScreen'
import type { DanceInfo } from './components/HomeScreen'
import { DanceMode } from './components/DanceMode'
import { ResultsScreen } from './components/ResultsScreen'
import { Settings } from './components/Settings'
import { History } from './components/History'
import type { Session } from './components/History'
import { AddDance } from './components/AddDance'
import { ReplayMode } from './components/ReplayMode'
import { PracticeMode } from './components/PracticeMode'
import { DebugMode } from './components/DebugMode'
import { computePostDanceScore } from './scoring/dtw'
import { computeRank } from './scoring/dtw'
import { saveScore } from './storage/scores'
import type { Difficulty } from './storage/scores'
import { loadDanceSettings } from './storage/danceSettings'
import type { DTWResult, TimestampedPose } from './scoring/dtw'
import type { Pose } from './scoring/types'
import './App.css'

const API_BASE = 'http://localhost:3001'

const BUNDLED_DANCES: DanceInfo[] = []

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
  | { screen: 'dance'; dance: DanceInfo; difficulty: Difficulty }
  | { screen: 'results'; dance: DanceInfo; result: DTWResult; difficulty: Difficulty }
  | { screen: 'settings' }
  | { screen: 'history' }
  | { screen: 'replay'; dance: DanceInfo; result: DTWResult; difficulty: Difficulty }
  | { screen: 'history-replay'; session: Session; dance: DanceInfo }
  | { screen: 'practice'; dance: DanceInfo }
  | { screen: 'debug'; dance: DanceInfo }

interface ProcessingJob {
  jobId: string
  youtubeUrl?: string
  status: string
  progress?: string
  title?: string
  error?: string
}

function App() {
  const [view, setView] = useState<View>({ screen: 'home' })
  const [pendingDance, setPendingDance] = useState<DanceInfo | null>(null)
  const [showAddDance, setShowAddDance] = useState(false)
  const [apiDances, setApiDances] = useState<DanceInfo[]>([])
  const [hiddenBundled, setHiddenBundled] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('groovy_hidden_bundled') || '[]') } catch { return [] }
  })
  const [dancesLoading, setDancesLoading] = useState(true)
  const [dancesError, setDancesError] = useState<string | null>(null)
  const [processingJobs, setProcessingJobs] = useState<ProcessingJob[]>([])
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const userPosesRef = useRef<TimestampedPose[]>([])
  const referencePosesRef = useRef<TimestampedPose[]>([])
  const recordingBlobRef = useRef<Blob | null>(null)

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

  const trackJob = useCallback((jobId: string, title?: string, youtubeUrl?: string) => {
    setProcessingJobs((prev) => {
      if (prev.some((j) => j.jobId === jobId)) return prev
      return [...prev, { jobId, status: 'queued', title, youtubeUrl }]
    })

    if (pollIntervalsRef.current.has(jobId)) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dances/jobs/${jobId}`)
        if (!res.ok) return
        const job = await res.json()

        if (job.status === 'complete') {
          clearInterval(pollIntervalsRef.current.get(jobId)!)
          pollIntervalsRef.current.delete(jobId)
          setProcessingJobs((prev) => prev.filter((j) => j.jobId !== jobId))
          fetchDances()
        } else if (job.status === 'error') {
          clearInterval(pollIntervalsRef.current.get(jobId)!)
          pollIntervalsRef.current.delete(jobId)
          setProcessingJobs((prev) =>
            prev.map((j) => j.jobId === jobId ? { ...j, status: 'error', error: job.error || 'Processing failed' } : j)
          )
          // Auto-dismiss error after 8 seconds
          setTimeout(() => {
            setProcessingJobs((prev) => prev.filter((j) => j.jobId !== jobId))
          }, 8000)
        } else {
          setProcessingJobs((prev) =>
            prev.map((j) => j.jobId === jobId ? { ...j, status: job.status, progress: job.progress, title: job.metadata?.title || j.title, youtubeUrl: job.youtubeUrl || j.youtubeUrl } : j)
          )
        }
      } catch {
        // Network error — keep trying
      }
    }, 2000)

    pollIntervalsRef.current.set(jobId, interval)
  }, [fetchDances])

  // On mount, check for any already-processing dances
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dances`)
        if (!res.ok) return
        const data: ApiDance[] = await res.json()
        const processing = data.filter((d) => d.status !== 'complete' && d.status !== 'error')
        for (const d of processing) {
          trackJob(String(d.id), d.title, d.youtubeUrl)
        }
      } catch { /* ignore */ }
    })()
  }, [trackJob])

  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach((interval) => clearInterval(interval))
    }
  }, [])

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'queued': return 'Starting...'
      case 'downloading': return 'Downloading...'
      case 'extracting_audio': return 'Extracting audio...'
      case 'extracting_poses': return 'Extracting poses...'
      case 'generating_thumbnail': return 'Almost done...'
      default: return 'Processing...'
    }
  }

  // Convert processing jobs to DanceInfo cards
  const processingDances: DanceInfo[] = processingJobs.map((job) => {
    const videoId = job.youtubeUrl ? extractYoutubeVideoId(job.youtubeUrl) : null
    const thumbnail = videoId
      ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
      : undefined
    return {
      id: `processing-${job.jobId}`,
      title: job.title || 'New Dance',
      thumbnail,
      poseDataUrl: '',
      duration: '',
      source: 'api',
      processing: true,
      processingStatus: job.error
        ? `Error: ${job.error}`
        : job.progress || statusLabel(job.status),
    }
  })

  // Merge: processing first, then completed API dances, then bundled
  const visibleBundled = BUNDLED_DANCES.filter((d) => !hiddenBundled.includes(d.id))
  const allDances = dancesError
    ? visibleBundled
    : [...processingDances, ...apiDances, ...visibleBundled]

  const handleDeleteDance = useCallback(async (dance: DanceInfo) => {
    if (dance.source === 'bundled') {
      setHiddenBundled((prev) => {
        const next = [...prev, dance.id]
        localStorage.setItem('groovy_hidden_bundled', JSON.stringify(next))
        return next
      })
      return
    }
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
    const rank = computeRank(result.overallScore)

    // Save to score history (localStorage)
    saveScore({
      danceId: view.dance.id,
      danceName: view.dance.title,
      score: scorePct,
      rank,
      date: new Date().toISOString(),
      difficulty: view.difficulty,
    })

    // Auto-save session to backend (async, non-blocking)
    if (view.dance.source === 'api') {
      const apiId = parseInt(view.dance.id.replace('api-', ''), 10)
      if (!isNaN(apiId)) {
        const formData = new FormData()
        formData.append('danceId', String(apiId))
        formData.append('score', String(scorePct))
        formData.append('rank', rank)
        const posesBlob = new Blob([JSON.stringify(userPosesRef.current)], { type: 'application/json' })
        formData.append('poses', posesBlob, 'poses.json')

        if (recordingBlobRef.current) {
          formData.append('video', recordingBlobRef.current, 'recording.webm')
        }

        fetch(`${API_BASE}/api/sessions`, { method: 'POST', body: formData }).catch(() => {
          // Session save failed silently — local score history still works
        })
      }
    }

    setView({ screen: 'results', dance: view.dance, result, difficulty: view.difficulty })
  }, [view])

  const handleRecordingComplete = useCallback((blob: Blob) => {
    recordingBlobRef.current = blob
  }, [])

  const handleRecordPose = useCallback((pose: Pose, time: number) => {
    userPosesRef.current.push({ time, pose })
  }, [])

  if (view.screen === 'history') {
    const handleHistoryReplay = (session: Session) => {
      // Find the dance info for this session
      const dance = allDances.find(d => d.id === `api-${session.danceId}`)
      if (dance) {
        setView({ screen: 'history-replay', session, dance })
      }
    }

    return (
      <div className="app">
        <History
          apiBase={API_BASE}
          onBack={() => setView({ screen: 'home' })}
          onReplay={handleHistoryReplay}
        />
      </div>
    )
  }

  if (view.screen === 'history-replay') {
    const { session, dance } = view
    const userVideoUrl = `${API_BASE}/api/sessions/${session.id}/video`
    const userPosesUrl = `${API_BASE}/api/sessions/${session.id}/poses`

    return (
      <div className="app">
        <ReplayMode
          referenceVideoUrl={dance.videoUrl}
          referencePoseUrl={dance.poseDataUrl}
          danceId={dance.id}
          userVideoUrl={userVideoUrl}
          userPosesUrl={userPosesUrl}
          userPoses={[]}
          sectionScores={[]}
          sessionMeta={{
            date: session.createdAt,
            score: session.score,
            rank: session.rank,
          }}
          onBack={() => setView({ screen: 'history' })}
        />
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

  if (view.screen === 'practice') {
    return (
      <div className="app">
        <PracticeMode
          referencePoseUrl={view.dance.poseDataUrl}
          referenceVideoUrl={view.dance.videoUrl}
          danceId={view.dance.id}
          onBack={() => setView({ screen: 'home' })}
        />
      </div>
    )
  }

  if (view.screen === 'debug') {
    return (
      <div className="app">
        <DebugMode
          referencePoseUrl={view.dance.poseDataUrl}
          referenceVideoUrl={view.dance.videoUrl}
          danceName={view.dance.title}
          danceId={view.dance.id}
          onBack={() => setView({ screen: 'home' })}
        />
      </div>
    )
  }

  if (view.screen === 'replay') {
    const userVideoUrl = recordingBlobRef.current
      ? URL.createObjectURL(recordingBlobRef.current)
      : ''

    return (
      <div className="app">
        <ReplayMode
          referenceVideoUrl={view.dance.videoUrl}
          referencePoseUrl={view.dance.poseDataUrl}
          danceId={view.dance.id}
          userVideoUrl={userVideoUrl}
          userPoses={userPosesRef.current}
          sectionScores={view.result.sectionScores}
          sessionMeta={{
            date: new Date().toISOString(),
            score: view.result.overallScore * 100,
            rank: view.result.rank,
          }}
          onBack={() => setView({ screen: 'results', dance: view.dance, result: view.result, difficulty: view.difficulty })}
        />
      </div>
    )
  }

  if (view.screen === 'results') {
    const hasRecording = !!recordingBlobRef.current

    return (
      <div className="app">
        <ResultsScreen
          result={view.result}
          danceName={view.dance.title}
          onRetry={() => {
            userPosesRef.current = []
            recordingBlobRef.current = null
            setView({ screen: 'dance', dance: view.dance, difficulty: view.difficulty })
          }}
          onHome={() => {
            recordingBlobRef.current = null
            setView({ screen: 'home' })
          }}
          onReplay={hasRecording ? () => setView({ screen: 'replay', dance: view.dance, result: view.result, difficulty: view.difficulty }) : undefined}
        />
      </div>
    )
  }

  if (view.screen === 'dance') {
    const danceSettings = loadDanceSettings(view.dance.id)
    return (
      <div className="app">
        <DanceMode
          referencePoseUrl={view.dance.poseDataUrl}
          referenceVideoUrl={view.dance.videoUrl}
          mirrorVideo={danceSettings.mirror}
          customKeyPoses={danceSettings.customKeyPoses}
          difficulty={view.difficulty}
          onFinish={handleDanceFinish}
          onRecordPose={handleRecordPose}
          onRecordingComplete={handleRecordingComplete}
          onReferencePosesLoaded={(poses) => {
            referencePosesRef.current = poses
          }}
          onBack={() => setView({ screen: 'home' })}
        />
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
          setPendingDance(dance)
        }}
        onPracticeDance={(dance) => setView({ screen: 'practice', dance })}
        onDeleteDance={handleDeleteDance}
        onDebugDance={(dance) => setView({ screen: 'debug', dance })}
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
          onJobStarted={(jobId, youtubeUrl) => trackJob(jobId, undefined, youtubeUrl)}
        />
      )}
      {pendingDance && (
        <div className="difficulty-overlay">
          <div className="difficulty-modal">
            <h3 className="difficulty-title">{pendingDance.title}</h3>
            <p className="difficulty-subtitle">Choose Difficulty</p>
            <div className="difficulty-options">
              {(['easy', 'normal', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  className={`difficulty-btn difficulty-btn-${d}`}
                  onClick={() => {
                    userPosesRef.current = []
                    recordingBlobRef.current = null
                    setView({ screen: 'dance', dance: pendingDance, difficulty: d })
                    setPendingDance(null)
                  }}
                >
                  <span className="difficulty-btn-label">{d.charAt(0).toUpperCase() + d.slice(1)}</span>
                  <span className="difficulty-btn-detail">
                    {d === 'easy' && '1.3s window · forgiving'}
                    {d === 'normal' && '0.9s window · balanced'}
                    {d === 'hard' && '0.55s window · precise'}
                  </span>
                </button>
              ))}
            </div>
            <button className="difficulty-cancel" onClick={() => setPendingDance(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
