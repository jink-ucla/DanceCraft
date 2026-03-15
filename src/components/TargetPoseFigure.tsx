import { useRef, useEffect } from 'react'
import type { Pose } from '../scoring/types'

interface TargetPoseFigureProps {
  pose: Pose | null
  size?: number
  className?: string
}

// MediaPipe BlazePose 33-landmark indices (body only, skip face detail)
const KP = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
} as const

const BODY_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
const MIN_CONF = 0.15

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
 * Draws a mannequin-style human figure from MoveNet keypoints.
 * Each body segment is a tapered capsule with dark outlines.
 * Uses a square canvas to handle both wide and tall poses.
 */
export function TargetPoseFigure({ pose, size = 120, className }: TargetPoseFigureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pose) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const kps = pose.keypoints
    if (!kps || kps.length < 17) return

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
  }, [pose, size])

  if (!pose) return null

  // Square canvas — works for both wide and tall poses
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
