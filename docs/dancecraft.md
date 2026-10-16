# DanceCraft - AI Motion Arena (runbook)

DanceCraft is built on top of **[Groovy](https://github.com/JoeyWangTW/groovy) by JoeyWangTW (MIT license)**,
an open-source browser dance game: MediaPipe pose tracking in the browser, joint-angle + DTW scoring,
practice mode and replay. Everything Groovy does still works; DanceCraft adds a live-event layer on top.

## What DanceCraft adds

| Feature | What it does |
|---|---|
| Host's own dance | `npm run add-dance` turns a local MP4 (e.g. Wasil's dance) into a bundled, playable dance - no YouTube needed |
| Players | Challenger enters a name; the host plays first with **"I'm the host"** checked to set the score to beat |
| AI Coach (Claude) | The Express API sends the real scores (overall, 10 s sections, Arms/Legs, rank) to Claude and gets back a structured plan: weak section, speed, reps, one body cue |
| Coach-driven drill | The plan drives PracticeMode: loops the weak section at reduced speed (0.5x / 0.75x) for N reps |
| Retry + compare | "Try Full Dance" -> attempt 2 is compared with attempt 1 ("did I improve?") and with the host ("Beat Wasil" verdict) |
| Leaderboard | Per-dance scores with the host marked; "Next challenger" resets for the next person |
| Dance buddy | A cute 2D character (upgraded from Groovy's capsule mannequin) demos the move |

No API key? The coach falls back to a deterministic **built-in coach**, so the event never breaks.

## Setup

Requirements: Node 20+, Chrome or Edge, a webcam, and (only for importing dances) Python **3.11 or 3.12**.
ffmpeg and yt-dlp are optional (YouTube imports and thumbnails).

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

The script checks node/npm/python/ffmpeg/yt-dlp, picks a mediapipe-friendly Python (`py -3.11`, `py -3.12`,
`py -3.10`, else `python` on PATH), creates `.venv`, installs `mediapipe opencv-python-headless numpy yt-dlp`,
downloads `scripts\pose_landmarker_heavy.task`, runs `npm install` if `node_modules` is missing, and creates
`.env` (from `.env.example`) with `PYTHON_PATH=.venv/Scripts/python.exe`. It never writes API keys.
Switches: `-SkipPip`, `-SkipModel`, `-SkipNpm`, `-Python C:\path\to\python.exe`. Safe to re-run.

Missing tools: `winget install OpenJS.NodeJS.LTS`, `winget install Python.Python.3.12`,
`winget install Gyan.FFmpeg`, `winget install yt-dlp.yt-dlp` (reopen the terminal afterwards).

### macOS / Linux

```bash
npm install
python3.12 -m venv .venv            # or python3.11
.venv/bin/python3 -m pip install mediapipe opencv-python-headless numpy yt-dlp
curl -L -o scripts/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
cp .env.example .env                # then add ANTHROPIC_API_KEY (see below)
```

### Run

```bash
npm run dev     # frontend http://localhost:5173 + API http://localhost:3001
```

## Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | - | Enables the Claude coach + battle commentary. Without it: built-in coach |
| `COACH_MODEL` | `claude-sonnet-5-5` | Model used by the coach (`CLAUDE_MODEL` also accepted) |
| `COACH_EFFORT` | `low` | Reasoning effort (low = fast answers on the results screen). Not `CLAUDE_EFFORT` — Claude Code sets that one |
| `COACH_OFFLINE` | - | `1` forces the built-in coach (e.g. bad venue Wi-Fi) |
| `PYTHON_PATH` | `.venv/Scripts/python.exe` (Windows), `.venv/bin/python3` (macOS/Linux) | Python with mediapipe, used by add-dance and YouTube imports. Relative paths are resolved from the repo root |
| `PORT`, `CORS_ORIGIN`, `DATA_DIR`, `DB_PATH` | see `.env.example` | Groovy server settings |

Restart `npm run dev` after editing `.env`.

## Adding the host's own dance

```bash
npm run add-dance -- path/to/wasil.mp4 --id wasil --title "Beat Wasil" --host Wasil
```

What it does: validates the file (mp4/webm/mov/m4v), copies it to `public/dances/wasil.mp4`, runs
`scripts/extract_poses.py` (MediaPipe BlazePose Heavy; takes roughly 1-2x the video length on CPU) to
write `public/dances/wasil.json`, grabs a thumbnail if ffmpeg is installed, and upserts the entry in
`public/dances/manifest.json`. The app loads that manifest at startup, so the dance shows up on the home
screen even if the API server is down. Local files need neither ffmpeg nor yt-dlp.

Options: `--id` (default: slug of the file name), `--title` (default "Beat <host>"), `--host`,
`--max-duration 90` (warns if longer), `--python <path>`, `--skip-extract` (reuse existing JSON, e.g. to
rename), `--no-thumbnail`. Manage: `npm run add-dance -- --list`, `npm run add-dance -- --remove wasil`
(manifest only; files stay). Python is resolved as `--python` > `PYTHON_PATH` env > `PYTHON_PATH` in `.env`
> `.venv` > `python` on PATH.

Filming tips for a dance that scores well:

- **15-20 seconds** is plenty (scoring is in 10 s sections; short = more challengers per hour).
- **Full body in frame** the whole time, head to feet, with a little margin. Camera fixed at chest height, 2-3 m away.
- **Good, even light**, plain background, clothes that contrast with the wall. One person in the shot.
- **Exaggerated, clear moves**: big arm shapes and visible leg work score better than subtle grooves.
- **4-5 distinct poses** that are held a beat - those become the key poses challengers must hit.
- Phone video: record in H.264 ("Most Compatible" on iPhone), landscape or portrait both work.

## Live demo flow

1. **Host first**: on the player screen check **"I'm the host"**, enter "Wasil", play "Beat Wasil". This sets the score to beat. (Later runs under the host's name count as host runs even if the box is left unticked.)
2. **Challenger** clicks "Next challenger", enters their name, and dances (one person in front of the camera).
3. **Results**: score, rank, per-section and Arms/Legs breakdown + **AI Coach plan** (weak section, speed, reps, cue).
4. **Practice drill**: start the drill - PracticeMode loops the weak section at reduced speed for N reps, with the character demoing the move. **Back** from a coach drill returns to the results (same plan, Claude is not asked again).
5. **Try Full Dance**: dance again; results show **improvement vs last try** and the **Beat-the-host verdict**.
6. **Leaderboard**, then **"Next challenger"** for the next person in line.

Only **one person is tracked at a time** (MediaPipe `numPoses: 1`) - keep spectators out of the camera view.

### Dev preview URLs (no webcam needed, dev server only)

- `http://localhost:5173/?preview=results` - results screen with a mock attempt (weak 10-20 s section, previous try, host score) to exercise the coach + battle UI.
- `http://localhost:5173/?preview=practice-drill` - PracticeMode on the first available dance, driven by a sample coach plan.

UI smoke test (all API calls mocked, fake webcam; Playwright starts its own Vite on port 5174): `npx playwright test tests/e2e/dancecraft-coach.spec.ts --reporter=list`. Screenshots land in `tests/e2e/screenshots/dancecraft-*.png`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Camera blocked / black | Allow the camera in the browser (lock icon in the address bar). Windows: Settings > Privacy & security > Camera > allow desktop apps. Close Teams/Zoom/OBS that may hold the camera. Use `http://localhost` (secure context). |
| Pose tracking slow or fails to start | Needs WebGL 2: use Chrome/Edge, enable "Use graphics acceleration when available", check `chrome://gpu`. Plug in the laptop. |
| "Could not connect to server" | The API on port 3001 isn't running or the port is taken. Windows: `netstat -ano \| findstr :3001`, then `taskkill /PID <pid> /F`. Bundled dances still load. |
| Frontend on 5174 instead of 5173 | Port 5173 was busy. If `.env` has `CORS_ORIGIN=http://localhost:5173`, API calls fail - free 5173 or remove `CORS_ORIGIN` (default allows any localhost port). |
| Coach shows **"Built-in coach"** | No `ANTHROPIC_API_KEY` in `.env`, `COACH_OFFLINE=1`, or the Claude call failed (hover the badge for the reason). Add the key and restart `npm run dev`. |
| add-dance: mediapipe install / import fails | mediapipe wheels may not exist for Python >= 3.13. Install 3.11/3.12 (`py -0p` lists installed versions), delete `.venv`, re-run the setup script. |
| add-dance: "python" opens the Microsoft Store / exit 9009 | That's the Store alias, not a real Python. Run the setup script or pass `--python`. |
| add-dance: model not found | The script prints `curl` and `Invoke-WebRequest` commands for `scripts/pose_landmarker_heavy.task`. |
| add-dance: video won't open / no person detected | Re-export as H.264 MP4; make sure the full body is visible and well lit. |
| New dance not on the home screen | Check `npm run add-dance -- --list` (MISSING files are flagged) and hard-refresh the page. |
