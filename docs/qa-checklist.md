# KnightPath — QA checklist

Human source checklist. The Playwright suite in `qa/` is its executable subset — wherever a row says "Automated", there is a test that guards it. Wherever it says "Manual" or "Parked", it doesn't.

Current reconciliation: **v0.80**. Update this document whenever the app adds a new page, changes a behaviour, or when a parked test activates.

---

## §A — Shell and navigation

Applies to every shell page at both breakpoints (desktop ≥ 880px, mobile < 880px).

Shell pages: `today.html`, `puzzle.html`, `practice.html`, `games.html`, `completed.html`, `insights.html`, `coach.html`, `endgames.html`, `endgame-recognition.html`, `roadmap.html`

Non-shell pages (excluded from §A): `index.html` (meta-refresh redirect), `session.html` (minimal focused chrome)

| Check | Desktop | Mobile | Automated |
|---|---|---|---|
| Pinned sidebar nav is visible | ✓ | — | Yes (`a-shell-nav.spec.js`) |
| Tab bar is hidden on desktop | ✓ | — | Yes |
| Tab bar is visible at mobile width | — | ✓ | Yes |
| No hamburger button (removed v0.42 — tab-bar-only) | — | ✓ | Yes |
| No horizontal scroll / clipped chrome at phone width | — | ✓ | Yes |
| Exactly one nav link is active (matches current page) | ✓ | — | Yes |
| Version stamp renders with a real version number | ✓ | — | Yes |

---

## §B — Today page

| Check | Automated |
|---|---|
| Page renders with content (not blank) | Yes (`b-today.spec.js`) |
| No JS errors on load | Yes |
| Empty state is sensible with no ingested data | Yes |
| "Start session" button is visible | Yes (via fixme) |
| Tapping "Start session" routes into the active session (not a bounce to `practice.html`) | **Parked** (R1.2) — currently broken. Un-fixme `b-today.spec.js` when R1.2 merges. |
| Session shows correct block count and progress | Manual |

---

## §C — Puzzle training

| Check | Automated |
|---|---|
| `puzzle.html` loads without JS errors | Yes (`c-puzzle.spec.js`) |
| Board renders with pieces | Yes |
| Default puzzle is playable with no ingested data | Yes |
| Thinking gate shows on Deep mode (CCTO questions + timer) | Manual |
| Timer counts down; Submit locked until answered + time elapsed | Manual |
| Correct move: green feedback, cp bar updates | Manual |
| Wrong move: clear immediate wrong-move state | **Parked** (R3) |
| Punishment plies play out after wrong move | Manual |
| Coach hint button triggers a message in the coach log | Manual |
| Coach log never contains engine lines, PV moves, or eval scores (no-spoiler rule) | Manual |
| CP bar shows correct cumulative loss across all moves | Manual |
| Material balance display renders, icons legible, net advantage correct | **Parked** (R2 — reverted in recovery) |
| Comparison panel sits in its grid slot, does not push the board down | **Parked** (R3) |
| Board arrows render reliably, including first/best move | **Parked** (R3) |
| Pieces do not blink on move / navigate / select | **Parked** (R3) |
| Restarting a puzzle clears the wrong-move box | **Parked** (R3) |
| Puzzle solved: resolved card shows, star rating correct | Manual |
| Filter tabs update counts correctly | Manual |
| Theme filter pills show motif counts | Manual |
| "Drill this theme" assembles correct pool, banner shows progress | Manual |

---

## §D — Endgames

| Check | Automated |
|---|---|
| `endgames.html` loads without errors | Yes (`d-endgames.spec.js`) |
| All lesson groups are reachable | Yes |
| No surfaced error state on load | Yes |
| A lesson plays out and Stockfish responds | Manual |
| Play-out does not end after 1 move in a winning position | Manual (regression: PLAYOUT_DECISIVE_CP was 500, now 9999) |
| `endgame-recognition.html` loads without errors | Yes (`e-smoke.spec.js`) |
| Win/draw/loss judgement records a result | Manual |

---

## §E — Smoke (every page)

| Check | Automated |
|---|---|
| Every page loads with zero console errors and zero page errors | Yes (`e-smoke.spec.js`) — covers all pages in `ALL_PAGES` |
| No page renders blank | Yes |

This is the highest-value test. It would have caught every regression in the firefight: the `today.html` / `coach.html` smart-quote SyntaxErrors, and the `dom.js` null `addEventListener` throw that killed puzzle + endgames. Run this first when investigating a reported issue.

Tolerated console noise (defined in `qa/tests/pages.js` → `IGNORED_CONSOLE`):
- `401 (Unauthorized)` — `/api/coach` password gate when no key is set in the local test environment
- `favicon` errors

Keep the tolerated list short and intentional. Do not add suppressions for real errors.

---

## §F — File integrity

| Check | Automated |
|---|---|
| No NUL bytes in any JS or HTML file | Yes (`npm run integrity`) |
| All JS files pass `node --check` (catches syntax errors including smart quotes) | Yes |
| Deployed build pages match source (checked implicitly by running the suite against the Vercel preview) | Partial |

---

## §G — Sync, identity & coach (v0.78/79)

| Check | Automated |
|---|---|
| First load with no username shows the sync banner; "Not now" defers for the tab session | Manual (banner is non-blocking; smoke guards console-clean) |
| Username entered on device B restores device A's streak/attempts/session after one reload | Manual (verified 2026-06-10 against live Supabase) |
| Sync merge rules (streak max, attempts union, session today-beats-stale, …) | Yes — `qa/scripts/sync-merge-check.cjs` (12 checks, run-on-demand with the static server up) |
| Supabase unreachable → app runs local-only, no crash, one console warn | Manual (simulated 2026-06-10) |
| Nav user chip shows the synced username; "Change" wipes local state and re-prompts | Manual |
| Session summary shows the coach debrief card (or the static read if the API is down); never re-bills the same day | Manual — needs ANTHROPIC_API_KEY |
| Coach memory: debrief writes ≤12 notes; other surfaces include them read-only | Manual — inspect `chess-coach-coach-memory-v1` |
| Game Review lists games from ALL per-game stores; no-move-list games show "Re-sync to replay" | Manual |
| Key-moment chips jump the board and auto-ask the coach (cached per mistake) | Manual |
| Difficulty pills filter the themed drill by solver-move count; non-'any' tier is library-only | Manual |
| Mastery-over-time panel renders weekly bars when attemptLog data exists | Manual |
| Board squares expose aria-labels ("e4, white knight") | Manual (inspect DOM) |

---

## §H — Onboarding & help (v0.80)

| Check | Automated |
|---|---|
| Anonymous visit to any shell page redirects to /onboarding.html | Manual (the page suite seeds a username via `tests/fixtures.js` — the gate itself was verified live 2026-06-10) |
| Unknown Chess.com username shows a friendly error, never proceeds | Manual (verified live) |
| Valid username + existing cloud data → "Welcome back" fast path, NO re-ingest | Manual |
| Auto-ingest of 20 games shows animation + real progress; questions answerable during; Continue appears only when both finish | Manual (verified live with a real account) |
| Profile saved (goal/deadline/time control/seriousness) → synced; daily-goal seeded; targets app-wide use the goal | Yes — `qa/scripts/today-render-check.cjs` (goal-hint target) + manual |
| 3 insights render from real data; coach welcome card falls back gracefully without the API | Manual (verified live) |
| Tour: 8 steps, skippable at any point, ends on today.html | Manual (verified live) |
| "Wipe this device" (games/review) clears local only; signing back in restores without re-ingest | Manual |
| Help (?) on all 5 training pages; auto-opens once per type; Got it / backdrop / Esc dismiss | Manual (verified live on puzzle.html) |
| today.html renders no literal "undefined"; goal hint shows the profile target | Yes — `qa/scripts/today-render-check.cjs` |
| Tab-bar labels never wrap (incl. "Game Review") at 375px | Manual (computed heights verified 2026-06-10) |

---

## Manual-only checks (no automation path yet)

- **Real iPhone tap-through:** WebKit Playwright is a strong proxy, but does not cover safe-area insets, momentum scroll, or Safari-specific CSS quirks. A short manual pass on a physical iPhone before each release catches the last ~10%.
- **Board visual consistency across screens:** Visual regression (`toHaveScreenshot()`) is the right tool but hasn't been set up yet. Snapshots would churn until Design's canonical board spec lands and R3 consolidates to one renderer. Add this after R3 ships.
- **No-spoiler validation:** Asserting that `/api/coach` replies contain no square names, SAN notation, or eval scores is automatable but semantically fuzzy and costs API credits. Keep manual for now.
- **Coach hint quality:** The coach's socratic tone and hint appropriateness are judgement calls. Review a sample of coach responses after any change to `api/coach.js` system prompt.

---

## Maintaining this checklist

- When a parked test activates (R1.2, R2, R3 merge), move the row from "Parked" to "Automated" and update the reconciliation version.
- When the app adds a new page, add it to `qa/tests/pages.js` → `SHELL_PAGES` and `ALL_PAGES`, and add any page-specific rows to the relevant section here.
- When a new behaviour is added, add a row here first, then decide whether it's automatable.
