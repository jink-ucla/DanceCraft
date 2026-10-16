import type { Keypoint, Pose } from '../scoring/types'
import { KEYPOINT_NAMES } from '../scoring/types'

/**
 * DanceCraft characters drawn by TargetPoseFigure / DancingCharacter.
 *
 * - mannequin:  Groovy's original capsule figure (unchanged look)
 * - buddy:      the AI Coach mascot (teal hoodie, headphones)
 * - host:       the host's avatar, e.g. Wasil (gold outfit, crown)
 * - challenger: the player (green/pink outfit, headband)
 */
export type CharacterId = 'mannequin' | 'buddy' | 'host' | 'challenger'

export const CHARACTER_IDS: readonly CharacterId[] = ['mannequin', 'buddy', 'host', 'challenger']

export type CharacterAccessory = 'none' | 'headphones' | 'crown' | 'headband'
export type CharacterTorsoDetail = 'none' | 'pocket' | 'star' | 'stripe'

export interface CharacterStyle {
  /** Human-readable name, handy for captions / alt text. */
  label: string
  skin: string
  /** Shirt / hoodie body. */
  torso: string
  /** Pocket, emblem or stripe on the torso (see torsoDetail). */
  torsoDetail: CharacterTorsoDetail
  torsoDetailColor: string
  /** Upper arms (forearms and hands are skin). */
  sleeves: string
  pants: string
  shoes: string
  outline: string
  /** Hair cap on top of the head; null = bald / mascot head. */
  hair: string | null
  eyes: string
  cheeks: string
  accessory: CharacterAccessory
  accessoryColor: string
  /** Secondary accessory color (headphone cushions, crown gems, band stripe). */
  accessoryAlt: string
}

/** Same color for every part = the original mannequin look. */
const MANNEQUIN_FILL = 'rgba(230, 240, 255, 0.93)'
const MANNEQUIN_OUTLINE = 'rgba(0, 0, 0, 0.55)'

export const CHARACTER_STYLES: Record<CharacterId, CharacterStyle> = {
  mannequin: {
    label: 'Mannequin',
    skin: MANNEQUIN_FILL,
    torso: MANNEQUIN_FILL,
    torsoDetail: 'none',
    torsoDetailColor: MANNEQUIN_FILL,
    sleeves: MANNEQUIN_FILL,
    pants: MANNEQUIN_FILL,
    shoes: MANNEQUIN_FILL,
    outline: MANNEQUIN_OUTLINE,
    hair: null,
    eyes: MANNEQUIN_OUTLINE,
    cheeks: 'transparent',
    accessory: 'none',
    accessoryColor: MANNEQUIN_FILL,
    accessoryAlt: MANNEQUIN_FILL,
  },
  buddy: {
    label: 'Coach Buddy',
    skin: '#ffd3b0',
    torso: '#1fd6c8',
    torsoDetail: 'pocket',
    torsoDetailColor: '#13a89f',
    sleeves: '#0f8f8a',
    pants: '#2c4384',
    shoes: '#f5f8ff',
    outline: '#0b1022',
    hair: null,
    eyes: '#141a33',
    cheeks: 'rgba(255, 120, 140, 0.55)',
    accessory: 'headphones',
    accessoryColor: '#2a3150',
    accessoryAlt: '#00ccff',
  },
  host: {
    label: 'Host',
    skin: '#d8a07a',
    torso: '#ffcc00',
    torsoDetail: 'star',
    torsoDetailColor: '#fff6c9',
    sleeves: '#e0a100',
    pants: '#4a3a7a',
    shoes: '#fff1c1',
    outline: '#140d02',
    hair: '#2a1a12',
    eyes: '#1a1208',
    cheeks: 'rgba(255, 110, 90, 0.45)',
    accessory: 'crown',
    accessoryColor: '#ffd84a',
    accessoryAlt: '#ff6b6b',
  },
  challenger: {
    label: 'Challenger',
    skin: '#f3c39c',
    torso: '#2ee68f',
    torsoDetail: 'stripe',
    torsoDetailColor: '#ff5fa2',
    sleeves: '#ff5fa2',
    pants: '#3b2f6b',
    shoes: '#ffffff',
    outline: '#071a10',
    hair: '#3a2418',
    eyes: '#141414',
    cheeks: 'rgba(255, 95, 162, 0.5)',
    accessory: 'headband',
    accessoryColor: '#ff5fa2',
    accessoryAlt: '#ffffff',
  },
}

/**
 * Body proportions for the cartoon characters, as fractions of the body
 * unit (torso length = shoulder-midpoint to hip-midpoint). Shared by the
 * renderer and the bounds helpers so framing always fits the drawing.
 */
export const CHARACTER_PROPORTIONS = {
  headRadius: 0.34,
  /** Head center sits this many head radii above eye level. */
  headLift: 0.12,
  /** Accessory headroom above the head center, in head radii. */
  accessoryTop: 1.55,
  /** Accessory side reach (headphone cups), in head radii. */
  accessorySide: 1.4,
  thigh: 0.26,
  calfTop: 0.21,
  calfBottom: 0.15,
  upperArm: 0.18,
  forearmTop: 0.15,
  forearmBottom: 0.12,
  neck: 0.16,
  hand: 0.095,
  shoe: 0.17,
  /** Extra padding around keypoints for limb thickness + outline. */
  pad: 0.16,
} as const

export const MIN_KEYPOINT_CONF = 0.15

/** MediaPipe BlazePose 33-landmark indices used by the figures. */
export const KP = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
  rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
} as const

/** Keypoints that define the body silhouette (face detail skipped). */
export const BODY_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

/**
 * Fixed viewport in pose coordinates. Passing the same frame for every pose
 * of an animation keeps the figure from zooming in/out as limbs move.
 */
export interface PoseFrame {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Body unit (torso length) in pose coordinates; keeps limb widths stable. */
  bodyScale?: number
}

// ---------------------------------------------------------------------------
// Default standing pose (normalized 0-1 image coordinates, y down, subject
// facing the camera so the subject's left side is on the image right — the
// same convention as MediaPipe output).
// ---------------------------------------------------------------------------

const STANDING: Record<string, [number, number, number]> = {
  nose: [0.5, 0.17, 0.99],
  left_eye_inner: [0.512, 0.155, 0.99],
  left_eye: [0.52, 0.155, 0.99],
  left_eye_outer: [0.528, 0.156, 0.99],
  right_eye_inner: [0.488, 0.155, 0.99],
  right_eye: [0.48, 0.155, 0.99],
  right_eye_outer: [0.472, 0.156, 0.99],
  left_ear: [0.545, 0.165, 0.95],
  right_ear: [0.455, 0.165, 0.95],
  mouth_left: [0.512, 0.19, 0.99],
  mouth_right: [0.488, 0.19, 0.99],
  left_shoulder: [0.585, 0.26, 0.99],
  right_shoulder: [0.415, 0.26, 0.99],
  left_elbow: [0.607, 0.395, 0.97],
  right_elbow: [0.393, 0.395, 0.97],
  left_wrist: [0.612, 0.525, 0.95],
  right_wrist: [0.388, 0.525, 0.95],
  left_pinky: [0.617, 0.56, 0.9],
  right_pinky: [0.383, 0.56, 0.9],
  left_index: [0.609, 0.565, 0.9],
  right_index: [0.391, 0.565, 0.9],
  left_thumb: [0.6, 0.55, 0.9],
  right_thumb: [0.4, 0.55, 0.9],
  left_hip: [0.555, 0.53, 0.99],
  right_hip: [0.445, 0.53, 0.99],
  left_knee: [0.558, 0.72, 0.98],
  right_knee: [0.442, 0.72, 0.98],
  left_ankle: [0.56, 0.89, 0.97],
  right_ankle: [0.44, 0.89, 0.97],
  left_heel: [0.555, 0.908, 0.95],
  right_heel: [0.445, 0.908, 0.95],
  left_foot_index: [0.585, 0.925, 0.95],
  right_foot_index: [0.415, 0.925, 0.95],
}

/** 33 MediaPipe keypoints, relaxed standing pose (KEYPOINT_NAMES order). */
export const DEFAULT_STANDING_POSE: Pose = {
  keypoints: KEYPOINT_NAMES.map((name) => {
    const [x, y, score] = STANDING[name]
    return { name, x, y, score }
  }),
}

// ---------------------------------------------------------------------------
// Idle "groove" animation built from the standing pose.
// ---------------------------------------------------------------------------

const IDLE_BPM = 96
const UPPER_BODY = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// Arm chains: [shoulder, elbow, wrist, pinky, index, thumb]
const LEFT_ARM = [11, 13, 15, 17, 19, 21]
const RIGHT_ARM = [12, 14, 16, 18, 20, 22]

function rotateAround(kp: Keypoint, cx: number, cy: number, angle: number): void {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = kp.x - cx
  const dy = kp.y - cy
  kp.x = cx + dx * cos - dy * sin
  kp.y = cy + dx * sin + dy * cos
}

/**
 * Gentle idle groove (bounce on the beat, arms swaying side to side, a little
 * head bob) derived from DEFAULT_STANDING_POSE. Pure function of time (s).
 */
export function idlePoseAt(timeSeconds: number): Pose {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0
  const beat = (t * IDLE_BPM) / 60
  const kps = DEFAULT_STANDING_POSE.keypoints.map((kp) => ({ ...kp }))

  // Knee-bend bounce: dips once per beat, feet stay planted.
  const dip = (1 - Math.cos(beat * Math.PI * 2)) / 2 // 0..1
  const bounce = dip * 0.018
  const sway = Math.sin(beat * Math.PI) // one side-to-side per two beats
  const hipShift = sway * 0.008

  for (let i = 0; i < kps.length; i++) {
    if (UPPER_BODY.has(i)) {
      kps[i].y += bounce
      kps[i].x += hipShift
    }
  }
  // Knees push slightly outward and down as the body dips.
  kps[KP.leftKnee].x += dip * 0.008 + hipShift * 0.5
  kps[KP.rightKnee].x -= dip * 0.008 - hipShift * 0.5
  kps[KP.leftKnee].y += bounce * 0.4
  kps[KP.rightKnee].y += bounce * 0.4

  // Arms: swing together around the shoulders, forearms flick a bit more.
  const armSwing = sway * 0.32
  const forearmFlick = Math.sin(beat * Math.PI - 0.6) * 0.22
  for (const chain of [LEFT_ARM, RIGHT_ARM]) {
    const [shoulder, elbow, ...hand] = chain
    const s = kps[shoulder]
    for (const i of [elbow, ...hand]) rotateAround(kps[i], s.x, s.y, armSwing)
    const e = kps[elbow]
    for (const i of hand) rotateAround(kps[i], e.x, e.y, forearmFlick)
  }

  // Head bob: small tilt around the neck.
  const neckX = (kps[KP.leftShoulder].x + kps[KP.rightShoulder].x) / 2
  const neckY = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2
  const tilt = Math.sin(beat * Math.PI + 0.4) * 0.1
  for (const i of HEAD) rotateAround(kps[i], neckX, neckY, tilt)

  return { keypoints: kps }
}

// ---------------------------------------------------------------------------
// Geometry helpers shared by the renderer and the framing logic. All values
// are in pose coordinates (scale-free).
// ---------------------------------------------------------------------------

function ok(kps: readonly Keypoint[], i: number): boolean {
  const kp = kps[i]
  return !!kp && kp.score >= MIN_KEYPOINT_CONF && Number.isFinite(kp.x) && Number.isFinite(kp.y)
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

/**
 * Body unit = torso length (shoulder midpoint to hip midpoint), falling back
 * to shoulder or hip width. null when none of those are visible.
 */
export function bodyScaleOf(kps: readonly Keypoint[]): number | null {
  const shoulders = ok(kps, KP.leftShoulder) && ok(kps, KP.rightShoulder)
  const hips = ok(kps, KP.leftHip) && ok(kps, KP.rightHip)
  if (shoulders && hips) {
    const smx = (kps[KP.leftShoulder].x + kps[KP.rightShoulder].x) / 2
    const smy = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2
    const hmx = (kps[KP.leftHip].x + kps[KP.rightHip].x) / 2
    const hmy = (kps[KP.leftHip].y + kps[KP.rightHip].y) / 2
    const torso = dist(smx, smy, hmx, hmy)
    const shoulderW = dist(kps[KP.leftShoulder].x, kps[KP.leftShoulder].y, kps[KP.rightShoulder].x, kps[KP.rightShoulder].y)
    // Bending toward the camera foreshortens the torso; shoulders keep it sane.
    const value = Math.max(torso, shoulderW * 1.1)
    if (value > 0) return value
  }
  if (shoulders) {
    const w = dist(kps[KP.leftShoulder].x, kps[KP.leftShoulder].y, kps[KP.rightShoulder].x, kps[KP.rightShoulder].y)
    if (w > 0) return w * 1.5
  }
  if (hips) {
    const w = dist(kps[KP.leftHip].x, kps[KP.leftHip].y, kps[KP.rightHip].x, kps[KP.rightHip].y)
    if (w > 0) return w * 2.4
  }
  return null
}

export interface HeadGeometry {
  /** Head center (pose coordinates). */
  cx: number
  cy: number
  /** Head radius (pose coordinates). */
  r: number
  /** Unit vector pointing from chin to crown. */
  upX: number
  upY: number
  /** -1..1, how far the face is turned toward image-left (-) / image-right (+). */
  yaw: number
}

/**
 * Where to draw the big cartoon head for a pose, given the body unit.
 * Returns null when the nose is not visible.
 */
export function headGeometry(kps: readonly Keypoint[], unit: number): HeadGeometry | null {
  if (!ok(kps, KP.nose) || !(unit > 0)) return null
  const nose = kps[KP.nose]
  const r = unit * CHARACTER_PROPORTIONS.headRadius

  const eyes = ok(kps, KP.leftEye) && ok(kps, KP.rightEye)
  const ears = ok(kps, KP.leftEar) && ok(kps, KP.rightEar)

  // Up vector: neck base -> face.
  let upX = 0
  let upY = -1
  if (ok(kps, KP.leftShoulder) && ok(kps, KP.rightShoulder)) {
    const nx = (kps[KP.leftShoulder].x + kps[KP.rightShoulder].x) / 2
    const ny = (kps[KP.leftShoulder].y + kps[KP.rightShoulder].y) / 2
    const len = dist(nx, ny, nose.x, nose.y)
    if (len > unit * 0.05) {
      upX = (nose.x - nx) / len
      upY = (nose.y - ny) / len
    }
  }
  // Lateral axis (image-right when upright).
  const latX = -upY
  const latY = upX

  // Eye level anchors the head; fall back to slightly above the nose.
  let baseX = nose.x + upX * r * 0.3
  let baseY = nose.y + upY * r * 0.3
  if (eyes) {
    baseX = (kps[KP.leftEye].x + kps[KP.rightEye].x) / 2
    baseY = (kps[KP.leftEye].y + kps[KP.rightEye].y) / 2
  }
  const lift = r * CHARACTER_PROPORTIONS.headLift
  const cx = baseX + upX * lift
  const cy = baseY + upY * lift

  // Yaw from nose offset vs. the ear (or eye) midpoint, along the lateral axis.
  let yaw = 0
  if (ears) {
    const mx = (kps[KP.leftEar].x + kps[KP.rightEar].x) / 2
    const my = (kps[KP.leftEar].y + kps[KP.rightEar].y) / 2
    const off = (nose.x - mx) * latX + (nose.y - my) * latY
    const earDist = dist(kps[KP.leftEar].x, kps[KP.leftEar].y, kps[KP.rightEar].x, kps[KP.rightEar].y)
    yaw = Math.sin(Math.atan2(off * 1.5, earDist))
  } else if (ok(kps, KP.leftEar) || ok(kps, KP.rightEar)) {
    const ear = ok(kps, KP.leftEar) ? kps[KP.leftEar] : kps[KP.rightEar]
    const side = (ear.x - nose.x) * latX + (ear.y - nose.y) * latY
    yaw = side < 0 ? 0.75 : -0.75
  } else if (eyes) {
    const mx = (kps[KP.leftEye].x + kps[KP.rightEye].x) / 2
    const my = (kps[KP.leftEye].y + kps[KP.rightEye].y) / 2
    const off = (nose.x - mx) * latX + (nose.y - my) * latY
    const eyeDist = dist(kps[KP.leftEye].x, kps[KP.leftEye].y, kps[KP.rightEye].x, kps[KP.rightEye].y)
    yaw = Math.sin(Math.atan2(off * 3, eyeDist))
  }
  if (!Number.isFinite(yaw)) yaw = 0

  return { cx, cy, r, upX, upY, yaw: Math.max(-1, Math.min(1, yaw)) }
}

/**
 * Bounding box (pose coordinates) that contains everything the renderer
 * draws for this character: visible body keypoints, limb thickness, the big
 * head and its accessory. Mannequin = plain keypoint box (original framing).
 * Returns null when fewer than 4 body keypoints are visible.
 */
export function characterBounds(pose: Pose, character: CharacterId, bodyScale?: number): PoseFrame | null {
  const kps = pose.keypoints
  if (!kps || kps.length < 17) return null

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let visible = 0
  for (const i of BODY_INDICES) {
    if (!ok(kps, i)) continue
    minX = Math.min(minX, kps[i].x)
    maxX = Math.max(maxX, kps[i].x)
    minY = Math.min(minY, kps[i].y)
    maxY = Math.max(maxY, kps[i].y)
    visible++
  }
  if (visible < 4) return null

  const unit = bodyScale && bodyScale > 0
    ? bodyScale
    : bodyScaleOf(kps) ?? 0.3 * Math.max(maxX - minX, maxY - minY, 1e-6)

  if (character === 'mannequin') return { minX, minY, maxX, maxY, bodyScale: unit }

  const pad = unit * CHARACTER_PROPORTIONS.pad
  minX -= pad
  maxX += pad
  minY -= pad
  maxY += pad

  const head = headGeometry(kps, unit)
  if (head) {
    const side = head.r * CHARACTER_PROPORTIONS.accessorySide
    minX = Math.min(minX, head.cx - side)
    maxX = Math.max(maxX, head.cx + side)
    minY = Math.min(minY, head.cy - side)
    maxY = Math.max(maxY, head.cy + side)
    const topX = head.cx + head.upX * head.r * CHARACTER_PROPORTIONS.accessoryTop
    const topY = head.cy + head.upY * head.r * CHARACTER_PROPORTIONS.accessoryTop
    minX = Math.min(minX, topX)
    maxX = Math.max(maxX, topX)
    minY = Math.min(minY, topY)
    maxY = Math.max(maxY, topY)
  }

  return { minX, minY, maxX, maxY, bodyScale: unit }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * One stable viewport for a whole sequence of poses (an animation loop):
 * union of the per-pose character bounds (robust to single-frame glitches
 * when there are many poses) with a median body unit.
 */
export function computePoseFrame(poses: readonly Pose[], character: CharacterId): PoseFrame | null {
  const scales: number[] = []
  for (const p of poses) {
    const s = p.keypoints ? bodyScaleOf(p.keypoints) : null
    if (s && s > 0) scales.push(s)
  }
  scales.sort((a, b) => a - b)
  const bodyScale = scales.length > 0 ? quantile(scales, 0.5) : undefined

  const minXs: number[] = []
  const minYs: number[] = []
  const maxXs: number[] = []
  const maxYs: number[] = []
  for (const p of poses) {
    const b = characterBounds(p, character, bodyScale)
    if (!b) continue
    minXs.push(b.minX)
    minYs.push(b.minY)
    maxXs.push(b.maxX)
    maxYs.push(b.maxY)
  }
  if (minXs.length === 0) return null

  // Ignore the most extreme 2% on each side once there are enough samples.
  const q = minXs.length >= 20 ? 0.02 : 0
  for (const arr of [minXs, minYs, maxXs, maxYs]) arr.sort((a, b) => a - b)
  const minX = quantile(minXs, q)
  const minY = quantile(minYs, q)
  const maxX = quantile(maxXs, 1 - q)
  const maxY = quantile(maxYs, 1 - q)
  return {
    minX,
    minY,
    maxX,
    maxY,
    bodyScale: bodyScale ?? 0.3 * Math.max(maxX - minX, maxY - minY, 1e-6),
  }
}
