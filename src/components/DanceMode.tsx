import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_COLOR,
  SKELETON_COLOR,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import { comparePoses } from '../scoring/comparison'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'
import type { Pose } from '../scoring/types'

type DancePhase = 'loading' | 'countdown' | 'dancing' | 'finished'
type FeedbackType = 'perfect' | 'good' | 'miss' | null

interface DanceModeProps {
  referencePoseUrl: string
  onFinish?: (score: number, totalHits: number, totalPoses: number) => void
}

interface FeedbackDisplay {
  type: FeedbackType
  timestamp: number
}

export function DanceMode({ referencePoseUrl, onFinish }: DanceModeProps) {
  const webcamRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<DancePhase>('loading')
  const [countdown, setCountdown] = useState(3)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [feedback, setFeedback] = useState<FeedbackDisplay>({ type: null, timestamp: 0 })
  const [totalHits, setTotalHits] = useState(0)
  const [error, setError] = useState('')

  const keyPosesRef = useRef<KeyPose[]>([])
  const nextKeyPoseIdxRef = useRef(0)
  const danceStartTimeRef = useRef(0)
  const totalKeyPosesRef = useRef(0)

  // Draw pose overlay on webcam canvas
  const drawPose = useCallback(
    (ctx: CanvasRenderingContext2D, pose: Pose, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height)
      const keypoints = pose.keypoints

      ctx.strokeStyle = SKELETON_COLOR
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

      ctx.fillStyle = KEYPOINT_COLOR
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

  // Show feedback flash
  const showFeedback = useCallback((type: FeedbackType) => {
    setFeedback({ type, timestamp: Date.now() })
    setTimeout(() => {
      setFeedback((prev) => {
        if (Date.now() - prev.timestamp >= 800) return { type: null, timestamp: 0 }
        return prev
      })
    }, 900)
  }, [])

  // Main detection loop during dancing
  const danceLoop = useCallback(async () => {
    const video = webcamRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(danceLoop)
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const userPose = await estimatePose(video)
    if (userPose) {
      drawPose(ctx, userPose, canvas.width, canvas.height)

      // Check key pose matches
      const elapsed = (Date.now() - danceStartTimeRef.current) / 1000
      const keyPoses = keyPosesRef.current
      const nextIdx = nextKeyPoseIdxRef.current

      if (nextIdx < keyPoses.length) {
        const nextKP = keyPoses[nextIdx]
        const timeDiff = Math.abs(elapsed - nextKP.timestamp)

        // Check if we're within the hit window (±0.5 seconds)
        if (timeDiff <= 0.5) {
          const result = comparePoses(nextKP.pose, userPose)

          if (result.overallScore >= 0.85) {
            showFeedback('perfect')
            setScore((s) => s + 100 * (1 + combo * 0.1))
            setCombo((c) => c + 1)
            setTotalHits((h) => h + 1)
            nextKeyPoseIdxRef.current++
          } else if (result.overallScore >= 0.65) {
            showFeedback('good')
            setScore((s) => s + 50 * (1 + combo * 0.05))
            setCombo((c) => c + 1)
            setTotalHits((h) => h + 1)
            nextKeyPoseIdxRef.current++
          } else if (elapsed > nextKP.timestamp + 0.5) {
            // Missed — past the window
            showFeedback('miss')
            setCombo(0)
            nextKeyPoseIdxRef.current++
          }
        } else if (elapsed > nextKP.timestamp + 0.5) {
          // Completely missed
          showFeedback('miss')
          setCombo(0)
          nextKeyPoseIdxRef.current++
        }
      }

      // Check if dance is over
      if (
        nextIdx >= keyPoses.length &&
        elapsed > keyPoses[keyPoses.length - 1]?.timestamp + 2
      ) {
        setPhase('finished')
        return
      }
    }

    animFrameRef.current = requestAnimationFrame(danceLoop)
  }, [drawPose, showFeedback, combo])

  // Load reference poses and initialize
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // Load reference pose data
        const response = await fetch(referencePoseUrl)
        if (!response.ok) throw new Error('Failed to load reference poses')
        const timeline: PoseTimeline = await response.json()

        // Detect key poses
        const keyPoses = detectKeyPoses(timeline, {
          minGapSeconds: 2.0,
          heldFrameCount: 8,
          distinctiveThreshold: 0.5,
        })
        keyPosesRef.current = keyPoses
        totalKeyPosesRef.current = keyPoses.length

        // Start webcam
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

        // Init pose detector
        await initDetector()

        if (!cancelled) {
          setPhase('countdown')
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

  // Countdown timer
  useEffect(() => {
    if (phase !== 'countdown') return

    if (countdown <= 0) {
      setPhase('dancing')
      danceStartTimeRef.current = Date.now()
      nextKeyPoseIdxRef.current = 0
      animFrameRef.current = requestAnimationFrame(danceLoop)
      return
    }

    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, danceLoop])

  // Handle finish
  useEffect(() => {
    if (phase === 'finished') {
      cancelAnimationFrame(animFrameRef.current)
      onFinish?.(score, totalHits, totalKeyPosesRef.current)
    }
  }, [phase, score, totalHits, onFinish])

  if (error) {
    return <div className="dance-error">{error}</div>
  }

  return (
    <div className="dance-mode">
      {/* Reference video area (placeholder — uses pose data only for now) */}
      <div className="dance-reference">
        <div className="dance-reference-placeholder">
          Reference Dance
          {phase === 'dancing' && (
            <div className="dance-timer">
              {Math.floor((Date.now() - danceStartTimeRef.current) / 1000)}s
            </div>
          )}
        </div>
      </div>

      {/* Webcam PIP */}
      <div className="dance-webcam-pip">
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

      {/* HUD */}
      <div className="dance-hud">
        <div className="dance-score">
          {Math.floor(score)}
        </div>
        {combo > 1 && (
          <div className="dance-combo">{combo}x Combo</div>
        )}
      </div>

      {/* Countdown overlay */}
      {phase === 'countdown' && (
        <div className="dance-countdown-overlay">
          <div className="dance-countdown-number">
            {countdown > 0 ? countdown : 'GO!'}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {phase === 'loading' && (
        <div className="dance-loading-overlay">
          <div>Loading dance...</div>
        </div>
      )}

      {/* Feedback flash */}
      {feedback.type && (
        <div className={`dance-feedback dance-feedback-${feedback.type}`}>
          {feedback.type === 'perfect' && 'Perfect!'}
          {feedback.type === 'good' && 'Good!'}
          {feedback.type === 'miss' && 'Miss'}
        </div>
      )}

      {/* Finished overlay */}
      {phase === 'finished' && (
        <div className="dance-finished-overlay">
          <h2>Dance Complete!</h2>
          <div className="dance-final-score">
            Score: {Math.floor(score)}
          </div>
          <div className="dance-final-hits">
            Hits: {totalHits} / {totalKeyPosesRef.current}
          </div>
        </div>
      )}
    </div>
  )
}
