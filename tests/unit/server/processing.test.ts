import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { isValidYoutubeUrl, resolvePythonPath, resolveYtDlpPath, resolveFfmpegPath, findWingetFfmpeg } from '../../../server/processing.ts'

describe('isValidYoutubeUrl', () => {
  it('accepts standard youtube.com watch URLs', () => {
    expect(isValidYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts youtube.com without www', () => {
    expect(isValidYoutubeUrl('https://youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts youtu.be short URLs', () => {
    expect(isValidYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts mobile youtube URLs', () => {
    expect(isValidYoutubeUrl('https://m.youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts YouTube Shorts URLs', () => {
    expect(isValidYoutubeUrl('https://www.youtube.com/shorts/sSM9J5YH_60')).toBe(true)
    expect(isValidYoutubeUrl('https://youtube.com/shorts/abc123def45')).toBe(true)
  })

  it('rejects non-YouTube URLs', () => {
    expect(isValidYoutubeUrl('https://vimeo.com/123')).toBe(false)
    expect(isValidYoutubeUrl('https://example.com')).toBe(false)
  })

  it('rejects non-URL strings', () => {
    expect(isValidYoutubeUrl('not-a-url')).toBe(false)
    expect(isValidYoutubeUrl('')).toBe(false)
  })
})

describe('resolvePythonPath', () => {
  const cwd = path.resolve('/repo')

  it('defaults to the Windows venv interpreter on win32', () => {
    expect(resolvePythonPath({}, 'win32', cwd)).toBe(path.join(cwd, '.venv', 'Scripts', 'python.exe'))
  })

  it('defaults to .venv/bin/python3 elsewhere', () => {
    expect(resolvePythonPath({}, 'darwin', cwd)).toBe(path.join(cwd, '.venv', 'bin', 'python3'))
    expect(resolvePythonPath({}, 'linux', cwd)).toBe(path.join(cwd, '.venv', 'bin', 'python3'))
  })

  it('prefers PYTHON_PATH when set', () => {
    const abs = path.resolve('/opt/py/bin/python3')
    expect(resolvePythonPath({ PYTHON_PATH: abs }, 'win32', cwd)).toBe(abs)
    expect(resolvePythonPath({ PYTHON_PATH: 'python' }, 'linux', cwd)).toBe('python')
  })

  it('resolves a relative PYTHON_PATH against cwd', () => {
    expect(resolvePythonPath({ PYTHON_PATH: '.venv/Scripts/python.exe' }, 'win32', cwd))
      .toBe(path.resolve(cwd, '.venv/Scripts/python.exe'))
  })

  it('ignores a blank PYTHON_PATH', () => {
    expect(resolvePythonPath({ PYTHON_PATH: '  ' }, 'win32', cwd)).toBe(path.join(cwd, '.venv', 'Scripts', 'python.exe'))
  })
})

describe('resolveYtDlpPath', () => {
  it('prefers YTDLP_PATH', () => {
    expect(resolveYtDlpPath({ YTDLP_PATH: 'C:/tools/yt-dlp.exe' }, 'win32', 'C:/nowhere')).toBe('C:/tools/yt-dlp.exe')
  })

  it('falls back to PATH when the venv has no yt-dlp', () => {
    expect(resolveYtDlpPath({}, 'win32', path.join(os.tmpdir(), 'no-such-project'))).toBe('yt-dlp')
  })

  it('uses the project venv yt-dlp when present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'))
    const exe = path.join(root, '.venv', 'bin', 'yt-dlp')
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    fs.writeFileSync(exe, '')
    expect(resolveYtDlpPath({}, 'linux', root)).toBe(exe)
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('resolveFfmpegPath / findWingetFfmpeg', () => {
  it('prefers FFMPEG_PATH', () => {
    expect(resolveFfmpegPath({ FFMPEG_PATH: 'D:/ffmpeg/bin/ffmpeg.exe' }, 'win32')).toBe('D:/ffmpeg/bin/ffmpeg.exe')
  })

  it('uses PATH ffmpeg off Windows', () => {
    expect(resolveFfmpegPath({}, 'linux')).toBe('ffmpeg')
  })

  it('finds ffmpeg.exe inside a winget package folder', () => {
    const packages = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-'))
    const bin = path.join(packages, 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-9.0.2-full_build', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'ffmpeg.exe'), '')
    fs.mkdirSync(path.join(packages, 'Some.OtherTool'))
    expect(findWingetFfmpeg(packages)).toBe(path.join(bin, 'ffmpeg.exe'))
    fs.rmSync(packages, { recursive: true, force: true })
  })

  it('returns null when no winget ffmpeg exists', () => {
    expect(findWingetFfmpeg(path.join(os.tmpdir(), 'definitely-missing-dir'))).toBeNull()
  })
})
