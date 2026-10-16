/**
 * Scoring lab — calibration scenarios (revised target table + real fixtures + sweeps + perf).
 *
 * Every synthetic scenario draws from rng.fork(<label>) of the run seed, so scenarios are
 * independent of each other and of ordering. All points of one sweep share the same label
 * (common random numbers): camera, clock, noise shapes are identical and only the swept
 * parameter changes.
 *
 * Targets are post-dance overallScore x 100 (TARGET_ROWS = the revised calibration table).
 * Timing policy behind them: ONE global latency compensation of at most 0.3 s per session is
 * free; timing error beyond that must cost points progressively; local tolerance around the
 * compensated time is short (about +/-150-250 ms).
 */
import type { PoseTimeline, ReferenceGeometry, TimestampedPose } from './data'
import {
  REF_FIXTURE, REF_INEEDU_GEOMETRY, geometryFromAspect, loadRealSession, loadRealStillUser, loadReference,
  loopTimeline, timelineDuration, timelineToTimestamped,
} from './data'
import type { DetectorFrame, RecordPolicy, SynthContext, UserSpec } from './synth'
import { createRng, createSynthContext, framesFromRecorded, recordSession, synthesizeUser } from './synth'
import type { Rank } from './scorer'
import { danceEndVideoTime, danceModeKeyPoses } from './live'
import { liveDeps as BASELINE_LIVE_DEPS } from './baseline/scorer'
import { computeDistinctiveness } from './baseline/scoring/keyPoseDetection'

/** Seed used while tuning a scorer. */
export const TUNING_SEED = 1
/** Seed used for reporting calibration results (never tune on it). */
export const REPORTING_SEED = 2

export type ScenarioGroup = 'target' | 'real' | 'extra' | 'sweep' | 'perf'
export type SweepName = 'lag' | 'blend' | 'noise' | 'jitter'

export interface ScenarioTarget {
  /** Inclusive bounds on overallScore * 100 */
  min?: number
  max?: number
}

// ---------------------------------------------------------------------------
// Revised calibration table (replaces every earlier target table)
// ---------------------------------------------------------------------------

export type TargetRowKey =
  | 'perfect' | 'perfect-lag0.25' | 'good' | 'good-lag0.6' | 'good-lag1.0' | 'late-1.5s' | 'late-3s'
  | 'sloppy' | 'beginner' | 'upper-body' | 'late-joiner' | 'dropout-3s' | 'geometry'
  | 'still' | 'mirror-style' | 'frozen' | 'idle' | 'flail' | 'hold' | 'reversed' | 'wrong'

export interface TargetRow {
  key: TargetRowKey
  /** Wording of the revised table */
  label: string
  target?: ScenarioTarget
  /** Expected ranks (keep 'S'|'A'|'B'|'C') */
  ranks?: Rank[]
  reportOnly?: boolean
}

const CHEAT: Rank[] = ['C']

/**
 * The revised target table, verbatim. Ranks: perfect -> S, good -> A (or S), sloppy -> B,
 * beginner -> B/C, every cheat -> C. (The geometry controls and the mirror-style copy are perfect
 * copies -> S.) Rows without a rank list have no rank expectation.
 */
export const TARGET_ROWS: TargetRow[] = [
  { key: 'perfect', label: 'perfect copy, +0.1 s sensor lag, tiny noise', target: { min: 92 }, ranks: ['S'] },
  { key: 'perfect-lag0.25', label: 'perfect copy, 0.25 s lag', target: { min: 88 } },
  {
    key: 'good', label: 'good dancer (0.3 s lag, noise, 85% amplitude, small timing jitter, brief dropouts)',
    target: { min: 72, max: 92 }, ranks: ['A', 'S'],
  },
  { key: 'good-lag0.6', label: 'good dancer, 0.6 s lag', target: { min: 55, max: 85 } },
  { key: 'good-lag1.0', label: 'good dancer, 1.0 s lag', target: { min: 35, max: 70 } },
  { key: 'late-1.5s', label: 'perfect copy 1.5 s late', target: { min: 25, max: 55 } },
  { key: 'late-3s', label: 'perfect copy 3 s late', target: { max: 40 } },
  { key: 'sloppy', label: 'sloppy dancer (50% toward neutral, 0.4 s lag, more noise)', target: { min: 40, max: 65 }, ranks: ['B'] },
  { key: 'beginner', label: 'beginner (arms roughly follow, legs mostly neutral, 0.5 s lag)', target: { min: 30, max: 55 }, ranks: ['B', 'C'] },
  { key: 'upper-body', label: 'upper-body framing, arms danced well, legs invisible (conf 0)', target: { min: 35, max: 65 } },
  { key: 'late-joiner', label: 'late joiner (dances well only the last 40%)', target: { min: 25, max: 50 } },
  { key: 'dropout-3s', label: 'perfect copy with a 3 s tracking dropout in the middle (15 s dance)', target: { min: 65, max: 85 } },
  {
    key: 'geometry',
    label: 'GEOMETRY CONTROL: perfect copy in webcam PIXEL space of a different aspect (640x480 and 320x240, random offset/scale), reference normalized from a 406x720 portrait video',
    target: { min: 92 }, ranks: ['S'],
  },
  {
    key: 'still',
    label: 'still neutral full body / still upper body only / REAL still user fixtures (user-still-upperbody-session1.json, user-session2-upperbody.json, user-session3.json — all three were rank A under legacy)',
    target: { max: 10 }, ranks: CHEAT,
  },
  {
    key: 'mirror-style',
    label: 'MIRROR-STYLE perfect copy (user flipped in x AND left/right labels swapped — the natural way to copy a screen); the scorer must detect orientation automatically',
    target: { min: 92 }, ranks: ['S'],
  },
  { key: 'frozen', label: 'one reference frame frozen for the whole dance', target: { max: 15 }, ranks: CHEAT },
  { key: 'idle', label: 'idle sway / bounce', target: { max: 15 }, ranks: CHEAT },
  { key: 'flail', label: 'random energetic flailing', target: { max: 20 }, ranks: CHEAT },
  { key: 'hold', label: 'constant distinctive pose (T-pose / arms up)', target: { max: 15 }, ranks: CHEAT },
  { key: 'reversed', label: 'reversed choreography (time-reversed reference)', target: { max: 35 }, ranks: CHEAT },
  { key: 'wrong', label: 'wrong choreography (circular shift by half)', target: { max: 35 }, ranks: CHEAT },
]

export function targetRow(key: TargetRowKey): TargetRow {
  const row = TARGET_ROWS.find((r) => r.key === key)
  if (!row) throw new Error(`Unknown target row ${key}`)
  return row
}

export interface Scenario {
  id: string
  group: ScenarioGroup
  description: string
  /** Key of the revised-table row this scenario is judged by (undefined = no row) */
  row?: TargetRowKey
  target?: ScenarioTarget
  /** Acceptable ranks (undefined = not checked) */
  ranks?: Rank[]
  /** Printed but never PASS/FAIL */
  reportOnly?: boolean
  sweep?: { name: SweepName; value: number }
  timeline: PoseTimeline
  /** Normalized reference poses, exactly what the app passes to post-dance scoring */
  reference: TimestampedPose[]
  /** Reference video pixel size; passed to scorers as options.referenceGeometry */
  referenceGeometry: ReferenceGeometry
  /** Every DanceMode loop iteration (recording clock + video clock), pose null = no detection */
  frames: DetectorFrame[]
  /** Real recordings: the saved user poses, used as-is for every record policy */
  recorded?: TimestampedPose[]
  real?: boolean
  perf?: boolean
  spec?: UserSpec
  meta?: Record<string, unknown>
}

/** User poses as DanceMode would hand them to computePostDanceScore. */
export function userPosesFor(scenario: Scenario, policy: RecordPolicy): TimestampedPose[] {
  return scenario.recorded ?? recordSession(scenario.frames, policy)
}

// ---------------------------------------------------------------------------
// Presets (all angles in radians, jitter / wander in torso lengths, times in seconds)
// ---------------------------------------------------------------------------

const REF = { kind: 'reference' } as const

export const PRESETS = {
  /** Perfect copy: +0.1 s sensor lag, tiny noise */
  perfect: { motion: REF, lag: 0.1, angleError: 0.02, jitter: 0.003, wander: 0.005 },
  /** Good dancer: 0.3 s lag, noise, 85% amplitude, small timing jitter, brief dropouts */
  good: {
    motion: REF, lag: 0.3, blend: 0.15, angleError: 0.12, timingJitter: 0.08,
    jitter: 0.004, wander: 0.015, dropouts: { count: 3, minDur: 0.15, maxDur: 0.45 },
  },
  /** Sloppy dancer: 50% toward neutral, 0.4 s lag, more noise */
  sloppy: {
    motion: REF, lag: 0.4, blend: 0.5, angleError: 0.28, timingJitter: 0.15,
    jitter: 0.006, wander: 0.025, dropouts: { count: 2, minDur: 0.15, maxDur: 0.5 },
  },
  /** Beginner: arms roughly follow, legs mostly neutral, 0.5 s lag */
  beginner: {
    motion: REF, lag: 0.5, blend: { arms: 0.35, torso: 0.6, legs: 0.85 }, angleError: 0.3,
    timingJitter: 0.2, jitter: 0.006, wander: 0.025, dropouts: { count: 2, minDur: 0.2, maxDur: 0.6 },
  },
  /** Standing still: detector jitter + slow postural wander similar to the real session */
  still: { jitter: 0.002, wander: 0.01 },
} satisfies Record<string, Partial<UserSpec>>

export const SWEEPS: Record<SweepName, number[]> = {
  lag: [0, 0.1, 0.25, 0.5, 1.0, 1.5, 3.0],
  blend: [0, 0.25, 0.5, 0.75, 1],
  noise: [0, 0.1, 0.2, 0.35, 0.5],
  jitter: [0.003, 0.01, 0.02, 0.04, 0.08],
}

export const SWEEP_DESCRIPTIONS: Record<SweepName, string> = {
  lag: 'perfect copy, lag (s)',
  blend: 'perfect copy, blend toward neutral (0..1)',
  noise: 'perfect copy, smooth joint-rotation error sd (rad)',
  jitter: 'perfect copy, white keypoint jitter sd (torso lengths)',
}

/** Largest lag that one global latency compensation may absorb for free (timing policy). */
export const FREE_LATENCY_S = 0.3

/** Fixed middle tracking gap of the dropout scenario (video seconds, 15 s dance). */
export const MID_DROPOUT: [number, number] = [6, 9]

/** Reference frame time held by the frozen-ref-frame scenario (same frame as the research). */
export const FROZEN_REF_TIME = 2.5

// ---------------------------------------------------------------------------
// Reference / context cache
// ---------------------------------------------------------------------------

export interface RefBundle {
  timeline: PoseTimeline
  reference: TimestampedPose[]
  geometry: ReferenceGeometry
  ctx: SynthContext
  mostDistinctiveFrame: number
}

const refCache = new Map<string, RefBundle>()

/**
 * Reference + synthesis context. `geometry` defaults to the sidecar meta of the fixture
 * (406x720 for I Need U); a number is read as an aspect W/H (older callers).
 */
export function getReferenceBundle(geometry: ReferenceGeometry | number = REF_INEEDU_GEOMETRY, file = REF_FIXTURE, loops = 1): RefBundle {
  const geo = typeof geometry === 'number' ? geometryFromAspect(geometry) : geometry
  const key = `${file}|${geo.width}x${geo.height}|${loops}`
  let b = refCache.get(key)
  if (!b) {
    const base = loadReference(file, geo).timeline
    const timeline = loops > 1 ? loopTimeline(base, loops) : base
    // Scenario data must not change when src/ changes: use the frozen baseline key poses
    const keyPoses = danceModeKeyPoses(timeline, BASELINE_LIVE_DEPS)
    const ctx = createSynthContext(timeline, geo, {
      endVideoTime: danceEndVideoTime(keyPoses, timelineDuration(timeline)),
    })
    let best = 0
    let bestVal = -Infinity
    timeline.keyframes.forEach((kf, i) => {
      const d = computeDistinctiveness({ keypoints: kf.keypoints })
      if (d > bestVal) {
        bestVal = d
        best = i
      }
    })
    b = { timeline, reference: timelineToTimestamped(timeline), geometry: geo, ctx, mostDistinctiveFrame: best }
    refCache.set(key, b)
  }
  return b
}

// ---------------------------------------------------------------------------
// Scenario list
// ---------------------------------------------------------------------------

export interface BuildOptions {
  seed: number
  /** Reference video pixel size (default: the fixture's sidecar meta, 406x720) */
  geometry?: ReferenceGeometry
  /** Older option: reference aspect W/H (ignored when `geometry` is given) */
  aspect?: number
  /** Include the 60 s performance scenario (default true) */
  perf?: boolean
  /** Only build scenarios whose id matches */
  filter?: RegExp
}

interface Def {
  id: string
  group: ScenarioGroup
  description: string
  /** Revised-table row (supplies target / ranks / reportOnly unless overridden) */
  row?: TargetRowKey
  target?: ScenarioTarget
  ranks?: Rank[]
  reportOnly?: boolean
  sweep?: { name: SweepName; value: number }
  /** RNG label (defaults to id) */
  label?: string
  spec?: UserSpec | ((b: RefBundle) => UserSpec)
  build?: (b: RefBundle) => Pick<Scenario, 'frames' | 'recorded' | 'real'>
  perf?: boolean
}

const RANDOM_640: UserSpec['camera'] = { width: 640, height: 480, placement: 'random' }
const RANDOM_320: UserSpec['camera'] = { width: 320, height: 240, placement: 'random' }

function scenarioDefs(): Def[] {
  const defs: Def[] = [
    {
      id: 'perfect', group: 'target', row: 'perfect',
      description: 'perfect copy: +0.1 s lag, tiny noise (320x240 webcam)',
      spec: { ...PRESETS.perfect },
    },
    {
      id: 'perfect-lag0.25', group: 'target', row: 'perfect-lag0.25',
      description: 'perfect copy with 0.25 s lag',
      spec: { ...PRESETS.perfect, lag: 0.25 },
    },
    {
      id: 'good', group: 'target', row: 'good',
      description: 'good dancer: 0.3 s lag, blend 0.15 (85% amplitude), angle error 0.12, timing jitter 0.08, 3 dropouts',
      spec: { ...PRESETS.good },
    },
    {
      id: 'good-lag0.6', group: 'target', row: 'good-lag0.6',
      description: 'good dancer with 0.6 s lag',
      spec: { ...PRESETS.good, lag: 0.6 },
    },
    {
      id: 'good-lag1.0', group: 'target', row: 'good-lag1.0',
      description: 'good dancer with 1.0 s lag',
      spec: { ...PRESETS.good, lag: 1.0 },
    },
    {
      id: 'late-1.5s', group: 'target', row: 'late-1.5s',
      description: 'perfect copy 1.5 s late (holds the start pose first; the last 1.5 s is never danced)',
      spec: { ...PRESETS.perfect, lag: 1.5 },
    },
    {
      id: 'late-3s', group: 'target', row: 'late-3s',
      description: 'perfect copy 3 s late',
      spec: { ...PRESETS.perfect, lag: 3.0 },
    },
    {
      id: 'sloppy', group: 'target', row: 'sloppy',
      description: 'sloppy: blend 0.5 toward neutral, 0.4 s lag, angle error 0.28, timing jitter 0.15',
      spec: { ...PRESETS.sloppy },
    },
    {
      id: 'beginner', group: 'target', row: 'beginner',
      description: 'beginner: blend arms 0.35 / torso 0.6 / legs 0.85, 0.5 s lag, angle error 0.3',
      spec: { ...PRESETS.beginner },
    },
    {
      id: 'upper-body-arms', group: 'target', row: 'upper-body',
      description: 'good dancer, waist-up framing: legs conf ~0 (0.0001-0.01), hips ~0.7',
      spec: { ...PRESETS.good, framing: { visibility: 'upper' } },
    },
    {
      id: 'late-joiner', group: 'target', row: 'late-joiner',
      description: 'good dancer, no detection for the first 60% (dances only the last 40%)',
      spec: { ...PRESETS.good, presentFrom: 0.6 },
    },
    {
      id: 'dropout-3s-mid', group: 'target', row: 'dropout-3s',
      description: `perfect copy, no detection ${MID_DROPOUT[0]}-${MID_DROPOUT[1]} s (3 s tracking dropout mid-dance)`,
      spec: { ...PRESETS.perfect, gaps: [MID_DROPOUT] },
    },
    {
      id: 'geometry-640x480', group: 'target', row: 'geometry',
      description: 'perfect copy in a 640x480 webcam, random scale/offset (ref normalized from 406x720)',
      spec: { ...PRESETS.perfect, camera: RANDOM_640 },
    },
    {
      id: 'geometry-320x240', group: 'target', row: 'geometry',
      description: 'perfect copy in a 320x240 webcam, random scale/offset (ref normalized from 406x720)',
      spec: { ...PRESETS.perfect, camera: RANDOM_320 },
    },
    {
      id: 'geometry-exact-640x480', group: 'extra', reportOnly: true,
      description: 'exact reference (no lag, no noise) in a 640x480 webcam, random scale/offset — pure coordinate test (~100 expected)',
      spec: { motion: REF, lag: 0, jitter: 0, wander: 0, frameJitter: 0, camera: RANDOM_640 },
    },
    {
      id: 'still-full', group: 'target', row: 'still',
      description: 'standing still, neutral, full body, whole duration',
      spec: { motion: { kind: 'neutral' }, ...PRESETS.still },
    },
    {
      id: 'still-upper', group: 'target', row: 'still',
      description: 'standing still, neutral, upper body only',
      spec: { motion: { kind: 'neutral' }, ...PRESETS.still, framing: { visibility: 'upper' } },
    },
    {
      id: 'real-still', group: 'real', row: 'still',
      description: 'REAL session fixture (scored 63.6% A in the app): 152 frames 9.59-14.62 s, 320x240 px',
      build: (b) => {
        const recorded = loadRealStillUser()
        return { recorded, frames: framesFromRecorded(recorded, b.ctx.duration), real: true }
      },
    },
    {
      id: 'real-session2', group: 'real', row: 'still',
      description: 'REAL session 2 fixture (rank A under legacy): 51 frames 5.14-13.22 s with a 3.7 s gap, upper body, 320x240 px',
      build: (b) => {
        const recorded = loadRealSession('session2')
        return { recorded, frames: framesFromRecorded(recorded, b.ctx.duration), real: true }
      },
    },
    {
      id: 'real-session3', group: 'real', row: 'still',
      description: 'REAL session 3 fixture (rank A under legacy): 107 frames 6.76-16.07 s with a 4.4 s gap, upper body, 320x240 px',
      build: (b) => {
        const recorded = loadRealSession('session3')
        return { recorded, frames: framesFromRecorded(recorded, b.ctx.duration), real: true }
      },
    },
    {
      id: 'real-frozen', group: 'extra', row: 'still',
      description: 'real session first frame frozen for the whole dance (extra, judged as still)',
      build: (b) => {
        const first = loadRealStillUser()[0].pose
        return { frames: synthesizeUser(b.ctx, { motion: { kind: 'fixedPixelPose', pose: first } }, createRng(0)).frames }
      },
    },
    {
      id: 'frozen-ref-frame', group: 'target', row: 'frozen',
      description: `reference frame at ${FROZEN_REF_TIME} s (the research's frozen frame) held for the whole dance`,
      spec: (b) => ({
        motion: { kind: 'hold', pose: 'refFrame', refFrameIndex: Math.round(FROZEN_REF_TIME * b.timeline.fps) },
        ...PRESETS.still,
      }),
    },
    {
      id: 'hold-ref-pose', group: 'extra', row: 'frozen',
      description: 'most distinctive reference frame held for the whole dance (extra)',
      spec: (b) => ({ motion: { kind: 'hold', pose: 'refFrame', refFrameIndex: b.mostDistinctiveFrame }, ...PRESETS.still }),
    },
    {
      id: 'idle-sway', group: 'target', row: 'idle',
      description: 'idle side-to-side sway + knee bounce, arms loose',
      spec: { motion: { kind: 'sway' }, ...PRESETS.still },
    },
    {
      id: 'flail', group: 'target', row: 'flail',
      description: 'random smooth energetic flailing',
      spec: { motion: { kind: 'flail' }, ...PRESETS.still },
    },
    {
      id: 'hold-tpose', group: 'target', row: 'hold',
      description: 'T-pose held for the whole dance',
      spec: { motion: { kind: 'hold', pose: 'tpose' }, ...PRESETS.still },
    },
    {
      id: 'hold-arms-up', group: 'target', row: 'hold',
      description: 'both arms up, held for the whole dance',
      spec: { motion: { kind: 'hold', pose: 'armsUp' }, ...PRESETS.still },
    },
    {
      id: 'reversed-choreo', group: 'target', row: 'reversed',
      description: 'perfect-quality copy of the time-reversed choreography (+0.1 s lag, tiny noise)',
      spec: { ...PRESETS.perfect, reverse: true },
    },
    {
      id: 'wrong-choreo', group: 'target', row: 'wrong',
      description: 'good dancer doing the wrong part (reference shifted by half, circular)',
      spec: (b) => ({ ...PRESETS.good, shift: b.ctx.duration / 2 }),
    },
    {
      id: 'mirror-style', group: 'target', row: 'mirror-style',
      description: 'MIRROR-STYLE perfect copy (+0.1 s lag, tiny noise): flipped in x AND left/right labels swapped',
      spec: { ...PRESETS.perfect, mirror: true },
    },
    {
      id: 'mirror-style-640x480', group: 'extra', row: 'mirror-style',
      description: 'MIRROR-STYLE perfect copy in a 640x480 webcam, random scale/offset (orientation + geometry together)',
      spec: { ...PRESETS.perfect, mirror: true, camera: RANDOM_640 },
    },
    {
      id: 'mirror-style-good', group: 'extra', reportOnly: true,
      description: 'MIRROR-STYLE good dancer (good preset + mirror) — should land in the good range (72-92), not report-checked',
      spec: { ...PRESETS.good, mirror: true },
    },
  ]

  for (const name of Object.keys(SWEEPS) as SweepName[]) {
    for (const value of SWEEPS[name]) {
      const spec: UserSpec = { ...PRESETS.perfect }
      let row: TargetRowKey | undefined
      if (name === 'lag') {
        spec.lag = value
        if (value <= 0.1) row = 'perfect'
        else if (value === 0.25) row = 'perfect-lag0.25'
        else if (value === 1.5) row = 'late-1.5s'
        else if (value === 3.0) row = 'late-3s'
      } else if (name === 'blend') {
        spec.blend = value
        if (value === 0) row = 'perfect'
        if (value === 1) row = 'still'
      } else if (name === 'noise') {
        spec.angleError = value
        if (value === 0) row = 'perfect'
      } else {
        spec.jitter = value
        if (value === SWEEPS.jitter[0]) row = 'perfect'
      }
      defs.push({
        id: `sweep-${name}-${value}`,
        group: 'sweep',
        label: 'sweep-base',
        sweep: { name, value },
        description: SWEEP_DESCRIPTIONS[name],
        row,
        reportOnly: row === undefined,
        spec,
      })
    }
  }

  defs.push({
    id: 'perf-60s', group: 'perf', perf: true, reportOnly: true,
    description: '60 s performance test: good dancer on the reference looped 4x (~1800 vs ~1800 frames)',
    spec: { ...PRESETS.good, dropouts: { count: 8, minDur: 0.15, maxDur: 0.45 } },
  })
  return defs
}

/** All scenario ids in report order (without building them). */
export function scenarioIds(): string[] {
  return scenarioDefs().map((d) => d.id)
}

export function buildScenarios(opts: BuildOptions): Scenario[] {
  const geometry = opts.geometry ?? (opts.aspect !== undefined ? geometryFromAspect(opts.aspect) : REF_INEEDU_GEOMETRY)
  const root = createRng(opts.seed)
  const out: Scenario[] = []
  for (const def of scenarioDefs()) {
    if (def.perf && opts.perf === false) continue
    if (opts.filter && !opts.filter.test(def.id)) continue
    const bundle = getReferenceBundle(geometry, REF_FIXTURE, def.perf ? 4 : 1)
    const spec = typeof def.spec === 'function' ? def.spec(bundle) : def.spec
    let built: Pick<Scenario, 'frames' | 'recorded' | 'real'>
    let meta: Record<string, unknown> | undefined
    if (def.build) {
      built = def.build(bundle)
    } else if (spec) {
      const session = synthesizeUser(bundle.ctx, spec, root.fork(def.label ?? def.id))
      built = { frames: session.frames }
      meta = session.meta
    } else {
      throw new Error(`Scenario ${def.id} has neither spec nor build`)
    }
    const row = def.row ? targetRow(def.row) : undefined
    const reportOnly = def.reportOnly ?? row?.reportOnly ?? false
    out.push({
      id: def.id,
      group: def.group,
      description: def.description,
      row: def.row,
      target: reportOnly ? undefined : def.target ?? row?.target,
      ranks: reportOnly ? undefined : def.ranks ?? row?.ranks,
      reportOnly,
      sweep: def.sweep,
      timeline: bundle.timeline,
      reference: bundle.reference,
      referenceGeometry: bundle.geometry,
      perf: def.perf,
      spec,
      meta,
      ...built,
    })
  }
  return out
}
