import { Router } from 'express'
import { createJob, getJob } from '../jobs.ts'
import { isValidYoutubeUrl, processJob, ensureDataDir } from '../processing.ts'

const router = Router()

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

export default router
