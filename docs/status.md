# Project Status

**Last updated:** 2026-10-16

**Current state:** DanceCraft - AI Motion Arena integrated on top of Groovy (needs a live-webcam rehearsal before the event)

## DanceCraft (2026-10-15)

### Recording clocks and corrected promotional replay (2026-10-16)
- Fixed capture startup and frame/pose identity; new pose entries store reference/music `time` and recorded `videoTime`, including empty detections. Replay follows the saved clocks and corrects decoder drift; no backend migration.
- Verification: 531 unit tests, TypeScript and production build, the two coach browser tests, two real MediaRecorder browser regressions, and nine exporter timing/safety tests pass. Browser regressions include delayed inference, a reference stall, automatic/manual frame capture, frame identity, and reference-only playback.
- Added `scripts/export_replay.py` with explicit legacy offsets, recorded-anchor mapping, VFR preservation, overlap trimming, input hash checks, and destination protection. Guide: `docs/video-sync.md`.
- Replaced the promotional videos and slide 5 poster. Session 12 lacked the music clock, so its comparison uses a documented constant 1.30-second editorial estimate from motion cues. Original recordings, stored poses, and scores are unchanged; this is not a recovered historical playback clock.
- Promoted the approved corrected clip to the main README with a poster and added Wasil's Instagram/LinkedIn and Jin's LinkedIn using the supplied URLs and team QR.
- Updated the running preview at `http://localhost:5174` by publishing the verified static build without restarting the service. It serves `index-CdbGwg-d.js`; live homepage smoke check passed with three library cards and no page errors. A fresh physical-camera rehearsal is still required.

### README and original artwork (2026-10-16)
- Audited the README's rematch claim: local retry callbacks, previous-attempt comparison, and host-score comparison are wired, but no complete two-attempt dance/practice/retry test or live-webcam rehearsal verifies that loop. Renamed the step "Retry and compare" and clarified the concept artwork; there is no online party/rematch implementation.
- Uploaded the approved replay as a GitHub video attachment and replaced the top poster link with its standalone URL for an inline player. The upload copy is 5.35 MB; audio packets, stream starts, and duration match the approved promotional replay.
- Simplified the lower presentation section to the pitch deck link only; retained the approved promotional replay at the top of the README.
- Replaced the inherited upstream README content and its screenshot with a DanceCraft introduction, original generated banner/feature art, current setup, and demo links.
- Described the Claude Code rebuild in terms of the product experience and named the rebuilt modules; retained a concise Groovy credit and the original MIT license.
- Labeled the new artwork as illustrative and recorded the generation prompts in `docs/images/generation-prompts.json`. Application code and the running demo were unchanged.

Host records a short dance, challengers dance it live, Claude reads the real scores and writes a practice plan that drives PracticeMode, then the challenger retries and battles the host's score. Runbook: `docs/dancecraft.md`.

### Final verification and local demo (2026-10-15)
- Promoted the frozen `keymoment-hits` candidate through `src/scoring/dancecraft.ts`; reference video aspect ratio is provided from loaded video metadata. The interim scorer remains available in source.
- Independent held-out lab comparison: 39/39 target checks and 28/28 ranking checks, ahead of the interim scorer (11/39 and 16/28). A second production-adapter seed also passed 39/39 and 28/28; scale, translation, mirror, malformed/duplicate poses, stillness and missing-body checks passed. These checks use synthetic perturbations of one routine and recorded still sessions, not a human dance-accuracy benchmark.
- Final integrated source: 524/524 unit tests, TypeScript build and production build pass. Coach browser smoke tests passed 2/2. Changed scoring/App/DanceMode files have no ESLint errors and three existing DanceMode hook warnings. Whole-repository lint still has pre-existing errors in other files; older bundled-dance and visual-baseline E2E cases remain stale.
- Desktop/mobile production browser check: three actual dance cards, working latest-history replay with both reference and user videos decoded, replay mirror persistence, no page errors or horizontal overflow. No physical-webcam rehearsal was performed by this verification.
- Local frontend is restored at `http://localhost:5174`, using the verified external `final-app-dist` build with `VITE_API_BASE=http://localhost:3002`; backend was restarted at `http://localhost:3002`. Artifacts and screenshots are under `C:/Users/jink/Documents/DanceCraft-Submission/evidence/`.
- Latest backend fallback was checked offline: framing and low movement are explained first; out-of-frame legs receive framing guidance, not a technique penalty. The configured Anthropic key reaches the API but the direct request was rejected for insufficient credit balance. Live Claude generation remains blocked by billing; `claudeEnabled: true` means configured, not a successful paid inference.

### What shipped
- **Shared contract** `src/coach/types.ts` + pure helpers `src/coach/plan.ts` (sanitize/fallback plan, `decideBattle`, fallback verdict) used by both server and client
- **Coach API** `server/routes/coach.ts` + `server/coach/*`: `GET /api/coach/status`, `POST /api/coach`, `POST /api/coach/battle`; Claude via `@anthropic-ai/sdk` structured outputs (`claude-sonnet-5-5`, effort low, server-side refusal fallback); zod-validated bodies (400 on bad input); every failure returns HTTP 200 `source: 'fallback'` from the deterministic built-in coach
- **Results screen**: AI Coach panel (summary, focus, section/speed/reps, cue, improvement, "Practice this"), "Beat <host>?" battle panel with crown/confetti and mini leaderboard, "+N% vs last try" chip, per-section deltas, weakest-section highlight; client `src/api/coach.ts` degrades to the built-in coach when the server is down
- **Coach drill in PracticeMode**: plan seeks to its section, loops at the plan speed for N reps (`src/coach/drill.ts`), HUD + drill-complete overlay ("Try Full Dance", "Drill Again", "Free Practice"); rAF loop rewritten to read loop bounds from refs (fixes stale A/B loop bug)
- **Characters**: `TargetPoseFigure` gains `character` (mannequin unchanged pixel-for-pixel, plus buddy/host/challenger), `DancingCharacter` animates reference poses (`src/pose/interpolate.ts`) or an idle groove
- **Arena** (localStorage, `src/storage/arena.ts`): player name + host toggle in the difficulty modal, attempt log, previous attempt (read before recording), host score to beat, leaderboard; home screen rebranded "DanceCraft" with buddy hero + score-to-beat on cards
- **Local host dance**: `npm run add-dance` (`scripts/add-local-dance.mjs`) imports a video into `public/dances/` + `manifest.json`, loaded by `src/storage/bundledDances.ts` even when the API server is down; `scripts/setup-windows.ps1`; `PYTHON_PATH` resolved at run time (fixes `.env` being ignored)

### Integration fixes (2026-10-15)
- DanceMode crashed ("Rendered fewer hooks than expected") when reference poses failed to load - hook moved above the early return; DanceMode and PracticeMode error screens now have a Back button and a clear message for dances without pose data
- Coach plan / battle verdict cached per request so Replay -> back and Practice -> back don't re-ask Claude (and the plan doesn't change under the player)
- Back from a coach drill returns to the results screen instead of home
- The host re-dancing without ticking "I'm the host" is recorded as a host run (no more "Wasil vs Wasil" battle) - `isHostAttemptFor()`
- `.env.example` no longer pins `CORS_ORIGIN` to :5173 (default allows any localhost port); imported videos in `public/dances/` are git-ignored
- e2e heading assertions updated to "DanceCraft"; new `tests/e2e/dancecraft-coach.spec.ts`

### Hero, clip, why-this-score, evidence-aware coach (2026-10-15, later)
- Home hero with "Start the challenge" / Practice / + Add Dance, dancing Coach Buddy + host, score to beat + top 3, how-it-works strip ("+ Add Dance" moved from the header into the hero)
- Results: "Your clip" card + side-by-side replay, "Why this score?" evidence block, out-of-frame parts greyed; per-video Mirror toggle in Practice and Replay
- Coach request + arena attempts carry the honest-scoring evidence; Claude prompt, built-in coach and built-in battle announcer put framing/movement first and never judge an untracked body part
- Verified: `npx tsc -b`, 524 unit tests, eslint (3 known DanceMode warnings), scratch production build, `dancecraft-coach.spec.ts` 2/2
- Known: 19 older e2e tests (home-navigation, dynamic-library, dance-mode, dance-lifecycle, placeholder, practice-mode card button) expect a bundled "Sample Dance" / `.dance-card-delete` that no longer exist (the bundled list was already empty at HEAD 7aebdba); `visual-baseline` snapshots need regenerating. The backend restart is complete.

### Verified
- `npx tsc -b`, `npm run build`, 413 unit tests (27 files), eslint clean on all new/changed files
- Server smoke test without an API key: status, plan (fallback, valid plan), 400 on invalid bodies, battle verdict
- Playwright (fake webcam, mocked API): results screen with coach + battle + delta chip (exactly one coach and one battle request under StrictMode), drill-ready card in PracticeMode, back to results without re-asking, home screen with buddy + score to beat

### Not verified yet (needs a real webcam / real key)
- Real dancing -> scoring -> coach plan with a live Claude key; drill rep counting against a real reference video in the browser; visual baselines (`visual-baseline.spec.ts`) need regenerating after the rebrand

## Phase 0-5: (COMPLETE)

All foundation, polish, library, recording/replay, practice mode, and testing phases complete.

## Phase 6: Pose Detection Overhaul & UX (COMPLETE)

- MediaPipe BlazePose Heavy (offline) + Full (browser) — both outputting all 33 landmarks
- Post-processing pipeline (outlier rejection, interpolation, temporal smoothing)
- Full import pipeline with progress tracking
- Debug/Edit mode with key pose editing

## Phase 7: UX Polish & Practice Mode Redesign (COMPLETE - 2026-03-15)

### Pose Figure Upgrade
- Replaced stick skeleton with **tapered capsule mannequin** figure — **COMPLETE**
- Each body segment is a distinct shape (thigh, calf, upper arm, forearm) with dark outlines — **COMPLETE**
- Square canvas adapts to both wide and tall poses — **COMPLETE**
- Proportional sizing uses min(width, height) to prevent fat limbs — **COMPLETE**

### Full 33-Landmark Pipeline
- Upgraded from 17-keypoint MoveNet format to **full 33 MediaPipe BlazePose landmarks** — **COMPLETE**
- Added hand landmarks (pinky, index, thumb) for wrist angle scoring — **COMPLETE**
- Added foot landmarks (heel, foot_index) for ankle angle scoring — **COMPLETE**
- Skeleton connections include hands and feet — **COMPLETE**
- All existing dance data re-extracted with 33 landmarks — **COMPLETE**
- Removed bundled sample dances (stale data) — **COMPLETE**

### Key Pose Editor (Edit Mode)
- Renamed Debug → Edit in UI — **COMPLETE**
- Add/remove/move key poses — **COMPLETE**
- Per-video mirror toggle — **COMPLETE**
- Tutorial video URL field — **COMPLETE**
- Save/reset with localStorage persistence — **COMPLETE**

### Dance Mode Improvements
- Cue timing synced to video.currentTime (was wall clock) — **COMPLETE**
- Custom key poses from edit mode used during gameplay — **COMPLETE**
- Mirror toggle applies to reference video — **COMPLETE**

### Practice Mode Redesign
- **Tutorial tab**: YouTube embed directly in practice mode, full-screen — **COMPLETE**
- **Pose scoring overlay**: Toggle on free practice, real-time grade display — **COMPLETE**
- Click video to pause/play — **COMPLETE**
- Two resume options: instant Play or 3-2-1 countdown — **COMPLETE**
- No blur on pause overlay — **COMPLETE**
- Fixed scroll issue (position: fixed) — **COMPLETE**

### Replay Mode Overhaul
- Full-screen layout with reference video large, user PIP — **COMPLETE**
- Audio plays from reference video — **COMPLETE**
- Fixed Infinity:NaN time display — **COMPLETE**
- Key pose indicators on video and timeline — **COMPLETE**
- Click to pause/play — **COMPLETE**

### Import Pipeline
- Real-time pose extraction progress (percentage) shown on cards — **COMPLETE**
- Progress bar on processing dance cards — **COMPLETE**

### UI Fixes
- Three-dot menu icon centered — **COMPLETE**
- Cleaned up stale data (9 orphan dance folders removed) — **COMPLETE**

## Scoring System Overhaul (COMPLETE - 2026-03-15)

Three-layer defense against inflated scores (absent/still users getting "Perfect"):

### Layer 1: Presence Gate
- `checkPresence()` in `src/scoring/presence.ts` — requires 6 of 8 core keypoints visible at ≥0.5 confidence
- If user not present, key pose windows expire as misses

### Layer 2: Movement Energy Gate
- `MovementTracker` class in `src/scoring/movement.ts` — rolling 1.5s window
- Blends angular velocity (60%) + torso-normalized positional velocity (40%)
- Movement factor (0-1) multiplied into similarity scores before threshold checks
- Standing still → factor ~0 → always a miss

### Layer 3: Torso-Relative Spatial Comparison
- `computeSpatialSimilarity()` in `src/scoring/comparison.ts`
- Compares 8 bone segment direction vectors relative to torso frame
- Blended: `overallScore = 0.6 * angleScore + 0.4 * spatialScore`
- Catches poses with similar angles but different spatial configs (arms forward vs arms back)

### Threshold Adjustments
- Perfect: 0.85 → 0.80, Good: 0.65 → 0.55
- Rank thresholds: S ≥75%, A ≥55%, B ≥35%

## Known Bugs

- Visual regression baselines predate the DanceCraft rebrand and will fail until regenerated
- Only one dancer is tracked at a time (MediaPipe `numPoses: 1`); spectators in frame can steal tracking

## Test Summary

- Unit tests (Vitest) — 413 passing (27 files) as of 2026-10-15
- 65+ e2e tests (Playwright) — all passing

## What's Next

- DanceCraft: full rehearsal on the event laptop with a real webcam, the host's dance (`npm run add-dance`) and a real `ANTHROPIC_API_KEY`; regenerate visual baselines
- Multi-person tracking (plan in docs/plans/multi-person-tracking.md)
- History → replay (persist session data for later playback)
- Threshold tuning based on playtesting
