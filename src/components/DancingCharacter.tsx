import { useEffect, useMemo, useRef, useState } from 'react'
import type { Keypoint, Pose } from '../scoring/types'
import type { PoseTimeline } from '../scoring/keyPoseDetection'
import { findKeyframeIndex, poseAtTime } from '../pose/interpolate'
import type { PoseKeyframe } from '../pose/interpolate'
import { TargetPoseFigure } from './TargetPoseFigure'
import type { CharacterId, PoseFrame } from './characters'
import { CHARACTER_STYLES, DEFAULT_STANDING_POSE, KP, MIN_KEYPOINT_CONF, computePoseFrame, idlePoseAt } from './characters'
import './DancingCharacter.css'

export interface DancingCharacterProps {
  /** Fetches PoseTimeline JSON { fps, duration, keyframes: [{ time, keypoints }] }. */
  poseDataUrl?: string
  /**
   * Alternative to poseDataUrl (wins when non-empty). Must be sorted by time;
   * pass a referentially stable array (state / useMemo), not a fresh slice
   * every render — use startTime/endTime to pick a section instead.
   */
  keyframes?: { time: number; keypoints: Keypoint[] }[]
  /** Loop start, seconds. Default 0. */
  startTime?: number
  /** Loop end, seconds. Default: last keyframe time. */
  endTime?: number
  /** Playback rate. Default 1 (0.5 = half speed). */
  speed?: number
  /** Canvas size in CSS px (square). Default 160. */
  size?: number
  /** Default 'buddy'. */
  character?: CharacterId
  /** Caption under the figure. */
  label?: string
  paused?: boolean
  className?: string
}

/** ~30fps React updates; the rAF loop itself runs at display rate. */
const EMIT_INTERVAL_MS = 1000 / 30 - 1
/** Cap per-frame time step so a backgrounded tab doesn't jump on return. */
const MAX_STEP_MS = 100
const MIN_LOOP_SECONDS = 0.05
/** Follow-cam smoothing half-window: removes slow travel, keeps steps/sways. */
const FOLLOW_HALF_WINDOW_S = 1.5
/** Max poses sampled when computing the fixed viewport of a clip. */
const FRAME_SAMPLES = 400
/** Idle groove is periodic in 1.25s (2 beats @ 96bpm); 1000s = 800 periods. */
const IDLE_WRAP_S = 1000

// ---------------------------------------------------------------------------
// Pose timeline loading (shared by every instance)
// ---------------------------------------------------------------------------

const timelineCache = new Map<string, Promise<PoseKeyframe[]>>()
const resolvedTimelines = new Map<string, PoseKeyframe[]>()

function sanitizeTimeline(raw: unknown): PoseKeyframe[] {
  const keyframes = (raw as Partial<PoseTimeline> | null)?.keyframes
  if (!Array.isArray(keyframes)) return []
  const frames = keyframes.filter(
    (kf): kf is PoseKeyframe =>
      !!kf && typeof kf.time === 'number' && Number.isFinite(kf.time) && Array.isArray(kf.keypoints),
  )
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time < frames[i - 1].time) {
      return [...frames].sort((a, b) => a.time - b.time)
    }
  }
  return frames
}

function loadTimeline(url: string): Promise<PoseKeyframe[]> {
  let pending = timelineCache.get(url)
  if (!pending) {
    // Not aborted on unmount on purpose: the request is shared between
    // instances (and StrictMode remounts); callers just ignore late results.
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load poses (${res.status})`)
        return res.json()
      })
      .then((json: unknown) => {
        const frames = sanitizeTimeline(json)
        resolvedTimelines.set(url, frames)
        return frames
      })
    // Forget failures so a later mount can retry.
    pending.catch(() => {
      if (timelineCache.get(url) === pending) timelineCache.delete(url)
    })
    timelineCache.set(url, pending)
  }
  return pending
}

// ---------------------------------------------------------------------------
// Clip = the looped section, with a smoothed follow-cam offset per keyframe
// ---------------------------------------------------------------------------

interface Clip {
  /** Keyframes covering [start, end] (plus one neighbour each side). */
  frames: readonly PoseKeyframe[]
  /** Horizontal follow-cam offset per frame (same pose units as x). */
  offsets: number[]
  start: number
  end: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function bodyCenterX(kps: readonly Keypoint[]): number | null {
  const pairs: [number, number][] = [[KP.leftHip, KP.rightHip], [KP.leftShoulder, KP.rightShoulder]]
  for (const [a, b] of pairs) {
    const ka = kps[a]
    const kb = kps[b]
    if (ka && kb && ka.score >= MIN_KEYPOINT_CONF && kb.score >= MIN_KEYPOINT_CONF &&
        Number.isFinite(ka.x) && Number.isFinite(kb.x)) {
      return (ka.x + kb.x) / 2
    }
  }
  return null
}

function buildClip(all: readonly PoseKeyframe[], startTime: number, endTime: number | undefined): Clip | null {
  const n = all.length
  if (n === 0) return null
  const first = all[0].time
  const last = all[n - 1].time
  const start = clamp(Number.isFinite(startTime) ? startTime : 0, first, last)
  const end = clamp(endTime !== undefined && Number.isFinite(endTime) ? endTime : last, first, last)
  if (!(end - start >= MIN_LOOP_SECONDS)) return null

  const lo = Math.max(0, findKeyframeIndex(all, start))
  const hi = Math.min(n - 1, findKeyframeIndex(all, end) + 1)
  const frames = all.slice(lo, hi + 1)

  // Moving average of the body center over +-FOLLOW_HALF_WINDOW_S.
  const m = frames.length
  const sum = new Array<number>(m + 1).fill(0)
  const cnt = new Array<number>(m + 1).fill(0)
  for (let i = 0; i < m; i++) {
    const c = bodyCenterX(frames[i].keypoints ?? [])
    sum[i + 1] = sum[i] + (c ?? 0)
    cnt[i + 1] = cnt[i] + (c === null ? 0 : 1)
  }
  const globalAvg = cnt[m] > 0 ? sum[m] / cnt[m] : 0
  const offsets = new Array<number>(m)
  let j0 = 0
  let j1 = 0
  for (let i = 0; i < m; i++) {
    const t = frames[i].time
    while (j0 < m && frames[j0].time < t - FOLLOW_HALF_WINDOW_S) j0++
    while (j1 < m && frames[j1].time <= t + FOLLOW_HALF_WINDOW_S) j1++
    const c = cnt[j1] - cnt[j0]
    offsets[i] = c > 0 ? (sum[j1] - sum[j0]) / c : globalAvg
  }

  return { frames, offsets, start, end }
}

function translateX(pose: Pose, dx: number): Pose {
  if (dx === 0) return pose
  return { keypoints: pose.keypoints.map((kp) => ({ ...kp, x: kp.x - dx })) }
}

function clipPoseAt(clip: Clip, t: number): Pose {
  const pose = poseAtTime(clip.frames, t)
  if (!pose) return DEFAULT_STANDING_POSE
  const i = clamp(findKeyframeIndex(clip.frames, t), 0, clip.frames.length - 1)
  const j = Math.min(i + 1, clip.frames.length - 1)
  const span = clip.frames[j].time - clip.frames[i].time
  const alpha = span > 0 ? clamp((t - clip.frames[i].time) / span, 0, 1) : 0
  const off = clip.offsets[i] + (clip.offsets[j] - clip.offsets[i]) * alpha
  // poseAtTime returns fresh keypoints, safe to shift in place.
  for (const kp of pose.keypoints) kp.x -= off
  return pose
}

function clipFrame(clip: Clip, character: CharacterId): PoseFrame | null {
  const inRange: number[] = []
  for (let i = 0; i < clip.frames.length; i++) {
    const t = clip.frames[i].time
    if (t >= clip.start - 1e-6 && t <= clip.end + 1e-6) inRange.push(i)
  }
  const step = Math.max(1, Math.ceil(inRange.length / FRAME_SAMPLES))
  const poses: Pose[] = []
  for (let k = 0; k < inRange.length; k += step) {
    const i = inRange[k]
    poses.push(translateX({ keypoints: clip.frames[i].keypoints ?? [] }, clip.offsets[i]))
  }
  if (poses.length === 0) poses.push(clipPoseAt(clip, clip.start))
  return computePoseFrame(poses, character)
}

const idleFrames = new Map<CharacterId, PoseFrame | null>()

function idleFrame(character: CharacterId): PoseFrame | null {
  let frame = idleFrames.get(character)
  if (frame === undefined) {
    const samples: Pose[] = []
    for (let t = 0; t < 1.25; t += 0.05) samples.push(idlePoseAt(t))
    frame = computePoseFrame(samples, character)
    idleFrames.set(character, frame)
  }
  return frame
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface View {
  pose: Pose
  frame: PoseFrame | null
}

/**
 * A character dancing a section of a reference pose timeline on loop (real
 * time x speed). Without data (no URL/keyframes, fetch failure, empty range)
 * it grooves idly in place, so it can also sit on the home screen.
 */
export function DancingCharacter({
  poseDataUrl,
  keyframes,
  startTime = 0,
  endTime,
  speed = 1,
  size = 160,
  character = 'buddy',
  label,
  paused = false,
  className,
}: DancingCharacterProps) {
  const hasKeyframes = !!keyframes && keyframes.length > 0
  const fetchUrl = !hasKeyframes && poseDataUrl ? poseDataUrl : null
  const [loaded, setLoaded] = useState<{ url: string; frames: PoseKeyframe[] } | null>(null)

  useEffect(() => {
    if (!fetchUrl || resolvedTimelines.has(fetchUrl)) return
    let cancelled = false
    loadTimeline(fetchUrl).then(
      (frames) => {
        if (!cancelled) setLoaded({ url: fetchUrl, frames })
      },
      (err: unknown) => {
        if (cancelled) return
        console.warn('[DancingCharacter] pose data unavailable, idling:', err)
        setLoaded({ url: fetchUrl, frames: [] })
      },
    )
    return () => {
      cancelled = true
    }
  }, [fetchUrl])

  let frames: readonly PoseKeyframe[] | null = null
  if (hasKeyframes) frames = keyframes
  else if (fetchUrl) {
    frames = resolvedTimelines.get(fetchUrl) ?? (loaded?.url === fetchUrl ? loaded.frames : null)
  }
  const loading = !!fetchUrl && frames === null

  const clip = useMemo(
    () => (frames ? buildClip(frames, startTime, endTime) : null),
    [frames, startTime, endTime],
  )
  const frame = useMemo(
    () => (clip ? clipFrame(clip, character) : idleFrame(character)),
    [clip, character],
  )

  const [view, setView] = useState<View>(() => ({
    pose: clip ? clipPoseAt(clip, clip.start) : idlePoseAt(0),
    frame,
  }))

  // Animation clock, persisted across effect restarts (speed/pause changes).
  const elapsedRef = useRef(0)
  const lastNowRef = useRef(0)
  const lastEmitRef = useRef(0)
  const clipKeyRef = useRef('')

  useEffect(() => {
    // Restart from the loop start only when the section really changed.
    const clipKey = clip
      ? `${clip.start}|${clip.end}|${clip.frames.length}|${clip.frames[0].time}`
      : 'idle'
    if (clipKeyRef.current !== clipKey) {
      clipKeyRef.current = clipKey
      elapsedRef.current = 0
    }

    const still = !clip && prefersReducedMotion()
    const rate = !clip ? 1 : Number.isFinite(speed) && speed > 0 ? speed : 0
    const loopLen = clip ? clip.end - clip.start : IDLE_WRAP_S

    const compute = (): Pose => {
      if (!clip) return still ? DEFAULT_STANDING_POSE : idlePoseAt(elapsedRef.current)
      return clipPoseAt(clip, clip.start + (elapsedRef.current % loopLen))
    }

    let raf = 0
    if (paused || still) {
      lastNowRef.current = 0
      raf = requestAnimationFrame(() => setView({ pose: compute(), frame }))
      return () => cancelAnimationFrame(raf)
    }

    let firstTick = true
    const tick = (now: number) => {
      const prev = lastNowRef.current
      const dt = prev > 0 ? clamp(now - prev, 0, MAX_STEP_MS) : 0
      lastNowRef.current = now
      elapsedRef.current = (elapsedRef.current + (dt / 1000) * rate) % loopLen
      if (firstTick || now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
        firstTick = false
        lastEmitRef.current = now
        setView({ pose: compute(), frame })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [clip, frame, speed, paused])

  const state = clip ? 'dancing' : loading ? 'loading' : 'idle'
  const name = label ?? CHARACTER_STYLES[character]?.label ?? 'Character'

  return (
    <div
      className={className ? `dancing-character ${className}` : 'dancing-character'}
      data-character={character}
      data-state={state}
      style={{ width: size }}
    >
      <div
        className="dancing-character-stage"
        role="img"
        aria-label={state === 'dancing' ? `${name} demonstrating the move` : name}
        style={{ width: size, height: size }}
      >
        <TargetPoseFigure
          pose={view.pose}
          size={size}
          character={character}
          frame={view.frame ?? undefined}
        />
      </div>
      {label && <div className="dancing-character-label">{label}</div>}
    </div>
  )
}
