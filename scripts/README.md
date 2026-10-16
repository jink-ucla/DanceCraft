# Offline Pose Extraction Pipeline

Extracts pose data from YouTube dance videos or local video files using MediaPipe BlazePose Heavy, with outlier rejection, interpolation, and smoothing.

## Prerequisites

- Python 3.11 or 3.12 (mediapipe has no wheels for 3.13+)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and available on PATH
- ffmpeg installed (for yt-dlp video merging)

## Setup

From the repo root:

```bash
python3.11 -m venv .venv
.venv/bin/python3 -m pip install -r scripts/requirements.txt
curl -L -o scripts/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
```

On Windows, `scripts/setup-windows.ps1` does all of this.

## Usage

```bash
python scripts/extract_poses.py <youtube-url-or-file> [--output poses.json] [--max-fps 30] [--max-duration 0]
```

### Arguments

- `url` — YouTube video URL or local video file path (required)
- `--output`, `-o` — Output JSON file path (default: `poses.json`)
- `--max-fps` — Analyse at most this many frames per second; 0 = every frame (default: 30)
- `--max-duration` — URLs only: skip videos longer than this many seconds; 0 = no limit (default: 0)

### Example

```bash
python scripts/extract_poses.py "https://www.youtube.com/watch?v=EXAMPLE" -o public/dances/my-dance.json
```

## Output Format

```json
{
  "fps": 30.0,
  "duration": 120.5,
  "keyframes": [
    {
      "time": 0.0,
      "keypoints": [
        { "name": "nose", "x": 0.5, "y": 0.2, "score": 0.95 },
        { "name": "left_eye", "x": 0.48, "y": 0.18, "score": 0.92 }
      ]
    }
  ]
}
```

Each keyframe contains all 33 BlazePose landmarks with normalized `x`, `y` coordinates (0-1 range) and a confidence `score`.

## Tests

```bash
python scripts/test_schema.py
```

Validates the JSON output schema with synthetic data. To validate an actual output file:

```bash
python scripts/test_schema.py --file poses.json
```
