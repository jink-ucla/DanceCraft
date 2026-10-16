#!/usr/bin/env node
/**
 * DanceCraft: turn a local video (e.g. the host's own MP4) into a playable
 * bundled dance in public/dances, listed in public/dances/manifest.json.
 *
 * Usage:
 *   node scripts/add-local-dance.mjs <video> [--id wasil] [--title "Beat Wasil"]
 *        [--host Wasil] [--max-duration 90] [--python <path>]
 *        [--skip-extract] [--no-thumbnail]
 *   node scripts/add-local-dance.mjs --list
 *   node scripts/add-local-dance.mjs --remove <id>
 *
 * Or via npm:  npm run add-dance -- path/to/wasil.mp4 --id wasil --title "Beat Wasil" --host Wasil
 *
 * Zero dependencies, cross-platform. Pose extraction is done by
 * scripts/extract_poses.py (MediaPipe + OpenCV, no ffmpeg/yt-dlp needed for
 * local files). ffmpeg is only used, if present, to grab a thumbnail.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DANCES_DIR = path.join(ROOT, 'public', 'dances')
const MANIFEST_PATH = path.join(DANCES_DIR, 'manifest.json')
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts', 'extract_poses.py')
const MODEL_PATH = path.join(ROOT, 'scripts', 'pose_landmarker_heavy.task')
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v']
const RESERVED_IDS = ['manifest']
const DEFAULT_MAX_DURATION = 0 // 0 = no limit
// npm runs scripts from the package root; INIT_CWD is where the user typed the command.
const USER_CWD = process.env.INIT_CWD || process.cwd()

/** Repo-relative path with forward slashes, for messages. */
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

const USAGE = `Usage:
  npm run add-dance -- <video> [options]
  node scripts/add-local-dance.mjs <video> [options]

Turns a local dance video (mp4/webm/mov/m4v) into a playable bundled dance:
copies it to public/dances/<id>.<ext>, extracts poses to public/dances/<id>.json
and registers it in public/dances/manifest.json.

Options:
  --id <slug>            Dance id (default: slug of the file name)
  --title <text>         Card title (default: "Beat <host>" or the file name)
  --host <name>          Host / dancer name for "Beat the host" (e.g. Wasil)
  --max-duration <sec>   Warn if the video is longer than this (default: no limit)
  --python <path>        Python interpreter with mediapipe installed
  --skip-extract         Reuse an existing public/dances/<id>.json (no Python)
  --no-thumbnail         Don't try to grab a thumbnail with ffmpeg
  --list                 Print the current manifest and exit
  --remove <id>          Remove a dance from the manifest (files are kept)
  -h, --help             Show this help

Example:
  npm run add-dance -- ~/Videos/wasil.mp4 --id wasil --title "Beat Wasil" --host Wasil`

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['id', 'title', 'host', 'max-duration', 'python', 'remove'])
const BOOL_FLAGS = new Set(['list', 'skip-extract', 'no-thumbnail', 'help'])

function parseArgs(argv) {
  const opts = { positionals: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h') { opts.help = true; continue }
    if (arg === '--') { opts.positionals.push(...argv.slice(i + 1)); break }
    if (!arg.startsWith('--')) { opts.positionals.push(arg); continue }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) throw new CliError(`--${name} does not take a value`)
      opts[name] = true
    } else if (VALUE_FLAGS.has(name)) {
      let value
      if (eq !== -1) value = arg.slice(eq + 1)
      else {
        value = argv[i + 1]
        if (value === undefined || value.startsWith('--')) throw new CliError(`--${name} needs a value`)
        i++
      }
      opts[name] = value
    } else {
      throw new CliError(`Unknown option: ${arg}\n\n${USAGE}`)
    }
  }
  return opts
}

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

function titleFromFile(base) {
  const words = base.replace(/[_\-.]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'My Dance'
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { dances: [] }
  let data
  try {
    data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (err) {
    throw new CliError(`${rel(MANIFEST_PATH)} is not valid JSON (${err.message}).\nFix it by hand or replace it with: { "dances": [] }`)
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.dances)) {
    throw new CliError(`${rel(MANIFEST_PATH)} must look like { "dances": [ ... ] }`)
  }
  return data
}

function writeManifest(manifest) {
  fs.mkdirSync(DANCES_DIR, { recursive: true })
  const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.renameSync(tmp, MANIFEST_PATH)
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function publicFileExists(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return false
  return fs.existsSync(path.join(ROOT, 'public', ...url.slice(1).split('/')))
}

function listManifest() {
  const manifest = readManifest()
  const manifestRel = rel(MANIFEST_PATH)
  if (manifest.dances.length === 0) {
    console.log(`${manifestRel}: no bundled dances yet.\nAdd one with: npm run add-dance -- path/to/video.mp4 --id wasil --title "Beat Wasil" --host Wasil`)
    return
  }
  console.log(`${manifestRel}: ${manifest.dances.length} bundled dance(s)\n`)
  for (const d of manifest.dances) {
    const duration = typeof d.duration === 'number' ? formatClock(d.duration) : String(d.duration ?? '?')
    console.log(`- ${d.id}  "${d.title}"  ${duration}${d.hostName ? `  host: ${d.hostName}` : ''}`)
    console.log(`    poses: ${d.poseDataUrl}${publicFileExists(d.poseDataUrl) ? '' : '  (MISSING)'}`)
    if (d.videoUrl) console.log(`    video: ${d.videoUrl}${publicFileExists(d.videoUrl) ? '' : '  (MISSING)'}`)
    if (d.thumbnail) console.log(`    thumb: ${d.thumbnail}${publicFileExists(d.thumbnail) ? '' : '  (MISSING)'}`)
  }
}

function removeFromManifest(rawId) {
  const id = slugify(rawId)
  const manifest = readManifest()
  const entry = manifest.dances.find((d) => d && d.id === id)
  if (!entry) throw new CliError(`No dance with id "${id}" in the manifest. Run with --list to see ids.`)
  manifest.dances = manifest.dances.filter((d) => d !== entry)
  writeManifest(manifest)
  console.log(`Removed "${id}" from ${rel(MANIFEST_PATH)}.`)
  const files = [entry.poseDataUrl, entry.videoUrl, entry.thumbnail].filter(publicFileExists)
  if (files.length) console.log(`Files left in place (delete by hand if unwanted):\n${files.map((f) => `  public${f}`).join('\n')}`)
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function readDotEnvValue(key) {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return undefined
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  let value
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || m[1] !== key) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      v = v.slice(1, -1)
    } else {
      v = v.replace(/\s+#.*$/, '')
    }
    value = v // last assignment wins, like dotenv
  }
  return value || undefined
}

function looksLikePath(p) {
  return /[\\/]/.test(p)
}

function resolvePython(cliPython) {
  const explicit = [
    ['--python', cliPython],
    ['PYTHON_PATH env var', process.env.PYTHON_PATH],
    ['PYTHON_PATH in .env', readDotEnvValue('PYTHON_PATH')],
  ]
  for (const [source, raw] of explicit) {
    const value = raw?.trim()
    if (!value) continue
    if (!looksLikePath(value)) return { python: value, source }
    const base = source === '--python' ? USER_CWD : ROOT
    const resolved = path.resolve(base, value)
    if (!fs.existsSync(resolved)) {
      throw new CliError(`Python from ${source} not found: ${resolved}\nRun the setup first (Windows: powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1) or pass --python <path>.`)
    }
    return { python: resolved, source }
  }
  const venvCandidates = process.platform === 'win32'
    ? [path.join(ROOT, '.venv', 'Scripts', 'python.exe')]
    : [path.join(ROOT, '.venv', 'bin', 'python3'), path.join(ROOT, '.venv', 'bin', 'python')]
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) return { python: candidate, source: '.venv' }
  }
  return { python: process.platform === 'win32' ? 'python' : 'python3', source: 'PATH (no .venv found)' }
}

function modelMissingMessage() {
  const modelRel = rel(MODEL_PATH)
  return [
    `MediaPipe model not found: ${modelRel}`,
    'Download it (about 30 MB) with one of:',
    '',
    `  curl -L -o ${modelRel} ${MODEL_URL}`,
    '',
    `  powershell -NoProfile -Command "Invoke-WebRequest -Uri '${MODEL_URL}' -OutFile '${modelRel}'"`,
    '',
    'or run the Windows setup: powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1',
  ].join('\n')
}

function runExtraction(python, videoPath, outputPath, maxDuration) {
  const args = [EXTRACT_SCRIPT, videoPath, '--output', outputPath, '--max-duration', String(Math.ceil(maxDuration))]
  console.log(`\n> ${python} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`)
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new CliError(`Could not start Python ("${python}"): not found.\nInstall Python 3.11/3.12 and the pose deps (Windows: scripts/setup-windows.ps1), or pass --python <path>.`))
      } else {
        reject(new CliError(`Could not start Python ("${python}"): ${err.message}`))
      }
    })
    child.on('close', (code, signal) => {
      if (code === 0) { resolve(); return }
      const hints = [
        `Pose extraction failed (${signal ? `signal ${signal}` : `exit code ${code}`}).`,
      ]
      if (code === 9009) {
        hints.push('Windows could not find a real Python (the "python" command is probably the Microsoft Store alias).')
      }
      hints.push(
        'Common fixes:',
        '  - Use Python 3.11 or 3.12 (mediapipe wheels may not exist for newer versions).',
        '  - Install deps into the venv: .venv/Scripts/python.exe -m pip install mediapipe opencv-python-headless numpy',
        '    (macOS/Linux: .venv/bin/python3 -m pip install mediapipe opencv-python-headless numpy)',
        '  - Or just run: powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1',
        '  - If OpenCV cannot open the video, re-export it as H.264 MP4 (iPhone: Settings > Camera > Formats > Most Compatible).',
      )
      reject(new CliError(hints.join('\n'), typeof code === 'number' && code > 0 && code < 256 ? code : 1))
    })
  })
}

// ---------------------------------------------------------------------------
// Pose JSON inspection + thumbnail
// ---------------------------------------------------------------------------

function inspectPoseFile(jsonPath) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch (err) {
    throw new CliError(`Could not read pose data ${rel(jsonPath)}: ${err.message}`)
  }
  const keyframes = Array.isArray(data?.keyframes) ? data.keyframes : []
  if (keyframes.length === 0) throw new CliError(`${rel(jsonPath)} has no keyframes. Was a person visible in the video?`)
  let duration = Number(data.duration)
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = Number(keyframes[keyframes.length - 1]?.time) || 0
  }
  if (duration <= 0) throw new CliError(`Could not determine the dance duration from ${rel(jsonPath)}.`)

  // How often was the torso actually tracked? (shoulders + hips)
  const core = new Set(['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'])
  let tracked = 0
  for (const frame of keyframes) {
    const kps = Array.isArray(frame?.keypoints) ? frame.keypoints.filter((k) => core.has(k?.name)) : []
    const visible = kps.filter((k) => Number(k.score) >= 0.5).length
    if (kps.length > 0 && visible >= 3) tracked++
  }
  return { duration: Math.round(duration * 100) / 100, frames: keyframes.length, trackedRatio: tracked / keyframes.length }
}

function tryThumbnail(videoPath, thumbPath, duration) {
  const at = duration >= 4 ? '2' : '0'
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', at, '-i', videoPath,
    '-frames:v', '1', '-vf', 'scale=480:-2', thumbPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  if (result.error) return { ok: false, reason: result.error.code === 'ENOENT' ? 'ffmpeg not found on PATH' : result.error.message }
  if (result.status !== 0 || !fs.existsSync(thumbPath)) {
    return { ok: false, reason: (result.stderr?.toString() || `ffmpeg exited with ${result.status}`).trim().split(/\r?\n/)[0] }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function addDance(opts) {
  if (opts.positionals.length === 0) throw new CliError(`Missing <video> argument.\n\n${USAGE}`)
  if (opts.positionals.length > 1) {
    throw new CliError(`Expected one video path, got ${opts.positionals.length}: ${opts.positionals.join(' ')}\n(Quote paths and titles that contain spaces.)`)
  }

  const input = path.resolve(USER_CWD, opts.positionals[0])
  if (!fs.existsSync(input)) throw new CliError(`Video not found: ${input}`)
  if (!fs.statSync(input).isFile()) throw new CliError(`Not a file: ${input}`)
  const ext = path.extname(input).toLowerCase()
  if (!VIDEO_EXTS.includes(ext)) {
    throw new CliError(`Unsupported video type "${ext || '(none)'}". Use one of: ${VIDEO_EXTS.join(', ')}`)
  }

  const base = path.basename(input, path.extname(input))
  const id = slugify(opts.id ?? base)
  if (!id) throw new CliError(`Could not make an id from "${opts.id ?? base}". Pass --id with letters/numbers, e.g. --id wasil`)
  if (RESERVED_IDS.includes(id)) throw new CliError(`"${id}" is reserved. Pick another --id.`)
  if (opts.id !== undefined && id !== opts.id) console.log(`Using id "${id}" (from "${opts.id}").`)

  let maxDuration = DEFAULT_MAX_DURATION
  if (opts['max-duration'] !== undefined) {
    maxDuration = Number(opts['max-duration'])
    if (!Number.isFinite(maxDuration) || maxDuration < 0) throw new CliError(`--max-duration must be 0 (no limit) or a positive number of seconds, got "${opts['max-duration']}"`)
  }

  const manifest = readManifest()
  const existing = manifest.dances.find((d) => d && d.id === id)
  const hostName = (opts.host ?? existing?.hostName ?? '').trim() || undefined
  const title = (opts.title ?? existing?.title ?? '').trim() || (hostName ? `Beat ${hostName}` : titleFromFile(base))

  const videoDest = path.join(DANCES_DIR, `${id}${ext}`)
  const posesDest = path.join(DANCES_DIR, `${id}.json`)
  const thumbDest = path.join(DANCES_DIR, `${id}.jpg`)
  const skipExtract = Boolean(opts['skip-extract'])

  // Check prerequisites before touching anything.
  let python
  if (skipExtract) {
    if (!fs.existsSync(posesDest)) throw new CliError(`--skip-extract: ${rel(posesDest)} does not exist yet. Run without --skip-extract first.`)
  } else {
    if (!fs.existsSync(EXTRACT_SCRIPT)) throw new CliError(`Missing ${rel(EXTRACT_SCRIPT)}`)
    if (!fs.existsSync(MODEL_PATH)) throw new CliError(modelMissingMessage())
    python = resolvePython(opts.python)
  }

  console.log(`Adding dance "${title}" (id: ${id})${hostName ? `, host: ${hostName}` : ''}`)

  // 1) Copy the video into public/dances.
  fs.mkdirSync(DANCES_DIR, { recursive: true })
  const samePath = (a, b) => (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase())
  if (samePath(path.resolve(input), path.resolve(videoDest))) {
    console.log(`Video already in place: ${rel(videoDest)}`)
  } else {
    fs.copyFileSync(input, videoDest)
    console.log(`Copied video -> ${rel(videoDest)}`)
  }

  // 2) Extract poses.
  if (skipExtract) {
    console.log(`Skipping extraction, reusing ${rel(posesDest)}`)
  } else {
    console.log(`Using Python: ${python.python} (${python.source})`)
    console.log('Extracting poses with MediaPipe BlazePose Heavy (roughly 1-2x the video length on CPU)...')
    await runExtraction(python.python, videoDest, posesDest, maxDuration)
  }

  // 3) Inspect result.
  const info = inspectPoseFile(posesDest)
  console.log(`\nPose data: ${info.frames} frames, ${info.duration}s, body tracked in ${Math.round(info.trackedRatio * 100)}% of frames`)
  if (info.trackedRatio < 0.6) {
    console.warn('WARNING: the dancer was often not detected. Re-film with the full body in frame, good light and a plain background for better scoring.')
  }
  if (maxDuration > 0 && info.duration > maxDuration) {
    console.warn(`WARNING: the video is ${info.duration}s, longer than --max-duration ${maxDuration}s (extract_poses.py only enforces that limit for URL downloads).`)
    console.warn(`  Trim it, e.g.: ffmpeg -i "${input}" -t ${maxDuration} -c:v libx264 -c:a aac trimmed${ext === '.webm' ? '.mp4' : ext}`)
  }

  // 4) Thumbnail (optional, best effort).
  let thumbnail
  if (!opts['no-thumbnail']) {
    const thumb = tryThumbnail(videoDest, thumbDest, info.duration)
    if (thumb.ok) {
      thumbnail = `/dances/${id}.jpg`
      console.log(`Thumbnail -> ${rel(thumbDest)}`)
    } else {
      console.log(`(No thumbnail: ${thumb.reason})`)
    }
  }

  // 5) Upsert manifest entry (keeps any extra fields you added by hand).
  const entry = {
    ...(existing ?? {}),
    id,
    title,
    poseDataUrl: `/dances/${id}.json`,
    videoUrl: `/dances/${id}${ext}`,
    duration: info.duration,
  }
  if (thumbnail) entry.thumbnail = thumbnail
  else if (entry.thumbnail && !publicFileExists(entry.thumbnail)) delete entry.thumbnail
  if (hostName) entry.hostName = hostName
  else delete entry.hostName

  const fresh = readManifest() // re-read in case it changed during extraction
  const idx = fresh.dances.findIndex((d) => d && d.id === id)
  if (idx === -1) fresh.dances.push(entry)
  else fresh.dances[idx] = entry
  writeManifest(fresh)

  console.log(`\n${idx === -1 ? 'Added' : 'Updated'} "${id}" in ${rel(MANIFEST_PATH)}:`)
  console.log(JSON.stringify(entry, null, 2))
  console.log(`
Next steps:
  1. npm run dev            (frontend http://localhost:5173 + API http://localhost:3001)
  2. Open http://localhost:5173 - "${title}" appears in the dance list (${formatClock(info.duration)}).
  3. ${hostName ? `${hostName} plays it first` : 'The host plays it first'} with "I'm the host" checked to set the score to beat.
  4. Challengers enter their name and dance. See docs/dancecraft.md for the full demo flow.`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { console.log(USAGE); return }
  if (opts.list) { listManifest(); return }
  if (opts.remove !== undefined) { removeFromManifest(opts.remove); return }
  await addDance(opts)
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`\nError: ${err.message}`)
    process.exitCode = err.exitCode
  } else {
    console.error(err)
    process.exitCode = 1
  }
})
