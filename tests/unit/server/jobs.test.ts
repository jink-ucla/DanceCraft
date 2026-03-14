import { describe, it, expect, beforeEach } from 'vitest'
import { createJob, getJob, updateJob, getAllJobs, clearJobs } from '../../../server/jobs.ts'

describe('Job Manager', () => {
  beforeEach(() => {
    clearJobs()
  })

  it('creates a job with correct initial state', () => {
    const job = createJob('https://www.youtube.com/watch?v=test123')
    expect(job.id).toMatch(/^job_/)
    expect(job.youtubeUrl).toBe('https://www.youtube.com/watch?v=test123')
    expect(job.status).toBe('queued')
    expect(job.progress).toBe('Waiting to start...')
    expect(job.metadata).toEqual({})
    expect(job.outputPaths).toEqual({})
    expect(job.createdAt).toBeDefined()
    expect(job.updatedAt).toBeDefined()
  })

  it('retrieves a job by id', () => {
    const job = createJob('https://www.youtube.com/watch?v=test123')
    const retrieved = getJob(job.id)
    expect(retrieved).toBe(job)
  })

  it('returns undefined for unknown job id', () => {
    expect(getJob('nonexistent')).toBeUndefined()
  })

  it('updates a job', () => {
    const job = createJob('https://www.youtube.com/watch?v=test123')
    const updated = updateJob(job.id, { status: 'downloading', progress: 'Downloading...' })
    expect(updated?.status).toBe('downloading')
    expect(updated?.progress).toBe('Downloading...')
  })

  it('returns undefined when updating nonexistent job', () => {
    expect(updateJob('nonexistent', { status: 'error' })).toBeUndefined()
  })

  it('lists all jobs', () => {
    createJob('https://www.youtube.com/watch?v=a')
    createJob('https://www.youtube.com/watch?v=b')
    expect(getAllJobs()).toHaveLength(2)
  })

  it('generates unique job ids', () => {
    const job1 = createJob('https://www.youtube.com/watch?v=a')
    const job2 = createJob('https://www.youtube.com/watch?v=b')
    expect(job1.id).not.toBe(job2.id)
  })
})
