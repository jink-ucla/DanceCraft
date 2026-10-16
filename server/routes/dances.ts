import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { createJob, getJob } from '../jobs.ts'
import multer from 'multer'
import { isValidYoutubeUrl, processJob, processUploadJob, parseClipRange, ensureDataDir, DATA_DIR } from '../processing.ts'
import type { ClipRange } from '../processing.ts'
import { getAllDances, getDance, deleteDance } from '../db.ts'

const router = Router()

// Process a new dance from YouTube URL
router.post('/process', (req, res) => {
  const { youtubeUrl, startTime, endTime } = req.body as { youtubeUrl?: string; startTime?: unknown; endTime?: unknown }

  if (!youtubeUrl || typeof youtubeUrl !== 'string') {
    res.status(400).json({ error: 'Missing required field: youtubeUrl' })
    return
  }

  if (!isValidYoutubeUrl(youtubeUrl)) {
    res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.' })
    return
  }

  let clip: ClipRange | null
  try {
    clip = parseClipRange(startTime, endTime)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }

  ensureDataDir()
  const job = createJob(youtubeUrl)

  // Start processing in background (non-blocking)
  processJob(job, clip).catch(() => {
    // Error is already captured in the job via updateJob
  })

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: 'Processing started. Use GET /api/dances/jobs/:id to track progress.',
  })
})

// Upload a video file from the browser (optionally trimmed to startTime/endTime)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(DATA_DIR, 'uploads')
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname) || '.mp4'}`)
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('video/') || /.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname))
  },
})

router.post('/upload', upload.single('video'), (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ error: 'Missing video file (field "video"). Supported: mp4, mov, m4v, webm, mkv, avi.' })
    return
  }
  const body = req.body as { title?: string; startTime?: unknown; endTime?: unknown }
  let clip: ClipRange | null
  try {
    clip = parseClipRange(body.startTime, body.endTime)
  } catch (err) {
    fs.rmSync(file.path, { force: true })
    res.status(400).json({ error: (err as Error).message })
    return
  }
  const title = (body.title ?? '').toString().trim().slice(0, 120)
    || path.basename(file.originalname, path.extname(file.originalname)).slice(0, 120)
    || 'Uploaded dance'

  ensureDataDir()
  const job = createJob(`upload:${file.originalname}`)
  processUploadJob(job, file.path, title, clip).catch(() => {
    // Error is already captured in the job via updateJob
  })

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: 'Processing started. Use GET /api/dances/jobs/:id to track progress.',
  })
})

// Get job status
router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id)

  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json({
    id: job.id,
    youtubeUrl: job.youtubeUrl,
    status: job.status,
    progress: job.progress,
    metadata: job.metadata,
    error: job.error || null,
    danceId: job.danceId ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  })
})

// List all dances
router.get('/', (_req, res) => {
  const dances = getAllDances()
  res.json(dances)
})

// Get single dance
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid dance ID' })
    return
  }

  const dance = getDance(id)
  if (!dance) {
    res.status(404).json({ error: 'Dance not found' })
    return
  }

  res.json(dance)
})

// Serve dance video file with Range request support
router.get('/:id/video', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid dance ID' }); return }

  const dance = getDance(id)
  if (!dance) { res.status(404).json({ error: 'Dance not found' }); return }
  if (!dance.videoPath || !fs.existsSync(dance.videoPath)) {
    res.status(404).json({ error: 'Video file not found' }); return
  }

  const stat = fs.statSync(dance.videoPath)
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
      'Content-Type': 'video/mp4',
    })
    fs.createReadStream(dance.videoPath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    })
    fs.createReadStream(dance.videoPath).pipe(res)
  }
})

// Serve dance audio file with Range request support
router.get('/:id/audio', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid dance ID' }); return }

  const dance = getDance(id)
  if (!dance) { res.status(404).json({ error: 'Dance not found' }); return }
  if (!dance.audioPath || !fs.existsSync(dance.audioPath)) {
    res.status(404).json({ error: 'Audio file not found' }); return
  }

  const stat = fs.statSync(dance.audioPath)
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
      'Content-Type': 'audio/mpeg',
    })
    fs.createReadStream(dance.audioPath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    })
    fs.createReadStream(dance.audioPath).pipe(res)
  }
})

// Serve dance pose data JSON
router.get('/:id/poses', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid dance ID' }); return }

  const dance = getDance(id)
  if (!dance) { res.status(404).json({ error: 'Dance not found' }); return }
  if (!dance.poseDataPath || !fs.existsSync(dance.poseDataPath)) {
    res.status(404).json({ error: 'Pose data not found' }); return
  }

  res.setHeader('Content-Type', 'application/json')
  fs.createReadStream(dance.poseDataPath).pipe(res)
})

// Serve dance thumbnail image
router.get('/:id/thumbnail', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid dance ID' }); return }

  const dance = getDance(id)
  if (!dance) { res.status(404).json({ error: 'Dance not found' }); return }
  if (!dance.thumbnailPath || !fs.existsSync(dance.thumbnailPath)) {
    res.status(404).json({ error: 'Thumbnail not found' }); return
  }

  res.setHeader('Content-Type', 'image/jpeg')
  fs.createReadStream(dance.thumbnailPath).pipe(res)
})

// Delete dance and associated files
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid dance ID' })
    return
  }

  const dance = getDance(id)
  if (!dance) {
    res.status(404).json({ error: 'Dance not found' })
    return
  }

  // Remove associated files
  const filePaths = [dance.videoPath, dance.audioPath, dance.poseDataPath, dance.thumbnailPath]
  for (const filePath of filePaths) {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  // Remove the dance directory if it exists and is empty
  if (dance.videoPath) {
    const dir = path.dirname(dance.videoPath)
    try {
      fs.rmdirSync(dir)
    } catch {
      // Directory not empty or doesn't exist — that's fine
    }
  }

  deleteDance(id)
  res.status(204).send()
})

export default router
