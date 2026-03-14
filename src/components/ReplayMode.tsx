import { useEffect, useRef, useState, useCallback } from 'react'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import type { Keypoint } from '../scoring/types'
import type { TimestampedPose, SectionScore } from '../scoring/dtw'

interface ReplayModeProps {
  referenceVideoUrl?: string
  userVideoUrl: string
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
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2]

export function ReplayMode({
  referenceVideoUrl,
  userVideoUrl,
  userPoses,
  sectionScores,
  sessionMeta,
  onBack,
}: ReplayModeProps) {
  const refVideoRef = useRef<HTMLVideoElement>(null)
  const userVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // Draw skeleton overlay on user video canvas
  const drawPoseAtTime = useCallback((time: number) => {
    const canvas = canvasRef.current
    const userVideo = userVideoRef.current
    if (!canvas || !userVideo) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Find the closest pose to the current time
    let closestPose: TimestampedPose | null = null
    let closestDiff = Infinity
    for (const pose of userPoses) {
      const diff = Math.abs(pose.time - time)
      if (diff < closestDiff) {
        closestDiff = diff
        closestPose = pose
      }
    }

    if (!closestPose || closestDiff > 0.5) return

    const keypoints = closestPose.pose.keypoints as Keypoint[]

    // Find matching section score for per-joint coloring
    const section = sectionScores.find(
      (s) => time >= s.startTime && time < s.endTime
    )
    const sectionScore = section?.score ?? 0.5

    // Draw skeleton connections
    ctx.lineWidth = 2
    for (const [i, j] of SKELETON_CONNECTIONS) {
      const kpA = keypoints[i]
      const kpB = keypoints[j]
      if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
        // Color based on section score
        ctx.strokeStyle = scoreToColor(sectionScore)
        ctx.beginPath()
        ctx.moveTo(kpA.x, kpA.y)
        ctx.lineTo(kpB.x, kpB.y)
        ctx.stroke()
      }
    }

    // Draw keypoints
    for (const kp of keypoints) {
      if (kp.score > 0.3) {
        ctx.fillStyle = scoreToColor(sectionScore)
        ctx.beginPath()
        ctx.arc(kp.x, kp.y, KEYPOINT_RADIUS, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }, [userPoses, sectionScores])

  // Render loop for skeleton overlay
  useEffect(() => {
    if (!isPlaying) return

    const tick = () => {
      const userVideo = userVideoRef.current
      if (userVideo) {
        setCurrentTime(userVideo.currentTime)
        drawPoseAtTime(userVideo.currentTime)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, drawPoseAtTime])

  // Initialize canvas dimensions when user video loads
  const handleUserVideoLoaded = useCallback(() => {
    const userVideo = userVideoRef.current
    const canvas = canvasRef.current
    if (userVideo && canvas) {
      canvas.width = userVideo.videoWidth
      canvas.height = userVideo.videoHeight
      setDuration(userVideo.duration)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (!userVideo) return

    if (isPlaying) {
      userVideo.pause()
      refVideo?.pause()
      setIsPlaying(false)
    } else {
      userVideo.play().catch(() => {})
      refVideo?.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleSeek = useCallback((time: number) => {
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (userVideo) {
      userVideo.currentTime = time
      setCurrentTime(time)
      drawPoseAtTime(time)
    }
    if (refVideo) {
      refVideo.currentTime = time
    }
  }, [drawPoseAtTime])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    handleSeek(ratio * duration)
  }, [duration, handleSeek])

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

  const totalDuration = duration || (sectionScores.length > 0
    ? sectionScores[sectionScores.length - 1].endTime
    : 0)

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

      {/* Side-by-side videos */}
      <div className="replay-videos">
        <div className="replay-video-panel">
          <div className="replay-video-label">REFERENCE</div>
          {referenceVideoUrl ? (
            <video
              ref={refVideoRef}
              src={referenceVideoUrl}
              className="replay-video"
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={() => {
                if (refVideoRef.current) {
                  refVideoRef.current.playbackRate = playbackSpeed
                }
              }}
            />
          ) : (
            <div className="replay-video-placeholder">No reference video</div>
          )}
        </div>

        <div className="replay-video-panel">
          <div className="replay-video-label">YOUR PERFORMANCE</div>
          <div className="replay-user-container">
            <video
              ref={userVideoRef}
              src={userVideoUrl}
              className="replay-video"
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={handleUserVideoLoaded}
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={canvasRef}
              className="replay-pose-overlay"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        </div>
      </div>

      {/* Color-coded timeline */}
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
