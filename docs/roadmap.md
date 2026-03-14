# Roadmap

## Vision

Open-source, web-based dance game. Dance along to any video, get scored, have fun.

## Milestones

### Phase 0: Proof of Concept
- [ ] Webcam feed with MoveNet pose estimation running in browser
- [ ] Draw skeleton overlay on webcam feed
- [ ] Confirm 30+ FPS on MacBook Pro
- **Goal**: Prove the tech works

### Phase 1: MVP
- [ ] Offline pipeline: download video → extract pose timeline → JSON
- [ ] Play reference video alongside webcam feed
- [ ] Real-time key-pose detection with feedback (hit/miss)
- [ ] Post-dance full scoring with DTW alignment
- [ ] Playback review with color-coded feedback
- [ ] Basic but polished UI
- **Goal**: "I can practice a dance and get scored"

### Phase 2: Playable
- [ ] Add more reference dances (easy import flow)
- [ ] Song/dance selection screen
- [ ] Score history / personal bests
- [ ] Score animations and visual polish
- **Goal**: Something you'd actually use regularly

### Phase 3: Learning Features
- [ ] Section-by-section practice (chorus, bridge, etc.)
- [ ] Slow-motion mode
- [ ] Per-joint "what's wrong" highlighting
- [ ] Loop a specific section
- **Goal**: Actually learn dances better

### Phase 4: Polish
- [ ] Cartoon avatar overlay (VRM + Kalidokit pipeline)
- [ ] Multi-dancer video support (pick which dancer to follow)
- [ ] Difficulty levels
- [ ] Share scores

## Current Focus

Phase 0: Proof of Concept → Phase 1: MVP
