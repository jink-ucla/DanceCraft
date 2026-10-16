/**
 * Scoring lab CLI.
 *
 *   npx tsx scripts/scoring-lab/run.ts [--scorer <module|alias>[,<module|alias>...]] [--seed N[,M...]]
 *                                      [--json out.json] [--live] [--filter <regex>]
 *                                      [--geometry WxH | --aspect W/H] [--no-geometry]
 *                                      [--record presence|detected|all] [--show f1,f2] [--no-perf]
 *                                      [--quiet] [--list]
 *
 * See scripts/scoring-lab/README.md.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LoadedScorer } from './scorer'
import { DEFAULT_SCORER_PATH, listCandidates, loadScorer, resolveScorerPath } from './scorer'
import { TUNING_SEED, buildScenarios } from './scenarios'
import type { NamedRecordPolicy } from './synth'
import { RECORD_POLICIES, recordPolicyName } from './synth'
import type { ReferenceGeometry } from './data'
import { REF_INEEDU_GEOMETRY, geometryFromAspect } from './data'
import type { ComparisonColumn, LiveRow, PerfResult, ScenarioResult, SweepCheck, Summary } from './evaluate'
import {
  ID_WIDTH, checkSweeps, evaluateAll, formatComparison, formatLive, formatPerf, formatResultsTable, formatSweeps,
  runLive, runPerf, summarize,
} from './evaluate'

interface Args {
  scorers: string[]
  seeds: number[]
  json?: string
  live: boolean
  filter?: RegExp
  geometry: ReferenceGeometry
  passGeometry: boolean
  record?: NamedRecordPolicy
  perf: boolean
  quiet: boolean
  show: string[]
  list: boolean
}

const USAGE = `Usage: npx tsx scripts/scoring-lab/run.ts [options]
  --scorer <a[,b..]>  scorer module(s) or aliases (default ${DEFAULT_SCORER_PATH} = current computePostDanceScore)
                      aliases: current | legacy (= baseline, frozen BEFORE code) | <candidate name> (candidates/<name>)
                      | all (legacy + every candidate with an entry file). Several -> comparison matrix at the end
  --seed <N[,M..]>    scenario seed(s) (default ${TUNING_SEED} = tuning seed; 2 = reporting seed)
  --json <file>       write full results as JSON
  --live              also simulate DanceMode live key-pose hits (easy/normal/hard)
  --filter <regex>    only scenarios whose id matches
  --geometry <WxH>    reference video pixel size (default ${REF_INEEDU_GEOMETRY.width}x${REF_INEEDU_GEOMETRY.height} from ref-ineedu-15s.meta.json)
  --aspect <W/H>      older form of --geometry (height ${REF_INEEDU_GEOMETRY.height}); 1 = pretend the video is square
  --no-geometry       do NOT pass options.referenceGeometry to scorers (synthetic users still use the real geometry)
  --record <policy>   override record policy: presence (DanceMode @ 7aebdba) | detected | all
  --show <f1,f2>      add columns for extra result fields (dotted paths allowed)
  --no-perf           skip the 60 s performance scenario
  --quiet             only print summaries (and the comparison matrix)
  --list              list candidate modules and exit`

function parseGeometry(v: string): ReferenceGeometry {
  const m = /^(\d+(?:\.\d+)?)[x:](\d+(?:\.\d+)?)$/i.exec(v.trim())
  if (!m) throw new Error(`Invalid --geometry ${v} (expected WxH, e.g. 406x720)`)
  return { width: Number(m[1]), height: Number(m[2]) }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scorers: [DEFAULT_SCORER_PATH], seeds: [TUNING_SEED], live: false, geometry: { ...REF_INEEDU_GEOMETRY },
    passGeometry: true, perf: true, quiet: false, show: [], list: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case '--scorer':
      case '--scorers': args.scorers = next().split(',').map((s) => s.trim()).filter(Boolean); break
      case '--seed':
      case '--seeds': args.seeds = next().split(',').map((s) => Number(s.trim())); break
      case '--json': args.json = next(); break
      case '--live': args.live = true; break
      case '--filter': args.filter = new RegExp(next()); break
      case '--geometry': args.geometry = parseGeometry(next()); break
      case '--aspect': {
        const v = next()
        const aspect = v.includes('/') ? Number(v.split('/')[0]) / Number(v.split('/')[1]) : Number(v)
        if (!(aspect > 0)) throw new Error('--aspect must be > 0')
        args.geometry = geometryFromAspect(aspect)
        break
      }
      case '--no-geometry': args.passGeometry = false; break
      case '--record': {
        const v = next() as NamedRecordPolicy
        if (!RECORD_POLICIES.includes(v)) throw new Error(`Invalid --record ${v}`)
        args.record = v
        break
      }
      case '--show': args.show = next().split(',').map((s) => s.trim()).filter(Boolean); break
      case '--no-perf': args.perf = false; break
      case '--quiet': args.quiet = true; break
      case '--list': args.list = true; break
      case '-h':
      case '--help':
        console.log(USAGE)
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${a}\n${USAGE}`)
    }
  }
  if (args.seeds.some((s) => !Number.isInteger(s))) throw new Error('--seed must be integer(s)')
  if (!(args.geometry.width > 0 && args.geometry.height > 0)) throw new Error('geometry must be > 0')
  return args
}

/** Expand 'all' into legacy + every candidate. */
function expandScorers(specs: string[]): string[] {
  const out: string[] = []
  for (const s of specs) {
    if (s === 'all') out.push('legacy', ...listCandidates())
    else out.push(s)
  }
  return [...new Set(out)]
}

/** Short label for the comparison matrix. */
function shortLabel(spec: string): string {
  if (spec === 'legacy' || spec === 'baseline') return 'legacy'
  if (spec === 'current' || spec === DEFAULT_SCORER_PATH) return 'current'
  const path = resolveScorerPath(spec).replace(/\\/g, '/')
  const m = /candidates\/([^/]+?)(?:\.[cm]?[tj]s)?(?:\/.*)?$/.exec(path)
  if (m) return m[1]
  if (/baseline\/scorer\.ts$/.test(path)) return 'legacy'
  return path.split('/').pop()!.replace(/\.[cm]?[tj]s$/, '')
}

interface SeedReport {
  seed: number
  results: ScenarioResult[]
  summary: Summary
  sweeps: SweepCheck[]
  perf?: PerfResult
  live?: LiveRow[]
}

interface ScorerRun {
  spec: string
  label: string
  scorer?: LoadedScorer
  loadError?: string
  reports: SeedReport[]
}

function runScorer(scorer: LoadedScorer, args: Args): SeedReport[] {
  const policy = args.record ?? scorer.recordPolicy
  console.log(`Scorer: ${scorer.name}  [${scorer.path}#${scorer.kind}]`)
  console.log(`Record policy: ${recordPolicyName(policy)}${args.record ? ' (CLI override)' : ''}   ` +
    `reference geometry: ${args.geometry.width}x${args.geometry.height}` +
    `${args.passGeometry ? ' (passed as options.referenceGeometry)' : ' (NOT passed: --no-geometry)'}   seeds: ${args.seeds.join(',')}`)
  const evalOpts = { recordPolicy: policy, passGeometry: args.passGeometry }
  const reports: SeedReport[] = []
  for (const seed of args.seeds) {
    const scenarios = buildScenarios({ seed, geometry: args.geometry, perf: args.perf, filter: args.filter })
    const results = evaluateAll(scorer, scenarios, evalOpts)
    const summary = summarize(results)
    const sweeps = checkSweeps(results)
    const perfScenario = scenarios.find((s) => s.perf)
    const perf = perfScenario ? runPerf(scorer, perfScenario, evalOpts) : undefined
    const live = args.live ? runLive(scorer, scenarios) : undefined
    reports.push({ seed, results, summary, sweeps, perf, live })

    console.log(`\n=== seed ${seed} ===`)
    if (!args.quiet) console.log(formatResultsTable(results, args.show))
    for (const r of results.filter((x) => x.error)) console.log(`\n[${r.id}] ERROR\n${r.error}`)
    console.log(`\nTargets: ${summary.targetPass}/${summary.targetTotal} PASS` +
      (summary.failed.length ? `  (FAIL: ${summary.failed.join(', ')})` : ''))
    console.log(`Ranks:   ${summary.rankOk}/${summary.rankTotal} ok` +
      (summary.rankFailed.length ? `  (X: ${summary.rankFailed.join(', ')})` : ''))
    if (sweeps.length) {
      console.log('\nSweeps:')
      console.log(formatSweeps(sweeps))
    }
    if (perf) {
      console.log('\nPerformance:')
      console.log(formatPerf(perf))
    }
    if (live) {
      console.log('\nLive key-pose hits (DanceMode replica):')
      console.log(formatLive(live))
    }
  }

  if (reports.length > 1) {
    console.log(`\n=== across seeds ${args.seeds.join(',')} ===`)
    const ids = reports[0].results.map((r) => r.id)
    console.log('scenario'.padEnd(ID_WIDTH) + 'min'.padStart(7) + 'max'.padStart(7) + 'pass'.padStart(7))
    for (const id of ids) {
      const rs = reports.map((rep) => rep.results.find((r) => r.id === id)!).filter(Boolean)
      const scores = rs.map((r) => r.score)
      const passCount = rs.filter((r) => r.pass).length
      const hasTarget = rs.some((r) => r.pass !== null)
      console.log(id.padEnd(ID_WIDTH) + Math.min(...scores).toFixed(1).padStart(7) + Math.max(...scores).toFixed(1).padStart(7) +
        (hasTarget ? `${passCount}/${rs.length}` : '-').padStart(7))
    }
    const allPass = reports.every((r) => r.summary.targetPass === r.summary.targetTotal)
    const sweepPass = reports.every((r) => r.sweeps.every((s) => s.checks.every((c) => c.pass)))
    const perfPass = reports.every((r) => !r.perf || r.perf.pass)
    console.log(`all targets: ${allPass ? 'PASS' : 'FAIL'}   sweeps: ${sweepPass ? 'PASS' : 'FAIL'}   perf: ${perfPass ? 'PASS' : 'FAIL'}`)
  }
  return reports
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.list) {
    console.log('Candidates (scripts/scoring-lab/candidates; directories without an entry file are skipped):')
    for (const c of listCandidates()) console.log(`  ${shortLabel(c).padEnd(24)} ${c}`)
    console.log('Aliases: current (src/scoring/dtw.ts), legacy | baseline (frozen BEFORE scorer), all')
    return
  }

  const runs: ScorerRun[] = []
  const specs = expandScorers(args.scorers)
  for (const [i, spec] of specs.entries()) {
    if (i > 0) console.log(`\n${'#'.repeat(100)}\n`)
    const run: ScorerRun = { spec, label: shortLabel(spec), reports: [] }
    try {
      run.scorer = await loadScorer(spec)
    } catch (err) {
      run.loadError = (err as Error).stack ?? String(err)
      console.log(`Scorer ${spec}: LOAD ERROR\n${run.loadError}`)
      runs.push(run)
      continue
    }
    run.reports = runScorer(run.scorer, args)
    runs.push(run)
  }

  const loaded = runs.filter((r) => r.scorer)
  if (specs.length > 1 && loaded.length > 0) {
    console.log(`\n${'#'.repeat(100)}\n\n=== comparison (${loaded.length} scorers) ===`)
    const columns: ComparisonColumn[] = loaded.map((r) => ({ label: r.label, perSeed: r.reports.map((rep) => rep.results) }))
    console.log(formatComparison(columns, args.seeds))
    const perfLine = loaded.map((r) => {
      const ms = r.reports.map((rep) => rep.perf?.medianMs).filter((v): v is number => v !== undefined)
      return `${r.label} ${ms.length ? `${Math.round(Math.max(...ms))} ms` : '-'}`
    })
    if (args.perf) console.log(`perf-60s (worst median over seeds): ${perfLine.join(' | ')}`)
    for (const r of runs.filter((x) => x.loadError)) console.log(`not run (load error): ${r.spec}`)
  }

  if (args.json) {
    const scorerJson = (r: ScorerRun) => ({
      scorer: r.scorer?.name ?? r.spec,
      scorerPath: r.scorer?.path ?? r.spec,
      recordPolicy: r.scorer ? recordPolicyName(args.record ?? r.scorer.recordPolicy) : undefined,
      loadError: r.loadError,
      reports: r.reports,
    })
    const common = {
      referenceGeometry: args.geometry,
      passGeometry: args.passGeometry,
      seeds: args.seeds,
      generatedAt: new Date().toISOString(),
    }
    // Single scorer: same top-level layout as before ({ scorer, scorerPath, recordPolicy, reports, ... })
    const out = runs.length === 1 ? { ...scorerJson(runs[0]), ...common } : { ...common, runs: runs.map(scorerJson) }
    writeFileSync(resolve(process.cwd(), args.json), JSON.stringify(out, null, 2))
    console.log(`\nJSON written to ${args.json}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
