import { useRef, useEffect } from 'react'
import type { Keypoint, Pose } from '../scoring/types'
import type { CharacterId, CharacterStyle, HeadGeometry, PoseFrame } from './characters'
import {
  BODY_INDICES,
  CHARACTER_PROPORTIONS as P,
  CHARACTER_STYLES,
  KP,
  MIN_KEYPOINT_CONF,
  bodyScaleOf,
  characterBounds,
  headGeometry,
} from './characters'

interface TargetPoseFigureProps {
  pose: Pose | null
  size?: number
  className?: string
  /** Which character to draw. Default 'mannequin' (Groovy's original figure). */
  character?: CharacterId
  /** CSS color for a soft outer glow (e.g. combo highlight). */
  glow?: string
  /**
   * Fixed viewport in pose coordinates (see computePoseFrame). Use it for
   * animations so the figure doesn't zoom as limbs move. Default: fit the pose.
   */
  frame?: PoseFrame
}

const MIN_CONF = MIN_KEYPOINT_CONF

/**
 * Draws a tapered capsule (stadium shape) between two points.
 */
function drawCapsule(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const perpAngle = angle + Math.PI / 2
  const cos = Math.cos(perpAngle)
  const sin = Math.sin(perpAngle)

  ctx.beginPath()
  ctx.arc(x1, y1, w1 / 2, perpAngle, perpAngle + Math.PI)
  ctx.lineTo(x2 - cos * w2 / 2, y2 - sin * w2 / 2)
  ctx.arc(x2, y2, w2 / 2, perpAngle + Math.PI, perpAngle)
  ctx.closePath()

  if (outlineWidth > 0) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidth
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  ctx.fillStyle = fillColor
  ctx.fill()
}

/**
 * Original Groovy mannequin: every body segment is a tapered capsule with
 * dark outlines, fitted to the pose's bounding box (or to `frame`).
 */
function drawMannequin(
  ctx: CanvasRenderingContext2D,
  kps: Keypoint[],
  w: number,
  h: number,
  frame: PoseFrame | undefined,
) {
  // Find bounding box of visible keypoints
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let visibleCount = 0
  for (const i of BODY_INDICES) {
    if (!kps[i] || kps[i].score < MIN_CONF) continue
    minX = Math.min(minX, kps[i].x)
    maxX = Math.max(maxX, kps[i].x)
    minY = Math.min(minY, kps[i].y)
    maxY = Math.max(maxY, kps[i].y)
    visibleCount++
  }

  if (visibleCount < 4) return

  if (frame) {
    minX = frame.minX
    maxX = frame.maxX
    minY = frame.minY
    maxY = frame.maxY
  }

  // Tight margin around bounding box
  const rangeX = maxX - minX || 0.1
  const rangeY = maxY - minY || 0.1
  const margin = 0.08
  const bx = minX - rangeX * margin
  const by = minY - rangeY * margin
  const bw = rangeX * (1 + margin * 2)
  const bh = rangeY * (1 + margin * 2)

  // Scale to fit canvas, minimal padding
  const pad = 4
  const drawW = w - pad * 2
  const drawH = h - pad * 2
  const scale = Math.min(drawW / bw, drawH / bh)
  const offsetX = pad + (drawW - bw * scale) / 2
  const offsetY = pad + (drawH - bh * scale) / 2

  const px = (i: number) => kps[i] ? offsetX + (kps[i].x - bx) * scale : 0
  const py = (i: number) => kps[i] ? offsetY + (kps[i].y - by) * scale : 0
  const conf = (i: number) => kps[i]?.score ?? 0

  // Use the smaller of figure width/height for proportional sizing
  // This prevents fat limbs on wide poses
  const figW = rangeX * scale
  const figH = rangeY * scale
  const figSize = Math.min(figW, figH)
  const outlineW = Math.max(1, figSize * 0.015)

  // Body part widths — slim proportions, readable at small sizes
  const thighW = Math.max(5, figSize * 0.06)
  const calfW1 = Math.max(4, figSize * 0.045)
  const calfW2 = Math.max(2.5, figSize * 0.025)
  const upperArmW = Math.max(4, figSize * 0.045)
  const forearmW1 = Math.max(3, figSize * 0.035)
  const forearmW2 = Math.max(2, figSize * 0.02)
  const neckW = Math.max(3, figSize * 0.03)

  const fillColor = 'rgba(230, 240, 255, 0.93)'
  const outlineColor = 'rgba(0, 0, 0, 0.55)'

  const drawSegment = (a: number, b: number, wa: number, wb: number) => {
    if (conf(a) < MIN_CONF || conf(b) < MIN_CONF) return
    drawCapsule(ctx, px(a), py(a), wa, px(b), py(b), wb, fillColor, outlineColor, outlineW)
  }

  // === DRAW ORDER: back-to-front ===

  // 1. LEGS
  drawSegment(KP.leftHip, KP.leftKnee, thighW, calfW1)
  drawSegment(KP.leftKnee, KP.leftAnkle, calfW1, calfW2)
  drawSegment(KP.rightHip, KP.rightKnee, thighW, calfW1)
  drawSegment(KP.rightKnee, KP.rightAnkle, calfW1, calfW2)

  // 2. TORSO
  if (conf(KP.leftShoulder) >= MIN_CONF && conf(KP.rightShoulder) >= MIN_CONF &&
      conf(KP.leftHip) >= MIN_CONF && conf(KP.rightHip) >= MIN_CONF) {
    const lsx = px(KP.leftShoulder), lsy = py(KP.leftShoulder)
    const rsx = px(KP.rightShoulder), rsy = py(KP.rightShoulder)
    const lhx = px(KP.leftHip), lhy = py(KP.leftHip)
    const rhx = px(KP.rightHip), rhy = py(KP.rightHip)

    const shoulderExpand = Math.max(2, figSize * 0.015)

    const sdx = rsx - lsx, sdy = rsy - lsy
    const sLen = Math.sqrt(sdx * sdx + sdy * sdy) || 1
    const snx = sdx / sLen, sny = sdy / sLen

    ctx.beginPath()
    ctx.moveTo(lsx - snx * shoulderExpand, lsy - sny * shoulderExpand)
    ctx.lineTo(rsx + snx * shoulderExpand, rsy + sny * shoulderExpand)
    ctx.lineTo(rhx, rhy)
    ctx.lineTo(lhx, lhy)
    ctx.closePath()

    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineW
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.fillStyle = fillColor
    ctx.fill()
  }

  // 3. NECK
  if (conf(KP.nose) >= MIN_CONF && conf(KP.leftShoulder) >= MIN_CONF && conf(KP.rightShoulder) >= MIN_CONF) {
    const neckBaseX = (px(KP.leftShoulder) + px(KP.rightShoulder)) / 2
    const neckBaseY = (py(KP.leftShoulder) + py(KP.rightShoulder)) / 2
    drawCapsule(ctx, px(KP.nose), py(KP.nose), neckW, neckBaseX, neckBaseY, neckW, fillColor, outlineColor, outlineW)
  }

  // 4. ARMS (in front of torso — most important for readability)
  drawSegment(KP.leftShoulder, KP.leftElbow, upperArmW, forearmW1)
  drawSegment(KP.leftElbow, KP.leftWrist, forearmW1, forearmW2)
  drawSegment(KP.rightShoulder, KP.rightElbow, upperArmW, forearmW1)
  drawSegment(KP.rightElbow, KP.rightWrist, forearmW1, forearmW2)

  // 5. HANDS
  const handR = Math.max(2, figSize * 0.015)
  for (const i of [KP.leftWrist, KP.rightWrist]) {
    if (conf(i) >= MIN_CONF) {
      ctx.beginPath()
      ctx.arc(px(i), py(i), handR, 0, Math.PI * 2)
      ctx.strokeStyle = outlineColor
      ctx.lineWidth = outlineW
      ctx.stroke()
      ctx.fillStyle = fillColor
      ctx.fill()
    }
  }

  // 6. FEET
  const footR = Math.max(2.5, figSize * 0.02)
  for (const i of [KP.leftAnkle, KP.rightAnkle]) {
    if (conf(i) >= MIN_CONF) {
      ctx.beginPath()
      ctx.arc(px(i), py(i), footR, 0, Math.PI * 2)
      ctx.strokeStyle = outlineColor
      ctx.lineWidth = outlineW
      ctx.stroke()
      ctx.fillStyle = fillColor
      ctx.fill()
    }
  }

  // 7. HEAD
  if (conf(KP.nose) >= MIN_CONF) {
    let headRadius = Math.max(4, figSize * 0.045)
    if (conf(KP.leftShoulder) >= MIN_CONF && conf(KP.rightShoulder) >= MIN_CONF) {
      const shoulderWidth = Math.abs(px(KP.leftShoulder) - px(KP.rightShoulder))
      headRadius = Math.max(4, shoulderWidth * 0.3)
    }
    ctx.beginPath()
    ctx.arc(px(KP.nose), py(KP.nose), headRadius, 0, Math.PI * 2)
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineW
    ctx.stroke()
    ctx.fillStyle = fillColor
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Cartoon characters (buddy / host / challenger)
// ---------------------------------------------------------------------------

/** Adds a tapered capsule as a new subpath (no beginPath / paint). */
function addCapsule(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
) {
  const perpAngle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2
  const cos = Math.cos(perpAngle)
  const sin = Math.sin(perpAngle)
  ctx.moveTo(x1 + cos * w1 / 2, y1 + sin * w1 / 2)
  ctx.arc(x1, y1, w1 / 2, perpAngle, perpAngle + Math.PI)
  ctx.lineTo(x2 - cos * w2 / 2, y2 - sin * w2 / 2)
  ctx.arc(x2, y2, w2 / 2, perpAngle + Math.PI, perpAngle)
  ctx.closePath()
}

function addCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x + r, y)
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.closePath()
}

function addEllipse(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, rx: number, ry: number, rotation: number,
) {
  ctx.moveTo(x + Math.cos(rotation) * rx, y + Math.sin(rotation) * rx)
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2)
  ctx.closePath()
}

interface Shape {
  build: (ctx: CanvasRenderingContext2D) => void
  fill: string
}

/**
 * Paints a group of shapes as one cartoon piece: every outline first, then
 * every fill, so joints inside the group are seamless while the group as a
 * whole gets a crisp silhouette over whatever was drawn before it.
 */
function paintGroup(ctx: CanvasRenderingContext2D, shapes: Shape[], outline: string, outlineW: number) {
  if (shapes.length === 0) return
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = outline
  ctx.lineWidth = outlineW * 2
  for (const s of shapes) {
    ctx.beginPath()
    s.build(ctx)
    ctx.stroke()
  }
  for (const s of shapes) {
    ctx.beginPath()
    s.build(ctx)
    ctx.fillStyle = s.fill
    ctx.fill()
  }
}

/**
 * Re-centers segment a-b on its midpoint with a minimum half-length (side
 * views collapse shoulders/hips to a point) plus `extra` on each side. When
 * the segment is short its direction is noisy, so it leans toward `fallback`.
 */
function widen(
  ax: number, ay: number, bx: number, by: number,
  minHalf: number, extra: number,
  fallbackX: number, fallbackY: number,
): [number, number, number, number] {
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const len = Math.hypot(bx - ax, by - ay)
  let ux = fallbackX
  let uy = fallbackY
  if (len > 1e-6) {
    ux = (bx - ax) / len
    uy = (by - ay) / len
    if (len / 2 < minHalf) {
      const sign = ux * fallbackX + uy * fallbackY >= 0 ? 1 : -1
      const t = 1 - (len / 2) / minHalf
      ux = ux * (1 - t) + fallbackX * sign * t
      uy = uy * (1 - t) + fallbackY * sign * t
      const ul = Math.hypot(ux, uy) || 1
      ux /= ul
      uy /= ul
    }
  }
  const half = Math.max(len / 2, minHalf) + extra
  return [mx - ux * half, my - uy * half, mx + ux * half, my + uy * half]
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rotation: number) {
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 === 0 ? r : r * 0.45
    const a = rotation - Math.PI / 2 + (k * Math.PI) / 5
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (k === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/** Head, hair, face and accessory, drawn in head-local coordinates. */
function drawHead(
  ctx: CanvasRenderingContext2D,
  style: CharacterStyle,
  hx: number, hy: number, R: number,
  head: HeadGeometry,
  outlineW: number,
) {
  const yaw = head.yaw
  ctx.save()
  ctx.translate(hx, hy)
  ctx.rotate(Math.atan2(head.upY, head.upX) + Math.PI / 2)

  // Skull
  paintGroup(ctx, [{ build: (c) => addCircle(c, 0, 0, R), fill: style.skin }], style.outline, outlineW)

  // Hair cap with a rounded fringe + side hair (more on the back of the head)
  if (style.hair) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = style.hair
    ctx.beginPath()
    addCircle(ctx, -yaw * 0.25 * R, -1.3 * R, 1.05 * R)
    // Rounded side hair, fuller on the back of the head when it turns
    const backL = 0.22 + Math.max(0, yaw) * 0.3
    const backR = 0.22 + Math.max(0, -yaw) * 0.3
    addEllipse(ctx, -R, -0.3 * R, backL * R, 0.5 * R, 0)
    addEllipse(ctx, R, -0.3 * R, backR * R, 0.5 * R, 0)
    ctx.fill()
    ctx.restore()
  }

  // Headband (under the face features, over the hair)
  if (style.accessory === 'headband') {
    const top = -0.64 * R
    const bandH = 0.26 * R
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = style.accessoryColor
    ctx.fillRect(-R, top, 2 * R, bandH)
    if (R >= 8) {
      ctx.fillStyle = style.accessoryAlt
      ctx.fillRect(-R, top + bandH * 0.42, 2 * R, bandH * 0.16)
    }
    ctx.strokeStyle = style.outline
    ctx.lineWidth = Math.max(0.75, outlineW * 0.8)
    ctx.beginPath()
    ctx.moveTo(-R, top)
    ctx.lineTo(R, top)
    ctx.moveTo(-R, top + bandH)
    ctx.lineTo(R, top + bandH)
    ctx.stroke()
    ctx.restore()
    if (R >= 6) {
      // Knot tails flying off the back of the head
      const side = yaw >= 0 ? -1 : 1
      const y0 = top + bandH / 2
      paintGroup(ctx, [
        {
          build: (c) => {
            c.moveTo(side * 0.92 * R, y0 - 0.08 * R)
            c.lineTo(side * 1.36 * R, y0 - 0.3 * R)
            c.lineTo(side * 1.28 * R, y0 + 0.02 * R)
            c.closePath()
            c.moveTo(side * 0.92 * R, y0 + 0.06 * R)
            c.lineTo(side * 1.3 * R, y0 + 0.36 * R)
            c.lineTo(side * 1.12 * R, y0 + 0.44 * R)
            c.closePath()
          },
          fill: style.accessoryColor,
        },
      ], style.outline, Math.max(0.5, outlineW * 0.7))
    }
  }

  // Face: eyes + smile (+ cheeks / highlights when there's room)
  if (R >= 3.5) {
    const fx = yaw * 0.42 * R
    const eyeY = 0.1 * R
    const spread = 0.34 * R * (1 - 0.3 * Math.abs(yaw))
    const erx = Math.max(0.7, 0.1 * R)
    const ery = Math.max(0.9, 0.14 * R)
    if (R >= 7) {
      ctx.fillStyle = style.cheeks
      ctx.beginPath()
      addEllipse(ctx, fx - spread - 0.06 * R, eyeY + 0.24 * R, 0.12 * R, 0.075 * R, 0)
      addEllipse(ctx, fx + spread + 0.06 * R, eyeY + 0.24 * R, 0.12 * R, 0.075 * R, 0)
      ctx.fill()
    }
    ctx.fillStyle = style.eyes
    ctx.beginPath()
    addEllipse(ctx, fx - spread, eyeY, erx, ery, 0)
    addEllipse(ctx, fx + spread, eyeY, erx, ery, 0)
    ctx.fill()
    if (R >= 9) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.beginPath()
      addCircle(ctx, fx - spread - erx * 0.3, eyeY - ery * 0.4, erx * 0.42)
      addCircle(ctx, fx + spread - erx * 0.3, eyeY - ery * 0.4, erx * 0.42)
      ctx.fill()
    }
    if (R >= 5) {
      ctx.strokeStyle = style.eyes
      ctx.lineWidth = Math.max(0.9, 0.075 * R)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(fx * 1.1, eyeY + 0.12 * R, 0.18 * R, Math.PI * 0.18, Math.PI * 0.82)
      ctx.stroke()
    }
  }

  if (style.accessory === 'headphones') {
    const shift = -yaw * 0.2 * R
    const bandW = Math.max(1.5, 0.18 * R)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(shift, 0, R * 1.06, Math.PI + 0.32, Math.PI * 2 - 0.32)
    ctx.strokeStyle = style.outline
    ctx.lineWidth = bandW + outlineW * 2
    ctx.stroke()
    ctx.strokeStyle = style.accessoryColor
    ctx.lineWidth = bandW
    ctx.stroke()
    const cupRx = Math.max(1.2, 0.22 * R)
    const cupRy = Math.max(1.8, 0.33 * R)
    paintGroup(ctx, [
      { build: (c) => addEllipse(c, shift - R, 0.06 * R, cupRx, cupRy, 0), fill: style.accessoryColor },
      { build: (c) => addEllipse(c, shift + R, 0.06 * R, cupRx, cupRy, 0), fill: style.accessoryColor },
    ], style.outline, outlineW)
    if (R >= 6) {
      ctx.fillStyle = style.accessoryAlt
      ctx.beginPath()
      addEllipse(ctx, shift - R, 0.06 * R, cupRx * 0.5, cupRy * 0.6, 0)
      addEllipse(ctx, shift + R, 0.06 * R, cupRx * 0.5, cupRy * 0.6, 0)
      ctx.fill()
    }
  }

  if (style.accessory === 'crown') {
    const tilt = 0.12
    ctx.save()
    ctx.translate(0.1 * R, 0)
    ctx.rotate(tilt)
    const pts: [number, number][] = [
      [-0.5, -0.78], [-0.56, -1.38], [-0.27, -1.1], [0, -1.48],
      [0.27, -1.1], [0.56, -1.38], [0.5, -0.78],
    ]
    paintGroup(ctx, [{
      build: (c) => {
        pts.forEach(([x, y], k) => (k === 0 ? c.moveTo(x * R, y * R) : c.lineTo(x * R, y * R)))
        c.closePath()
      },
      fill: style.accessoryColor,
    }], style.outline, outlineW)
    if (R >= 7) {
      ctx.fillStyle = style.accessoryAlt
      ctx.beginPath()
      addCircle(ctx, 0, -0.92 * R, 0.09 * R)
      addCircle(ctx, -0.56 * R, -1.38 * R, 0.07 * R)
      addCircle(ctx, 0, -1.48 * R, 0.07 * R)
      addCircle(ctx, 0.56 * R, -1.38 * R, 0.07 * R)
      ctx.fill()
    }
    ctx.restore()
  }

  ctx.restore()
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  w: number,
  h: number,
  character: CharacterId,
  frame: PoseFrame | undefined,
) {
  const kps = pose.keypoints
  if (!kps || kps.length < 17) return
  const style = CHARACTER_STYLES[character]

  const conf = (i: number) => kps[i]?.score ?? 0
  const ok = (i: number) => conf(i) >= MIN_CONF && Number.isFinite(kps[i].x) && Number.isFinite(kps[i].y)

  let visibleCount = 0
  for (const i of BODY_INDICES) if (ok(i)) visibleCount++
  if (visibleCount < 4) return

  const b = frame ?? characterBounds(pose, character)
  if (!b) return

  const rangeX = b.maxX - b.minX || 0.1
  const rangeY = b.maxY - b.minY || 0.1
  const pad = Math.max(2, Math.min(w, h) * 0.025)
  const drawW = w - pad * 2
  const drawH = h - pad * 2
  const scale = Math.min(drawW / rangeX, drawH / rangeY)
  if (!(scale > 0) || !Number.isFinite(scale)) return
  const offsetX = pad + (drawW - rangeX * scale) / 2
  const offsetY = pad + (drawH - rangeY * scale) / 2

  const X = (i: number) => offsetX + (kps[i].x - b.minX) * scale
  const Y = (i: number) => offsetY + (kps[i].y - b.minY) * scale

  // Body unit (torso length) in canvas px drives every width.
  const unitPose = b.bodyScale ?? bodyScaleOf(kps) ?? 0.3 * Math.max(rangeX, rangeY)
  const U = Math.min(Math.max(unitPose * scale, Math.min(w, h) * 0.05), Math.min(w, h) * 0.5)

  const outline = style.outline
  const outlineW = Math.max(0.75, U * 0.035)
  const thighW = Math.max(3, U * P.thigh)
  const calfW1 = Math.max(2.5, U * P.calfTop)
  const calfW2 = Math.max(2, U * P.calfBottom)
  const upperArmW = Math.max(2.5, U * P.upperArm)
  const forearmW1 = Math.max(2, U * P.forearmTop)
  const forearmW2 = Math.max(1.6, U * P.forearmBottom)
  const neckW = Math.max(2, U * P.neck)
  const handR = Math.max(1.6, U * P.hand)
  const shoeW = Math.max(2.4, U * P.shoe)

  const seg = (shapes: Shape[], a: number, bIdx: number, wa: number, wb: number, fill: string) => {
    if (!ok(a) || !ok(bIdx)) return
    const x1 = X(a), y1 = Y(a), x2 = X(bIdx), y2 = Y(bIdx)
    shapes.push({ build: (c) => addCapsule(c, x1, y1, wa, x2, y2, wb), fill })
  }

  const shoulders = ok(KP.leftShoulder) && ok(KP.rightShoulder)
  const hips = ok(KP.leftHip) && ok(KP.rightHip)
  const smx = shoulders ? (X(KP.leftShoulder) + X(KP.rightShoulder)) / 2 : 0
  const smy = shoulders ? (Y(KP.leftShoulder) + Y(KP.rightShoulder)) / 2 : 0
  const hmx = hips ? (X(KP.leftHip) + X(KP.rightHip)) / 2 : 0
  const hmy = hips ? (Y(KP.leftHip) + Y(KP.rightHip)) / 2 : 0

  // Torso axis (shoulders -> hips) and its perpendicular.
  let axX = 0, axY = 1
  if (shoulders && hips) {
    const len = Math.hypot(hmx - smx, hmy - smy)
    if (len > 1e-6) {
      axX = (hmx - smx) / len
      axY = (hmy - smy) / len
    }
  }
  const perpX = -axY
  const perpY = axX

  ctx.save()

  // === 1. LEGS (pelvis + thighs + calves as one seamless pants piece) ===
  const legs: Shape[] = []
  if (hips) {
    const lx = X(KP.leftHip), ly = Y(KP.leftHip), rx = X(KP.rightHip), ry = Y(KP.rightHip)
    legs.push({ build: (c) => addCapsule(c, lx, ly, thighW * 1.05, rx, ry, thighW * 1.05), fill: style.pants })
  }
  seg(legs, KP.leftHip, KP.leftKnee, thighW, calfW1, style.pants)
  seg(legs, KP.leftKnee, KP.leftAnkle, calfW1, calfW2, style.pants)
  seg(legs, KP.rightHip, KP.rightKnee, thighW, calfW1, style.pants)
  seg(legs, KP.rightKnee, KP.rightAnkle, calfW1, calfW2, style.pants)
  paintGroup(ctx, legs, outline, outlineW)

  // === 2. SHOES (heel/ankle -> toe when the foot is tracked) ===
  for (const [ankle, heel, toe] of [
    [KP.leftAnkle, KP.leftHeel, KP.leftFootIndex],
    [KP.rightAnkle, KP.rightHeel, KP.rightFootIndex],
  ] as const) {
    if (!ok(ankle)) continue
    const ax = X(ankle), ay = Y(ankle)
    if (ok(toe)) {
      const sx = ok(heel) ? X(heel) : ax
      const sy = ok(heel) ? Y(heel) : ay
      let tx = X(toe), ty = Y(toe)
      const len = Math.hypot(tx - sx, ty - sy)
      if (len < shoeW * 0.6) {
        // Foot pointing at the camera: give the shoe a minimum visible length.
        tx = sx + (len > 1e-6 ? (tx - sx) / len : 0) * shoeW * 0.6
        ty = sy + (len > 1e-6 ? (ty - sy) / len : 1) * shoeW * 0.6
      }
      paintGroup(ctx, [
        { build: (c) => addCapsule(c, ax, ay, shoeW * 0.9, sx, sy, shoeW), fill: style.shoes },
        { build: (c) => addCapsule(c, sx, sy, shoeW, tx, ty, shoeW * 0.92), fill: style.shoes },
      ], outline, outlineW)
    } else {
      paintGroup(ctx, [
        { build: (c) => addEllipse(c, ax, ay + shoeW * 0.25, shoeW * 0.75, shoeW * 0.55, 0), fill: style.shoes },
      ], outline, outlineW)
    }
  }

  // === 3. TORSO (rounded hoodie/shirt) ===
  if (shoulders && hips) {
    const [l1x, l1y, r1x, r1y] = widen(
      X(KP.leftShoulder), Y(KP.leftShoulder), X(KP.rightShoulder), Y(KP.rightShoulder),
      0.26 * U, 0.06 * U, perpX, perpY,
    )
    const hemDrop = 0.07 * U
    const [l2x, l2y, r2x, r2y] = widen(
      X(KP.leftHip) + axX * hemDrop, Y(KP.leftHip) + axY * hemDrop,
      X(KP.rightHip) + axX * hemDrop, Y(KP.rightHip) + axY * hemDrop,
      0.2 * U, 0.12 * U, perpX, perpY,
    )
    // Keep the polygon simple (no bow-tie) if the hips' order flipped.
    const sameOrder = (r1x - l1x) * (r2x - l2x) + (r1y - l1y) * (r2y - l2y) >= 0
    const quad: [number, number][] = sameOrder
      ? [[l1x, l1y], [r1x, r1y], [r2x, r2y], [l2x, l2y]]
      : [[l1x, l1y], [r1x, r1y], [l2x, l2y], [r2x, r2y]]
    const torsoPath = (c: CanvasRenderingContext2D) => {
      quad.forEach(([x, y], k) => (k === 0 ? c.moveTo(x, y) : c.lineTo(x, y)))
      c.closePath()
    }
    const round = 0.05 * U
    ctx.lineJoin = 'round'
    ctx.beginPath()
    torsoPath(ctx)
    ctx.strokeStyle = outline
    ctx.lineWidth = round * 2 + outlineW * 2
    ctx.stroke()
    ctx.fillStyle = style.torso
    ctx.strokeStyle = style.torso
    ctx.lineWidth = round * 2
    ctx.fill()
    ctx.stroke()

    // Torso detail, clipped to the shirt
    if (style.torsoDetail !== 'none' && U >= 14) {
      const L = Math.hypot(hmx - smx, hmy - smy)
      const at = (down: number, side: number): [number, number] => [
        smx + axX * down + perpX * side,
        smy + axY * down + perpY * side,
      ]
      ctx.save()
      ctx.beginPath()
      torsoPath(ctx)
      ctx.clip()
      ctx.fillStyle = style.torsoDetailColor
      ctx.strokeStyle = outline
      ctx.lineWidth = Math.max(0.75, outlineW * 0.7)
      if (style.torsoDetail === 'pocket') {
        const pts = [at(L * 0.62, -0.2 * U), at(L * 0.62, 0.2 * U), at(L * 1.0, 0.27 * U), at(L * 1.0, -0.27 * U)]
        ctx.beginPath()
        pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Drawstrings
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = Math.max(1, 0.035 * U)
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (const side of [-0.08, 0.08]) {
          const [x0, y0] = at(L * 0.05, side * U)
          const [x1, y1] = at(L * 0.3, side * 1.15 * U)
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
        }
        ctx.stroke()
      } else if (style.torsoDetail === 'star') {
        const [cx, cy] = at(L * 0.4, 0)
        ctx.beginPath()
        starPath(ctx, cx, cy, 0.17 * U, Math.atan2(axY, axX) - Math.PI / 2)
        ctx.fill()
        ctx.stroke()
      } else if (style.torsoDetail === 'stripe') {
        const band = 0.17 * U
        const [x0, y0] = at(L * 0.42, -U)
        const [x1, y1] = at(L * 0.42, U)
        ctx.lineCap = 'butt'
        ctx.strokeStyle = style.torsoDetailColor
        ctx.lineWidth = band
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  // === 4. NECK + HEAD ===
  const head = headGeometry(kps, U / scale)
  if (head) {
    const hx = offsetX + (head.cx - b.minX) * scale
    const hy = offsetY + (head.cy - b.minY) * scale
    const R = head.r * scale
    const neck: Shape[] = []
    if (shoulders) {
      neck.push({ build: (c) => addCapsule(c, smx, smy, neckW, hx, hy, neckW), fill: style.skin })
    }
    paintGroup(ctx, neck, outline, outlineW)
    if (shoulders && style.accessory === 'headphones') {
      // Hoodie hood/collar bunched behind the neck
      const angle = Math.atan2(Y(KP.rightShoulder) - Y(KP.leftShoulder), X(KP.rightShoulder) - X(KP.leftShoulder))
      paintGroup(ctx, [
        { build: (c) => addEllipse(c, smx - axX * 0.02 * U, smy - axY * 0.02 * U, 0.3 * U, 0.11 * U, angle), fill: style.sleeves },
      ], outline, outlineW)
    }
    drawHead(ctx, style, hx, hy, R, head, outlineW)
  }

  // === 5. ARMS (sleeve over skin forearm) + HANDS, each arm one piece ===
  for (const [shoulder, elbow, wrist, index] of [
    [KP.leftShoulder, KP.leftElbow, KP.leftWrist, KP.leftIndex],
    [KP.rightShoulder, KP.rightElbow, KP.rightWrist, KP.rightIndex],
  ] as const) {
    const skin: Shape[] = []
    const sleeve: Shape[] = []
    seg(skin, elbow, wrist, forearmW1, forearmW2, style.skin)
    if (ok(wrist)) {
      let cx = X(wrist), cy = Y(wrist)
      if (ok(index)) {
        cx += (X(index) - cx) * 0.35
        cy += (Y(index) - cy) * 0.35
      }
      skin.push({ build: (c) => addCircle(c, cx, cy, handR), fill: style.skin })
    }
    seg(sleeve, shoulder, elbow, upperArmW, Math.max(forearmW1 * 1.08, upperArmW * 0.92), style.sleeves)
    paintGroup(ctx, [...skin, ...sleeve], outline, outlineW)
  }

  ctx.restore()
}

function devicePixelRatioCapped(): number {
  if (typeof window === 'undefined') return 1
  const dpr = window.devicePixelRatio || 1
  return Math.min(2, Math.max(1, dpr))
}

/**
 * Draws a human figure from MediaPipe keypoints on a square canvas.
 *
 * - character 'mannequin' (default): Groovy's original tapered-capsule
 *   mannequin, fitted to the pose's bounding box.
 * - 'buddy' / 'host' / 'challenger': chibi cartoon characters (bigger head
 *   with a face that turns with the head, clothes, shoes, accessory).
 *
 * Pure function of its props: redraws whenever pose/size/character/frame change.
 */
export function TargetPoseFigure({
  pose,
  size = 120,
  className,
  character = 'mannequin',
  glow,
  frame,
}: TargetPoseFigureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Cartoon characters render at device resolution so details stay crisp;
  // the mannequin keeps its original 1:1 canvas.
  const dpr = character === 'mannequin' ? 1 : devicePixelRatioCapped()
  const pixels = Math.max(1, Math.round(size * dpr))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pose) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    if (character === 'mannequin' || !CHARACTER_STYLES[character]) {
      const kps = pose.keypoints
      if (!kps || kps.length < 17) return
      drawMannequin(ctx, kps, w, h, frame)
      return
    }

    const scale = w / size
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawCharacter(ctx, pose, size, size, character, frame)
  }, [pose, size, character, frame, pixels])

  if (!pose) return null

  const style = glow
    ? { width: size, height: size, filter: glowFilter(glow, size) }
    : { width: size, height: size }

  // Square canvas — works for both wide and tall poses
  return (
    <canvas
      ref={canvasRef}
      width={pixels}
      height={pixels}
      className={className}
      style={style}
    />
  )
}

function glowFilter(color: string, size: number): string {
  const r = Math.max(2, Math.round(size * 0.03))
  return `drop-shadow(0 0 ${r}px ${color}) drop-shadow(0 0 ${r * 2}px ${color})`
}
