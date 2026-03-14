import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../../server/app.ts'

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.timestamp).toBeDefined()
  })

  it('returns a valid ISO timestamp', async () => {
    const res = await request(app).get('/api/health')
    const date = new Date(res.body.timestamp)
    expect(date.toISOString()).toBe(res.body.timestamp)
  })

  it('returns JSON content type', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })
})
