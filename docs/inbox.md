# Inbox

Action items from co-founder discussions, standups, and meetings appear here.
Mark items as `[SEEN]` after reading them.

---

## From discussion: dance-app (2026-03-14)
- [DONE] Research: Download reference video and test MoveNet pose extraction quality — replaced with MediaPipe BlazePose
- [DONE] Research: Evaluate MoveNet Lightning vs MediaPipe for this use case — MediaPipe wins decisively (95% vs 30% accuracy)
- [SEEN] Design: Key pose detection algorithm (which poses are "dramatic" enough to be key poses)
- [SEEN] Design: UI/UX for dance mode + post-dance review with playback
- [SEEN] Decision needed: Mirror mode — should user mirror the dancer or match same-side?

## From CEO meeting (2026-03-14)

### Bug fixes (Phase 1) — ALL DONE
- [x] Fix music not playing — video element is muted, need to remove `muted` and handle autoplay
- [x] Move feedback (Perfect/Good/Miss) from center to corner/side — too distracting in center

### Feature requests — ALL DONE
- [x] YouTube URL input -> download + process -> add to dance library (Phase 2)
- [x] Save recordings of user dance sessions with tracking data for replay (Phase 3)
- [x] Practice mode with pause, scrub back/forward, section looping (Phase 4)

### Quality items — ALL DONE
- [x] UI is rough and developer-looking — needs a polish pass with design references
- [x] Need Playwright browser tests that capture screenshots for agent-driven visual fixes (Phase 5)
- [x] Update PRD with complete feature set -> DONE (prd.json updated with 23 new stories)

### Architecture decisions — ALL DONE
- [x] Need a backend/database — can no longer be browser-only (adding dances requires server-side yt-dlp)
- [x] SQLite chosen for simplicity (single file, no external DB service needed)
- [x] Node.js/Express backend to wrap existing Python pipeline

### Phase 6 session (2026-03-15)
- [x] Pose detection accuracy is bad → upgraded to MediaPipe BlazePose (both browser + offline)
- [x] Skeleton misaligned on video → fixed resize_with_pad bug, added post-processing
- [x] Import errors silently → processing cards with error display, job tracking
- [x] Can't delete bundled dances → three-dot menu with hide via localStorage
- [x] Dance mode not full screen → full-window with fixed positioning
- [x] No visual indicator for scoring poses → target pose figure with countdown border
- [x] No way to inspect pose data → debug mode with skeleton overlay + key pose timeline
