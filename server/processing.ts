import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { updateJob } from './jobs.ts'
import type { Job } from './jobs.ts'
import { createDance, updateDance } from './db.ts'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'dances')

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function jobDir(jobId: string): string {
  const dir = path.join(DATA_DIR, jobId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`))
    })
  })
}

export function isValidYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']
    return validHosts.includes(parsed.hostname)
  } catch {
    return false
  }
}

async function fetchMetadata(youtubeUrl: string): Promise<{ title: string; duration: number; channel: string }> {
  const { stdout } = await runCommand('yt-dlp', [
    '--dump-json',
    '--no-download',
    youtubeUrl,
  ])

  const info = JSON.parse(stdout)
  return {
    title: info.title || 'Unknown',
    duration: info.duration || 0,
    channel: info.channel || info.uploader || 'Unknown',
  }
}

async function downloadVideo(youtubeUrl: string, outputDir: string): Promise<string> {
  const videoPath = path.join(outputDir, 'video.mp4')

  await runCommand('yt-dlp', [
    '-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best',
    '--merge-output-format', 'mp4',
    '--match-filter', 'duration <= 600',
    '-o', videoPath,
    youtubeUrl,
  ])

  if (!fs.existsSync(videoPath)) {
    throw new Error('Video file not found after download. Video may exceed max duration or be unavailable.')
  }

  return videoPath
}

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = path.join(outputDir, 'audio.mp3')

  await runCommand('ffmpeg', [
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-ab', '192k',
    '-y',
    audioPath,
  ])

  return audioPath
}

async function generateThumbnail(videoPath: string, outputDir: string): Promise<string> {
  const thumbnailPath = path.join(outputDir, 'thumbnail.jpg')

  await runCommand('ffmpeg', [
    '-i', videoPath,
    '-ss', '00:00:03',
    '-vframes', '1',
    '-vf', 'scale=480:-1',
    '-y',
    thumbnailPath,
  ])

  // If 3s fails (video shorter than 3s), try 0s
  if (!fs.existsSync(thumbnailPath)) {
    await runCommand('ffmpeg', [
      '-i', videoPath,
      '-ss', '00:00:00',
      '-vframes', '1',
      '-vf', 'scale=480:-1',
      '-y',
      thumbnailPath,
    ])
  }

  return thumbnailPath
}

async function extractPoses(videoPath: string, outputDir: string): Promise<string> {
  const posesPath = path.join(outputDir, 'poses.json')
  const scriptPath = path.join(process.cwd(), 'scripts', 'extract_poses.py')

  await runCommand('python', [
    scriptPath,
    videoPath,
    '--output', posesPath,
    '--max-duration', '600',
  ])

  return posesPath
}

export async function processJob(job: Job): Promise<void> {
  const dir = jobDir(job.id)

  try {
    // Step 1: Fetch metadata
    updateJob(job.id, { status: 'downloading', progress: 'Fetching video metadata...' })
    const metadata = await fetchMetadata(job.youtubeUrl)

    if (metadata.duration > 600) {
      updateJob(job.id, {
        status: 'error',
        progress: 'Failed',
        error: `Video is too long (${Math.round(metadata.duration / 60)} minutes). Maximum is 10 minutes.`,
      })
      return
    }

    updateJob(job.id, { metadata })

    // Step 2: Download video
    updateJob(job.id, { status: 'downloading', progress: 'Downloading video...' })
    const videoPath = await downloadVideo(job.youtubeUrl, dir)
    updateJob(job.id, { outputPaths: { video: videoPath } })

    // Step 3: Extract audio
    updateJob(job.id, { status: 'extracting_audio', progress: 'Extracting audio...' })
    const audioPath = await extractAudio(videoPath, dir)
    updateJob(job.id, { outputPaths: { ...job.outputPaths, video: videoPath, audio: audioPath } })

    // Step 4: Generate thumbnail
    updateJob(job.id, { status: 'generating_thumbnail', progress: 'Generating thumbnail...' })
    const thumbnailPath = await generateThumbnail(videoPath, dir)
    updateJob(job.id, { outputPaths: { ...job.outputPaths, video: videoPath, audio: audioPath, thumbnail: thumbnailPath } })

    // Step 5: Extract poses
    updateJob(job.id, { status: 'extracting_poses', progress: 'Extracting poses (this may take a while)...' })
    const posesPath = await extractPoses(videoPath, dir)

    // Save to database
    const dance = createDance({
      youtubeUrl: job.youtubeUrl,
      title: metadata.title,
      duration: metadata.duration,
      channel: metadata.channel,
      status: 'complete',
    })
    updateDance(dance.id, {
      videoPath,
      audioPath,
      poseDataPath: posesPath,
      thumbnailPath,
    })

    // Complete
    updateJob(job.id, {
      status: 'complete',
      progress: 'Processing complete!',
      outputPaths: {
        video: videoPath,
        audio: audioPath,
        thumbnail: thumbnailPath,
        poses: posesPath,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    updateJob(job.id, {
      status: 'error',
      progress: 'Failed',
      error: message,
    })
  }
}

export { DATA_DIR, ensureDataDir }
