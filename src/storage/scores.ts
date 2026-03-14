export interface ScoreEntry {
  danceId: string
  danceName: string
  score: number
  rank: 'S' | 'A' | 'B' | 'C'
  date: string // ISO string
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

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}
