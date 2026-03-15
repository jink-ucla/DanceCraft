import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision'
import type { Keypoint, Pose } from '../scoring/types'
import { KEYPOINT_NAMES } from '../scoring/types'

let landmarker: PoseLandmarker | null = null
let lastTimestamp = -1

export async function initDetector(): Promise<PoseLandmarker> {
  if (landmarker) return landmarker

  const vision = await FilesetResolver.forVisionTasks(
    // Use CDN for WASM files (avoids bundling large binaries)
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
  )

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      // Full model: great accuracy + fast on GPU (~8ms = 120+ FPS)
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })

  lastTimestamp = -1
  return landmarker
}

export async function estimatePose(
  video: HTMLVideoElement
): Promise<Pose | null> {
  if (!landmarker) return null
  if (video.readyState < 2) return null

  // MediaPipe requires strictly increasing timestamps
  const timestamp = performance.now()
  if (timestamp <= lastTimestamp) return null
  lastTimestamp = timestamp

  const result = landmarker.detectForVideo(video, timestamp)

  if (!result.landmarks || result.landmarks.length === 0) return null

  const landmarks = result.landmarks[0]
  const videoWidth = video.videoWidth || video.clientWidth
  const videoHeight = video.videoHeight || video.clientHeight

  // All 33 MediaPipe landmarks, mapped 1:1 to our keypoint format
  const keypoints: Keypoint[] = landmarks.map((lm, i) => ({
    x: lm.x * videoWidth,
    y: lm.y * videoHeight,
    score: lm.visibility ?? 0,
    name: KEYPOINT_NAMES[i] ?? `landmark_${i}`,
  }))

  return { keypoints }
}

export function disposeDetector(): void {
  if (landmarker) {
    landmarker.close()
    landmarker = null
    lastTimestamp = -1
  }
}

// Re-export for potential direct MediaPipe drawing usage
export { DrawingUtils }
