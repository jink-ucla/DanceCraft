# Offline Pose Extraction Pipeline

Extracts pose data from YouTube dance videos using MoveNet Lightning.

## Prerequisites

- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed and available on PATH
- ffmpeg installed (for yt-dlp video merging)

## Setup

```bash
cd scripts
pip install -r requirements.txt
```

## Usage

```bash
python scripts/extract_poses.py <youtube-url> [--output poses.json] [--max-duration 300]
```

### Arguments

- `url` — YouTube video URL (required)
- `--output`, `-o` — Output JSON file path (default: `poses.json`)
- `--max-duration` — Maximum video duration in seconds (default: 300 = 5 minutes)

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

Each keyframe contains 17 MoveNet keypoints with normalized `x`, `y` coordinates (0-1 range) and a confidence `score`.

## Tests

```bash
python scripts/test_schema.py
```

Validates the JSON output schema with synthetic data. To validate an actual output file:

```bash
python scripts/test_schema.py --file poses.json
```
