/**
 * Scoring lab — deterministic synthetic users derived from a reference dance.
 *
 * Geometry: the reference timeline is normalized per axis (x / width, y / height of a 406x720
 * portrait video). The synthetic body is built in REFERENCE PIXELS (x * width, y * height), i.e.
 * the true isotropic geometry of the dancer, and then mapped into the webcam's pixel space by a
 * uniform scale + offset (the user is physically the same shape as the dancer). So a perfect copy
 * has the same joint angles as the geometry-restored reference, NOT as the raw normalized one.
 *
 * Pipeline per detector frame (see synthesizeUser):
 *   recording clock -> video clock -> intended reference time (lag / warp / tempo / shift / reverse)
 *   -> motion source (reference, neutral, sway, flail, held pose) as a kinematic pose
 *   -> blend toward neutral (per body part) -> smooth execution error on joint rotations
 *   -> forward kinematics (reference pixels) -> mirror -> keypoint jitter (white + wander)
 *   -> webcam camera transform (uniform scale + offset into a WxH webcam frame, default 320x240)
 *   -> confidences / visibility mask -> presence window (late joiner), dropouts and fixed gaps
 *   (detector returns null)
 *
 * Everything is driven by a seeded RNG (mulberry32); sub-streams are derived from string
 * labels (rng.fork('label')) so adding a scenario never changes another scenario's data.
 */
import type { Pose, PoseTimeline, ReferenceGeometry, TimestampedPose } from './data'
import { KEYPOINT_NAMES, KP, LEFT_RIGHT_SWAP, NUM_KEYPOINTS, WEBCAM_HEIGHT, WEBCAM_WIDTH, geometryFromAspect, timelineDuration } from './data'
import { checkPresence } from './baseline/scoring/presence'

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface Rng {
  readonly seed: number
  /** Uniform [0, 1) */
  next(): number
  /** Standard normal */
  normal(): number
  /** Uniform [a, b) */
  range(a: number, b: number): number
  /** Integer in [a, b] */
  int(a: number, b: number): number
  /** Independent sub-stream derived from this seed and a label (order-independent). */
  fork(label: string): Rng
}

export function createRng(seed: number): Rng {
  const u = mulberry32(seed)
  let spare: number | null = null
  const rng: Rng = {
    seed,
    next: u,
    normal() {
      if (spare !== null) {
        const s = spare
        spare = null
        return s
      }
      let a = 0
      while (a <= 1e-12) a = u()
      const b = u()
      const r = Math.sqrt(-2 * Math.log(a))
      spare = r * Math.sin(2 * Math.PI * b)
      return r * Math.cos(2 * Math.PI * b)
    },
    range(a, b) {
      return a + (b - a) * u()
    },
    int(a, b) {
      return a + Math.floor(u() * (b - a + 1))
    },
    fork(label) {
      return createRng(hashString(`${seed}:${label}`))
    },
  }
  return rng
}

/**
 * Smooth zero-mean random function of time: sum of `components` sinusoids with random
 * frequency in [fMin, fMax] Hz and random phase, scaled so its standard deviation is `sd`.
 */
export function smoothNoise(rng: Rng, sd: number, fMin: number, fMax: number, components = 3): (t: number) => number {
  if (sd === 0) return () => 0
  const amp = sd * Math.sqrt(2 / components)
  const parts = Array.from({ length: components }, () => ({
    f: rng.range(fMin, fMax),
    phase: rng.range(0, 2 * Math.PI),
  }))
  return (t) => {
    let v = 0
    for (const p of parts) v += Math.sin(2 * Math.PI * p.f * t + p.phase)
    return amp * v
  }
}

// ---------------------------------------------------------------------------
// Kinematic body model (reference pixels: x * width, y * height of the reference video)
// ---------------------------------------------------------------------------

/** Virtual point indices appended after the 33 keypoints. */
export const MID_HIP = 33
export const MID_SHOULDER = 34
const NUM_POINTS = 35

export type BoneRole =
  | 'torso' | 'shoulderW' | 'head' | 'headSub' | 'upperArm' | 'foreArm' | 'hand'
  | 'hipW' | 'thigh' | 'shin' | 'foot'
export type BodyGroup = 'torso' | 'arms' | 'legs'

export interface BoneDef {
  parent: number
  child: number
  /** Index of the bone this one is expressed relative to (-1 = absolute) */
  parentBone: number
  role: BoneRole
  group: BodyGroup
  side: 'left' | 'right' | 'center'
}

function roleOf(child: number): BoneRole {
  if (child === MID_SHOULDER) return 'torso'
  if (child === KP.left_shoulder || child === KP.right_shoulder) return 'shoulderW'
  if (child === KP.nose) return 'head'
  if (child >= 1 && child <= 10) return 'headSub'
  if (child === KP.left_elbow || child === KP.right_elbow) return 'upperArm'
  if (child === KP.left_wrist || child === KP.right_wrist) return 'foreArm'
  if (child >= 17 && child <= 22) return 'hand'
  if (child === KP.left_hip || child === KP.right_hip) return 'hipW'
  if (child === KP.left_knee || child === KP.right_knee) return 'thigh'
  if (child === KP.left_ankle || child === KP.right_ankle) return 'shin'
  return 'foot'
}

function groupOf(role: BoneRole): BodyGroup {
  if (role === 'upperArm' || role === 'foreArm' || role === 'hand') return 'arms'
  if (role === 'thigh' || role === 'shin' || role === 'foot') return 'legs'
  return 'torso'
}

function sideOf(child: number): 'left' | 'right' | 'center' {
  if (child >= NUM_KEYPOINTS) return 'center'
  if (child >= 1 && child <= 10) return 'center' // head sub-points move rigidly with the head
  if (child === 0) return 'center'
  return child % 2 === 1 ? 'left' : 'right'
}

const BONE_PAIRS: [number, number][] = [
  [MID_HIP, MID_SHOULDER],
  [MID_SHOULDER, KP.left_shoulder],
  [MID_SHOULDER, KP.right_shoulder],
  [MID_SHOULDER, KP.nose],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [KP.nose, i] as [number, number]),
  [KP.left_shoulder, KP.left_elbow],
  [KP.left_elbow, KP.left_wrist],
  [KP.left_wrist, KP.left_pinky],
  [KP.left_wrist, KP.left_index],
  [KP.left_wrist, KP.left_thumb],
  [KP.right_shoulder, KP.right_elbow],
  [KP.right_elbow, KP.right_wrist],
  [KP.right_wrist, KP.right_pinky],
  [KP.right_wrist, KP.right_index],
  [KP.right_wrist, KP.right_thumb],
  [MID_HIP, KP.left_hip],
  [MID_HIP, KP.right_hip],
  [KP.left_hip, KP.left_knee],
  [KP.left_knee, KP.left_ankle],
  [KP.left_ankle, KP.left_heel],
  [KP.left_ankle, KP.left_foot_index],
  [KP.right_hip, KP.right_knee],
  [KP.right_knee, KP.right_ankle],
  [KP.right_ankle, KP.right_heel],
  [KP.right_ankle, KP.right_foot_index],
]

export const BONES: BoneDef[] = BONE_PAIRS.map(([parent, child]) => {
  const role = roleOf(child)
  return { parent, child, parentBone: -1, role, group: groupOf(role), side: sideOf(child) }
})
for (const bone of BONES) {
  const incoming = BONES.findIndex((b) => b.child === bone.parent)
  // Bones hanging from the root (mid-hip) other than the torso are expressed relative to the torso
  bone.parentBone = incoming >= 0 ? incoming : bone.child === MID_SHOULDER ? -1 : 0
}

/** Positions in reference pixels for 33 keypoints + mid-hip + mid-shoulder. */
export interface Body {
  x: Float64Array
  y: Float64Array
}

/** Kinematic pose: root (mid-hip) + per-bone relative angle and length. */
export interface Kin {
  rootX: number
  rootY: number
  rel: Float64Array
  len: Float64Array
}

export function newBody(): Body {
  return { x: new Float64Array(NUM_POINTS), y: new Float64Array(NUM_POINTS) }
}

function wrapAngle(a: number): number {
  let v = a % (2 * Math.PI)
  if (v > Math.PI) v -= 2 * Math.PI
  if (v < -Math.PI) v += 2 * Math.PI
  return v
}

/** Body from normalized keypoints, denormalized to reference pixels (x * width, y * height). */
export function bodyFromNormalized(keypoints: { x: number; y: number }[], geometry: ReferenceGeometry): Body {
  const b = newBody()
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    b.x[i] = keypoints[i].x * geometry.width
    b.y[i] = keypoints[i].y * geometry.height
  }
  fillVirtualPoints(b)
  return b
}

function fillVirtualPoints(b: Body): void {
  b.x[MID_HIP] = (b.x[KP.left_hip] + b.x[KP.right_hip]) / 2
  b.y[MID_HIP] = (b.y[KP.left_hip] + b.y[KP.right_hip]) / 2
  b.x[MID_SHOULDER] = (b.x[KP.left_shoulder] + b.x[KP.right_shoulder]) / 2
  b.y[MID_SHOULDER] = (b.y[KP.left_shoulder] + b.y[KP.right_shoulder]) / 2
}

export function absAngles(kin: Kin): Float64Array {
  const abs = new Float64Array(BONES.length)
  for (let i = 0; i < BONES.length; i++) {
    const pb = BONES[i].parentBone
    abs[i] = kin.rel[i] + (pb >= 0 ? abs[pb] : 0)
  }
  return abs
}

export function decompose(body: Body): Kin {
  const rel = new Float64Array(BONES.length)
  const len = new Float64Array(BONES.length)
  const abs = new Float64Array(BONES.length)
  for (let i = 0; i < BONES.length; i++) {
    const { parent, child, parentBone } = BONES[i]
    const dx = body.x[child] - body.x[parent]
    const dy = body.y[child] - body.y[parent]
    abs[i] = Math.atan2(dy, dx)
    len[i] = Math.hypot(dx, dy)
    rel[i] = parentBone >= 0 ? wrapAngle(abs[i] - abs[parentBone]) : abs[i]
  }
  return { rootX: body.x[MID_HIP], rootY: body.y[MID_HIP], rel, len }
}

export function compose(kin: Kin): Body {
  const body = newBody()
  body.x[MID_HIP] = kin.rootX
  body.y[MID_HIP] = kin.rootY
  const abs = absAngles(kin)
  for (let i = 0; i < BONES.length; i++) {
    const { parent, child } = BONES[i]
    body.x[child] = body.x[parent] + kin.len[i] * Math.cos(abs[i])
    body.y[child] = body.y[parent] + kin.len[i] * Math.sin(abs[i])
  }
  return body
}

export function cloneKin(k: Kin): Kin {
  return { rootX: k.rootX, rootY: k.rootY, rel: new Float64Array(k.rel), len: new Float64Array(k.len) }
}

export interface GroupWeights {
  torso: number
  arms: number
  legs: number
}

/** Interpolate a -> b per body group (alpha 0 = a, 1 = b). Root follows the legs weight. */
export function blendKin(a: Kin, b: Kin, alpha: GroupWeights): Kin {
  const out = cloneKin(a)
  for (let i = 0; i < BONES.length; i++) {
    const w = alpha[BONES[i].group]
    if (w === 0) continue
    out.rel[i] = a.rel[i] + w * wrapAngle(b.rel[i] - a.rel[i])
    out.len[i] = a.len[i] + w * (b.len[i] - a.len[i])
  }
  out.rootX = a.rootX + alpha.legs * (b.rootX - a.rootX)
  out.rootY = a.rootY + alpha.legs * (b.rootY - a.rootY)
  return out
}

/** Set absolute angles for some bones, keeping their children's relative angles. */
function withAbsolute(kin: Kin, overrides: Map<number, number>): Kin {
  const out = cloneKin(kin)
  const abs = absAngles(kin)
  for (const [i, a] of overrides) abs[i] = a
  for (let i = 0; i < BONES.length; i++) {
    if (!overrides.has(i)) continue
    const pb = BONES[i].parentBone
    out.rel[i] = pb >= 0 ? wrapAngle(abs[i] - abs[pb]) : abs[i]
    // children keep their relative angles (they follow)
  }
  return out
}

function boneIndex(child: number): number {
  return BONES.findIndex((b) => b.child === child)
}

/** Relative scale of each bone role for random rotations (execution error / flailing). */
const ROLE_SCALE: Record<BoneRole, number> = {
  torso: 0.3, shoulderW: 0.1, head: 0.3, headSub: 0, upperArm: 1, foreArm: 1, hand: 0.5,
  hipW: 0.1, thigh: 0.6, shin: 0.7, foot: 0.5,
}

/**
 * Smooth random per-bone rotation offsets. Hand / foot bones of one side share a
 * function so the hand or foot rotates rigidly.
 */
export function makeRotationNoise(
  rng: Rng,
  sd: number,
  fMin: number,
  fMax: number,
  roleScale: Partial<Record<BoneRole, number>> = ROLE_SCALE,
): (t: number, out: Float64Array) => void {
  const shared = new Map<string, (t: number) => number>()
  const fns = BONES.map((bone, i) => {
    const scale = roleScale[bone.role] ?? 0
    if (scale === 0 || sd === 0) return null
    const key = bone.role === 'hand' || bone.role === 'foot' ? `${bone.role}:${bone.side}` : `bone:${i}`
    let fn = shared.get(key)
    if (!fn) {
      fn = smoothNoise(rng.fork(key), sd * scale, fMin, fMax)
      shared.set(key, fn)
    }
    return fn
  })
  return (t, out) => {
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i]
      out[i] = fn ? fn(t) : 0
    }
  }
}

// ---------------------------------------------------------------------------
// Synthesis context (per reference)
// ---------------------------------------------------------------------------

export interface SynthContext {
  timeline: PoseTimeline
  /** Reference video pixel size used to denormalize the timeline */
  geometry: ReferenceGeometry
  /** geometry.width / geometry.height */
  aspect: number
  /** Reference duration as DanceMode sees it (video length) */
  duration: number
  /** Video time at which DanceMode's loop ends (min(video end, last key pose + 2 s)) */
  endVideoTime: number
  times: Float64Array
  bodies: Body[]
  confs: Float64Array[]
  /** Median torso length (reference pixels) */
  torso: number
  neutral: Kin
  /** Neutral standing pose: nose y, mean ankle y, mid-hip (reference pixels) — camera anchors */
  neutralNoseY: number
  neutralAnkleY: number
  neutralRootX: number
  neutralRootY: number
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

function median(values: number[]): number {
  return quantile(values, 0.5)
}

function circularMean(values: number[]): number {
  let sx = 0
  let sy = 0
  for (const v of values) {
    sx += Math.cos(v)
    sy += Math.sin(v)
  }
  return Math.atan2(sy, sx)
}

/** Canonical absolute bone directions (radians, image coords: y down) of a neutral standing pose. */
const NEUTRAL_ABSOLUTE: [number, number][] = [
  [MID_SHOULDER, -Math.PI / 2],
  [KP.left_shoulder, 0],
  [KP.right_shoulder, Math.PI],
  [KP.nose, -Math.PI / 2],
  [KP.left_elbow, Math.PI / 2 - 0.12],
  [KP.left_wrist, Math.PI / 2 - 0.06],
  [KP.right_elbow, Math.PI / 2 + 0.12],
  [KP.right_wrist, Math.PI / 2 + 0.06],
  [KP.left_hip, 0],
  [KP.right_hip, Math.PI],
  [KP.left_knee, Math.PI / 2 - 0.04],
  [KP.left_ankle, Math.PI / 2],
  [KP.right_knee, Math.PI / 2 + 0.04],
  [KP.right_ankle, Math.PI / 2],
]

/** Typical lengths of the canonical neutral bones relative to the torso (front view). */
const NEUTRAL_LENGTH_RATIO: [number, number][] = [
  [KP.left_shoulder, 0.36],
  [KP.right_shoulder, 0.36],
  [KP.left_hip, 0.24],
  [KP.right_hip, 0.24],
]

export interface SynthContextOptions {
  /** Override the end of DanceMode's loop (video seconds). Default: video end. */
  endVideoTime?: number
}

/**
 * @param geometry reference video pixel size (or, for older callers, its aspect W/H — then the
 *   height defaults to the I Need U reference height)
 */
export function createSynthContext(
  timeline: PoseTimeline,
  geometry: ReferenceGeometry | number,
  opts: SynthContextOptions = {},
): SynthContext {
  const geo = typeof geometry === 'number' ? geometryFromAspect(geometry) : geometry
  const duration = timelineDuration(timeline)
  const times = new Float64Array(timeline.keyframes.map((k) => k.time))
  const bodies = timeline.keyframes.map((k) => bodyFromNormalized(k.keypoints, geo))
  const confs = timeline.keyframes.map((k) => new Float64Array(k.keypoints.map((p) => p.score)))
  const kins = bodies.map(decompose)

  const torsoIdx = boneIndex(MID_SHOULDER)
  const torso = median(kins.map((k) => k.len[torsoIdx]))

  // Neutral: canonical directions for major bones; reference circular-mean relative angle
  // for head / hand / foot sub-bones (left/right symmetrized). Limb lengths use the 75th
  // percentile of the dancer's projected lengths (the median is foreshortened).
  const rel = new Float64Array(BONES.length)
  const len = new Float64Array(BONES.length)
  for (let i = 0; i < BONES.length; i++) {
    const { parent, child, role } = BONES[i]
    const usable = kins.filter((_, f) => {
      const c = confs[f]
      const pc = parent < NUM_KEYPOINTS ? c[parent] : 1
      const cc = child < NUM_KEYPOINTS ? c[child] : 1
      return pc >= 0.5 && cc >= 0.5
    })
    const src = usable.length > 10 ? usable : kins
    const isLimb = role === 'upperArm' || role === 'foreArm' || role === 'thigh' || role === 'shin'
    len[i] = isLimb ? quantile(src.map((k) => k.len[i]), 0.75) : median(src.map((k) => k.len[i]))
    rel[i] = circularMean(src.map((k) => k.rel[i]))
  }
  for (let i = 0; i < BONES.length; i++) {
    const { child, side, role } = BONES[i]
    if (side !== 'left' || child >= NUM_KEYPOINTS) continue
    const j = BONES.findIndex((b) => b.child === LEFT_RIGHT_SWAP[child])
    if (j < 0) continue
    // mirrored bones have negated relative angles
    const r = wrapAngle(rel[i] + wrapAngle(-rel[j] - rel[i]) / 2)
    rel[i] = r
    rel[j] = -r
    if (role === 'hand' || role === 'foot' || role === 'upperArm' || role === 'foreArm' || role === 'thigh' || role === 'shin') {
      const l = (len[i] + len[j]) / 2
      len[i] = l
      len[j] = l
    }
  }
  for (const [child, ratio] of NEUTRAL_LENGTH_RATIO) len[boneIndex(child)] = ratio * torso
  let neutral: Kin = {
    rootX: median(bodies.map((b) => b.x[MID_HIP])),
    rootY: median(bodies.map((b) => b.y[MID_HIP])),
    rel,
    len,
  }
  neutral = withAbsolute(neutral, new Map(NEUTRAL_ABSOLUTE.map(([child, a]) => [boneIndex(child), a])))
  const neutralPose = compose(neutral)

  return {
    timeline,
    geometry: geo,
    aspect: geo.width / geo.height,
    duration,
    endVideoTime: Math.min(duration, opts.endVideoTime ?? duration),
    times,
    bodies,
    confs,
    torso,
    neutral,
    neutralNoseY: neutralPose.y[KP.nose],
    neutralAnkleY: (neutralPose.y[KP.left_ankle] + neutralPose.y[KP.right_ankle]) / 2,
    neutralRootX: neutral.rootX,
    neutralRootY: neutral.rootY,
  }
}

/** Interpolated reference body at time t (clamped to the reference range). */
export function sampleReference(ctx: SynthContext, t: number): Body {
  const { times, bodies } = ctx
  const n = times.length
  if (t <= times[0]) return bodies[0]
  if (t >= times[n - 1]) return bodies[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  const w = (t - times[lo]) / (times[hi] - times[lo])
  const a = bodies[lo]
  const b = bodies[hi]
  const out = newBody()
  for (let i = 0; i < NUM_POINTS; i++) {
    out.x[i] = a.x[i] + w * (b.x[i] - a.x[i])
    out.y[i] = a.y[i] + w * (b.y[i] - a.y[i])
  }
  return out
}

export function neutralBody(ctx: SynthContext): Body {
  return compose(ctx.neutral)
}

/** Static named poses built on the neutral body. */
export type HoldPoseName = 'tpose' | 'armsUp' | 'refFrame'

export function holdPoseKin(ctx: SynthContext, name: HoldPoseName, refFrameIndex = 0): Kin {
  if (name === 'refFrame') return decompose(ctx.bodies[Math.max(0, Math.min(ctx.bodies.length - 1, refFrameIndex))])
  const o = new Map<number, number>()
  if (name === 'tpose') {
    o.set(boneIndex(KP.left_elbow), 0)
    o.set(boneIndex(KP.left_wrist), 0)
    o.set(boneIndex(KP.right_elbow), Math.PI)
    o.set(boneIndex(KP.right_wrist), Math.PI)
  } else {
    o.set(boneIndex(KP.left_elbow), -Math.PI / 2 + 0.3)
    o.set(boneIndex(KP.left_wrist), -Math.PI / 2 + 0.12)
    o.set(boneIndex(KP.right_elbow), -Math.PI / 2 - 0.3)
    o.set(boneIndex(KP.right_wrist), -Math.PI / 2 - 0.12)
  }
  return withAbsolute(ctx.neutral, o)
}

// ---------------------------------------------------------------------------
// User specification
// ---------------------------------------------------------------------------

export type MotionSpec =
  | { kind: 'reference' }
  | { kind: 'neutral' }
  | { kind: 'sway'; swayAmp?: number; bounceAmp?: number; armSwing?: number }
  | { kind: 'flail'; energy?: number }
  | { kind: 'hold'; pose: HoldPoseName; refFrameIndex?: number }
  /** A fixed pose already in webcam pixel space (e.g. the real user's first frame) */
  | { kind: 'fixedPixelPose'; pose: Pose }

export interface FramingSpec {
  /** 'full' = whole body in frame; 'upper' = waist-up (legs conf ~0, hips ~0.7) */
  visibility: 'full' | 'upper'
}

export interface UserSpec {
  motion: MotionSpec
  /** Seconds the user is behind the video (reaction + camera latency). Default 0 */
  lag?: number
  /** Smooth timing jitter: std-dev (s) of a slowly varying time offset. Default 0 */
  timingJitter?: number
  /** Tempo ratio (1 = in tempo, 0.97 = drifts 3% slower). Default 1 */
  tempo?: number
  /** Circular shift of the reference time (s); wraps around (wrong choreography). Default 0 */
  shift?: number
  /** Perform the choreography backwards (reference time = last reference frame time - tau). Default false */
  reverse?: boolean
  /** Blend toward the neutral standing pose, 0..1 (scalar or per body group). Default 0 */
  blend?: number | Partial<GroupWeights>
  /** Smooth execution error on joint rotations: std-dev in radians. Default 0 */
  angleError?: number
  /** Swap left/right (user mirrors the dancer). Default false */
  mirror?: boolean
  /** White keypoint jitter, std-dev in torso lengths (scaled up for extremities). Default 0.003 */
  jitter?: number
  /** Slow keypoint wander (AR(1), tau 0.5 s), std-dev in torso lengths. Default 0.01 */
  wander?: number
  /** Brief detector dropouts at random times (frames with no pose). */
  dropouts?: { count: number; minDur: number; maxDur: number }
  /** Fixed tracking gaps [start, end) in video seconds (frames with no pose), e.g. [[6, 9]] */
  gaps?: [number, number][]
  /** Fraction of the dance after which the user enters the frame (late joiner). Default 0 */
  presentFrom?: number
  framing?: FramingSpec
  /** Webcam frame size and framing randomness. Default 320x240, framing like the real sessions */
  camera?: CameraSpec
  /** Detector frame rate. Default 30 */
  fps?: number
  /** Relative std-dev of frame intervals. Default 0.06 */
  frameJitter?: number
}

/** One iteration of DanceMode's rAF loop. */
export interface DetectorFrame {
  /** Recording clock: (performance.now() - recordingStart) / 1000 — what onRecordPose stores */
  recTime: number
  /** refVideo.currentTime — what DanceMode uses for key-pose timing */
  videoTime: number
  /** estimatePose() result (null = no person detected) */
  pose: Pose | null
}

export interface SyntheticSession {
  frames: DetectorFrame[]
  /** Parameters actually drawn (camera, delays, dropout windows) for debugging */
  meta: Record<string, unknown>
}

/** Per-keypoint jitter scale (extremities are noisier). */
const JITTER_SCALE: number[] = Array.from({ length: NUM_KEYPOINTS }, (_, i) => {
  if (i <= 10) return 0.8
  if (i === KP.left_shoulder || i === KP.right_shoulder) return 1
  if (i === KP.left_elbow || i === KP.right_elbow) return 2.2
  if (i === KP.left_wrist || i === KP.right_wrist) return 3
  if (i >= 17 && i <= 22) return 3.5
  if (i === KP.left_hip || i === KP.right_hip) return 1.2
  if (i === KP.left_knee || i === KP.right_knee) return 1.5
  if (i === KP.left_ankle || i === KP.right_ankle) return 1.8
  return 2
})

/** Typical MediaPipe visibility for a fully visible person. */
const BASE_CONF: number[] = Array.from({ length: NUM_KEYPOINTS }, (_, i) => {
  if (i <= 10) return 0.995
  if (i === KP.left_shoulder || i === KP.right_shoulder) return 0.998
  if (i === KP.left_elbow || i === KP.right_elbow) return 0.95
  if (i === KP.left_wrist || i === KP.right_wrist) return 0.93
  if (i >= 17 && i <= 22) return 0.9
  if (i === KP.left_hip || i === KP.right_hip) return 0.99
  if (i === KP.left_knee || i === KP.right_knee) return 0.92
  if (i === KP.left_ankle || i === KP.right_ankle) return 0.9
  if (i === KP.left_heel || i === KP.right_heel) return 0.8
  return 0.88
})

const LEG_INDICES = [25, 26, 27, 28, 29, 30, 31, 32]

export interface CameraSpec {
  /** Webcam frame width in pixels. Default 320 (the real session) */
  width?: number
  /** Webcam frame height in pixels. Default 240 */
  height?: number
  /**
   * 'default': framing like the real sessions (full body ~70-80% of the frame height, centred;
   *   waist-up: torso ~100-120 px per 240 px with the hips at the bottom edge).
   * 'random': wide random uniform scale + offset (full body 45-90% of the frame height anywhere
   *   in the frame; waist-up: torso 35-55% of the frame height) — geometry controls.
   */
  placement?: 'default' | 'random'
}

/** Uniform scale + offset from reference pixels into webcam pixels (aspect preserved). */
export interface Camera {
  scale: number
  offsetX: number
  offsetY: number
  /** Webcam frame size */
  width: number
  height: number
}

/** Random webcam framing (default 320x240 pixel coords, like the real session). */
export function makeCamera(ctx: SynthContext, visibility: 'full' | 'upper', rng: Rng, spec: CameraSpec = {}): Camera {
  const W = spec.width ?? WEBCAM_WIDTH
  const H = spec.height ?? WEBCAM_HEIGHT
  const kx = W / WEBCAM_WIDTH
  const ky = H / WEBCAM_HEIGHT
  const random = spec.placement === 'random'
  if (visibility === 'upper') {
    // Real upper-body session: torso ~113 px, mid-hip ~y 254 (just below the 240 px frame)
    const scale = random ? (H * rng.range(0.35, 0.55)) / ctx.torso : (rng.range(100, 120) * ky) / ctx.torso
    const hipY = random ? H * (1 + rng.range(0, 0.08)) : H + rng.range(0, 18) * ky
    const cx = random ? W * rng.range(0.35, 0.65) : W / 2 + rng.range(-20, 20) * kx
    return { scale, offsetX: cx - ctx.neutralRootX * scale, offsetY: hipY - ctx.neutralRootY * scale, width: W, height: H }
  }
  const bodyH = Math.max(1e-6, ctx.neutralAnkleY - ctx.neutralNoseY)
  if (random) {
    const frac = rng.range(0.45, 0.9)
    const scale = (H * frac) / bodyH
    const ankleY = H * (frac + rng.range(0.02, 0.98 - frac))
    const cx = W * rng.range(0.3, 0.7)
    return { scale, offsetX: cx - ctx.neutralRootX * scale, offsetY: ankleY - ctx.neutralAnkleY * scale, width: W, height: H }
  }
  const scale = (H * rng.range(0.66, 0.8)) / bodyH
  const ankleY = H * rng.range(0.86, 0.94)
  const cx = W / 2 + rng.range(-25, 25) * kx
  return { scale, offsetX: cx - ctx.neutralRootX * scale, offsetY: ankleY - ctx.neutralAnkleY * scale, width: W, height: H }
}

export interface ClockOptions {
  fps?: number
  frameJitter?: number
  /** Delay (s) between recorder.start() and the video actually playing */
  videoDelay: number
  /** Stop after the first frame whose video time reaches this (DanceMode finish) */
  endVideoTime: number
  duration: number
}

/** Detector frame timestamps on the recording clock + the matching video clock. */
export function detectorClock(rng: Rng, opts: ClockOptions): { recTime: number; videoTime: number }[] {
  const fps = opts.fps ?? 30
  const jit = opts.frameJitter ?? 0.06
  const out: { recTime: number; videoTime: number }[] = []
  let rec = rng.range(0.005, 0.03)
  for (let guard = 0; guard < 1e6; guard++) {
    const videoTime = Math.min(opts.duration, Math.max(0, rec - opts.videoDelay))
    out.push({ recTime: rec, videoTime })
    if (videoTime >= opts.endVideoTime) break
    let dt = (1 / fps) * (1 + jit * rng.normal())
    dt = Math.max(0.6 / fps, Math.min(2 / fps, dt))
    if (rng.next() < 0.01) dt += rng.range(0.015, 0.05) // occasional hiccup
    rec += dt
  }
  return out
}

function normalizeBlend(b: UserSpec['blend']): GroupWeights {
  if (b === undefined) return { torso: 0, arms: 0, legs: 0 }
  if (typeof b === 'number') return { torso: b, arms: b, legs: b }
  return { torso: b.torso ?? 0, arms: b.arms ?? 0, legs: b.legs ?? 0 }
}

function swayKin(ctx: SynthContext, spec: Extract<MotionSpec, { kind: 'sway' }>, params: SwayParams, t: number): Kin {
  const k = cloneKin(ctx.neutral)
  const T = ctx.torso
  const sway = Math.sin(2 * Math.PI * params.swayFreq * t + params.phase)
  const beat = (1 - Math.cos(2 * Math.PI * params.bounceFreq * t)) / 2 // 0..1
  k.rootX += (spec.swayAmp ?? 0.15) * T * sway
  k.rootY += (spec.bounceAmp ?? 0.06) * T * beat
  const torsoIdx = boneIndex(MID_SHOULDER)
  k.rel[torsoIdx] += 0.06 * sway
  const arm = spec.armSwing ?? 0.2
  const swing = Math.sin(2 * Math.PI * params.swayFreq * t + params.phase + Math.PI / 2)
  k.rel[boneIndex(KP.left_elbow)] += arm * swing
  k.rel[boneIndex(KP.right_elbow)] += arm * swing
  k.rel[boneIndex(KP.left_wrist)] += 0.6 * arm * swing
  k.rel[boneIndex(KP.right_wrist)] += 0.6 * arm * swing
  // knee bounce: knees flex outward a little and the legs shorten
  const bend = 0.2 * beat
  k.rel[boneIndex(KP.left_knee)] -= bend
  k.rel[boneIndex(KP.left_ankle)] += 2 * bend
  k.rel[boneIndex(KP.right_knee)] += bend
  k.rel[boneIndex(KP.right_ankle)] -= 2 * bend
  return k
}

interface SwayParams {
  swayFreq: number
  bounceFreq: number
  phase: number
}

/**
 * Generate one synthetic session (all detector frames, including frames with no pose).
 * Use recordSession() to get what DanceMode would store for post-dance scoring.
 */
export function synthesizeUser(ctx: SynthContext, spec: UserSpec, rng: Rng): SyntheticSession {
  const duration = ctx.duration
  const visibility = spec.framing?.visibility ?? 'full'
  const videoDelay = rng.fork('clock-delay').range(0, 0.06)
  const clock = detectorClock(rng.fork('clock'), {
    fps: spec.fps,
    frameJitter: spec.frameJitter,
    videoDelay,
    endVideoTime: ctx.endVideoTime,
    duration,
  })
  const camera = makeCamera(ctx, visibility, rng.fork('camera'), spec.camera)

  const lag = spec.lag ?? 0
  const tempo = spec.tempo ?? 1
  const shift = spec.shift ?? 0
  const warp = smoothNoise(rng.fork('warp'), spec.timingJitter ?? 0, 0.05, 0.25)
  const blend = normalizeBlend(spec.blend)
  const hasBlend = blend.torso > 0 || blend.arms > 0 || blend.legs > 0
  const angleNoise = (spec.angleError ?? 0) > 0
    ? makeRotationNoise(rng.fork('angle-error'), spec.angleError ?? 0, 0.15, 1.0)
    : null
  const flailEnergy = spec.motion.kind === 'flail' ? spec.motion.energy ?? 1 : 0
  const flailNoise = spec.motion.kind === 'flail'
    ? makeRotationNoise(rng.fork('flail'), 1.1 * flailEnergy, 0.4, 2.0, {
      torso: 0.18, shoulderW: 0.05, head: 0.15, upperArm: 1.1, foreArm: 0.9, hand: 0.35,
      hipW: 0.05, thigh: 0.35, shin: 0.4, foot: 0.25,
    })
    : null
  const flailRootX = smoothNoise(rng.fork('flail-root-x'), 0.25 * flailEnergy * ctx.torso, 0.2, 1.0)
  const flailRootY = smoothNoise(rng.fork('flail-root-y'), 0.08 * flailEnergy * ctx.torso, 0.8, 2.2)
  const swayRng = rng.fork('sway')
  const swayParams: SwayParams = {
    swayFreq: swayRng.range(0.3, 0.5),
    bounceFreq: swayRng.range(1.6, 2.2),
    phase: swayRng.range(0, 2 * Math.PI),
  }
  const holdKin = spec.motion.kind === 'hold'
    ? holdPoseKin(ctx, spec.motion.pose, spec.motion.refFrameIndex)
    : null

  // Dropout windows (video time)
  const dropRng = rng.fork('dropouts')
  const dropouts: [number, number][] = []
  for (let i = 0; i < (spec.dropouts?.count ?? 0); i++) {
    const d = dropRng.range(spec.dropouts!.minDur, spec.dropouts!.maxDur)
    const start = dropRng.range(Math.min(1, duration * 0.1), Math.max(1, duration - 1 - d))
    dropouts.push([start, start + d])
  }
  const presentFrom = (spec.presentFrom ?? 0) * duration
  const gaps = spec.gaps ?? []
  const lastRefTime = ctx.times[ctx.times.length - 1] ?? 0

  const jitter = spec.jitter ?? 0.003
  const wander = spec.wander ?? 0.01
  const T = ctx.torso
  const noiseRng = rng.fork('jitter')
  const confRng = rng.fork('conf')
  const wanderX = new Float64Array(NUM_KEYPOINTS)
  const wanderY = new Float64Array(NUM_KEYPOINTS)
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    wanderX[i] = wander * JITTER_SCALE[i] * T * noiseRng.normal()
    wanderY[i] = wander * JITTER_SCALE[i] * T * noiseRng.normal()
  }
  let hipConfState = 0
  const offsets = new Float64Array(BONES.length)
  const period = ctx.times.length > 1 ? ctx.times[ctx.times.length - 1] + (ctx.times[1] - ctx.times[0]) : duration

  const frames: DetectorFrame[] = []
  let prevRec = clock[0]?.recTime ?? 0
  for (const { recTime, videoTime } of clock) {
    const dtRec = Math.max(1e-3, recTime - prevRec)
    prevRec = recTime
    // AR(1) wander update (tau = 0.5 s)
    const rho = Math.exp(-dtRec / 0.5)
    const innov = Math.sqrt(1 - rho * rho)
    for (let i = 0; i < NUM_KEYPOINTS; i++) {
      wanderX[i] = rho * wanderX[i] + innov * wander * JITTER_SCALE[i] * T * noiseRng.normal()
      wanderY[i] = rho * wanderY[i] + innov * wander * JITTER_SCALE[i] * T * noiseRng.normal()
    }
    const hipRho = Math.exp(-dtRec / 0.8)
    hipConfState = hipRho * hipConfState + Math.sqrt(1 - hipRho * hipRho) * confRng.normal()

    const absent = videoTime < presentFrom ||
      dropouts.some(([a, b]) => videoTime >= a && videoTime < b) ||
      gaps.some(([a, b]) => videoTime >= a && videoTime < b)
    if (absent) {
      frames.push({ recTime, videoTime, pose: null })
      continue
    }

    if (spec.motion.kind === 'fixedPixelPose') {
      frames.push({ recTime, videoTime, pose: { keypoints: spec.motion.pose.keypoints.map((k) => ({ ...k })) } })
      continue
    }

    // Intended reference time
    let tau = shift + tempo * (videoTime - lag) + warp(videoTime)
    if (shift !== 0) tau = ((tau % period) + period) % period
    if (spec.reverse) tau = lastRefTime - tau

    let kin: Kin
    switch (spec.motion.kind) {
      case 'reference':
        kin = decompose(sampleReference(ctx, tau))
        break
      case 'neutral':
        kin = cloneKin(ctx.neutral)
        break
      case 'sway':
        kin = swayKin(ctx, spec.motion, swayParams, videoTime)
        break
      case 'flail': {
        kin = cloneKin(ctx.neutral)
        flailNoise!(videoTime, offsets)
        for (let i = 0; i < BONES.length; i++) kin.rel[i] += offsets[i]
        kin.rootX += flailRootX(videoTime)
        kin.rootY += flailRootY(videoTime)
        break
      }
      case 'hold':
        kin = cloneKin(holdKin!)
        break
    }

    if (hasBlend) kin = blendKin(kin, ctx.neutral, blend)
    if (angleNoise) {
      angleNoise(videoTime, offsets)
      for (let i = 0; i < BONES.length; i++) kin.rel[i] += offsets[i]
    }

    const body = compose(kin)
    const xs = new Float64Array(NUM_KEYPOINTS)
    const ys = new Float64Array(NUM_KEYPOINTS)
    for (let i = 0; i < NUM_KEYPOINTS; i++) {
      const src = spec.mirror ? LEFT_RIGHT_SWAP[i] : i
      const bx = spec.mirror ? 2 * kin.rootX - body.x[src] : body.x[src]
      const nx = bx + wanderX[i] + jitter * JITTER_SCALE[i] * T * noiseRng.normal()
      const ny = body.y[src] + wanderY[i] + jitter * JITTER_SCALE[i] * T * noiseRng.normal()
      xs[i] = nx * camera.scale + camera.offsetX
      ys[i] = ny * camera.scale + camera.offsetY
    }

    const conf = new Float64Array(NUM_KEYPOINTS)
    for (let i = 0; i < NUM_KEYPOINTS; i++) {
      conf[i] = Math.min(1, Math.max(0, BASE_CONF[i] + 0.015 * confRng.normal()))
    }
    if (visibility === 'upper') {
      for (const i of LEG_INDICES) conf[i] = confRng.range(0.0001, 0.01)
      const hip = Math.min(0.92, Math.max(0.3, 0.7 + 0.08 * hipConfState))
      conf[KP.left_hip] = Math.min(0.95, Math.max(0.3, hip + 0.02 * confRng.normal()))
      conf[KP.right_hip] = Math.min(0.95, Math.max(0.3, hip + 0.02 * confRng.normal()))
    }

    frames.push({
      recTime,
      videoTime,
      pose: {
        keypoints: Array.from({ length: NUM_KEYPOINTS }, (_, i) => ({
          x: xs[i],
          y: ys[i],
          score: conf[i],
          name: KEYPOINT_NAMES[i],
        })),
      },
    })
  }

  return {
    frames,
    meta: {
      videoDelay,
      camera,
      dropouts,
      gaps,
      presentFrom,
      lag,
      frames: frames.length,
      detected: frames.filter((f) => f.pose !== null).length,
    },
  }
}

// ---------------------------------------------------------------------------
// Recording policies
// ---------------------------------------------------------------------------

/**
 * How DanceMode turns detector frames into the user TimestampedPose[] passed to
 * computePostDanceScore:
 * - 'presence' (DanceMode @ 7aebdba): only frames where the frozen baseline checkPresence()
 *   passes (6 of 8 core keypoints shoulders/elbows/hips/knees at >= 0.5 confidence).
 * - 'detected': every frame where the detector returned a pose.
 * - 'all': every frame; frames without a pose become { time, pose: { keypoints: [] } }.
 * - a function: custom recording rule; return the TimestampedPose to record or null to skip.
 */
export type NamedRecordPolicy = 'presence' | 'detected' | 'all'
export type RecordFn = (frame: DetectorFrame) => TimestampedPose | null
export type RecordPolicy = NamedRecordPolicy | RecordFn

export const RECORD_POLICIES: NamedRecordPolicy[] = ['presence', 'detected', 'all']

export function recordPolicyName(policy: RecordPolicy): string {
  return typeof policy === 'function' ? 'custom' : policy
}

export function recordSession(frames: DetectorFrame[], policy: RecordPolicy): TimestampedPose[] {
  const out: TimestampedPose[] = []
  for (const f of frames) {
    if (typeof policy === 'function') {
      const rec = policy(f)
      if (rec) out.push(rec)
    } else if (f.pose) {
      if (policy === 'presence' && !checkPresence(f.pose).present) continue
      out.push({ time: f.recTime, pose: f.pose })
    } else if (policy === 'all') {
      out.push({ time: f.recTime, pose: { keypoints: [] } })
    }
  }
  return out
}

/**
 * Wrap a recorded session (e.g. the real fixtures) as detector frames: frames on a 30 fps
 * clock with pose null fill the time before the first / after the last recorded frame and
 * internal gaps longer than `gapFill` s (DanceMode's loop kept running; the presence gate failed,
 * so nothing was recorded). Lab-only context: scorers get `recorded` as the user poses.
 */
export function framesFromRecorded(
  recorded: TimestampedPose[],
  duration: number,
  videoDelay = 0.03,
  fps = 30,
  gapFill = 0.1,
): DetectorFrame[] {
  const frames: DetectorFrame[] = []
  const first = recorded[0]?.time ?? duration
  const last = recorded[recorded.length - 1]?.time ?? 0
  const videoOf = (t: number) => Math.min(duration, Math.max(0, t - videoDelay))
  for (let t = 1 / fps; t < first - 0.5 / fps; t += 1 / fps) {
    frames.push({ recTime: t, videoTime: videoOf(t), pose: null })
  }
  recorded.forEach((p, i) => {
    const prev = i > 0 ? recorded[i - 1].time : undefined
    if (prev !== undefined && p.time - prev > gapFill) {
      for (let t = prev + 1 / fps; t < p.time - 0.5 / fps; t += 1 / fps) {
        frames.push({ recTime: t, videoTime: videoOf(t), pose: null })
      }
    }
    frames.push({ recTime: p.time, videoTime: videoOf(p.time), pose: p.pose })
  })
  for (let t = last + 1 / fps; t - videoDelay <= duration; t += 1 / fps) {
    frames.push({ recTime: t, videoTime: Math.min(duration, t - videoDelay), pose: null })
  }
  return frames
}
