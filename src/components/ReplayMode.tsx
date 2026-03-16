import { useEffect, useRef, useState, useCallback } from 'react'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import type { Keypoint } from '../scoring/types'
import type { TimestampedPose, SectionScore } from '../scoring/dtw'
import { computePostDanceScore } from '../scoring/dtw'
import { TargetPoseFigure } from './TargetPoseFigure'
import { loadDanceSettings } from '../storage/danceSettings'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'

interface ReplayModeProps {
  referenceVideoUrl?: string
  referencePoseUrl?: string
  danceId?: string
  userVideoUrl: string
  userPosesUrl?: string // load poses from server (for history replay)
  userPoses: TimestampedPose[]
  sectionScores: SectionScore[]
  sessionMeta: {
    date: string
    score: number
    rank: string
  }
  onBack: () => void
}

const RANK_COLORS: Record<string, string> = {
  S: '#00ff88',
  A: '#00ccff',
  B: '#ffcc00',
  C: '#ff6b6b',
}

function scoreToColor(score: number): string {
  if (score >= 0.8) return '#00ff88'
  if (score >= 0.6) return '#ffcc00'
  return '#ff6b6b'
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Binary search for the closest pose to a given time. O(log n) instead of O(n). */
function findClosestPose(poses: TimestampedPose[], time: number): TimestampedPose | null {
  if (poses.length === 0) return null

  let lo = 0
  let hi = poses.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (poses[mid].time < time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  // Check lo and lo-1 for the closest
  let best = lo
  if (lo > 0 && Math.abs(poses[lo - 1].time - time) < Math.abs(poses[lo].time - time)) {
    best = lo - 1
  }

  return Math.abs(poses[best].time - time) <= 0.5 ? poses[best] : null
}

/**
 * Detect whether keypoints use normalized [0,1] coordinates or pixel coordinates.
 * Normalized: all visible x/y values are between 0 and 1.
 */
function isNormalized(keypoints: Keypoint[]): boolean {
  for (const kp of keypoints) {
    if (kp.score > 0.3 && (kp.x > 2 || kp.y > 2)) return false
  }
  return true
}

function drawSkeletonOnCanvas(
  ctx: CanvasRenderingContext2D,
  keypoints: Keypoint[],
  color: string,
  canvasWidth: number,
  canvasHeight: number,
) {
  // Scale factor: if keypoints are normalized [0,1], multiply by canvas size
  const normalized = isNormalized(keypoints)
  const sx = normalized ? canvasWidth : 1
  const sy = normalized ? canvasHeight : 1

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  for (const [i, j] of SKELETON_CONNECTIONS) {
    const kpA = keypoints[i]
    const kpB = keypoints[j]
    if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
      ctx.beginPath()
      ctx.moveTo(kpA.x * sx, kpA.y * sy)
      ctx.lineTo(kpB.x * sx, kpB.y * sy)
      ctx.stroke()
    }
  }

  ctx.fillStyle = color
  for (const kp of keypoints) {
    if (kp.score > 0.3) {
      ctx.beginPath()
      ctx.arc(kp.x * sx, kp.y * sy, KEYPOINT_RADIUS, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2]

export function ReplayMode({
  referenceVideoUrl,
  referencePoseUrl,
  danceId,
  userVideoUrl,
  userPosesUrl,
  userPoses: initialUserPoses,
  sectionScores: initialSectionScores,
  sessionMeta,
  onBack,
}: ReplayModeProps) {
  const refVideoRef = useRef<HTMLVideoElement>(null)
  const userVideoRef = useRef<HTMLVideoElement>(null)
  const userCanvasRef = useRef<HTMLCanvasElement>(null)
  const refCanvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [keyPoses, setKeyPoses] = useState<KeyPose[]>([])
  const [nearestKeyPose, setNearestKeyPose] = useState<KeyPose | null>(null)
  const [userPoses, setUserPoses] = useState<TimestampedPose[]>(initialUserPoses)
  const [sectionScores, setSectionScores] = useState<SectionScore[]>(initialSectionScores)
  const [swapped, setSwapped] = useState(false)
  const [showUserSkeleton, setShowUserSkeleton] = useState(true)
  const [showRefSkeleton, setShowRefSkeleton] = useState(false)
  const [syncOffset, setSyncOffset] = useState(0)
  const syncCalibratedRef = useRef(false)
  const referencePosesRef = useRef<TimestampedPose[]>([])

  // Load user poses from URL if provided (history replay)
  // Then compute section scores using DTW against reference poses
  useEffect(() => {
    if (!userPosesUrl || !referencePoseUrl) return
    ;(async () => {
      try {
        const [userRes, refRes] = await Promise.all([
          fetch(userPosesUrl),
          fetch(referencePoseUrl),
        ])
        if (!userRes.ok || !refRes.ok) return

        const loadedUserPoses: TimestampedPose[] = await userRes.json()
        setUserPoses(loadedUserPoses)

        const timeline: PoseTimeline = await refRes.json()
        const refPoses: TimestampedPose[] = timeline.keyframes.map(kf => ({
          time: kf.time,
          pose: { keypoints: kf.keypoints as Keypoint[] },
        }))
        referencePosesRef.current = refPoses

        // Compute section scores via DTW
        if (loadedUserPoses.length > 0 && refPoses.length > 0) {
          const result = computePostDanceScore(refPoses, loadedUserPoses)
          setSectionScores(result.sectionScores)
        }
      } catch { /* ignore */ }
    })()
  }, [userPosesUrl, referencePoseUrl])

  // Load key poses and reference poses for skeleton overlay
  useEffect(() => {
    if (!referencePoseUrl) return
    ;(async () => {
      try {
        const res = await fetch(referencePoseUrl)
        if (!res.ok) return
        const timeline: PoseTimeline = await res.json()

        // Store reference poses for skeleton drawing
        if (referencePosesRef.current.length === 0) {
          referencePosesRef.current = timeline.keyframes.map(kf => ({
            time: kf.time,
            pose: { keypoints: kf.keypoints as Keypoint[] },
          }))
        }

        const settings = danceId ? loadDanceSettings(danceId) : null
        const kps = settings?.customKeyPoses ?? detectKeyPoses(timeline, {
          minGapSeconds: 2.0,
          heldFrameCount: 8,
          distinctiveThreshold: 0.5,
        })
        setKeyPoses(kps)
      } catch { /* ignore */ }
    })()
  }, [referencePoseUrl, danceId])

  // Draw skeleton overlays — each uses its own video's currentTime
  const drawOverlays = useCallback((userTime: number, refTime: number) => {
    // User skeleton — pose timestamps are anchored to the recording start
    // (performance.now at recorder.start), same clock as captureStream's frame
    // timestamps. No offset needed: pose at time T was estimated from the exact
    // same webcam frame that appears at video time T.
    const userCanvas = userCanvasRef.current
    if (userCanvas) {
      const ctx = userCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, userCanvas.width, userCanvas.height)
        if (showUserSkeleton) {
          const pose = findClosestPose(userPoses, userTime + syncOffset)
          if (pose) {
            drawSkeletonOnCanvas(ctx, pose.pose.keypoints as Keypoint[], '#00ccff', userCanvas.width, userCanvas.height)
          }
        }
      }
    }

    // Reference skeleton — uses reference video time for accurate sync
    const refCanvas = refCanvasRef.current
    if (refCanvas) {
      const ctx = refCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, refCanvas.width, refCanvas.height)
        if (showRefSkeleton) {
          const pose = findClosestPose(referencePosesRef.current, refTime)
          if (pose) {
            drawSkeletonOnCanvas(ctx, pose.pose.keypoints as Keypoint[], '#00ff88', refCanvas.width, refCanvas.height)
          }
        }
      }
    }
  }, [userPoses, showUserSkeleton, showRefSkeleton, syncOffset])

  // Update nearest key pose
  useEffect(() => {
    if (keyPoses.length === 0) { setNearestKeyPose(null); return }
    let nearest: KeyPose | null = null
    let nearestDist = Infinity
    for (const kp of keyPoses) {
      const dist = Math.abs(kp.timestamp - currentTime)
      if (dist < nearestDist) {
        nearest = kp
        nearestDist = dist
      }
    }
    setNearestKeyPose(nearestDist < 3 ? nearest : null)
  }, [currentTime, keyPoses])

  // Render loop
  useEffect(() => {
    if (!isPlaying) return

    const tick = () => {
      const userVideo = userVideoRef.current
      const refVideo = refVideoRef.current
      if (userVideo) {
        const uTime = userVideo.currentTime
        const rTime = refVideo ? refVideo.currentTime : uTime
        setCurrentTime(uTime)
        drawOverlays(uTime, rTime)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, drawOverlays])

  /**
   * Scan the first second of the user video for the green sync marker (32x32 square
   * at top-left corner). When found, compute the offset between video time and pose
   * time so the skeleton aligns perfectly with the video content.
   */
  const calibrateSync = useCallback(async (video: HTMLVideoElement) => {
    if (syncCalibratedRef.current || userPoses.length === 0) return

    const scanCanvas = document.createElement('canvas')
    scanCanvas.width = video.videoWidth || 320
    scanCanvas.height = video.videoHeight || 240
    const scanCtx = scanCanvas.getContext('2d')
    if (!scanCtx) return

    let markerVideoTime = -1

    // Scan first 1s at ~30fps intervals
    for (let t = 0; t < 1.0; t += 0.033) {
      video.currentTime = t
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        // Timeout in case seeked doesn't fire (already at target time)
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }, 150)
      })

      scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height)

      // Check the sync marker region: bright green pixels at (8,8)-(28,28)
      const data = scanCtx.getImageData(8, 8, 20, 20).data
      let greenPixels = 0
      for (let i = 0; i < data.length; i += 4) {
        // Green channel high, red and blue low → bright green
        if (data[i + 1] > 150 && data[i] < 100 && data[i + 2] < 100) {
          greenPixels++
        }
      }

      if (greenPixels > 20 * 20 * 0.4) {
        markerVideoTime = t
        break
      }
    }

    syncCalibratedRef.current = true

    if (markerVideoTime >= 0) {
      // First pose time corresponds to the first marker frame
      const firstPoseTime = userPoses[0].time
      const offset = firstPoseTime - markerVideoTime
      setSyncOffset(offset)
    }

    // Reset video to start
    video.currentTime = 0
  }, [userPoses])

  const handleUserVideoLoaded = useCallback(() => {
    const userVideo = userVideoRef.current
    const canvas = userCanvasRef.current
    if (userVideo && canvas) {
      canvas.width = userVideo.videoWidth
      canvas.height = userVideo.videoHeight
      if (isFinite(userVideo.duration) && userVideo.duration > 0) {
        setDuration(userVideo.duration)
      }
      // Auto-calibrate sync from the green marker
      calibrateSync(userVideo)
    }
  }, [calibrateSync])

  const handleRefVideoLoaded = useCallback(() => {
    const refVideo = refVideoRef.current
    if (refVideo) {
      const canvas = refCanvasRef.current
      if (canvas) {
        canvas.width = refVideo.videoWidth
        canvas.height = refVideo.videoHeight
      }
      if (isFinite(refVideo.duration) && refVideo.duration > 0 && duration === 0) {
        setDuration(refVideo.duration)
      }
    }
  }, [duration])

  const togglePlay = useCallback(() => {
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (!userVideo) return

    if (isPlaying) {
      userVideo.pause()
      refVideo?.pause()
      setIsPlaying(false)
    } else {
      // Unmute reference video for audio
      if (refVideo) {
        refVideo.muted = false
        refVideo.volume = 0.7
      }
      userVideo.play().catch(() => {})
      refVideo?.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [isPlaying])

  // Single source of truth for duration
  const getTotalDuration = useCallback((): number => {
    const refVideo = refVideoRef.current
    const userVideo = userVideoRef.current
    if (refVideo && isFinite(refVideo.duration) && refVideo.duration > 0) return refVideo.duration
    if (userVideo && isFinite(userVideo.duration) && userVideo.duration > 0) return userVideo.duration
    if (sectionScores.length > 0) return sectionScores[sectionScores.length - 1].endTime
    return duration
  }, [sectionScores, duration])

  const handleSeek = useCallback((time: number) => {
    const totalDur = getTotalDuration()
    const clamped = Math.max(0, Math.min(time, totalDur || Infinity))
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (userVideo) {
      userVideo.currentTime = clamped
      setCurrentTime(clamped)
    }
    if (refVideo) {
      refVideo.currentTime = clamped
    }
    drawOverlays(clamped, clamped)
  }, [drawOverlays, getTotalDuration])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const totalDur = getTotalDuration()
    if (totalDur > 0) handleSeek(ratio * totalDur)
  }, [handleSeek, getTotalDuration])

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (userVideo) userVideo.playbackRate = speed
    if (refVideo) refVideo.playbackRate = speed
  }, [])

  // Handle video end
  useEffect(() => {
    const userVideo = userVideoRef.current
    if (!userVideo) return
    const handleEnded = () => {
      setIsPlaying(false)
      cancelAnimationFrame(animFrameRef.current)
    }
    userVideo.addEventListener('ended', handleEnded)
    return () => userVideo.removeEventListener('ended', handleEnded)
  }, [])

  const totalDuration = getTotalDuration()

  const handleVideoClick = useCallback(() => {
    togglePlay()
  }, [togglePlay])

  return (
    <div className="replay-mode">
      {/* Session metadata */}
      <div className="replay-header">
        <button className="replay-back-btn" onClick={onBack}>Back</button>
        <div className="replay-meta">
          <span className="replay-date">{new Date(sessionMeta.date).toLocaleDateString()}</span>
          <span className="replay-score">{Math.round(sessionMeta.score)}%</span>
          <span
            className="replay-rank"
            style={{ color: RANK_COLORS[sessionMeta.rank] }}
          >
            {sessionMeta.rank}
          </span>
        </div>
      </div>

      {/* Reference video + skeleton — always in DOM, CSS swaps position */}
      <div
        className={swapped ? 'replay-user-pip' : 'replay-main-video'}
        onClick={handleVideoClick}
      >
        {swapped && <div className="replay-pip-label">REF</div>}
        <div className="replay-video-wrapper">
          {referenceVideoUrl ? (
            <video
              ref={refVideoRef}
              src={referenceVideoUrl}
              className={swapped ? 'replay-video-pip' : 'replay-video-full'}
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={() => {
                handleRefVideoLoaded()
                if (refVideoRef.current) refVideoRef.current.playbackRate = playbackSpeed
              }}
            />
          ) : (
            <div className="replay-video-placeholder">No reference video</div>
          )}
          <canvas
            ref={refCanvasRef}
            className="replay-pose-overlay"
          />
        </div>

        {/* Key pose indicator — only on main */}
        {!swapped && nearestKeyPose && (
          <div className="replay-keypose-indicator">
            <TargetPoseFigure pose={nearestKeyPose.pose} size={60} />
          </div>
        )}
      </div>

      {/* User video + skeleton — always in DOM, CSS swaps position */}
      <div
        className={swapped ? 'replay-main-video' : 'replay-user-pip'}
        onClick={handleVideoClick}
      >
        {!swapped && <div className="replay-pip-label">YOU</div>}
        <div className="replay-video-wrapper">
          <video
            ref={userVideoRef}
            src={userVideoUrl}
            className={swapped ? 'replay-video-full' : 'replay-video-pip'}
            playsInline
            muted
            preload="auto"
            onLoadedMetadata={handleUserVideoLoaded}
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas
            ref={userCanvasRef}
            className="replay-pose-overlay"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>

        {/* Key pose indicator — only on main */}
        {swapped && nearestKeyPose && (
          <div className="replay-keypose-indicator">
            <TargetPoseFigure pose={nearestKeyPose.pose} size={60} />
          </div>
        )}
      </div>

      {/* Color-coded timeline with scrubber */}
      <div className="replay-timeline-container">
        <div className="replay-timeline" onClick={handleTimelineClick}>
          {sectionScores.map((section, i) => (
            <div
              key={i}
              className="replay-timeline-segment"
              style={{
                flex: section.endTime - section.startTime,
                backgroundColor: scoreToColor(section.score),
              }}
              title={`${formatTime(section.startTime)} - ${formatTime(section.endTime)}: ${Math.round(section.score * 100)}%`}
            />
          ))}
          {/* Key pose markers */}
          {totalDuration > 0 && keyPoses.map((kp, i) => (
            <div
              key={`kp-${i}`}
              className="replay-keypose-marker"
              style={{ left: `${(kp.timestamp / totalDuration) * 100}%` }}
              title={`Key pose at ${formatTime(kp.timestamp)}`}
            />
          ))}
          {/* Playhead */}
          <div
            className="replay-playhead"
            style={{ left: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }}
          />
        </div>
        <div className="replay-time-display">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </div>
      </div>

      {/* Controls */}
      <div className="replay-controls">
        <button className="replay-play-btn" onClick={togglePlay}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          className={`replay-toggle-btn ${swapped ? 'active' : ''}`}
          onClick={() => setSwapped((s) => !s)}
          title="Swap main and PIP videos"
        >
          Swap
        </button>
        <button
          className={`replay-toggle-btn ${showUserSkeleton ? 'active' : ''}`}
          onClick={() => setShowUserSkeleton((s) => !s)}
          title="Toggle your skeleton overlay"
        >
          My Skeleton
        </button>
        <button
          className={`replay-toggle-btn ${showRefSkeleton ? 'active' : ''}`}
          onClick={() => setShowRefSkeleton((s) => !s)}
          title="Toggle reference skeleton overlay"
        >
          Ref Skeleton
        </button>
        <div className="replay-speed-controls">
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              className={`replay-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
              onClick={() => handleSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
