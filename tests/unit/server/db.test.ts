import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createDance, getDance, getAllDances, updateDance, deleteDance, getDb, closeDb } from '../../../server/db.ts'

let testDbPath: string

describe('Database operations', () => {
  beforeEach(() => {
    testDbPath = path.join(process.cwd(), 'data', `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
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

  describe('getDb', () => {
    it('creates database and dances table on first call', () => {
      const db = getDb()
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dances'").all()
      expect(tables).toHaveLength(1)
    })

    it('returns same instance on subsequent calls', () => {
      const db1 = getDb()
      const db2 = getDb()
      expect(db1).toBe(db2)
    })
  })

  describe('createDance', () => {
    it('creates a dance with required fields', () => {
      const dance = createDance({
        youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
        title: 'Test Dance',
      })

      expect(dance.id).toBe(1)
      expect(dance.youtubeUrl).toBe('https://www.youtube.com/watch?v=abc123')
      expect(dance.title).toBe('Test Dance')
      expect(dance.duration).toBe(0)
      expect(dance.channel).toBe('Unknown')
      expect(dance.status).toBe('processing')
      expect(dance.createdAt).toBeDefined()
    })

    it('creates a dance with all fields', () => {
      const dance = createDance({
        youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
        title: 'Full Dance',
        duration: 180,
        channel: 'Dance Channel',
        status: 'complete',
      })

      expect(dance.duration).toBe(180)
      expect(dance.channel).toBe('Dance Channel')
      expect(dance.status).toBe('complete')
    })

    it('auto-increments IDs', () => {
      const dance1 = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Dance 1' })
      const dance2 = createDance({ youtubeUrl: 'https://youtube.com/2', title: 'Dance 2' })

      expect(dance2.id).toBe(dance1.id + 1)
    })
  })

  describe('getDance', () => {
    it('returns dance by id', () => {
      const created = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Dance 1' })
      const fetched = getDance(created.id)

      expect(fetched).toBeDefined()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.title).toBe('Dance 1')
    })

    it('returns undefined for nonexistent id', () => {
      const result = getDance(999)
      expect(result).toBeUndefined()
    })
  })

  describe('getAllDances', () => {
    it('returns empty array when no dances', () => {
      const dances = getAllDances()
      expect(dances).toEqual([])
    })

    it('returns all dances sorted by createdAt DESC', () => {
      createDance({ youtubeUrl: 'https://youtube.com/1', title: 'First' })
      createDance({ youtubeUrl: 'https://youtube.com/2', title: 'Second' })
      createDance({ youtubeUrl: 'https://youtube.com/3', title: 'Third' })

      const dances = getAllDances()
      expect(dances).toHaveLength(3)
      // Most recently added should be first
      expect(dances[0].title).toBe('Third')
      expect(dances[2].title).toBe('First')
    })
  })

  describe('updateDance', () => {
    it('updates specified fields', () => {
      const dance = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Dance' })

      const updated = updateDance(dance.id, {
        status: 'complete',
        videoPath: '/data/video.mp4',
        audioPath: '/data/audio.mp3',
        poseDataPath: '/data/poses.json',
        thumbnailPath: '/data/thumb.jpg',
      })

      expect(updated).toBeDefined()
      expect(updated!.status).toBe('complete')
      expect(updated!.videoPath).toBe('/data/video.mp4')
      expect(updated!.audioPath).toBe('/data/audio.mp3')
      expect(updated!.poseDataPath).toBe('/data/poses.json')
      expect(updated!.thumbnailPath).toBe('/data/thumb.jpg')
    })

    it('returns undefined for nonexistent id', () => {
      const result = updateDance(999, { status: 'complete' })
      expect(result).toBeUndefined()
    })

    it('does not modify unspecified fields', () => {
      const dance = createDance({
        youtubeUrl: 'https://youtube.com/1',
        title: 'Original Title',
        channel: 'Original Channel',
      })

      updateDance(dance.id, { status: 'complete' })
      const fetched = getDance(dance.id)

      expect(fetched!.title).toBe('Original Title')
      expect(fetched!.channel).toBe('Original Channel')
    })
  })

  describe('deleteDance', () => {
    it('deletes existing dance and returns true', () => {
      const dance = createDance({ youtubeUrl: 'https://youtube.com/1', title: 'Dance' })
      const result = deleteDance(dance.id)

      expect(result).toBe(true)
      expect(getDance(dance.id)).toBeUndefined()
    })

    it('returns false for nonexistent id', () => {
      const result = deleteDance(999)
      expect(result).toBe(false)
    })
  })
})
