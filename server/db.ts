import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'groovy.db')

export function getDbPath(): string {
  return process.env.DB_PATH || DEFAULT_DB_PATH
}

export interface Dance {
  id: number
  youtubeUrl: string
  title: string
  duration: number
  channel: string
  thumbnailPath: string | null
  poseDataPath: string | null
  videoPath: string | null
  audioPath: string | null
  status: 'processing' | 'complete' | 'error'
  error: string | null
  createdAt: string
}

let db: Database.Database | null = null
let currentDbPath: string | null = null

export function getDb(): Database.Database {
  const dbPath = getDbPath()

  // If path changed, close old connection
  if (db && currentDbPath !== dbPath) {
    db.close()
    db = null
  }

  if (db) return db

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  currentDbPath = dbPath
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS dances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtubeUrl TEXT NOT NULL,
      title TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'Unknown',
      thumbnailPath TEXT,
      poseDataPath TEXT,
      videoPath TEXT,
      audioPath TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      error TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      danceId INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      rank TEXT NOT NULL DEFAULT 'C',
      videoPath TEXT,
      posesPath TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (danceId) REFERENCES dances(id) ON DELETE CASCADE
    )
  `)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    currentDbPath = null
  }
}

export function createDance(data: {
  youtubeUrl: string
  title: string
  duration?: number
  channel?: string
  status?: Dance['status']
}): Dance {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO dances (youtubeUrl, title, duration, channel, status, createdAt)
    VALUES (@youtubeUrl, @title, @duration, @channel, @status, datetime('now'))
  `)

  const result = stmt.run({
    youtubeUrl: data.youtubeUrl,
    title: data.title,
    duration: data.duration ?? 0,
    channel: data.channel ?? 'Unknown',
    status: data.status ?? 'processing',
  })

  return getDance(Number(result.lastInsertRowid))!
}

export function getDance(id: number): Dance | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM dances WHERE id = ?').get(id) as Dance | undefined
}

export function getAllDances(): Dance[] {
  const db = getDb()
  return db.prepare('SELECT * FROM dances ORDER BY id DESC').all() as Dance[]
}

export function updateDance(id: number, updates: Partial<Omit<Dance, 'id' | 'createdAt'>>): Dance | undefined {
  const dance = getDance(id)
  if (!dance) return undefined

  const fields: string[] = []
  const values: Record<string, unknown> = { id }

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = @${key}`)
      values[key] = value
    }
  }

  if (fields.length === 0) return dance

  const db = getDb()
  db.prepare(`UPDATE dances SET ${fields.join(', ')} WHERE id = @id`).run(values)

  return getDance(id)
}

export function deleteDance(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM dances WHERE id = ?').run(id)
  return result.changes > 0
}

// --- Sessions ---

export interface Session {
  id: number
  danceId: number
  score: number
  rank: string
  videoPath: string | null
  posesPath: string | null
  createdAt: string
}

export function createSession(data: {
  danceId: number
  score: number
  rank: string
  videoPath?: string | null
  posesPath?: string | null
}): Session {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO sessions (danceId, score, rank, videoPath, posesPath, createdAt)
    VALUES (@danceId, @score, @rank, @videoPath, @posesPath, datetime('now'))
  `)

  const result = stmt.run({
    danceId: data.danceId,
    score: data.score,
    rank: data.rank,
    videoPath: data.videoPath ?? null,
    posesPath: data.posesPath ?? null,
  })

  return getSession(Number(result.lastInsertRowid))!
}

export function getSession(id: number): Session | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
}

export function getAllSessions(): Session[] {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions ORDER BY id DESC').all() as Session[]
}

export function getSessionsByDance(danceId: number): Session[] {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions WHERE danceId = ? ORDER BY id DESC').all(danceId) as Session[]
}

export function deleteSession(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteAllSessions(): number {
  const db = getDb()
  const result = db.prepare('DELETE FROM sessions').run()
  return result.changes
}

export function getSessionsDiskUsage(): number {
  const sessions = getAllSessions()
  let totalBytes = 0
  for (const session of sessions) {
    for (const filePath of [session.videoPath, session.posesPath]) {
      if (filePath && fs.existsSync(filePath)) {
        totalBytes += fs.statSync(filePath).size
      }
    }
  }
  return totalBytes
}

