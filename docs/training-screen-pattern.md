# Training-screen pattern (HARD RULE)

Every page that shows a board-based exercise — a "puzzle" of any kind: mistake
puzzles, endgame play-out, win/draw/loss recognition, and anything we add later
— **must** follow this pattern. Consistency is the point: a learner should feel
they are on the same screen, only the exercise changes.

`puzzle.html` is the reference implementation.

## 1. Stylesheets — in this order, and NO inline `<style>`
```html
<link rel="stylesheet" href="/css/tokens.css">   <!-- design variables -->
<link rel="stylesheet" href="/css/nav.css">
<link rel="stylesheet" href="/css/board.css">
<link rel="stylesheet" href="/css/type.css">
<link rel="stylesheet" href="/css/screen.css">   <!-- canonical LAYOUT -->
<link rel="stylesheet" href="/css/train.css">    <!-- shared COMPONENTS -->
<link rel="stylesheet" href="/css/session-wrap.css">
<link rel="stylesheet" href="/css/<page>.css">   <!-- thin page-specific -->
```
No page may carry an inline `<style>` block. Page-specific rules live in the
page's own sheet, loaded last.

## 2. Layout — the canonical shell from `screen.css`
```
.layout-grid
  ├─ #session-wrap.session-wrap   (optional Today-session band, first child)
  ├─ .lg-head     exercise meta on top (side-to-move, status)
  ├─ .lg-left     .board-wrap → #material-top, #board, #material-bottom
  └─ .lg-right    [page-specific exercise panel]  THEN  the coach card
```
The board sits left; the right rail holds the exercise controls **and the
coach**. On mobile it stacks to one column (meta → board → rail). Do not
hand-roll a column layout.

## 3. Shared components come from `train.css`
Board frame + material rows, nav arrows, `.controls`, all `.btn*`, the eval /
`.cp-bar`, and the **coach card + `.msg` bubbles** are defined ONCE in
`train.css`. Change a component there and every screen updates.

**Page sheets may ADD page-specific widgets in `.lg-right`; they must NOT
redefine shared components.** The page-specific part is the exercise itself:
- puzzle → result/verdict + move comparison
- recognition → win / draw / loss buttons
- endgames → show-technique + verdict

## 4. The coach is always present
Every training screen includes the `.coach-card` markup in `.lg-right` and
mounts it via `js/coach-widget.js`:
```html
<script type="module">
  import { mountCoachWidget } from '/js/coach-widget.js';
  mountCoachWidget({
    logEl:   document.getElementById('coach-log'),
    formEl:  document.getElementById('coach-form'),
    inputEl: document.getElementById('coach-input'),
    sendEl:  document.getElementById('coach-send'),
    context: 'One sentence telling the coach which exercise this screen is.'
  });
</script>
```

## Status / follow-ups
- ✅ `recognition` (endgame-recognition.html) follows this pattern.
- ✅ `endgames.html` follows this pattern.
- ✅ Material-difference indicator: `js/material.js` (net on-board advantage),
  mounted on recognition + endgames into `#material-top`. Self-contained,
  reads the board DOM, no engine deps. puzzle.html keeps its richer
  captured-pieces display; unifying the two is a future polish.
- ⏳ `puzzle.html` still links its own `puzzle.css` copy of the shared
  components. `train.css` mirrors those values. Migrating puzzle.html onto
  `train.css` (and deleting the duplicated rules from `puzzle.css`) is a
  tracked follow-up — do it as its own preview-checked change so the reference
  screen never regresses.
