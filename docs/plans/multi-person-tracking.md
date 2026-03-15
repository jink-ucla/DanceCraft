# Multi-Person Pose Tracking Plan

## Context
Groovy currently tracks a single person in dance videos. For K-pop group dances (e.g., 6 members), users want to:
1. **Select which dancer to follow** in a group video
2. **Local multiplayer** — multiple people in front of the webcam, each scored against a different (or the same) reference dancer

---

## Feature 1: Group Dance — Person Selection

### Overview
Extract poses for all visible people in a reference video. In the edit page, user selects which person to follow. During dance mode, scoring uses only that person's poses.

### Changes

#### A. Offline Pipeline (`scripts/extract_poses.py`)
- Change `PoseLandmarkerOptions` to accept `num_poses` param (default 1, pass via CLI `--num-poses N`)
- Output format change: add `persons` array to JSON
  ```json
  {
    "fps": 30,
    "duration": 180,
    "numPersons": 3,
    "persons": [
      { "id": 0, "keyframes": [ { "time": 0.0, "keypoints": [...] }, ... ] },
      { "id": 1, "keyframes": [ ... ] },
      { "id": 2, "keyframes": [ ... ] }
    ],
    "keyframes": [...]  // kept for backward compat (= person 0)
  }
  ```
- **Person tracking**: Simple spatial proximity heuristic — match detected poses to previous frame's persons by minimizing hip-center distance. Handles temporary occlusion with a gap tolerance.
- Post-processing runs per-person independently

#### B. Backend (`server/processing.ts`)
- Pass `--num-poses 6` (or auto-detect count from first N frames) to extract_poses.py
- No DB schema changes needed — pose data is already stored as a JSON file

#### C. Dance Settings (`src/storage/danceSettings.ts`)
- Add `selectedPerson: number` field (default 0)

#### D. Edit Page (`src/components/DebugMode.tsx`)
- When loaded JSON has `persons` array, show a person selector (thumbnails of each person's skeleton at a sample frame)
- Clicking a person highlights their skeleton in a different color on the video
- Selected person ID saved to dance settings
- All existing key pose editing works on the selected person's poses

#### E. Dance Mode (`src/components/DanceMode.tsx`)
- When loading poses, check for `persons` array
- Use `selectedPerson` from dance settings to pick which person's keyframes to use
- Everything else (key pose detection, scoring) works as-is since it operates on a single person's pose timeline

#### F. Backward Compatibility
- If JSON has no `persons` array, use existing `keyframes` (single-person format)
- Default `selectedPerson = 0`

### Estimated Scope
- `extract_poses.py` — medium (tracking heuristic, per-person output)
- `danceSettings.ts` — small (add field)
- `DebugMode.tsx` — medium (person selector UI)
- `DanceMode.tsx` — small (read selected person)
- `processing.ts` — small (pass flag)

---

## Feature 2: Local Multiplayer

### Overview
Multiple people dance in front of the webcam simultaneously. Each is detected, assigned a player slot, and scored independently.

### Changes

#### A. Browser Detector (`src/pose/detector.ts`)
- New function `initMultiDetector(numPlayers: number)` — creates PoseLandmarker with `numPoses: N`
- New function `estimateMultiPose(video)` — returns `Pose[]` (one per detected person)
- Keep existing single-pose functions for backward compat

#### B. Player Assignment
- **Calibration step**: Before dance starts, show "Player 1, step into the left zone" or "Player 1, raise your hand"
- Simpler approach: assign left-to-right by hip x-coordinate
- Track players across frames using spatial proximity (same heuristic as offline)
- New utility: `src/pose/playerTracker.ts`

#### C. Multiplayer Dance Mode (`src/components/MultiDanceMode.tsx`)
- New component (DanceMode is already complex enough)
- Split-screen or overlay showing each player's score/combo
- Each player has their own key pose index, score, combo
- Each player can follow the same or different reference person
- Webcam shows all players with color-coded skeleton overlays (player 1 = green, player 2 = blue, etc.)

#### D. UI Flow
- Home screen: "Play" (1 player) vs "Multiplayer" button on dance cards
- Multiplayer setup screen: how many players, which reference person each follows
- Results: side-by-side scores, winner highlight

#### E. Performance Considerations
- Multi-pose detection is ~2-3x slower than single-pose
- May need to reduce webcam resolution (320x240 → 240x180) or detection frequency
- Test GPU performance with 2-4 simultaneous poses
- Consider running detection every other frame if needed

### Estimated Scope
- `detector.ts` — small (multi-pose init)
- `playerTracker.ts` — medium (new file, assignment + tracking)
- `MultiDanceMode.tsx` — large (new component, complex state)
- Home/App routing — small (multiplayer entry point)
- CSS — medium (split-screen layouts, player colors)

---

## Implementation Order

### Phase 1: Group dance person selection (Feature 1)
Priority: **High** — this is the most common use case (learning a specific member's part)

Steps:
1. Update `extract_poses.py` with multi-person extraction + tracking
2. Update output format with backward compat
3. Add person selector to edit page
4. Wire selected person through to dance mode
5. Test with a real K-pop group video

### Phase 2: Local multiplayer (Feature 2)
Priority: **Medium** — fun party feature, more complex

Steps:
1. Multi-pose browser detection
2. Player tracker utility
3. MultiDanceMode component
4. Multiplayer UI flow
5. Performance testing + optimization

---

## Verification
- Import a group dance video (K-pop MV) and verify multi-person extraction
- In edit page, verify all persons' skeletons are visible and selectable
- Dance with person selection — verify scoring uses correct person
- For multiplayer: test with 2 people in front of webcam, verify independent scoring
- All existing unit tests still pass
- E2e tests still pass (single-person path unchanged)
