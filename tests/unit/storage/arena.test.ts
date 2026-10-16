import { describe, it, expect, beforeEach } from 'vitest'
import {
  toAttemptSummary,
  getCurrentPlayer,
  setCurrentPlayer,
  recordArenaAttempt,
  getArenaEntries,
  getPreviousAttempt,
  getLeaderboard,
  getHostForDance,
  isHostAttemptFor,
  normalizePlayerName,
  resolvePlayerName,
  isSamePlayer,
  clearArena,
  ARENA_ENTRIES_KEY,
  CURRENT_PLAYER_KEY,
  MAX_ARENA_ENTRIES,
  GUEST_NAME,
} from '../../../src/storage/arena'
import type { ArenaEntryInput } from '../../../src/storage/arena'
import type { DTWResult } from '../../../src/scoring/dtw'
import type { AttemptSummary } from '../../../src/coach/types'

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

function makeAttempt(overallScore: number): AttemptSummary {
  return {
    overallScore,
    rank: overallScore >= 0.75 ? 'S' : overallScore >= 0.55 ? 'A' : overallScore >= 0.35 ? 'B' : 'C',
    sectionScores: [{ startTime: 0, endTime: 10, score: overallScore }],
    bodyPartScores: [{ name: 'Arms', score: overallScore }, { name: 'Legs', score: overallScore }],
  }
}

// Monotonic fake clock so each entry gets a distinct, increasing date
let clock = 0
function makeEntry(overrides?: Partial<ArenaEntryInput>): ArenaEntryInput {
  clock += 1
  const score = overrides?.score ?? 0.6
  return {
    danceId: 'dance-a',
    player: 'Alice',
    score,
    rank: 'A',
    date: new Date(Date.UTC(2026, 9, 15, 12, 0, clock)).toISOString(),
    isHost: false,
    attempt: makeAttempt(score),
    ...overrides,
  }
}

describe('arena storage', () => {
  beforeEach(() => {
    localStorageMock.clear()
    clock = 0
  })

  describe('toAttemptSummary', () => {
    it('copies scores and strips the alignment array', () => {
      const result: DTWResult = {
        overallScore: 0.63,
        rank: 'A',
        sectionScores: [{ startTime: 0, endTime: 10, score: 0.82 }],
        bodyPartScores: [{ name: 'Arms', score: 0.58 }],
        alignment: [[0, 0], [1, 1]],
      }
      const summary = toAttemptSummary(result)
      expect(summary).toEqual({
        overallScore: 0.63,
        rank: 'A',
        sectionScores: [{ startTime: 0, endTime: 10, score: 0.82 }],
        bodyPartScores: [{ name: 'Arms', score: 0.58 }],
      })
      expect('alignment' in summary).toBe(false)
      expect(summary.sectionScores).not.toBe(result.sectionScores)
    })
  })

  describe('player names', () => {
    it('trims, collapses whitespace and caps at 24 chars', () => {
      expect(normalizePlayerName('  Wasil   K  ')).toBe('Wasil K')
      expect(normalizePlayerName('x'.repeat(40))).toHaveLength(24)
      expect(normalizePlayerName(42)).toBe('')
    })

    it('falls back to Guest for empty names', () => {
      expect(resolvePlayerName('   ')).toBe(GUEST_NAME)
      expect(resolvePlayerName('Maya')).toBe('Maya')
    })

    it('matches case-insensitively', () => {
      expect(isSamePlayer('wasil', ' WASIL ')).toBe(true)
      expect(isSamePlayer('wasil', 'maya')).toBe(false)
      expect(isSamePlayer('', '')).toBe(false)
      expect(isSamePlayer(null, 'x')).toBe(false)
    })
  })

  describe('current player', () => {
    it('returns null when nothing is stored', () => {
      expect(getCurrentPlayer()).toBeNull()
    })

    it('saves, normalizes and clears the current player', () => {
      setCurrentPlayer({ name: '  Wasil  ', isHost: true })
      expect(getCurrentPlayer()).toEqual({ name: 'Wasil', isHost: true })
      expect(store[CURRENT_PLAYER_KEY]).toBeDefined()

      setCurrentPlayer(null)
      expect(getCurrentPlayer()).toBeNull()
      expect(store[CURRENT_PLAYER_KEY]).toBeUndefined()
    })

    it('stores Guest for an empty name', () => {
      setCurrentPlayer({ name: '   ', isHost: false })
      expect(getCurrentPlayer()).toEqual({ name: GUEST_NAME, isHost: false })
    })

    it('is robust to corrupt JSON', () => {
      store[CURRENT_PLAYER_KEY] = '{not json'
      expect(getCurrentPlayer()).toBeNull()
      store[CURRENT_PLAYER_KEY] = JSON.stringify({ name: 7 })
      expect(getCurrentPlayer()).toBeNull()
      store[CURRENT_PLAYER_KEY] = JSON.stringify({ name: 'Leo', isHost: 'yes' })
      expect(getCurrentPlayer()).toEqual({ name: 'Leo', isHost: false })
    })
  })

  describe('recordArenaAttempt', () => {
    it('stores entries newest first with normalized names and clamped scores', () => {
      recordArenaAttempt(makeEntry({ player: ' Alice ', score: 0.5 }))
      recordArenaAttempt(makeEntry({ player: '', score: 1.7 }))
      const entries = getArenaEntries()
      expect(entries).toHaveLength(2)
      expect(entries[0].player).toBe(GUEST_NAME)
      expect(entries[0].score).toBe(1)
      expect(entries[1].player).toBe('Alice')
    })

    it('fills in the date when omitted', () => {
      const entry = makeEntry()
      delete entry.date
      const stored = recordArenaAttempt(entry)
      expect(Number.isNaN(Date.parse(stored.date))).toBe(false)
    })

    it('caps the log at MAX_ARENA_ENTRIES entries', () => {
      for (let i = 0; i < MAX_ARENA_ENTRIES + 15; i++) {
        recordArenaAttempt(makeEntry({ player: 'P' + i }))
      }
      const entries = getArenaEntries()
      expect(entries).toHaveLength(MAX_ARENA_ENTRIES)
      expect(entries[0].player).toBe('P' + (MAX_ARENA_ENTRIES + 14))
    })

    it('recovers from corrupt stored JSON', () => {
      store[ARENA_ENTRIES_KEY] = 'garbage['
      expect(getArenaEntries()).toEqual([])
      recordArenaAttempt(makeEntry())
      expect(getArenaEntries()).toHaveLength(1)
    })

    it('drops malformed entries but keeps valid ones', () => {
      const valid = { ...makeEntry(), date: '2026-10-15T00:00:00Z' }
      store[ARENA_ENTRIES_KEY] = JSON.stringify([valid, { danceId: 'x' }, null, 5])
      expect(getArenaEntries()).toEqual([valid])
      store[ARENA_ENTRIES_KEY] = JSON.stringify({ not: 'an array' })
      expect(getArenaEntries()).toEqual([])
    })

    it('clearArena wipes attempts', () => {
      recordArenaAttempt(makeEntry())
      clearArena()
      expect(getArenaEntries()).toEqual([])
    })
  })

  describe('getPreviousAttempt', () => {
    it('returns null when the player has no attempt on this dance', () => {
      recordArenaAttempt(makeEntry({ danceId: 'other' }))
      recordArenaAttempt(makeEntry({ player: 'Bob' }))
      expect(getPreviousAttempt('dance-a', 'Alice')).toBeNull()
    })

    it('returns the most recently recorded attempt (case-insensitive)', () => {
      recordArenaAttempt(makeEntry({ score: 0.4 }))
      recordArenaAttempt(makeEntry({ score: 0.7 }))
      recordArenaAttempt(makeEntry({ player: 'Bob', score: 0.9 }))
      const prev = getPreviousAttempt('dance-a', '  alice ')
      expect(prev?.overallScore).toBe(0.7)
    })

    it('treats an empty name as Guest', () => {
      recordArenaAttempt(makeEntry({ player: '', score: 0.33 }))
      expect(getPreviousAttempt('dance-a', '')?.overallScore).toBe(0.33)
      expect(getPreviousAttempt('dance-a', 'guest')?.overallScore).toBe(0.33)
    })
  })

  describe('getLeaderboard', () => {
    it('is empty for an unknown dance', () => {
      expect(getLeaderboard('nope')).toEqual([])
    })

    it('keeps the best score per player, sorted descending', () => {
      recordArenaAttempt(makeEntry({ player: 'Alice', score: 0.5 }))
      recordArenaAttempt(makeEntry({ player: 'alice', score: 0.8 }))
      recordArenaAttempt(makeEntry({ player: 'Bob', score: 0.6 }))
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.7, isHost: true }))
      recordArenaAttempt(makeEntry({ player: 'Zed', score: 0.99, danceId: 'dance-b' }))
      expect(getLeaderboard('dance-a')).toEqual([
        { name: 'alice', score: 0.8, isHost: false },
        { name: 'Wasil', score: 0.7, isHost: true },
        { name: 'Bob', score: 0.6, isHost: false },
      ])
    })

    it('marks a player as host if any of their attempts on the dance was a host attempt', () => {
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.7, isHost: true }))
      recordArenaAttempt(makeEntry({ player: 'wasil', score: 0.9, isHost: false }))
      expect(getLeaderboard('dance-a')).toEqual([{ name: 'wasil', score: 0.9, isHost: true }])
    })

    it('respects the limit and breaks ties by earliest attempt', () => {
      recordArenaAttempt(makeEntry({ player: 'First', score: 0.5 }))
      recordArenaAttempt(makeEntry({ player: 'Second', score: 0.5 }))
      for (let i = 0; i < 12; i++) recordArenaAttempt(makeEntry({ player: 'Low' + i, score: 0.1 }))
      const top = getLeaderboard('dance-a', 2)
      expect(top.map((e) => e.name)).toEqual(['First', 'Second'])
      expect(getLeaderboard('dance-a')).toHaveLength(10)
      expect(getLeaderboard('dance-a', 0)).toEqual([])
    })
  })

  describe('getHostForDance', () => {
    it('returns null when no host has danced', () => {
      recordArenaAttempt(makeEntry({ player: 'Bob', score: 0.95 }))
      expect(getHostForDance('dance-a')).toBeNull()
    })

    it('returns the best host score on that dance', () => {
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.62, isHost: true }))
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.78, isHost: true }))
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.7, isHost: true }))
      recordArenaAttempt(makeEntry({ player: 'Bob', score: 0.95 }))
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.99, isHost: true, danceId: 'dance-b' }))
      expect(getHostForDance('dance-a')).toEqual({ name: 'Wasil', score: 0.78 })
      expect(getHostForDance('dance-b')).toEqual({ name: 'Wasil', score: 0.99 })
    })
  })

  describe('isHostAttemptFor', () => {
    it('is true when the player ticked "I am the host"', () => {
      expect(isHostAttemptFor('dance-a', { name: 'Wasil', isHost: true })).toBe(true)
    })

    it('is false for a challenger, or when no host has danced yet', () => {
      expect(isHostAttemptFor('dance-a', { name: 'Wasil', isHost: false })).toBe(false)
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.78, isHost: true }))
      expect(isHostAttemptFor('dance-a', { name: 'Maya', isHost: false })).toBe(false)
    })

    it('treats the existing host (case-insensitive) as a host run even without the checkbox', () => {
      recordArenaAttempt(makeEntry({ player: 'Wasil', score: 0.78, isHost: true }))
      expect(isHostAttemptFor('dance-a', { name: '  wasil ', isHost: false })).toBe(true)
      // host of another dance only
      expect(isHostAttemptFor('dance-b', { name: 'Wasil', isHost: false })).toBe(false)
    })
  })
})
