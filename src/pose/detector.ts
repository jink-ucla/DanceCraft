import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgl'
import type { Keypoint, Pose } from '../scoring/types'

let detector: poseDetection.PoseDetector | null = null

export async function initDetector(): Promise<poseDetection.PoseDetector> {
  if (detector) return detector

  await tf.setBackend('webgl')
  await tf.ready()

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    }
  )

  return detector
}

export async function estimatePose(
  video: HTMLVideoElement
): Promise<Pose | null> {
  if (!detector) return null

  const poses = await detector.estimatePoses(video, {
    flipHorizontal: false,
  })

  if (poses.length === 0) return null

  const pose = poses[0]
  const keypoints: Keypoint[] = pose.keypoints.map((kp) => ({
    x: kp.x,
    y: kp.y,
    score: kp.score ?? 0,
    name: kp.name ?? '',
  }))

  return { keypoints }
}

export function disposeDetector(): void {
  if (detector) {
    detector.dispose()
    detector = null
  }
}
