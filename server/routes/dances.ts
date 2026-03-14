import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { createJob, getJob } from '../jobs.ts'
import { isValidYoutubeUrl, processJob, ensureDataDir } from '../processing.ts'
import { getAllDances, getDance, deleteDance } from '../db.ts'

const router = Router()

// Process a new dance from YouTube URL
router.post('/process', (req, res) => {
  const { youtubeUrl } = req.body as { youtubeUrl?: string }

  if (!youtubeUrl || typeof youtubeUrl !== 'string') {
    res.status(400).json({ error: 'Missing required field: youtubeUrl' })
    return
  }

  if (!isValidYoutubeUrl(youtubeUrl)) {
    res.status(400).json({ error: 'Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.' })
    return
  }

  ensureDataDir()
  const job = createJob(youtubeUrl)

  // Start processing in background (non-blocking)
  processJob(job).catch(() => {
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
