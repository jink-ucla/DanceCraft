import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { updateJob } from './jobs.ts'
import type { Job } from './jobs.ts'
import { createDance, updateDance } from './db.ts'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', 'dances')

/**
 * Python interpreter for the offline pose pipeline:
 * PYTHON_PATH, else the project venv (.venv/Scripts/python.exe on Windows,
 * .venv/bin/python3 elsewhere). Resolved at call time (not module load) so a
 * PYTHON_PATH from .env — loaded by dotenv in app.ts after imports are
 * evaluated — is honoured. Relative paths are resolved against cwd.
 */
export function resolvePythonPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.PYTHON_PATH?.trim()
  if (fromEnv) {
    return /[\\/]/.test(fromEnv) && !path.isAbsolute(fromEnv) ? path.resolve(cwd, fromEnv) : fromEnv
  }
  return platform === 'win32'
    ? path.join(cwd, '.venv', 'Scripts', 'python.exe')
    : path.join(cwd, '.venv', 'bin', 'python3')
}

/**
 * yt-dlp: YTDLP_PATH, else the project venv's yt-dlp (pip installs it there),
 * else whatever is on PATH.
 */
export function resolveYtDlpPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): string {
  const fromEnv = env.YTDLP_PATH?.trim()
  if (fromEnv) return fromEnv
  const venv = platform === 'win32'
    ? path.join(cwd, '.venv', 'Scripts', 'yt-dlp.exe')
    : path.join(cwd, '.venv', 'bin', 'yt-dlp')
  return fs.existsSync(venv) ? venv : 'yt-dlp'
}

let wingetFfmpegCache: string | null | undefined

/** Find ffmpeg.exe inside a winget package (e.g. Gyan.FFmpeg_*\ffmpeg-*-full_build\bin). */
export function findWingetFfmpeg(packagesDir: string): string | null {
  let packages: string[]
  try {
    packages = fs.readdirSync(packagesDir).filter((name) => /ffmpeg/i.test(name))
  } catch {
    return null
  }
  for (const pkg of packages) {
    const stack: { dir: string; depth: number }[] = [{ dir: path.join(packagesDir, pkg), depth: 0 }]
    while (stack.length > 0) {
      const { dir, depth } = stack.pop()!
      const candidate = path.join(dir, 'ffmpeg.exe')
      if (fs.existsSync(candidate)) return candidate
      if (depth >= 3) continue
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 })
        }
      } catch { /* unreadable dir */ }
    }
  }
  return null
}

/**
 * ffmpeg: FFMPEG_PATH, else (Windows) a winget-installed FFmpeg — winget's
 * Links shim is not always on PATH — else whatever is on PATH.
 */
export function resolveFfmpegPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const fromEnv = env.FFMPEG_PATH?.trim()
  if (fromEnv) return fromEnv
  if (platform === 'win32' && env.LOCALAPPDATA) {
    if (wingetFfmpegCache === undefined) {
      wingetFfmpegCache = findWingetFfmpeg(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'))
    }
    if (wingetFfmpegCache) return wingetFfmpegCache
  }
  return 'ffmpeg'
}

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
  const { stdout } = await runCommand(resolveYtDlpPath(), [
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

  const ffmpeg = resolveFfmpegPath()
  await runCommand(resolveYtDlpPath(), [
    '-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best',
    '--merge-output-format', 'mp4',
    // yt-dlp needs ffmpeg to merge the separate video + audio streams
    ...(ffmpeg !== 'ffmpeg' ? ['--ffmpeg-location', ffmpeg] : []),
    '-o', videoPath,
    youtubeUrl,
  ])

  if (!fs.existsSync(videoPath)) {
    const leftoverStreams = fs.readdirSync(outputDir).filter((f) => /^video\.f\d+\./.test(f))
    throw new Error(leftoverStreams.length > 0
      ? 'Downloaded the video and audio streams but could not merge them: ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH in .env.'
      : 'yt-dlp finished without producing a video file. The video may be private, age/region-restricted or unavailable.')
  }

  return videoPath
}

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = path.join(outputDir, 'audio.mp3')

  await runCommand(resolveFfmpegPath(), [
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

  await runCommand(resolveFfmpegPath(), [
    '-i', videoPath,
    '-ss', '00:00:03',
    '-vframes', '1',
    '-vf', 'scale=480:-1',
    '-y',
    thumbnailPath,
  ])

  // If 3s fails (video shorter than 3s), try 0s
  if (!fs.existsSync(thumbnailPath)) {
    await runCommand(resolveFfmpegPath(), [
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

async function extractPoses(videoPath: string, outputDir: string, onProgress?: (pct: number) => void): Promise<string> {
  const posesPath = path.join(outputDir, 'poses.json')
  const scriptPath = path.join(process.cwd(), 'scripts', 'extract_poses.py')

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(resolvePythonPath(), [
      scriptPath,
      videoPath,
      '--output', posesPath,
    ])

    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        // Parse "PROGRESS:frame/total:pct"
        const match = line.match(/^PROGRESS:\d+\/\d+:(\d+)/)
        if (match && onProgress) {
          onProgress(parseInt(match[1], 10))
        }
      }
    })

    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`extract_poses exited with code ${code}: ${stderr}`))
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn extract_poses: ${err.message}`))
    })
  })

  return posesPath
}

/** Optional time range (seconds) to keep from the source video. */
export interface ClipRange {
  start?: number
  end?: number
}

/**
 * Parse optional startTime/endTime (seconds, or "m:ss") from a request body.
 * Returns null when no range was given; throws a user-facing Error when invalid.
 */
export function parseClipRange(startRaw: unknown, endRaw: unknown): ClipRange | null {
  const parse = (v: unknown, label: string): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined
    const s = String(v).trim()
    const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/)
    const n = m ? Number(m[1]) * 60 + Number(m[2]) : Number(s)
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${label} time "${s}". Use seconds (e.g. 75) or m:ss (e.g. 1:15).`)
    return n
  }
  const start = parse(startRaw, 'start')
  const end = parse(endRaw, 'end')
  if (start === undefined && end === undefined) return null
  if (start !== undefined && end !== undefined && end - start < 1) {
    throw new Error('The end time must be at least 1 second after the start time.')
  }
  return { start, end }
}

/**
 * Re-encode the source into the pipeline's video.mp4: optional trim to the clip
 * range, at most 30 fps and 720p (fewer frames for the Heavy pose model, and a
 * browser-friendly H.264/AAC file).
 */
async function prepareVideo(sourcePath: string, outputDir: string, clip: ClipRange | null): Promise<string> {
  const videoPath = path.join(outputDir, 'video.mp4')
  const tmpPath = path.join(outputDir, 'video.prepared.mp4')
  await runCommand(resolveFfmpegPath(), [
    '-y',
    ...(clip?.start !== undefined ? ['-ss', String(clip.start)] : []),
    ...(clip?.end !== undefined ? ['-to', String(clip.end)] : []),
    '-i', sourcePath,
    '-vf', "scale=-2:'min(720,ih)',fps=30",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    tmpPath,
  ])
  if (sourcePath === videoPath) fs.rmSync(videoPath, { force: true })
  fs.renameSync(tmpPath, videoPath)
  return videoPath
}

function readPoseDuration(posesPath: string): number {
  try {
    const data = JSON.parse(fs.readFileSync(posesPath, 'utf8')) as { duration?: number; keyframes?: { time: number }[] }
    if (typeof data.duration === 'number' && data.duration > 0) return data.duration
    const last = data.keyframes?.[data.keyframes.length - 1]
    return last ? last.time : 0
  } catch {
    return 0
  }
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function clipLabel(clip: ClipRange | null): string {
  if (!clip) return ''
  return ` (${formatClock(clip.start ?? 0)}–${clip.end !== undefined ? formatClock(clip.end) : 'end'})`
}

/** Shared tail of both pipelines: audio, thumbnail, poses, DB row. */
async function finishJob(
  job: Job,
  dir: string,
  videoPath: string,
  info: { youtubeUrl: string; title: string; channel: string },
): Promise<void> {
  updateJob(job.id, { status: 'extracting_audio', progress: 'Extracting audio...', outputPaths: { video: videoPath } })
  const audioPath = await extractAudio(videoPath, dir)

  updateJob(job.id, { status: 'generating_thumbnail', progress: 'Generating thumbnail...' })
  const thumbnailPath = await generateThumbnail(videoPath, dir)

  updateJob(job.id, { status: 'extracting_poses', progress: 'Extracting poses 0%' })
  const posesPath = await extractPoses(videoPath, dir, (pct) => {
    updateJob(job.id, { progress: `Extracting poses ${pct}%` })
  })

  const dance = createDance({
    youtubeUrl: info.youtubeUrl,
    title: info.title,
    duration: Math.round(readPoseDuration(posesPath)),
    channel: info.channel,
    status: 'complete',
  })
  updateDance(dance.id, { videoPath, audioPath, poseDataPath: posesPath, thumbnailPath })

  updateJob(job.id, {
    status: 'complete',
    progress: 'Processing complete!',
    danceId: dance.id,
    outputPaths: { video: videoPath, audio: audioPath, thumbnail: thumbnailPath, poses: posesPath },
  })
}

function failJob(job: Job, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown error'
  updateJob(job.id, { status: 'error', progress: 'Failed', error: message })
}

export async function processJob(job: Job, clip: ClipRange | null = null): Promise<void> {
  const dir = jobDir(job.id)

  try {
    updateJob(job.id, { status: 'downloading', progress: 'Fetching video metadata...' })
    const metadata = await fetchMetadata(job.youtubeUrl)
    // No maximum duration (upstream Groovy capped imports at 10 minutes).
    const title = metadata.title + clipLabel(clip)
    updateJob(job.id, { metadata: { ...metadata, title } })

    updateJob(job.id, { status: 'downloading', progress: 'Downloading video...' })
    const downloaded = await downloadVideo(job.youtubeUrl, dir)

    updateJob(job.id, { progress: clip ? 'Cutting your clip...' : 'Preparing video...' })
    const videoPath = await prepareVideo(downloaded, dir, clip)

    await finishJob(job, dir, videoPath, { youtubeUrl: job.youtubeUrl, title, channel: metadata.channel })
  } catch (err) {
    failJob(job, err)
  }
}

/** Pipeline for a video file uploaded from the browser (no yt-dlp). */
export async function processUploadJob(
  job: Job,
  uploadedPath: string,
  title: string,
  clip: ClipRange | null = null,
): Promise<void> {
  const dir = jobDir(job.id)

  try {
    const fullTitle = title + clipLabel(clip)
    updateJob(job.id, { status: 'downloading', progress: clip ? 'Cutting your clip...' : 'Preparing video...', metadata: { title: fullTitle } })
    const videoPath = await prepareVideo(uploadedPath, dir, clip)
    fs.rmSync(uploadedPath, { force: true })

    await finishJob(job, dir, videoPath, { youtubeUrl: '', title: fullTitle, channel: 'Uploaded video' })
  } catch (err) {
    fs.rmSync(uploadedPath, { force: true })
    failJob(job, err)
  }
}

export { DATA_DIR, ensureDataDir }
