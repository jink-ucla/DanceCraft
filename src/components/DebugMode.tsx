import { useEffect, useRef, useState, useCallback } from 'react'
import { SKELETON_CONNECTIONS } from '../pose/skeleton'
import { detectKeyPoses } from '../scoring/keyPoseDetection'
import type { KeyPose, PoseTimeline } from '../scoring/keyPoseDetection'
import type { Keypoint } from '../scoring/types'
import { KEYPOINT_NAMES } from '../scoring/types'
import { TargetPoseFigure } from './TargetPoseFigure'
import { loadDanceSettings, saveDanceSettings } from '../storage/danceSettings'
import type { DanceSettings } from '../storage/danceSettings'

interface EditModeProps {
  referencePoseUrl: string
  referenceVideoUrl?: string
  danceName: string
  danceId: string
  onBack: () => void
}

export function DebugMode({ referencePoseUrl, referenceVideoUrl, danceName, danceId, onBack }: EditModeProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  const [timeline, setTimeline] = useState<PoseTimeline | null>(null)
  const [keyPoses, setKeyPoses] = useState<KeyPose[]>([])
  const [autoKeyPoses, setAutoKeyPoses] = useState<KeyPose[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [showKeyPoses, setShowKeyPoses] = useState(true)
  const [activeKeyPose, setActiveKeyPose] = useState<KeyPose | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [settings, setSettings] = useState<DanceSettings>(() => loadDanceSettings(danceId))
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load pose data
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(referencePoseUrl)
        if (!res.ok) return
        const data: PoseTimeline = await res.json()
        setTimeline(data)
        setDuration(data.duration)

        const detected = detectKeyPoses(data, {
          minGapSeconds: 3.0,
          heldFrameCount: 8,
          distinctiveThreshold: 1.0,
        })
        setAutoKeyPoses(detected)

        // Use custom key poses if saved, otherwise auto-detected
        const saved = loadDanceSettings(danceId)
        if (saved.customKeyPoses) {
          setKeyPoses(saved.customKeyPoses)
        } else {
          setKeyPoses(detected)
        }
      } catch { /* ignore */ }
    })()
  }, [referencePoseUrl, danceId])

  // Find the closest frame in timeline for a given time
  const getFrameAtTime = useCallback((time: number): Keypoint[] | null => {
    if (!timeline) return null
    const frames = timeline.keyframes
    if (frames.length === 0) return null

    let lo = 0, hi = frames.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (frames[mid].time < time) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && Math.abs(frames[lo - 1].time - time) < Math.abs(frames[lo].time - time)) {
      lo--
    }
    return frames[lo].keypoints
  }, [timeline])

  // Draw skeleton overlay
  const drawSkeleton = useCallback((time: number) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || !showSkeleton) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const containerW = canvas.clientWidth
    const containerH = canvas.clientHeight
    canvas.width = containerW
    canvas.height = containerH
    ctx.clearRect(0, 0, containerW, containerH)

    const keypoints = getFrameAtTime(time)
    if (!keypoints) return

    const videoW = video.videoWidth || 1
    const videoH = video.videoHeight || 1
    const scale = Math.min(containerW / videoW, containerH / videoH)
    const renderedW = videoW * scale
    const renderedH = videoH * scale
    const offsetX = (containerW - renderedW) / 2
    const offsetY = (containerH - renderedH) / 2

    const MIN_CONF = 0.3

    const kx = (kp: { x: number }) => offsetX + kp.x * renderedW
    const ky = (kp: { y: number }) => offsetY + kp.y * renderedH

    ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)'
    ctx.lineWidth = 2
    for (const [i, j] of SKELETON_CONNECTIONS) {
      const a = keypoints[i]
      const b = keypoints[j]
      if (a && b && a.score > MIN_CONF && b.score > MIN_CONF) {
        ctx.beginPath()
        ctx.moveTo(kx(a), ky(a))
        ctx.lineTo(kx(b), ky(b))
        ctx.stroke()
      }
    }

    ctx.fillStyle = '#00ff88'
    for (const kp of keypoints) {
      if (kp.score > MIN_CONF) {
        ctx.beginPath()
        ctx.arc(kx(kp), ky(kp), 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (showKeyPoses) {
      for (const kp of keyPoses) {
        const isMove = kp.type === 'move'
        const windowSize = isMove ? (kp.moveWindow ?? 0.3) : 0.3
        const diff = Math.abs(kp.timestamp - time)
        if (diff < windowSize) {
          const typeColors: Record<string, string> = {
            held: '#ffcc00',
            transition: '#00ccff',
            distinctive: '#ff88ff',
            move: '#ff8800',
          }
          ctx.strokeStyle = typeColors[kp.type] ?? '#ff88ff'
          ctx.lineWidth = isMove ? 5 : 4
          ctx.strokeRect(offsetX + 2, offsetY + 2, renderedW - 4, renderedH - 4)

          ctx.fillStyle = ctx.strokeStyle
          ctx.font = 'bold 14px monospace'
          const label = isMove
            ? `MOVE: ${kp.focusArea ?? 'full'}`
            : `KEY POSE: ${kp.type}`
          ctx.fillText(label, 12, 24)

          // Show focus joints for moves
          if (isMove && kp.focusJoints && kp.focusJoints.length > 0) {
            ctx.font = '12px monospace'
            ctx.fillText(`focus: ${kp.focusJoints.join(', ')}`, 12, 42)
          }
          break
        }
      }
    }
  }, [showSkeleton, showKeyPoses, getFrameAtTime, keyPoses])

  // Animation loop for drawing skeleton while playing
  useEffect(() => {
    if (!isPlaying) return
    const loop = () => {
      const video = videoRef.current
      if (video) {
        setCurrentTime(video.currentTime)
        drawSkeleton(video.currentTime)
      }
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [isPlaying, drawSkeleton])

  // Draw skeleton on seek
  useEffect(() => {
    if (!isPlaying) drawSkeleton(currentTime)
  }, [currentTime, isPlaying, drawSkeleton])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    setCurrentTime(time)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  const jumpToKeyPose = (kp: KeyPose) => {
    setActiveKeyPose(kp)
    if (videoRef.current) {
      if (kp.type === 'move' && kp.moveWindow) {
        // For moves: play the segment from start to end of the move window
        const startTime = Math.max(0, kp.timestamp - kp.moveWindow)
        videoRef.current.currentTime = startTime
        setCurrentTime(startTime)
        videoRef.current.play()
        setIsPlaying(true)

        // Stop playback after the move window ends
        const endTime = kp.timestamp + kp.moveWindow
        const checkEnd = () => {
          if (videoRef.current && videoRef.current.currentTime >= endTime) {
            videoRef.current.pause()
            setIsPlaying(false)
            videoRef.current.removeEventListener('timeupdate', checkEnd)
          }
        }
        videoRef.current.addEventListener('timeupdate', checkEnd)
      } else {
        // Static poses: jump and pause
        videoRef.current.currentTime = kp.timestamp
        setCurrentTime(kp.timestamp)
        videoRef.current.pause()
        setIsPlaying(false)
      }
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Update active key pose based on current time
  useEffect(() => {
    let closest: KeyPose | null = null
    let closestDist = Infinity
    for (const kp of keyPoses) {
      const dist = Math.abs(kp.timestamp - currentTime)
      if (dist < 0.5 && dist < closestDist) {
        closest = kp
        closestDist = dist
      }
    }
    setActiveKeyPose(closest)
  }, [currentTime, keyPoses])

  // --- Key pose editing ---

  const deleteKeyPose = (index: number) => {
    setKeyPoses(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next
    })
    setHasUnsavedChanges(true)
  }

  const addKeyPoseAtCurrentTime = () => {
    if (!timeline) return
    const keypoints = getFrameAtTime(currentTime)
    if (!keypoints) return

    const newKP: KeyPose = {
      timestamp: currentTime,
      pose: { keypoints: keypoints.map((kp, idx) => ({ x: kp.x, y: kp.y, score: kp.score, name: kp.name || KEYPOINT_NAMES[idx] || `kp_${idx}` })) },
      type: 'distinctive',
      tolerance: 0.15,
    }

    setKeyPoses(prev => {
      const next = [...prev, newKP].sort((a, b) => a.timestamp - b.timestamp)
      return next
    })
    setHasUnsavedChanges(true)
  }

  const moveKeyPose = (index: number, newTimestamp: number) => {
    if (!timeline) return
    const keypoints = getFrameAtTime(newTimestamp)
    if (!keypoints) return

    setKeyPoses(prev => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        timestamp: newTimestamp,
        pose: { keypoints: keypoints.map((kp, idx) => ({ x: kp.x, y: kp.y, score: kp.score, name: kp.name || KEYPOINT_NAMES[idx] || `kp_${idx}` })) },
      }
      return next.sort((a, b) => a.timestamp - b.timestamp)
    })
    setHasUnsavedChanges(true)
  }

  const resetToAutoDetected = () => {
    setKeyPoses(autoKeyPoses)
    setHasUnsavedChanges(true)
  }

  const saveChanges = () => {
    const newSettings: DanceSettings = {
      ...settings,
      customKeyPoses: keyPoses,
    }
    saveDanceSettings(danceId, newSettings)
    setSettings(newSettings)
    setHasUnsavedChanges(false)
  }

  const updateMirror = (mirror: boolean) => {
    const newSettings: DanceSettings = { ...settings, mirror }
    saveDanceSettings(danceId, newSettings)
    setSettings(newSettings)
  }

  const updateTutorialUrl = (tutorialUrl: string) => {
    const newSettings: DanceSettings = { ...settings, tutorialUrl }
    saveDanceSettings(danceId, newSettings)
    setSettings(newSettings)
  }

  // Check if a key pose already exists near the current time
  const hasKeyPoseNearCurrentTime = keyPoses.some(kp => Math.abs(kp.timestamp - currentTime) < 1.0)

  return (
    <div className="debug-mode">
      <div className="debug-header">
        <button className="debug-back" onClick={onBack}>Back</button>
        <h2 className="debug-title">Edit: {danceName}</h2>
        {hasUnsavedChanges && (
          <button className="edit-save-btn" onClick={saveChanges}>Save Changes</button>
        )}
      </div>

      <div className="debug-content">
        {/* Video + skeleton overlay */}
        <div className="debug-video-container">
          {referenceVideoUrl ? (
            <>
              <video
                ref={videoRef}
                src={referenceVideoUrl}
                className="debug-video"
                playsInline
                preload="auto"
                style={settings.mirror ? { transform: 'scaleX(-1)' } : undefined}
                onLoadedMetadata={() => {
                  if (videoRef.current) setDuration(videoRef.current.duration)
                }}
                onTimeUpdate={() => {
                  if (videoRef.current && isPlaying) {
                    setCurrentTime(videoRef.current.currentTime)
                  }
                }}
                onEnded={() => setIsPlaying(false)}
              />
              <canvas
                ref={canvasRef}
                className="debug-skeleton-overlay"
                style={settings.mirror ? { transform: 'scaleX(-1)' } : undefined}
              />
            </>
          ) : (
            <div className="debug-no-video">No video available — pose data only</div>
          )}
        </div>

        {/* Controls */}
        <div className="debug-controls">
          <button className="debug-play-btn" onClick={togglePlay}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            className="debug-mute-btn"
            onClick={() => {
              setIsMuted((m) => {
                if (videoRef.current) videoRef.current.muted = !m
                return !m
              })
            }}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <span className="debug-time">{formatTime(currentTime)}</span>
          <input
            type="range"
            className="debug-scrubber"
            min={0}
            max={duration || 1}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
          />
          <span className="debug-time">{formatTime(duration)}</span>
        </div>

        {/* Settings */}
        <div className="edit-settings-row">
          <div className="debug-toggles">
            <label className="debug-toggle">
              <input type="checkbox" checked={showSkeleton} onChange={(e) => setShowSkeleton(e.target.checked)} />
              Show Skeleton
            </label>
            <label className="debug-toggle">
              <input type="checkbox" checked={showKeyPoses} onChange={(e) => setShowKeyPoses(e.target.checked)} />
              Highlight Key Poses
            </label>
            <label className="debug-toggle">
              <input
                type="checkbox"
                checked={settings.mirror}
                onChange={(e) => updateMirror(e.target.checked)}
              />
              Mirror Video
            </label>
          </div>
        </div>

        {/* Tutorial video URL */}
        <div className="edit-tutorial-row">
          <label className="edit-tutorial-label">Tutorial Video (YouTube URL)</label>
          <input
            type="text"
            className="edit-tutorial-input"
            placeholder="https://youtube.com/watch?v=..."
            value={settings.tutorialUrl}
            onChange={(e) => updateTutorialUrl(e.target.value)}
          />
        </div>

        {/* Key pose editing toolbar */}
        <div className="edit-toolbar">
          <button
            className="edit-toolbar-btn edit-toolbar-btn-add"
            onClick={addKeyPoseAtCurrentTime}
            disabled={hasKeyPoseNearCurrentTime}
            title={hasKeyPoseNearCurrentTime ? 'A key pose already exists near this time' : 'Add key pose at current frame'}
          >
            + Add Pose Here
          </button>
          <button
            className="edit-toolbar-btn"
            onClick={resetToAutoDetected}
            title="Reset to auto-detected key poses"
          >
            Reset to Auto
          </button>
          <span className="edit-toolbar-info">
            {keyPoses.length} key poses
            {settings.customKeyPoses ? ' (custom)' : ' (auto)'}
          </span>
        </div>

        {/* Key pose timeline */}
        <div className="debug-section">
          <h3 className="debug-section-title">
            Key Poses ({keyPoses.length})
          </h3>
          <div className="debug-keypose-timeline">
            <div className="debug-timeline-bar">
              <div
                className="debug-timeline-playhead"
                style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              {keyPoses.map((kp, i) => (
                <button
                  key={`${i}-${kp.timestamp}`}
                  className={`debug-timeline-marker debug-timeline-marker-${kp.type} ${activeKeyPose === kp ? 'debug-timeline-marker-active' : ''}`}
                  style={{ left: `${duration > 0 ? (kp.timestamp / duration) * 100 : 0}%` }}
                  onClick={() => jumpToKeyPose(kp)}
                  title={`${kp.type} @ ${formatTime(kp.timestamp)}`}
                />
              ))}
            </div>
          </div>

          {/* Key pose cards with edit controls */}
          <div className="debug-keypose-list">
            {keyPoses.map((kp, i) => (
              <div
                key={`${i}-${kp.timestamp}`}
                className={`debug-keypose-card ${activeKeyPose === kp ? 'debug-keypose-card-active' : ''}`}
              >
                <div className="edit-keypose-card-top" onClick={() => jumpToKeyPose(kp)}>
                  <div className="edit-keypose-figure-wrapper">
                    <TargetPoseFigure pose={kp.pose} size={60} />
                    {kp.type === 'move' && (
                      <div className="edit-keypose-move-badge">MOVE</div>
                    )}
                  </div>
                  <div className="debug-keypose-info">
                    <span className={`debug-keypose-type debug-keypose-type-${kp.type}`}>{kp.type}</span>
                    <span className="debug-keypose-time">{formatTime(kp.timestamp)}</span>
                    {kp.focusArea && (
                      <span className={`edit-keypose-focus edit-keypose-focus-${kp.focusArea}`}>
                        {kp.focusArea}
                      </span>
                    )}
                    {kp.type === 'move' && kp.moveWindow && (
                      <span className="edit-keypose-play-hint">
                        {(kp.moveWindow * 2).toFixed(1)}s — click to play
                      </span>
                    )}
                  </div>
                </div>
                <div className="edit-keypose-actions">
                  <button
                    className="edit-keypose-move-btn"
                    onClick={() => moveKeyPose(i, currentTime)}
                    disabled={Math.abs(kp.timestamp - currentTime) < 0.1}
                    title="Move to current frame"
                  >
                    Move Here
                  </button>
                  <button
                    className="edit-keypose-delete-btn"
                    onClick={() => deleteKeyPose(i)}
                    title="Remove this key pose"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="debug-section">
          <h3 className="debug-section-title">Pose Data</h3>
          <div className="debug-stats">
            <div className="debug-stat">
              <span className="debug-stat-value">{timeline?.keyframes.length ?? '—'}</span>
              <span className="debug-stat-label">Total frames</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-value">{timeline?.fps ?? '—'}</span>
              <span className="debug-stat-label">FPS</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-value">{keyPoses.filter(k => k.type === 'held').length}</span>
              <span className="debug-stat-label">Held</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-value">{keyPoses.filter(k => k.type === 'transition').length}</span>
              <span className="debug-stat-label">Transition</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-value">{keyPoses.filter(k => k.type === 'distinctive').length}</span>
              <span className="debug-stat-label">Distinctive</span>
            </div>
            <div className="debug-stat">
              <span className="debug-stat-value">{keyPoses.filter(k => k.type === 'move').length}</span>
              <span className="debug-stat-label">Move</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
