/**
 * Scoring lab — evaluation, sweep checks, perf timing, live simulation and formatting.
 * Programmatic API (usable from vitest): buildScenarios() + evaluateAll() + checkSweeps().
 */
import type { LoadedScorer, ScoreResultLike } from './scorer'
import type { Scenario, SweepName } from './scenarios'
import { FREE_LATENCY_S, SWEEPS, SWEEP_DESCRIPTIONS, userPosesFor } from './scenarios'
import type { RecordPolicy } from './synth'
import { recordPolicyName } from './synth'
import type { Difficulty, LiveResult } from './live'
import { DIFFICULTIES, simulateDanceModeLive } from './live'
import { summarizeSession, timelineDuration } from './data'

export const PERF_BUDGET_MS = 1500

export interface ScenarioResult {
  id: string
  group: string
  description: string
  target?: { min?: number; max?: number }
  ranks?: string[]
  reportOnly: boolean
  sweep?: { name: SweepName; value: number }
  /** Recorded user frames passed to the scorer */
  userFrames: number
  /** Detector frames (DanceMode loop iterations) */
  detectorFrames: number
  userStart: number
  userEnd: number
  /** overallScore * 100 */
  score: number
  rank: string
  /** null = no target */
  pass: boolean | null
  /** null = no rank expectation */
  rankOk: boolean | null
  ms: number
  /** section scores * 100 */
  sections: number[]
  /** body part scores * 100 keyed by name */
  bodyParts: Record<string, number>
  /** Non-standard result fields (alignment omitted) */
  extra: Record<string, unknown>
  error?: string
}

export interface EvaluateOptions {
  /** Override the scorer's record policy */
  recordPolicy?: RecordPolicy
  sectionDuration?: number
  /**
   * Pass options.referenceGeometry (the scenario's reference video size) to the scorer.
   * Default true — the app will always know it (pose metadata or the <video>'s videoWidth/Height).
   * false = simulate a scorer call without geometry (--no-geometry).
   */
  passGeometry?: boolean
}

const STANDARD_FIELDS = new Set(['overallScore', 'rank', 'sectionScores', 'bodyPartScores', 'alignment'])

export function inTarget(score: number, target?: { min?: number; max?: number }): boolean | null {
  if (!target) return null
  if (!Number.isFinite(score)) return false
  if (target.min !== undefined && score < target.min) return false
  if (target.max !== undefined && score > target.max) return false
  return true
}

export function formatTarget(target?: { min?: number; max?: number }): string {
  if (!target) return '-'
  if (target.min !== undefined && target.max !== undefined) return `${target.min}-${target.max}`
  if (target.min !== undefined) return `>=${target.min}`
  if (target.max !== undefined) return `<=${target.max}`
  return '-'
}

export function evaluateScenario(scorer: LoadedScorer, scenario: Scenario, opts: EvaluateOptions = {}): ScenarioResult {
  const policy = opts.recordPolicy ?? scorer.recordPolicy
  const user = userPosesFor(scenario, policy)
  const summary = summarizeSession(user)
  const base = {
    id: scenario.id,
    group: scenario.group,
    description: scenario.description,
    target: scenario.target,
    ranks: scenario.ranks,
    reportOnly: !!scenario.reportOnly,
    sweep: scenario.sweep,
    userFrames: user.length,
    detectorFrames: scenario.frames.length,
    userStart: summary.start,
    userEnd: summary.end,
  }
  let result: ScoreResultLike
  const t0 = performance.now()
  try {
    result = scorer.score(scenario.reference, user, opts.sectionDuration, {
      referenceGeometry: opts.passGeometry === false ? undefined : { ...scenario.referenceGeometry },
      lab: {
        scenarioId: scenario.id,
        danceDuration: timelineDuration(scenario.timeline),
        frames: scenario.frames,
        recordPolicy: recordPolicyName(policy),
        real: !!scenario.real,
      },
    })
  } catch (err) {
    return {
      ...base, score: NaN, rank: 'ERR', pass: scenario.reportOnly ? null : false, rankOk: null,
      ms: performance.now() - t0, sections: [], bodyParts: {}, extra: {}, error: (err as Error).stack ?? String(err),
    }
  }
  const ms = performance.now() - t0
  const score = result.overallScore * 100
  const rank = String(result.rank)
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(result)) if (!STANDARD_FIELDS.has(k)) extra[k] = v
  return {
    ...base,
    score,
    rank,
    pass: scenario.reportOnly ? null : inTarget(score, scenario.target),
    rankOk: scenario.reportOnly || !scenario.ranks ? null : (scenario.ranks as string[]).includes(rank),
    ms,
    sections: (result.sectionScores ?? []).map((s) => s.score * 100),
    bodyParts: Object.fromEntries((result.bodyPartScores ?? []).map((b) => [b.name, b.score * 100])),
    extra,
  }
}

export function evaluateAll(scorer: LoadedScorer, scenarios: Scenario[], opts: EvaluateOptions = {}): ScenarioResult[] {
  return scenarios.filter((s) => !s.perf).map((s) => evaluateScenario(scorer, s, opts))
}

// ---------------------------------------------------------------------------
// Sweep checks
// ---------------------------------------------------------------------------

export interface SweepCheckItem {
  label: string
  pass: boolean
  detail: string
}

export interface SweepCheck {
  name: SweepName
  description: string
  values: number[]
  scores: number[]
  checks: SweepCheckItem[]
}

/** Tolerance (score points) for "non-increasing" checks. */
export const MONOTONE_TOLERANCE = 1
/** Minimum drop (points) per step for "strictly decreasing" checks. */
export const STRICT_MIN_DROP = 0.1
/**
 * Lag sweep "progressive" check (timing policy: timing error beyond the free latency costs points
 * progressively, no cliff): the drop between adjacent lag points may not exceed this many points
 * per 0.5 s of added lag (0.25 -> 0.5 s may drop <= 15, 0.5 -> 1.0 <= 30, 1.5 -> 3.0 <= 90).
 */
export const LAG_MAX_DROP_PER_HALF_SECOND = 30

export function checkSweeps(results: ScenarioResult[]): SweepCheck[] {
  const out: SweepCheck[] = []
  for (const name of Object.keys(SWEEPS) as SweepName[]) {
    const pts = results.filter((r) => r.sweep?.name === name).sort((a, b) => a.sweep!.value - b.sweep!.value)
    if (pts.length < 2) continue
    const values = pts.map((p) => p.sweep!.value)
    const scores = pts.map((p) => p.score)
    const diffs = scores.slice(1).map((s, i) => s - scores[i]) // next - prev
    const checks: SweepCheckItem[] = []
    if (name === 'lag') {
      // Non-increasing with lag beyond the free latency compensation (all steps ending above it)
      const beyond = diffs.filter((_, i) => values[i + 1] > FREE_LATENCY_S)
      const worstRise = beyond.length ? Math.max(...beyond) : 0
      checks.push({
        label: `non-increasing beyond ${FREE_LATENCY_S} s (tol ${MONOTONE_TOLERANCE})`,
        pass: worstRise <= MONOTONE_TOLERANCE,
        detail: `max rise ${worstRise.toFixed(1)}`,
      })
      const rates = diffs.map((d, i) => -d / ((values[i + 1] - values[i]) / 0.5))
      const worst = Math.max(...rates)
      const at = rates.indexOf(worst)
      checks.push({
        label: `progressive (drop <= ${LAG_MAX_DROP_PER_HALF_SECOND} per 0.5 s of lag)`,
        pass: worst <= LAG_MAX_DROP_PER_HALF_SECOND,
        detail: `max ${worst.toFixed(1)} per 0.5 s (${values[at]} -> ${values[at + 1]} s)`,
      })
    } else if (name === 'jitter') {
      const worstRise = Math.max(...diffs)
      checks.push({
        label: `non-increasing (tol ${MONOTONE_TOLERANCE})`,
        pass: worstRise <= MONOTONE_TOLERANCE,
        detail: `max rise ${worstRise.toFixed(1)}`,
      })
    } else {
      const smallestDrop = Math.min(...diffs.map((d) => -d))
      checks.push({
        label: `strictly decreasing (drop >= ${STRICT_MIN_DROP}/step)`,
        pass: smallestDrop >= STRICT_MIN_DROP,
        detail: `min step drop ${smallestDrop.toFixed(1)}`,
      })
    }
    out.push({ name, description: SWEEP_DESCRIPTIONS[name], values, scores, checks })
  }
  return out
}

// ---------------------------------------------------------------------------
// Perf
// ---------------------------------------------------------------------------

export interface PerfResult {
  id: string
  refFrames: number
  userFrames: number
  firstMs: number
  medianMs: number
  runs: number[]
  budgetMs: number
  pass: boolean
  score: number
  rank: string
  error?: string
}

export function runPerf(scorer: LoadedScorer, scenario: Scenario, opts: EvaluateOptions = {}, repeats = 3): PerfResult {
  const runs: number[] = []
  let first: ScenarioResult | null = null
  for (let i = 0; i < repeats; i++) {
    const r = evaluateScenario(scorer, scenario, opts)
    if (!first) first = r
    runs.push(r.ms)
    if (r.error) break
  }
  const sorted = [...runs].sort((a, b) => a - b)
  const medianMs = sorted[Math.floor(sorted.length / 2)]
  return {
    id: scenario.id,
    refFrames: scenario.reference.length,
    userFrames: first!.userFrames,
    firstMs: runs[0],
    medianMs,
    runs,
    budgetMs: PERF_BUDGET_MS,
    pass: !first!.error && Math.max(runs[0], medianMs) < PERF_BUDGET_MS,
    score: first!.score,
    rank: first!.rank,
    error: first!.error,
  }
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface LiveRow {
  id: string
  results: Record<Difficulty, LiveResult>
}

export function runLive(scorer: LoadedScorer, scenarios: Scenario[]): LiveRow[] {
  return scenarios.filter((s) => !s.perf).map((s) => {
    const results = {} as Record<Difficulty, LiveResult>
    for (const difficulty of DIFFICULTIES) {
      const input = { timeline: s.timeline, frames: s.frames, difficulty }
      results[difficulty] = scorer.simulateLive
        ? scorer.simulateLive(input)
        : simulateDanceModeLive(input, scorer.liveDeps)
    }
    return { id: s.id, results }
  })
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Width of the scenario id column in all tables. */
export const ID_WIDTH = 24

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function lpad(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'NaN'
}

function fmtExtra(v: unknown): string {
  if (typeof v === 'number') return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toFixed(3)
  if (v === undefined) return '-'
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Value of a (possibly dotted) extra field, e.g. 'coverage' or 'diagnostics.stillness'. */
export function extraField(r: ScenarioResult, path: string): unknown {
  let v: unknown = r.extra
  for (const key of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[key]
  }
  return v
}

export function formatResultsTable(results: ScenarioResult[], extraFields: string[] = []): string {
  const lines: string[] = []
  const header =
    pad('scenario', ID_WIDTH) + lpad('frames', 7) + lpad('span(s)', 13) + lpad('score', 7) + lpad('rank', 5) +
    lpad('target', 8) + lpad('ranks', 6) + lpad('result', 8) + lpad('rank?', 6) + lpad('ms', 6) +
    lpad('arms', 6) + lpad('legs', 6) + extraFields.map((f) => lpad(f, Math.max(8, f.length + 1))).join('') + '  sections'
  lines.push(header)
  lines.push('-'.repeat(header.length + 6))
  for (const r of results) {
    const result = r.error ? 'ERROR' : r.pass === null ? 'report' : r.pass ? 'PASS' : 'FAIL'
    const rankCol = r.rankOk === null ? '-' : r.rankOk ? 'ok' : 'X'
    const span = r.userFrames > 0 ? `${r.userStart.toFixed(1)}-${r.userEnd.toFixed(1)}` : '-'
    const parts = r.bodyParts
    lines.push(
      pad(r.id, ID_WIDTH) + lpad(String(r.userFrames), 7) + lpad(span, 13) + lpad(fmt(r.score), 7) + lpad(r.rank, 5) +
      lpad(formatTarget(r.target), 8) + lpad(r.ranks ? r.ranks.join('/') : '-', 6) + lpad(result, 8) +
      lpad(rankCol, 6) + lpad(fmt(r.ms, 0), 6) +
      lpad(parts.Arms !== undefined ? fmt(parts.Arms, 0) : '-', 6) +
      lpad(parts.Legs !== undefined ? fmt(parts.Legs, 0) : '-', 6) +
      extraFields.map((f) => lpad(fmtExtra(extraField(r, f)), Math.max(8, f.length + 1))).join('') +
      '  ' + r.sections.map((s) => fmt(s, 0)).join('/'),
    )
  }
  return lines.join('\n')
}

export interface Summary {
  targetPass: number
  targetTotal: number
  rankOk: number
  rankTotal: number
  failed: string[]
  rankFailed: string[]
}

export function summarize(results: ScenarioResult[]): Summary {
  const withTarget = results.filter((r) => r.pass !== null)
  const withRank = results.filter((r) => r.rankOk !== null)
  return {
    targetPass: withTarget.filter((r) => r.pass).length,
    targetTotal: withTarget.length,
    rankOk: withRank.filter((r) => r.rankOk).length,
    rankTotal: withRank.length,
    failed: withTarget.filter((r) => !r.pass).map((r) => r.id),
    rankFailed: withRank.filter((r) => !r.rankOk).map((r) => r.id),
  }
}

export function formatSweeps(sweeps: SweepCheck[]): string {
  const lines: string[] = []
  for (const s of sweeps) {
    const pts = s.values.map((v, i) => `${v} -> ${fmt(s.scores[i])}`).join(' | ')
    lines.push(`${pad(s.name, 7)} [${s.description}]`)
    lines.push(`        ${pts}`)
    for (const c of s.checks) lines.push(`        ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}: ${c.detail}`)
  }
  return lines.join('\n')
}

export function formatPerf(p: PerfResult): string {
  return `${p.id}: ref ${p.refFrames} frames, user ${p.userFrames} frames -> first ${fmt(p.firstMs, 0)} ms, ` +
    `median ${fmt(p.medianMs, 0)} ms of ${p.runs.length} (budget < ${p.budgetMs} ms) ${p.pass ? 'PASS' : 'FAIL'}; ` +
    `score ${fmt(p.score)} ${p.rank}${p.error ? ` ERROR ${p.error.split('\n')[0]}` : ''}`
}

export function formatLive(rows: LiveRow[]): string {
  const lines: string[] = []
  const total = rows[0] ? rows[0].results.normal.total : 0
  lines.push(`key poses per run: ${total} (P/G/M = perfect/good/miss+unjudged; hit% = (P+G)/total; pts = DanceMode points)`)
  const header = pad('scenario', ID_WIDTH) + DIFFICULTIES.map((d) => lpad(`${d} P/G/M`, 14) + lpad('hit%', 6) + lpad('pts', 6)).join('')
  lines.push(header)
  lines.push('-'.repeat(header.length))
  for (const row of rows) {
    let line = pad(row.id, ID_WIDTH)
    for (const d of DIFFICULTIES) {
      const r = row.results[d]
      line += lpad(`${r.perfect}/${r.good}/${r.miss + r.unjudged}`, 14) + lpad(fmt(r.hitRate * 100, 0), 6) + lpad(String(r.points), 6)
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Cross-scorer comparison
// ---------------------------------------------------------------------------

export interface ComparisonColumn {
  /** Short column label (e.g. 'legacy', 'research-window') */
  label: string
  /** One result list per seed, same scenario order */
  perSeed: ScenarioResult[][]
}

/**
 * Scenario x scorer matrix: `min/max` score over seeds (one value when equal), a mark per cell
 * ('' all seeds pass, '!' some seed fails the target, ' ' no target), plus target and the rows'
 * PASS counts at the bottom.
 */
export function formatComparison(columns: ComparisonColumn[], seeds: number[]): string {
  if (columns.length === 0) return ''
  const ids = columns[0].perSeed[0]?.map((r) => r.id) ?? []
  const width = Math.max(14, ...columns.map((c) => c.label.length + 2))
  const lines: string[] = []
  lines.push(`seeds ${seeds.join(',')}: cell = score (min-max over seeds), '!' = fails its target on some seed, rank of the first seed`)
  const header = pad('scenario', ID_WIDTH) + lpad('target', 8) + columns.map((c) => lpad(c.label, width)).join('')
  lines.push(header)
  lines.push('-'.repeat(header.length))
  for (const id of ids) {
    const first = columns[0].perSeed[0].find((r) => r.id === id)
    let line = pad(id, ID_WIDTH) + lpad(first?.reportOnly ? 'report' : formatTarget(first?.target), 8)
    for (const c of columns) {
      const rs = c.perSeed.map((list) => list.find((r) => r.id === id)).filter((r): r is ScenarioResult => !!r)
      if (rs.length === 0) {
        line += lpad('-', width)
        continue
      }
      const scores = rs.map((r) => r.score)
      const lo = Math.min(...scores)
      const hi = Math.max(...scores)
      const val = rs.some((r) => r.error) ? 'ERR' : lo.toFixed(1) === hi.toFixed(1) ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`
      const mark = rs.some((r) => r.pass === false) ? '!' : ' '
      line += lpad(`${val} ${rs[0].rank}${mark}`, width)
    }
    lines.push(line)
  }
  lines.push('-'.repeat(header.length))
  let passLine = pad('targets PASS (all seeds)', ID_WIDTH + 8)
  let rankLine = pad('ranks ok (all seeds)', ID_WIDTH + 8)
  for (const c of columns) {
    const sums = c.perSeed.map((list) => summarize(list))
    const pass = sums.map((x) => x.targetPass).reduce((a, b) => a + b, 0)
    const total = sums.map((x) => x.targetTotal).reduce((a, b) => a + b, 0)
    const rok = sums.map((x) => x.rankOk).reduce((a, b) => a + b, 0)
    const rtot = sums.map((x) => x.rankTotal).reduce((a, b) => a + b, 0)
    passLine += lpad(`${pass}/${total}`, width)
    rankLine += lpad(`${rok}/${rtot}`, width)
  }
  lines.push(passLine)
  lines.push(rankLine)
  return lines.join('\n')
}
