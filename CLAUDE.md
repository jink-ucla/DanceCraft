# Groovy

## Vision

Open-source, web-based dance game where anyone can dance along to any video with real-time key-pose hits and post-dance scoring with playback review. Think "Just Dance" but for any YouTube dance video, running entirely in the browser.

## Work Documentation

### Status Updates
- Read `docs/status.md` at the start of every session to understand current project state
- Update `docs/status.md` after completing work with what was done and what's next

### Work Logging
- Append entries to `docs/worklog.md` for every work session
- Format: `## YYYY-MM-DD - Brief description` followed by bullet points of changes

### Inbox
- Check `docs/inbox.md` at the start of every session for action items from co-founder discussions or standups
- Mark items as `[SEEN]` after reading them
- Address action items in your current work session

## Tech Stack

- **Frontend**: React + TypeScript (Vite)
- **Pose Estimation**: TensorFlow.js with MoveNet Lightning (50+ FPS in browser)
- **Video Processing**: yt-dlp + ffmpeg + MoveNet (offline Python pipeline)
- **Scoring**: Joint angle comparison + Dynamic Time Warping
- **Webcam**: WebRTC getUserMedia
- **Rendering**: HTML5 Canvas
- **Testing**: Vitest for unit tests, Playwright for e2e tests

## Project Conventions

### Architecture
- Everything runs client-side in the browser — no backend needed
- Reference video poses are pre-processed offline and served as JSON
- Only one pose estimator runs during gameplay (on webcam feed)
- Scoring uses joint angles (position/scale invariant), not absolute coordinates

### Scoring System (Hybrid)
1. **During dance**: Detect key/dramatic poses in real-time, flash feedback on hits
2. **After dance**: Full frame-by-frame scoring with DTW alignment
3. **Playback**: Review recording with color-coded per-section feedback
4. Game mode = generous thresholds, encouraging feedback

### Testing Requirements
- Unit tests for scoring algorithms (pose comparison, DTW, key pose detection)
- Unit tests for pose data processing (angle extraction, normalization)
- E2e tests for UI flows (video selection, dance mode, post-dance review)
- Test with pre-recorded pose data fixtures (no need for actual webcam in tests)
- All tests must pass before Ralph loop can mark a task as complete

### Setup Must Be Easy
- Clone repo, install deps, run — that's it
- Document any Python dependencies for the offline pipeline clearly
- Consider wrapping in a simple launcher script

## Allowed Commands

```json
{
  "allowedCommands": [
    "npm install",
    "npm run dev",
    "npm run build",
    "npm run test",
    "npm run test:e2e",
    "npx vitest",
    "npx playwright test",
    "python scripts/*.py",
    "pip install -r requirements.txt"
  ]
}
```
