# Project Status

**Last updated:** 2026-03-15

**Current state:** Phase 7 - UX Polish & Practice Mode Redesign

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

## Known Bugs

None currently tracked.

## Test Summary

- 181 unit tests (Vitest) — all passing
- 65+ e2e tests (Playwright) — all passing

## What's Next

- Multi-person tracking (plan in docs/plans/multi-person-tracking.md)
- History → replay (persist session data for later playback)
- Score calibration with 33-landmark data
