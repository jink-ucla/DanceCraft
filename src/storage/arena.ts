/**
 * DanceCraft Arena — local (per-device) player identity, attempt log,
 * host challenge and leaderboards. Everything lives in localStorage under the
 * 'dancecraft_' prefix so a single laptop at a live event can run the arena
 * without the API server.
 *
 * All scores here are 0-1 (same scale as DTWResult.overallScore).
 */
import type { DTWResult } from '../scoring/dtw'
import type { AttemptSummary, Rank } from '../coach/types'

export interface ArenaPlayer {
  name: string
  isHost: boolean
}

export interface ArenaEntry {
  danceId: string
  player: string
  /** 0-1 */
  score: number
  rank: Rank
  /** ISO string */
  date: string
  isHost: boolean
  attempt: AttemptSummary
}

/** recordArenaAttempt() fills in `date` (now) when omitted. */
export type ArenaEntryInput = Omit<ArenaEntry, 'date'> & { date?: string }

export interface LeaderboardEntry {
  name: string
  /** 0-1 */
  score: number
  isHost: boolean
}

export const ARENA_ENTRIES_KEY = 'dancecraft_arena_entries'
export const CURRENT_PLAYER_KEY = 'dancecraft_current_player'
export const MAX_ARENA_ENTRIES = 200
export const MAX_PLAYER_NAME_LENGTH = 24
export const GUEST_NAME = 'Guest'

const RANKS: readonly Rank[] = ['S', 'A', 'B', 'C']

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Trim, collapse inner whitespace, cap at MAX_PLAYER_NAME_LENGTH. May return ''. */
export function normalizePlayerName(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYER_NAME_LENGTH).trim()
}

/** Normalized name, or GUEST_NAME when empty. */
export function resolvePlayerName(name: unknown): string {
  return normalizePlayerName(name) || GUEST_NAME
}

function playerKey(name: unknown): string {
  return normalizePlayerName(name).toLowerCase()
}

/** Case-insensitive player-name comparison (after normalization). */
export function isSamePlayer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  const ka = playerKey(a)
  return ka !== '' && ka === playerKey(b)
}

// ---------------------------------------------------------------------------
// Low-level storage helpers (never throw)
// ---------------------------------------------------------------------------

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded / storage disabled — the arena is best-effort.
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function isRank(v: unknown): v is Rank {
  return typeof v === 'string' && (RANKS as readonly string[]).includes(v)
}

function isAttemptSummary(v: unknown): v is AttemptSummary {
  if (!v || typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  return isFiniteNumber(a.overallScore)
    && isRank(a.rank)
    && Array.isArray(a.sectionScores)
    && Array.isArray(a.bodyPartScores)
}

function isArenaEntry(v: unknown): v is ArenaEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.danceId === 'string'
    && typeof e.player === 'string'
    && normalizePlayerName(e.player) !== ''
    && isFiniteNumber(e.score)
    && isRank(e.rank)
    && typeof e.date === 'string'
    && typeof e.isHost === 'boolean'
    && isAttemptSummary(e.attempt)
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/** The coach-facing slice of a DTWResult (drops the heavy alignment array). */
export function toAttemptSummary(result: DTWResult): AttemptSummary {
  return {
    overallScore: result.overallScore,
    rank: result.rank,
    sectionScores: result.sectionScores.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      score: s.score,
    })),
    bodyPartScores: result.bodyPartScores.map((b) => ({
      name: b.name,
      score: b.score,
    })),
  }
}

/** All recorded attempts, newest first. Invalid/corrupt data is dropped. */
export function getArenaEntries(): ArenaEntry[] {
  const parsed = readJson(ARENA_ENTRIES_KEY)
  return Array.isArray(parsed) ? parsed.filter(isArenaEntry) : []
}

/** Record an attempt (newest first, capped at MAX_ARENA_ENTRIES). Returns the stored entry. */
export function recordArenaAttempt(entry: ArenaEntryInput): ArenaEntry {
  const stored: ArenaEntry = {
    danceId: entry.danceId,
    player: resolvePlayerName(entry.player),
    score: clamp01(entry.score),
    rank: entry.rank,
    date: entry.date ?? new Date().toISOString(),
    isHost: !!entry.isHost,
    attempt: entry.attempt,
  }
  const entries = getArenaEntries()
  entries.unshift(stored)
  if (entries.length > MAX_ARENA_ENTRIES) entries.length = MAX_ARENA_ENTRIES
  writeJson(ARENA_ENTRIES_KEY, entries)
  return stored
}

/**
 * Most recently recorded attempt by `player` on `danceId`, or null.
 * Call BEFORE recording the new attempt to get "attempt 1" for comparison.
 */
export function getPreviousAttempt(danceId: string, player: string): AttemptSummary | null {
  const name = resolvePlayerName(player)
  const found = getArenaEntries().find((e) => e.danceId === danceId && isSamePlayer(e.player, name))
  return found ? found.attempt : null
}

/** Best score per player on a dance, highest first. Earlier date wins ties. */
export function getLeaderboard(danceId: string, limit = 10): LeaderboardEntry[] {
  const max = Math.max(0, Math.floor(limit))
  if (max === 0) return []

  const best = new Map<string, { entry: ArenaEntry; isHost: boolean }>()
  for (const entry of getArenaEntries()) {
    if (entry.danceId !== danceId) continue
    const key = playerKey(entry.player)
    const current = best.get(key)
    if (!current) {
      best.set(key, { entry, isHost: entry.isHost })
      continue
    }
    const isHost = current.isHost || entry.isHost
    if (isBetter(entry, current.entry)) {
      best.set(key, { entry, isHost })
    } else {
      current.isHost = isHost
    }
  }

  return [...best.values()]
    .sort((a, b) => (isBetter(a.entry, b.entry) ? -1 : isBetter(b.entry, a.entry) ? 1 : 0))
    .slice(0, max)
    .map(({ entry, isHost }) => ({
      name: normalizePlayerName(entry.player),
      score: clamp01(entry.score),
      isHost,
    }))
}

export interface PlayerProgress {
  /** Number of recorded runs */
  runs: number
  /** 0-1 */
  best: number
  /** 0-1, most recent run */
  last: number
  /** 0-1, the run before the most recent one (null after a single run) */
  previous: number | null
}

/** `player`'s runs on `danceId` ("Your best" on the home screen), or null if they have none. */
export function getPlayerProgress(danceId: string, player: string): PlayerProgress | null {
  const name = resolvePlayerName(player)
  // Entries are stored newest first.
  const scores = getArenaEntries()
    .filter((e) => e.danceId === danceId && isSamePlayer(e.player, name))
    .map((e) => clamp01(e.score))
  if (scores.length === 0) return null
  return {
    runs: scores.length,
    best: Math.max(...scores),
    last: scores[0],
    previous: scores.length > 1 ? scores[1] : null,
  }
}

/** The host's best attempt on a dance ("Score to beat"), or null if no host has danced it. */
export function getHostForDance(danceId: string): { name: string; score: number } | null {
  let top: ArenaEntry | null = null
  for (const entry of getArenaEntries()) {
    if (entry.danceId !== danceId || !entry.isHost) continue
    if (!top || isBetter(entry, top)) top = entry
  }
  return top ? { name: normalizePlayerName(top.player), score: clamp01(top.score) } : null
}

/**
 * Should this player's next attempt on `danceId` count as a host run? True when
 * they ticked "I'm the host", or when their name matches the dance's existing
 * host (the host re-dancing without the checkbox must not battle themselves).
 */
export function isHostAttemptFor(danceId: string, player: ArenaPlayer): boolean {
  if (player.isHost) return true
  const host = getHostForDance(danceId)
  return !!host && isSamePlayer(host.name, player.name)
}

/** Higher score wins; on a tie the earlier attempt wins (it got there first). */
function isBetter(a: ArenaEntry, b: ArenaEntry): boolean {
  if (a.score !== b.score) return a.score > b.score
  const ta = Date.parse(a.date)
  const tb = Date.parse(b.date)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false
  return ta < tb
}

/** Wipe all arena attempts (keeps the current player). */
export function clearArena(): void {
  try {
    localStorage.removeItem(ARENA_ENTRIES_KEY)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Current player (who is about to dance on this device)
// ---------------------------------------------------------------------------

export function getCurrentPlayer(): ArenaPlayer | null {
  const parsed = readJson(CURRENT_PLAYER_KEY)
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const name = normalizePlayerName(p.name)
  if (!name) return null
  return { name, isHost: p.isHost === true }
}

/** Save (normalized; empty name becomes GUEST_NAME) or clear with null. */
export function setCurrentPlayer(player: ArenaPlayer | null): void {
  if (!player) {
    try {
      localStorage.removeItem(CURRENT_PLAYER_KEY)
    } catch {
      // ignore
    }
    return
  }
  writeJson(CURRENT_PLAYER_KEY, { name: resolvePlayerName(player.name), isHost: !!player.isHost })
}
