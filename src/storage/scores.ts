export type Difficulty = 'easy' | 'normal' | 'hard'

export interface ScoreEntry {
  danceId: string
  danceName: string
  score: number
  rank: 'S' | 'A' | 'B' | 'C'
  date: string // ISO string
  difficulty?: Difficulty
}

/** Difficulty presets — controls timing windows, score thresholds, and focus weighting */
export interface DifficultyConfig {
  /** Timing: seconds before hit time that scoring window opens */
  windowBefore: number
  /** Timing: seconds after hit time before it counts as a miss */
  windowAfter: number
  /** Score threshold for "Perfect" feedback */
  perfectThreshold: number
  /** Score threshold for "Good" feedback */
  goodThreshold: number
  /** How early the target pose cue appears (seconds) */
  leadTime: number
  /** Focus joint weight multiplier */
  focusWeight: number
  /** Non-focus joint weight multiplier */
  nonFocusWeight: number
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    windowBefore: 0.6,
    windowAfter: 0.7,
    perfectThreshold: 0.70,
    goodThreshold: 0.45,
    leadTime: 3.0,
    focusWeight: 2.0,
    nonFocusWeight: 1.0,
  },
  normal: {
    windowBefore: 0.4,
    windowAfter: 0.5,
    perfectThreshold: 0.80,
    goodThreshold: 0.55,
    leadTime: 2.5,
    focusWeight: 3.0,
    nonFocusWeight: 0.5,
  },
  hard: {
    windowBefore: 0.25,
    windowAfter: 0.3,
    perfectThreshold: 0.90,
    goodThreshold: 0.70,
    leadTime: 2.0,
    focusWeight: 5.0,
    nonFocusWeight: 0.3,
  },
}

const HISTORY_KEY = 'groovy_score_history'
const BEST_PREFIX = 'groovy_best_'

export function getScoreHistory(): ScoreEntry[] {
  const stored = localStorage.getItem(HISTORY_KEY)
  return stored ? JSON.parse(stored) : []
}

export function saveScore(entry: ScoreEntry): void {
  const history = getScoreHistory()
  history.unshift(entry) // newest first
  // Keep last 100 entries
  if (history.length > 100) {
    history.length = 100
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))

  // Update personal best
  const bestKey = `${BEST_PREFIX}${entry.danceId}`
  const currentBest = getPersonalBest(entry.danceId)
  if (currentBest === null || entry.score > currentBest) {
    localStorage.setItem(bestKey, JSON.stringify(entry.score))
  }
}

export function getPersonalBest(danceId: string): number | null {
  const stored = localStorage.getItem(`${BEST_PREFIX}${danceId}`)
  return stored ? JSON.parse(stored) : null
}

export function getDanceHistory(danceId: string): ScoreEntry[] {
  return getScoreHistory().filter((e) => e.danceId === danceId)
}

export function removeScore(index: number): void {
  const history = getScoreHistory()
  if (index >= 0 && index < history.length) {
    history.splice(index, 1)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  }
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}
