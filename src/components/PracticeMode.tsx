import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import type { PoseTimeline } from '../scoring/keyPoseDetection'
import type { Pose, Keypoint } from '../scoring/types'

type PracticePhase = 'loading' | 'ready' | 'playing' | 'paused' | 'resuming'

interface PracticeModeProps {
  referencePoseUrl: string
  referenceVideoUrl?: string
  onBack: () => void
}

export function PracticeMode({ referencePoseUrl, referenceVideoUrl, onBack }: PracticeModeProps) {
  const webcamRef = useRef<HTMLVideoElement>(null)
  const refVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<PracticePhase>('loading')
  const [resumeCountdown, setResumeCountdown] = useState(3)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [loopCount, setLoopCount] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // Reference pose data for ghost overlay
  const referencePosesRef = useRef<{ time: number; keypoints: Keypoint[] }[]>([])
  const [keyPoseTimestamps, setKeyPoseTimestamps] = useState<number[]>([])

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

  // Detection loop
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
    if (userPose) {
      drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
    }

    // Update time tracking
    const refVideo = refVideoRef.current
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
  }, [drawPose, loopStart, loopEnd])

  // Load reference poses and initialize
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const response = await fetch(referencePoseUrl)
        if (!response.ok) throw new Error('Failed to load reference poses')
        const timeline: PoseTimeline = await response.json()

        // Store reference poses for potential ghost overlay
        referencePosesRef.current = timeline.keyframes.map((kf) => ({
          time: kf.time,
          keypoints: kf.keypoints as Keypoint[],
        }))

        // Detect key poses for timeline markers
        const keyPoses = detectKeyPoses(timeline, {
          minGapSeconds: 2.0,
          heldFrameCount: 8,
          distinctiveThreshold: 0.5,
        })
        setKeyPoseTimestamps(keyPoses.map((kp) => kp.timestamp))

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Webcam not available')
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        })
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
  }, [referencePoseUrl])

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

  // Seek to specific time
  const seekTo = useCallback((time: number) => {
    const refVideo = refVideoRef.current
    if (!refVideo) return
    const clamped = Math.max(0, Math.min(time, refVideo.duration || 0))
    refVideo.currentTime = clamped
    setCurrentTime(clamped)
  }, [])

  // Handle timeline click to seek
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const refVideo = refVideoRef.current
    if (refVideo && refVideo.duration) {
      seekTo(ratio * refVideo.duration)
    }
  }, [seekTo])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'playing') {
          pause()
        } else if (phase === 'paused') {
          startResume()
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 5
        seekTo(currentTime + step)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 5
        seekTo(currentTime - step)
      } else if (e.code === 'KeyA') {
        // Set loop start point
        setLoopStart(currentTime)
        setLoopCount(0)
      } else if (e.code === 'KeyB') {
        // Set loop end point (minimum 3 seconds from start)
        if (loopStart !== null && currentTime - loopStart >= 3) {
          setLoopEnd(currentTime)
          setLoopCount(0)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, pause, startResume, currentTime, seekTo, loopStart])

  // Keep detection loop running during pause (webcam stays active)
  useEffect(() => {
    if (phase !== 'paused' && phase !== 'resuming') return

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
      if (userPose) {
        drawPose(ctx, userPose, canvas.width, canvas.height, '#00ff88')
      }

      if (running) requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
    return () => { running = false }
  }, [phase, drawPose])

  if (error) {
    return <div className="dance-error">{error}</div>
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="practice-mode">
      {/* Practice mode badge */}
      <div className="practice-badge">PRACTICE MODE</div>

      {/* Reference video area */}
      <div className="dance-reference">
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

      {/* Timeline scrubber */}
      {(phase === 'playing' || phase === 'paused' || phase === 'resuming') && (
        <div className="practice-scrubber-container">
          <div className="practice-scrubber" onClick={handleTimelineClick}>
            <div className="practice-scrubber-track">
              <div
                className="practice-scrubber-fill"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              {/* Loop section highlight */}
              {duration > 0 && loopStart !== null && loopEnd !== null && (
                <div
                  className="practice-scrubber-loop"
                  style={{
                    left: `${(loopStart / duration) * 100}%`,
                    width: `${((loopEnd - loopStart) / duration) * 100}%`,
                  }}
                />
              )}
              {/* Key pose markers */}
              {duration > 0 && keyPoseTimestamps.map((t, i) => (
                <div
                  key={i}
                  className="practice-scrubber-marker"
                  style={{ left: `${(t / duration) * 100}%` }}
                  title={`Key pose at ${formatTime(t)}`}
                />
              ))}
              {/* Scrubber handle */}
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

      {/* Ready overlay */}
      {phase === 'ready' && (
        <div className="dance-ready-overlay" onClick={startPractice}>
          <div className="dance-ready-text">Tap to Start Practice</div>
          <div className="dance-ready-hint">Press Space to pause/resume at any time</div>
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
          <div className="practice-paused-hint">Study the current pose</div>
          <button className="practice-resume-btn" onClick={startResume}>
            Resume
          </button>
          <div className="practice-paused-shortcut">or press Space</div>
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

      {/* Back button */}
      <button className="practice-back-btn" onClick={onBack}>
        Back
      </button>

      {/* Pause button (visible during playing) */}
      {phase === 'playing' && (
        <button className="practice-pause-btn" onClick={pause}>
          Pause
        </button>
      )}
    </div>
  )
}
