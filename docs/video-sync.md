# Recording and promotional replay timing

## What went wrong

The previous capture path treated recording wall time as if it were the reference video's music time. It queued `play()` and MediaRecorder startup independently, then timestamped poses after inference. The replay also assumed two independently playing videos would stay synchronized. Startup delay, slow inference, and a reference decoder stall could therefore separate the music from the recorded performance.

The old exporter inherited that assumption. Its green marker aligned the camera recording with saved poses, but the marker did not identify when the reference soundtrack actually played.

## What the investigation showed

- Session 12's original WebM has 888 variable-rate frames with presentation timestamps from 0 to 30.628 seconds. Its nominal 1000 fps header is not a usable frame clock.
- FFmpeg's 30 fps conversion preserved those presentation times. Frame comparisons showed no growing conversion drift.
- Independent pose extraction with the browser's MediaPipe Full model matched stored poses at approximately camera PTS plus 0.495 seconds. Separate ten-second windows gave 0.495, 0.500, and 0.485 seconds. The previous 0.4706-second pose offset was about one frame different.
- The larger visible difference was between the performance and the reference/music. Matching motion cues gave relative offsets of 1.300, 1.283, and 1.283 seconds across three sections.

The last measurement is an editorial estimate. The old session did not save reference music timestamps, so it cannot establish how much came from recorder startup, playback stalls, or the dancer's own timing.

## New recordings

DanceMode now waits for recording startup and reference playback, warms the detector before Ready, and freezes the same camera frame for inference and recording. Each saved pose carries two times:

- `time`: reference video/music seconds sampled before inference, used for scoring.
- `videoTime`: the recorded frame's timeline, used for replay and export.

Empty detections retain clock anchors. The existing JSON array and backend storage remain compatible. Replay follows the recording as its playback clock, maps that clock onto the saved music timeline, and corrects independent decoder drift. Old sessions remain readable through the legacy path.

## Corrected promotional export

The session 12 promotional comparison applies one constant 1.30-second editorial adjustment across the clip. It does not stretch individual dance moves, change saved poses, or recalculate official scores. The raw camera and reference exports remain available separately.

For this legacy recording:

```text
stored pose time = reference time + 1.30
camera PTS = stored pose time - 0.4706
```

The combined export starts at camera PTS 0.8294 seconds and ends at the natural overlap with the reference. It does not freeze the final frame to fill missing footage.

Use the portable exporter with new recordings:

```powershell
.\.venv\Scripts\python.exe scripts/export_replay.py `
  --user-video path/to/recording.webm `
  --user-poses path/to/user-poses.json `
  --reference-video path/to/reference.mp4 `
  --reference-poses path/to/reference-poses.json `
  --output-dir path/to/new-export-folder
```

For a legacy recording without `videoTime`, supply both explicit offsets. The session 12 values are `--legacy-pose-offset 0.4706 --legacy-music-offset 1.30`. The exporter labels those values as an editorial estimate and refuses to silently assume music and recording share a clock. Recorded anchors cannot be overridden by legacy offsets.

The exporter writes five MP4 files, a poster, and an `export-report.json`. It preserves VFR timestamps during conversion, uses actual source dimensions, checks audio/video end times, and verifies input hashes. Existing export files and destinations inside source recording data are rejected.

## Validation

The capture/replay change passed the 531-test unit suite, TypeScript checks, and a real Chromium MediaRecorder regression. That regression injected 120 ms of inference delay and a 450 ms reference stall, checked music timestamps within 20 ms, matched decoded frame IDs to their pose frames, and verified correction after forced replay drift. The exporter's nine timing and destination-safety tests also pass.

These synthetic browser checks validate the clock contract. A fresh physical-camera rehearsal remains the final check on the event laptop. The legacy promotional adjustment remains an estimate rather than a recovered original music clock.
