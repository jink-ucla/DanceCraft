import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '../../../server/app.ts'
import { clearJobs } from '../../../server/jobs.ts'

// Mock the processing module so tests don't actually run yt-dlp/ffmpeg
vi.mock('../../../server/processing.ts', () => ({
  parseClipRange: () => null,
  processUploadJob: vi.fn(() => Promise.resolve()),
  DATA_DIR: 'data/dances',
  isValidYoutubeUrl: (url: string) => {
    try {
      const parsed = new URL(url)
      const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']
      return validHosts.includes(parsed.hostname)
    } catch {
      return false
    }
  },
  processJob: vi.fn().mockResolvedValue(undefined),
  ensureDataDir: vi.fn(),
  DATA_DIR: '/tmp/test-dances',
}))

describe('POST /api/dances/process', () => {
  beforeEach(() => {
    clearJobs()
  })

  it('returns 202 with job id for valid YouTube URL', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    expect(res.body.jobId).toMatch(/^job_/)
    expect(res.body.status).toBe('queued')
    expect(res.body.message).toContain('Processing started')
  })

  it('accepts youtu.be short URLs', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' })

    expect(res.status).toBe(202)
    expect(res.body.jobId).toBeDefined()
  })

  it('returns 400 for missing youtubeUrl', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing required field')
  })

  it('returns 400 for invalid URL', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'https://example.com/video' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid YouTube URL')
  })

  it('returns 400 for non-string youtubeUrl', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 123 })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing required field')
  })

  it('returns 400 for completely invalid URL format', async () => {
    const res = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'not-a-url' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid YouTube URL')
  })
})

describe('GET /api/dances/jobs/:id', () => {
  beforeEach(() => {
    clearJobs()
  })

  it('returns job status for existing job', async () => {
    // First create a job
    const createRes = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    const jobId = createRes.body.jobId

    const res = await request(app).get(`/api/dances/jobs/${jobId}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(jobId)
    expect(res.body.youtubeUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(res.body.status).toBeDefined()
    expect(res.body.progress).toBeDefined()
    expect(res.body.createdAt).toBeDefined()
    expect(res.body.updatedAt).toBeDefined()
  })

  it('returns 404 for nonexistent job', async () => {
    const res = await request(app).get('/api/dances/jobs/nonexistent')
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Job not found')
  })

  it('returns null error field when no error', async () => {
    const createRes = await request(app)
      .post('/api/dances/process')
      .send({ youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })

    const res = await request(app).get(`/api/dances/jobs/${createRes.body.jobId}`)
    expect(res.body.error).toBeNull()
  })
})

describe('URL validation', () => {
  const validUrls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ]

  const invalidUrls = [
    'https://vimeo.com/123',
    'https://example.com',
    'not-a-url',
    '',
  ]

  for (const url of validUrls) {
    it(`accepts valid URL: ${url}`, async () => {
      const res = await request(app)
        .post('/api/dances/process')
        .send({ youtubeUrl: url })
      expect(res.status).toBe(202)
    })
  }

  for (const url of invalidUrls) {
    it(`rejects invalid URL: ${url || '(empty)'}`, async () => {
      const res = await request(app)
        .post('/api/dances/process')
        .send({ youtubeUrl: url })
      expect(res.status).toBe(400)
    })
  }
})
