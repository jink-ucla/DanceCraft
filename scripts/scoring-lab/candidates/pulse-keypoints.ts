/**
 * Baseline candidate "pulse-keypoints": faithful port of Codex's PulseJudge
 * (C:/Users/jink/groovy/experiments/pulse-party/core.mjs, see ./pulse-keypoints/core.ts).
 *
 * - Events (pulses / moves): for the I Need U fixture the precomputed analyze.py output
 *   tests/fixtures/scoring/ref-ineedu-15s.pulse-analysis.json ('events' + width/height; motion +
 *   audio-onset snapping) is used when the reference matches its frames exactly; any other
 *   reference (e.g. the looped 60 s scenario) gets motion-only events from the TypeScript port of
 *   analyze.py (./pulse-keypoints/analyze.ts, no audio).
 * - Reference: prepareReference() — pixel geometry (x * width, y * height; width/height from the
 *   analysis or options.referenceGeometry), canonicalize(), per-event velocity / bone change / focus.
 * - User: every recorded frame, in array order, is fed as judge.feed(time, canonicalize(pose))
 *   (null when nothing is detected or the torso is not tracked) — exactly what the prototype UI
 *   does per detector frame — then judge.advance(duration + 1).
 * - overallScore = points / maximum (PERFECT 100 / GOOD 60 / MISS 0 / TRACKING LOST 0 over a
 *   fixed maximum of 100 per event). No automatic mirror (the prototype has a manual Mirror
 *   checkbox, default off) and no latency compensation (+/-0.16 s window on the user's clock).
 *
 * Lab adaptations (no scoring change): frozen ../baseline/scoring imports (comparePoses,
 * compareMoveVelocity, checkPresence, extractJointAngles = src/scoring @ 7aebdba, the same
 * functions the prototype imports); rank = legacy computeRank (App.tsx applies it to overallScore);
 * section scores = mean event points per section (sections without events report the overall).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TimestampedPose } from '../baseline/scoring/dtw'
import { computeRank } from '../baseline/scoring/dtw'
import { comparePoses, compareMoveVelocity } from '../baseline/scoring/comparison'
import { checkPresence } from '../baseline/scoring/presence'
import { extractJointAngles } from '../baseline/scoring/angles'
import type { Kp, PosePx, PulseData, PulseEvent, PulseEventInput } from './pulse-keypoints/core'
import { PulseJudge, canonicalize, prepareReference } from './pulse-keypoints/core'
import { chartMotionOnly } from './pulse-keypoints/analyze'

export const name = 'pulse-keypoints (Codex PulseJudge port)'

/** The prototype feeds every detector frame (no detection -> null). */
export const recordPolicy = 'all'

const ANALYSIS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/scoring/ref-ineedu-15s.pulse-analysis.json')

interface Analysis {
  width: number
  height: number
  fps: number
  duration: number
  events: PulseEventInput[]
  frames: { time: number; keypoints: Kp[] }[]
}

let analysisCache: Analysis | null | undefined

function loadAnalysis(): Analysis | null {
  if (analysisCache === undefined) {
    try {
      analysisCache = JSON.parse(readFileSync(ANALYSIS_PATH, 'utf8')) as Analysis
    } catch {
      analysisCache = null
    }
  }
  return analysisCache
}

/** True when the reference is exactly the analysed timeline (same times and keypoints). */
function matchesAnalysis(reference: TimestampedPose[], a: Analysis): boolean {
  if (reference.length !== a.frames.length) return false
  for (let i = 0; i < reference.length; i++) {
    const r = reference[i]
    const f = a.frames[i]
    if (Math.abs(r.time - f.time) > 1e-9) return false
    const byName = new Map(r.pose.keypoints.map((k) => [k.name as string, k]))
    for (const k of f.keypoints) {
      const q = byName.get(k.name)
      if (!q || q.x !== k.x || q.y !== k.y || q.score !== k.score) return false
    }
  }
  return true
}

interface Geometry {
  width: number
  height: number
}

interface Options {
  referenceGeometry?: Geometry
  [key: string]: unknown
}

interface Prepared {
  events: PulseEvent[]
  duration: number
  source: string
}

const prepCache = new WeakMap<TimestampedPose[], Map<string, Prepared>>()

function prepare(reference: TimestampedPose[], geo: Geometry | undefined): Prepared {
  const key = geo ? `${geo.width}x${geo.height}` : 'none'
  let byGeo = prepCache.get(reference)
  if (!byGeo) {
    byGeo = new Map()
    prepCache.set(reference, byGeo)
  }
  const hit = byGeo.get(key)
  if (hit) return hit
  const frames = reference.map((f) => ({ time: f.time, keypoints: f.pose.keypoints.map((k) => ({ ...k, name: k.name as string })) }))
  const a = loadAnalysis()
  let data: PulseData
  let duration: number
  let source: string
  if (a && matchesAnalysis(reference, a)) {
    data = { width: a.width, height: a.height, frames, events: a.events }
    duration = a.duration
    source = 'precomputed analysis (motion + audio)'
  } else {
    const width = geo?.width ?? 1
    const height = geo?.height ?? 1
    const dts = frames.slice(1).map((f, i) => f.time - frames[i].time).filter((d) => d > 0).sort((x, y) => x - y)
    const fps = dts.length ? Math.round(1 / dts[Math.floor(dts.length / 2)]) : 30
    const events: PulseEventInput[] = chartMotionOnly(frames, width, height, fps).events.map((e) => ({ ...e }))
    data = { width, height, frames, events }
    duration = (frames[frames.length - 1]?.time ?? 0) + 1 / fps
    source = geo ? 'motion-only port (no audio)' : 'motion-only port (no audio, NO geometry: normalized coords)'
  }
  const prepared = { events: prepareReference(data, extractJointAngles).events, duration, source }
  byGeo.set(key, prepared)
  return prepared
}

export function score(reference: TimestampedPose[], user: TimestampedPose[], sectionDuration = 10, options?: Options) {
  const { events, duration, source } = prepare(reference, options?.referenceGeometry)
  const judge = new PulseJudge(events, { comparePoses, compareMoveVelocity, checkPresence })
  for (const f of user) judge.feed(f.time, canonicalize(f.pose as unknown as PosePx))
  judge.advance(duration + 1)
  const s = judge.summary()
  const overallScore = s.maximum ? s.points / s.maximum : 0

  const end = reference[reference.length - 1]?.time ?? duration
  const nSections = Math.max(1, Math.ceil(end / sectionDuration))
  const sectionScores = Array.from({ length: nSections }, (_, k) => {
    const startTime = k * sectionDuration
    const endTime = Math.min(startTime + sectionDuration, end)
    const inSection = judge.results.filter((r) => r.time >= startTime && (k === nSections - 1 || r.time < endTime))
    return { startTime, endTime, score: inSection.length ? inSection.reduce((n, r) => n + r.points, 0) / (inSection.length * 100) : overallScore }
  })
  return {
    overallScore,
    rank: computeRank(overallScore),
    sectionScores,
    points: s.points,
    maximum: s.maximum,
    ratings: `${s.ratings.PERFECT}/${s.ratings.GOOD}/${s.ratings.MISS}/${s.ratings['TRACKING LOST']}`,
    events: s.total,
    tracking: s.tracking,
    eventSource: source,
    results: judge.results.map((r) => ({ time: r.time, rating: r.rating, similarity: Math.round(r.similarity * 1000) / 1000, bestTime: r.bestTime })),
  }
}
