#!/usr/bin/env python3
"""
Generates a synthetic sample dance pose JSON for development/testing.
Creates a 30-second dance with varied poses and transitions.
"""

import json
import math
import os

KEYPOINT_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

# Base poses defined as partial keypoints (only body joints)
POSES = {
    "standing": {
        "nose": (0.5, 0.1), "left_eye": (0.48, 0.08), "right_eye": (0.52, 0.08),
        "left_ear": (0.46, 0.09), "right_ear": (0.54, 0.09),
        "left_shoulder": (0.4, 0.25), "right_shoulder": (0.6, 0.25),
        "left_elbow": (0.35, 0.4), "right_elbow": (0.65, 0.4),
        "left_wrist": (0.33, 0.55), "right_wrist": (0.67, 0.55),
        "left_hip": (0.45, 0.55), "right_hip": (0.55, 0.55),
        "left_knee": (0.44, 0.75), "right_knee": (0.56, 0.75),
        "left_ankle": (0.43, 0.92), "right_ankle": (0.57, 0.92),
    },
    "t_pose": {
        "nose": (0.5, 0.1), "left_eye": (0.48, 0.08), "right_eye": (0.52, 0.08),
        "left_ear": (0.46, 0.09), "right_ear": (0.54, 0.09),
        "left_shoulder": (0.4, 0.25), "right_shoulder": (0.6, 0.25),
        "left_elbow": (0.2, 0.25), "right_elbow": (0.8, 0.25),
        "left_wrist": (0.05, 0.25), "right_wrist": (0.95, 0.25),
        "left_hip": (0.45, 0.55), "right_hip": (0.55, 0.55),
        "left_knee": (0.44, 0.75), "right_knee": (0.56, 0.75),
        "left_ankle": (0.43, 0.92), "right_ankle": (0.57, 0.92),
    },
    "arms_up": {
        "nose": (0.5, 0.1), "left_eye": (0.48, 0.08), "right_eye": (0.52, 0.08),
        "left_ear": (0.46, 0.09), "right_ear": (0.54, 0.09),
        "left_shoulder": (0.4, 0.25), "right_shoulder": (0.6, 0.25),
        "left_elbow": (0.38, 0.15), "right_elbow": (0.62, 0.15),
        "left_wrist": (0.4, 0.03), "right_wrist": (0.6, 0.03),
        "left_hip": (0.45, 0.55), "right_hip": (0.55, 0.55),
        "left_knee": (0.44, 0.75), "right_knee": (0.56, 0.75),
        "left_ankle": (0.43, 0.92), "right_ankle": (0.57, 0.92),
    },
    "lunge_right": {
        "nose": (0.5, 0.15), "left_eye": (0.48, 0.13), "right_eye": (0.52, 0.13),
        "left_ear": (0.46, 0.14), "right_ear": (0.54, 0.14),
        "left_shoulder": (0.4, 0.3), "right_shoulder": (0.6, 0.3),
        "left_elbow": (0.25, 0.3), "right_elbow": (0.75, 0.3),
        "left_wrist": (0.15, 0.3), "right_wrist": (0.85, 0.3),
        "left_hip": (0.45, 0.55), "right_hip": (0.55, 0.55),
        "left_knee": (0.44, 0.75), "right_knee": (0.7, 0.65),
        "left_ankle": (0.43, 0.92), "right_ankle": (0.75, 0.85),
    },
    "squat": {
        "nose": (0.5, 0.2), "left_eye": (0.48, 0.18), "right_eye": (0.52, 0.18),
        "left_ear": (0.46, 0.19), "right_ear": (0.54, 0.19),
        "left_shoulder": (0.4, 0.35), "right_shoulder": (0.6, 0.35),
        "left_elbow": (0.3, 0.35), "right_elbow": (0.7, 0.35),
        "left_wrist": (0.25, 0.35), "right_wrist": (0.75, 0.35),
        "left_hip": (0.45, 0.6), "right_hip": (0.55, 0.6),
        "left_knee": (0.35, 0.7), "right_knee": (0.65, 0.7),
        "left_ankle": (0.38, 0.9), "right_ankle": (0.62, 0.9),
    },
}

def interpolate_pose(pose_a, pose_b, t):
    """Interpolate between two poses (t in [0, 1])."""
    result = {}
    for name in KEYPOINT_NAMES:
        ax, ay = pose_a[name]
        bx, by = pose_b[name]
        result[name] = (ax + (bx - ax) * t, ay + (by - ay) * t)
    return result

def pose_to_keypoints(pose_dict):
    """Convert a pose dict to keypoints list."""
    return [
        {"name": name, "x": round(pose_dict[name][0], 4), "y": round(pose_dict[name][1], 4), "score": 0.9}
        for name in KEYPOINT_NAMES
    ]

def generate_dance(fps=30, duration=30):
    """Generate a synthetic dance sequence."""
    # Choreography: sequence of (pose_name, hold_seconds, transition_seconds)
    choreography = [
        ("standing", 2.0, 0.5),
        ("t_pose", 1.5, 0.3),
        ("standing", 1.0, 0.5),
        ("arms_up", 2.0, 0.5),
        ("standing", 0.5, 0.3),
        ("lunge_right", 1.5, 0.5),
        ("standing", 1.0, 0.3),
        ("squat", 1.5, 0.5),
        ("standing", 0.5, 0.3),
        ("t_pose", 1.0, 0.5),
        ("arms_up", 1.5, 0.3),
        ("standing", 1.0, 0.5),
        ("lunge_right", 1.5, 0.5),
        ("squat", 1.0, 0.3),
        ("t_pose", 2.0, 0.5),
        ("arms_up", 1.5, 0.3),
        ("standing", 1.0, 0.5),
        ("squat", 1.5, 0.3),
        ("standing", 1.0, 0.5),
        ("t_pose", 2.0, 0.5),
        ("standing", 2.0, 0.0),
    ]

    keyframes = []
    current_time = 0.0

    for i, (pose_name, hold_secs, trans_secs) in enumerate(choreography):
        if current_time >= duration:
            break

        pose = POSES[pose_name]
        hold_frames = int(hold_secs * fps)

        # Hold phase
        for f in range(hold_frames):
            if current_time >= duration:
                break
            keyframes.append({
                "time": round(current_time, 4),
                "keypoints": pose_to_keypoints(pose),
            })
            current_time += 1.0 / fps

        # Transition to next pose
        if i < len(choreography) - 1 and trans_secs > 0:
            next_pose = POSES[choreography[i + 1][0]]
            trans_frames = int(trans_secs * fps)
            for f in range(trans_frames):
                if current_time >= duration:
                    break
                t = (f + 1) / (trans_frames + 1)
                blended = interpolate_pose(pose, next_pose, t)
                keyframes.append({
                    "time": round(current_time, 4),
                    "keypoints": pose_to_keypoints(blended),
                })
                current_time += 1.0 / fps

    return {
        "fps": fps,
        "duration": round(current_time, 4),
        "keyframes": keyframes,
    }


if __name__ == "__main__":
    dance = generate_dance()
    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "public", "dances", "sample-dance.json"
    )
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(dance, f, indent=2)
    print(f"Generated {len(dance['keyframes'])} frames, {dance['duration']:.1f}s → {output_path}")
