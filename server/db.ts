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

