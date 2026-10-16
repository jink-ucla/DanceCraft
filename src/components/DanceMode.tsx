import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_COLOR,
  SKELETON_COLOR,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import { getWebcamStream } from './Settings'
import { comparePoses, compareMoveVelocity } from '../scoring/comparison'
import type { Difficulty, DifficultyConfig } from '../storage/scores'
import { DIFFICULTY_CONFIGS } from '../storage/scores'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import { checkPresence } from '../scoring/presence'
import { MovementTracker } from '../scoring/movement'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'
import { TargetPoseFigure } from './TargetPoseFigure'
import type { Pose, Keypoint } from '../scoring/types'
import type { TimestampedPose } from '../scoring/dtw'

type DancePhase = 'loading' | 'ready' | 'countdown' | 'dancing' | 'finished'
type FeedbackType = 'perfect' | 'good' | 'miss' | null

interface DanceModeProps {
  referencePoseUrl: string
  referenceVideoUrl?: string
  mirrorVideo?: boolean
  customKeyPoses?: KeyPose[] | null
  difficulty?: Difficulty
  onFinish?: (score: number, totalHits: number, totalPoses: number) => void
  onRecordPose?: (pose: Pose, time: number, videoTime?: number) => void
  onReferencePosesLoaded?: (poses: TimestampedPose[]) => void
  onReferenceGeometryLoaded?: (geometry: { width: number; height: number }) => void
  onRecordingComplete?: (blob: Blob) => void
  onBack?: () => void
}

interface FeedbackDisplay {
  type: FeedbackType
  timestamp: number
}

export function DanceMode({ referencePoseUrl, referenceVideoUrl, mirrorVideo, customKeyPoses, difficulty = 'normal', onFinish, onRecordPose, onReferencePosesLoaded, onReferenceGeometryLoaded, onRecordingComplete, onBack }: DanceModeProps) {
  const diffConfig: DifficultyConfig = DIFFICULTY_CONFIGS[difficulty]
  const webcamRef = useRef<HTMLVideoElement>(null)
  const refVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null)
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTrackRef = useRef<CanvasCaptureMediaStreamTrack | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const activeRef = useRef(true)
  const startingRef = useRef(false)

  const [phase, setPhase] = useState<DancePhase>('loading')
  const [countdown, setCountdown] = useState(3)
  const [score, setScore] = useState(0)
  const [displayScore, setDisplayScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [comboKey, setComboKey] = useState(0)
  const [comboBroke, setComboBroke] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackDisplay>({ type: null, timestamp: 0 })
  const [totalHits, setTotalHits] = useState(0)
  const [error, setError] = useState('')
  const [volume, setVolume] = useState(0.7)
  const [isMuted, setIsMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [targetPose, setTargetPose] = useState<{ pose: Pose; progress: number } | null>(null)

  const keyPosesRef = useRef<KeyPose[]>([])
  const nextKeyPoseIdxRef = useRef(0)
  const danceStartTimeRef = useRef(0)
  const totalKeyPosesRef = useRef(0)
  const movementTrackerRef = useRef(new MovementTracker())
  // Recording clock, independent of the reference video's media clock.
  const recordingStartRef = useRef(0)

  // Animate displayed score toward actual score
  useEffect(() => {
    if (displayScore === score) return
    const step = Math.max(1, Math.ceil((score - displayScore) / 10))
    const timer = setTimeout(() => {
      setDisplayScore((d) => Math.min(d + step, Math.floor(score)))
    }, 20)
    return () => clearTimeout(timer)
  }, [displayScore, score])

  // Track video progress
  useEffect(() => {
    if (phase !== 'dancing') return
    const video = refVideoRef.current
    if (!video) return
    const updateProgress = () => {
      if (video.duration && isFinite(video.duration)) {
        setVideoDuration(video.duration)
        setProgress(video.currentTime / video.duration)
      }
    }
    const interval = setInterval(updateProgress, 250)
    return () => clearInterval(interval)
  }, [phase])

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

    const refVideo = refVideoRef.current
    // For game scoring: use refVideo time (synced to music)
    const elapsed = refVideo ? refVideo.currentTime : (Date.now() - danceStartTimeRef.current) / 1000

    // Freeze one input image BEFORE inference. Reading the live video again after
    // inference can record a newer frame than the pose describes.
    const inferenceCanvas = inferenceCanvasRef.current
    const inputContext = inferenceCanvas?.getContext('2d')
    if (inferenceCanvas && inputContext) {
      inputContext.drawImage(video, 0, 0, inferenceCanvas.width, inferenceCanvas.height)
    }
    const userPose = await estimatePose(inferenceCanvas && inputContext ? inferenceCanvas : video)
    if (!activeRef.current) return

    // Submit this same frozen image to the recording. Inference completion is
    // its capture-stream time, NOT its reference/music time. Persist both clocks.
    const compositeCanvas = compositeCanvasRef.current
    const recordingContext = compositeCanvas?.getContext('2d')
    if (compositeCanvas && recordingContext) {
      recordingContext.drawImage(inferenceCanvas && inputContext ? inferenceCanvas : video, 0, 0, compositeCanvas.width, compositeCanvas.height)
    }
    const videoTime = (performance.now() - recordingStartRef.current) / 1000
    recordingTrackRef.current?.requestFrame()

    // Check key pose matches — track target pose display even without user
    const keyPoses = keyPosesRef.current
    const nextIdx = nextKeyPoseIdxRef.current

    // Show upcoming target pose with timing
    const LEAD_TIME = diffConfig.leadTime
    if (nextIdx < keyPoses.length) {
      const nextKP = keyPoses[nextIdx]
      const timeUntil = nextKP.timestamp - elapsed
      if (timeUntil <= LEAD_TIME && timeUntil > -diffConfig.windowAfter) {
        const progress = Math.min(1, 1 - timeUntil / LEAD_TIME)
        setTargetPose({ pose: nextKP.pose, progress })
      } else if (timeUntil > LEAD_TIME) {
        setTargetPose(null)
      }
    } else {
      setTargetPose(null)
    }

    // Layer 1: Presence gate — skip scoring if user not sufficiently visible
    const presence = checkPresence(userPose)

    // Keep timing anchors even when a person is not detected. Empty keypoints
    // also preserve missing coverage for scoring instead of hiding that time.
    onRecordPose?.(userPose ?? { keypoints: [] }, elapsed, mediaRecorderRef.current ? videoTime : undefined)

    if (userPose && presence.present) {
      drawPose(ctx, userPose, canvas.width, canvas.height)

      // Layer 2: Feed movement tracker
      movementTrackerRef.current.addFrame(userPose, elapsed)
      const movementFactor = movementTrackerRef.current.getMovementFactor()

      if (nextIdx < keyPoses.length) {
        const nextKP = keyPoses[nextIdx]
        const timeUntilHit = nextKP.timestamp - elapsed

        // Score within the timing window (configurable by difficulty)
        if (timeUntilHit <= diffConfig.windowBefore && timeUntilHit >= -diffConfig.windowAfter) {
          let effectiveScore: number

          if (nextKP.type === 'move' && nextKP.expectedVelocity) {
            // Move scoring: blend velocity match (60%) + pose match (40%)
            const pastPose = movementTrackerRef.current.getRecentPose(nextKP.moveWindow ?? 0.3)
            const velocityScore = pastPose
              ? compareMoveVelocity(nextKP.expectedVelocity, pastPose, userPose, nextKP.focusJoints)
              : 0
            const poseResult = comparePoses(nextKP.pose, userPose, {
              focusJoints: nextKP.focusJoints,
              focusWeight: diffConfig.focusWeight,
              nonFocusWeight: diffConfig.nonFocusWeight,
            })
            effectiveScore = (0.6 * velocityScore + 0.4 * poseResult.overallScore) * movementFactor
          } else {
            // Static pose scoring
            const result = comparePoses(nextKP.pose, userPose, {
              focusJoints: nextKP.focusJoints,
              focusWeight: diffConfig.focusWeight,
              nonFocusWeight: diffConfig.nonFocusWeight,
            })
            // Apply movement factor: standing still → effective score ~0
            effectiveScore = result.overallScore * movementFactor
          }

          if (effectiveScore >= diffConfig.perfectThreshold) {
            showFeedback('perfect')
            setScore((s) => s + 100 * (1 + combo * 0.1))
            setCombo((c) => c + 1)
            setComboKey((k) => k + 1)
            setTotalHits((h) => h + 1)
            setTargetPose(null)
            nextKeyPoseIdxRef.current++
          } else if (effectiveScore >= diffConfig.goodThreshold) {
            showFeedback('good')
            setScore((s) => s + 50 * (1 + combo * 0.05))
            setCombo((c) => c + 1)
            setComboKey((k) => k + 1)
            setTotalHits((h) => h + 1)
            setTargetPose(null)
            nextKeyPoseIdxRef.current++
          } else if (elapsed > nextKP.timestamp + diffConfig.windowAfter) {
            // Missed — past the window
            showFeedback('miss')
            setCombo((c) => {
              if (c > 1) setComboBroke(true)
              return 0
            })
            setTargetPose(null)
            nextKeyPoseIdxRef.current++
          }
        } else if (elapsed > nextKP.timestamp + diffConfig.windowAfter) {
          // Completely missed
          showFeedback('miss')
          setCombo((c) => {
            if (c > 1) setComboBroke(true)
            return 0
          })
          setTargetPose(null)
          nextKeyPoseIdxRef.current++
        }
      }
    } else {
      // User not present — let key pose windows expire as misses
      if (nextIdx < keyPoses.length) {
        const nextKP = keyPoses[nextIdx]
        if (elapsed > nextKP.timestamp + 0.5) {
          showFeedback('miss')
          setCombo((c) => {
            if (c > 1) setComboBroke(true)
            return 0
          })
          setTargetPose(null)
          nextKeyPoseIdxRef.current++
        }
      }
    }

    // Check if dance is over
    {
      const videoEnded = refVideo && refVideo.ended
      const pastLastPose = nextIdx >= keyPoses.length &&
        elapsed > keyPoses[keyPoses.length - 1]?.timestamp + 2
      if (videoEnded || pastLastPose) {
        setPhase('finished')
        return
      }
    }

    animFrameRef.current = requestAnimationFrame(danceLoop)
  }, [drawPose, showFeedback, combo])

  // Load reference poses and initialize
  useEffect(() => {
    let cancelled = false
    activeRef.current = true

    async function init() {
      try {
        // Load reference pose data
        if (!referencePoseUrl) throw new Error('This dance has no reference pose data')
        const response = await fetch(referencePoseUrl)
        if (!response.ok) throw new Error('Failed to load reference poses')
        const timeline: PoseTimeline = await response.json()

        // Use custom key poses if provided, otherwise auto-detect
        const keyPoses = customKeyPoses ?? detectKeyPoses(timeline, {
          minGapSeconds: 3.0,
          heldFrameCount: 8,
          distinctiveThreshold: 1.0,
        })
        keyPosesRef.current = keyPoses
        totalKeyPosesRef.current = keyPoses.length

        // Pass reference poses to parent for post-dance DTW scoring
        const refPoses: TimestampedPose[] = timeline.keyframes.map((kf) => ({
          time: kf.time,
          pose: { keypoints: kf.keypoints as Keypoint[] },
        }))
        onReferencePosesLoaded?.(refPoses)

        // Start webcam
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

        // Initialize composite canvas for recording (same dimensions as webcam)
        const compositeCanvas = compositeCanvasRef.current
        if (compositeCanvas) {
          compositeCanvas.width = video.videoWidth
          compositeCanvas.height = video.videoHeight
        }
        const inferenceCanvas = document.createElement('canvas')
        inferenceCanvas.width = video.videoWidth
        inferenceCanvas.height = video.videoHeight
        inferenceCanvasRef.current = inferenceCanvas

        // Init pose detector
        await initDetector()
        // Pay the first-inference/GPU warm-up cost before music starts.
        await estimatePose(video)

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
      activeRef.current = false
      cancelAnimationFrame(animFrameRef.current)
      disposeDetector()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      // Stop recording if still active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
        mediaRecorderRef.current = null
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      recordingTrackRef.current = null
      inferenceCanvasRef.current = null
    }
  }, [referencePoseUrl])

  // Start with a real webcam image, not the canvas's initial transparent frame.
  // Manual frame requests preserve wall-clock PTS even when inference is slow;
  // they do not pretend that a variable-rate recording is constant 30 fps.
  const startRecording = useCallback(async (): Promise<void> => {
    const compositeCanvas = compositeCanvasRef.current
    if (!compositeCanvas) return

    try {
      const webcam = webcamRef.current
      const context = compositeCanvas.getContext('2d')
      if (webcam && context) context.drawImage(webcam, 0, 0, compositeCanvas.width, compositeCanvas.height)
      let stream = compositeCanvas.captureStream(0)
      let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      if (typeof track.requestFrame !== 'function') {
        stream.getTracks().forEach((item) => item.stop())
        stream = compositeCanvas.captureStream(30)
        track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      }
      recordingStreamRef.current = stream
      recordingTrackRef.current = typeof track.requestFrame === 'function' ? track : null
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm'

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1_500_000,
      })

      recordedChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data)
        }
      }
      mediaRecorderRef.current = recorder
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Recording did not start')), 2000)
        recorder.onstart = () => {
          clearTimeout(timeout)
          // Submit a real initial image and allow a paint before inference can
          // replace it. In particular, automatic canvas capture must not drop
          // the complete lead-in while waiting for the first changed canvas.
          recordingStartRef.current = performance.now()
          if (webcam && context) context.drawImage(webcam, 0, 0, compositeCanvas.width, compositeCanvas.height)
          recordingTrackRef.current?.requestFrame()
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }
        recorder.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('Recording failed'))
        }
        recorder.start(1000)
        recordingTrackRef.current?.requestFrame()
      })
    } catch {
      // Graceful degradation: recording fails silently, dance continues
      if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      recordingTrackRef.current = null
    }
  }, [])

  // Stop recording and produce blob — returns a promise that resolves when blob is ready
  const stopRecording = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve()
        return
      }

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType })
        onRecordingComplete?.(blob)
        recordedChunksRef.current = []
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        recordingTrackRef.current = null
        resolve()
      }
      recorder.stop()
      mediaRecorderRef.current = null
    })
  }, [onRecordingComplete])

  // Countdown timer
  useEffect(() => {
    if (phase !== 'countdown') return

    if (countdown <= 0) {
      if (startingRef.current) return
      startingRef.current = true
      ;(async () => {
        // Recorder startup and play() are asynchronous. Wait for both rather
        // than assigning an invented common zero point to two queued calls.
        await startRecording()
        if (!activeRef.current) return
        const reference = refVideoRef.current
        if (reference) {
          reference.currentTime = 0
          reference.muted = false
          reference.volume = volume
          try {
            await reference.play()
          } catch {
            setError('The dance video could not start. Go back and try again.')
            await stopRecording()
            return
          }
        }
        if (!activeRef.current) return
        danceStartTimeRef.current = Date.now()
        nextKeyPoseIdxRef.current = 0
        movementTrackerRef.current.reset()
        setPhase('dancing')
        animFrameRef.current = requestAnimationFrame(danceLoop)
      })()
      return
    }

    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, danceLoop, volume, startRecording, stopRecording])

  // Handle finish — wait for recording blob before calling onFinish
  useEffect(() => {
    if (phase !== 'finished') return
    cancelAnimationFrame(animFrameRef.current)
    if (refVideoRef.current) {
      refVideoRef.current.pause()
    }
    stopRecording().then(() => {
      onFinish?.(score, totalHits, totalKeyPosesRef.current)
    })
  }, [phase, score, totalHits, onFinish, stopRecording])

  // Clear combo break indicator after animation.
  // Must stay above the early error return: hooks may never be skipped
  // (a failed pose load used to crash with "Rendered fewer hooks than expected").
  useEffect(() => {
    if (!comboBroke) return
    const timer = setTimeout(() => setComboBroke(false), 600)
    return () => clearTimeout(timer)
  }, [comboBroke])

  if (error) {
    return (
      <div className="dance-mode">
        <div className="dance-error" style={{ minHeight: '100%' }}>{error}</div>
        {onBack && (
          <button className="dance-back-btn" onClick={onBack}>
            Back
          </button>
        )}
      </div>
    )
  }

  const hitRate = totalKeyPosesRef.current > 0 ? totalHits / totalKeyPosesRef.current : 0
  const isHighScore = hitRate >= 0.6

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="dance-mode">
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
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              onReferenceGeometryLoaded?.({ width: video.videoWidth, height: video.videoHeight })
            }}
            style={mirrorVideo ? { transform: 'scaleX(-1)' } : undefined}
          />
        ) : (
          <div className="dance-reference-placeholder">
            Reference Dance
            {phase === 'dancing' && (
              <div className="dance-timer">
                {Math.floor((Date.now() - danceStartTimeRef.current) / 1000)}s
              </div>
            )}
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

      {/* Hidden composite canvas for recording (webcam + skeleton overlay) */}
      <canvas
        ref={compositeCanvasRef}
        style={{ display: 'none' }}
      />

      {/* HUD */}
      <div className="dance-hud">
        <div className="dance-score-container">
          <div className="dance-score-label">SCORE</div>
          <div className="dance-score" key={`score-${Math.floor(score)}`}>
            {displayScore}
          </div>
        </div>
        {combo > 1 && (
          <div className="dance-combo" key={`combo-${comboKey}`}>
            <span className="dance-combo-multiplier">{combo}x</span>
            <span className="dance-combo-text">COMBO</span>
          </div>
        )}
        {comboBroke && (
          <div className="dance-combo-break">Combo Break!</div>
        )}
        {/* Target pose figure with border countdown */}
        {targetPose && phase === 'dancing' && (
          <div
            className={`dance-target-pose ${targetPose.progress >= 0.85 ? 'dance-target-pose-hit' : ''}`}
            key={`pose-${nextKeyPoseIdxRef.current}`}
            style={{
              '--countdown-progress': `${targetPose.progress * 100}%`,
            } as React.CSSProperties}
          >
            <TargetPoseFigure pose={targetPose.pose} size={90} />
            {targetPose.progress >= 0.85 && (
              <div className="dance-target-now">NOW</div>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {phase === 'dancing' && (
        <div className="dance-progress-bar">
          <div className="dance-progress-fill" style={{ width: `${progress * 100}%` }} />
          <div className="dance-progress-time">
            {videoDuration > 0
              ? `${formatTime(progress * videoDuration)} / ${formatTime(videoDuration)}`
              : ''}
          </div>
        </div>
      )}

      {/* Volume control */}
      {(phase === 'dancing' || phase === 'ready' || phase === 'countdown') && (
        <div className="dance-volume-control">
          <button
            className="dance-volume-btn"
            onClick={() => {
              setIsMuted((m) => {
                const newMuted = !m
                if (refVideoRef.current) refVideoRef.current.muted = newMuted
                return newMuted
              })
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? '🔇' : volume > 0.5 ? '🔊' : '🔉'}
          </button>
          <input
            type="range"
            className="dance-volume-slider"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              setVolume(v)
              setIsMuted(v === 0)
              if (refVideoRef.current) {
                refVideoRef.current.volume = v
                refVideoRef.current.muted = v === 0
              }
            }}
          />
        </div>
      )}

      {/* Ready overlay - tap to start (ensures user interaction for autoplay with audio) */}
      {phase === 'ready' && (
        <div className="dance-ready-overlay" onClick={() => setPhase('countdown')}>
          <div className="dance-ready-text">Tap to Start</div>
          <div className="dance-ready-hint">Music will play during the dance</div>
        </div>
      )}

      {/* Countdown overlay */}
      {phase === 'countdown' && (
        <div className="dance-countdown-overlay">
          <div className="dance-countdown-number" key={`cd-${countdown}`}>
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

      {/* Back button */}
      {onBack && (
        <button className="dance-back-btn" onClick={onBack}>
          Back
        </button>
      )}

      {/* Feedback flash */}
      {feedback.type && (
        <div className={`dance-feedback dance-feedback-${feedback.type}`} key={feedback.timestamp}>
          {feedback.type === 'perfect' && 'Perfect!'}
          {feedback.type === 'good' && 'Good!'}
          {feedback.type === 'miss' && 'Miss'}
        </div>
      )}

      {/* Finished overlay */}
      {phase === 'finished' && (
        <div className={`dance-finished-overlay ${isHighScore ? 'dance-finished-celebrate' : ''}`}>
          {isHighScore && (
            <div className="dance-confetti" aria-hidden="true">
              {Array.from({ length: 30 }, (_, i) => (
                <span
                  key={i}
                  className="dance-confetti-piece"
                  style={{
                    left: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 0.5}s`,
                    animationDuration: `${1.5 + Math.random() * 1.5}s`,
                    backgroundColor: ['#00ff88', '#ffcc00', '#00ccff', '#ff6b6b', '#ff88ff'][i % 5],
                  }}
                />
              ))}
            </div>
          )}
          <h2 className="dance-finished-title">{isHighScore ? 'Amazing!' : 'Dance Complete!'}</h2>
          <div className="dance-final-score">
            {Math.floor(score)}
          </div>
          <div className="dance-final-score-label">points</div>
          <div className="dance-final-hits">
            {totalHits} / {totalKeyPosesRef.current} poses hit
          </div>
        </div>
      )}
    </div>
  )
}
