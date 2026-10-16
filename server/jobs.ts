export type JobStatus = 'queued' | 'downloading' | 'extracting_audio' | 'extracting_poses' | 'generating_thumbnail' | 'complete' | 'error'

export interface Job {
  id: string
  youtubeUrl: string
  status: JobStatus
  progress: string
  metadata: {
    title?: string
    duration?: number
    channel?: string
  }
  outputPaths: {
    video?: string
    audio?: string
    poses?: string
    thumbnail?: string
  }
  error?: string
  /** Set when the job completes: id of the created dance row. */
  danceId?: number
  createdAt: string
  updatedAt: string
}

const jobs = new Map<string, Job>()

let jobCounter = 0

export function createJob(youtubeUrl: string): Job {
  jobCounter++
  const id = `job_${Date.now()}_${jobCounter}`
  const now = new Date().toISOString()

  const job: Job = {
    id,
    youtubeUrl,
    status: 'queued',
    progress: 'Waiting to start...',
    metadata: {},
    outputPaths: {},
    createdAt: now,
    updatedAt: now,
  }

  jobs.set(id, job)
  return job
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function updateJob(id: string, updates: Partial<Omit<Job, 'id' | 'createdAt'>>): Job | undefined {
  const job = jobs.get(id)
  if (!job) return undefined

  Object.assign(job, updates, { updatedAt: new Date().toISOString() })
  return job
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values())
}

export function clearJobs(): void {
  jobs.clear()
  jobCounter = 0
}
