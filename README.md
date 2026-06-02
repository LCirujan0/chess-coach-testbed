# Chess Coach — Connection Testbed

This is the v2 testbed. It deploys to Vercel and tests every dependency we need before building the full app.

## Files

- `index.html` — the testbed page with 6 tests
- `vercel.json` — sets HTTP headers for CORS/COOP/COEP (needed for some Stockfish builds)
- `README.md` — this file

## What gets tested

1. **localStorage** — persistence across browser sessions
2. **Chess.com API** — fetching game archives, known to be flaky for CORS
3. **chess.js library** — PGN parsing via the standard JS library (loaded from esm.sh)
4. **Stockfish online API** — the fallback engine (stockfish.online)
5. **Stockfish WASM** — the primary engine, running locally in your browser via Web Worker
6. **Anthropic API** — coaching commentary (needs your personal API key)

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

1. Open the Vercel URL on your iPhone (or any browser)
2. Type your Chess.com username (defaults to LCirujano)
3. Tap "Run all tests"
4. Look at the status badges. Tap "Show output" on any failure to see the raw error.
5. Send me the results.

## What I'm looking for in the results

- **Test 2 (Chess.com):** does it work from a real https origin? If yes, we can skip the serverless proxy.
- **Test 3 (chess.js):** does the library load and parse a real game? If not, we may need a different library or to ship it bundled.
- **Test 5 (Stockfish WASM):** does it work from a CDN? If not, we'll bundle Stockfish files in the Vercel deploy.
- **Test 6 (Anthropic):** does it work with `anthropic-dangerous-direct-browser-access`?

## Why this matters

Last time I built the app first and then found CORS/dependency issues at runtime. This time we verify each dependency in isolation, then build only on what's confirmed working. No more "this should work" guesses.

<!-- deploy pipeline test: 2026-06-02T10:09Z -->
