import type { KeyPose } from '../scoring/keyPoseDetection'

export interface DanceSettings {
  mirror: boolean
  customKeyPoses: KeyPose[] | null // null = use auto-detected
  tutorialUrl: string // YouTube tutorial video URL
}

const STORAGE_KEY_PREFIX = 'groovy_dance_settings_'

const DEFAULT_SETTINGS: DanceSettings = {
  mirror: false,
  customKeyPoses: null,
  tutorialUrl: '',
}

export function loadDanceSettings(danceId: string): DanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + danceId)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveDanceSettings(danceId: string, settings: DanceSettings): void {
  localStorage.setItem(STORAGE_KEY_PREFIX + danceId, JSON.stringify(settings))
}

/** Set just the mirror flag for one dance (keeps its other settings). */
export function setDanceMirror(danceId: string, mirror: boolean): void {
  saveDanceSettings(danceId, { ...loadDanceSettings(danceId), mirror })
}

// Mirror chosen in Add Dance before the dance exists: remembered per job and
// applied to "api-<id>" once the job reports the created dance id.
const PENDING_MIRROR_PREFIX = 'dancecraft_pending_mirror_'

export function setPendingMirror(jobId: string, mirror: boolean): void {
  localStorage.setItem(PENDING_MIRROR_PREFIX + jobId, mirror ? '1' : '0')
}

export function applyPendingMirror(jobId: string, apiDanceId: number | null | undefined): void {
  const pending = localStorage.getItem(PENDING_MIRROR_PREFIX + jobId)
  if (pending === null || apiDanceId === null || apiDanceId === undefined) return
  setDanceMirror(`api-${apiDanceId}`, pending === '1')
  localStorage.removeItem(PENDING_MIRROR_PREFIX + jobId)
}

export function extractYoutubeEmbedId(url: string): string | null {
  if (!url) return null
  const match = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}
