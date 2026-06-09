# KnightPath — design system & UI consistency

The brand reference. Every screen should feel like the same product: same header, same fonts, same colours, same buttons, same spacing. When building or editing a page, conform to this. **Shared-component changes apply to ALL pages** (project rule).

---

## Brand identity

- **Name:** KnightPath. **Mark:** the knight icon (`/brand-icons/knight-mark.png`). **Signature colour:** accent green `#2F9E76`.
- **The brand signature is the header.** Every page opens with the same branded bar: the knight mark + **KnightPath** wordmark (accent green, Plus Jakarta 800) + a **screen chip** naming the page (uppercase, muted pill). This is the single most recognizable element — it must be identical everywhere.
  ```html
  <div class="header-bar">
    <img class="brand-mark" src="/brand-icons/knight-mark.png" alt="" aria-hidden="true">
    <span class="brand-word">KnightPath</span>
    <span class="screen-chip">PAGE NAME</span>
  </div>
  ```
  Styled by `css/header.css` (and identically by `css/shell.css` on the board screens). Link `header.css` (or `shell.css`) and use this markup — never a bare `.page-title`.

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

`tokens → header → shell → nav → board → type → screen → train → [page].css`. Link `tokens.css` first; never redefine its tokens inline.

---

## Consistency backlog (prioritised — for future passes)

The header is now consistent app-wide (v0.65). Remaining debt found in the 2026-06-08 audit:

1. **7 pages don't link `shell.css`** (today, practice, games, insights, coach, completed, roadmap) and **reinvent the nav-drawer / tab-bar / body / container inline**, with subtle drift (`.container` max-width varies 560/640/720/780/820/920px; per-page `.nav-drawer`). High-value, higher-risk: migrate each to link the shared shell + delete the duplicated inline rules. Do one page at a time with device QA (the shared nav/body cascade can shift desktop layout). This is the US-17 "finish the shell extraction" item.
2. **No shared `.panel`/card component** — defined inline on games/insights/review with different padding/shadow. Create one shared card (in train.css) and migrate.
3. **Button naming drift** — games.html uses inline `.btn-secondary`/`.btn-danger` (not in train.css). Migrate to `.btn` / `.btn.ghost` once games links train.css.
4. **Hardcoded values** — pages hardcode the body gradient (`#FFFFFF/#EDF0F3`), header blur, and some semantic colours (`#FBF0ED` ≈ bad-soft) instead of tokens. Tokenise as part of (1).
5. **`header.css` ⇄ `shell.css` duplication** — the branded header lives in both (header.css for the 7 converted pages, shell.css for the 5 board screens). Consolidate into header.css and link it everywhere; remove from shell.css.
