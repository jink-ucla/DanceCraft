# Work Log

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
