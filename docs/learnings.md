# KnightPath — decisions log

Key architectural and product decisions, newest first. The point of this file is to record the *why* so that future sessions don't undo choices that were made deliberately. When a decision is reverted or superseded, add a note here rather than deleting the old entry.

---

## v0.73 — Shared `.panel` card + button-fork consolidation (STAGED) (2026-06-09)

The two deferred visual-consistency items from v0.72, done on the verifiable subset.

- **Shared `.panel` card.** Six+ pages each defined their own card (`.panel` on games/insights/review, plus `.session`/`.mode-card`/`.loop`/`.op-panel`/`.summary-bar` elsewhere) with **3 radii + 4 shadow recipes + 4 paddings**. **Key constraint:** `train.css` (the "components" sheet) is only linked on 6 pages, so the canonical `.panel` had to go in **`shell.css`** (universally linked on all chrome pages). Defined it there (`var(--r-card)` / 18px / `1px var(--line)` / `0 10px 24px -18px rgba(20,30,55,.22)` / `var(--surface)`), then reduced games/insights/review's inline `.panel` to **margin-only** so they inherit it. **Verified by computed-style parity** — all three `.panel`s now compute identically (16px / 18px / same shadow / same border / white).
- **Button fork.** `train.css` had two near-identical accent-fill rules — `.btn.btn-primary` (legacy) and `.btn.primary` (canonical per design-system.md) — so the two class names could drift. Merged them into one rule with both selectors (`.btn.primary, .btn.btn-primary {…}`), so puzzle.html (`.btn-primary`) and openings/review (`.btn primary`) render identically with zero markup changes. Also puzzle.html's `.btn-secondary` (which had no rule → silently fell back to base `.btn`) → `.btn.ghost`.
- **Deferred (visual-QA gate, in `design-system.md` backlog):** migrating the *bespoke* cards (`.session`/`.mode-card`/`.loop`/`.op-panel`/`.summary-bar`) onto `.panel` (needs HTML re-classing + padding checks), and `games.html`'s self-rolled `.btn` system (it doesn't link `train.css`; migrating changes every button — needs an eyeball on a preview).
- **Method note:** can't screenshot headlessly here (preview screenshots time out), so every CSS-consolidation step was verified with **`getComputedStyle` parity via the bundled Chromium** + the shell/smoke suite — which catches property mismatches and console errors, though not subjective layout shift (that's Jorge's preview QA).

---

## v0.72 — Visual-consistency pass + brand-mark 843 KB→13 KB (STAGED) (2026-06-09)

The visual half of the codebase audit (the consistency report). Targeted the brand-recognition wins; deferred the risky/tedious ones (see `design-system.md` backlog).

- **`.eyebrow` + `.lede` → `type.css` (single source).** `type.css` is linked on every page, so promoting these (a) **fixes review.html's unstyled eyebrow** — a live brand break: it used `.eyebrow`/`.lede` in markup but no sheet defined them, so the accent-green uppercase intro rendered as plain black text — and (b) unifies the two drifting values (10.5px on today/practice/openings, 11px on insights/games/roadmap/puzzle.css). Canonical = **accent / 10.5px / 700 / .12em / margin-bottom 5px** (700 not 800 — matches every existing page; the 11px outliers were edited *in place* to keep their margins). **Verified by computed-style parity**: review/today/insights eyebrows are now byte-identical (`rgb(47,158,118)` 10.5px 700 1.26px).
- **"More"-group nav icons** (Sync games / Roadmap / Completed) were OS emoji (`⟳ ▤ ✓`) — mismatched weight/baseline vs the SVG nav set and no `currentColor` active-state. Replaced app-wide with line-icon SVGs (24×24, stroke-width 1.9, no inline stroke/fill so the `.nav-drawer-link svg.nav-icon` CSS drives colour + the active-white flip).
- **Brand-mark** — the header + nav-drawer mark was `knight-mark.png` (**843 KB**, a 1254² PNG) rendered at 24/30px on *every* page. **No image tooling on this box** (`convert` is the Windows disk utility, not ImageMagick; no `sharp`), so I downscaled the **exact** mark to 128² via the bundled Playwright/Chromium canvas → `knight-mark-sm.png` (**12.9 KB**, visually identical, brand preserved — I did NOT swap to the rounded-square app icon, which is a different composition). Swapped all 26 refs; plus `/brand-icons/*` is now immutable-cached.
- **Semantic soft/line tokens** added to `tokens.css` (`--bad-soft/-line/-ink`, `--warn-soft/-line`, `--pos-soft`, `--accent-line`, `--app-bg-start/-end`) — used by the new intro card; the ~17 existing hardcoded hexes still need migrating (deferred).
- **Misc:** `insights.html` stray comment moved inside `<style>`; `openings.css` off-scale `6px` radius → token; the `none-tactical` "Drill this theme" CTA disabled (no library supply → it never filled to target).
- **Deferred (in `design-system.md` backlog #2/#3/#4):** the shared `.panel` card migration (train.css isn't universal + per-card paddings differ = layout-shift risk needing visual QA), the button fork (`.btn.primary` vs `.btn.btn-primary` + games.html's rogue `.btn-secondary`/`.btn-danger`), and the full hardcoded-hex→token migration.

---

## v0.71 — Mistake-intro replay + piece-slide animation + audit fixes (STAGED) (2026-06-09)

Two requested features plus the first wave of a codebase audit (bugs / perf / visual consistency — three read-only sub-agent reports).

**Mistake intro ("what happened in your game"):** a new pre-solve phase for own-game mistake puzzles (`js/puzzle/intro.js`, new phase `'intro'`). It replays the move sequence the player actually played (animated), names the move + severity + cp cost, then hands the *pre-mistake* position over to solve. **No-spoiler:** shows only what the player DID (their move + the real continuation + cost) — never the engine's better move/lines/motif; the answer stays earned via the existing gate/solve flow. Integrated in `resetPuzzleStateAndRender` (`result.js`): a fresh own-game mistake with an `actualContinuation` enters the intro; retries / Lichess / review skip it. The engine analyses `puzzle.fen` by string (not live `state.chess`) so the intro replay can mutate the board without corrupting the solve analysis; "Solve it" is gated until lines are ready.

**Piece-slide animation (Spec 19):** FLIP `animateMoveFLIP` in `js/board-static.js` (shared, exported, `prefers-reduced-motion`-aware). Wired into the live board via a transient `state.animateMove` hint set in `grade.js` at the user-move / engine-reply / Lichess-move points and consumed in `board.js`'s rebuild path. Computes from the NEW DOM only (grid is fixed, only pieces move) so it needs no prior-position snapshot. Only the live position animates — `◀▶` nav, board flips, and new-puzzle loads render instantly (guarded on `viewIndex===null && !revealOverlay`, hint cleared each render).

**Audit fixes applied (from the 3 reports):**
- **P1 bug — streak never incremented from `session.html`:** it wrote `chess-coach-session-complete-v1` and showed "Streak secured" but never called `Streak.markSessionDone` (only `today.html` did, on return). Added `<script src="/js/streak.js">` + the idempotent mark in `renderSummary()`.
- **P1 bug — Insights rating record/tactics blank:** the writer (`storage.js saveRatingProfile`) emitted `record:{win,loss,draw}` + `tactics:{rating}` but the reader (`coach-stats.js ratingProfileView`) reads `rec.w/l/d` + `tactics.current`. Aligned the writer to the reader.
- **Perf — static JSON re-downloaded every load:** `endgames.json` + `endgame-recognition.json` (511 KB) were fetched `cache:'no-store'`, defeating the `/data/*` CDN header. Switched to `cache:'force-cache'`.
- **Perf — immutable caching** for `/piece/*` + `/brand-icons/*` (stable filenames) in `vercel.json` (zero-risk; removes ~12 piece-SVG revalidations per board page).

**Deferred with reason (presented to Jorge, not applied this pass):** the 843 KB `knight-mark.png` rendered at 24px (needs a proper small asset + a brand-visual check, which can't be done headlessly here); `/js`+`/css` immutable caching (stale-code-vs-fresh-HTML risk without hashed filenames — needs a hashing strategy or an accepted staleness window); the eager-engine lazy-init (Spec 15 Fix 2 — behaviour-sensitive, needs its own no-spoiler-red-teamed QA); and the larger visual-consistency refactor (shared `.panel`, the `.eyebrow`/`h1` type scale incl. review.html's unstyled eyebrow, the `.btn.primary` vs `.btn.btn-primary` fork, semantic soft/line tokens, the emoji "More"-group nav icons). Full reports captured for the next pass.

---

## v0.70 — Roadmap v4 batch: openings · coach unification · retention · themed supply (STAGED) (2026-06-09)

A large single-session batch implementing the Roadmap v4 workstreams (`../../docs/super-app-roadmap.md`). Built in parallel by focused sub-agents with **strict, non-overlapping file ownership** (the only safe way to parallelise on a consistency-strict codebase) + an orchestrator integration pass (nav, QA registry) and a final verify. **Staged, uncommitted, QA pending.** Integrity clean (73 files), all JS parses, node-level logic tests pass.

- **A — Openings trainer** (`openings.html`, `js/openings/*`, `data/openings/{index,vienna}.json`, `css/openings.css`): extensible "each opening is a data unit" repertoire trainer, Vienna first (6 verified-legal lines). Drill = tap origin→destination on the canonical static board, validated via chess.js. SRS (Leitner) in `chess-coach-openings-v1`; a "your openings" personal panel reads the dead ECO/openingName data from scorecards/game-meta. **Lesson learned:** book SAN like `Nge2` can be over-disambiguated vs chess.js's `Ne2` (pin) — grade by resolved from/to squares, not SAN strings.
- **B — Coach unification** (`js/coach-card.js` new): the §17 card was reimplemented 3× and had drifted; now one shared module that all surfaces delegate to. Each coach surface fed the context it was missing (endgames goal/technique, recognition answer *after* answering only, general-chat the digest, per-game-review the FENs). `coach-widget.js` gained the missing sanitiser + style rules. **No-spoiler preserved**: recognition answer never reaches the prompt pre-answer; puzzle live-coach path untouched. The `.rv-*` CSS is injected once via `ensureCoachCardStyles()` so the card is self-sufficient on pages that don't link puzzle.css.
- **C — Richer ingestion:** capture layer (v0.67) + surface on Insights (with E).
- **D — Themed supply** (Spec 17; `data/lichess-puzzles.json` 10.5k + `js/puzzle/lichess.js`): own-game-first → Lichess top-up in `startThemeDrill`. **Critical isolation:** all Lichess behaviour is an additive branch keyed on `source==='lichess'`; the mistake grade path is byte-for-byte unchanged (git diff = 84 pure insertions, 0 deletions in the mistake branch). **Lichess move convention:** `fen` is before the opponent's setup move (`moves[0]`); the adapter bakes `moves[0]` into the stored FEN so the board path matches an own-game puzzle and `solutionLine[0]` is the key move. v1 grades only the first solver move.
- **E — Retention foundation** (`js/streak.js`): session streak + freeze (generalised from the Board Vision streak), goal-gradient session progress, user-set daily goal (Casual/Regular/Serious), macro rating-band bar; Insights rating profile (peak/RD-settledness/record/tactics) + trajectory. Honesty rules from `../../docs/retention-and-gamification.md` enforced (no streak-terror, no vanity metrics, supportive freeze framing).
- **Orchestration note:** the 3 big builds (A, B, E) + later D ran as sub-agents on disjoint file sets; nav (the Openings child on 12 pages) and `qa/tests/pages.js` were integrated by the orchestrator AFTER, since nav touches every page. Bulk nav insert via an idempotent node splice (same pattern as the v0.66 shell migration).

---

## v0.67 — Richer Chess.com ingestion: capture layer (Spec 24, staged) (2026-06-09)

Roadmap v4 re-pointed the spine to **daily-habit / retention** (see `../../docs/super-app-roadmap.md` "Roadmap v4" + `../../docs/retention-and-gamification.md`). First build is workstream **C** — capture more of what Chess.com already hands us. The 2026-06-09 ingestion audit found we fetch-but-ignore a lot.

- **Two new keys, both additive (swept by the `chess-coach-*` clear):**
  - `chess-coach-game-meta-v1` — per-game `{rating, oppRating, endTime, result, resultForUser, eco, openingName, rated, timeControl, userAccuracy, oppAccuracy, termination, oppTermination}`. Captured in `js/games/ingest.js` (~0 cost — already on the game object), persisted in `boot.js` with the same idempotent merge as scorecards/moves.
  - `chess-coach-rating-profile-v1` — richer `/stats` profile `{rapid:{current,rd,best,record}, blitz, tactics, fetchedAt}`, written by `js/puzzle/storage.js refreshRatingFromChessCom()` alongside the back-compat `chess-coach-user-rating-v1`.
- **Why these fields:** `rated` filters unrated games out of the rating trajectory; `rd` (rating deviation) is the *settledness* signal so Insights can hedge honestly ("+40 but still settling"); `best`/`record` give the macro goal-gradient; `accuracies` (present only when a chess.com Game Review ran, else null) is a cross-check on our own ACPL; `tactics` is an ability signal decoupled from game-result variance.
- **Deliberately scoped to capture only** — no UI, no scoring (`coach-stats.js` untouched), no prompt change. So it's QA-safe to ship without device QA. The *surfacing* (Insights rating block + the "are you actually improving?" trajectory chart, retention #6) is built with the retention foundation and goes through the normal device-QA gate.
- **Verification:** `node --check` on the 3 changed JS files + integrity-check clean (65 files). Browser end-to-end ingest (chess.js/Stockfish are browser-only) is Jorge's QA step. Spec: `../../engineering/specs/24-richer-ingestion.md`.

---

## v0.66 — Shell migration (US-17): 7 pages onto the shared shell.css chrome (2026-06-09)

Finished the consistency work started in v0.65. The 7 pages that reinvented the app chrome inline (today, practice, games, insights, coach, completed, roadmap) now **link `css/shell.css` + `css/nav.css` and the duplicated inline chrome was deleted** — header bar, `.nav-drawer`, `.nav-brand*`, `.nav-drawer-link*`, `.tab-bar*`, `.version-stamp`, `.nav-backdrop`, `html/body`, `.container`, and the desktop `@media` chrome (body padding-left, container width, nav-drawer pin, tab-bar hide). Page-specific rules (cards, charts, buttons, and any page-specific `@media` like `.phases`/`.ratestrip`/`h1` desktop size) were preserved.

- **Why it matters:** the `.container` width had drifted to 560/640/720/780/820/920 across pages; now every page computes the canonical **560 (mobile) / 1100 (desktop)** with the **224px pinned nav** and **mobile-only tab-bar** — identical to the board screens.
- **How (low-risk method):** swap the `header.css` link → `shell.css`, then delete the chrome rule-ranges from each inline `<style>` via a Node `splice` (descending line order so indices stay valid; the `@media` blocks were *replaced* with just their surviving page rule rather than deleted). **Verified by computed-style parity** — each migrated page's body padding / container max-width / nav width+position / tab-bar display / header position were compared to the canonical `endgames.html` at desktop (1280) AND mobile (375) and must match. Full QA 64 passed (one `a-shell-nav` completed.html failure was a teardown flake — confirmed by re-run).
- **`header.css` deleted** — it was a v0.65 transitional shim; the branded header is now single-sourced in `shell.css` for all pages.
- **Verification note:** the local preview browser **caches aggressively** — append `?v=Date.now()` when re-checking a just-edited page (an early today.html check showed the stale 780px container until cache-busted).

---

## v0.65 — UI consistency: branded header app-wide + design-system reference (2026-06-08)

Jorge asked for a full UI consistency / brand-identity pass. Audit found the root cause: 7 pages (today, practice, games, insights, coach, completed, roadmap) never linked `shell.css` and reinvented the header/nav/body inline, using the OLD `.page-title` header, while the 5 board screens used the BRANDED `KnightPath + screen-chip` header.

- **Branded header is now app-wide** (the brand signature). New shared `css/header.css` carries the branded `.header-bar` + `.brand-mark`/`.brand-word`/`.screen-chip`. Linked on the 7 old pages; their markup swapped to the branded form; roadmap (which had no header) gained one. **Technique:** header.css uses `body .header-bar` (specificity 0,1,1) + explicit resets (`position:static; backdrop-filter:none`) so it overrides each page's inline `.header-bar` **without editing any page's `<style>` block** — minimal-risk, header-only change. Verified by computed styles (gradient card, accent wordmark, static position) + full QA.
- **`docs/design-system.md`** written — the brand/UI reference (header, tokens, type, buttons, layout, nav, icons, link order) + a prioritised **consistency backlog**: the big one is that those 7 pages still inline their own nav-drawer/tab-bar/body (US-17) — migrating them to link `shell.css` is higher-risk (cascade can shift desktop layout) so it's deferred to per-page passes with device QA.
- `qa/tests/b-today.spec.js` updated (it asserted the old `.page-title`; now checks the branded `.screen-chip`). Full QA 64 passed.

---

## v0.64 — Games → Review: review-led IA, ingest demoted to "Sync games" under More (2026-06-08)

First-principles IA decision (Jorge): the Games surface did two jobs — *ingest* (periodic plumbing) and *review/analysis* (the repeated, valuable activity). Review is now a first-class destination; ingestion is a sync utility.

- **New `/review.html`** is the primary **"Review"** tab — leads with the list of your games; tapping one opens the replay/coach/drill surface (Spec 11's `js/games/review.js`, imported standalone). The replay now uses the **canonical training-screen shell** (`css/screen.css` `.layout-grid` — board left, badge + coach rail right), consistent with puzzle/endgames.
- **`/games.html` slimmed to "Sync games"** (ingest form + saved-puzzle stats only; the review markup moved to review.html). Demoted into the nav **More** group (`⟳ Sync games`). Retitled; added a "Review your games →" CTA.
- **Nav renamed across all 12 shell pages:** the top-level "Games" link/tab → "Review" → `/review.html` (new review/magnifier icon); "Sync games" added to the More group → `/games.html`. Active states: Review active on review.html; the Sync-games More link active on games.html (keeps `a-shell-nav`'s single-active-link assertion green). `qa/tests/pages.js` adds `/review.html` and relabels games.
- Cross-page CTAs relabeled "Ingest games" → "Sync games" (today, insights).
- Full QA 64 passed; integrity clean. **Follow-up:** an Insights→Review bridge link, and `js/games/boot.js` still imports `review.js` (its `initReview()` no-ops on the sync page since the review DOM is gone — harmless, could be trimmed).

---

## v0.63 — Board Vision UI consistency pass (2026-06-08)

Jorge flagged that v0.62 Board Vision looked clunky and off-brand — it had hand-rolled its own layout + unstyled (default-HTML) buttons + pure-text move lists, violating the shared-component rule. Fixed:

- **Adopt the canonical training-screen shell.** The drill view now uses `css/screen.css` `.layout-grid` (board left @640px, info/feedback rail right) — pixel-identical placement to puzzle/endgames/recognition. The page now links `screen.css` + `train.css` (it didn't before — which is *why* the `.btn` classes rendered as default HTML: the stylesheet that defines them wasn't loaded). **Rule reinforced:** a board screen that doesn't link `screen.css`+`board.css`+`train.css` and use `.layout-grid` is a bug.
- **Visual move panel for the tracker.** The hide-the-board moves were plain text ("Move 1: the rook slides 2 squares right"); now each move is a row with the piece icon (`PIECE_IMG` Celtic SVG) + a direction arrow + a concise label — visual, on the right of the board, same principle as the other screens' rail panels.
- **Replay highlight fix:** the true move path renders green (origin amber → landing green); only a wrong tap renders red (previously the correct landing was painted red on a wrong answer).

No new behaviour/keys; full QA 60 passed.

---

## v0.62 — Board Vision: three procedural drills + hide-the-board tracker (Spec 14) (2026-06-08)

The calculation/visualisation pillar — a daily ~3–4 min board-sight warm-up. New page `board-vision.html` + `js/board-vision/{generators,tracker,boot}.js` + `css/board-vision.css`. Built "Both" designs in one hub: three foundational drills (on-ramp) + a 6-level hide-the-board sequence tracker.

- **Foundational drills (pure, data-free, node-testable):** Coordinate Snap, Knight Vision, Piece Walk in `generators.js`. Verified over 60k samples: every knight answer reachable + distractors never; every piece-walk landing exact + distractors bounded ±1/±2.
- **Tracker (procedural, chess.js):** `tracker.js` starts from a small set of sparse base FENs, plays `level` random LEGAL moves, describes each move by distance/shape (never algebraic), and asks one of where/check/count/captured — all derived + graded from chess.js state. **No `data/board-vision.json` dataset** (the mockup's footnote); procedural keeps it infinite + maintenance-free. Verified in-browser: 36 samples across all 6 levels, every answer matched an independent chess.js recomputation. (chess.js is an esm.sh import, so the tracker is node-untestable — verify in the browser, not node.)
- **Board reuse:** every drill renders through the canonical `js/board-static.js` `renderStaticBoard` + a delegated tap; **no `js/puzzle/board.js` change** (Spec 14 said to add a square-pick mode to the solve board, but the static renderer already existed — same lower-risk reuse as game review). New §22 highlight states (`.square.bv-option/.bv-correct/.bv-wrong/.bv-origin` + `.board.bv-hidden .pc-img{visibility:hidden}` for the tracker) live in `css/board.css` with a new `--hl-origin` token — single-sourced, not page-private.
- **One key** `chess-coach-board-vision-v1` `{completedDate, streak, scores:{coord,knight,walk}, coordPerfectStreak, tracker:{level, levelScores}}`, written only on complete; daily streak + level-up (≥80%) logic at write time. No engine, no LLM, no `/api/coach`.
- **Entry points:** un-locked the `practice.html` card; `today.html` Board Vision is now a live warm-up link; added a "Board Vision" nav-child to the `.nav-subgroup` across 10 shell pages; registered `/board-vision.html` in `qa/tests/pages.js`. Full QA suite 60 passed (board-vision adds shell-nav + smoke coverage; nav change kept the single-active-link assertion green).
- **v1 scope notes / follow-ups:** the today.html link goes to the standalone page (not `?session=1`) — `board-vision.html` *supports* session mode, but it isn't wired into the `session.html` block sequence yet (no session-host plumbing this pass). today.html done-state (completedDate) not yet shown. On-device iPhone QA (touch + board sizing + the tracker hide/replay) is the spec's designated manual check.

The roadmap's "deepen the loop" step (item 4). Two phases shipped together.

- **Spec 10 — games.html modularized.** The 1,437-line inline module was split into 13 ES modules under `js/games/` (lib, config, state, dom, storage, analysis, chesscom, categorize, classify, ingest, list, narrate, boot), mirroring `js/puzzle/`. games.html dropped to ~465 lines. **Behaviour-preserving, proven mechanically:** the modules were produced by slicing exact source line-ranges (never retyped), and a multiset diff of code lines (original vs all modules, ignoring import/export scaffolding) was **911 = 911, identical**. One deliberate deviation from the spec's file map: `escapeHtml` lives in `dom.js` (not `list.js`) to keep the import graph acyclic, because drift functions added after the spec baseline (`reviewGameWithCoach`/`wireReviewHandlers`/`renderSavedGames`) introduced a `list ↔ narrate` reference. `CoachStats` stays a `window` global (read via `typeof`), never imported.

- **Spec 11 — interactive game review.** Games is now two-surface: ingest + Review. A new `js/games/review.js` lists replayable games, steps through a game ply-by-ply (reusing the canonical `renderStaticBoard` from `js/board-static.js` — **no `js/puzzle/board.js` refactor needed**, unlike the spec's assumption), shows a severity badge at each saved mistake (joined via the `${gameKey}|${ply}` id), and on tap fires one on-demand grounded `/api/coach` call rendered as a §17 card. Tagged mistakes get a "Drill <motif>" CTA → `/puzzle.html?motif=<tag>&source=review`, handled by a new `activateMotifFromUrl()` in `js/puzzle/boot.js` that reuses `startThemeDrill()`.
  - **One new key:** `chess-coach-game-moves-v1` = `{ [gameKey]: { moves:[SAN…], userIsWhite, result, opponent, dateStr } }`, captured at ingest (the move list is already in memory) and swept by the existing `handleClear` `chess-coach-*` removal. Per-ply FENs are reconstructed in-browser by replaying SAN, never stored.
  - **§12 carve-out (deliberate):** the review explanation prompt freely names the better move / eval / motif — the game is over, so it's the deliverable, not a spoiler. The puzzle.html live-solve coach is untouched and keeps its NAMING_RULES.
  - **Reuse note:** the §17 `parseReviewMessage`/`appendCoachReview` in `js/puzzle/dom.js` are bound to `#coach-log` + puzzle CSS, so review.js inlines a small parser + an inline-styled card instead, to keep games.html decoupled from the puzzle module graph.
  - Verified in-browser: list → replay (last-move highlight tracks) → badge → grounded request + §17 fallback card → Drill CTA → focused fork drill ("Drilling: Fork — 1 of 1"). Full QA suite 56 passed; live end-to-end ingest (the moves-key capture) is the spec's manual device-QA step.

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
