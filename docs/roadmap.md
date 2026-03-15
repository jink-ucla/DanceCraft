# Roadmap

## Vision

Open-source, web-based dance game. Dance along to any video, get scored, have fun. Add any YouTube dance video to your personal library, record your sessions, and practice at your own pace.

## Milestones

### Phase 0: Foundation (COMPLETE)
- [x] Vite + React + TypeScript scaffold with Vitest + Playwright
- [x] Webcam feed with MoveNet pose estimation (30+ FPS)
- [x] Offline Python pipeline: YouTube URL -> pose data JSON
- [x] Joint angle extraction and pose comparison (scale/position invariant)
- [x] Key pose detection algorithm
- [x] Dance mode UI with real-time key-pose feedback
- [x] Post-dance DTW scoring with per-section breakdown
- [x] Results screen with playback review
- [x] Home screen with dance cards and personal bests
- [x] Settings page (webcam, sensitivity, mirror mode)
- [x] Score history and personal bests
- [x] Setup documentation
- **Result**: 12 stories complete, 83 unit tests, 4 e2e tests, all passing

### Phase 1: Core Polish & Bug Fixes (NEXT)
- [ ] **US-100**: Fix music/audio not playing (video element is `muted`)
- [ ] **US-101**: Move feedback (Perfect/Good/Miss) from center to corner
- [ ] **US-102**: UI polish pass - typography, spacing, visual hierarchy, dark theme
- [ ] **US-103**: Dance mode UI polish - animated scores, combo effects, game feel
- **Goal**: Make the existing app feel polished, user-friendly, and fun to use
- **Key insight**: Reference video has `muted` attribute, need to handle browser autoplay policies

### Phase 2: Dance Library & YouTube Integration
- [ ] **US-200**: Backend API server (Node.js/Express, SQLite)
- [ ] **US-201**: YouTube video download + pose extraction API (wraps existing Python pipeline)
- [ ] **US-202**: Dance library database and CRUD API
- [ ] **US-203**: Add Dance UI - paste YouTube URL, see processing progress
- [ ] **US-204**: Dynamic dance library UI (replaces hardcoded dance array)
- [ ] **US-205**: Serve video/audio/poses/thumbnails from backend
- **Goal**: Users can paste any YouTube dance URL and it becomes playable
- **Architecture change**: Introduces a backend server (previously browser-only)

### Phase 3: Recording & Replay
- [ ] **US-300**: Record user webcam video during dance (MediaRecorder API)
- [ ] **US-301**: Save dance sessions (video + pose data + score) to backend
- [ ] **US-302**: Replay mode - side-by-side review with pose overlay and timeline
- **Goal**: Users can rewatch their performances and see exactly where they nailed it or missed

### Phase 4: Practice Mode
- [ ] **US-400**: Practice mode - pause/resume during dance with target pose display
- [ ] **US-401**: Video scrubbing - timeline/scrubber, arrow key seeking
- [ ] **US-402**: Section looping - A/B loop for focused practice
- [ ] **US-403**: Target pose overlay on webcam (ghost skeleton showing where to be)
- **Goal**: Structured learning experience, not just play-through

### Phase 5: Testing & Quality
- [ ] **US-500**: Playwright e2e test infrastructure overhaul (screenshots, mocks, visual regression)
- [ ] **US-501**: E2e tests - home screen and navigation
- [ ] **US-502**: E2e tests - dance mode lifecycle
- [ ] **US-503**: E2e tests - practice mode
- [ ] **US-504**: E2e tests - recording and replay
- [ ] **US-505**: Visual regression test baseline
- **Goal**: Agent can run tests, see screenshots, and fix visual issues autonomously

### Phase 6: Pose Detection Overhaul & UX (IN PROGRESS - 2026-03-15)
- [x] Upgrade offline pipeline to MediaPipe BlazePose Heavy (95%+ accuracy)
- [x] Upgrade browser detection to MediaPipe BlazePose Full (GPU, 120+ FPS)
- [x] Post-processing pipeline (outlier rejection, interpolation, smoothing)
- [x] Full-window dance mode
- [x] Target pose figure with border countdown
- [x] Debug mode for pose data inspection
- [x] Three-dot card menu (Debug + Delete)
- [x] Import pipeline fixes (CORS, Python path, error handling)
- [x] E2e tests for real video import
- **Goal**: Production-quality pose detection matching both browser and offline

## Current Focus

**Phase 6: Pose Detection & UX** — Verify browser MediaPipe performance, calibrate scoring with new pose data.

## Architecture Notes

### Pose Detection Stack
- **Browser (real-time)**: MediaPipe BlazePose Full via `@mediapipe/tasks-vision`
  - WASM + WebGL GPU delegate, loaded from CDN
  - VIDEO running mode (detection + tracking)
  - 17 keypoints (mapped from 33 BlazePose landmarks)
- **Offline (processing)**: MediaPipe BlazePose Heavy via Python `mediapipe`
  - Highest accuracy model
  - Post-processing: anatomical outlier rejection, velocity-based outlier rejection, cosine interpolation, adaptive temporal smoothing
  - Output: 17 keypoints, normalized [0,1], same format as browser

### Backend
- Node.js/Express backend with SQLite for dance library
- Backend wraps Python pipeline (yt-dlp + ffmpeg + MediaPipe) behind REST API
- Frontend fetches dance library from API, bundled dances as fallback
- Processing jobs tracked in-memory with polling from frontend

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Browser autoplay policies block audio | High | User interaction before countdown; "tap to start" pattern |
| yt-dlp breaks with YouTube changes | Medium | Pin yt-dlp version, monitor for updates |
| Large video files fill disk quickly | Medium | Storage management UI, auto-cleanup, configurable limits |
| MediaPipe WASM/model CDN unavailable | Low | Can bundle locally as fallback |
| Playwright tests flaky with async video/webcam | Medium | Robust mock system, generous timeouts, retry logic |
