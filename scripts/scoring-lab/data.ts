/**
 * Scoring lab — fixture loading and pose utilities.
 *
 * Coordinate conventions used across the lab:
 * - "normalized" — reference PoseTimeline coords: x / videoWidth, y / videoHeight (0-1), what
 *   scripts/extract_poses.py stores. NOT isotropic when the source video is not square (the
 *   I Need U fixture is a 406x720 portrait Short).
 * - "reference pixels" — normalized coords times the reference video geometry (x * width,
 *   y * height). Isotropic: angles and bone directions are physically correct. Synthetic
 *   bodies are built here (see synth.ts).
 * - "webcam pixels" — what DanceMode records for the user (src/pose/detector.ts multiplies
 *   MediaPipe's normalized landmarks by the webcam videoWidth / videoHeight). Isotropic.
 *
 * The reference geometry comes from a sidecar `<fixture>.meta.json`
 * ({ width, height, coordinateSpace }) — the format extract_poses.py should write for new
 * dances; at runtime the app can fall back to the reference <video>'s videoWidth/videoHeight.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Keypoint, KeypointName, Pose } from '../../src/scoring/types'
import { KEYPOINT_NAMES } from '../../src/scoring/types'
import type { TimestampedPose } from '../../src/scoring/dtw'
import type { PoseTimeline } from '../../src/scoring/keyPoseDetection'

export type { Keypoint, KeypointName, Pose, TimestampedPose, PoseTimeline }
export { KEYPOINT_NAMES }

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const FIXTURE_DIR = resolve(REPO_ROOT, 'tests/fixtures/scoring')
export const REF_FIXTURE = 'ref-ineedu-15s.json'
export const REAL_STILL_FIXTURE = 'user-still-upperbody-session1.json'
/** Codex pulse-party analysis of the reference (analyze.py output: events, curves, width/height, frames). */
export const REF_PULSE_ANALYSIS_FIXTURE = 'ref-ineedu-15s.pulse-analysis.json'

/**
 * Real user sessions recorded by the app on the I Need U reference (TimestampedPose[], recording
 * clock, 320x240 webcam pixels, presence-filtered by DanceMode @ 7aebdba). All three were rank A
 * under the legacy scorer although the user was (basically) standing still, upper body framed.
 */
export const REAL_SESSION_FIXTURES = {
  session1: REAL_STILL_FIXTURE,
  session2: 'user-session2-upperbody.json',
  session3: 'user-session3.json',
} as const
export type RealSessionKey = keyof typeof REAL_SESSION_FIXTURES

/** Pixel size of the reference video. Reference coords are 0-1 normalized per axis by these. */
export interface ReferenceGeometry {
  width: number
  height: number
}

/** Sidecar metadata of a reference pose file (`<name>.meta.json`). */
export interface ReferenceMeta extends ReferenceGeometry {
  /** 'normalized' = keypoint x / width, y / height (extract_poses.py); 'pixel' = already in pixels */
  coordinateSpace: 'normalized' | 'pixel'
}

/** `ref-ineedu-15s.json` -> `ref-ineedu-15s.meta.json` */
export function metaFileFor(file: string): string {
  return file.replace(/\.json$/i, '') + '.meta.json'
}

/** Load the sidecar geometry of a reference fixture (undefined if there is none). */
export function loadReferenceMeta(file = REF_FIXTURE): ReferenceMeta | undefined {
  const path = fixturePath(metaFileFor(file))
  if (!existsSync(path)) return undefined
  const meta = loadJson<Partial<ReferenceMeta>>(path)
  if (!(Number(meta.width) > 0) || !(Number(meta.height) > 0)) throw new Error(`Invalid reference meta ${path}`)
  const coordinateSpace = meta.coordinateSpace ?? 'normalized'
  if (coordinateSpace !== 'normalized' && coordinateSpace !== 'pixel') throw new Error(`Invalid coordinateSpace in ${path}`)
  return { width: Number(meta.width), height: Number(meta.height), coordinateSpace }
}

/**
 * Geometry of the I Need U reference video (406x720 portrait, verified with ffprobe and the MP4
 * tkhd / avc1 boxes of data/dances/job_1792096280066_1/video.mp4; SAR 1:1, no rotation).
 * Loaded from tests/fixtures/scoring/ref-ineedu-15s.meta.json.
 */
export const REF_INEEDU_GEOMETRY: ReferenceGeometry = (() => {
  const meta = loadReferenceMeta(REF_FIXTURE)
  if (!meta) throw new Error(`Missing ${metaFileFor(REF_FIXTURE)} next to the reference fixture`)
  return { width: meta.width, height: meta.height }
})()

/** Width / height of the reference video (406 / 720 = 0.5639). Kept for older lab code. */
export const REF_INEEDU_ASPECT = REF_INEEDU_GEOMETRY.width / REF_INEEDU_GEOMETRY.height

/** Geometry with the given aspect (W/H) at the reference height — for the --aspect flag. */
export function geometryFromAspect(aspect: number, height = REF_INEEDU_GEOMETRY.height): ReferenceGeometry {
  return { width: aspect * height, height }
}

/** Normalized (0-1 per axis) -> reference pixels: x * width, y * height. Confidence/name kept. */
export function denormalizePose(pose: Pose, geometry: ReferenceGeometry): Pose {
  return {
    keypoints: pose.keypoints.map((k) => ({ ...k, x: k.x * geometry.width, y: k.y * geometry.height })),
  }
}

/** denormalizePose over a whole reference sequence (times unchanged). */
export function denormalizePoses(poses: TimestampedPose[], geometry: ReferenceGeometry): TimestampedPose[] {
  return poses.map((p) => ({ time: p.time, pose: denormalizePose(p.pose, geometry) }))
}

/** Webcam frame size of the real session (DanceMode records pixels of video.videoWidth/Height). */
export const WEBCAM_WIDTH = 320
export const WEBCAM_HEIGHT = 240
export const NUM_KEYPOINTS = 33

/** Keypoint index by name (KEYPOINT_NAMES order = MediaPipe BlazePose order). */
export const KP = Object.fromEntries(KEYPOINT_NAMES.map((n, i) => [n, i])) as Record<KeypointName, number>

/** Index permutation that swaps left/right keypoints (used for mirroring). */
export const LEFT_RIGHT_SWAP: number[] = KEYPOINT_NAMES.map((name, i) => {
  const other = name.startsWith('left_')
    ? name.replace('left_', 'right_')
    : name.startsWith('right_')
      ? name.replace('right_', 'left_')
      : name.startsWith('mouth_left')
        ? 'mouth_right'
        : name.startsWith('mouth_right')
          ? 'mouth_left'
          : name
  const j = KEYPOINT_NAMES.indexOf(other as KeypointName)
  return j >= 0 ? j : i
})

/** Leg keypoints (knees and below) — hidden when the user frames only the upper body. */
export const LEG_KEYPOINTS: KeypointName[] = [
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
]

export function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function fixturePath(file: string): string {
  return resolve(FIXTURE_DIR, file)
}

/** Put keypoints into canonical KEYPOINT_NAMES order (fills missing ones with score 0). */
export function canonicalKeypoints(keypoints: Keypoint[]): Keypoint[] {
  const byName = new Map(keypoints.map((k) => [k.name, k]))
  return KEYPOINT_NAMES.map((name) => {
    const k = byName.get(name)
    return k ? { x: k.x, y: k.y, score: k.score, name } : { x: 0, y: 0, score: 0, name }
  })
}

export function loadReferenceTimeline(file = REF_FIXTURE): PoseTimeline {
  const tl = loadJson<PoseTimeline>(fixturePath(file))
  return {
    fps: tl.fps,
    duration: tl.duration,
    keyframes: tl.keyframes.map((kf) => ({ time: kf.time, keypoints: canonicalKeypoints(kf.keypoints) })),
  }
}

/** Exactly the mapping DanceMode/ReplayMode use to feed post-dance scoring. */
export function timelineToTimestamped(timeline: PoseTimeline): TimestampedPose[] {
  return timeline.keyframes.map((kf) => ({
    time: kf.time,
    pose: { keypoints: kf.keypoints as Keypoint[] },
  }))
}

export interface LoadedReference {
  timeline: PoseTimeline
  /** Normalized coords, exactly as DanceMode/ReplayMode pass them to post-dance scoring */
  poses: TimestampedPose[]
  /** Reference video pixel size (from the sidecar meta, or the override) */
  geometry: ReferenceGeometry
  /** geometry.width / geometry.height */
  aspect: number
}

export function loadReference(file = REF_FIXTURE, geometry?: ReferenceGeometry): LoadedReference {
  const timeline = loadReferenceTimeline(file)
  const meta = loadReferenceMeta(file)
  const geo = geometry ?? (meta ? { width: meta.width, height: meta.height } : undefined)
  if (!geo) throw new Error(`No geometry for ${file}: add ${metaFileFor(file)} or pass one`)
  return { timeline, poses: timelineToTimestamped(timeline), geometry: geo, aspect: geo.width / geo.height }
}

/** The real session that scored 63.6% A: recording-clock times, webcam pixel coords. */
export function loadRealStillUser(file = REAL_STILL_FIXTURE): TimestampedPose[] {
  const raw = loadJson<TimestampedPose[]>(fixturePath(file))
  return raw.map((f) => ({ time: f.time, pose: { keypoints: canonicalKeypoints(f.pose.keypoints) } }))
}

/** Load one of the real sessions (REAL_SESSION_FIXTURES) — same format as loadRealStillUser. */
export function loadRealSession(key: RealSessionKey): TimestampedPose[] {
  return loadRealStillUser(REAL_SESSION_FIXTURES[key])
}

/** Repeat a timeline `times` times back to back (used for the 60 s performance scenario). */
export function loopTimeline(timeline: PoseTimeline, times: number): PoseTimeline {
  const period = timeline.keyframes.length / timeline.fps
  const keyframes: PoseTimeline['keyframes'] = []
  for (let r = 0; r < times; r++) {
    for (const kf of timeline.keyframes) {
      keyframes.push({ time: kf.time + r * period, keypoints: kf.keypoints })
    }
  }
  return { fps: timeline.fps, duration: period * times, keyframes }
}

/** Duration of a timeline as DanceMode sees it (video length). */
export function timelineDuration(timeline: PoseTimeline): number {
  const last = timeline.keyframes[timeline.keyframes.length - 1]?.time ?? 0
  return Math.max(timeline.duration, last + 1 / timeline.fps)
}

// ---------------------------------------------------------------------------
// Pose utilities
// ---------------------------------------------------------------------------

export function getKeypoint(pose: Pose, name: KeypointName): Keypoint | undefined {
  const k = pose.keypoints[KP[name]]
  if (k && k.name === name) return k
  return pose.keypoints.find((p) => p.name === name)
}

export function clonePose(pose: Pose): Pose {
  return { keypoints: pose.keypoints.map((k) => ({ ...k })) }
}

/** Build a canonical 33-keypoint pose from flat arrays. */
export function poseFromArrays(xs: ArrayLike<number>, ys: ArrayLike<number>, conf: ArrayLike<number>): Pose {
  return {
    keypoints: KEYPOINT_NAMES.map((name, i) => ({ x: xs[i], y: ys[i], score: conf[i], name })),
  }
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Mid-shoulder to mid-hip distance (in the pose's own units), 0 if unavailable. */
export function torsoLength(pose: Pose): number {
  const ls = getKeypoint(pose, 'left_shoulder')
  const rs = getKeypoint(pose, 'right_shoulder')
  const lh = getKeypoint(pose, 'left_hip')
  const rh = getKeypoint(pose, 'right_hip')
  if (!ls || !rs || !lh || !rh) return 0
  const s = midpoint(ls, rs)
  const h = midpoint(lh, rh)
  return Math.hypot(s.x - h.x, s.y - h.y)
}

/** Reflect a pose about the vertical line x = centerX and swap left/right labels. */
export function mirrorPose(pose: Pose, centerX?: number): Pose {
  const kps = canonicalKeypoints(pose.keypoints)
  const lh = kps[KP.left_hip]
  const rh = kps[KP.right_hip]
  const cx = centerX ?? (lh.x + rh.x) / 2
  return {
    keypoints: KEYPOINT_NAMES.map((name, i) => {
      const src = kps[LEFT_RIGHT_SWAP[i]]
      return { x: 2 * cx - src.x, y: src.y, score: src.score, name }
    }),
  }
}

/** Shift all timestamps by dt seconds. */
export function shiftTimes(poses: TimestampedPose[], dt: number): TimestampedPose[] {
  return poses.map((p) => ({ time: p.time + dt, pose: p.pose }))
}

export interface SessionSummary {
  frames: number
  start: number
  end: number
  span: number
  meanDt: number
}

export function summarizeSession(poses: TimestampedPose[]): SessionSummary {
  if (poses.length === 0) return { frames: 0, start: 0, end: 0, span: 0, meanDt: 0 }
  const start = poses[0].time
  const end = poses[poses.length - 1].time
  return {
    frames: poses.length,
    start,
    end,
    span: end - start,
    meanDt: poses.length > 1 ? (end - start) / (poses.length - 1) : 0,
  }
}
