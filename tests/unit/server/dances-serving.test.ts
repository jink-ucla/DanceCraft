import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import app from '../../../server/app.ts'
import { createDance, closeDb, updateDance } from '../../../server/db.ts'

let testDbPath: string
let tmpDir: string

// Mock the processing module so tests don't actually run yt-dlp/ffmpeg
vi.mock('../../../server/processing.ts', () => ({
  isValidYoutubeUrl: () => true,
  processJob: vi.fn().mockResolvedValue(undefined),
  ensureDataDir: vi.fn(),
  DATA_DIR: '/tmp/test-dances',
}))

describe('Dance file serving API', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), 'data', `test-serving-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    process.env.DB_PATH = testDbPath
    closeDb()

    // Create temp files to simulate dance assets
    tmpDir = path.join(process.cwd(), 'data', `test-serving-files-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    delete process.env.DB_PATH

    // Clean up temp files
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })

  function createDanceWithFiles() {
    const videoPath = path.join(tmpDir, 'video.mp4')
    const audioPath = path.join(tmpDir, 'audio.mp3')
    const posesPath = path.join(tmpDir, 'poses.json')
    const thumbPath = path.join(tmpDir, 'thumbnail.jpg')

    fs.writeFileSync(videoPath, 'fake-video-content-for-testing')
    fs.writeFileSync(audioPath, 'fake-audio-content-for-testing')
    fs.writeFileSync(posesPath, JSON.stringify({ keyframes: [] }))
    fs.writeFileSync(thumbPath, 'fake-jpeg-data')

    const dance = createDance({
      youtubeUrl: 'https://youtube.com/watch?v=test123',
      title: 'Test Dance',
      status: 'complete',
    })
    updateDance(dance.id, { videoPath, audioPath, poseDataPath: posesPath, thumbnailPath: thumbPath })
    return dance
  }

  describe('GET /api/dances/:id/video', () => {
    it('serves the video file with correct Content-Type', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app).get(`/api/dances/${dance.id}/video`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('video/mp4')
      expect(res.headers['accept-ranges']).toBe('bytes')
      expect(Buffer.isBuffer(res.body)).toBe(true)
      expect(res.body.toString()).toBe('fake-video-content-for-testing')
    })

    it('supports Range requests for video seeking', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app)
        .get(`/api/dances/${dance.id}/video`)
        .set('Range', 'bytes=0-9')
      expect(res.status).toBe(206)
      expect(res.headers['content-type']).toBe('video/mp4')
      expect(res.headers['content-range']).toMatch(/^bytes 0-9\//)
      expect(res.headers['content-length']).toBe('10')
      expect(res.body.toString()).toBe('fake-video')
    })

    it('returns 404 when dance not found', async () => {
      const res = await request(app).get('/api/dances/999/video')
      expect(res.status).toBe(404)
    })

    it('returns 404 when video file missing', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/watch?v=test',
        title: 'No Video',
        status: 'complete',
      })
      const res = await request(app).get(`/api/dances/${dance.id}/video`)
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('Video file not found')
    })

    it('returns 400 for invalid id', async () => {
      const res = await request(app).get('/api/dances/abc/video')
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/dances/:id/audio', () => {
    it('serves the audio file with correct Content-Type', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app).get(`/api/dances/${dance.id}/audio`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('audio/mpeg')
      expect(res.headers['accept-ranges']).toBe('bytes')
    })

    it('supports Range requests for audio', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app)
        .get(`/api/dances/${dance.id}/audio`)
        .set('Range', 'bytes=5-14')
      expect(res.status).toBe(206)
      expect(res.headers['content-type']).toBe('audio/mpeg')
      expect(res.headers['content-range']).toMatch(/^bytes 5-14\//)
    })

    it('returns 404 when audio file missing', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/watch?v=test',
        title: 'No Audio',
        status: 'complete',
      })
      const res = await request(app).get(`/api/dances/${dance.id}/audio`)
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('Audio file not found')
    })
  })

  describe('GET /api/dances/:id/poses', () => {
    it('serves pose data as JSON', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app).get(`/api/dances/${dance.id}/poses`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.body).toEqual({ keyframes: [] })
    })

    it('returns 404 when pose data missing', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/watch?v=test',
        title: 'No Poses',
        status: 'complete',
      })
      const res = await request(app).get(`/api/dances/${dance.id}/poses`)
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('Pose data not found')
    })
  })

  describe('GET /api/dances/:id/thumbnail', () => {
    it('serves thumbnail as JPEG', async () => {
      const dance = createDanceWithFiles()
      const res = await request(app).get(`/api/dances/${dance.id}/thumbnail`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/jpeg')
    })

    it('returns 404 when thumbnail missing', async () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/watch?v=test',
        title: 'No Thumb',
        status: 'complete',
      })
      const res = await request(app).get(`/api/dances/${dance.id}/thumbnail`)
      expect(res.status).toBe(404)
      expect(res.body.error).toContain('Thumbnail not found')
    })
  })
})
