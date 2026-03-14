import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
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

  // Reference pose data for ghost overlay
  const referencePosesRef = useRef<{ time: number; keypoints: Keypoint[] }[]>([])

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

    // Check if video ended
    if (refVideo && refVideo.ended) {
      setPhase('paused')
      return
    }

    animFrameRef.current = requestAnimationFrame(practiceLoop)
  }, [drawPose])

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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, pause, startResume])

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

      {/* Progress bar */}
      {(phase === 'playing' || phase === 'paused' || phase === 'resuming') && (
        <div className="dance-progress-bar">
          <div className="dance-progress-fill" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
          <div className="dance-progress-time">
            {duration > 0 ? `${formatTime(currentTime)} / ${formatTime(duration)}` : ''}
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
