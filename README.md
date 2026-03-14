# Groovy

Open-source, web-based dance game. Dance along to any video with real-time key-pose feedback and post-dance scoring. Think "Just Dance" but running entirely in the browser.

## Quick Start

```bash
git clone <repo-url>
cd groovy
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Grant camera access when prompted.

A sample dance is included — click "Start Dancing" and follow along!

## Prerequisites

- Node.js 18+
- A webcam
- A modern browser (Chrome recommended for best WebGL performance)

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | TypeScript check + production build |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |

## How It Works

1. **Select a dance** from the home screen
2. **Get ready** — 3-2-1 countdown
3. **Dance!** — Match the key poses as they come up. Get Perfect, Good, or Miss feedback in real-time
4. **See your score** — Overall percentage, rank (S/A/B/C), body part breakdown, and a color-coded timeline

### Scoring

- **During dance**: Real-time key-pose detection with feedback (Perfect/Good/Miss) and combo counter
- **After dance**: Full DTW (Dynamic Time Warping) alignment for accurate scoring
- **Ranks**: S (80%+), A (60-79%), B (40-59%), C (<40%) — generous game-mode thresholds

## Adding New Dances

### Option 1: Offline Pipeline (Python)

Extract poses from any YouTube dance video:

```bash
cd scripts
pip install -r requirements.txt
python extract_poses.py "https://youtube.com/watch?v=..." -o ../public/dances/my-dance.json
```

See [scripts/README.md](scripts/README.md) for details.

### Option 2: Manual

Place a pose JSON file in `public/dances/` and add it to the `AVAILABLE_DANCES` array in `src/App.tsx`.

## Tech Stack

- **Frontend**: React + TypeScript (Vite)
- **Pose Estimation**: TensorFlow.js with MoveNet Lightning
- **Video Processing**: yt-dlp + ffmpeg + MoveNet (offline Python pipeline)
- **Scoring**: Joint angle comparison + Dynamic Time Warping
- **Testing**: Vitest (unit) + Playwright (e2e)
