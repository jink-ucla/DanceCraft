# Work Log

## 2026-10-15 - Final scoring integration verification and local demo restore

- Verified the integrated key-moment scorer after its held-out win: all 524 unit tests and the TypeScript/production build pass. Changed-file lint has zero errors and three existing DanceMode hook warnings; repository-wide lint is not clean.
- Built outside the repository with the correct backend URL (`VITE_API_BASE=http://localhost:3002`) into `C:/Users/jink/Documents/DanceCraft-Submission/.build/final-app-dist`.
- Tested the production UI on a separate preview port and offline backend first, using actual dance/history data read-only. Desktop and mobile had no horizontal overflow or JavaScript page errors. The latest history user video and reference video decoded and played; replay mirror toggled and persisted.
- Checked the current built-in coach with low-motion, partial-framing evidence: it prioritized movement/framing and did not blame untracked legs for technique.
- Restored the already-stopped local services as hidden background processes: frontend 5174 and backend 3002. Unrelated 5173/3001 services were left alone. Screenshots, service logs and browser results are in the submission evidence folder.
- Anthropic inference is configured but blocked by the verified insufficient-credit response. No credential changes, funding actions or repeated paid API calls were made.

## 2026-10-15 - DanceCraft: hero, clip + why-this-score, evidence-aware coach (integration)

- Home hero (`src/components/Hero.tsx` + `Hero.css`): "Dance it. / Get coached by Claude. / Beat the host." with Start the challenge / Practice / + Add Dance, Coach Buddy + host dancing the first ready dance, score to beat + top 3, 3-step strip; dance-card titles clamp to 3 lines
- Results: "Your clip" card (inline recording, side-by-side replay, All clips), "Why this score?" (tracked %, motion match, latency, mirror-style, scorer notes), out-of-frame body parts greyed; one object URL per recording (`src/components/objectUrl.ts`); Mirror ON/OFF in Practice and Replay (per video)
- Coach evidence: client sends coverage / motionMatch / latencyMs / mirrored / untrackedBodyParts / notes (`src/components/scoreEvidence.ts`); server schema + prompt put framing/movement first and never coach an untracked part; built-in coach does the same
- Integration fixes: client evidence caps aligned with the server's request bounds (latency <= 2000 ms, <= 4 untracked parts of 20 chars) so a sanitized attempt can never get a 400; battle request now carries the challenger's evidence and the built-in battle announcer no longer blames/praises an out-of-frame part (was "sharpen those Legs (14%)" with legs out of frame) and puts framing/movement first; Practice speed buttons and timeline no longer run under the webcam inset
- Tests: 524 unit tests passing; `dancecraft-coach.spec.ts` now also asserts the hero CTAs, the clip card, the why-this-score block and the evidence in the coach request body (2/2 passing)

## 2026-10-15 - DanceCraft: AI coach, drill, character, arena

- Added shared coach contract (`src/coach/types.ts`) and pure plan/battle helpers (`src/coach/plan.ts`)
- Added Claude coach API: `GET /api/coach/status`, `POST /api/coach`, `POST /api/coach/battle` (`server/routes/coach.ts`, `server/coach/*`), structured outputs + zod validation, deterministic fallback on every failure
- Results screen: AI Coach panel, "Beat <host>?" battle panel + mini leaderboard, delta vs last try, weakest-section highlight; browser client `src/api/coach.ts` with offline fallback
- PracticeMode: coach drill (section loop at plan speed for N reps, HUD, complete overlay, "Try Full Dance"); fixed stale A/B loop bounds in the rAF loop (`src/coach/drill.ts`)
- Characters: buddy/host/challenger styles for `TargetPoseFigure`, new `DancingCharacter` + `src/pose/interpolate.ts`
- Arena: player setup + host toggle, attempt log, previous attempt, host score to beat, leaderboard (`src/storage/arena.ts`); DanceCraft home screen
- Local host dances: `npm run add-dance`, `public/dances/manifest.json`, `src/storage/bundledDances.ts`, `scripts/setup-windows.ps1`, `docs/dancecraft.md` runbook; `PYTHON_PATH` now resolved at run time
- Integration fixes: DanceMode hooks-order crash on pose-load errors; Back buttons on DanceMode/PracticeMode error screens; coach/battle responses cached across remounts (Replay/Practice -> back); Back from a coach drill returns to results; host re-runs detected by name (`isHostAttemptFor`); `.env.example` CORS no longer pinned to :5173; imported videos git-ignored; e2e headings updated
- Tests: 413 unit tests passing (baseline 195); new `tests/e2e/dancecraft-coach.spec.ts` (2 passing) with screenshots `tests/e2e/screenshots/dancecraft-{results,practice,home}.png`

## 2026-03-15 - Scoring System Overhaul (Three-Layer Defense)

- Added presence gate (`src/scoring/presence.ts`) — requires 6/8 core keypoints at ≥0.5 confidence
- Added movement tracker (`src/scoring/movement.ts`) — rolling 1.5s window, blends angular + positional velocity
- Added spatial comparison (`src/scoring/comparison.ts`) — torso-relative bone direction vectors, blended 60/40 with angle similarity
- Wired all three layers into DanceMode dance loop — absent/still users get misses
- Lowered thresholds to compensate for harder scoring (Perfect: 0.80, Good: 0.55, ranks: S≥75%, A≥55%, B≥35%)
- Updated test fixtures from 17-keypoint to 33-keypoint format
- Added new test fixtures: BARELY_VISIBLE_POSE, MINIMAL_PRESENCE_POSE, ARMS_FORWARD_POSE, standing/dancing sequences
- Added presence.test.ts (6 tests) and movement.test.ts (7 tests)
- Updated existing tests for new thresholds and 33-keypoint format
- All 73 scoring tests pass, TypeScript compiles clean

## 2026-03-15 - Phase 7: UX Polish & Practice Mode Redesign

- Replaced stick-figure skeleton with tapered capsule mannequin (distinct body segments with dark outlines)
- Upgraded entire pipeline from 17 MoveNet keypoints to full 33 MediaPipe BlazePose landmarks
- Added wrist angle + ankle angle joint definitions for hand/foot scoring
- Re-extracted all dance pose data with 33 landmarks
- Converted Debug mode → Edit mode with key pose add/remove/move, mirror toggle, tutorial URL
- Dance mode: cue timing synced to video.currentTime, custom key poses, mirror support
- Practice mode redesign: tutorial YouTube embed tab, pose scoring overlay toggle, click-to-pause, instant play vs countdown resume
- Replay mode: full-screen layout, audio playback, key pose indicators, fixed Infinity:NaN bug
- Import pipeline: real-time extraction progress percentage with progress bar on cards
- Removed stale bundled dances and orphan data folders
- Fixed three-dot menu icon centering, practice mode scroll issue
- Saved multi-person tracking plan to docs/plans/ for future work

## 2026-03-15 - Phase 6: Pose Detection Overhaul & UX Improvements

### Pose Detection Pipeline Overhaul
- **Offline pipeline**: Replaced MoveNet Lightning (TF.js, 192x192) with MediaPipe BlazePose Heavy (256x256)
  - Visibility went from ~30% to 95%+ high-confidence keypoints
  - Fixed `resize_with_pad` bug that was distorting skeleton coordinates by ~40% vertically
  - Changed to `resize` (stretch) to match browser behavior
- **Browser detection**: Replaced MoveNet Lightning (TF.js WebGL) with MediaPipe BlazePose Full (WASM+WebGL GPU)
  - Uses `@mediapipe/tasks-vision` PoseLandmarker in VIDEO mode
  - GPU delegate for ~120 FPS on M3 Max
  - Bundle size reduced from ~3MB (TF.js) to 383KB (MediaPipe loaded from CDN)
  - Same 17-keypoint output format — zero changes needed in scoring/UI code
- **Post-processing pipeline** added to offline extraction:
  - Anatomical outlier rejection (impossible limb lengths)
  - Velocity-based outlier rejection (sudden jumps)
  - Cosine interpolation for missing keypoints (up to 1.5s gaps)
  - Adaptive temporal smoothing (one-euro-filter-inspired: smooth slow movement, preserve fast)
- Re-extracted all 3 dance pose data files with new pipeline

### Import Pipeline Fixes
- Fixed `extract_poses.py` trying to re-download already-downloaded videos (was passing file path as URL)
- Fixed Python binary: `python` → `.venv/bin/python3` (configurable via PYTHON_PATH)
- Fixed CORS: hardcoded port 5173 → regex for any localhost port
- Processing dances now show inline in gallery with YouTube thumbnail + status spinner
- Job errors shown on card with red overlay (auto-dismiss after 8s)
- Background job tracking: App.tsx polls jobs and auto-refreshes on completion
- Added `onJobStarted` callback from AddDance → App for job tracking across modal close
- New e2e test suite: `import-dance.spec.ts` — 4 serial tests importing real YouTube videos

### UX Improvements
- **Full-window dance mode**: `position: fixed; inset: 0` fills entire viewport
- **Target pose figure**: Canvas-drawn filled human silhouette from keypoints (not skeleton wireframe)
  - Auto-scales to bounding box of visible keypoints
  - Taller canvas (1.4:1) for human proportions
- **Border countdown**: Conic-gradient border fills clockwise as hit time approaches
  - Slides in from right 2.5s before hit
  - Glows green + pulses + shows "NOW" at 85%+ progress
- **Three-dot menu**: Replaced single delete button on dance cards
  - Debug and Delete options in dropdown
  - Click-outside dismissal
- **Debug mode**: Full pose data inspection view
  - Video playback with skeleton overlay (accounts for object-fit: contain)
  - Audio with mute toggle
  - Key pose timeline bar with color-coded markers (held=yellow, transition=blue, distinctive=pink)
  - Scrollable key pose cards with figures — click to jump
  - Toggle switches for skeleton and key pose highlighting
  - Stats panel: frame count, FPS, pose type breakdown
- **Key pose detection**: Priority system — held/transition poses placed first, distinctive fills gaps
  - Raised distinctive threshold (0.5 → 1.0 rad), increased gap (2s → 3s)
- Bundled dances deletable (hidden via localStorage)
- Fixed nested `<button>` HTML violation (card → `<div role="button">`)
- Back button moved inside dance mode overlay
- Duration/practice button padding fixed on cards

### Files Changed
- `scripts/extract_poses.py` — Complete rewrite: MediaPipe BlazePose Heavy + post-processing
- `scripts/pose_landmarker_heavy.task` — Downloaded model file for offline pipeline
- `src/pose/detector.ts` — Rewritten: MediaPipe PoseLandmarker (Full, GPU, VIDEO mode)
- `src/components/TargetPoseFigure.tsx` — New: filled human figure from keypoints
- `src/components/DebugMode.tsx` — New: pose data inspection view
- `src/components/DanceMode.tsx` — Target pose timing, full-window, back button
- `src/components/HomeScreen.tsx` — Three-dot menu, processing cards, debug callback
- `src/components/AddDance.tsx` — onJobStarted callback
- `src/App.tsx` — Debug view, processing job tracking, bundled dance hiding
- `src/App.css` — All new styles (debug mode, target pose, menu, processing cards, full-window dance)
- `server/app.ts` — CORS regex for any localhost port
- `server/processing.ts` — .venv/bin/python3 path
- `tests/e2e/import-dance.spec.ts` — New: real import e2e tests
- `public/dances/ive-cover.json` — Re-extracted with BlazePose Heavy
- `data/dances/*/poses.json` — Re-extracted with BlazePose Heavy

## 2026-03-14 - US-203: Add Dance UI

- Created AddDance modal component with YouTube URL input, validation, processing progress, success/error states
- Added "+ Add Dance" button to HomeScreen with accent styling
- Added processing indicator to HomeScreen for background processing
- 7 new e2e tests with mocked API (12 total e2e tests)
- All 145 unit + 12 e2e tests passing, build clean

## 2026-03-14 - Ralph Loop launched

- Initiated autonomous work session via `/tst:project-work`
- Stories to complete: 23
- Starting with: US-100 (Fix music/audio not playing during dance)

## 2026-03-14 - Planning meeting with CEO

- Reviewed CEO feedback on current state
- Updated PRD with 23 new user stories across 5 phases
- Updated roadmap with phased plan
- Identified music bug root cause (muted attribute on video element)
- Architecture decision: Node.js/Express + SQLite for Phase 2 backend

## 2026-03-14 - Project created

- Initial project setup
- Created project directory and documentation structure
- Co-founder discussion completed: architecture, scoring, tech stack decisions
- Reference video identified: https://www.youtube.com/watch?v=C1RE9eWapIU

## 2026-03-14 - Ralph Loop launched

- Initiated autonomous work session via `/tst:project-work`
- Stories to complete: 12
- Starting with: US-001 - Project scaffold with testing infrastructure

## 2026-03-14 - CEO meeting: feedback and PRD overhaul

- CEO tested the app and provided detailed feedback
- Identified bugs: music not playing (muted video element), feedback position (center -> corner)
- Major feature requests: dynamic dance library via YouTube URL, session recording/replay, practice mode
- Architecture decision: need backend + database for Phase 2 (can't add dances without server-side yt-dlp)
- Updated prd.json: added 23 new user stories across 5 phases (Phase 1-5)
- Updated roadmap.md with phased plan and risk register
- Updated status.md to reflect new direction
- Updated inbox.md with all CEO action items
- Updated CLAUDE.md with new tech stack entries (backend, recording, visual regression)
- Total stories: 12 complete (Phase 0) + 23 new = 35 total

## 2026-10-16 - DanceCraft README and original brand artwork
- Rewrote the main README around the Claude Code rebuild, the coached challenge, setup and the saved demo assets.
- Removed the upstream README section and its screenshot from the main README; preserved a short Groovy/MIT credit and the original license.
- Added two original images through the built-in image generation tool, labeled them as illustrations and saved the generation prompts alongside the assets.
- Verified local README links and image files; no application code or live-server changes.

## 2026-10-16 - Separate music and recording clocks and repair promotion export
- Confirmed that VFR-to-30fps conversion preserved timestamps; independently re-extracted camera poses aligned within one frame. The large legacy performance/reference phase difference was approximately1.30seconds acrossthreewindows.
- Fixed capture/replay clocks, inference frame identity, asynchronous startup and decoder drift. New poses retain music time plus videoTime; old recordings remain readable.
- Added a guarded portable exporter and nine timing/safety tests. Re-exported the five promotional assets with a documented constant editorial offset for the legacy clip, natural overlap, retained soundtrack and unchanged source hashes.
- Updated README timing notes and PPT demo poster. Kept original export backups outside the repo and all source recordings/pose/score data unchanged.
- Validation: 531 unit tests, tsc and production build, coach browser2/2, clock browser2/2, Python exporter9/9. Published the build into the existing preview assets and verified the live homepage without service restart.
- Promoted the user-approved corrected replay to the main README and added Wasil Instagram/LinkedIn and Jin LinkedIn profile links. No social-account posts or invitations were sent.

## 2026-10-16 - Simplify README presentation links
- Removed the lower duplicate video table and its explanation, leaving a single pitch deck link in the Presentation section.
- Retained the approved main promotional replay and its poster. Verified the presentation target exists and the documentation diff has no whitespace errors.

## 2026-10-16 - Embed the main README replay as a GitHub video
- Prepared a 5.35 MB H.264 upload copy while preserving the approved replay's audio packets, stream starts, and duration.
- Uploaded it to the private DanceCraft repository through the official GitHub CLI attachment endpoint, without creating an issue or comment.
- Replaced the top poster link with the returned standalone attachment URL; retained the original MP4 download link and the pitch-deck-only Presentation section.

## 2026-10-16 - Clarify retry and rematch scope
- Traced results retry and completed-drill retry callbacks, local previous-attempt lookup, host comparison, and leaderboard storage.
- Confirmed existing tests cover comparison helpers and preview UI, but do not complete a second scored attempt through Retry.
- Renamed the README's Rematch step to Retry and compare and labeled the artwork's intended experience. No app changes or new rematch feature were made; the complete live-camera loop remains unverified.
