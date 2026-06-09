# KnightPath — design system & UI consistency

The brand reference. Every screen should feel like the same product: same header, same fonts, same colours, same buttons, same spacing. When building or editing a page, conform to this. **Shared-component changes apply to ALL pages** (project rule).

---

## Brand identity

- **Name:** KnightPath. **Mark:** the knight icon (`/brand-icons/knight-mark-sm.png`). **Signature colour:** accent green `#2F9E76`.
- **The brand signature is the header.** Every page opens with the same branded bar: the knight mark + **KnightPath** wordmark (accent green, Plus Jakarta 800) + a **screen chip** naming the page (uppercase, muted pill). This is the single most recognizable element — it must be identical everywhere.
  ```html
  <div class="header-bar">
    <img class="brand-mark" src="/brand-icons/knight-mark-sm.png" alt="" aria-hidden="true">
    <span class="brand-word">KnightPath</span>
    <span class="screen-chip">PAGE NAME</span>
  </div>
  ```
  Styled by `css/shell.css` (the branded `.header-bar` + `.brand-mark`/`.brand-word`/`.screen-chip`). Link `shell.css` and use this markup — never a bare `.page-title`.

---

## Tokens — the single source of truth (`css/tokens.css`)

Never hardcode a colour/radius that has a token. Never redefine these in a page's inline `:root`.

| Group | Tokens |
|---|---|
| Brand / surface | `--accent #2F9E76` · `--accent-2 #5FB58F` · `--accent-soft #E7F4EE` · `--ink #1B1D22` · `--muted #6E727B` · `--surface #fff` · `--surface2 #F2F4F7` · `--surface3 #E9ECF1` · `--line rgba(0,0,0,.10)` |
| Status | `--pos #1F9D57` · `--warn #C98A2E` · `--bad #D2553F` |
| Board | `--light-sq` · `--dark-sq` · `--hl-move` · `--hl-sel` · `--hl-origin` |
| Radii | `--r-card 16` · `--r-panel 14` · `--r-btn 12` · `--r-board 9` · `--r-pill 20` |
| Phase | `--open #4F7CC4` · `--middle #2F9E76` · `--endg #C98A2E` |

## Typography (`css/type.css`)

- **Display / headings** (`h1–h4`): Plus Jakarta Sans 700–800 (`--font-display`).
- **Body / UI:** Inter (`--font-body`).
- **Data** (evals, FEN, coordinates, counts, timers): Spline Sans Mono (`--font-mono` / `.t-mono`).
- Page intro pattern: `.eyebrow` (10.5px uppercase accent) → `<h1>` (26px/800) → `.lede` (13px muted).

## Buttons (`css/train.css`)

One system. Canonical classes: **`.btn`** (base) · **`.btn.primary`** (accent fill) · **`.btn.ghost`** (surface + line). Compact: **`.btn.btn-action`**. Outline-accent: **`.btn.btn-review`**. Do not invent `.btn-secondary` / `.btn-danger` — use `.btn` / `.btn.ghost` (+ a `--bad` colour for destructive).

## Layout & components

- **Training screens** (any board): the canonical shell `css/screen.css` `.layout-grid` → `.lg-head` / `.lg-left` (board-wrap + controls) / `.lg-right` (rail). Board left at the standard size, info/feedback rail right. Desktop breakpoint **880px**. The board cells come from `css/board.css`; never hand-roll a board.
- **Nav:** drawer (`shell.css` + `nav.css`) pinned on desktop ≥880px; tab-bar on mobile. Sub-group (Puzzles/Endgames/Recognition/Board Vision) under Practice; "More" group (Sync games / Roadmap / Completed). Exactly **one** `.nav-drawer-link.active` per page.
- **Cards:** `.coach-card` (train.css) is the canonical card. A general `.panel` is currently defined per-page (drift — see backlog).
- **Icons:** line style, 24×24 viewBox, `stroke-width 1.9`, round caps/joins, `currentColor`. Reuse the existing nav icon set.

## Canonical stylesheet link order

`tokens → shell → nav → board → type → screen → train → [page].css`. Link `tokens.css` first; never redefine its tokens inline. Every page now links `shell.css` for the shared chrome (header/nav/body/container/tab-bar) — do not re-declare it inline.

---

## Consistency backlog (prioritised — for future passes)

The header is consistent app-wide (v0.65) and the shell migration is done (v0.66). Remaining debt found in the 2026-06-08 audit:

1. ~~7 pages don't link `shell.css`~~ **DONE (v0.66, US-17):** today, practice, games, insights, coach, completed, roadmap now link `shell.css` + `nav.css` and the duplicated inline chrome (header/nav/body/container/tab-bar + the desktop `@media`) was removed. Each page's chrome now computes identically to the board screens (560/1100 container, 224px pinned nav, mobile-only tab-bar, branded static header). Verified by computed-style parity + QA.
2. **Shared `.panel` card** — **DONE for the literal `.panel` pages (v0.73):** one canonical `.panel` now lives in `shell.css` (universally linked) — `var(--r-card)` / 18px / `1px var(--line)` / one soft shadow / `var(--surface)`; games/insights/review reduced to margin-only and now compute **identically** (verified by computed-style parity). **Still open:** the *bespoke* cards that use other class names (`.session` on today, `.mode-card` on practice, `.loop` on roadmap, `.op-panel` on openings, `.summary-bar` on completed) — migrating them needs HTML re-classing + per-card padding checks (layout-shift risk → visual QA on a preview).
3. **Button fork** — **DONE in `train.css` (v0.73):** `.btn.btn-primary` and `.btn.primary` are now one rule (both selectors), so the two class names render identically; puzzle.html's phantom `.btn-secondary` → `.btn.ghost`. **Still open:** `games.html` re-rolls its own `.btn` (accent-fill base) + `.btn-secondary`/`.btn-danger` and doesn't link `train.css` — migrating it changes every button's look (visual-QA gate).
4. **Hardcoded values** — body gradient, header blur, and the semantic soft/line colours. **Partly done (v0.72):** the soft/line **tokens now exist** (`--bad-soft/-line/-ink`, `--warn-soft/-line`, `--pos-soft`, `--accent-line`, `--app-bg-start/-end` in `tokens.css`) and are used by the new intro card; the ~17 existing hardcoded hexes across pages still need migrating to them.
5. ~~`header.css` ⇄ `shell.css` duplication~~ **DONE (v0.66).**

### v0.72 consistency pass (2026-06-09 audit) — done
- ✅ **`.eyebrow` + `.lede` promoted to `type.css`** (single source). Fixes **review.html's unstyled eyebrow** (a live brand break — it had no definition) and unifies the two drifting values (10.5px vs 11px) → every page-intro eyebrow now computes identically (accent / 10.5px / 700 / .12em / 5px margin). Verified by computed-style parity across review/today/insights.
- ✅ **"More"-group nav icons** (Sync games / Roadmap / Completed) were emoji (`⟳ ▤ ✓`); replaced app-wide with line-icon SVGs matching the nav set (24×24, stroke-width 1.9, `currentColor` so active-state white inherits).
- ✅ **Brand-mark perf+hygiene** — the header/nav used `knight-mark.png` (**843 KB**, 1254² rendered at 24px) on every page; now a downscaled `knight-mark-sm.png` (**12.9 KB**, 128², visually identical) + immutable caching on `/brand-icons/*`.
- ✅ Misc: `insights.html` stray comment moved inside `<style>`; `openings.css` off-scale `6px` radius → `var(--r-panel)`; the `none-tactical` "Drill this theme" CTA is now disabled (it had no library supply).
