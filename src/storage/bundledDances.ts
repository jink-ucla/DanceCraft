import type { DanceInfo } from '../components/HomeScreen'

/**
 * Bundled ("local") dances live in public/dances and are listed in
 * public/dances/manifest.json, which `npm run add-dance` maintains:
 *
 *   { "dances": [{ "id", "title", "poseDataUrl", "videoUrl"?, "duration", "thumbnail"?, "hostName"? }] }
 *
 * `duration` may be seconds (number) or an "m:ss" string.
 */
export const BUNDLED_MANIFEST_URL = '/dances/manifest.json'

/** DanceInfo plus the optional host name recorded in the manifest. */
export interface BundledDanceInfo extends DanceInfo {
  source: 'bundled'
  /** Who recorded the reference dance (the "Beat <host>" target). */
  hostName?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined
}

/** Seconds -> "m:ss" (same format as App's formatDuration). */
export function formatBundledDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Normalise a manifest duration (seconds number, numeric string, or "m:ss")
 * to "m:ss". Returns null when the value is unusable.
 */
export function normalizeBundledDuration(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? formatBundledDuration(value) : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const clock = /^(\d+):([0-5]\d)$/.exec(trimmed)
  if (clock) return formatBundledDuration(Number(clock[1]) * 60 + Number(clock[2]))
  if (/^\d+(\.\d+)?$/.test(trimmed)) return formatBundledDuration(Number(trimmed))
  return null
}

/** Validate one manifest entry; returns null for anything unusable. */
export function parseBundledDance(raw: unknown): BundledDanceInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  if (!isNonEmptyString(entry.id) || !isNonEmptyString(entry.title) || !isNonEmptyString(entry.poseDataUrl)) {
    return null
  }
  const duration = normalizeBundledDuration(entry.duration)
  if (duration === null) return null

  const dance: BundledDanceInfo = {
    id: entry.id.trim(),
    title: entry.title.trim(),
    poseDataUrl: entry.poseDataUrl.trim(),
    duration,
    source: 'bundled',
  }
  const videoUrl = optionalString(entry.videoUrl)
  if (videoUrl) dance.videoUrl = videoUrl
  const thumbnail = optionalString(entry.thumbnail)
  if (thumbnail) dance.thumbnail = thumbnail
  const hostName = optionalString(entry.hostName)
  if (hostName) dance.hostName = hostName
  return dance
}

/** Parse a whole manifest object; invalid and duplicate-id entries are skipped. */
export function parseBundledManifest(data: unknown): BundledDanceInfo[] {
  if (!data || typeof data !== 'object') return []
  const list = (data as { dances?: unknown }).dances
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const dances: BundledDanceInfo[] = []
  for (const raw of list) {
    const dance = parseBundledDance(raw)
    if (!dance || seen.has(dance.id)) continue
    seen.add(dance.id)
    dances.push(dance)
  }
  return dances
}

/**
 * Load bundled dances from public/dances/manifest.json.
 * Never throws: a missing manifest (404), Vite's index.html fallback, bad
 * JSON, or a network/abort error all resolve to [].
 *
 * The default fetchImpl is wrapped so `fetch` is never invoked unbound
 * (an unbound window.fetch throws "Illegal invocation").
 */
export async function loadBundledDances(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  init?: { signal?: AbortSignal },
): Promise<BundledDanceInfo[]> {
  try {
    const res = await fetchImpl(BUNDLED_MANIFEST_URL, { cache: 'no-store', signal: init?.signal })
    if (!res.ok) return []
    const contentType = res.headers?.get?.('content-type') ?? ''
    if (contentType.includes('text/html')) return []
    const text = await res.text()
    if (text.trimStart().startsWith('<')) return []
    return parseBundledManifest(JSON.parse(text))
  } catch {
    return []
  }
}
