# KnightPath — decisions log

Key architectural and product decisions, newest first. The point of this file is to record the *why* so that future sessions don't undo choices that were made deliberately. When a decision is reverted or superseded, add a note here rather than deleting the old entry.

---

## v0.60 — Mistakes-not-loading regression, coach sees endgame moves, nav sub-themes always shown (2026-06-08)

Three fixes, the first a regression introduced by the v0.59 combined bundle:

- **Mistakes not loading (regression).** The unified puzzle schema (phase 1a) added a `type` discriminator, and `puzzle.html` pins its queue to `type: 'mistake'` (`queue.js` ~line 53: `pool.filter((p) => (p.type || p.puzzleType) === state.typeFilter)`). But `games.html` never stamped `type` on the mistake records it ingests, so **every** stored mistake failed the filter and the Puzzles page showed nothing despite ingested games. Fixed in two places: (1) `games.html` now stamps `type: 'mistake'` at ingest source; (2) `storage.js` `loadPuzzlesFromStorage()` stamps `type: 'mistake'` on any type-less record at load, so **existing** localStorage data surfaces without a re-ingest. Verified in-browser: a seeded old-schema mistake (no `type`) renders on the board. **Rule:** any new pinned-`type` page must ensure its source writer stamps the matching `type`, and the loader must back-fill legacy records.

- **Coach can now see the moves played in the endgame.** `coach-widget.js` built its system prompt once at mount from a static `context` string — it never saw the live board. Added an optional `getLiveContext` callback read at send time; `endgames.html` and `endgame-recognition.html` pass one that reports `state.chess` FEN + `history()` + side-to-move. **No-spoiler rule (v0.7) preserved:** only the student's played moves + the position are sent — never engine evals or the best-move id; the injected text explicitly instructs the coach not to reveal them. Verified by capturing the outgoing `/api/coach` request: its system prompt contained the FEN and the played move (`Qe7`).

- **Practice sub-themes always visible on the desktop sidebar.** Reverses the §30.5 behaviour in `css/nav.css` where `.nav-subgroup` was hidden unless the Practice parent link was `.active`. After the v0.59 nav-active fix (each page marks only its own link active), that rule also hid the sub-group on the child pages. Per user request, Puzzles/Endgames/Recognition are now always shown on the desktop sidebar (nav.css is desktop-scoped; mobile uses the tab-bar). **Do not re-add the collapse-unless-Practice-active rule.**

---

## v0.59 — Polish bundle: material rewrite, coach Elo, recognition stats, branded headers (2026-06-08)

Applied the parked `polish.patch` as a reviewed set of changes:

- **`js/material.js` rewritten to show captured pieces + net advantage (R2).** The indicator now derives captured pieces from the start-of-game piece counts and renders them as icons with a net-advantage score, matching the mistakes screen (`board.js`). `mountMaterial` now takes three args — `(boardEl, topEl, botEl)` — so callers pass both the top and bottom material rows. The R2 `test.fixme` in `qa/tests/c-puzzle.spec.js` was un-fixme'd to activate the guard.
- **Coach widget now injects the user's Elo** (`js/coach-widget.js`). Reads `chess-coach-user-rating-v1` from localStorage and appends a one-line rating note to the system prompt so hints are pitched to the student's level. No engine lines or scores — stays within the no-spoiler rule.
- **Recognition stats added to Insights** (`insights.html`). New panel reads `chess-coach-recognition-v1` and shows percent-correct on winning/drawn/losing judgement.
- **Branded headers applied to puzzle / endgames / recognition pages** (knight mark + KnightPath wordmark + screen chip; styling in `css/shell.css`). `endgames.html` also moved the lesson card into the right rail as a feedback card.

**Deliberately NOT applied:** the hamburger button + drawer-toggle script block that `polish.patch` added to `puzzle.html`. That contradicts the v0.42 decision to go tab-bar-only on mobile (no hamburger), and `qa/tests/a-shell-nav.spec.js` asserts `#hamburger-btn` has count 0. The branded header was applied to `puzzle.html` without the hamburger.

**Also fixed (pre-existing bug, surfaced by QA before deploy):** the nav drawer's hardcoded active state was inconsistent across pages — `a-shell-nav.spec.js` requires exactly one `.nav-drawer-link.active` per page. Four pages (puzzle, practice, endgames, endgame-recognition) marked *two* links active (the Practice parent **and** a child); two pages (roadmap, completed) marked *zero* (their links sit in the "More" group as `nav-more-link coming`, never `active`). This failed identically on `master`, so it was already live on prod — not a regression from this release. Convention going forward: **each page marks exactly its own link active** (child pages highlight the child, not the parent). Fixed all six.

**QA harness note (Windows):** the Playwright config's bundled local server (`npx serve .. -s`) crashes with `EMFILE: too many open files` on this machine, blanking every page so the whole suite reads red. Workaround that gives a real signal: serve the app with `python -m http.server 4173` and run the suite with `BASE_URL=http://127.0.0.1:4173` (which makes the config skip its own webServer). `npm run integrity` from `qa/` also only scans `qa/` itself — run `node scripts/integrity-check.mjs ..` to cover the app source.

---

## v0.7 — Global error handler placement (2026-05-28)

**Decision:** `boot.js` registers `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` as the *first* executable code in the file, before any imports or initialisations.

**Why:** Before this change, an unhandled JS error in a downstream module (including import/parse failures) would silently brick the page with no visible feedback. The coach panel would stay blank and the user would have no idea what went wrong. Placing the handlers first means *any* error, including one thrown during initial module evaluation, is caught and surfaced in the coach log.

**Detail:** Module scripts are deferred by the browser by default, so the DOM is already fully parsed by the time `boot.js` runs — the `getElementById('coach-log')` lookup in the handler is always safe.

**Do not move these handlers lower** in `boot.js`. The value comes from being unconditionally first.

---

## v0.7 — CCTO auto-feedback removed from the gate (2026-05-28)

**Decision:** The auto-fired coach message that ran immediately after the thinking gate was unlocked has been removed and must not be restored as-is.

**Why two separate reasons, both hard requirements:**

1. **Coach panel discipline (from v0.6 validation):** Jorge established that the coach log must only contain messages from the AI coach responding to an explicit user action, or responses Jorge himself typed. An auto-generated message that fires the moment the gate opens violates this — the user didn't ask for it, and it feels like the app is pushing commentary at them mid-solve.

2. **No-spoiler rule:** The removed implementation injected the full engine top-5 lines (UCI PV strings + centipawn scores) into the coach's system prompt "to validate against engine truth". This is exactly the class of spoiler the no-spoiler rule is designed to prevent. A coach prompt that contains `e4 d4 Nf3 ... (+320cp)` effectively tells the coach the answer, which the coach then leaks in its phrasing.

**If CCTO feedback is ever re-introduced**, it must be:
- **Opt-in:** triggered by an explicit button press, not automatic on gate unlock
- **Socratic:** the prompt must not know the engine's answer
- **Position-only:** system prompt grounded on position summary (material, pawn structure, king safety) — never engine lines, never PV moves, never eval scores

---

## v0.6 — Piece set: Staunty → Celtic (2026-05-31)

**Decision:** Switched the piece set from Staunty to Celtic by Maurizio Monge (MIT licence). The 12 Celtic SVGs live at `/piece/celtic/` alongside the upstream `LICENSE` file.

**Why:** Staunty is CC BY-NC-SA. The NonCommercial clause blocks commercial use of the app. Celtic is MIT — no restrictions. This was a clean swap; piece filenames follow the same convention (`{w|b}{K|Q|R|B|N|P}.svg`) so no rendering code changed.

**Do not swap back to Staunty** without resolving the licence issue.

---

## v0.53 — Grading ceiling: MAX_CP_LOSS_PER_MOVE 200 → 100 (2026-05-xx)

**Decision:** Lowered `MAX_CP_LOSS_PER_MOVE` from 200 to 100 centipawns.

**Why:** The three-tier severity system uses thresholds: good < 50cp, warning < 100cp, mistake ≥ 100cp. With the ceiling at 200, a move that `grade.js` classified as a Mistake (100–199cp) could still pass the puzzle — the 100-199cp band was entirely inside the "success" window. This produced the user-visible bug: "it said Mistake but I still passed."

Tying the ceiling to 100 means a move graded "Mistake" can never be "solved". The relationship is now logically consistent: the passing ceiling equals the mistake floor.

**Eval clamping note:** `DECISIVE_CP / mate → ±10000` in `normalizeEval` does not compress a real ~250cp loss below the ceiling. Both the player's move and the engine's best move carry honest cp scores at the same decision point, so `cpLoss = bestCp - userCp` is faithful. The only bug was the ceiling value.

**Do not raise this back to 200.** The 50/100 tier thresholds and 0.3 accuracy multiplier are project rules — log a rationale here before changing them.

---

## v0.53 — PLAYOUT_DECISIVE_CP: 500 → 9999 (2026-05-xx)

**Decision:** Raised `PLAYOUT_DECISIVE_CP` from 500 to 9999.

**Why:** At 500, the endgame play-out was ending after the very first move in any winning endgame position. A "+520cp" evaluation after move 1 was triggering an early-pass and returning the player to the summary screen immediately. This made all K+P vs K endgames feel broken — one move, done.

The intent of `PLAYOUT_DECISIVE_CP` is to short-circuit only forced mate sequences (which Stockfish represents internally as ±10000cp). At 9999 the early-pass fires only on a forced mate, not on a merely winning position.

---

## v0.6 — Coach password gate removed (2026-05-27)

**Decision:** Removed the `x-coach-password` header check and `COACH_PASSWORD` environment variable from `api/coach.js`.

**Why:** The password gate was causing friction: first-run users hit a password prompt with no context, and the same user on a different device would get an error state. The gate solved a cost-protection problem (preventing the API key from being abused) but was the wrong tool for a personal-use, unshared URL.

**Current protection posture:**
1. URL obscurity — the Vercel URL is not publicly shared
2. Anthropic monthly spend cap — set this in `console.anthropic.com`

**Revert condition:** If the app URL is ever shared publicly or linked anywhere, restore a password gate before doing so. The removed code is in git history.

---

## v0.42 — Hamburger menu removed from mobile nav

**Decision:** The mobile hamburger button (`#hamburger-btn`) was removed. Mobile navigation is tab-bar only.

**Why:** The hamburger opened a drawer that duplicated the tab bar. Two navigation systems on the same screen created confusion. The tab bar is sufficient for the current page count; a drawer can be reintroduced later if the page count grows.

**QA impact:** The `a-shell-nav.spec.js` test asserts `$('#hamburger-btn').count === 0` — this is intentional, not a missing element. Do not add `#hamburger-btn` back without updating the test.

---

## Architecture decision — no bundler

**Decision (from project start):** The frontend uses no build tool, bundler, or transpilation step. Files are served as-is by Vercel.

**Why:** The app is a single-developer project with a Vercel static deploy. A build step adds local tooling requirements, CI complexity, and a failure surface — none of which are justified at this scale. If the project grows to require code splitting or TypeScript, this decision should be revisited explicitly.

**Constraint this creates:** All JS must be valid browser-native ES module syntax. No JSX, no TypeScript, no CommonJS `require()`. External libraries must be loaded from CDN (`esm.sh`) or bundled as plain JS files.
