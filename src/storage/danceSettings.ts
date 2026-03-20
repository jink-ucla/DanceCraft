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

export function extractYoutubeEmbedId(url: string): string | null {
  if (!url) return null
  const match = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}
