# KnightPath — Claude Code context

## What this is

KnightPath is a chess coaching PWA. It fetches a player's Chess.com games, analyses them with Stockfish, turns real mistakes into puzzles, and coaches the player through each position using Anthropic-powered hints — without giving the answer away. Target user: a player climbing from ~950 to 1500 Elo.

**App name:** KnightPath  
**Repo folder:** `chess-coach-testbed` (legacy name — ignore it, this is the full production app)  
**Current version:** v0.82 LIVE on prod (2026-06-11, commit `b1d1980`). The full **v0.67→v0.77** batch shipped: richer Chess.com ingestion (Spec 24), the **Openings trainer** (22 Stockfish-verified Vienna lines, every move explained), coach unification (one shared §17 card), the **retention** layer (session streak + freeze, daily goal, goal-gradient, data-grounded "coach's read", mastery milestones, SRS spaced-review queue), themed-drilling Lichess supply (Spec 17), the **mistake-intro replay**, **piece-slide animation** (Spec 19), the visual-consistency pass (eyebrow/`.panel`/nav-icons/brand-mark 843KB→13KB), and QA bug fixes. Per-version detail in `docs/learnings.md` (v0.67–v0.77); strategy in `../docs/super-app-roadmap.md` "Roadmap v4".  
**Deploy:** ship via `combined-deploy-v2` → `master` → Vercel (auto-deploys prod, `chess-coach-coral.vercel.app`). See `docs/learnings.md` for the per-version build log.  
**User identity:** the synced Chess.com username (`chess-coach-username-v1`, prompted on first load / adopted from the first ingest). `CHESS_COM_USERNAME` in `config.js` is only the legacy fallback — always read identity via `getActiveChessComUsername()` (project rule 10).

---

## Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript. No framework, no bundler, no build step.
- **Deployment:** Vercel — static site + two serverless functions in `api/`.
- **Chess engine:** Stockfish 17.1 WASM, bundled locally in `engine/`.
- **Chess logic:** chess.js 1.4.0, **vendored locally** at `js/vendor/chess-1.4.0.js` (v0.79 — was esm.sh CDN; vendoring killed the CDN single-point-of-failure and made the PWA offline-complete).
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

`/` redirects to `/today.html` via `vercel.json` (fixed v0.79 — it previously pointed at puzzle.html, stranding new users on a context-free training screen).

| Page | Purpose |
|---|---|
| `onboarding.html` | **First-run flow (v0.80)** — username gate target (focused chrome, no nav): validate username → auto-ingest 20 games + profile questions → 3 personal insights + coach welcome → 8-step tour → Today. Anonymous visits to ANY page route here (`js/sync.js enforceOnboardingGate`). |
| `today.html` | Daily session home — the user's entry point |
| `practice.html` | Practice hub — fans out to Puzzles / Endgames / Recognition / Board Vision / Calculation / Openings |
| `puzzle.html` | Mistake puzzle training (primary training screen) |
| `endgames.html` | Endgame play-out training |
| `endgame-recognition.html` | Win/draw/loss recognition training |
| `board-vision.html` | Board Vision warm-up — 3 procedural drills + a 6-level hide-the-board tracker (Spec 14, v0.62) |
| `calculation.html` | **Calculation drills** (Spec 25, v0.82) — follow a verbal forced line on a frozen board (3 levels) + count the checks/captures at speed (20s reps + 60s blitz w/ bests). Reuses the bv-* visual grammar from board-vision.css deliberately. |
| `openings.html` | **Openings trainer** (v0.61→enriched v0.77) — repertoire-recall drill with spaced repetition; each move shown with a coach "why". Vienna first (22 Stockfish-verified lines); extensible via `data/openings/`. |
| `review.html` | **Game Review** (primary tab, renamed from "Review" v0.79) — replay a game with a **key-moments walkthrough** (jumpable mistake chips + "Next key moment"), per-mistake coach, "drill this motif" |
| `games.html` | **Sync games** — Chess.com ingestion only (v0.64: review moved to review.html; demoted to nav "More") |
| `insights.html` | Progress stats, estimated rating, practice heatmap |
| `coach.html` | AI coach interface |
| `session.html` | In-session wrapper (no nav chrome, used mid-session) |
| `completed.html` | Post-puzzle summary and review |
| `roadmap.html` | In-app roadmap (user-facing) |
| `index.html` | Meta-refresh redirect to `/today.html` (18 lines; vercel.json's `/` redirect normally fires first). Not a testbed page — that description was stale (fixed in the 2026-06-10 audit). |

---

## Architecture

### Serverless API (`api/`)

| File | Endpoint | Purpose |
|---|---|---|
| `coach.js` | `POST /api/coach` | Proxies to Anthropic API. Forwards body as-is; returns Anthropic response verbatim. No logging. |
| `tag.js` | `POST /api/tag` | Sends up to 20 puzzle positions to Claude Haiku for motif/theme classification. |

### Puzzle module (`js/puzzle/`)

20 ES modules. All pages that host a board load `boot.js` as `<script type="module">`, which imports the rest.

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
| `grade.js` | Evaluates player moves against engine lines (cp loss, pass/fail). Has an **isolated `source==='lichess'` branch** (Spec 17 solution-line grading) — the mistake path is untouched. |
| `intro.js` | **Mistake-intro (v0.71)** — the "what happened in your game" replay + cp-cost + no-spoiler analysis shown before solving a mistake puzzle; `markIntroLinesReady` gates "Solve it" on engine readiness. |
| `lichess.js` | **Themed-supply loader (Spec 17)** — lazy-fetches `data/lichess-puzzles.json`, tops up a theme drill (own-game first → library), tracks solved ids. |
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
| `board-static.js` | Canonical STATIC board renderer (`renderStaticBoard`) — reused by recognition, review, Board Vision, openings. Also exports the **FLIP `animateMoveFLIP`** piece-slide (Spec 19, v0.71/76). |
| `coach-stats.js` | The **read-time stats engine** (`window.CoachStats`): rating cache + `computeCoachView`/`buildDigest`, phase scores + ACPL→ELO, the retention helpers (goal tiers, rating-band gradient, `ratingProfileView`), and the data-grounded **`coachRead`** (the "coach's read", incl. SRS due-count). |
| `coach-card.js` | **The single shared §17 coach card** (v0.70) — `renderCoachCard`/`parseCoachJson`/`sanitiseCoachText`; puzzle/coach/review all delegate here (killed the 3 drifted copies). |
| `coach-widget.js` | Reusable coach panel widget (endgames/recognition). Reads live `state.chess` moves via a `getLiveContext` hook (v0.60); fed lesson context + the shared card (v0.70). |
| `streak.js` | **Session streak + freeze** (`window.Streak`, retention) — pure daily/streak/freeze logic generalised from Board Vision. Marked on session completion (today.html + session.html). |
| `review-srs.js` | **Spaced-repetition scheduler** (`window.ReviewSRS`, v0.76) — derives a Leitner schedule from `chess-coach-attempts-v1` (no new key); drives the today "Spaced review" block + the due-count. |
| `mastery.js` | **Mastery milestones** (`window.Mastery`, v0.76) — capability markers (motif mastered, rating band, streak, endgame converted) + a seen-diff for the "new" highlight. |
| `material.js` | Renders the material balance display (captured pieces + net advantage, v0.59). |
| `session-wrap.js` | Logic for the in-session wrapper (`session.html`). |
| `sync.js` | **Cross-device persistence (v0.78/79)** — mirrors the `SYNC_KEYS` subset of localStorage to Supabase (`knightpath_state`, plain fetch/PostgREST), keyed by Chess.com username (`chess-coach-username-v1`, prompted on first load). Pull→merge→push on load (one guarded reload if remote changed local), debounced push on writes via a `Storage.prototype.setItem` hook (also surfaces QuotaExceeded). Owns the **nav user chip** ("♞ user · Change" — switching wipes local `chess-coach-*` state, by design). Offline-safe. On all shell pages + session.html. See learnings v0.78/v0.79. |
| `coach-memory.js` | **The coach's per-user memory (v0.79)** — ≤12 capped notes about the student, injected into every coach prompt (`promptBlock`); ONE writer: the session debrief (`writerBlock` + `applyUpdate`). Key `chess-coach-coach-memory-v1`, synced. Window-global (like CoachStats). |
| `today/boot.js` | today.html's page logic (the 553-line inline IIFE, extracted verbatim v0.79 — classic script, window globals). |
| `vendor/chess-1.4.0.js` | The vendored chess.js ESM bundle (exact esm.sh es2022 build). Treat as immutable; updating it is a release decision. |
| `profile.js` | **The user's training profile (v0.80)** — `KPProfile` window-global: eloGoal/goalBy/timeControl/seriousness from onboarding, synced (`chess-coach-profile-v1`). `targetElo()` replaces every hardcoded 1500; `promptLine()` rides in coach prompts; timeControl steers the rating fetch + ingest archive filter. |
| `chesscom-insights.js` | **Chess.com-derived insights (v0.80)** — `ChesscomInsights` window-global, pure: per-game performance estimate (`perfOf`, ±400 fair-pairing guard), `perfSeries`, `summarize` (record, colour split, accuracy, loss terminations, openings), `perfMeaning`. Feeds onboarding wow-insights, the Insights performance panel, Game Review rows. |
| `help.js` | **Per-type training help (v0.80)** — `KPHelp`: (?) in the branded header of the 5 training pages + auto-open first-visit card per type (`chess-coach-help-seen-v1`, local). |
| `onboarding/boot.js` | The onboarding state machine (ES module). Reuses the real ingest pipeline (`games/ingest.js` + `analysis.js` + `persistGameIncrementally`); hosts compat nodes `#progress*`/`#ingest-btn`. |
| `tagger.js` | Client-side caller for `api/tag.js` — batches puzzles and applies returned motifs. |

### Games module (`js/games/`)

`games.html` was modularized (Spec 10, v0.61) — same pattern as `js/puzzle/`. `games.html` loads `boot.js`; `review.html` imports `review.js` standalone.

| Module | Responsibility |
|---|---|
| `boot.js` | `games.html` entry — wires the ingest form, clear, backfill, narration. |
| `ingest.js` | The Chess.com → Stockfish → mistakes pipeline. Captures the SAN move list (`chess-coach-game-moves-v1`) for replay. |
| `chesscom.js` / `analysis.js` / `categorize.js` | Chess.com fetch · Stockfish wrapper · phase categorization. (`classify.js` — the per-mistake Sonnet motif classifier — was **deleted v0.79**; tagging is solely the batched Haiku path via `js/tagger.js` → `/api/tag`.) |
| `storage.js` / `state.js` / `dom.js` / `config.js` / `lib.js` | Plumbing: localStorage · shared state · DOM helpers · consts · the chess.js pin. |
| `list.js` / `narrate.js` | Mistake-list render · per-game "how you played" narration (prompt-bearing). |
| `review.js` | **Spec 11 interactive game review** (`review.html`): replay, severity badges, per-mistake grounded coach card, "drill this motif" deep-link. |

### Calculation module (`js/calculation/`)

Spec 25 (v0.82). `calculation.html` loads `boot.js`. No engine; positions come from the bundled Lichess pack + the user's own mistake FENs.

| Module | Responsibility |
|---|---|
| `generators.js` | Pure generators with chess.js INJECTED (`makeGenerators(Chess)`) so `qa/scripts/calculation-check.cjs` verifies 120 randomized reps headless. Follow-the-line (plain-words narration + tap/check questions) and count-the-forcers (checks/captures count). |
| `boot.js` | UI runner cloned from Board Vision (hub → runner → complete; same section ids + `bv-*` classes, styled by board-vision.css). Run-token guards prevent stale async drill loops. Storage `chess-coach-calculation-v1` (synced: levels/bests max-merge, history union). |

### Board Vision module (`js/board-vision/`)

Spec 14 (v0.62). `board-vision.html` loads `boot.js`. No engine/network for the drills.

| Module | Responsibility |
|---|---|
| `generators.js` | Pure, node-testable generators for Coordinate Snap / Knight Vision / Piece Walk. |
| `tracker.js` | Procedural hide-the-board sequence tracker (uses chess.js — sparse base FEN + N random legal moves). |
| `boot.js` | UI runner — hub, drill loops, the tracker show→hide→read→answer→replay flow, storage. |

### Openings module (`js/openings/`)

Spec 22 (v0.61, enriched v0.77). `openings.html` loads `boot.js`. Each opening is a **data unit** in `data/openings/` (registry + per-opening file), so new openings are added as data, not code.

| Module | Responsibility |
|---|---|
| `boot.js` | UI runner — the hub (repertoire cards + a "your openings" personal panel) and the drill: recall a line by tapping origin→destination, with a **"Why this move"** coach panel per ply (the explanations from `data/openings/<id>.json` `whys`) and the piece-slide animation. |
| `data.js` | Loads + caches the registry (`index.json`) and per-opening files. |
| `srs.js` | Pure Leitner SRS over the lines (`chess-coach-openings-v1`). |
| `personal.js` | Reads `chess-coach-game-scorecards-v1` + `-game-meta-v1` (ECO/openingName) to surface which repertoire openings the user actually plays. |

> **Verifying opening data:** `qa/scripts/verify-openings.cjs` loads the bundled Stockfish + chess.js headless and checks every White move in every line (legality + cp-loss vs engine best). Run with the static server up. The gambit `f4` reads ~40–65cp "worse" (engines underrate gambits — kept by design); anything beyond that is a real inaccuracy to fix.

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

`endgames.json` / `endgame-recognition.json` / `openings/*` are **hand-authored** — do not auto-generate. `lichess-puzzles.json` is a generated dataset (don't hand-edit).

- **`endgames.json`** — endgame lesson definitions. Each entry has `id`, `title`, `category`, `difficulty`, `fen`, `sideToMove`, `goal`, `technique`.
- **`endgame-recognition.json`** — recognition positions. Each entry has `id`, `type`, `fen`, `answer`, `explanation`.
- **`openings/index.json`** + **`openings/<id>.json`** — the openings registry + per-opening repertoire (Spec 22). Each opening: `{ id, name, eco, side, lines: [{ id, name, eco, moves:[SAN], whys:[per-move explanation], idea }] }`. **Verify edits with `qa/scripts/verify-openings.cjs` (Stockfish).** Vienna is the first (22 lines).
- **`lichess-puzzles.json`** — the Spec 17 themed-supply pack (~10.5k, generated). Lazy-loaded by `js/puzzle/lichess.js`; never hand-edited.

---

## Project rules — do not change without a logged rationale in `docs/learnings.md`

1. **No build step.** Zero-dependency frontend. No webpack, Vite, TypeScript compilation, or bundler.
2. **All constants in `config.js`.** Import from there. Never hardcode a cp threshold, timer value, storage key, or depth value in a module.
3. **One `state` object.** All runtime state lives in `state.js`. Do not introduce a second store.
4. **50/100 cp tier thresholds and 0.3 accuracy multiplier** are calibrated values. Do not change them without documented reasoning (see `docs/learnings.md` v0.53).
5. **Coach panel discipline.** The coach log must only contain messages from the AI or responses Jorge wrote. No auto-injected messages mid-solve (see `docs/learnings.md` v0.7).
6. **No-spoiler rule.** Coach system prompts must never include engine lines, PV moves, eval scores, or best-move identifiers. Position summary only (see `docs/learnings.md` v0.7).
7. **Piece set is Celtic** (`/piece/celtic/`, MIT licence). Do not swap back to Staunty — its CC BY-NC-SA licence blocks commercial use (see `docs/learnings.md` v0.6).
8. **Stockfish files in `engine/` are immutable.** Do not edit or regenerate `stockfish-17.1-lite-single-*.js` or `*.wasm`. Updating them is a deliberate release decision, not a routine change. (Same rule for `js/vendor/chess-1.4.0.js`.)
9. **Coach proactivity is bounded to session boundaries.** The ONE automatic coach call is the session debrief on session.html's summary (v0.79 amendment to rule 5). Never auto-fire the coach mid-solve, on app-open, or on navigation. Aggregate-only feedback at the boundary: motif counts may be named, a specific puzzle's answer may not (missed puzzles resurface via SRS).
10. **Identity goes through `getActiveChessComUsername()`** (`js/puzzle/config.js`). Never hardcode a username, a greeting name, or read `CHESS_COM_USERNAME` directly in a surface. The synced username (`chess-coach-username-v1`) IS the user; switching users must clear local `chess-coach-*` state first (see `js/sync.js switchUser` — prevents cross-account merges).
11. **Coach memory has ONE writer.** Only the session debrief consolidates `chess-coach-coach-memory-v1` (via `CoachMemory.applyUpdate`). Every other surface is read-only (`promptBlock`). The caps (12 notes × 140 chars) are the efficiency contract — never raise them casually.
12. **No em or en dashes in user-facing copy or coach output. HARD RULE (owner, 2026-06-10).** Use a period, comma, or colon instead. `sanitiseCoachText` strips them from model output as the last line of defence; `qa/scripts/purge-emdash.cjs` sweeps the codebase (run it if any creep back in).
13. **The version stamp shows the number only** (`APP_VERSION = 'vN.NN'`). The what/why of each version lives in `docs/learnings.md`, never in the stamp (owner, 2026-06-10).
14. **Every new `chess-coach-*` key must decide its sync story.** Add it to `SYNC_KEYS` (with a merge rule in `js/sync.js mergeKey`) or document why it stays local-only. Either way it is swept by the user-switch wipe. The key constant lives in `js/puzzle/config.js`.
15. **Strict type scale (owner, 2026-06-11).** Every `font-size` must be a step on the `--fs-*` scale in `css/tokens.css` (9, 10, 10.5, 11, 12, 12.5, 13, 13.5, 14, 15, 16, 18, 21, 24, 28, 30, 34, 36 px; 10.5 is the page eyebrow ONLY). Run `node qa/scripts/type-scale-check.cjs` before every release; it fails on any off-scale declaration. Reference table in `docs/design-system.md`.

---

## Current status

**Version:** v0.82 LIVE on prod (2026-06-11, commit `b1d1980`) — the full v0.78–v0.82 batch shipped (cross-device sync, onboarding, coach memory, owner QA batches, calculation drills, all-type Today blocks). Recent shipped work (newest first — full per-version log in `docs/learnings.md`):

- **v0.82 — mobile QA batch + Calculation drills + all-type Today blocks (staged):** the strict type scale (rule 15); `calculation.html` (Spec 25: follow-the-line + count-the-forcers, levels/blitz bests, synced); Today's session covers EVERY exercise type (alternating BV/Calculation warm-up block, SRS-due openings block + openings session mode, all 7 block types resolved by session.html and the wrapper); universal progression on Insights (calculation trend + per-type chips, fixed the never-rendering openings chip); phase scores made relative (no absolute est-ELO); clickable phase drill-downs + "what to drill this week" + per-piece v1; mobile coach dock (floating knight bubble); ECO names, typed-case usernames, no-zoom viewports, 10-game onboarding with wait tips, enriched puzzle verdict copy, review.html error surfacing.
- **v0.81 — owner QA batch (staged):** em-dash hard rule (12), number-only version stamp (13), mono font retired, user-chip redesign, session-flow fixes (skip-completed, endgame block completion), recognition W/D/L + side indicator, icons pass, piece-animation feel, Board Vision overhaul (60s blitz + bests + bands, walk levels, no-coords), spec 25 written.
- **v0.80 — onboarding + chess.com insights + help (staged):** the gated first-run flow (username → auto-ingest 20 + profile questions → personal wow-insights + coach welcome → tour); `KPProfile` tailoring (every target/prompt uses the user's own goal); the Insights "Game-by-game performance" panel + enriched Game Review rows (`js/chesscom-insights.js`); per-type (?) help with first-visit auto-open; wipe-this-device (local wipe, Supabase survives — scorecards/meta now synced so no re-ingest); QA fixtures for the gate; audit fixes (tab-bar wrap, today "undefined" icon, reload-race toast, eviction order).

- **v0.79 — audit implementation batch (staged):** per-user **coach memory** + the **session debrief** (the one proactive coach surface, rule 9); Game Review "pulls no games" fix + **key-moments walkthrough**; **difficulty drills** (easy/medium/hard by solver-move count); **mastery-over-time** on Insights; identity de-hardwired (rule 10) + nav user chip; `/` → today.html; API guard rails (model allowlist, body cap, rate limit); motif classifier consolidated on `/api/tag` (games/classify.js deleted); chess.js vendored; quota banner + game-moves cap; board ARIA labels; soft-hex → token sweep + `--muted` AA nudge; today.html inline script → `js/today/boot.js`.
- **v0.78 — cross-device persistence (staged):** streak, attempts, mistakes, session plan + the rest of the gamification keys mirror to Supabase keyed by Chess.com username (`js/sync.js`; schema `knightpath_state`; first-load username banner; offline-safe; one logged deviation — the write hook wraps `Storage.prototype.setItem`, not `js/puzzle/storage.js`, because inline page scripts + streak.js/playout.js write localStorage directly).
- **v0.77 — Openings enriched + SRS due-count:** 22 Stockfish-verified Vienna lines, every move explained (a "Why this move" coach panel); SRS due-count surfaced as the top-priority coach's read on Today.
- **v0.76 — animation everywhere + SRS spaced-review + mastery milestones:** the piece-slide now runs on review/openings too; the Today "Review" block is SRS-driven (`js/review-srs.js`); mastery milestone chips on Today (`js/mastery.js`).
- **v0.74 — coach's read:** a variable, data-grounded retention line on Today (`CoachStats.coachRead`).
- **v0.72–v0.73 — visual-consistency pass:** eyebrow/lede → `type.css` (fixed review.html's unstyled-eyebrow break), shared `.panel` in `shell.css`, button-fork consolidation, emoji "More"-group nav icons → SVG, brand-mark 843KB→13KB.
- **v0.71 — mistake-intro replay + piece-slide animation (Spec 19) + 4 QA fixes** (first-puzzle freeze, sync resumes on nav, Insights rating chart + empty state).
- **v0.67–v0.70 — Roadmap v4 batch:** richer ingestion (Spec 24: `chess-coach-game-meta-v1` + `-rating-profile-v1`), Openings trainer (Spec 22), coach unification (one shared §17 card), retention foundation (streak/freeze, daily goal, goal-gradient, Insights rating block), themed-drilling Lichess supply (Spec 17).

The strategic spine is now **daily-habit / retention** (see `../docs/super-app-roadmap.md` "Roadmap v4" + `../docs/retention-and-gamification.md`). Public launch is on the roadmap, **not now** (keep schemas/prompts portable). Next candidates: a 2nd opening, wiring openings into the daily session, and the E-moat already shipped.

### Known follow-ups
- `qa/scripts/` holds dev harnesses (`verify-openings`, `srs-mastery-check`, `coachread-check`, `lichess-grade-harness`, `sync-merge-check`, `pure-modules-check`, `today-render-check`, `calculation-check`, `type-scale-check`, `purge-emdash`) — run-on-demand, not part of the Playwright suite. Release gate: sync-merge + pure-modules + today-render + calculation + type-scale.
- Deferred from the 2026-06-10 batch (reasons in learnings v0.79): games.html → train.css button migration (visual-QA gate), board arrow-key navigation, CSP header, `--accent` small-text contrast (brand decision), **chess.com SSO/login** (owner: before public launch — replaces the username-trust model; the no-auth posture and the permissive Supabase RLS are acceptable only while the URL is unshared).

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
