# Scoring V2 — Key Pose Selection & Comparison Improvements

## Current Problems

### 1. Key poses are too easy to match
- "Distinctive" is measured against neutral standing, not against surrounding dance context
- A slightly bent elbow registers as a key pose even though it's not a real dance moment
- All 12 joints are scored equally for every pose — legs give "free points" when the move is about arms

### 2. High baseline similarity
- Two people standing naturally already score ~0.7 angle similarity (arms at sides = PI, legs straight = PI)
- The effective scoring range is 0.7–1.0, not 0.0–1.0
- Spatial comparison (40% of blend) helps but doesn't fully solve it

### 3. Poses don't capture choreographic intent
- "Held for 10 frames" catches pauses but misses quick signature moves
- No awareness of music, rhythm, or visual impact
- No concept of which body parts matter for each specific pose

---

## Improvement 1: Focus Joints (Implement First)

### Concept
When a key pose is selected, compute which joints are doing the interesting work — the ones that changed most compared to the surrounding frames. Score primarily on those joints.

### Detection: Per-Pose Focus Joints
For each key pose candidate at time T:
1. Sample the reference poses at T-1s, T-0.5s, T, T+0.5s, T+1s
2. For each of the 12 joints, compute the max angle deviation of T from its neighbors
3. Joints with deviation above a threshold are "focus joints" for this pose
4. Tag: `focusJoints: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow']`

### Scoring: Weighted by Focus
During comparison, adjust joint weights dynamically:
```
focusWeight = 3.0   (for joints in the focus set)
otherWeight = 0.3   (for non-focus joints — still contributes, but minor)
```

This means:
- An arm-focused pose: arms contribute ~80% of score, legs ~20%
- A squat/kick pose: legs contribute ~80%, arms ~20%
- A full-body pose: all joints contribute roughly equally

### Tuning
The `focusWeight` / `otherWeight` ratio is the key parameter:
- 3.0 / 0.3 (10:1) = strict, only the focus matters
- 3.0 / 1.0 (3:1) = moderate, focus is emphasized but body coherence still counts
- 2.0 / 1.0 (2:1) = gentle, slight focus preference

Start with 3:1, tune with playtesting.

### Side Benefit: UI Feedback
Since we know which body parts matter, we can display cues:
- "Arms!" / "Legs!" / "Full Body!" before each key pose
- Per-body-part grade after the pose: "Arms: Perfect, Legs: Good"
- In replay, color-code the skeleton by how well each limb matched

### Implementation
- Add `focusJoints: string[]` to the `KeyPose` interface
- Compute focus joints in `detectKeyPoses()` after candidates are selected
- In `comparePoses()`, accept optional focus joint set and adjust weights
- Display focus cue in DanceMode HUD ~2s before each key pose

---

## Improvement 2: Better Distinctiveness

### Context-Relative Distinctiveness
Current: how different is this pose from neutral standing?
Proposed: how different is this pose from its neighbors in the timeline?

```
contextDistinctiveness(T) = max(
  comparePoses(T, T-1s),
  comparePoses(T, T+1s)
) inverted — high distance = high distinctiveness
```

This catches moments where the dancer does something genuinely different from what they were just doing, rather than moments that just happen to not look like standing.

### Steeper Similarity Curve
Current: `similarity = 1 - |diff| / PI` (linear, range ~0.7-1.0 for typical poses)
Proposed: `similarity = max(0, 1 - (diff / threshold)^2)` (quadratic, sharper dropoff)

With threshold = PI/3 (~60 degrees):
- 0° difference → 1.0
- 30° difference → 0.75
- 60° difference → 0.0
- Beyond 60° → 0.0

This eliminates the "free baseline" problem entirely. Small errors matter more, and unrelated poses score near 0.

### Minimum Focus Joint Match
If a key pose has focus joints and the user's focus joints aren't detected (low confidence), score as a miss instead of falling back to whatever joints ARE visible.

---

## Improvement 3: VLM-Assisted Pose Selection (Add-On)

### Concept
Use a vision-language model (Qwen 2.5 VL 3B via Ollama) to evaluate key pose candidates visually. The VLM understands visual salience — it can tell whether a frame looks like a dramatic dance moment or a boring transition.

### Two Modes

**Filtering** — For each candidate, send the video frame:
> "This is a frame from a dance video. Rate 1-5: How visually dramatic or distinctive is this pose? Would a viewer remember this moment?"

Discard candidates that score below 3.

**Comparison** — For a time window with multiple candidates, send 3-5 frames:
> "These are consecutive frames from a dance. Which one captures the peak moment of the move? Reply with the frame number."

Keep the winner.

### Pipeline Integration
1. `detectKeyPoses()` produces ~30-40 candidates (fast, existing math)
2. Extract video frames for each candidate as JPEG
3. Send to Ollama for filtering/ranking (1-2s per image, ~60s total)
4. Return refined list of ~15-25 high-quality key poses

### Technical Notes
- Run in the server-side import pipeline (Python or Node → Ollama HTTP API)
- Send raw video frames, not skeleton overlay (VLM understands poses natively)
- Could batch: send 4 candidates per request for comparison mode
- Fallback: if Ollama isn't available, use math-only selection (existing behavior)

### Criteria to Explore
- Visual drama / audience impact
- Symmetry breaking (asymmetric poses are more distinctive)
- Uniqueness within the dance (don't pick 5 similar arm raises)
- Alignment with music (if beat data is available)

---

## Improvement 4: Beat-Aware Scoring

### Concept
Extract musical beats from the audio track and use them to improve both key pose selection and real-time scoring.

### Beat Extraction
Use audio analysis to detect:
- **Beat timestamps** — rhythmic pulse (e.g., every 0.5s for 120 BPM)
- **Downbeats** — strong "1" of each measure (where big moves land)
- **Energy peaks** — drops, accents, loud moments

Tools:
- Python: `librosa.beat.beat_track()` or `madmom` (higher accuracy)
- JS (browser): `essentia.js` or Web Audio API + onset detection
- Run during import pipeline alongside pose extraction

### Key Pose Selection: Snap to Beats
- Prefer candidates within ~100ms of a beat
- Prioritize downbeats and energy peaks
- Penalize candidates between beats (likely transitions, not intentional poses)

### Scoring: Timing Component
Add a timing dimension to the real-time score:

```
timingScore = 1.0 - min(1.0, |peakMovementTime - nearestBeat| / toleranceWindow)
shapeScore  = existing pose comparison
finalScore  = shapeScore × (0.7 + 0.3 × timingScore)
```

- User hits the right pose ON the beat → full score
- Right pose but half a beat late → 70% of score
- `toleranceWindow` ≈ 150ms (generous) to 80ms (strict)

### UI Enhancement
- Pulse the target pose cue on the beat
- Show a "rhythm" grade alongside the pose grade
- Streak bonus for consecutive on-beat hits

### Implementation Phases
1. Beat extraction in Python import pipeline → store alongside pose data
2. Snap key pose selection to beats
3. Add timing component to real-time scoring
4. UI rhythm feedback

---

## Improvement 5: Dynamic Movement Scoring (IMPLEMENTED)

### Concept
Detect and score dynamic movements (arm swings, kicks, extensions) — not just static pose snapshots. Scores whether the user is doing the same movement: right joints, right direction, right magnitude.

### Detection
Scans the reference timeline for sustained high-velocity windows:
- Angular velocity > 0.15 rad/frame sustained for ~0.3s
- At least one joint changes by > 0.8 rad (~45°) across the window
- Records expected per-joint angle change (signed = direction matters)
- Tagged as `type: 'move'` with `expectedVelocity` and `moveWindow`

### Scoring
For move-type key poses, blends velocity match (60%) + pose match (40%):
- `compareMoveVelocity()`: compares user's angular change over the window to expected
  - Same direction + similar magnitude → high score
  - Wrong direction → 0
  - Didn't move → 0.1
  - Focus joints weighted 3x
- Combined: `effectiveScore = (0.6 × velocityScore + 0.4 × poseScore) × movementFactor`

### Priority in Detection
Held > Transition > Move > Distinctive — moves fill gaps between static poses.

---

## Improvement 6: Difficulty Levels (IMPLEMENTED)

### Concept
Three difficulty presets (Easy/Normal/Hard) that control timing windows, score thresholds, cue lead time, and focus joint weighting. Selected before each dance, stored in score history.

### Presets
| Parameter | Easy | Normal | Hard |
|-----------|------|--------|------|
| Timing window | 0.6+0.7s | 0.4+0.5s | 0.25+0.3s |
| Perfect threshold | 70% | 80% | 90% |
| Good threshold | 45% | 55% | 70% |
| Cue lead time | 3.0s | 2.5s | 2.0s |
| Focus weight | 2× | 3× | 5× |
| Non-focus weight | 1× | 0.5× | 0.3× |

### Data Flow
Difficulty selection modal → DanceMode prop → scoring logic → saved in ScoreEntry → shown in History.

---

## Improvement 7: Deduction-Based Scoring (IMPLEMENTED)

### Concept
Instead of abstract averages, score by deduction: start at 100, subtract penalties per joint. Focus joints cost up to 15 pts each, non-focus up to 5 pts. Shown in replay scoring panel.

### Replay Scoring Panel
- Big deduction score (100 → color-coded)
- Angle/Spatial bars
- Per-joint deductions sorted by penalty (biggest first)
- Focus joints marked with *
- Good joints shown as green tags
- Color-coded skeleton overlay (green/yellow/red per bone)

---

## Implementation Status

| # | Improvement | Status |
|---|-----------|--------|
| 1 | Focus joints | DONE |
| 2 | Better distinctiveness | DONE |
| 3 | Beat-aware scoring | Planned |
| 4 | VLM filtering | Planned |
| 5 | Dynamic movement scoring | DONE |
| 6 | Difficulty levels | DONE |
| 7 | Deduction-based scoring | DONE |

---

## Open Questions

- What focus weight ratio feels best per difficulty? (needs playtesting)
- For beats: use librosa (Python, most accurate) or essentia.js (browser, no server needed)?
- For VLM: filtering mode vs comparison mode — which gives better results per API call?
- Move detection thresholds: 0.15 rad/frame velocity and 0.8 rad change — tune with real dances
- Should moves show a different visual cue than static poses? (e.g., animated arrow showing direction)
