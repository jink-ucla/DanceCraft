# Scoring lab

This is an offline calibration bench for Groovy's post-dance score (`computePostDanceScore`) and for the
live key-pose hits in `DanceMode`. It does four things:

- builds deterministic synthetic users from the real reference dance, in aspect-correct pixel geometry;
- adds the three real sessions that scored rank A while the user was standing still;
- runs one or more candidate scorers on all of these;
- checks them against the REVISED calibration targets, the sweep rules and the 60 s performance budget.

```bash
npx tsx scripts/scoring-lab/run.ts                                   # current src/scoring/dtw.ts, tuning seed 1
npx tsx scripts/scoring-lab/run.ts --seed 2                          # reporting seed (never tune on it)
npx tsx scripts/scoring-lab/run.ts --scorer legacy,research-window,pulse-keypoints,honest-interim --seed 1,2
npx tsx scripts/scoring-lab/run.ts --scorer all --seed 1,2 --quiet   # every candidate + legacy, comparison matrix
npx tsx scripts/scoring-lab/run.ts --scorer my-candidate --live --json out.json
npx tsx scripts/scoring-lab/run.ts --list                            # candidate modules found
npx tsx scripts/scoring-lab/selfcheck.ts                             # lab integrity checks
npx tsx scripts/scoring-lab/sanity-baselines.ts                      # ports reproduce their authors' numbers
npx tsc -p scripts/scoring-lab/tsconfig.json                         # typecheck the lab (incl. candidates)
```

## CLI

| flag | meaning |
| --- | --- |
| `--scorer <a[,b..]>` | One or more scorer modules or aliases. The default is `src/scoring/dtw.ts`, i.e. whatever `computePostDanceScore` is now. Aliases:<br>• `current`<br>• `legacy` / `baseline`: the frozen BEFORE code<br>• `<name>`: `candidates/<name>.ts` or `candidates/<name>/{index,scorer,candidate,<name>}.ts`<br>• `all`: legacy plus every candidate that has an entry file<br>With several scorers, the run prints a scenario × scorer comparison matrix at the end. If a candidate fails to load, it is reported and skipped. |
| `--seed N[,M..]` | Scenario seed(s). `1` is the tuning seed (default), `2` the reporting seed. Several seeds print one table each plus a min/max summary. |
| `--json <file>` | Full results: per-scenario scores, sections, body parts, extra result fields, sweeps, perf and live details. One scorer gives `{ scorer, scorerPath, recordPolicy, reports, referenceGeometry, ... }`; several give `{ runs: [...] }`. |
| `--live` | Also runs the offline DanceMode replica for easy / normal / hard and prints the perfect/good/miss counts. |
| `--filter <regex>` | Only scenarios whose id matches, e.g. `"^(perfect|real-)"` or `"sweep-lag"`. |
| `--geometry <WxH>` | Reference video pixel size. The default `406x720` comes from `tests/fixtures/scoring/ref-ineedu-15s.meta.json`. Synthetic users are built in this geometry and it is passed as `options.referenceGeometry`. |
| `--aspect <W/H>` | Older form of `--geometry` (height 720). `--aspect 1` pretends the source video was square. |
| `--no-geometry` | Do NOT pass `options.referenceGeometry`. Use it to test a scorer's fallback; the synthetic users still use the real geometry. |
| `--record presence\|detected\|all` | Override the scorer's record policy. |
| `--show f1,f2` | Extra columns for non-standard result fields. Dotted paths are allowed, e.g. `coverage`, `latencyMs`, `diagnostics.motion`. |
| `--no-perf` | Skip the 60 s performance scenario. |
| `--quiet` | Summaries and the comparison matrix only. |

Table columns:

| column | meaning |
| --- | --- |
| `frames` | user frames passed to the scorer |
| `span(s)` | recording-clock range of those frames |
| `score` | `overallScore * 100` |
| `target` | revised calibration range |
| `ranks` | acceptable ranks |
| `result` | PASS / FAIL against the target (`report` = no target) |
| `rank?` | rank check |
| `ms` | scorer time |
| `arms` / `legs` | body part scores |
| `sections` | section scores |

In the comparison matrix, each cell is `score rank`. The score is the min-max over seeds, the rank is from the first seed, and `!` means the target fails on at least one seed.

## Revised calibration targets

These replace every earlier target table. All values are post-dance `overallScore * 100`. Tune on seed 1 and report on seed 2.

**Timing policy:**
- ONE global latency compensation of at most 0.3 s per session is allowed: webcam, detector and display latency plus human reaction. Estimate it and report it as `latencyMs`.
- Timing error beyond that must cost points progressively (Just Dance style).
- Local tolerance around the compensated time is short, about ±150-250 ms.

| row (scenario ids) | target | ranks |
| --- | --- | --- |
| perfect copy, +0.1 s sensor lag, tiny noise (`perfect`, `sweep-lag-0`, `sweep-lag-0.1`, `sweep-blend-0`, `sweep-noise-0`, `sweep-jitter-0.003`) | >= 92 | S |
| perfect copy, 0.25 s lag (`perfect-lag0.25`, `sweep-lag-0.25`) | >= 88 | |
| good dancer: 0.3 s lag, noise, 85% amplitude, small timing jitter, brief dropouts (`good`) | 72-92 | A/S |
| good dancer, 0.6 s lag (`good-lag0.6`) | 55-85 | |
| good dancer, 1.0 s lag (`good-lag1.0`) | 35-70 | |
| perfect copy 1.5 s late (`late-1.5s`, `sweep-lag-1.5`) | 25-55 | |
| perfect copy 3 s late (`late-3s`, `sweep-lag-3`) | <= 40 | |
| sloppy dancer: 50% toward neutral, 0.4 s lag, more noise (`sloppy`) | 40-65 | B |
| beginner: arms roughly follow, legs mostly neutral, 0.5 s lag (`beginner`) | 30-55 | B/C |
| upper-body framing, arms danced well, legs invisible (conf 0) (`upper-body-arms`) | 35-65 | |
| late joiner, dances well only the last 40% (`late-joiner`) | 25-50 | |
| perfect copy with a 3 s tracking dropout in the middle of a 15 s dance (`dropout-3s-mid`: no detection 6-9 s) | 65-85 | |
| GEOMETRY CONTROL: perfect copy in webcam PIXEL space of a different aspect (640x480 and 320x240, random offset/scale), with the reference normalized from a 406x720 portrait video (`geometry-640x480`, `geometry-320x240`) | >= 92 | S |
| still neutral full body / still upper body only / REAL still user fixtures `user-still-upperbody-session1.json`, `user-session2-upperbody.json`, `user-session3.json`, all rank A under legacy (`still-full`, `still-upper`, `real-still`, `real-session2`, `real-session3`; extras `real-frozen`, `sweep-blend-1`) | <= 10 | C |
| MIRROR-STYLE perfect copy, i.e. flipped in x AND left/right labels swapped (`mirror-style`; extra `mirror-style-640x480`). The scorer must detect orientation automatically. | >= 92 | S |
| one reference frame frozen for the whole dance (`frozen-ref-frame`: the 2.5 s frame, as in the research; extra `hold-ref-pose`: the most distinctive frame) | <= 15 | C |
| idle sway / bounce (`idle-sway`) | <= 15 | C |
| random energetic flailing (`flail`) | <= 20 | C |
| constant distinctive pose: T-pose / arms up (`hold-tpose`, `hold-arms-up`) | <= 15 | C |
| reversed choreography: time-reversed reference (`reversed-choreo`) | <= 35 | C |
| wrong choreography: circular shift by half (`wrong-choreo`) | <= 35 | C |

These scenarios are report-only (no target):

| scenario | what it shows |
| --- | --- |
| `geometry-exact-640x480` | exact copy with no lag or noise, a pure coordinate test; about 100 is expected |
| `mirror-style-good` | should land in the good range |
| the other sweep points | sweep context |

**Ranks** (keep `'S'|'A'|'B'|'C'`): perfect → S, good → A (or S), sloppy → B, beginner → B/C, every cheat → C.

**Sweep checks:**

| sweep | rule |
| --- | --- |
| `blend` | strictly decreasing (>= 0.1 pt per step) |
| `noise` | strictly decreasing (>= 0.1 pt per step) |
| `jitter` | non-increasing (1 pt tolerance) |
| `lag` (0, 0.1, 0.25, 0.5, 1.0, 1.5, 3.0 s) | non-increasing for every step that ends beyond 0.3 s (1 pt tolerance), and "progressive": no step may drop more than 30 pts per 0.5 s of added lag (no cliff) |

**Perf:** the 60 s scenario (1800 reference frames, about 1750 user frames) must score in < 1500 ms. Both the first run and the median of 3 count.

## Writing a candidate scorer

Put it in `scripts/scoring-lab/candidates/<name>.ts` or `candidates/<name>/index.ts`. Files starting with `_` and directories without an entry file are ignored by `--scorer all` / `--list`.

The loader checks, in order:

1. `export function score(reference, user, sectionDuration?, options?)` (lab-aware)
2. `export default function (...)` (lab-aware)
3. `export default { score, ... }` (lab-aware)
4. `export function computePostDanceScore(reference, user, sectionDuration?, options?)` (drop-in; called like the app will call it)

**The 4th argument, `options`:**

```ts
interface ScoreOptions {
  /** Reference video pixel size; reference keypoints are x / width, y / height (0-1 per axis). */
  referenceGeometry?: { width: number; height: number }
  /** LAB ONLY (forms 1-3): diagnostics context. Undefined in the app — never use it for the score. */
  lab?: { scenarioId; danceDuration; frames: DetectorFrame[]; recordPolicy; real }
}
```

- The runner passes `referenceGeometry` for every scenario unless `--no-geometry` is set.
- Form 4 gets exactly `{ referenceGeometry }`; legacy implementations ignore it.
- The production signature will be `computePostDanceScore(reference, user, sectionDuration = 10, options?: { referenceGeometry?: { width, height } })`.
- Users are always in webcam pixel space. Restore the reference geometry (`x * width`, `y * height`) before any angle or direction comparison.
- Without geometry, a scorer must still work. The app's fallback is the reference `<video>`'s `videoWidth/videoHeight`.

**Return value:** a DTWResult-like object with `overallScore` (0-1) and `rank`, plus optional `sectionScores`, `bodyPartScores` and `alignment`. Any other field (e.g. `coverage`, `latencyMs`, `orientation`) is kept, shown with `--show` and dumped with `--json`.

**Optional exports** (or fields of the default object):

- `name`: label in reports.
- `recordPolicy`: how DanceMode would record user poses for this candidate:
  - `'presence'` (default): DanceMode @ 7aebdba records only frames that pass `checkPresence()` (6 of 8 shoulders/elbows/hips/knees at >= 0.5). Absent time is silently dropped.
  - `'detected'`: every frame where the detector returned a pose. The main checkout's shipped DanceMode does this.
  - `'all'`: every frame; no detection becomes `{ time, pose: { keypoints: [] } }`.
  - a function `(frame: DetectorFrame) => TimestampedPose | null` for a custom rule.
- `liveDeps: Partial<LiveDeps>`: swap `comparePoses`, `compareMoveVelocity`, `checkPresence`, `createMovementTracker`, `detectKeyPoses`, `difficultyConfigs` or `keyPoseOptions` in the `--live` replica. The defaults import from `src/`, so in-place `src/` edits are picked up.
- `simulateLive(input: LiveInput): LiveResult`: replace the live replica entirely.

```ts
// scripts/scoring-lab/candidates/my-candidate.ts
import type { ScoreFn } from '../scorer'
import { denormalizePoses } from '../data'
export const name = 'my candidate'
export const recordPolicy = 'all'
export const score: ScoreFn = (reference, user, sectionDuration = 10, options) => {
  const ref = options?.referenceGeometry ? denormalizePoses(reference, options.referenceGeometry) : reference
  // ... compare ref (reference pixels) with user (webcam pixels) ...
  return { overallScore: 0, rank: 'C', latencyMs: 0 }
}
```

A small working example is `examples/coverage-gated.ts`.

### Baseline candidates (beat these)

| candidate | what it is | record policy |
| --- | --- | --- |
| `legacy` (`baseline/scorer.ts`) | frozen `src/scoring/**` @ 7aebdba: unconstrained DTW, 300-frame subsampling, ranks S>=75/A>=55/B>=35 | presence |
| `research-window` | faithful port of the user's REA candidate (`groovy-research/rea-justdance-20261015/scripts/temporal-experiment.mts`, full-rate variant):<br>• geometry restore from `options.referenceGeometry`<br>• per reference frame, best user frame within ±0.16 s<br>• motion factor `0.4 + 0.6 * compareMoveVelocity` over 0.3 s where the reference moves<br>• uncovered frames count 0<br>• rank = legacy `computeRank` | detected |
| `pulse-keypoints` | faithful port of Codex's PulseJudge (`groovy/experiments/pulse-party/core.mjs`, see `candidates/pulse-keypoints/core.ts`):<br>• canonical skeleton<br>• 9-point keypoint distance (0.7) + `comparePoses` (0.3)<br>• motion gating<br>• ±0.16 s window per event, PERFECT 100 / GOOD 60 / MISS / TRACKING LOST<br>• `overallScore = points / maximum`<br>Events come from the precomputed `ref-ineedu-15s.pulse-analysis.json` when the reference matches it exactly; otherwise from `candidates/pulse-keypoints/analyze.ts`, a motion-only TS port of `analyze.py` (no audio).<br>No auto-mirror (the prototype has a manual Mirror checkbox) and no latency compensation. | all |
| `honest-interim` | the interim scorer shipped in the main checkout's `App.tsx`:<br>• ±0.2 s window around one latency in [0, 0.3] s<br>• coverage and missing-joint penalty<br>• motion floor 0.25<br>• mirror-orientation search<br>• ranks S>=85/A>=70/B>=50<br>It does NOT restore geometry and ignores `options`. | detected (as shipped) |

All three ports import the frozen `baseline/scoring/*`, which is byte-identical to `src/scoring` in both checkouts at copy time. Their numbers therefore do not drift while scoring-v3 edits `src/`.

`sanity-baselines.ts` re-runs both prototypes' own controlled experiments through the ports, and its results match the published numbers exactly:

| port | published experiment | results |
| --- | --- | --- |
| research-window | `temporal-experiment.mts` | same 100, 100 ms 100, 1.5 s late 41.5, 3 s late 39.5, frozen 33.6, reversed 47.4, 3 s gap 80.2, jitter 95.3 |
| pulse-keypoints | `test.mts` (/1400) | same / scale+translation / body ratios / 100 ms 1400; 600 ms, 1500 ms, frozen, reverse 0; gap 5-8 s 1200; no person 0 (14 TRACKING LOST) |

The analyze.ts curves match the Python curves to about 1e-14.

`baseline/` is a verbatim frozen copy of `src/scoring/**` and `DIFFICULTY_CONFIGS` at HEAD 7aebdba. `baseline/scorer.ts` reproduces the BEFORE numbers, post-dance and live. Do not edit `baseline/scoring/*`.

## Reference geometry

`scripts/extract_poses.py` stores MediaPipe x/y normalized by the source video's width and height separately, while `src/pose/detector.ts` gives webcam landmarks in PIXELS. The I Need U fixture comes from a 406x720 portrait Short, so in normalized coords horizontal distances are stretched 1.77x relative to vertical ones.

The geometry is stored in a sidecar next to the fixture, `tests/fixtures/scoring/ref-ineedu-15s.meta.json`:

```json
{ "width": 406, "height": 720, "coordinateSpace": "normalized" }
```

This is the format `extract_poses.py` should write for new dances; at runtime the app can fall back to `videoWidth/videoHeight`. The values were verified on `C:/Users/jink/groovy/data/dances/job_1792096280066_1/video.mp4`, whose `poses.json` is byte-identical to the fixture:

- **ffprobe 9.0.2:** h264 406x720, SAR 1:1, DAR 203:360, 30 fps, 450 frames, no rotation side data.
- **MP4 boxes:** the video `tkhd` is 406x720 with an identity matrix, and `avc1` is coded at 406x720.

`data.ts` loads the sidecar (`loadReferenceMeta`, `REF_INEEDU_GEOMETRY`) and provides `denormalizePose(s)`.

**How synthetic users are built:**
1. The reference is denormalized to reference pixels (`x * width`, `y * height`, i.e. isotropic, physically correct).
2. Each synthetic body is built in that space as a kinematic model.
3. It is mapped into the webcam's pixel space by a uniform scale plus offset, with aspect preserved:
   - **default camera:** 320x240 framing like the real sessions;
   - **geometry controls:** `placement: 'random'` in 640x480 or 320x240, with the body at 45-90% of frame height and anywhere in the frame.

So a perfect copy has the same joint angles as the geometry-restored reference, not as the raw normalized one. `selfcheck.ts` verifies that an exact 640x480 copy scores `comparePoses` 1.0000 against the restored reference and 0.959 against the raw normalized reference, which reproduces the research's 100 vs 95.85.

## Scenarios

Synthetic users come from `synth.ts` (`synthesizeUser(ctx, spec, rng)`). Every scenario uses `rng.fork(<id>)`, so scenarios are independent of each other and of ordering. All points of a sweep share one RNG label, so camera, clock and noise shapes are identical and only the swept value changes.

**Presets** (`PRESETS` in `scenarios.ts`):

| preset | settings |
| --- | --- |
| `perfect` | lag 0.1 s, angle error 0.02 rad, jitter 0.003, wander 0.005 |
| `good` | lag 0.3, blend 0.15 (85% amplitude), angle error 0.12 rad, timing jitter 0.08 s, 3 dropouts of 0.15-0.45 s |
| `sloppy` | lag 0.4, blend 0.5, angle error 0.28, timing jitter 0.15, 2 dropouts |
| `beginner` | lag 0.5, blend arms 0.35 / torso 0.6 / legs 0.85, angle error 0.3, timing jitter 0.2 |
| `still` | jitter 0.002, wander 0.01, similar to the real still sessions |

**Lag and the recording clock:** the recording clock runs 0-60 ms ahead of the video (`videoDelay`, like `recorder.start()` before `play()` settles). The apparent lag on the recording clock is therefore `lag + videoDelay`.

**Scenarios by row:**

| row | scenarios and how they are built |
| --- | --- |
| perfect / lag | `perfect`, `perfect-lag0.25`; `late-1.5s` and `late-3s`: the user holds the start pose first, and the last 1.5 s / 3 s of choreography is never danced because the dance ends with the video |
| good | `good`, `good-lag0.6`, `good-lag1.0` |
| sloppy / beginner | `sloppy`, `beginner` |
| upper body | `upper-body-arms`: good, waist-up; legs conf 0.0001-0.01, hips about 0.7 at the bottom edge |
| late joiner | `late-joiner`: good, no detection for the first 60% |
| dropout | `dropout-3s-mid`: perfect, no detection 6-9 s |
| geometry | `geometry-640x480`, `geometry-320x240`; extra `geometry-exact-640x480` |
| still | `still-full`, `still-upper`; real fixtures `real-still` (152 frames, 9.59-14.62 s), `real-session2` (51 frames, 5.14-13.22 s, 3.7 s gap), `real-session3` (107 frames, 6.76-16.07 s, 4.4 s gap); extras `real-frozen` (session 1's first frame for the whole dance) and `sweep-blend-1` |
| mirror | `mirror-style`, `mirror-style-640x480`; report-only `mirror-style-good` |
| frozen | `frozen-ref-frame`, `hold-ref-pose` |
| idle | `idle-sway`: side sway, knee bounce, loose arms |
| flail | `flail`: smooth random joint rotations plus body travel |
| hold | `hold-tpose`, `hold-arms-up` |
| reversed | `reversed-choreo`: perfect quality, time-reversed |
| wrong | `wrong-choreo`: good quality, shifted by half (circular) |

**Sweeps** (all on the `perfect` preset):

| sweep | values |
| --- | --- |
| `sweep-lag-*` | 0, 0.1, 0.25, 0.5, 1.0, 1.5, 3.0 s |
| `sweep-blend-*` | 0 ... 1 |
| `sweep-noise-*` | angle error 0 ... 0.5 rad |
| `sweep-jitter-*` | 0.003 ... 0.08 torso lengths |

**Performance:** `perf-60s` is a good dancer on the reference looped 4x (60 s), with 8 dropouts.

The real fixtures were presence-filtered by the app, so every record policy gets the same frames for them. Their `options.lab.frames` fill the unknown time before, between and after the recorded frames with `pose: null`.

### Synthetic user model (`synth.ts`)

Each detector frame goes through these steps:

1. **Recording clock:** 30 fps, 6% interval jitter, occasional hiccups; the video starts 0-60 ms after the recorder.
2. **Video clock.**
3. **Intended reference time:** `shift + tempo * (videoTime - lag) + warp(videoTime)`, optionally reversed.
4. **Motion source as a kinematic pose:** 35 points (33 keypoints + mid-hip + mid-shoulder), each bone a relative angle plus length, in reference pixels.
5. **Blend** toward a neutral standing pose, per body group.
6. **Smooth execution error** on joint rotations.
7. **Forward kinematics.**
8. **Mirror:** reflect about the mid-hip and swap left/right labels.
9. **Keypoint jitter:** white noise plus AR(1) wander; extremities are noisier.
10. **Webcam camera:** uniform scale plus offset into the W x H frame.
11. **MediaPipe-like confidences and visibility mask.**
12. **Presence window and dropouts** (no detection).

`UserSpec` fields:

| field | values |
| --- | --- |
| `motion` | `reference`, `neutral`, `sway`, `flail`, `hold` (`tpose`/`armsUp`/`refFrame`), `fixedPixelPose` |
| timing | `lag`, `timingJitter`, `tempo`, `shift`, `reverse` |
| execution | `blend` (number or `{ torso, arms, legs }`), `angleError` |
| mirror and noise | `mirror`, `jitter`, `wander` |
| detection gaps | `dropouts`, `gaps`, `presentFrom` |
| framing | `framing.visibility` (`full`/`upper`) |
| camera | `camera` (`width`, `height`, `placement: 'default'|'random'`) |
| clock | `fps`, `frameJitter` |

### Live replica (`live.ts`)

`simulateDanceModeLive({ timeline, frames, difficulty }, deps)` replays DanceMode's `danceLoop` frame by frame:

- auto-detected key poses (`minGapSeconds 3`, `heldFrameCount 8`, `distinctiveThreshold 1`);
- the presence gate;
- `MovementTracker` with `movementFactor`;
- `move` scoring (0.6 velocity + 0.4 pose) vs static scoring;
- the difficulty window;
- judging only the next key pose, with misses when the user is absent past `ts + 0.5`;
- the loop end: video end or last key pose + 2 s.

Points are a flat 100 / 50 per perfect / good, because of DanceMode's stale `combo` closure. Update this replica if DanceMode's judging changes.

## Helper exports for candidates

**`data.ts`:**
- Geometry and fixtures: `ReferenceGeometry`, `REF_INEEDU_GEOMETRY`, `loadReferenceMeta()`, `metaFileFor()`, `denormalizePose()`, `denormalizePoses()`, `geometryFromAspect()`.
- Loaders: `loadReference()` (`{ timeline, poses, geometry, aspect }`), `loadReferenceTimeline()`, `timelineToTimestamped()`, `loadRealStillUser()`, `loadRealSession('session1'|'session2'|'session3')`, `REAL_SESSION_FIXTURES`, `REF_PULSE_ANALYSIS_FIXTURE`.
- Timelines: `loopTimeline()`, `timelineDuration()`, `shiftTimes()`, `summarizeSession()`.
- Poses: `canonicalKeypoints()`, `getKeypoint()`, `poseFromArrays()`, `torsoLength()`, `mirrorPose()` (x flip + label swap).
- Constants: `KP`, `LEFT_RIGHT_SWAP`, `LEG_KEYPOINTS`, `REF_INEEDU_ASPECT`, `WEBCAM_WIDTH/HEIGHT`, `fixturePath()`, `loadJson()`.

**`synth.ts`:**
- RNG: `createRng()` / `mulberry32()` / `hashString()` / `smoothNoise()`.
- Synthesis: `createSynthContext(timeline, geometry)`, `synthesizeUser()`, `recordSession()`, `framesFromRecorded()`, `detectorClock()`, `makeCamera()`.
- Kinematics: `decompose`, `compose`, `blendKin`, `holdPoseKin`, `sampleReference`, `bodyFromNormalized`, `BONES`.
- Types: `UserSpec`, `MotionSpec`, `CameraSpec`, `DetectorFrame`, `RecordPolicy`.

**`scenarios.ts`:**
- Building: `buildScenarios({ seed, geometry?, aspect?, perf?, filter? })`, `userPosesFor()`, `getReferenceBundle()`, `scenarioIds()`.
- Targets: `TARGET_ROWS`, `targetRow()`.
- Parameters: `PRESETS`, `SWEEPS`, `FREE_LATENCY_S` (0.3), `MID_DROPOUT`, `FROZEN_REF_TIME`, `TUNING_SEED` (1), `REPORTING_SEED` (2).

**`evaluate.ts`:**
- Running: `evaluateScenario()`, `evaluateAll()` (option `passGeometry`), `checkSweeps()`, `summarize()`, `runPerf()`, `runLive()`.
- Formatting: `formatComparison()` and the other formatters.
- Constants: `PERF_BUDGET_MS`, `LAG_MAX_DROP_PER_HALF_SECOND`.

**`live.ts`:** `simulateDanceModeLive()`, `danceModeKeyPoses()`, `danceEndVideoTime()`, `DEFAULT_LIVE_DEPS`, `DANCE_MODE_KEYPOSE_OPTIONS`, and types `LiveDeps`, `LiveResult`.

**`scorer.ts`:** `loadScorer()`, `listCandidates()`, `resolveScorerPath()`, and types `ScoreFn`, `ScoreOptions`, `ScoreContext`, `ScoreResultLike`, `LoadedScorer`, `Rank`.

**Reusable pulse pieces:**
- `candidates/pulse-keypoints/core.ts`: `canonicalize`, `keypointDistance`, `mirrorPose`, `PulseJudge`, `prepareReference`.
- `candidates/pulse-keypoints/analyze.ts`: `chartMotionOnly`, `motion`, plus numpy/scipy ports (`gaussianFilter1d`, `findPeaks`, `unwrap`, `gradient`, `percentile`).

Example vitest usage:

```ts
import { buildScenarios } from '../../../scripts/scoring-lab/scenarios'
import { evaluateAll, summarize } from '../../../scripts/scoring-lab/evaluate'
import { loadScorer } from '../../../scripts/scoring-lab/scorer'

const scorer = await loadScorer('src/scoring/dtw.ts')
const results = evaluateAll(scorer, buildScenarios({ seed: 2, perf: false, filter: /^(real-|perfect$)/ }))
expect(summarize(results).failed).toEqual([])
```

## Caveats

- **Scenario data never depends on `src/`.** Recording (`presence`), the dance end time and the `hold-ref-pose` frame all use the frozen `baseline/` code.
- **The real fixtures are presence-filtered.** The frames outside the recorded spans and gaps are unknown, so every record policy gets the same frames for them.
- **Session 3 runs past the video end:** its recording clock reaches 16.07 s against a 15 s video, i.e. the recording/video clock offset can exceed 1 s.
- **Synthetic users are idealized.** They are smooth kinematic perturbations of one dancer. They do not model a different body shape, depth or turning, or detector failure modes such as left/right swaps.
- **Positive data is optimistic.** It comes from synthetic copies; real amateurs may score lower. Use `--seed 1,2,3` to check that a scorer is not overfit to one draw.
