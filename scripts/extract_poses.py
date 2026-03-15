#!/usr/bin/env python3
"""
Offline pose extraction pipeline for Groovy.

Uses MediaPipe BlazePose Heavy for highest accuracy pose detection.
Includes post-processing: outlier rejection, interpolation, and temporal smoothing.

Usage:
    python scripts/extract_poses.py <video-or-url> [--output poses.json] [--max-duration 300]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

# Full MediaPipe BlazePose 33 landmark names (1:1 mapping, no conversion needed)
KEYPOINT_NAMES = [
    "nose",              # 0
    "left_eye_inner",    # 1
    "left_eye",          # 2
    "left_eye_outer",    # 3
    "right_eye_inner",   # 4
    "right_eye",         # 5
    "right_eye_outer",   # 6
    "left_ear",          # 7
    "right_ear",         # 8
    "mouth_left",        # 9
    "mouth_right",       # 10
    "left_shoulder",     # 11
    "right_shoulder",    # 12
    "left_elbow",        # 13
    "right_elbow",       # 14
    "left_wrist",        # 15
    "right_wrist",       # 16
    "left_pinky",        # 17
    "right_pinky",       # 18
    "left_index",        # 19
    "right_index",       # 20
    "left_thumb",        # 21
    "right_thumb",       # 22
    "left_hip",          # 23
    "right_hip",         # 24
    "left_knee",         # 25
    "right_knee",        # 26
    "left_ankle",        # 27
    "right_ankle",       # 28
    "left_heel",         # 29
    "right_heel",        # 30
    "left_foot_index",   # 31
    "right_foot_index",  # 32
]

NUM_KEYPOINTS = 33

# Anatomical connections for skeleton (index pairs in 33-landmark format)
SKELETON_CONNECTIONS = [
    (11, 12), (11, 23), (12, 24), (23, 24),  # torso
    (11, 13), (13, 15),    # left arm
    (12, 14), (14, 16),    # right arm
    (15, 17), (15, 19), (15, 21),  # left hand
    (16, 18), (16, 20), (16, 22),  # right hand
    (23, 25), (25, 27),    # left leg
    (24, 26), (26, 28),    # right leg
    (27, 29), (27, 31), (29, 31),  # left foot
    (28, 30), (28, 32), (30, 32),  # right foot
]

# Maximum anatomical limb lengths (normalized, as fraction of frame)
# Used for outlier detection — if a limb is longer than this, something is wrong
# Indices are MediaPipe 33-landmark format
MAX_LIMB_LENGTHS = {
    (11, 13): 0.25,  # shoulder-elbow
    (13, 15): 0.25,  # elbow-wrist
    (12, 14): 0.25,
    (14, 16): 0.25,
    (23, 25): 0.30,  # hip-knee
    (25, 27): 0.30,  # knee-ankle
    (24, 26): 0.30,
    (26, 28): 0.30,
    (11, 12): 0.30,  # shoulder-shoulder
    (23, 24): 0.25,  # hip-hip
}


def download_video(url: str, output_dir: str, max_duration: int = 300) -> str:
    """Download a video using yt-dlp."""
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
        raise RuntimeError("Video file not found after download.")
    print(f"Downloaded to {output_path}")
    return output_path


def extract_raw_poses(video_path: str) -> tuple[np.ndarray, float, float]:
    """Extract raw poses using MediaPipe BlazePose Heavy.

    Returns (num_frames, 17, 3) array of [x, y, visibility], fps, duration.
    """
    model_path = os.path.join(os.path.dirname(__file__), "pose_landmarker_heavy.task")
    if not os.path.exists(model_path):
        raise RuntimeError(
            f"Model file not found: {model_path}\n"
            "Download from: https://storage.googleapis.com/mediapipe-models/"
            "pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
        )

    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    print(f"Video: {total_frames} frames, {fps:.1f} FPS, {duration:.1f}s duration")

    all_keypoints = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        timestamp_ms = int(frame_idx * 1000.0 / fps) if fps > 0 else 0
        result = landmarker.detect_for_video(mp_image, timestamp_ms)

        kp_array = np.zeros((NUM_KEYPOINTS, 3), dtype=np.float32)

        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            landmarks = result.pose_landmarks[0]
            for kp_idx in range(min(NUM_KEYPOINTS, len(landmarks))):
                lm = landmarks[kp_idx]
                kp_array[kp_idx] = [lm.x, lm.y, lm.visibility]

        all_keypoints.append(kp_array)
        frame_idx += 1

        if frame_idx % 30 == 0:
            pct = round(frame_idx / total_frames * 100) if total_frames > 0 else 0
            print(f"PROGRESS:{frame_idx}/{total_frames}:{pct}", flush=True)

    cap.release()
    landmarker.close()
    print(f"Extracted poses from {frame_idx} frames.")

    return np.array(all_keypoints), fps, duration


def postprocess_poses(raw: np.ndarray, fps: float) -> np.ndarray:
    """Clean up raw pose data.

    Pipeline:
    1. Anatomical outlier rejection (impossible limb lengths)
    2. Velocity-based outlier rejection (sudden jumps)
    3. Interpolation for missing keypoints (linear + hold)
    4. Temporal smoothing (EMA)
    """
    num_frames = raw.shape[0]
    if num_frames < 3:
        return raw

    cleaned = raw.copy()

    # --- Step 1: Anatomical outlier rejection ---
    for f in range(num_frames):
        for (i, j), max_len in MAX_LIMB_LENGTHS.items():
            if cleaned[f, i, 2] < 0.3 or cleaned[f, j, 2] < 0.3:
                continue
            dx = cleaned[f, i, 0] - cleaned[f, j, 0]
            dy = cleaned[f, i, 1] - cleaned[f, j, 1]
            dist = np.sqrt(dx * dx + dy * dy)
            if dist > max_len:
                # One of these joints is wrong — lower confidence of the less confident one
                if cleaned[f, i, 2] < cleaned[f, j, 2]:
                    cleaned[f, i, 2] = 0.1
                else:
                    cleaned[f, j, 2] = 0.1

    # --- Step 2: Velocity-based outlier rejection ---
    max_velocity = 0.12  # max normalized distance per frame
    for kp_idx in range(NUM_KEYPOINTS):
        for f in range(1, num_frames):
            if cleaned[f, kp_idx, 2] < 0.2:
                continue
            if cleaned[f - 1, kp_idx, 2] < 0.2:
                continue

            dx = cleaned[f, kp_idx, 0] - cleaned[f - 1, kp_idx, 0]
            dy = cleaned[f, kp_idx, 1] - cleaned[f - 1, kp_idx, 1]
            dist = np.sqrt(dx * dx + dy * dy)

            if dist > max_velocity:
                # Check if next frame confirms the jump (it's real movement)
                if f + 1 < num_frames and cleaned[f + 1, kp_idx, 2] > 0.3:
                    dx2 = cleaned[f + 1, kp_idx, 0] - cleaned[f, kp_idx, 0]
                    dy2 = cleaned[f + 1, kp_idx, 1] - cleaned[f, kp_idx, 1]
                    dist2 = np.sqrt(dx2 * dx2 + dy2 * dy2)
                    if dist2 < max_velocity:
                        continue  # movement was real, next frame is close

                cleaned[f, kp_idx, 2] = 0.1

    # --- Step 3: Interpolation ---
    min_conf = 0.2
    max_gap_frames = int(fps * 1.5)  # max 1.5 seconds to interpolate

    for kp_idx in range(NUM_KEYPOINTS):
        scores = cleaned[:, kp_idx, 2].copy()
        f = 0
        while f < num_frames:
            if scores[f] >= min_conf:
                f += 1
                continue

            gap_start = f
            while f < num_frames and scores[f] < min_conf:
                f += 1
            gap_end = f

            gap_len = gap_end - gap_start
            if gap_len > max_gap_frames:
                continue

            prev_valid = gap_start - 1 if gap_start > 0 and scores[gap_start - 1] >= min_conf else -1
            next_valid = gap_end if gap_end < num_frames and scores[gap_end] >= min_conf else -1

            if prev_valid >= 0 and next_valid >= 0:
                # Smooth interpolation using cosine easing
                for g in range(gap_start, gap_end):
                    t = (g - prev_valid) / (next_valid - prev_valid)
                    # Cosine interpolation for smoother transitions
                    t_smooth = (1 - np.cos(t * np.pi)) / 2
                    cleaned[g, kp_idx, 0] = cleaned[prev_valid, kp_idx, 0] * (1 - t_smooth) + cleaned[next_valid, kp_idx, 0] * t_smooth
                    cleaned[g, kp_idx, 1] = cleaned[prev_valid, kp_idx, 1] * (1 - t_smooth) + cleaned[next_valid, kp_idx, 1] * t_smooth
                    cleaned[g, kp_idx, 2] = min(scores[prev_valid], scores[next_valid]) * 0.6
            elif prev_valid >= 0:
                # Decay from previous (gradually reduce confidence)
                for g in range(gap_start, gap_end):
                    decay = max(0.2, 1.0 - (g - prev_valid) / max_gap_frames)
                    cleaned[g, kp_idx, :2] = cleaned[prev_valid, kp_idx, :2]
                    cleaned[g, kp_idx, 2] = scores[prev_valid] * 0.4 * decay
            elif next_valid >= 0:
                for g in range(gap_start, gap_end):
                    decay = max(0.2, 1.0 - (gap_end - g) / max_gap_frames)
                    cleaned[g, kp_idx, :2] = cleaned[next_valid, kp_idx, :2]
                    cleaned[g, kp_idx, 2] = scores[next_valid] * 0.4 * decay

    # --- Step 4: Temporal smoothing (one-euro-filter-inspired) ---
    # Adaptive smoothing: smooth more when movement is slow, less when fast
    smoothed = cleaned.copy()
    min_alpha = 0.3   # max smoothing (slow movement)
    max_alpha = 0.85  # min smoothing (fast movement)
    velocity_scale = 15.0  # how quickly alpha increases with velocity

    for f in range(1, num_frames):
        for kp_idx in range(NUM_KEYPOINTS):
            if smoothed[f, kp_idx, 2] < 0.15 or smoothed[f - 1, kp_idx, 2] < 0.15:
                continue

            dx = cleaned[f, kp_idx, 0] - smoothed[f - 1, kp_idx, 0]
            dy = cleaned[f, kp_idx, 1] - smoothed[f - 1, kp_idx, 1]
            velocity = np.sqrt(dx * dx + dy * dy)

            # Adaptive alpha: fast movement = less smoothing
            alpha = min_alpha + (max_alpha - min_alpha) * min(1.0, velocity * velocity_scale)

            smoothed[f, kp_idx, 0] = alpha * cleaned[f, kp_idx, 0] + (1 - alpha) * smoothed[f - 1, kp_idx, 0]
            smoothed[f, kp_idx, 1] = alpha * cleaned[f, kp_idx, 1] + (1 - alpha) * smoothed[f - 1, kp_idx, 1]

    return smoothed


def build_output(keypoints_array: np.ndarray, fps: float, duration: float) -> dict:
    """Convert numpy array to JSON output format."""
    keyframes = []
    num_frames = keypoints_array.shape[0]

    for f in range(num_frames):
        timestamp = f / fps if fps > 0 else 0
        kps = []
        for i in range(NUM_KEYPOINTS):
            kps.append({
                "name": KEYPOINT_NAMES[i],
                "x": round(float(keypoints_array[f, i, 0]), 4),
                "y": round(float(keypoints_array[f, i, 1]), 4),
                "score": round(float(keypoints_array[f, i, 2]), 4),
            })
        keyframes.append({
            "time": round(timestamp, 4),
            "keypoints": kps,
        })

    return {
        "fps": round(fps, 2),
        "duration": round(duration, 4),
        "keyframes": keyframes,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Extract pose data from a video using MediaPipe BlazePose."
    )
    parser.add_argument("url", help="YouTube video URL or local file path")
    parser.add_argument("--output", "-o", default="poses.json")
    parser.add_argument("--max-duration", type=int, default=300)
    args = parser.parse_args()

    if os.path.isfile(args.url):
        video_path = args.url
        tmpdir = None
    else:
        tmpdir = tempfile.mkdtemp()
        video_path = download_video(args.url, tmpdir, args.max_duration)

    try:
        raw_keypoints, fps, duration = extract_raw_poses(video_path)

        print("Post-processing poses...")
        cleaned = postprocess_poses(raw_keypoints, fps)

        raw_high = np.mean(raw_keypoints[:, :, 2] > 0.5) * 100
        clean_usable = np.mean(cleaned[:, :, 2] > 0.2) * 100
        print(f"  Raw high-visibility (>0.5): {raw_high:.1f}%")
        print(f"  After cleanup usable (>0.2): {clean_usable:.1f}%")

        pose_data = build_output(cleaned, fps, duration)
    finally:
        if tmpdir:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    with open(args.output, "w") as f:
        json.dump(pose_data, f)

    num_keyframes = len(pose_data["keyframes"])
    print(f"\nDone! Wrote {num_keyframes} keyframes to {args.output}")
    print(f"  FPS: {pose_data['fps']}, Duration: {pose_data['duration']}s")


if __name__ == "__main__":
    main()
