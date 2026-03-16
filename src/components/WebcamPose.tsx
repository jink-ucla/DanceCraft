import { useEffect, useRef, useState, useCallback } from 'react'
import { initDetector, estimatePose, disposeDetector } from '../pose/detector'
import {
  SKELETON_CONNECTIONS,
  KEYPOINT_COLOR,
  SKELETON_COLOR,
  KEYPOINT_RADIUS,
} from '../pose/skeleton'
import type { Pose } from '../scoring/types'
import { getWebcamStream } from './Settings'

type WebcamStatus = 'loading' | 'ready' | 'denied' | 'unavailable' | 'error'

export function WebcamPose() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const fpsTimesRef = useRef<number[]>([])

  const [status, setStatus] = useState<WebcamStatus>('loading')
  const [fps, setFps] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  const drawPose = useCallback(
    (ctx: CanvasRenderingContext2D, pose: Pose, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height)

      const keypoints = pose.keypoints

      // Draw skeleton lines
      ctx.strokeStyle = SKELETON_COLOR
      ctx.lineWidth = 2
      for (const [i, j] of SKELETON_CONNECTIONS) {
        const kpA = keypoints[i]
        const kpB = keypoints[j]
        if (kpA && kpB && kpA.score > 0.3 && kpB.score > 0.3) {
          ctx.beginPath()
          ctx.moveTo(kpA.x, kpA.y)
          ctx.lineTo(kpB.x, kpB.y)
          ctx.stroke()
        }
      }

      // Draw keypoints
      ctx.fillStyle = KEYPOINT_COLOR
      for (const kp of keypoints) {
        if (kp.score > 0.3) {
          ctx.beginPath()
          ctx.arc(kp.x, kp.y, KEYPOINT_RADIUS, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
    },
    []
  )

  const detectLoop = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detectLoop)
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pose = await estimatePose(video)

    if (pose) {
      drawPose(ctx, pose, canvas.width, canvas.height)
    }

    // FPS tracking
    const now = performance.now()
    fpsTimesRef.current.push(now)
    // Keep only last second of timestamps
    fpsTimesRef.current = fpsTimesRef.current.filter((t) => now - t < 1000)
    setFps(fpsTimesRef.current.length)

    animFrameRef.current = requestAnimationFrame(detectLoop)
  }, [drawPose])

  useEffect(() => {
    let stream: MediaStream | null = null

    async function start() {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        setErrorMessage('Webcam API is not available in this browser.')
        return
      }

      try {
        stream = await getWebcamStream(640, 480)

        const video = videoRef.current
        if (!video) return

        video.srcObject = stream
        await video.play()

        // Set canvas dimensions to match video
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }

        // Init MoveNet detector
        await initDetector()

        setStatus('ready')

        // Start detection loop
        animFrameRef.current = requestAnimationFrame(detectLoop)
      } catch (err) {
        const error = err as DOMException
        if (
          error.name === 'NotAllowedError' ||
          error.name === 'PermissionDeniedError'
        ) {
          setStatus('denied')
          setErrorMessage(
            'Camera permission was denied. Please allow camera access and reload the page.'
          )
        } else if (
          error.name === 'NotFoundError' ||
          error.name === 'DevicesNotFoundError'
        ) {
          setStatus('unavailable')
          setErrorMessage(
            'No camera found. Please connect a webcam and reload the page.'
          )
        } else {
          setStatus('error')
          setErrorMessage(`Camera error: ${error.message}`)
        }
      }
    }

    start()

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      disposeDetector()
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [detectLoop])

  if (status === 'denied' || status === 'unavailable' || status === 'error') {
    return (
      <div className="webcam-error">
        <p>{errorMessage}</p>
      </div>
    )
  }

  return (
    <div className="webcam-container">
      {status === 'loading' && (
        <div className="webcam-loading">Loading camera and pose model...</div>
      )}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="pose-overlay"
        style={{ transform: 'scaleX(-1)' }}
      />
      <div className="fps-counter">{fps} FPS</div>
    </div>
  )
}
