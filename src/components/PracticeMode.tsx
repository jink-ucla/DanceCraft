import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import { comparePoses } from '../scoring/comparison'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'
import type { Pose, Keypoint } from '../scoring/types'
import { TargetPoseFigure } from './TargetPoseFigure'
import { loadDanceSettings, saveDanceSettings, setDanceMirror, extractYoutubeEmbedId } from '../storage/danceSettings'
import { getWebcamStream } from './Settings'
import { COACH_SPEEDS, MIN_DRILL_SECONDS } from '../coach/types'
import type { CoachPlan } from '../coach/types'
import {
  advanceDrill,
  clampRepeats,
  createDrillState,
  currentRepNumber,
  effectiveLoopEnd,
  formatClock,
  formatDrillRange,
  formatSpeed,
  isValidDrillLoop,
  repProgress,
  resetDrill,
  resolveDrillRange,
  restartRep,
  shouldWrapLoop,
} from '../coach/drill'
import type { DrillState } from '../coach/drill'
import './PracticeDrill.css'
import './Mirror.css'

type PracticePhase = 'loading' | 'ready' | 'playing' | 'paused' | 'resuming'
type PracticeTab = 'practice' | 'tutorial'

interface PracticeModeProps {
  referencePoseUrl: string
  referenceVideoUrl?: string
  danceId: string
  onBack: () => void
  /** AI coach plan: when set, practice opens as a guided drill of the plan's section. */
  coachPlan?: CoachPlan | null
  /** Called once when the coach drill finishes all its repeats. */
  onCoachDrillComplete?: () => void
  /** "Try the full dance again" — App routes to DanceMode for this dance. */
  onRetryDance?: () => void
}

/** A running coach drill: the plan it came from plus its rep counter. */
interface DrillSession {
  plan: CoachPlan
  state: DrillState
}

/** One tick of the playing-state loop. Resolves false to stop the loop. */
type PracticeFrame = (isCurrent: () => boolean) => Promise<boolean>

function scoreToGrade(score: number): { label: string; color: string } {
  if (score >= 0.85) return { label: 'Perfect', color: '#00ff88' }
  if (score >= 0.70) return { label: 'Good', color: '#00ccff' }
  if (score >= 0.55) return { label: 'OK', color: '#ffcc00' }
  return { label: 'Miss', color: '#ff6666' }
}

/** Browsers can reset playbackRate (load, play), so set both rates. */
function applyPlaybackRate(video: HTMLVideoElement, speed: number) {
  if (video.defaultPlaybackRate !== speed) video.defaultPlaybackRate = speed
  if (video.playbackRate !== speed) video.playbackRate = speed
}

export function PracticeMode({
  referencePoseUrl,
  referenceVideoUrl,
  danceId,
  onBack,
  coachPlan,
  onCoachDrillComplete,
  onRetryDance,
}: PracticeModeProps) {
  const webcamRef = useRef<HTMLVideoElement>(null)
  const refVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<PracticePhase>('loading')
  const [activeTab, setActiveTab] = useState<PracticeTab>('practice')
  const [resumeCountdown, setResumeCountdown] = useState(3)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [loopCount, setLoopCount] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [showGhostOverlay, setShowGhostOverlay] = useState(true)

  // The rAF loop reads these refs (never stale closures), so A/B and drill
  // changes made during playback apply on the next frame.
  const loopStartRef = useRef<number | null>(null)
  const loopEndRef = useRef<number | null>(null)
  const playbackSpeedRef = useRef(1)
  /** Bumped to invalidate the running rAF loop; only one loop may run. */
  const loopTokenRef = useRef(0)
  /** Reference-video time seen by the previous loop tick. */
  const lastTimeRef = useRef(0)
  /** Set by manual seeks so the drill does not count them as reps. */
  const seekedRef = useRef(false)

  // AI coach drill
  const drillRef = useRef<DrillSession | null>(null)
  const [drill, setDrill] = useState<DrillSession | null>(null)
  const onDrillCompleteRef = useRef(onCoachDrillComplete)
  useEffect(() => { onDrillCompleteRef.current = onCoachDrillComplete }, [onCoachDrillComplete])

  // Pose scoring overlay (toggle on free practice)
  const [showPoseScore, setShowPoseScore] = useState(false)
  const showPoseScoreRef = useRef(false)
  const [liveScore, setLiveScore] = useState<number | null>(null)
  const [nearestKeyPose, setNearestKeyPose] = useState<KeyPose | null>(null)

  // Keep ref in sync with state
  useEffect(() => { showPoseScoreRef.current = showPoseScore }, [showPoseScore])

  // Reference pose data
  const referencePosesRef = useRef<{ time: number; keypoints: Keypoint[] }[]>([])
  const [keyPoseTimestamps, setKeyPoseTimestamps] = useState<number[]>([])
  const [keyPoses, setKeyPoses] = useState<KeyPose[]>([])

  // Tutorial
  const [settings, setSettings] = useState(() => loadDanceSettings(danceId))
  const [tutorialInput, setTutorialInput] = useState(settings.tutorialUrl)
  const tutorialEmbedId = extractYoutubeEmbedId(settings.tutorialUrl)

  // Draw pose overlay on webcam canvas
  const drawPose = useCallback(
    (ctx: CanvasRenderingContext2D, pose: Pose, _width: number, _height: number, color: string) => {
      const keypoints = pose.keypoints

      ctx.strokeStyle = color
      ctx.lineWidth = 2
      for (const [i, j] of SKELETON_CONNECTIONS) {
        const kpA = keypoints[i]
        const kpB = keypoints[j]
        if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
          ctx.beginPath()
          ctx.moveTo(kpA.x, kpA.y)
          ctx.lineTo(kpB.x, kpB.y)
          ctx.stroke()
        }
      }

      ctx.fillStyle = color
      for (const kp of keypoints) {
        if (kp.score > 0.3) {
          ctx.beginPath()
          ctx.arc(kp.x, kp.y, KEYPOINT_RADIUS, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
    },
    []
  )

  // Draw reference ghost skeleton at current time
  const drawGhostPose = useCallback((ctx: CanvasRenderingContext2D, time: number, canvasWidth: number, canvasHeight: number, isPaused: boolean) => {
    if (!showGhostOverlay) return

    const refPoses = referencePosesRef.current
    if (refPoses.length === 0) return

    let closest = refPoses[0]
    let closestDiff = Math.abs(closest.time - time)
    for (const rp of refPoses) {
      const diff = Math.abs(rp.time - time)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = rp
      }
    }

    if (closestDiff > 0.5) return

    const alpha = isPaused ? 0.6 : 0.3
    const color = `rgba(0, 170, 255, ${alpha})`
    const keypoints = closest.keypoints

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    for (const [i, j] of SKELETON_CONNECTIONS) {
      const kpA = keypoints[i]
      const kpB = keypoints[j]
      if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
        ctx.beginPath()
        ctx.moveTo(kpA.x * canvasWidth / 320, kpA.y * canvasHeight / 240)
        ctx.lineTo(kpB.x * canvasWidth / 320, kpB.y * canvasHeight / 240)
        ctx.stroke()
      }
    }

    ctx.fillStyle = color
    for (const kp of keypoints) {
      if (kp.score > 0.3) {
        ctx.beginPath()
        ctx.arc(kp.x * canvasWidth / 320, kp.y * canvasHeight / 240, KEYPOINT_RADIUS + 1, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }, [showGhostOverlay])

  // Get reference pose at a given time
  const getRefPoseAtTime = useCallback((time: number): Pose | null => {
    const refPoses = referencePosesRef.current
    if (refPoses.length === 0) return null

    let closest = refPoses[0]
    let closestDiff = Math.abs(closest.time - time)
    for (const rp of refPoses) {
      const diff = Math.abs(rp.time - time)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = rp
      }
    }
    if (closestDiff > 0.5) return null
    return { keypoints: closest.keypoints }
  }, [])

  // Find nearest key pose to a given time
  const findNearestKeyPose = useCallback((time: number): KeyPose | null => {
    let nearest: KeyPose | null = null
    let nearestDist = Infinity
    for (const kp of keyPoses) {
      const dist = Math.abs(kp.timestamp - time)
      if (dist < nearestDist) {
        nearest = kp
        nearestDist = dist
      }
    }
    return nearest
  }, [keyPoses])

  const commitDrill = useCallback((next: DrillSession | null) => {
    drillRef.current = next
    setDrill(next)
  }, [])

  // A/B loop bounds: state for rendering, refs for the rAF loop
  const setLoopBounds = useCallback((start: number | null, end: number | null) => {
    loopStartRef.current = start
    loopEndRef.current = end
    setLoopStart(start)
    setLoopEnd(end)
  }, [])

  const changeSpeed = useCallback((speed: number) => {
    playbackSpeedRef.current = speed
    setPlaybackSpeed(speed)
    const refVideo = refVideoRef.current
    if (refVideo) applyPlaybackRate(refVideo, speed)
  }, [])

  // play() and re-apply the speed once it resolves (browsers may reset it)
  const playReference = useCallback((video: HTMLVideoElement) => {
    applyPlaybackRate(video, playbackSpeedRef.current)
    video.play()
      .then(() => applyPlaybackRate(video, playbackSpeedRef.current))
      .catch(() => {})
  }, [])

  const stopPracticeLoop = useCallback(() => {
    loopTokenRef.current += 1
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  // One tick of the playing-state loop: loop/drill bookkeeping, then pose overlay
  const practiceFrame = useCallback<PracticeFrame>(async (isCurrent) => {
    const refVideo = refVideoRef.current
    if (refVideo) {
      const time = refVideo.currentTime
      if (refVideo.duration) {
        setCurrentTime(time)
        setDuration(refVideo.duration)
      }

      const seeked = seekedRef.current
      seekedRef.current = false
      const prevTime = lastTimeRef.current
      lastTimeRef.current = time

      // Check loop boundaries (bounds read from refs, never stale)
      let wrapped = false
      const start = loopStartRef.current
      const rawEnd = loopEndRef.current
      if (start !== null && rawEnd !== null) {
        const end = effectiveLoopEnd(rawEnd, refVideo.duration)
        const session = drillRef.current
        if (session && !session.state.completed) {
          const step = advanceDrill(session.state, { prevTime, currentTime: time, loopStart: start, loopEnd: end, seeked })
          if (step.state !== session.state) {
            const next: DrillSession = { plan: session.plan, state: step.state }
            drillRef.current = next
            if (step.counted) setDrill(next)
          }
          if (step.completed) {
            stopPracticeLoop()
            refVideo.pause()
            refVideo.currentTime = start
            lastTimeRef.current = start
            setCurrentTime(start)
            setPhase('paused')
            onDrillCompleteRef.current?.()
            return false
          }
          wrapped = step.wrapped
        } else {
          wrapped = shouldWrapLoop(time, start, end)
          if (wrapped) setLoopCount((c) => c + 1)
        }

        if (wrapped) {
          refVideo.currentTime = start
          lastTimeRef.current = start
          // A loop ending at the very end of the video: playback stopped there
          if (refVideo.paused) playReference(refVideo)
        }
      }

      // Check if video ended
      if (!wrapped && refVideo.ended) {
        setPhase('paused')
        return false
      }
    }

    const video = webcamRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return true

    const ctx = canvas.getContext('2d')
    if (!ctx) return true

    const userPose = await estimatePose(video)
    if (!isCurrent()) return false

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Get current video time for scoring
    const videoTime = refVideoRef.current?.currentTime ?? 0

    if (userPose) {
      // If pose scoring is on, color skeleton by score
      if (showPoseScoreRef.current) {
        const refPose = getRefPoseAtTime(videoTime)
        if (refPose) {
          const result = comparePoses(refPose, userPose)
          const grade = scoreToGrade(result.overallScore)
          drawPose(ctx, userPose, canvas.width, canvas.height, grade.color)
          setLiveScore(result.overallScore)
        } else {
          drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
          setLiveScore(null)
        }
        setNearestKeyPose(findNearestKeyPose(videoTime))
      } else {
        drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
        setLiveScore(null)
      }
    }

    // Draw ghost reference pose
    if (refVideoRef.current) {
      drawGhostPose(ctx, videoTime, canvas.width, canvas.height, false)
    }

    return true
  }, [drawPose, drawGhostPose, getRefPoseAtTime, findNearestKeyPose, playReference, stopPracticeLoop])

  // The loop always calls the latest frame (fresh ghost / key-pose settings)
  const practiceFrameRef = useRef<PracticeFrame>(practiceFrame)
  useEffect(() => { practiceFrameRef.current = practiceFrame }, [practiceFrame])

  // Start the playing-state detection loop, replacing any loop already running
  const startPracticeLoop = useCallback(() => {
    stopPracticeLoop()
    const token = loopTokenRef.current
    const isCurrent = () => token === loopTokenRef.current
    const tick = async () => {
      if (!isCurrent()) return
      let keepGoing = true
      try {
        keepGoing = await practiceFrameRef.current(isCurrent)
      } catch {
        // a failed pose estimate should not kill playback bookkeeping
      }
      if (keepGoing && isCurrent()) {
        animFrameRef.current = requestAnimationFrame(tick)
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [stopPracticeLoop])

  // Load reference poses and initialize (cleanup also cancels the rAF loop)
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        if (!referencePoseUrl) throw new Error('This dance has no reference pose data')
        const response = await fetch(referencePoseUrl)
        if (!response.ok) throw new Error('Failed to load reference poses')
        const timeline: PoseTimeline = await response.json()

        referencePosesRef.current = timeline.keyframes.map((kf) => ({
          time: kf.time,
          keypoints: kf.keypoints as Keypoint[],
        }))

        const danceSettings = loadDanceSettings(danceId)
        const detected = danceSettings.customKeyPoses ?? detectKeyPoses(timeline, {
          minGapSeconds: 2.0,
          heldFrameCount: 8,
          distinctiveThreshold: 0.5,
        })
        setKeyPoses(detected)
        setKeyPoseTimestamps(detected.map((kp) => kp.timestamp))

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Webcam not available')
        }

        const stream = await getWebcamStream(320, 240)
        streamRef.current = stream

        const video = webcamRef.current
        if (!video || cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        video.srcObject = stream
        await video.play()

        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }

        await initDetector()

        if (!cancelled) {
          setPhase('ready')
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      stopPracticeLoop()
      disposeDetector()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [referencePoseUrl, danceId, stopPracticeLoop])

  /**
   * Start (or restart) a coach drill: loop the plan's section at the plan's
   * speed from its start. keepLoop = "Drill Again": keep the current A/B loop
   * and speed (the user may have tweaked them) and just reset the reps.
   */
  const launchDrill = useCallback((plan: CoachPlan, keepLoop: boolean) => {
    const refVideo = refVideoRef.current
    let start = loopStartRef.current
    let end = loopEndRef.current
    if (!keepLoop || start === null || end === null || !isValidDrillLoop(start, end)) {
      const range = resolveDrillRange(plan, refVideo?.duration)
      start = range.start
      end = range.end
      setLoopBounds(start, end)
    }

    const previous = drillRef.current
    commitDrill({
      plan,
      state: keepLoop && previous ? resetDrill(previous.state) : createDrillState(plan),
    })
    if (!keepLoop) changeSpeed(plan.playbackSpeed)
    setLoopCount(0)
    seekedRef.current = false
    lastTimeRef.current = start

    if (refVideo) {
      refVideo.currentTime = start
      refVideo.muted = false
      refVideo.volume = 0.7
      playReference(refVideo)
    }
    setCurrentTime(start)
    setPhase('playing')
    startPracticeLoop()
  }, [setLoopBounds, commitDrill, changeSpeed, playReference, startPracticeLoop])

  // Start practice
  const startPractice = useCallback(() => {
    if (coachPlan) {
      launchDrill(coachPlan, false)
      return
    }
    const refVideo = refVideoRef.current
    seekedRef.current = false
    lastTimeRef.current = 0
    if (refVideo) {
      refVideo.currentTime = 0
      refVideo.muted = false
      refVideo.volume = 0.7
      playReference(refVideo)
    }
    setPhase('playing')
    startPracticeLoop()
  }, [coachPlan, launchDrill, playReference, startPracticeLoop])

  // Pause
  const pause = useCallback(() => {
    stopPracticeLoop()
    const refVideo = refVideoRef.current
    if (refVideo) refVideo.pause()
    setPhase('paused')
  }, [stopPracticeLoop])

  // Resume instantly (no countdown)
  const resumeInstant = useCallback(() => {
    const refVideo = refVideoRef.current
    if (refVideo) playReference(refVideo)
    setPhase('playing')
    startPracticeLoop()
  }, [playReference, startPracticeLoop])

  // Resume with countdown
  const startResume = useCallback(() => {
    setResumeCountdown(3)
    setPhase('resuming')
  }, [])

  // Resume countdown
  useEffect(() => {
    if (phase !== 'resuming') return

    if (resumeCountdown <= 0) {
      const refVideo = refVideoRef.current
      if (refVideo) playReference(refVideo)
      setPhase('playing')
      startPracticeLoop()
      return
    }

    const timer = setTimeout(() => setResumeCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, resumeCountdown, playReference, startPracticeLoop])

  // Seek
  const seekTo = useCallback((time: number) => {
    const refVideo = refVideoRef.current
    if (!refVideo) return
    const clamped = Math.max(0, Math.min(time, refVideo.duration || 0))
    refVideo.currentTime = clamped
    seekedRef.current = true
    setCurrentTime(clamped)
  }, [])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const refVideo = refVideoRef.current
    if (refVideo && refVideo.duration) {
      seekTo(ratio * refVideo.duration)
    }
  }, [seekTo])

  // Click video to pause/play
  const handleVideoClick = useCallback(() => {
    if (phase === 'playing') {
      pause()
    } else if (phase === 'paused') {
      resumeInstant()
    }
  }, [phase, pause, resumeInstant])

  // A/B loop editing. Loops shorter than MIN_DRILL_SECONDS are refused; an A
  // that would make one drops B (and leaves drill mode, the loop is gone).
  const markLoopStart = useCallback((time: number) => {
    const end = loopEndRef.current
    if (end !== null && end - time < MIN_DRILL_SECONDS) {
      setLoopBounds(time, null)
      commitDrill(null)
    } else {
      setLoopBounds(time, end)
      const session = drillRef.current
      if (session) {
        // the playhead now sits on the loop start: next pass is a full rep
        drillRef.current = { plan: session.plan, state: restartRep(session.state) }
        seekedRef.current = false
        lastTimeRef.current = time
      }
    }
    setLoopCount(0)
  }, [setLoopBounds, commitDrill])

  const markLoopEnd = useCallback((time: number) => {
    const start = loopStartRef.current
    if (start !== null && time - start >= MIN_DRILL_SECONDS) {
      setLoopBounds(start, time)
      setLoopCount(0)
    }
  }, [setLoopBounds])

  // Clearing the loop manually exits drill mode
  const clearLoop = useCallback(() => {
    setLoopBounds(null, null)
    setLoopCount(0)
    commitDrill(null)
  }, [setLoopBounds, commitDrill])

  // Drill complete overlay actions
  const drillAgain = useCallback(() => {
    const session = drillRef.current
    if (session) launchDrill(session.plan, true)
  }, [launchDrill])

  // Leave drill mode but stay paused in normal practice (loop + speed kept)
  const freePractice = useCallback(() => {
    commitDrill(null)
  }, [commitDrill])

  const drillComplete = drill !== null && drill.state.completed
  const drillRunning = drill !== null && !drill.state.completed

  // Keyboard shortcuts
  useEffect(() => {
    if (activeTab === 'tutorial') return

    const handleKeyDown = (e: KeyboardEvent) => {
      // The drill-complete overlay owns the screen; let its buttons handle keys
      if (drillComplete) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'ready') {
          if (coachPlan) startPractice()
        } else if (phase === 'playing') {
          pause()
        } else if (phase === 'paused') {
          if (e.shiftKey) startResume()
          else resumeInstant()
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seekTo(currentTime + (e.shiftKey ? 1 : 5))
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seekTo(currentTime - (e.shiftKey ? 1 : 5))
      } else if (e.code === 'KeyA') {
        markLoopStart(currentTime)
      } else if (e.code === 'KeyB') {
        markLoopEnd(currentTime)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, pause, startResume, resumeInstant, currentTime, seekTo, activeTab, drillComplete, coachPlan, startPractice, markLoopStart, markLoopEnd])

  // Keep detection loop running during pause (for live scoring)
  useEffect(() => {
    if (phase !== 'paused' && phase !== 'resuming') return
    if (activeTab !== 'practice') return

    let running = true
    const loop = async () => {
      const video = webcamRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        if (running) requestAnimationFrame(loop)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const userPose = await estimatePose(video)

      const refVideo = refVideoRef.current
      const videoTime = refVideo?.currentTime ?? 0

      if (userPose) {
        if (showPoseScoreRef.current) {
          const refPose = getRefPoseAtTime(videoTime)
          if (refPose) {
            const result = comparePoses(refPose, userPose)
            const grade = scoreToGrade(result.overallScore)
            drawPose(ctx, userPose, canvas.width, canvas.height, grade.color)
            setLiveScore(result.overallScore)
          } else {
            drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
            setLiveScore(null)
          }
          setNearestKeyPose(findNearestKeyPose(videoTime))
        } else {
          drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
        }
      }

      if (refVideo) {
        drawGhostPose(ctx, refVideo.currentTime, canvas.width, canvas.height, true)
      }

      if (running) requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
    return () => { running = false }
  }, [phase, drawPose, drawGhostPose, activeTab, getRefPoseAtTime, findNearestKeyPose])

  // Re-apply the playback speed when the reference video (re)loads or starts
  // playing — browsers can reset playbackRate — and keep a drill in its section.
  useEffect(() => {
    if (activeTab !== 'practice' || !referenceVideoUrl) return
    const video = refVideoRef.current
    if (!video) return

    const reapplySpeed = () => applyPlaybackRate(video, playbackSpeedRef.current)
    const handleLoadedMetadata = () => {
      reapplySpeed()
      const start = loopStartRef.current
      const end = loopEndRef.current
      if (drillRef.current && start !== null && end !== null && (video.currentTime < start || video.currentTime > end)) {
        video.currentTime = start
        lastTimeRef.current = start
      }
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('play', reapplySpeed)
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('play', reapplySpeed)
    }
  }, [activeTab, referenceVideoUrl])

  // Save tutorial URL
  const saveTutorialUrl = useCallback(() => {
    const newSettings = { ...settings, tutorialUrl: tutorialInput }
    saveDanceSettings(danceId, newSettings)
    setSettings(newSettings)
  }, [danceId, settings, tutorialInput])

  const clearTutorialUrl = useCallback(() => {
    const newSettings = { ...settings, tutorialUrl: '' }
    saveDanceSettings(danceId, newSettings)
    setSettings(newSettings)
    setTutorialInput('')
  }, [danceId, settings])

  // Per-video mirror (same setting as the dance card / Add Dance): flips the reference live
  const toggleMirror = useCallback(() => {
    const mirror = !settings.mirror
    setDanceMirror(danceId, mirror)
    setSettings((s) => ({ ...s, mirror }))
  }, [danceId, settings.mirror])

  if (error) {
    return (
      <div className="practice-mode">
        <div className="dance-error" style={{ minHeight: '100%' }}>{error}</div>
        <button className="practice-back-btn" onClick={onBack}>
          Back
        </button>
      </div>
    )
  }

  const formatTime = formatClock

  const grade = liveScore !== null ? scoreToGrade(liveScore) : null
  const inSession = phase === 'playing' || phase === 'paused' || phase === 'resuming'

  const readyRange = coachPlan ? resolveDrillRange(coachPlan, duration) : null
  const drillProgress = loopStart !== null && loopEnd !== null
    ? repProgress(currentTime, loopStart, effectiveLoopEnd(loopEnd, duration))
    : 0
  const drillProgressPct = Math.round(drillProgress * 100)

  return (
    <div className={`practice-mode${drillRunning ? ' drill-active' : ''}`}>
      {/* Tab bar */}
      <div className="practice-tabs">
        <button
          className={`practice-tab ${activeTab === 'practice' ? 'active' : ''}`}
          onClick={() => setActiveTab('practice')}
        >
          Practice
        </button>
        <button
          className={`practice-tab ${activeTab === 'tutorial' ? 'active' : ''}`}
          onClick={() => setActiveTab('tutorial')}
        >
          Tutorial
        </button>
      </div>

      {/* ===== TUTORIAL TAB ===== */}
      {activeTab === 'tutorial' && (
        <div className="practice-tutorial">
          {tutorialEmbedId ? (
            <>
              <div className="practice-tutorial-video">
                <iframe
                  src={`https://www.youtube.com/embed/${tutorialEmbedId}`}
                  title="Dance tutorial"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <button className="practice-tutorial-swap" onClick={clearTutorialUrl}>
                Change Video
              </button>
            </>
          ) : (
            <div className="practice-tutorial-empty">
              <p className="practice-tutorial-prompt">Add a YouTube tutorial video</p>
              <div className="practice-tutorial-input-row">
                <input
                  type="text"
                  className="practice-tutorial-input"
                  placeholder="https://youtube.com/watch?v=..."
                  value={tutorialInput}
                  onChange={(e) => setTutorialInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveTutorialUrl() }}
                />
                <button
                  className="practice-tutorial-add-btn"
                  onClick={saveTutorialUrl}
                  disabled={!tutorialInput.trim()}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== PRACTICE TAB ===== */}
      {activeTab === 'practice' && (
        <>
          {/* Reference video area — click to pause */}
          <div className="dance-reference" onClick={handleVideoClick} style={{ cursor: phase === 'playing' || phase === 'paused' ? 'pointer' : undefined }}>
            {referenceVideoUrl ? (
              <video
                ref={refVideoRef}
                src={referenceVideoUrl}
                className="dance-reference-video"
                playsInline
                muted
                preload="auto"
                style={settings.mirror ? { transform: 'scaleX(-1)' } : undefined}
              />
            ) : (
              <div className="dance-reference-placeholder">
                Reference Dance
              </div>
            )}
          </div>

          {/* Webcam PIP */}
          <div className="dance-webcam-pip">
            <div className="dance-pip-label">YOU</div>
            <video
              ref={webcamRef}
              playsInline
              muted
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={canvasRef}
              className="pose-overlay"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>

          {/* AI coach drill HUD */}
          {drillRunning && drill && inSession && (
            <div className="drill-hud" data-testid="drill-hud">
              <div className="drill-hud-row">
                <span className="drill-badge drill-hud-badge">AI DRILL</span>
                <span className="drill-hud-focus">{drill.plan.focus}</span>
                <span className="drill-hud-rep" aria-live="polite">
                  Rep {currentRepNumber(drill.state)} / {drill.state.repeats}
                </span>
                <span className="drill-hud-speed">{formatSpeed(playbackSpeed)}</span>
              </div>
              {drill.plan.cue && <div className="drill-hud-cue">{drill.plan.cue}</div>}
              <div className="drill-hud-progress-row">
                <div
                  className="drill-hud-progress"
                  role="progressbar"
                  aria-label="Current rep progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={drillProgressPct}
                >
                  <div className="drill-hud-progress-fill" style={{ width: `${drillProgressPct}%` }} />
                </div>
                <div className="drill-hud-pips" aria-hidden="true">
                  {Array.from({ length: drill.state.repeats }, (_, i) => (
                    <span
                      key={i}
                      className={`drill-hud-pip ${i < drill.state.completedReps ? 'done' : ''} ${i === drill.state.completedReps ? 'current' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pose score overlay — shows when toggle is on */}
          {showPoseScore && grade && (phase === 'playing' || phase === 'paused') && (
            <div className="practice-score-overlay">
              <div className="practice-score-grade" style={{ color: grade.color }}>
                {grade.label}
              </div>
              <div className="practice-score-bar">
                <div
                  className="practice-score-bar-fill"
                  style={{ width: `${(liveScore ?? 0) * 100}%`, background: grade.color }}
                />
              </div>
              <div className="practice-score-pct" style={{ color: grade.color }}>
                {Math.round((liveScore ?? 0) * 100)}%
              </div>
              {nearestKeyPose && Math.abs(nearestKeyPose.timestamp - currentTime) < 2 && (
                <div className="practice-score-keypose">
                  <TargetPoseFigure pose={nearestKeyPose.pose} size={50} />
                </div>
              )}
            </div>
          )}

          {/* Timeline scrubber */}
          {inSession && (
            <div className="practice-scrubber-container">
              <div className="practice-scrubber" onClick={handleTimelineClick}>
                <div className="practice-scrubber-track">
                  <div
                    className="practice-scrubber-fill"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                  {duration > 0 && loopStart !== null && loopEnd !== null && (
                    <div
                      className="practice-scrubber-loop"
                      style={{
                        left: `${(loopStart / duration) * 100}%`,
                        width: `${((loopEnd - loopStart) / duration) * 100}%`,
                      }}
                    />
                  )}
                  {duration > 0 && keyPoseTimestamps.map((t, i) => (
                    <div
                      key={i}
                      className="practice-scrubber-marker"
                      style={{ left: `${(t / duration) * 100}%` }}
                      title={`Key pose at ${formatTime(t)}`}
                    />
                  ))}
                  <div
                    className="practice-scrubber-handle"
                    style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="practice-scrubber-time">
                {duration > 0 ? `${formatTime(currentTime)} / ${formatTime(duration)}` : ''}
              </div>
            </div>
          )}

          {/* Loop & speed controls */}
          {inSession && (
            <div className="practice-loop-controls">
              <button
                className={`practice-loop-btn ${loopStart !== null ? 'active' : ''}`}
                onClick={() => markLoopStart(currentTime)}
                title="Set loop start (A)"
              >
                A {loopStart !== null ? formatTime(loopStart) : ''}
              </button>
              <button
                className={`practice-loop-btn ${loopEnd !== null ? 'active' : ''}`}
                onClick={() => markLoopEnd(currentTime)}
                disabled={loopStart === null}
                title="Set loop end (B)"
              >
                B {loopEnd !== null ? formatTime(loopEnd) : ''}
              </button>
              {(loopStart !== null || loopEnd !== null) && (
                <button
                  className="practice-loop-btn practice-loop-clear"
                  onClick={clearLoop}
                  title="Clear loop"
                >
                  Clear Loop
                </button>
              )}
              {loopStart !== null && loopEnd !== null && !drillRunning && (
                <span className="practice-loop-count">Loop #{loopCount + 1}</span>
              )}
              <div className="practice-speed-controls">
                {COACH_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    className={`practice-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
                    onClick={() => changeSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toggle buttons row */}
          {inSession && (
            <div className="practice-toggles-row">
              <button
                className={`practice-toggle-btn ${showGhostOverlay ? 'active' : ''}`}
                onClick={() => setShowGhostOverlay((v) => !v)}
              >
                Ghost {showGhostOverlay ? 'ON' : 'OFF'}
              </button>
              <button
                className={`practice-toggle-btn ${showPoseScore ? 'active' : ''}`}
                onClick={() => setShowPoseScore((v) => !v)}
              >
                Score {showPoseScore ? 'ON' : 'OFF'}
              </button>
              <button
                className={`practice-toggle-btn practice-mirror-btn ${settings.mirror ? 'active' : ''}`}
                onClick={toggleMirror}
                title="Flip the reference video left-right. Saved for this dance."
                aria-pressed={settings.mirror}
              >
                Mirror {settings.mirror ? 'ON' : 'OFF'}
              </button>
              {coachPlan && !drill && (
                <button
                  className="practice-toggle-btn drill-start-btn"
                  onClick={() => launchDrill(coachPlan, false)}
                  title="Restart the AI coach drill"
                >
                  AI Drill
                </button>
              )}
            </div>
          )}

          {/* Ready overlay — AI coach drill plan */}
          {phase === 'ready' && coachPlan && readyRange && (
            <div className="dance-ready-overlay drill-ready-overlay" onClick={startPractice}>
              <div className="drill-ready-plan">
                <div className="drill-badge">AI COACH DRILL</div>
                <div className="drill-ready-focus">{coachPlan.focus}</div>
                {coachPlan.cue && <div className="drill-ready-cue">{coachPlan.cue}</div>}
                <div className="drill-ready-stats">
                  <div className="drill-stat">
                    <span className="drill-stat-label">Section</span>
                    <span className="drill-stat-value drill-ready-range">
                      {formatDrillRange(readyRange.start, readyRange.end)}
                    </span>
                  </div>
                  <div className="drill-stat">
                    <span className="drill-stat-label">Speed</span>
                    <span className="drill-stat-value drill-ready-speed">{formatSpeed(coachPlan.playbackSpeed)}</span>
                  </div>
                  <div className="drill-stat">
                    <span className="drill-stat-label">Reps</span>
                    <span className="drill-stat-value drill-ready-reps">{clampRepeats(coachPlan.repeats)}</span>
                  </div>
                </div>
              </div>
              <div className="drill-ready-start">Tap to Start Drill</div>
              <div className="dance-ready-hint">Tap or press Space to start · Space pauses/resumes</div>
            </div>
          )}

          {/* Ready overlay */}
          {phase === 'ready' && !coachPlan && (
            <div className="dance-ready-overlay" onClick={startPractice}>
              <div className="dance-ready-text">Tap to Start Practice</div>
              <div className="dance-ready-hint">Click video or press Space to pause/resume</div>
            </div>
          )}

          {/* Loading overlay */}
          {phase === 'loading' && (
            <div className="dance-loading-overlay">
              <div>Loading practice session...</div>
            </div>
          )}

          {/* Paused overlay */}
          {phase === 'paused' && !drillComplete && (
            <div className="practice-paused-overlay">
              <div className="practice-paused-text">PAUSED</div>
              {showPoseScore && (
                <div className="practice-paused-hint">Match the pose — your score updates live</div>
              )}
              {!showPoseScore && (
                <div className="practice-paused-hint">Practice the current pose</div>
              )}
              <div className="practice-resume-buttons">
                <button className="practice-resume-btn" onClick={resumeInstant}>
                  Play
                </button>
                <button className="practice-resume-btn-secondary" onClick={startResume}>
                  3-2-1 Go
                </button>
              </div>
              <div className="practice-paused-shortcut">Space = play, Shift+Space = countdown</div>
            </div>
          )}

          {/* AI coach drill complete */}
          {drillComplete && drill && (
            <div className="drill-complete-overlay" role="dialog" aria-label="Drill complete">
              <div className="drill-complete-card">
                <div className="drill-badge">AI COACH DRILL</div>
                <div className="drill-complete-title">Drill complete!</div>
                <div className="drill-complete-summary">
                  {drill.state.repeats} {drill.state.repeats === 1 ? 'rep' : 'reps'} of {drill.plan.focus} at {formatSpeed(playbackSpeed)}
                </div>
                {drill.plan.encouragement && (
                  <div className="drill-complete-encouragement">{drill.plan.encouragement}</div>
                )}
                <div className="drill-complete-actions">
                  {onRetryDance && (
                    <button className="drill-btn drill-btn-primary drill-retry-btn" onClick={onRetryDance}>
                      Try Full Dance
                    </button>
                  )}
                  <button
                    className={`drill-btn drill-again-btn ${onRetryDance ? '' : 'drill-btn-primary'}`}
                    onClick={drillAgain}
                  >
                    Drill Again
                  </button>
                  <button className="drill-btn drill-free-btn" onClick={freePractice}>
                    Free Practice
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Resume countdown */}
          {phase === 'resuming' && (
            <div className="dance-countdown-overlay">
              <div className="dance-countdown-number" key={`cd-${resumeCountdown}`}>
                {resumeCountdown > 0 ? resumeCountdown : 'GO!'}
              </div>
            </div>
          )}

          {/* Pause button */}
          {phase === 'playing' && (
            <button className="practice-pause-btn" onClick={pause}>
              Pause
            </button>
          )}
        </>
      )}

      {/* Back button */}
      <button className="practice-back-btn" onClick={onBack}>
        Back
      </button>
    </div>
  )
}
