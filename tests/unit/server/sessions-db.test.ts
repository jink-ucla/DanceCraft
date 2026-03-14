import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  createDance,
  createSession,
  getSession,
  getAllSessions,
  getSessionsByDance,
  deleteSession,
  deleteAllSessions,
  getSessionsDiskUsage,
  closeDb,
} from '../../../server/db.ts'

let testDbPath: string

describe('Sessions database operations', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), 'data', `test-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    process.env.DB_PATH = testDbPath
    closeDb()
  })

  afterEach(() => {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })

  function createTestDance() {
    return createDance({
      youtubeUrl: 'https://youtube.com/watch?v=test123',
      title: 'Test Dance',
      duration: 120,
      channel: 'Test Channel',
      status: 'complete',
    })
  }

  it('creates a session linked to a dance', () => {
    const dance = createTestDance()
    const session = createSession({
      danceId: dance.id,
      score: 85.5,
      rank: 'S',
    })

    expect(session.id).toBeGreaterThan(0)
    expect(session.danceId).toBe(dance.id)
    expect(session.score).toBe(85.5)
    expect(session.rank).toBe('S')
    expect(session.videoPath).toBeNull()
    expect(session.posesPath).toBeNull()
    expect(session.createdAt).toBeTruthy()
  })

  it('creates a session with file paths', () => {
    const dance = createTestDance()
    const session = createSession({
      danceId: dance.id,
      score: 72.0,
      rank: 'A',
      videoPath: '/tmp/recording.webm',
      posesPath: '/tmp/poses.json',
    })

    expect(session.videoPath).toBe('/tmp/recording.webm')
    expect(session.posesPath).toBe('/tmp/poses.json')
  })

  it('retrieves a session by ID', () => {
    const dance = createTestDance()
    const created = createSession({ danceId: dance.id, score: 50, rank: 'B' })

    const fetched = getSession(created.id)
    expect(fetched).toBeDefined()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.score).toBe(50)
  })

  it('returns undefined for non-existent session', () => {
    expect(getSession(9999)).toBeUndefined()
  })

  it('lists all sessions ordered by newest first', () => {
    const dance = createTestDance()
    createSession({ danceId: dance.id, score: 60, rank: 'B' })
    createSession({ danceId: dance.id, score: 80, rank: 'S' })

    const sessions = getAllSessions()
    expect(sessions.length).toBe(2)
    expect(sessions[0].score).toBe(80) // newest first (higher ID)
  })

  it('filters sessions by dance ID', () => {
    const dance1 = createTestDance()
    const dance2 = createDance({
      youtubeUrl: 'https://youtube.com/watch?v=other',
      title: 'Other Dance',
      status: 'complete',
    })

    createSession({ danceId: dance1.id, score: 70, rank: 'A' })
    createSession({ danceId: dance2.id, score: 50, rank: 'B' })
    createSession({ danceId: dance1.id, score: 90, rank: 'S' })

    const dance1Sessions = getSessionsByDance(dance1.id)
    expect(dance1Sessions.length).toBe(2)
    expect(dance1Sessions.every(s => s.danceId === dance1.id)).toBe(true)
  })

  it('deletes a session', () => {
    const dance = createTestDance()
    const session = createSession({ danceId: dance.id, score: 60, rank: 'B' })

    expect(deleteSession(session.id)).toBe(true)
    expect(getSession(session.id)).toBeUndefined()
  })

  it('returns false when deleting non-existent session', () => {
    expect(deleteSession(9999)).toBe(false)
  })

  it('bulk deletes all sessions', () => {
    const dance = createTestDance()
    createSession({ danceId: dance.id, score: 60, rank: 'B' })
    createSession({ danceId: dance.id, score: 80, rank: 'S' })

    const count = deleteAllSessions()
    expect(count).toBe(2)
    expect(getAllSessions().length).toBe(0)
  })

  it('calculates disk usage from session files', () => {
    // No sessions = 0 bytes
    expect(getSessionsDiskUsage()).toBe(0)
  })
})
