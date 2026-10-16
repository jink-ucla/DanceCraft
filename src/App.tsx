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
import { PlayerSetup } from './components/PlayerSetup'
import { computeHonestRank } from './scoring/honest'
import { computeDanceCraftScore } from './scoring/dancecraft'
import { saveScore } from './storage/scores'
import type { Difficulty } from './storage/scores'
import { loadDanceSettings, applyPendingMirror } from './storage/danceSettings'
import { loadBundledDances } from './storage/bundledDances'
import {
  GUEST_NAME,
  getCurrentPlayer,
  getHostForDance,
  getLeaderboard,
  getPreviousAttempt,
  isHostAttemptFor,
  recordArenaAttempt,
  resolvePlayerName,
  setCurrentPlayer,
} from './storage/arena'
import type { ArenaPlayer, LeaderboardEntry } from './storage/arena'
import { toCoachAttempt } from './components/scoreEvidence'
import type { ScoredResult } from './components/scoreEvidence'
import { createObjectUrlSlot } from './components/objectUrl'
import type { AttemptSummary, CoachPlan } from './coach/types'
import type { TimestampedPose } from './scoring/dtw'
import type { Pose } from './scoring/types'
import { API_BASE } from './api/coach'
import './App.css'

const HIDDEN_BUNDLED_KEY = 'groovy_hidden_bundled'

function readHiddenBundled(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_BUNDLED_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
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
  // Uploaded / clipped dances have no YouTube id — use the server-generated thumbnail.
  const thumbnail = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : dance.thumbnailPath ? `${API_BASE}/api/dances/${dance.id}/thumbnail` : undefined

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

/** GET /api/dances -> completed dances as DanceInfo. Throws when the server is unreachable. */
async function fetchCompletedApiDances(signal?: AbortSignal): Promise<DanceInfo[]> {
  const res = await fetch(`${API_BASE}/api/dances`, { signal })
  if (!res.ok) throw new Error('Failed to fetch dances')
  const data: ApiDance[] = await res.json()
  return data.filter((d) => d.status === 'complete').map(apiDanceToDanceInfo)
}

/** "m:ss" or "h:mm:ss" -> seconds; 0 when unparseable. */
function parseDurationLabel(label: string): number {
  const parts = label.trim().split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return 0
  return parts.reduce((total, p) => total * 60 + Number(p), 0)
}

/**
 * Reference video length in seconds for the coach: last reference pose time,
 * falling back to the dance's "m:ss" label, then the last scored section.
 */
function computeDurationSeconds(referencePoses: TimestampedPose[], dance: DanceInfo, result: ScoredResult): number {
  const lastPoseTime = referencePoses.reduce((max, p) => (Number.isFinite(p.time) ? Math.max(max, p.time) : max), 0)
  if (lastPoseTime > 0) return lastPoseTime
  const fromLabel = parseDurationLabel(dance.duration)
  if (fromLabel > 0) return fromLabel
  const sections = result.sectionScores
  return sections.length > 0 ? sections[sections.length - 1].endTime : 0
}

/**
 * Stable React key per CoachPlan object so PracticeMode remounts cleanly
 * whenever a new plan arrives (same plan object -> same key).
 */
const coachPlanKeys = new WeakMap<CoachPlan, number>()
let nextCoachPlanKey = 1
function practiceKey(dance: DanceInfo, plan: CoachPlan | undefined): string {
  if (!plan) return `${dance.id}:free`
  let key = coachPlanKeys.get(plan)
  if (key === undefined) {
    key = nextCoachPlanKey++
    coachPlanKeys.set(plan, key)
  }
  return `${dance.id}:plan-${key}`
}

type ArenaHost = { name: string; score: number }

/** Everything the results screen needs; carried through replay and back. */
interface ResultsData {
  dance: DanceInfo
  /** HonestResult in real runs: scores + optional evidence (coverage, motion, notes, ...). */
  result: ScoredResult
  difficulty: Difficulty
  playerName: string
  /** Same player's previous attempt on this dance (read BEFORE recording this one). */
  previousAttempt: AttemptSummary | null
  isHostAttempt: boolean
  /** Reference video length (s); bounds the coach drill window. */
  durationSeconds: number
  /** Snapshotted when the view is created so ResultsScreen gets referentially stable props. */
  host: ArenaHost | null
  leaderboard: LeaderboardEntry[]
}

/** Copy just the ResultsData fields out of a results/replay view. */
function pickResultsData(v: ResultsData): ResultsData {
  return {
    dance: v.dance,
    result: v.result,
    difficulty: v.difficulty,
    playerName: v.playerName,
    previousAttempt: v.previousAttempt,
    isHostAttempt: v.isHostAttempt,
    durationSeconds: v.durationSeconds,
    host: v.host,
    leaderboard: v.leaderboard,
  }
}

type View =
  | { screen: 'home' }
  | { screen: 'dance'; dance: DanceInfo; difficulty: Difficulty }
  | ({ screen: 'results' } & ResultsData)
  | { screen: 'settings' }
  | { screen: 'history' }
  | ({ screen: 'replay' } & ResultsData)
  | { screen: 'history-replay'; session: Session; dance: DanceInfo }
  | {
      screen: 'practice'
      dance: DanceInfo
      coachPlan?: CoachPlan
      difficulty?: Difficulty
      /** Coach drill opened from the results screen: Back returns there. */
      returnTo?: ResultsData
    }
  | { screen: 'debug'; dance: DanceInfo }

// ---------------------------------------------------------------------------
// DEV-ONLY PREVIEW HOOK: webcam-free verification and event rehearsal.
//
//   /?preview=results         Results screen with a realistic mock attempt
//                             (weak 10s-20s section, previous attempt 51%,
//                             host Wasil 78%, honest-scoring evidence with
//                             legs out of frame) so the Claude coach + battle
//                             UI can be exercised without dancing. The first
//                             dance's reference video stands in for the
//                             user's clip (badged "Preview clip").
//   /?preview=practice-drill  PracticeMode on the first available dance,
//                             driven by a sample coach plan (10s-16s, 0.5x,
//                             3 reps). Stays on home when no dance exists.
//
// Gated on import.meta.env.DEV: production builds never read the param.
// ---------------------------------------------------------------------------
type PreviewMode = 'results' | 'practice-drill'

function readPreviewMode(): PreviewMode | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('preview')
  return value === 'results' || value === 'practice-drill' ? value : null
}

const PREVIEW_PLACEHOLDER_DANCE: DanceInfo = {
  id: 'preview',
  title: 'Preview Dance',
  poseDataUrl: '',
  duration: '0:27',
}

/** Shaped like a HonestResult (src/scoring/honest.ts), notes worded the way it words them. */
function buildPreviewResult(): ScoredResult {
  const overallScore = 0.63
  return {
    overallScore,
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.82 },
      { startTime: 10, endTime: 20, score: 0.41 },
      { startTime: 20, endTime: 27, score: 0.66 },
    ],
    bodyPartScores: [
      { name: 'Arms', score: 0.58, tracked: true },
      { name: 'Legs', score: 0.14, tracked: false },
    ],
    rank: computeHonestRank(overallScore),
    alignment: [],
    coverage: 0.74,
    motionMatch: 0.52,
    latencyMs: 200,
    mirrored: true,
    notes: [
      'We could only track you for 74% of the dance — stay in frame from start to finish.',
      'Your legs were out of frame — step back so your full body is visible.',
    ],
  }
}

function buildPreviewPreviousAttempt(): AttemptSummary {
  const overallScore = 0.51
  return {
    overallScore,
    rank: computeHonestRank(overallScore),
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.7 },
      { startTime: 10, endTime: 20, score: 0.3 },
      { startTime: 20, endTime: 27, score: 0.53 },
    ],
    bodyPartScores: [
      { name: 'Arms', score: 0.44 },
      { name: 'Legs', score: 0.1 },
    ],
    coverage: 0.61,
    motionMatch: 0.41,
    latencyMs: 300,
    mirrored: true,
    untrackedBodyParts: ['Legs'],
    notes: [
      'We could only track you for 61% of the dance — stay in frame from start to finish.',
      'Your legs were out of frame — step back so your full body is visible.',
      'You were consistently behind the music — try to anticipate the next move.',
    ],
  }
}

function buildPreviewCoachPlan(): CoachPlan {
  return {
    summary: 'Strong opening at 82%, but the 10s–20s section dropped to 41%: your arms are trailing the beat there.',
    focus: 'Arms · 10s–16s',
    startTime: 10,
    endTime: 16,
    playbackSpeed: 0.5,
    repeats: 3,
    cue: 'Lead with your elbows and snap each arm shape to full extension right on the count.',
    encouragement: 'Wasil is sitting at 78%. Clean up this section and the crown is yours.',
  }
}

function buildPreviewView(mode: PreviewMode, dance: DanceInfo | null): View | null {
  if (mode === 'results') {
    return {
      screen: 'results',
      dance: dance ?? PREVIEW_PLACEHOLDER_DANCE,
      result: buildPreviewResult(),
      difficulty: 'normal',
      playerName: GUEST_NAME,
      previousAttempt: buildPreviewPreviousAttempt(),
      isHostAttempt: false,
      durationSeconds: 27,
      host: { name: 'Wasil', score: 0.78 },
      leaderboard: [
        { name: 'Wasil', score: 0.78, isHost: true },
        { name: GUEST_NAME, score: 0.63, isHost: false },
        { name: 'Maya', score: 0.59, isHost: false },
        { name: 'Leo', score: 0.47, isHost: false },
      ],
    }
  }
  if (!dance) return null
  return { screen: 'practice', dance, coachPlan: buildPreviewCoachPlan(), difficulty: 'normal' }
}
// -------------------------- end dev preview hook --------------------------

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
  const [bundledDances, setBundledDances] = useState<DanceInfo[]>([])
  const [hiddenBundled, setHiddenBundled] = useState<string[]>(readHiddenBundled)
  const [currentPlayer, setCurrentPlayerState] = useState<ArenaPlayer | null>(getCurrentPlayer)
  // Identity being edited in the difficulty modal; saved when a difficulty is picked
  const [playerDraft, setPlayerDraft] = useState<ArenaPlayer>({ name: '', isHost: false })
  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(readPreviewMode)
  const [dancesLoading, setDancesLoading] = useState(true)
  const [dancesError, setDancesError] = useState<string | null>(null)
  const [processingJobs, setProcessingJobs] = useState<ProcessingJob[]>([])
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const userPosesRef = useRef<TimestampedPose[]>([])
  const referencePosesRef = useRef<TimestampedPose[]>([])
  const referenceGeometryRef = useRef<{ width: number; height: number } | undefined>(undefined)
  const recordingBlobRef = useRef<Blob | null>(null)
  // One object URL per recording, shared by the results clip and the replay;
  // revoked when the recording is replaced/cleared and when App unmounts.
  const [recordingUrlSlot] = useState(createObjectUrlSlot)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  // DEV preview only: the first dance's reference video stands in for the user's clip
  const [previewClipUrl, setPreviewClipUrl] = useState<string | null>(null)

  const setRecording = useCallback((blob: Blob | null) => {
    recordingBlobRef.current = blob
    setRecordingUrl(recordingUrlSlot.set(blob))
    if (blob) setPreviewClipUrl(null)
  }, [recordingUrlSlot])

  const clearRecording = useCallback(() => {
    setRecording(null)
    setPreviewClipUrl(null)
  }, [setRecording])

  useEffect(() => () => recordingUrlSlot.dispose(), [recordingUrlSlot])

  const fetchDances = useCallback(async () => {
    setDancesLoading(true)
    setDancesError(null)
    try {
      setApiDances(await fetchCompletedApiDances())
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

  // Bundled dances (public/dances/manifest.json): loaded once, independent of the API server
  useEffect(() => {
    const controller = new AbortController()
    loadBundledDances(undefined, { signal: controller.signal }).then((dances) => {
      if (!controller.signal.aborted) setBundledDances(dances)
    })
    return () => controller.abort()
  }, [])

  // DEV-only: resolve ?preview=... once the dance lists are known (see readPreviewMode)
  useEffect(() => {
    if (!import.meta.env.DEV || !previewMode) return
    const controller = new AbortController()
    const { signal } = controller
    Promise.all([
      fetchCompletedApiDances(signal).catch((): DanceInfo[] => []),
      loadBundledDances(undefined, { signal }),
    ]).then(([api, bundled]) => {
      if (signal.aborted) return
      const hidden = readHiddenBundled()
      const firstDance = [...api, ...bundled.filter((d) => !hidden.includes(d.id))][0] ?? null
      const next = buildPreviewView(previewMode, firstDance)
      if (next) setView(next)
      if (previewMode === 'results') setPreviewClipUrl(firstDance?.videoUrl ?? null)
      setPreviewMode(null)
    })
    return () => controller.abort()
  }, [previewMode])

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
          applyPendingMirror(jobId, job.danceId)
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
    // The Map is mutated in place (never replaced), so capturing it here is equivalent
    const intervals = pollIntervalsRef.current
    return () => {
      intervals.forEach((interval) => clearInterval(interval))
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
  const visibleBundled = bundledDances.filter((d) => !hiddenBundled.includes(d.id))
  const allDances = dancesError
    ? visibleBundled
    : [...processingDances, ...apiDances, ...visibleBundled]

  const handleDeleteDance = useCallback(async (dance: DanceInfo) => {
    if (dance.source === 'bundled') {
      setHiddenBundled((prev) => {
        const next = [...prev, dance.id]
        localStorage.setItem(HIDDEN_BUNDLED_KEY, JSON.stringify(next))
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

  const handleDanceFinish = useCallback(() => {
    if (view.screen !== 'dance') return

    // Held-out winner: movement hits, bounded timing, visibility and geometry.
    const result = computeDanceCraftScore(
      referencePosesRef.current,
      userPosesRef.current,
      10,
      referenceGeometryRef.current,
    )

    const scorePct = result.overallScore * 100
    const rank = result.rank

    // Arena: read this player's previous attempt BEFORE recording the new one
    const player = currentPlayer ?? { name: GUEST_NAME, isHost: false }
    const previousAttempt = getPreviousAttempt(view.dance.id, player.name)
    // The host re-dancing without ticking "I'm the host" is still the host
    // (otherwise the results would show a "Wasil vs Wasil" battle)
    const isHostAttempt = isHostAttemptFor(view.dance.id, player)
    recordArenaAttempt({
      danceId: view.dance.id,
      player: player.name,
      score: result.overallScore,
      rank,
      date: new Date().toISOString(),
      isHost: isHostAttempt,
      // Scores + evidence, so the next attempt's coach request can compare both
      attempt: toCoachAttempt(result),
    })

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

    setView({
      screen: 'results',
      dance: view.dance,
      result,
      difficulty: view.difficulty,
      playerName: player.name,
      previousAttempt,
      isHostAttempt,
      durationSeconds: computeDurationSeconds(referencePosesRef.current, view.dance, result),
      host: getHostForDance(view.dance.id),
      leaderboard: getLeaderboard(view.dance.id, 5),
    })
  }, [view, currentPlayer])

  // Stable identity (functional update) so ResultsScreen effects don't re-fire on App re-renders
  const handleStartCoachDrill = useCallback((plan: CoachPlan) => {
    setView((v) => (v.screen === 'results'
      ? { screen: 'practice', dance: v.dance, coachPlan: plan, difficulty: v.difficulty, returnTo: pickResultsData(v) }
      : v))
  }, [])

  const handleRecordingComplete = useCallback((blob: Blob) => {
    setRecording(blob)
  }, [setRecording])

  const handleRecordPose = useCallback((pose: Pose, time: number) => {
    userPosesRef.current.push({ time, pose })
  }, [])

  const openDifficultyModal = (dance: DanceInfo) => {
    setPlayerDraft({ name: currentPlayer?.name ?? '', isHost: currentPlayer?.isHost ?? false })
    setPendingDance(dance)
  }

  // "Next challenger": forget the current identity so the next person types their own name
  const handleNextChallenger = () => {
    setPlayerDraft({ name: '', isHost: false })
    setCurrentPlayer(null)
    setCurrentPlayerState(null)
  }

  // Picking a difficulty saves the player (empty name -> "Guest") and starts the dance
  const startDance = (dance: DanceInfo, difficulty: Difficulty) => {
    const player: ArenaPlayer = { name: resolvePlayerName(playerDraft.name), isHost: playerDraft.isHost }
    setCurrentPlayer(player)
    setCurrentPlayerState(player)
    userPosesRef.current = []
    clearRecording()
    setView({ screen: 'dance', dance, difficulty })
    setPendingDance(null)
  }

  if (previewMode) {
    return (
      <div className="app">
        <p className="arena-preview-loading">Loading preview…</p>
      </div>
    )
  }

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
    const { dance, coachPlan, difficulty, returnTo } = view
    return (
      <div className="app">
        <PracticeMode
          key={practiceKey(dance, coachPlan)}
          referencePoseUrl={dance.poseDataUrl}
          referenceVideoUrl={dance.videoUrl}
          danceId={dance.id}
          coachPlan={coachPlan ?? null}
          onRetryDance={() => {
            userPosesRef.current = []
            clearRecording()
            setView({ screen: 'dance', dance, difficulty: difficulty ?? 'normal' })
          }}
          onBack={() => setView(returnTo ? { ...returnTo, screen: 'results' } : { screen: 'home' })}
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

  // The user's clip for results/replay: the recording, or (dev preview) a stand-in
  const clipUrl = recordingUrl ?? previewClipUrl
  const isPreviewClip = !recordingUrl && !!previewClipUrl

  if (view.screen === 'replay') {
    return (
      <div className="app">
        <ReplayMode
          referenceVideoUrl={view.dance.videoUrl}
          referencePoseUrl={view.dance.poseDataUrl}
          danceId={view.dance.id}
          userVideoUrl={clipUrl ?? ''}
          userVideoLabel={isPreviewClip ? 'PREVIEW CLIP' : undefined}
          mirrorUserVideo={!isPreviewClip}
          userPoses={userPosesRef.current}
          sectionScores={view.result.sectionScores}
          sessionMeta={{
            date: new Date().toISOString(),
            score: view.result.overallScore * 100,
            rank: view.result.rank,
          }}
          onBack={() => setView({ ...view, screen: 'results' })}
        />
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
            clearRecording()
            setView({ screen: 'dance', dance: view.dance, difficulty: view.difficulty })
          }}
          onHome={() => {
            clearRecording()
            setView({ screen: 'home' })
          }}
          onReplay={clipUrl ? () => setView({ ...view, screen: 'replay' }) : undefined}
          clipUrl={clipUrl}
          clipLabel={isPreviewClip ? 'Preview clip' : undefined}
          onOpenHistory={() => setView({ screen: 'history' })}
          danceId={view.dance.id}
          poseDataUrl={view.dance.poseDataUrl || undefined}
          durationSeconds={view.durationSeconds}
          playerName={view.playerName}
          previousAttempt={view.previousAttempt}
          host={view.host}
          isHostAttempt={view.isHostAttempt}
          leaderboard={view.leaderboard}
          onStartCoachDrill={handleStartCoachDrill}
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
          onReferenceGeometryLoaded={(geometry) => {
            referenceGeometryRef.current = geometry
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
        currentPlayer={currentPlayer}
        onSelectDance={openDifficultyModal}
        onPracticeDance={(dance) => setView({ screen: 'practice', dance })}
        onDeleteDance={handleDeleteDance}
        onDebugDance={(dance) => setView({ screen: 'debug', dance })}
        onSettings={() => setView({ screen: 'settings' })}
        onHistory={() => setView({ screen: 'history' })}
        onAddDance={() => setShowAddDance(true)}
      />
      {showAddDance && (
        <AddDance
          apiBase={API_BASE}
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
            <PlayerSetup
              name={playerDraft.name}
              isHost={playerDraft.isHost}
              onChange={setPlayerDraft}
              onNextChallenger={handleNextChallenger}
              hostToBeat={getHostForDance(pendingDance.id)}
            />
            <p className="difficulty-subtitle">Choose Difficulty</p>
            <div className="difficulty-options">
              {(['easy', 'normal', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  className={`difficulty-btn difficulty-btn-${d}`}
                  onClick={() => startDance(pendingDance, d)}
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
