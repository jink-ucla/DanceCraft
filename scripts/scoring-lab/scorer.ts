/**
 * Scoring lab — scorer module interface and loader.
 *
 * Production signature (what App.tsx / ReplayMode will call):
 *   computePostDanceScore(reference, user, sectionDuration = 10, options?: { referenceGeometry?: { width, height } })
 * `reference` coords are 0-1 normalized per axis by the reference video's width/height
 * (referenceGeometry); `user` coords are webcam pixels.
 *
 * A candidate scorer is any TS/JS module that exports ONE of (checked in this order):
 *   1. `score(reference, user, sectionDuration?, options?)`            (named; lab-aware)
 *   2. `export default function (reference, user, sectionDuration?, options?)` (lab-aware)
 *   3. `export default { score, ... }`                                  (lab-aware)
 *   4. `computePostDanceScore(reference, user, sectionDuration?, options?)` (drop-in)
 * The runner passes `options = { referenceGeometry }` for every scenario (unless --no-geometry).
 * Lab-aware forms 1-3 additionally get `options.lab` (ScoreContext: scenario id, every detector
 * frame, ...). `options.lab` does NOT exist in the app: use it for diagnostics only, never to
 * compute the score. Form 4 gets exactly `{ referenceGeometry }` (what the app will pass).
 * Optional named exports (or fields of the default object):
 *   - `name: string`                      label printed in reports
 *   - `recordPolicy: 'presence' | 'detected' | 'all' | (frame) => TimestampedPose | null`
 *     how DanceMode would record user poses for this candidate (default 'presence' =
 *     DanceMode @ 7aebdba: only frames passing checkPresence)
 *   - `liveDeps: Partial<LiveDeps>`       replacements for the --live DanceMode replica
 *   - `simulateLive: LiveSimulator`       full replacement for the --live replica
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ReferenceGeometry, TimestampedPose } from './data'
import { REPO_ROOT } from './data'
import type { DetectorFrame, RecordPolicy } from './synth'
import { RECORD_POLICIES } from './synth'
import type { LiveDeps, LiveSimulator } from './live'
import { DEFAULT_LIVE_DEPS } from './live'

export type Rank = 'S' | 'A' | 'B' | 'C'

/** DTWResult-like: what a scorer must return. Extra fields are kept and dumped to --json. */
export interface ScoreResultLike {
  /** 0-1 */
  overallScore: number
  rank: Rank | string
  sectionScores?: { startTime: number; endTime: number; score: number }[]
  bodyPartScores?: { name: string; score: number }[]
  alignment?: [number, number][]
  [extra: string]: unknown
}

/**
 * Lab-only extra information (options.lab, forms 1-3). Not available in the app — a production
 * scorer must not depend on it.
 */
export interface ScoreContext {
  scenarioId: string
  /** Reference video duration in seconds */
  danceDuration: number
  /** Every DanceMode loop iteration, incl. frames with no detection (pose null) */
  frames: DetectorFrame[]
  /** Policy used to build `user` from `frames` ('custom' for function policies) */
  recordPolicy: string
  /** True for real recordings (frames outside the recorded span are unknown -> null) */
  real: boolean
}

/** 4th scorer argument. `referenceGeometry` is what the app passes; `lab` is lab-only. */
export interface ScoreOptions {
  /** Reference video pixel size; reference coords are x / width, y / height (0-1) */
  referenceGeometry?: ReferenceGeometry
  /** Lab-only diagnostics context (forms 1-3 only; undefined in the app) */
  lab?: ScoreContext
}

export type ScoreFn = (
  reference: TimestampedPose[],
  user: TimestampedPose[],
  sectionDuration?: number,
  options?: ScoreOptions,
) => ScoreResultLike

export interface LoadedScorer {
  name: string
  path: string
  /** Which export was used: 'score' | 'default' | 'default.score' | 'computePostDanceScore' */
  kind: string
  score: ScoreFn
  recordPolicy: RecordPolicy
  liveDeps: LiveDeps
  simulateLive?: LiveSimulator
}

export const DEFAULT_SCORER_PATH = 'src/scoring/dtw.ts'

/** Lab-relative directory of candidate scorers (scripts/scoring-lab/candidates). */
export const CANDIDATES_DIR = 'scripts/scoring-lab/candidates'

/**
 * Short aliases accepted by --scorer:
 *   current  -> src/scoring/dtw.ts (whatever computePostDanceScore is now)
 *   baseline | legacy -> scripts/scoring-lab/baseline/scorer.ts (frozen BEFORE code)
 *   <name>   -> scripts/scoring-lab/candidates/<name>.ts or candidates/<name>/{index,scorer,candidate,<name>}.ts
 */
export function resolveScorerPath(spec: string): string {
  if (spec === 'current') return DEFAULT_SCORER_PATH
  if (spec === 'baseline' || spec === 'legacy') return 'scripts/scoring-lab/baseline/scorer.ts'
  const direct = [resolve(process.cwd(), spec), resolve(REPO_ROOT, spec)]
  if (direct.some((p) => existsSync(p) && statSync(p).isFile())) return spec
  if (!/[\\/]/.test(spec)) {
    for (const rel of [`${spec}.ts`, ...CANDIDATE_ENTRY_FILES.map((f) => `${spec}/${f}`), `${spec}/${spec}.ts`]) {
      const p = `${CANDIDATES_DIR}/${rel}`
      if (existsSync(resolve(REPO_ROOT, p))) return p
    }
  }
  return spec
}

/** Entry files looked up inside a candidate directory (then `<dir>/<dir>.ts`). */
export const CANDIDATE_ENTRY_FILES = ['index.ts', 'scorer.ts', 'candidate.ts']

/**
 * Every candidate module under scripts/scoring-lab/candidates: `<name>.ts` files and
 * `<name>/{index,scorer,candidate,<name>}.ts`. Files whose name contains `.test.`, `.spec.` or starts with
 * `_` are skipped, and so are directories without an entry file (e.g. unfinished work).
 */
export function listCandidates(): string[] {
  const dir = resolve(REPO_ROOT, CANDIDATES_DIR)
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue
    const abs = resolve(dir, entry)
    const st = statSync(abs)
    if (st.isFile()) {
      if (/\.(ts|mts|js|mjs)$/.test(entry) && !/\.(test|spec|d)\./.test(entry)) out.push(`${CANDIDATES_DIR}/${entry}`)
    } else if (st.isDirectory()) {
      const main = [...CANDIDATE_ENTRY_FILES, `${entry}.ts`].find((f) => existsSync(resolve(abs, f)))
      if (main) out.push(`${CANDIDATES_DIR}/${entry}/${main}`)
    }
  }
  return out
}

type AnyFn = (...args: unknown[]) => unknown

function isFn(v: unknown): v is AnyFn {
  return typeof v === 'function'
}

export async function loadScorer(spec = DEFAULT_SCORER_PATH): Promise<LoadedScorer> {
  const path = resolveScorerPath(spec)
  const fromCwd = resolve(process.cwd(), path)
  const abs = existsSync(fromCwd) ? fromCwd : resolve(REPO_ROOT, path)
  if (!existsSync(abs)) throw new Error(`Scorer module not found: ${path}`)
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>
  const def = mod.default as Record<string, unknown> | AnyFn | undefined
  const defObj = def && !isFn(def) && typeof def === 'object' ? def : undefined
  const pick = <T>(key: string): T | undefined => (mod[key] ?? defObj?.[key]) as T | undefined

  let score: ScoreFn
  let kind: string
  if (isFn(mod.score)) {
    score = mod.score as ScoreFn
    kind = 'score'
  } else if (isFn(def)) {
    score = def as unknown as ScoreFn
    kind = 'default'
  } else if (defObj && isFn(defObj.score)) {
    score = defObj.score as ScoreFn
    kind = 'default.score'
  } else if (isFn(mod.computePostDanceScore)) {
    const fn = mod.computePostDanceScore as (
      r: TimestampedPose[], u: TimestampedPose[], s?: number, o?: { referenceGeometry?: ReferenceGeometry },
    ) => ScoreResultLike
    // Drop-in: call like the app will (no lab context; legacy implementations ignore the 4th arg)
    score = (r, u, s, o) => (o?.referenceGeometry ? fn(r, u, s, { referenceGeometry: o.referenceGeometry }) : fn(r, u, s))
    kind = 'computePostDanceScore'
  } else {
    throw new Error(`Scorer module ${path} exports neither score(), a default function/object, nor computePostDanceScore()`)
  }

  const recordPolicy = pick<RecordPolicy>('recordPolicy') ?? 'presence'
  if (typeof recordPolicy !== 'function' && !RECORD_POLICIES.includes(recordPolicy)) {
    throw new Error(`Invalid recordPolicy '${String(recordPolicy)}' in ${path}`)
  }
  const liveOverrides = pick<Partial<LiveDeps>>('liveDeps') ?? {}
  return {
    name: pick<string>('name') ?? `${path}#${kind}`,
    path,
    kind,
    score,
    recordPolicy,
    liveDeps: { ...DEFAULT_LIVE_DEPS, ...liveOverrides },
    simulateLive: pick<LiveSimulator>('simulateLive'),
  }
}
