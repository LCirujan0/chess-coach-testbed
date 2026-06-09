# KnightPath — QA checklist

Human source checklist. The Playwright suite in `qa/` is its executable subset — wherever a row says "Automated", there is a test that guards it. Wherever it says "Manual" or "Parked", it doesn't.

Current reconciliation: **v0.58**. Update this document whenever the app adds a new page, changes a behaviour, or when a parked test activates.

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
