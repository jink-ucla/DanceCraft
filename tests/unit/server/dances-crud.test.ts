import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '../../../server/app.ts'
import { createDance, closeDb, updateDance } from '../../../server/db.ts'

let testDbPath: string

// Mock the processing module so tests don't actually run yt-dlp/ffmpeg
vi.mock('../../../server/processing.ts', () => ({
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

describe('Dance CRUD API', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), 'data', `test-crud-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    process.env.DB_PATH = testDbPath
    closeDb()
  })

  afterEach(() => {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    delete process.env.DB_PATH
  })

  describe('GET /api/dances', () => {
    it('returns empty array when no dances', async () => {
      const res = await request(app).get('/api/dances')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns all dances', async () => {
      createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Dance 1', status: 'complete' })
      createDance({ youtubeUrl: 'https://youtube.com/2', title: 'Dance 2', status: 'complete' })

      const res = await request(app).get('/api/dances')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].title).toBe('Dance 2') // Most recent first
      expect(res.body[1].title).toBe('Dance 1')
    })
  })

  describe('GET /api/dances/:id', () => {
    it('returns a single dance', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/1',
        title: 'My Dance',
        duration: 120,
        channel: 'Test Channel',
        status: 'complete',
      })

      const res = await request(app).get(`/api/dances/${dance.id}`)
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(dance.id)
      expect(res.body.title).toBe('My Dance')
      expect(res.body.duration).toBe(120)
      expect(res.body.channel).toBe('Test Channel')
      expect(res.body.status).toBe('complete')
    })

    it('returns 404 for nonexistent dance', async () => {
      const res = await request(app).get('/api/dances/999')
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('Dance not found')
    })

    it('returns 400 for invalid id', async () => {
      const res = await request(app).get('/api/dances/notanumber')
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid dance ID')
    })
  })

  describe('DELETE /api/dances/:id', () => {
    it('deletes a dance and returns 204', async () => {
      const dance = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Delete Me' })

      const res = await request(app).delete(`/api/dances/${dance.id}`)
      expect(res.status).toBe(204)

      // Verify it's gone
      const getRes = await request(app).get(`/api/dances/${dance.id}`)
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for nonexistent dance', async () => {
      const res = await request(app).delete('/api/dances/999')
      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid id', async () => {
      const res = await request(app).delete('/api/dances/notanumber')
      expect(res.status).toBe(400)
    })

    it('cleans up associated files', async () => {
      // Create temp files to simulate dance assets
      const tmpDir = path.join(process.cwd(), 'data', 'test-delete-files')
      fs.mkdirSync(tmpDir, { recursive: true })
      const videoPath = path.join(tmpDir, 'video.mp4')
      const audioPath = path.join(tmpDir, 'audio.mp3')
      fs.writeFileSync(videoPath, 'fake video')
      fs.writeFileSync(audioPath, 'fake audio')

      const dance = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'With Files' })
      updateDance(dance.id, { videoPath, audioPath })

      await request(app).delete(`/api/dances/${dance.id}`)

      expect(fs.existsSync(videoPath)).toBe(false)
      expect(fs.existsSync(audioPath)).toBe(false)
    })
  })

  describe('Dance entries include all required fields', () => {
    it('has all expected columns', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/1',
        title: 'Complete Dance',
        duration: 200,
        channel: 'My Channel',
        status: 'complete',
      })

      updateDance(dance.id, {
        videoPath: '/data/video.mp4',
        audioPath: '/data/audio.mp3',
        poseDataPath: '/data/poses.json',
        thumbnailPath: '/data/thumb.jpg',
      })

      const res = await request(app).get(`/api/dances/${dance.id}`)
      const body = res.body

      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('youtubeUrl')
      expect(body).toHaveProperty('title')
      expect(body).toHaveProperty('duration')
      expect(body).toHaveProperty('channel')
      expect(body).toHaveProperty('thumbnailPath')
      expect(body).toHaveProperty('poseDataPath')
      expect(body).toHaveProperty('videoPath')
      expect(body).toHaveProperty('audioPath')
      expect(body).toHaveProperty('status')
      expect(body).toHaveProperty('createdAt')
    })
  })
})
