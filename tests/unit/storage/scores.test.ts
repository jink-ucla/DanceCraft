import { describe, it, expect, beforeEach } from 'vitest'
import {
  getScoreHistory,
  saveScore,
  getPersonalBest,
  getDanceHistory,
  clearHistory,
} from '../../../src/storage/scores'
import type { ScoreEntry } from '../../../src/storage/scores'

// Simple localStorage mock for Node test environment
const store: Record<string, string> = {}

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

function makeEntry(overrides?: Partial<ScoreEntry>): ScoreEntry {
  return {
    danceId: 'test-dance',
    danceName: 'Test Dance',
    score: 75,
    rank: 'A',
    date: '2026-03-14T12:00:00Z',
    ...overrides,
  }
}

describe('score storage', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('returns empty history when nothing stored', () => {
    expect(getScoreHistory()).toEqual([])
  })

  it('saves and retrieves a score entry', () => {
    const entry = makeEntry()
    saveScore(entry)
    const history = getScoreHistory()
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual(entry)
  })

  it('newest entries appear first', () => {
    saveScore(makeEntry({ score: 50, date: '2026-03-14T10:00:00Z' }))
    saveScore(makeEntry({ score: 80, date: '2026-03-14T11:00:00Z' }))
    const history = getScoreHistory()
    expect(history[0].score).toBe(80)
    expect(history[1].score).toBe(50)
  })

  it('updates personal best when new score is higher', () => {
    saveScore(makeEntry({ score: 60 }))
    expect(getPersonalBest('test-dance')).toBe(60)

    saveScore(makeEntry({ score: 85 }))
    expect(getPersonalBest('test-dance')).toBe(85)
  })

  it('does not downgrade personal best', () => {
    saveScore(makeEntry({ score: 90 }))
    saveScore(makeEntry({ score: 50 }))
    expect(getPersonalBest('test-dance')).toBe(90)
  })

  it('returns null for unknown dance personal best', () => {
    expect(getPersonalBest('unknown')).toBeNull()
  })

  it('filters history by dance ID', () => {
    saveScore(makeEntry({ danceId: 'dance-a', score: 70 }))
    saveScore(makeEntry({ danceId: 'dance-b', score: 80 }))
    saveScore(makeEntry({ danceId: 'dance-a', score: 90 }))

    const danceA = getDanceHistory('dance-a')
    expect(danceA).toHaveLength(2)
    expect(danceA.every((e) => e.danceId === 'dance-a')).toBe(true)
  })

  it('clears history', () => {
    saveScore(makeEntry())
    clearHistory()
    expect(getScoreHistory()).toEqual([])
  })

  it('limits history to 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      saveScore(makeEntry({ score: i, date: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
    }
    const history = getScoreHistory()
    expect(history).toHaveLength(100)
  })
})
