# KnightPath — Claude Code context

## What this is

KnightPath is a chess coaching PWA. It fetches a player's Chess.com games, analyses them with Stockfish, turns real mistakes into puzzles, and coaches the player through each position using Anthropic-powered hints — without giving the answer away. Target user: a player climbing from ~950 to 1500 Elo.

**App name:** KnightPath  
**Repo folder:** `chess-coach-testbed` (legacy name — ignore it, this is the full production app)  
**Current version:** v0.66 live on prod (2026-06-09). **v0.67–v0.71 are STAGED** (uncommitted, `APP_VERSION` stamps v0.71) pending review + per-deploy QA — richer ingestion (Spec 24), openings trainer, coach unification, retention foundation, themed-drilling supply, the mistake-intro replay, piece-slide animation, and the first wave of audit fixes. See `docs/learnings.md` (v0.67–v0.71) + `../docs/super-app-roadmap.md` "Roadmap v4".  
**Deploy:** ship via `combined-deploy-v2` → `master` → Vercel (auto-deploys prod, `chess-coach-coral.vercel.app`). See `docs/learnings.md` for the per-version build log.  
**Chess.com account:** LCirujano (hardcoded in `config.js` → `CHESS_COM_USERNAME`)

---

## Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript. No framework, no bundler, no build step.
- **Deployment:** Vercel — static site + two serverless functions in `api/`.
- **Chess engine:** Stockfish 17.1 WASM, bundled locally in `engine/`.
- **Chess logic:** chess.js, loaded at runtime from `esm.sh` (CDN — no local install).
- **AI coaching:** Anthropic API, proxied through `api/coach.js` so the key never reaches the browser.
- **PWA:** `manifest.json` + offline-capable via local Stockfish bundle.

---

## Running locally

```powershell
python -m http.server 4173
```

Run from the repo root. No `npm install` needed at the root — the only `package.json` is inside `qa/` and is for the Playwright test suite only.

> **Windows gotcha:** the bundled `npx serve` crashes with `EMFILE` here — use `python -m http.server`. Point Playwright at it with `BASE_URL=http://127.0.0.1:4173`. (See `docs/learnings.md`.)

---

## Environment variables

Set in **Vercel → Project Settings → Environment Variables** (never in code):

| Variable | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `api/coach.js`, `api/tag.js` | Never exposed to the browser. Required for AI coach + AI puzzle tagging. |

GitHub secret (not Vercel):

| Secret | Used by | Notes |
|---|---|---|
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `.github/workflows/qa.yml` | Lets CI through Vercel's preview login wall. See `qa/VERCEL-SETUP.md` for one-time setup. |

---

## App pages

`/` redirects to `/puzzle.html` via `vercel.json`. The actual user home is `today.html`.

| Page | Purpose |
|---|---|
| `today.html` | Daily session home — the user's entry point |
| `practice.html` | Practice hub — fans out to Puzzles / Endgames / Recognition / Board Vision |
| `puzzle.html` | Mistake puzzle training (primary training screen) |
| `endgames.html` | Endgame play-out training |
| `endgame-recognition.html` | Win/draw/loss recognition training |
| `board-vision.html` | Board Vision warm-up — 3 procedural drills + a 6-level hide-the-board tracker (Spec 14, v0.62) |
| `review.html` | **Game review** (primary "Review" tab, v0.64) — replay a game, per-mistake coach, "drill this motif" |
| `games.html` | **Sync games** — Chess.com ingestion only (v0.64: review moved to review.html; demoted to nav "More") |
| `insights.html` | Progress stats, estimated rating, practice heatmap |
| `coach.html` | AI coach interface |
| `session.html` | In-session wrapper (no nav chrome, used mid-session) |
| `completed.html` | Post-puzzle summary and review |
| `roadmap.html` | In-app roadmap (user-facing) |
| `index.html` | **Legacy testbed page** — 6 dependency tests from the prototype phase. Not the app home. |

---

## Architecture

### Serverless API (`api/`)

| File | Endpoint | Purpose |
|---|---|---|
| `coach.js` | `POST /api/coach` | Proxies to Anthropic API. Forwards body as-is; returns Anthropic response verbatim. No logging. |
| `tag.js` | `POST /api/tag` | Sends up to 20 puzzle positions to Claude Haiku for motif/theme classification. |

### Puzzle module (`js/puzzle/`)

17 ES modules. All pages that host a board load `boot.js` as `<script type="module">`, which imports the rest.

| Module | Responsibility |
|---|---|
| `config.js` | All constants and feature flags. Import from here — never hardcode values in other modules. |
| `state.js` | Single source of truth for all runtime state. One `state` object for the whole session. |
| `dom.js` | `$()` shorthand and DOM utilities. |
| `storage.js` | All localStorage reads and writes. Persistence goes through here only. |
| `boot.js` | Entry point. Registers global error handlers first (critical — see `docs/learnings.md` v0.7), then initialises everything else. |
| `board.js` | Renders the chess board; handles piece drag and click. |
| `engine.js` | Manages the Stockfish Web Worker. Sends UCI commands, parses responses. |
| `gate.js` | Pre-move "thinking gate" — CCTO questions + dwell timer (Deep mode only). |
| `queue.js` | Builds and navigates the puzzle queue. Filters by severity, category, motif, tried status. |
| `grade.js` | Evaluates player moves against engine lines. Assigns cp loss, pass/fail verdict. |
| `classify.js` | Classifies puzzle position by game phase (opening / middlegame / endgame). |
| `playout.js` | Plays out endgame positions move-by-move against Stockfish. |
| `coach.js` | Sends coach messages to Anthropic via `/api/coach`. Manages the coach log panel. |
| `pending.js` | Renders the feedback card shown while the engine is thinking. |
| `result.js` | Renders post-move result cards (correct / wrong / cp loss). |
| `resolved.js` | Handles the post-puzzle resolved state and "next puzzle" navigation. |
| `review.js` | Review mode — entered from `completed.html?id=…`. |
| `lib.js` | Shared chess utilities: FEN helpers, move normalisation, eval formatting. |

### Other JS (`js/`)

| File | Purpose |
|---|---|
| `board-static.js` | Canonical STATIC board renderer (`renderStaticBoard`) — reused by recognition, game review (`review.html`), and Board Vision. The single non-interactive board. |
| `coach-stats.js` | Fetches and caches the user's Chess.com rating. |
| `coach-widget.js` | Reusable coach panel widget (endgames/recognition). Reads live `state.chess` moves via a `getLiveContext` hook (v0.60). |
| `material.js` | Renders the material balance display (captured pieces + net advantage, v0.59). |
| `session-wrap.js` | Logic for the in-session wrapper (`session.html`). |
| `tagger.js` | Client-side caller for `api/tag.js` — batches puzzles and applies returned motifs. |

### Games module (`js/games/`)

`games.html` was modularized (Spec 10, v0.61) — same pattern as `js/puzzle/`. `games.html` loads `boot.js`; `review.html` imports `review.js` standalone.

| Module | Responsibility |
|---|---|
| `boot.js` | `games.html` entry — wires the ingest form, clear, backfill, narration. |
| `ingest.js` | The Chess.com → Stockfish → mistakes pipeline. Captures the SAN move list (`chess-coach-game-moves-v1`) for replay. |
| `chesscom.js` / `analysis.js` / `categorize.js` / `classify.js` | Chess.com fetch · Stockfish wrapper · phase categorization · motif classifier (prompt-bearing). |
| `storage.js` / `state.js` / `dom.js` / `config.js` / `lib.js` | Plumbing: localStorage · shared state · DOM helpers · consts · the chess.js pin. |
| `list.js` / `narrate.js` | Mistake-list render · per-game "how you played" narration (prompt-bearing). |
| `review.js` | **Spec 11 interactive game review** (`review.html`): replay, severity badges, per-mistake grounded coach card, "drill this motif" deep-link. |

### Board Vision module (`js/board-vision/`)

Spec 14 (v0.62). `board-vision.html` loads `boot.js`. No engine/network for the drills.

| Module | Responsibility |
|---|---|
| `generators.js` | Pure, node-testable generators for Coordinate Snap / Knight Vision / Piece Walk. |
| `tracker.js` | Procedural hide-the-board sequence tracker (uses chess.js — sparse base FEN + N random legal moves). |
| `boot.js` | UI runner — hub, drill loops, the tracker show→hide→read→answer→replay flow, storage. |

### CSS (`css/`)

`tokens.css` is the foundation — everything else builds on its variables. Canonical link order: **tokens → shell → nav → board → type → screen → train → [page].css**. See `docs/design-system.md` for the brand reference.

| File | Covers |
|---|---|
| `tokens.css` | Design system foundation — all CSS variables (colours, spacing, radii, shadows). Never redefine these inline. |
| `shell.css` | **Canonical app chrome** — the branded `.header-bar` (knight mark + wordmark + screen chip), body/container, nav drawer + tab-bar, and the desktop `@media (min-width:880px)` (pinned nav + 1100 container). Every page links this; do not re-declare chrome inline. |
| `nav.css` | Nav contents: sub-group (Puzzles/Endgames/Recognition/Board Vision) + "More" group links. |
| `board.css` | Canonical board — squares, pieces, coords, highlight overlays (incl. the `bv-*` Board Vision states + `.bv-hidden`). |
| `screen.css` | The `.layout-grid` training-screen shell (`.lg-head`/`.lg-left`/`.lg-right`) shared by every board page. |
| `type.css` | Typography: Plus Jakarta Sans (display) / Inter (body) / Spline Sans Mono (data). |
| `train.css` | Shared training components — `.btn`/`.btn.primary`/`.btn.ghost`, `.board-wrap`, `.controls`, `.coach-card`. |
| `puzzle.css` | Puzzle page layout and controls. |
| `gate.css` | Thinking gate card. |
| `session-wrap.css` | In-session wrapper (`session.html`). |
| `endgames.css` | Endgames and recognition pages. |
| `recognition.css` | Endgame recognition specifics. |
| `board-vision.css` | Board Vision page layout — hub cards, ladder rungs, drill prompt, complete screen (board styling stays in `board.css`). |

> **Note:** `header.css` was created in v0.65 then **deleted in v0.66** — the branded header is now single-sourced in `shell.css`. Don't reference it.

### Data files (`data/`)

Both files are **hand-authored**. Do not auto-generate or overwrite them.

- **`endgames.json`** — endgame lesson definitions. Each entry has `id`, `title`, `category`, `difficulty`, `fen`, `sideToMove`, `goal`, `technique`.
- **`endgame-recognition.json`** — recognition positions. Each entry has `id`, `type`, `fen`, `answer`, `explanation`.

---

## Project rules — do not change without a logged rationale in `docs/learnings.md`

1. **No build step.** Zero-dependency frontend. No webpack, Vite, TypeScript compilation, or bundler.
2. **All constants in `config.js`.** Import from there. Never hardcode a cp threshold, timer value, storage key, or depth value in a module.
3. **One `state` object.** All runtime state lives in `state.js`. Do not introduce a second store.
4. **50/100 cp tier thresholds and 0.3 accuracy multiplier** are calibrated values. Do not change them without documented reasoning (see `docs/learnings.md` v0.53).
5. **Coach panel discipline.** The coach log must only contain messages from the AI or responses Jorge wrote. No auto-injected messages mid-solve (see `docs/learnings.md` v0.7).
6. **No-spoiler rule.** Coach system prompts must never include engine lines, PV moves, eval scores, or best-move identifiers. Position summary only (see `docs/learnings.md` v0.7).
7. **Piece set is Celtic** (`/piece/celtic/`, MIT licence). Do not swap back to Staunty — its CC BY-NC-SA licence blocks commercial use (see `docs/learnings.md` v0.6).
8. **Stockfish files in `engine/` are immutable.** Do not edit or regenerate `stockfish-17.1-lite-single-*.js` or `*.wasm`. Updating them is a deliberate release decision, not a routine change.

---

## Current status

**Version:** v0.66 (2026-06-09). Latest shipped work (newest first — full log in `docs/learnings.md`):

- **v0.66 — shell.css migration (US-17):** today/practice/games/insights/coach/completed/roadmap now link `shell.css` + `nav.css`; duplicated inline chrome removed; `header.css` deleted (header single-sourced in `shell.css`). Chrome computes identically app-wide.
- **v0.65 — branded header + design system:** the `.header-bar` (knight mark + wordmark + screen chip) is the brand signature on every page; `docs/design-system.md` added as the brand reference.
- **v0.64 — Games → Review IA:** new primary **Review** tab (`review.html`); `games.html` demoted to "Sync games" (ingest only) under nav "More".
- **v0.62 — Board Vision (Spec 14):** `board-vision.html` — 3 procedural drills + 6-level hide-the-board tracker.
- **v0.61 — Spec 10:** `games.html` modularized into `js/games/`.
- **v0.60 — bug fixes:** mistakes back-fill `type:'mistake'` on load (queue filter dropped them); coach reads live endgame moves via `getLiveContext`; desktop shows practice sub-themes in the pinned nav always.
- **v0.59 — polish:** material balance display, coach widget, insights tweaks.

### Staged but not yet deployed

**v0.67 — Spec 24 richer Chess.com ingestion (capture layer):** at ingest we now capture per-game enrichment (`accuracies`, `rated`, `time_control`, termination, opponent rating) → new key `chess-coach-game-meta-v1`; and a richer rating profile from `/stats` (peak, RD/settledness, W/L/D record, tactics rating) → new key `chess-coach-rating-profile-v1`. Pure additive capture, no UI/scoring/prompt change. The *surfacing* (Insights rating block + trajectory) ships later with the retention work. `APP_VERSION` now stamps v0.67.

---

## QA

Full docs in `qa/README.md`. The human checklist is `docs/qa-checklist.md`.

```powershell
# Full suite (local)
cd qa
npm install
npx playwright install chromium webkit
npm test

# Smoke only (fastest signal — run this first)
npm run test:smoke

# File integrity (NUL bytes + JS syntax, no browser)
npm run integrity

# Against a deployed Vercel preview
$env:BASE_URL="https://<preview>.vercel.app"; npm test
```

CI triggers automatically on Vercel preview deploys via `.github/workflows/qa.yml`. The `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secret must be set once — see `qa/VERCEL-SETUP.md`.
