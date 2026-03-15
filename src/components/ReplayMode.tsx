import { useEffect, useRef, useState, useCallback } from 'react'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import type { Keypoint } from '../scoring/types'
import type { TimestampedPose, SectionScore } from '../scoring/dtw'
import { TargetPoseFigure } from './TargetPoseFigure'
import { loadDanceSettings } from '../storage/danceSettings'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'

interface ReplayModeProps {
  referenceVideoUrl?: string
  referencePoseUrl?: string
  danceId?: string
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
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2]

export function ReplayMode({
  referenceVideoUrl,
  referencePoseUrl,
  danceId,
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
  const [keyPoses, setKeyPoses] = useState<KeyPose[]>([])
  const [nearestKeyPose, setNearestKeyPose] = useState<KeyPose | null>(null)

  // Load key poses
  useEffect(() => {
    if (!referencePoseUrl) return
    (async () => {
      try {
        const res = await fetch(referencePoseUrl)
        if (!res.ok) return
        const timeline: PoseTimeline = await res.json()
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

  // Draw skeleton overlay on user video canvas
  const drawPoseAtTime = useCallback((time: number) => {
    const canvas = canvasRef.current
    const userVideo = userVideoRef.current
    if (!canvas || !userVideo) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

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

    const section = sectionScores.find(
      (s) => time >= s.startTime && time < s.endTime
    )
    const sectionScore = section?.score ?? 0.5

    ctx.lineWidth = 2
    for (const [i, j] of SKELETON_CONNECTIONS) {
      const kpA = keypoints[i]
      const kpB = keypoints[j]
      if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
        ctx.strokeStyle = scoreToColor(sectionScore)
        ctx.beginPath()
        ctx.moveTo(kpA.x, kpA.y)
        ctx.lineTo(kpB.x, kpB.y)
        ctx.stroke()
      }
    }

    for (const kp of keypoints) {
      if (kp.score > 0.3) {
        ctx.fillStyle = scoreToColor(sectionScore)
        ctx.beginPath()
        ctx.arc(kp.x, kp.y, KEYPOINT_RADIUS, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }, [userPoses, sectionScores])

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
      if (userVideo) {
        setCurrentTime(userVideo.currentTime)
        drawPoseAtTime(userVideo.currentTime)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, drawPoseAtTime])

  const handleUserVideoLoaded = useCallback(() => {
    const userVideo = userVideoRef.current
    const canvas = canvasRef.current
    if (userVideo && canvas) {
      canvas.width = userVideo.videoWidth
      canvas.height = userVideo.videoHeight
      if (isFinite(userVideo.duration) && userVideo.duration > 0) {
        setDuration(userVideo.duration)
      }
    }
  }, [])

  // Also try to get duration from reference video
  const handleRefVideoLoaded = useCallback(() => {
    const refVideo = refVideoRef.current
    if (refVideo && isFinite(refVideo.duration) && refVideo.duration > 0 && duration === 0) {
      setDuration(refVideo.duration)
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

  const handleSeek = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, duration || Infinity))
    const userVideo = userVideoRef.current
    const refVideo = refVideoRef.current
    if (userVideo) {
      userVideo.currentTime = clamped
      setCurrentTime(clamped)
      drawPoseAtTime(clamped)
    }
    if (refVideo) {
      refVideo.currentTime = clamped
    }
  }, [drawPoseAtTime, duration])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const totalDur = duration || (sectionScores.length > 0 ? sectionScores[sectionScores.length - 1].endTime : 0)
    if (totalDur > 0) handleSeek(ratio * totalDur)
  }, [duration, handleSeek, sectionScores])

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

  // Compute best duration from multiple sources
  const totalDuration = duration > 0 && isFinite(duration)
    ? duration
    : (sectionScores.length > 0 ? sectionScores[sectionScores.length - 1].endTime : 0)

  // Click video to toggle play
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

      {/* Videos — reference is main, user is PIP */}
      <div className="replay-main-video" onClick={handleVideoClick}>
        {referenceVideoUrl ? (
          <video
            ref={refVideoRef}
            src={referenceVideoUrl}
            className="replay-video-full"
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

        {/* Key pose indicator */}
        {nearestKeyPose && (
          <div className="replay-keypose-indicator">
            <TargetPoseFigure pose={nearestKeyPose.pose} size={60} />
          </div>
        )}
      </div>

      {/* User video PIP */}
      <div className="replay-user-pip">
        <div className="replay-pip-label">YOU</div>
        <div className="replay-user-container">
          <video
            ref={userVideoRef}
            src={userVideoUrl}
            className="replay-video-pip"
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
