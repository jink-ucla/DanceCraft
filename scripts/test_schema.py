#!/usr/bin/env python3
"""
Unit test: validates the JSON output schema from extract_poses.py.

Creates a synthetic pose JSON and validates it matches the expected format.
Also validates a real output file if provided via --file argument.
"""

import json
import sys
import tempfile
import os

KEYPOINT_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]


def validate_pose_json(data: dict) -> list[str]:
    """Validate pose JSON against expected schema. Returns list of errors."""
    errors = []

    # Top-level fields
    if "fps" not in data:
        errors.append("Missing top-level 'fps' field")
    elif not isinstance(data["fps"], (int, float)):
        errors.append(f"'fps' should be numeric, got {type(data['fps']).__name__}")

    if "duration" not in data:
        errors.append("Missing top-level 'duration' field")
    elif not isinstance(data["duration"], (int, float)):
        errors.append(f"'duration' should be numeric, got {type(data['duration']).__name__}")

    if "keyframes" not in data:
        errors.append("Missing top-level 'keyframes' field")
        return errors

    if not isinstance(data["keyframes"], list):
        errors.append(f"'keyframes' should be a list, got {type(data['keyframes']).__name__}")
        return errors

    if len(data["keyframes"]) == 0:
        errors.append("'keyframes' should not be empty")
        return errors

    # Validate each keyframe
    for i, kf in enumerate(data["keyframes"]):
        prefix = f"keyframes[{i}]"

        if "time" not in kf:
            errors.append(f"{prefix}: missing 'time' field")
        elif not isinstance(kf["time"], (int, float)):
            errors.append(f"{prefix}: 'time' should be numeric")

        if "keypoints" not in kf:
            errors.append(f"{prefix}: missing 'keypoints' field")
            continue

        if not isinstance(kf["keypoints"], list):
            errors.append(f"{prefix}: 'keypoints' should be a list")
            continue

        if len(kf["keypoints"]) != 17:
            errors.append(f"{prefix}: expected 17 keypoints, got {len(kf['keypoints'])}")
            continue

        for j, kp in enumerate(kf["keypoints"]):
            kp_prefix = f"{prefix}.keypoints[{j}]"

            for field in ["x", "y", "score", "name"]:
                if field not in kp:
                    errors.append(f"{kp_prefix}: missing '{field}'")

            if "name" in kp and kp["name"] != KEYPOINT_NAMES[j]:
                errors.append(
                    f"{kp_prefix}: expected name '{KEYPOINT_NAMES[j]}', got '{kp['name']}'"
                )

            if "x" in kp and not isinstance(kp["x"], (int, float)):
                errors.append(f"{kp_prefix}: 'x' should be numeric")

            if "y" in kp and not isinstance(kp["y"], (int, float)):
                errors.append(f"{kp_prefix}: 'y' should be numeric")

            if "score" in kp and not isinstance(kp["score"], (int, float)):
                errors.append(f"{kp_prefix}: 'score' should be numeric")

            if "x" in kp and isinstance(kp["x"], (int, float)):
                if not (0.0 <= kp["x"] <= 1.0):
                    errors.append(f"{kp_prefix}: 'x' should be in [0, 1], got {kp['x']}")

            if "y" in kp and isinstance(kp["y"], (int, float)):
                if not (0.0 <= kp["y"] <= 1.0):
                    errors.append(f"{kp_prefix}: 'y' should be in [0, 1], got {kp['y']}")

            if "score" in kp and isinstance(kp["score"], (int, float)):
                if not (0.0 <= kp["score"] <= 1.0):
                    errors.append(f"{kp_prefix}: 'score' should be in [0, 1], got {kp['score']}")

        # Check timestamps are non-decreasing
        if i > 0 and "time" in kf and "time" in data["keyframes"][i - 1]:
            if kf["time"] < data["keyframes"][i - 1]["time"]:
                errors.append(f"{prefix}: time {kf['time']} is less than previous {data['keyframes'][i-1]['time']}")

    return errors


def create_synthetic_pose_json() -> dict:
    """Create a valid synthetic pose JSON for testing."""
    import random
    random.seed(42)

    keyframes = []
    fps = 30.0
    num_frames = 90  # 3 seconds

    for i in range(num_frames):
        keypoints = []
        for name in KEYPOINT_NAMES:
            keypoints.append({
                "name": name,
                "x": round(random.uniform(0.1, 0.9), 4),
                "y": round(random.uniform(0.1, 0.9), 4),
                "score": round(random.uniform(0.5, 1.0), 4),
            })
        keyframes.append({
            "time": round(i / fps, 4),
            "keypoints": keypoints,
        })

    return {
        "fps": fps,
        "duration": round(num_frames / fps, 4),
        "keyframes": keyframes,
    }


def test_synthetic():
    """Test with a synthetic valid JSON."""
    print("Test 1: Validate synthetic pose JSON...")
    data = create_synthetic_pose_json()
    errors = validate_pose_json(data)
    if errors:
        print("  FAIL: Synthetic data should be valid but got errors:")
        for e in errors:
            print(f"    - {e}")
        return False
    print("  PASS")
    return True


def test_missing_fields():
    """Test validation catches missing fields."""
    print("Test 2: Detect missing fields...")
    errors = validate_pose_json({})
    if len(errors) < 3:
        print(f"  FAIL: Expected at least 3 errors for empty dict, got {len(errors)}")
        return False
    print(f"  PASS ({len(errors)} errors detected)")
    return True


def test_wrong_keypoint_count():
    """Test validation catches wrong number of keypoints."""
    print("Test 3: Detect wrong keypoint count...")
    data = {
        "fps": 30,
        "duration": 1.0,
        "keyframes": [{"time": 0.0, "keypoints": []}],
    }
    errors = validate_pose_json(data)
    has_count_error = any("expected 17" in e for e in errors)
    if not has_count_error:
        print("  FAIL: Should detect wrong keypoint count")
        return False
    print("  PASS")
    return True


def test_roundtrip_file():
    """Test writing and reading JSON file."""
    print("Test 4: JSON file roundtrip...")
    data = create_synthetic_pose_json()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f, indent=2)
        path = f.name

    try:
        with open(path) as f:
            loaded = json.load(f)
        errors = validate_pose_json(loaded)
        if errors:
            print("  FAIL: Roundtrip data should be valid")
            for e in errors:
                print(f"    - {e}")
            return False
        print("  PASS")
        return True
    finally:
        os.unlink(path)


def test_timestamps_ordered():
    """Test validation catches unordered timestamps."""
    print("Test 5: Detect unordered timestamps...")
    data = create_synthetic_pose_json()
    # Swap timestamps to create disorder
    data["keyframes"][1]["time"] = -1.0
    errors = validate_pose_json(data)
    has_order_error = any("less than previous" in e for e in errors)
    if not has_order_error:
        print("  FAIL: Should detect unordered timestamps")
        return False
    print("  PASS")
    return True


def test_file(filepath: str):
    """Validate an actual output file."""
    print(f"Validating file: {filepath}")
    with open(filepath) as f:
        data = json.load(f)
    errors = validate_pose_json(data)
    if errors:
        print(f"  FAIL: {len(errors)} errors:")
        for e in errors[:20]:
            print(f"    - {e}")
        if len(errors) > 20:
            print(f"    ... and {len(errors) - 20} more")
        return False
    print(f"  PASS: Valid pose JSON with {len(data['keyframes'])} keyframes")
    return True


def main():
    all_passed = True

    # Run built-in tests
    all_passed &= test_synthetic()
    all_passed &= test_missing_fields()
    all_passed &= test_wrong_keypoint_count()
    all_passed &= test_roundtrip_file()
    all_passed &= test_timestamps_ordered()

    # Optionally validate a file
    if "--file" in sys.argv:
        idx = sys.argv.index("--file")
        if idx + 1 < len(sys.argv):
            all_passed &= test_file(sys.argv[idx + 1])

    print()
    if all_passed:
        print("All tests passed!")
        sys.exit(0)
    else:
        print("Some tests failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()
