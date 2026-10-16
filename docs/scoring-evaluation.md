# DanceCraft scoring evaluation

The `keymoment-hits` candidate replaces the interim post-dance scorer. Its production entry is `src/scoring/dancecraft.ts`. The live key-pose feedback retains the existing game system; this evaluation concerns the final post-dance score.

## Selection

An independent run used seed 20261015 after the candidates had been tuned. No parameters changed after that run. The harness compared three new designs and four baselines. All scores below refer to this project's calibration targets, not to measured human dance accuracy.

| Scorer | Target checks passed | Rank checks passed | Median time for a 60 second sequence |
| --- | --- | --- | --- |
| Original legacy | 11 / 39 | 11 / 28 | 572 ms |
| REA research window | 9 / 39 | 17 / 28 | 242 ms |
| Pulse keypoints | 19 / 39 | 24 / 28 | 46 ms |
| Interim honest scorer | 11 / 39 | 16 / 28 | 491 ms |
| Dynamics correlation | 37 / 39 | 27 / 28 | 216 ms |
| Keymoment hits | 39 / 39 | 28 / 28 | 51 ms |
| Normalized motion | 37 / 39 | 27 / 28 | 187 ms |

The production port then passed all 39 target checks, all 28 rank checks, and every sweep check on another unseen seed, 871239, using the actual app's detected-frame recording policy. The interim scorer passed 12 / 39 targets and 16 / 28 rank checks in that second run.

## Anti-cheating and geometry checks

On the second run, a still full body scored 3.6%, random energetic flailing 11.9%, and a frozen reference frame 2.3%. A perfect synthetic copy scored 98.6%. Mirror-style controls and both camera-size controls exceeded 98%. Missing legs reduced credit and produced an out-of-frame flag for coaching rather than a technique judgment.

Additional checks verified identical scores under uniform scale factors from 0.35 to 3, translation, reordered frames, and duplicate frames. Nonfinite coordinates and invisible bodies scored zero. Sparse one-frame-per-second input scored below 3%. Reference geometry comes from the actual video metadata, restoring the reference coordinates to isotropic pixels before comparison.

## Limits

The harness varies one 15 second reference synthetically and includes three existing real still-person sessions. It does not establish fairness across body types, skin tones, mobility ranges, genres, viewpoints, multiple dancers, or moving cameras. The app tracks one dancer; spectators may capture tracking. A real dancer rehearsal of the final build remains necessary. Previous scores from older scorer versions are not directly comparable with v3; record a fresh host attempt for a fair challenge.

## Reproduce

After `npm install`, run:

```powershell
node --import tsx scripts/scoring-lab/run.ts --scorer legacy,research-window,pulse-keypoints,honest-interim,dynamics-correlation,keymoment-hits,normalized-motion --seed 20261015 --quiet
node --import tsx scripts/scoring-lab/run.ts --scorer production,honest-interim --seed 871239 --record detected --no-perf --quiet
```

The lab freezes the legacy baseline under `scripts/scoring-lab/baseline`. Candidate selection did not rely on a Claude-generated judgment or a model's subjective opinion.
