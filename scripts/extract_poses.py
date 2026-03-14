#!/usr/bin/env python3
"""
Offline pose extraction pipeline for Groovy.

Downloads a video via yt-dlp, extracts frames, runs MoveNet pose estimation,
and outputs a JSON file with timestamped pose data.

Usage:
    python scripts/extract_poses.py <youtube-url> [--output poses.json] [--max-duration 300]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np
import tensorflow as tf
import tensorflow_hub as hub

# MoveNet Lightning model URL
MOVENET_MODEL_URL = "https://tfhub.dev/google/movenet/singlepose/lightning/4"

# MoveNet keypoint names (same order as model output)
KEYPOINT_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]


def download_video(url: str, output_dir: str, max_duration: int = 300) -> str:
    """Download a video using yt-dlp. Returns path to downloaded file."""
    output_path = os.path.join(output_dir, "video.mp4")

    cmd = [
        "yt-dlp",
        "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
        "--merge-output-format", "mp4",
        "--match-filter", f"duration <= {max_duration}",
        "-o", output_path,
        url,
    ]

    print(f"Downloading video from {url}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"yt-dlp stderr: {result.stderr}", file=sys.stderr)
        raise RuntimeError(f"Failed to download video: {result.stderr}")

    if not os.path.exists(output_path):
        raise RuntimeError("Video file not found after download. Video may exceed max duration.")

    print(f"Downloaded to {output_path}")
    return output_path


def load_movenet():
    """Load the MoveNet Lightning model from TensorFlow Hub."""
    print("Loading MoveNet Lightning model...")
    model = hub.load(MOVENET_MODEL_URL)
    movenet = model.signatures["serving_default"]
    print("Model loaded.")
    return movenet


def process_frame(movenet, frame: np.ndarray) -> list[dict]:
    """Run MoveNet on a single frame. Returns list of keypoint dicts."""
    # Resize to 192x192 as required by MoveNet Lightning
    input_image = tf.image.resize_with_pad(
        tf.expand_dims(frame, axis=0), 192, 192
    )
    input_image = tf.cast(input_image, dtype=tf.int32)

    outputs = movenet(input_image)
    keypoints_with_scores = outputs["output_0"].numpy()[0, 0]  # shape: (17, 3)

    result = []
    for i, name in enumerate(KEYPOINT_NAMES):
        y, x, score = keypoints_with_scores[i]
        result.append({
            "name": name,
            "x": round(float(x), 4),
            "y": round(float(y), 4),
            "score": round(float(score), 4),
        })

    return result


def extract_poses(video_path: str, movenet) -> dict:
    """Extract poses from all frames of a video."""
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0

    print(f"Video: {total_frames} frames, {fps:.1f} FPS, {duration:.1f}s duration")

    keyframes = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        timestamp = frame_idx / fps if fps > 0 else 0
        keypoints = process_frame(movenet, frame_rgb)

        keyframes.append({
            "time": round(timestamp, 4),
            "keypoints": keypoints,
        })

        frame_idx += 1
        if frame_idx % 100 == 0:
            print(f"  Processed {frame_idx}/{total_frames} frames...")

    cap.release()
    print(f"Extracted poses from {frame_idx} frames.")

    return {
        "fps": round(fps, 2),
        "duration": round(duration, 4),
        "keyframes": keyframes,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Extract pose data from a YouTube video using MoveNet."
    )
    parser.add_argument("url", help="YouTube video URL")
    parser.add_argument(
        "--output", "-o",
        default="poses.json",
        help="Output JSON file path (default: poses.json)",
    )
    parser.add_argument(
        "--max-duration",
        type=int,
        default=300,
        help="Maximum video duration in seconds (default: 300 = 5 minutes)",
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = download_video(args.url, tmpdir, args.max_duration)
        movenet = load_movenet()
        pose_data = extract_poses(video_path, movenet)

    with open(args.output, "w") as f:
        json.dump(pose_data, f, indent=2)

    num_keyframes = len(pose_data["keyframes"])
    print(f"\nDone! Wrote {num_keyframes} keyframes to {args.output}")
    print(f"  FPS: {pose_data['fps']}")
    print(f"  Duration: {pose_data['duration']}s")


if __name__ == "__main__":
    main()
