import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import {
  createSession,
  getSession,
  getAllSessions,
  deleteSession,
  deleteAllSessions,
  getSessionsDiskUsage,
} from '../db.ts'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(DATA_DIR, 'sessions', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname.includes('.') ? path.extname(file.originalname) : '.webm'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
})

const router = Router()

// Save a new session (multipart: video + poses files + JSON fields)
router.post('/', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poses', maxCount: 1 },
]), (req, res) => {
  const { danceId, score, rank } = req.body as {
    danceId?: string
    score?: string
    rank?: string
  }
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined

  const uploadedFiles = files ? [...(files.video || []), ...(files.poses || [])] : []

  if (!danceId || !score || !rank) {
    // Clean up uploaded files if validation fails
    for (const f of uploadedFiles) fs.unlinkSync(f.path)
    res.status(400).json({ error: 'Missing required fields: danceId, score, rank' })
    return
  }

  const parsedDanceId = parseInt(danceId, 10)
  const parsedScore = parseFloat(score)

  if (isNaN(parsedDanceId) || isNaN(parsedScore)) {
    for (const f of uploadedFiles) fs.unlinkSync(f.path)
    res.status(400).json({ error: 'Invalid danceId or score' })
    return
  }

  const sessionDir = path.join(DATA_DIR, 'sessions', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(sessionDir, { recursive: true })

  // Move poses file to session directory
  let posesPath: string | null = null
  const posesFile = files?.poses?.[0]
  if (posesFile) {
    posesPath = path.join(sessionDir, 'poses.json')
    fs.renameSync(posesFile.path, posesPath)
  }

  // Move video file to session directory
  let videoPath: string | null = null
  const videoFile = files?.video?.[0]
  if (videoFile) {
    videoPath = path.join(sessionDir, `recording${path.extname(videoFile.originalname) || '.webm'}`)
    fs.renameSync(videoFile.path, videoPath)
  }

  const session = createSession({
    danceId: parsedDanceId,
    score: parsedScore,
    rank,
    videoPath,
    posesPath,
  })

  res.status(201).json(session)
})

// List all sessions
router.get('/', (_req, res) => {
  const sessions = getAllSessions()
  res.json(sessions)
})

// Get disk usage stats
router.get('/storage', (_req, res) => {
  const totalBytes = getSessionsDiskUsage()
  const sessions = getAllSessions()
  res.json({
    totalBytes,
    totalMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
    sessionCount: sessions.length,
  })
})

// Get single session
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid session ID' }); return }

  const session = getSession(id)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  res.json(session)
})

// Serve session video
router.get('/:id/video', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid session ID' }); return }

  const session = getSession(id)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  if (!session.videoPath || !fs.existsSync(session.videoPath)) {
    res.status(404).json({ error: 'Video not found' }); return
  }

  const stat = fs.statSync(session.videoPath)
  const fileSize = stat.size
  const range = req.headers.range

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/webm',
    })
    fs.createReadStream(session.videoPath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/webm',
      'Accept-Ranges': 'bytes',
    })
    fs.createReadStream(session.videoPath).pipe(res)
  }
})

// Serve session poses JSON
router.get('/:id/poses', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid session ID' }); return }

  const session = getSession(id)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  if (!session.posesPath || !fs.existsSync(session.posesPath)) {
    res.status(404).json({ error: 'Poses data not found' }); return
  }

  res.setHeader('Content-Type', 'application/json')
  fs.createReadStream(session.posesPath).pipe(res)
})

// Delete a session and its files
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid session ID' }); return }

  const session = getSession(id)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  // Remove files
  for (const filePath of [session.videoPath, session.posesPath]) {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  // Remove session directory if empty
  if (session.videoPath || session.posesPath) {
    const dir = path.dirname(session.videoPath || session.posesPath!)
    try { fs.rmdirSync(dir) } catch { /* not empty or doesn't exist */ }
  }

  deleteSession(id)
  res.status(204).send()
})

// Bulk delete all sessions
router.delete('/', (_req, res) => {
  const sessions = getAllSessions()

  // Clean up all session files
  for (const session of sessions) {
    for (const filePath of [session.videoPath, session.posesPath]) {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
    if (session.videoPath || session.posesPath) {
      const dir = path.dirname(session.videoPath || session.posesPath!)
      try { fs.rmdirSync(dir) } catch { /* ignore */ }
    }
  }

  const count = deleteAllSessions()
  res.json({ deleted: count })
})

export default router
