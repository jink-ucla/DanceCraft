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
import { loadDanceSettings, saveDanceSettings, extractYoutubeEmbedId } from '../storage/danceSettings'
import { getWebcamStream } from './Settings'

type PracticePhase = 'loading' | 'ready' | 'playing' | 'paused' | 'resuming'
type PracticeTab = 'practice' | 'tutorial'

interface PracticeModeProps {
  referencePoseUrl: string
  referenceVideoUrl?: string
  danceId: string
  onBack: () => void
}

function scoreToGrade(score: number): { label: string; color: string } {
  if (score >= 0.85) return { label: 'Perfect', color: '#00ff88' }
  if (score >= 0.70) return { label: 'Good', color: '#00ccff' }
  if (score >= 0.55) return { label: 'OK', color: '#ffcc00' }
  return { label: 'Miss', color: '#ff6666' }
}

export function PracticeMode({ referencePoseUrl, referenceVideoUrl, danceId, onBack }: PracticeModeProps) {
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

  // Detection loop — handles both playing and scoring
  const practiceLoop = useCallback(async () => {
    const video = webcamRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(practiceLoop)
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const userPose = await estimatePose(video)

    // Get current video time for scoring
    const refVideo = refVideoRef.current
    const videoTime = refVideo?.currentTime ?? 0

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
    if (refVideo) {
      drawGhostPose(ctx, refVideo.currentTime, canvas.width, canvas.height, false)
    }

    if (refVideo && refVideo.duration) {
      setCurrentTime(refVideo.currentTime)
      setDuration(refVideo.duration)
    }

    // Check loop boundaries
    if (refVideo && loopStart !== null && loopEnd !== null) {
      if (refVideo.currentTime >= loopEnd) {
        refVideo.currentTime = loopStart
        setLoopCount((c) => c + 1)
      }
    }

    // Check if video ended
    if (refVideo && refVideo.ended) {
      setPhase('paused')
      return
    }

    animFrameRef.current = requestAnimationFrame(practiceLoop)
  }, [drawPose, drawGhostPose, loopStart, loopEnd, getRefPoseAtTime, findNearestKeyPose])

  // Load reference poses and initialize
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
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
      cancelAnimationFrame(animFrameRef.current)
      disposeDetector()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [referencePoseUrl, danceId])

  // Start practice
  const startPractice = useCallback(() => {
    const refVideo = refVideoRef.current
    if (refVideo) {
      refVideo.currentTime = 0
      refVideo.muted = false
      refVideo.volume = 0.7
      refVideo.play().catch(() => {})
    }
    setPhase('playing')
    animFrameRef.current = requestAnimationFrame(practiceLoop)
  }, [practiceLoop])

  // Pause
  const pause = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    const refVideo = refVideoRef.current
    if (refVideo) refVideo.pause()
    setPhase('paused')
  }, [])

  // Resume instantly (no countdown)
  const resumeInstant = useCallback(() => {
    const refVideo = refVideoRef.current
    if (refVideo) refVideo.play().catch(() => {})
    setPhase('playing')
    animFrameRef.current = requestAnimationFrame(practiceLoop)
  }, [practiceLoop])

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
      if (refVideo) refVideo.play().catch(() => {})
      setPhase('playing')
      animFrameRef.current = requestAnimationFrame(practiceLoop)
      return
    }

    const timer = setTimeout(() => setResumeCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, resumeCountdown, practiceLoop])

  // Seek
  const seekTo = useCallback((time: number) => {
    const refVideo = refVideoRef.current
    if (!refVideo) return
    const clamped = Math.max(0, Math.min(time, refVideo.duration || 0))
    refVideo.currentTime = clamped
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

  // Keyboard shortcuts
  useEffect(() => {
    if (activeTab === 'tutorial') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'playing') {
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
        setLoopStart(currentTime)
        setLoopCount(0)
      } else if (e.code === 'KeyB') {
        if (loopStart !== null && currentTime - loopStart >= 3) {
          setLoopEnd(currentTime)
          setLoopCount(0)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, pause, startResume, resumeInstant, currentTime, seekTo, loopStart, activeTab])

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

  if (error) {
    return <div className="dance-error">{error}</div>
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const grade = liveScore !== null ? scoreToGrade(liveScore) : null

  return (
    <div className="practice-mode">
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
          {(phase === 'playing' || phase === 'paused' || phase === 'resuming') && (
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
          {(phase === 'playing' || phase === 'paused' || phase === 'resuming') && (
            <div className="practice-loop-controls">
              <button
                className={`practice-loop-btn ${loopStart !== null ? 'active' : ''}`}
                onClick={() => { setLoopStart(currentTime); setLoopCount(0) }}
                title="Set loop start (A)"
              >
                A {loopStart !== null ? formatTime(loopStart) : ''}
              </button>
              <button
                className={`practice-loop-btn ${loopEnd !== null ? 'active' : ''}`}
                onClick={() => {
                  if (loopStart !== null && currentTime - loopStart >= 3) {
                    setLoopEnd(currentTime)
                    setLoopCount(0)
                  }
                }}
                disabled={loopStart === null}
                title="Set loop end (B)"
              >
                B {loopEnd !== null ? formatTime(loopEnd) : ''}
              </button>
              {(loopStart !== null || loopEnd !== null) && (
                <button
                  className="practice-loop-btn practice-loop-clear"
                  onClick={() => { setLoopStart(null); setLoopEnd(null); setLoopCount(0) }}
                  title="Clear loop"
                >
                  Clear Loop
                </button>
              )}
              {loopStart !== null && loopEnd !== null && (
                <span className="practice-loop-count">Loop #{loopCount + 1}</span>
              )}
              <div className="practice-speed-controls">
                {[0.5, 0.75, 1].map((speed) => (
                  <button
                    key={speed}
                    className={`practice-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
                    onClick={() => {
                      setPlaybackSpeed(speed)
                      const refVideo = refVideoRef.current
                      if (refVideo) refVideo.playbackRate = speed
                    }}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toggle buttons row */}
          {(phase === 'playing' || phase === 'paused' || phase === 'resuming') && (
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
            </div>
          )}

          {/* Ready overlay */}
          {phase === 'ready' && (
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
          {phase === 'paused' && (
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
