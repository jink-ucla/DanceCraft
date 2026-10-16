# DanceCraft

![DanceCraft illustrated banner: Dance. Review. Practice.](docs/images/dancecraft-hero-v2.png)

**A webcam dance challenge where Claude turns your scores into a focused practice plan, so you can retry and beat the host.**

Most of the DanceCraft product experience was rebuilt and extended with **Claude Code**, including the challenge UI, coaching, practice drills, results, replay review, and calibrated post-dance scoring.


****To the Claude Creator Summit Hackathon organizers:** Our demo video was blocked on YouTube because of copyrighted content (i.e. the K-POP video we used), so please find the finalized hackathon demo video here: [https://drive.google.com/file/d/14C6geNOzlsCMKRslBM4c-mJGKP2mHCjX/view?usp=drive_link](https://drive.google.com/file/d/14C6geNOzlsCMKRslBM4c-mJGKP2mHCjX/view?usp=drive_link)


## Watch the live demo

https://github.com/user-attachments/assets/6c3ad56c-1a6f-4ed2-9b57-87eda692c578

**[Watch or download the promotional replay](demo/DanceCraft_04_Synced_With_Audio.mp4)**

A saved dance attempt beside the reference, with skeleton overlays and music. This legacy recording uses a fixed editorial timing adjustment; the original recording and scores are unchanged.

## The challenge

Pick a short dance, follow it on your webcam, and chase the host's score. Review where you lost points, practice a section with the coach, then retry and compare your scores.

![Concept illustration of dancing, replay review, and focused practice in DanceCraft](docs/images/dancecraft-flow-v2.png)

*Original AI-generated concept artwork for this README. The app uses 2D characters.*

1. **Dance.** Import a reference video, choose its Mirror setting, and follow along with webcam pose tracking and live key-pose feedback.
2. **Review.** See section and body-part scores, tracking coverage, and a clear explanation of the result. Replay aligns your saved clip with the reference using music and recording timestamps captured during the dance.
3. **Practice.** Claude chooses a section, speed, repeat count, and concrete cue from the scoring evidence. The Practice button runs that drill.
4. **Retry and compare.** "Try Again" restarts the dance; "Try Full Dance" returns from a completed coach drill. Results can compare with your previous attempt and a saved host score in the same browser. This full two-attempt flow still needs a live-webcam rehearsal.

## Rebuilt with Claude Code

The rebuild focused on the parts that turn dance tracking into a coached challenge:

- **Arena and characters:** a new home hero, dancing character guide, named players, a host challenge, and a local leaderboard.
- **Coaching:** a backend Claude integration that turns measured performance into a structured practice plan and grounded battle commentary.
- **Practice and replay:** executable section loops, repetition counting, per-video Mirror controls, inline clip playback, and larger side-by-side review.
- **Results and scoring:** a new explanation panel, movement and framing evidence, and a calibrated post-dance scorer selected against competing designs and baselines.

We retained the pose-tracking and video-processing foundation and substantially reworked the experience around it. Claude Code supported development; the Claude API powers the in-app coach when configured.

## What Claude does

The motion engine computes the score. Claude receives timestamped section scores, body-part scores, tracking coverage, movement evidence, and previous/host attempts when available. It returns a practice section, playback speed, repetition count, and coaching cue.

The coach addresses low movement and poor framing before technique advice and avoids judging body parts that were out of frame. Battle commentary follows the measured scores; the app determines the winner.

API keys stay on the Express backend. Claude requests contain structured scores, not webcam video. Recordings can be stored by the app's own backend for History and replay. A labeled built-in coach handles missing credentials or failed API requests.

## Presentation

[Download the three-minute pitch deck](docs/presentation/DanceCraft_Final_Presentation.pptx)

## Run locally

Prerequisites: Node.js 20, 22, or 24 (Node 25+ cannot build `better-sqlite3`, so `npm install` stops with an engine error), Python 3.11 or 3.12 (mediapipe has no wheels for 3.13+), and FFmpeg.

On Windows, the setup script installs the project dependencies, creates the Python environment, installs yt-dlp, and downloads the pose model.

```powershell
git clone https://github.com/jink-ucla/DanceCraft.git
cd DanceCraft
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
.\start-dancecraft.cmd
```

On macOS or Linux (with FFmpeg installed, e.g. `brew install ffmpeg`):

```bash
git clone https://github.com/jink-ucla/DanceCraft.git
cd DanceCraft
npm install
python3.11 -m venv .venv            # or python3.12
.venv/bin/python3 -m pip install -r scripts/requirements.txt
curl -L -o scripts/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
cp .env.example .env
npm run dev                         # open http://localhost:5173
```

If your default Node is too new, use the version in `.nvmrc` (`nvm use`), or with Homebrew `brew install node@22` and put `$(brew --prefix node@22)/bin` first on your `PATH`.

For Claude coaching, set `ANTHROPIC_API_KEY` in your local `.env` and use an available `COACH_MODEL`. The backend reads the key. The built-in coach works without a key.

By default, `npm run dev` starts Vite on port 5173 and Express on port 3001. If the backend uses another port, set `VITE_API_BASE` before starting or building the frontend. The current presentation laptop uses frontend port 5174 and backend port 3002.

See the [setup and demo runbook](docs/dancecraft.md) for configuration and rehearsal steps.

## Stack and validation

React, TypeScript, and Vite power the UI. Express and SQLite manage the library and session history. MediaPipe tracks poses in the browser and extracts reference poses through Python; FFmpeg and yt-dlp handle video processing.

The integrated app passes 531 unit tests, TypeScript checks, a production build, two coach browser tests, and a recording-clock browser regression. The replay exporter also passes nine timing and destination-safety tests. The new post-dance scorer passed 39 target checks and 28 rank checks on each of two unseen seeds. Those checks use synthetic variations of one reference and three still-person recordings; they do not establish broad human dance accuracy or fairness.

The app tracks one dancer at a time, and the leaderboard is local to the browser. Existing repository-wide lint issues and older visual test baselines remain. At the last verification, live Claude calls were blocked by insufficient API credits, so the local demo used the built-in coach. See [current status](docs/status.md) and the [scoring evaluation](docs/scoring-evaluation.md) for details.

## Team

- **M. Wasil Wahi-Anwar:** [Instagram](https://www.instagram.com/wasilwahi/) · [LinkedIn](https://www.linkedin.com/in/m-wasil-wahi-anwar-63027459/)
- **Jin Kim:** [LinkedIn](https://www.linkedin.com/in/jin-kim-17551a107/)

## Credits

Built on [Groovy by JoeyWangTW](https://github.com/JoeyWangTW/groovy), under the [MIT license](LICENSE). Original copyright and license notices are preserved.
