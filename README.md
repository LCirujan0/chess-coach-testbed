# KnightPath

A chess coaching PWA. Fetches your Chess.com games, turns your real mistakes into puzzles, and coaches you through each position without giving the answer away.

**Stack:** Vanilla HTML/CSS/JS · Vercel (static + serverless) · Stockfish 17.1 WASM · Anthropic API

See `CLAUDE.md` for the full architecture, module map, project rules, and current status.

## Key files

- `today.html` — user home (daily session)
- `puzzle.html` — primary training screen (`/` redirects here)
- `review.html` — game review (replay + per-mistake coach + "drill this motif")
- `board-vision.html` — Board Vision warm-up (drills + hide-the-board tracker)
- `games.html` — Sync games (Chess.com ingestion)
- `api/coach.js` — Anthropic proxy (keeps the API key server-side)
- `api/tag.js` — AI puzzle motif classifier
- `js/puzzle/` · `js/games/` · `js/board-vision/` — page module engines (see `CLAUDE.md` for the module map)
- `css/tokens.css` — design system foundation (all CSS variables live here); `docs/design-system.md` is the brand reference
- `docs/learnings.md` — key architectural decisions and their rationale
- `qa/` — Playwright test suite + CI workflow

## Deploy to Vercel — 5 minute setup

### Option A: drag-and-drop (no CLI, no git)

1. Go to https://vercel.com/new
2. Sign up / log in (free, GitHub or email)
3. Click "Browse all templates" → scroll to bottom → "Create a project from scratch"
4. Or simpler: go to your Vercel dashboard, click "Add New..." → "Project"
5. Skip the GitHub flow. Look for "Deploy from local folder" or use Vercel CLI (next option).

Actually, easier:

### Option B: Vercel CLI (recommended, takes 2 minutes)

```bash
# Install once
npm i -g vercel

# In this folder:
cd path/to/chess-coach-testbed
vercel

# Follow the prompts. Accept defaults.
# It'll give you a URL like https://chess-coach-testbed-xxx.vercel.app
```

### Option C: through GitHub

1. Create a new GitHub repo (public or private, doesn't matter)
2. Upload `index.html` and `vercel.json` to it
3. Go to vercel.com → "Add New..." → "Project" → import the repo
4. Click Deploy. Vercel detects the static site automatically.

## After deploying

1. Set `ANTHROPIC_API_KEY` in Vercel → Project Settings → Environment Variables
2. Open the deployed URL — it redirects to `/puzzle.html`
3. Go to `games.html` to ingest your Chess.com games
4. Set up CI: add `VERCEL_AUTOMATION_BYPASS_SECRET` as a GitHub secret (see `qa/VERCEL-SETUP.md`)

## Running the QA suite

```powershell
cd qa
npm install
npx playwright install chromium webkit
npm test               # full suite, local
npm run test:smoke     # fastest signal
npm run integrity      # file integrity only, no browser
```

See `qa/README.md` for full details and `docs/qa-checklist.md` for the manual checklist.

<!-- deploy pipeline test: 2026-06-02T10:09Z -->
