# Groovy

Open-source, browser-based dance game. Dance along to any YouTube video with real-time pose detection, scoring, and post-dance replay review. Think "Just Dance" but for any video, running entirely in the browser.

![Groovy app screenshot](docs/images/app-screenshot.png)

## How It Works

1. **Add a dance** — paste any YouTube URL (regular videos or Shorts) and Groovy downloads it, extracts the reference poses offline using MediaPipe BlazePose Heavy
2. **Dance** — the reference video plays full-screen while your webcam tracks your pose in real-time using MediaPipe BlazePose Full (GPU-accelerated, 120+ FPS)
3. **Score** — joint angle comparison with spatial awareness scores each key pose as you hit it, with instant feedback
4. **Replay** — watch your recording side-by-side with the reference, skeleton overlays, per-joint scoring breakdown, and color-coded timeline

## Features

- Real-time 33-landmark pose estimation via MediaPipe BlazePose (GPU-accelerated)
- Joint angle + spatial scoring with deduction-based grading (S/A/B/C ranks)
- Presence and movement detection to prevent gaming the score
- Practice mode with adjustable speed, loop sections, and ghost overlay
- Per-dance mirror toggle for videos filmed from the dancer's perspective
- Key pose editor to customize scoring checkpoints
- YouTube Shorts and vertical video support
- Session history with replay from saved recordings

## Hardware Requirements

Groovy runs real-time pose estimation on your GPU via WebGL. It has been developed and tested on a **MacBook Pro with M3 Max**.

**Minimum:**
- A machine with a dedicated or integrated GPU that supports WebGL 2.0
- Webcam
- Modern browser (Chrome or Edge recommended for best WebGL/MediaPipe performance)

**Notes:**
- Pose estimation runs at 120+ FPS on M3 Max. Performance will vary on other hardware.
- The offline pose extraction pipeline (Python/MediaPipe Heavy) is CPU-bound and takes roughly 1-2x the video duration to process.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Python](https://www.python.org/) 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (available on PATH)
- [ffmpeg](https://ffmpeg.org/) (available on PATH)

### Install

```bash
git clone https://github.com/JoeyWangTW/groovy.git
cd groovy

# Install Node dependencies
npm install

# Set up Python virtual environment for the offline pose pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install mediapipe opencv-python-headless numpy yt-dlp

# Download the MediaPipe pose model
curl -o scripts/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
```

### Run

```bash
npm run dev
```

This starts both the frontend (Vite, `http://localhost:5173`) and backend (Express, `http://localhost:3001`).

Open the frontend URL, add a YouTube dance video, and start dancing.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start frontend + backend concurrently |
| `npm run dev:frontend` | Start Vite dev server only |
| `npm run dev:backend` | Start Express backend only (with file watching) |
| `npm run build` | TypeScript check + production build |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |

### Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `CORS_ORIGIN` | `http://localhost:*` | Allowed CORS origin pattern |
| `PYTHON_PATH` | `.venv/bin/python3` | Path to Python binary |
| `DATA_DIR` | `data/dances` | Where downloaded videos and poses are stored |

## Scoring

Scoring uses a three-layer system to prevent inflated scores:

1. **Presence gate** — requires 6 of 8 core keypoints visible at sufficient confidence
2. **Movement energy gate** — blends angular velocity (60%) and positional velocity (40%) over a 1.5s rolling window. Standing still = automatic miss.
3. **Torso-relative spatial comparison** — compares bone segment directions relative to the torso frame, catching poses with similar angles but different spatial configs

Final score: `0.6 * angleScore + 0.4 * spatialScore`, with deduction-based grading (start at 100, subtract penalties per joint).

**Ranks:** S (75%+), A (55%+), B (35%+), C (<35%)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, SQLite (better-sqlite3) |
| Pose (browser) | MediaPipe BlazePose Full (`@mediapipe/tasks-vision`, GPU) |
| Pose (offline) | MediaPipe BlazePose Heavy (Python, highest accuracy) |
| Video pipeline | yt-dlp, ffmpeg |
| Scoring | Joint angle comparison, spatial comparison, DTW alignment |
| Recording | MediaRecorder API with canvas compositing |
| Tests | Vitest (195 unit tests), Playwright (65+ e2e tests) |

## Project Structure

```
src/
  components/     # React UI (DanceMode, PracticeMode, ReplayMode, etc.)
  scoring/        # Scoring algorithms (comparison, DTW, key pose detection, presence, movement)
  pose/           # Browser-side pose detector wrapper
  storage/        # LocalStorage helpers (settings, scores)
server/
  app.ts          # Express app with CORS and static file serving
  db.ts           # SQLite database (dances, sessions)
  processing.ts   # Video download + pose extraction pipeline
  routes/         # API routes (dances CRUD, sessions, jobs)
scripts/
  extract_poses.py  # Offline pose extraction (MediaPipe Heavy + post-processing)
```

## Known Limitations & Future Work

- **Scoring is too forgiving** — current thresholds make it easy to get S-rank. Needs calibration with more diverse dancers and difficulty levels.
- **Heavy hardware requirements** — real-time BlazePose Full at high FPS needs a strong GPU. Exploring lighter models (e.g. BlazePose Lite) that can still deliver acceptable quality.
- **Single person only** — multi-person tracking is planned but not yet implemented.

## License

MIT
