import type { Pose } from './types'
import { comparePoses } from './comparison'

export interface TimestampedPose {
  /** Reference/music sample time. Legacy recordings without videoTime used recorder elapsed time. */
  time: number
  pose: Pose
  /** Recorded frame time, in seconds. Absent in recordings made before clock mapping. */
  videoTime?: number
}

export interface DTWResult {
  /** Overall alignment score (0-100%) */
  overallScore: number
  /** Per-section scores (each 10s chunk or custom sections) */
  sectionScores: SectionScore[]
  /** Per-body-part scores */
  bodyPartScores: BodyPartScore[]
  /** Rank based on overall score */
  rank: 'S' | 'A' | 'B' | 'C'
  /** Aligned frame pairs [refIdx, userIdx] */
  alignment: [number, number][]
}

export interface SectionScore {
  startTime: number
  endTime: number
  score: number
}

export interface BodyPartScore {
  name: string
  score: number
}

/**
 * Dynamic Time Warping distance between two pose sequences.
 * Uses pose comparison score as the distance metric.
 * Returns the DTW cost matrix and optimal alignment path.
 */
export function computeDTW(
  reference: TimestampedPose[],
  user: TimestampedPose[],
): { cost: number; alignment: [number, number][] } {
  const n = reference.length
  const m = user.length

  if (n === 0 || m === 0) {
    return { cost: 0, alignment: [] }
  }

  // Cost matrix
  const dtw: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(Infinity)
  )
  dtw[0][0] = 0

  // Fill cost matrix
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const result = comparePoses(reference[i - 1].pose, user[j - 1].pose)
      // Distance = 1 - similarity (lower is better alignment)
      const dist = 1 - result.overallScore

      dtw[i][j] = dist + Math.min(
        dtw[i - 1][j],     // insertion
        dtw[i][j - 1],     // deletion
        dtw[i - 1][j - 1], // match
      )
    }
  }

  // Backtrack to find alignment path
  const alignment: [number, number][] = []
  let i = n
  let j = m

  while (i > 0 && j > 0) {
    alignment.push([i - 1, j - 1])

    const diag = dtw[i - 1][j - 1]
    const left = dtw[i][j - 1]
    const up = dtw[i - 1][j]

    if (diag <= left && diag <= up) {
      i--
      j--
    } else if (up <= left) {
      i--
    } else {
      j--
    }
  }

  alignment.reverse()

  const cost = dtw[n][m]
  return { cost, alignment }
}

/**
 * Compute a similarity score from DTW alignment.
 * Scores each aligned pair and averages.
 */
export function computeAlignmentScore(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  alignment: [number, number][],
): number {
  if (alignment.length === 0) return 0

  let totalScore = 0
  for (const [refIdx, userIdx] of alignment) {
    const result = comparePoses(reference[refIdx].pose, user[userIdx].pose)
    totalScore += result.overallScore
  }

  return totalScore / alignment.length
}

/**
 * Compute per-section scores from DTW alignment.
 * Sections are 10-second chunks by default.
 */
export function computeSectionScores(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  alignment: [number, number][],
  sectionDuration = 10,
): SectionScore[] {
  if (alignment.length === 0 || reference.length === 0) return []

  const totalDuration = reference[reference.length - 1].time
  const numSections = Math.max(1, Math.ceil(totalDuration / sectionDuration))
  const sections: SectionScore[] = []

  for (let s = 0; s < numSections; s++) {
    const startTime = s * sectionDuration
    const endTime = Math.min((s + 1) * sectionDuration, totalDuration)

    // Find aligned pairs in this time range
    const sectionPairs = alignment.filter(([refIdx]) => {
      const t = reference[refIdx].time
      return t >= startTime && t < endTime
    })

    let sectionScore = 0
    if (sectionPairs.length > 0) {
      let total = 0
      for (const [refIdx, userIdx] of sectionPairs) {
        const result = comparePoses(reference[refIdx].pose, user[userIdx].pose)
        total += result.overallScore
      }
      sectionScore = total / sectionPairs.length
    }

    sections.push({ startTime, endTime, score: sectionScore })
  }

  return sections
}

/**
 * Compute per-body-part scores from DTW alignment.
 */
export function computeBodyPartScores(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  alignment: [number, number][],
): BodyPartScore[] {
  if (alignment.length === 0) return []

  // Body part groups based on joint definitions
  const bodyParts: Record<string, string[]> = {
    'Arms': ['left_elbow', 'right_elbow', 'left_shoulder', 'right_shoulder'],
    'Legs': ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  }

  const scores: BodyPartScore[] = []

  for (const [partName, joints] of Object.entries(bodyParts)) {
    let totalScore = 0
    let count = 0

    for (const [refIdx, userIdx] of alignment) {
      const result = comparePoses(reference[refIdx].pose, user[userIdx].pose)
      const partJointScores = result.jointScores.filter((js) =>
        joints.includes(js.name)
      )
      if (partJointScores.length > 0) {
        const avg = partJointScores.reduce((s, js) => s + js.similarity, 0) / partJointScores.length
        totalScore += avg
        count++
      }
    }

    scores.push({
      name: partName,
      score: count > 0 ? totalScore / count : 0,
    })
  }

  return scores
}

/**
 * Determine rank based on score percentage.
 * Game-mode generous thresholds.
 */
export function computeRank(score: number): 'S' | 'A' | 'B' | 'C' {
  const pct = score * 100
  if (pct >= 75) return 'S'
  if (pct >= 55) return 'A'
  if (pct >= 35) return 'B'
  return 'C'
}

/**
 * Full post-dance scoring: DTW alignment + section scores + body part scores + rank.
 */
export function computePostDanceScore(
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration = 10,
): DTWResult {
  // Subsample for performance if sequences are very long
  const maxFrames = 300 // ~10 seconds at 30fps
  const refSampled = subsample(reference, maxFrames)
  const userSampled = subsample(user, maxFrames)

  const { alignment } = computeDTW(refSampled, userSampled)
  const overallScore = computeAlignmentScore(refSampled, userSampled, alignment)
  const sectionScores = computeSectionScores(refSampled, userSampled, alignment, sectionDuration)
  const bodyPartScores = computeBodyPartScores(refSampled, userSampled, alignment)
  const rank = computeRank(overallScore)

  return {
    overallScore,
    sectionScores,
    bodyPartScores,
    rank,
    alignment,
  }
}

/** Subsample a pose sequence to at most maxFrames, evenly spaced. */
function subsample(poses: TimestampedPose[], maxFrames: number): TimestampedPose[] {
  if (poses.length <= maxFrames) return poses

  const step = poses.length / maxFrames
  const result: TimestampedPose[] = []
  for (let i = 0; i < maxFrames; i++) {
    result.push(poses[Math.floor(i * step)])
  }
  return result
}
