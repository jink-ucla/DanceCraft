import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '../../../server/app.ts'
import { createDance, createSession, closeDb } from '../../../server/db.ts'

let testDbPath: string

describe('Sessions API routes', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), 'data', `test-sessions-routes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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
      channel: 'Test',
      status: 'complete',
    })
  }

  it('POST /api/sessions creates a session', async () => {
    const dance = createTestDance()

    const res = await request(app)
      .post('/api/sessions')
      .field('danceId', String(dance.id))
      .field('score', '85.5')
      .field('rank', 'S')

    expect(res.status).toBe(201)
    expect(res.body.danceId).toBe(dance.id)
    expect(res.body.score).toBe(85.5)
    expect(res.body.rank).toBe('S')
  })

  it('POST /api/sessions rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .field('danceId', '1')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing required fields')
  })

  it('POST /api/sessions saves poses JSON', async () => {
    const dance = createTestDance()
    const poses = JSON.stringify([{ time: 0.5, pose: { keypoints: [] } }])

    const posesBuffer = Buffer.from(poses)
    const res = await request(app)
      .post('/api/sessions')
      .field('danceId', String(dance.id))
      .field('score', '70')
      .field('rank', 'A')
      .attach('poses', posesBuffer, 'poses.json')

    expect(res.status).toBe(201)
    expect(res.body.posesPath).toBeTruthy()
    expect(fs.existsSync(res.body.posesPath)).toBe(true)

    // Clean up
    fs.unlinkSync(res.body.posesPath)
    try { fs.rmdirSync(path.dirname(res.body.posesPath)) } catch { /* ignore */ }
  })

  it('GET /api/sessions lists all sessions', async () => {
    const dance = createTestDance()
    createSession({ danceId: dance.id, score: 60, rank: 'B' })
    createSession({ danceId: dance.id, score: 80, rank: 'S' })

    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(2)
  })

  it('GET /api/sessions/:id returns a session', async () => {
    const dance = createTestDance()
    const session = createSession({ danceId: dance.id, score: 75, rank: 'A' })

    const res = await request(app).get(`/api/sessions/${session.id}`)
    expect(res.status).toBe(200)
    expect(res.body.score).toBe(75)
  })

  it('GET /api/sessions/:id returns 404 for non-existent', async () => {
    const res = await request(app).get('/api/sessions/9999')
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/storage returns disk usage', async () => {
    const res = await request(app).get('/api/sessions/storage')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('totalBytes')
    expect(res.body).toHaveProperty('totalMB')
    expect(res.body).toHaveProperty('sessionCount')
  })

  it('DELETE /api/sessions/:id removes a session', async () => {
    const dance = createTestDance()
    const session = createSession({ danceId: dance.id, score: 60, rank: 'B' })

    const res = await request(app).delete(`/api/sessions/${session.id}`)
    expect(res.status).toBe(204)

    const check = await request(app).get(`/api/sessions/${session.id}`)
    expect(check.status).toBe(404)
  })

  it('DELETE /api/sessions bulk deletes all sessions', async () => {
    const dance = createTestDance()
    createSession({ danceId: dance.id, score: 60, rank: 'B' })
    createSession({ danceId: dance.id, score: 80, rank: 'S' })

    const res = await request(app).delete('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(2)

    const list = await request(app).get('/api/sessions')
    expect(list.body.length).toBe(0)
  })
})
