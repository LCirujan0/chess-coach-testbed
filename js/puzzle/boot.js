// ============================================================================
// SECTION 0 — GLOBAL ERROR HANDLERS (M1, v0.7)
// ============================================================================
// Registered as the very first executable code in the module so that ANY
// downstream error — including import/parse failures further down the script,
// failed first-paint state initialisation, or a top-level throw — is caught
// and surfaced in the coach panel instead of bricking the page silently
// (the failure mode flagged in docs/learnings.md 2026-05-28). Module scripts
// are deferred by default, so the DOM is already parsed by the time this
// runs — appendCoachMessage's $('coach-log') lookup is reliably available.
window.addEventListener('error', (e) => {
  const log = document.getElementById('coach-log');
  if (!log) return;                                  // pre-DOM defensive guard
  const div = document.createElement('div');
  div.className = 'msg error';
  div.textContent = `JS error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
});
window.addEventListener('unhandledrejection', (e) => {
  const log = document.getElementById('coach-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'msg error';
  div.textContent = `Unhandled promise rejection: ${e.reason}`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
});

// ============================================================================
// SECTION 14 — Boot
// ============================================================================
// (Global error + unhandledrejection listeners moved to SECTION 0 at the top
// of the script per M1, so they catch failures from anywhere in this module
// rather than only what happens after Boot.)
import { STORAGE_KEY_SESSION, MOTIFS, RATING_REFRESH_INTERVAL_MS, DEFAULT_PUZZLE } from './config.js';
import { refreshSessionWrap } from '/js/session-wrap.js';
import { state } from './state.js';
import { $, setInlineStatus } from './dom.js';
import {
  loadAttempts, loadMode, loadPuzzlesFromStorage, loadLastSeverity,
  loadLastTried, loadLastMotif, loadCachedRating, refreshRatingFromChessCom,
  saveLastCategory, saveLastSeverity, saveLastTried, saveLastMotif, saveMode,
} from './storage.js';
import { initStockfish } from './engine.js';
import { renderBoard, onSquareTap, toggleAnnotation, renderAnnotations } from './board.js';
import {
  rebuildQueue, pickInitialCategory, mixPuzzlesAcrossGames, nextPuzzle,
  loadPuzzleAt, puzzlesByCategory, severityCounts, categoryCounts,
  triedCounts, startThemeDrill, endThemeDrill,
} from './queue.js';
import { resetPuzzleStateAndRender } from './result.js';
import { navBack, navForward, activatePieceHint } from './review.js';
import { forceReveal } from './grade.js';
import { sendCoachMessage, fireCoachExplanation } from './coach.js';

// Parse URL for review mode (coming from completed.html)
const urlParams = new URLSearchParams(window.location.search);
state.reviewPuzzleId = urlParams.get('id') || null;

state.attempts = loadAttempts();
// Default to Drill (no CCTO gate, tap-tap-grade-next). Deep is opt-in via the
// header pill once the user wants the thinking-gate friction back.
state.mode = (loadMode() === 'deep') ? 'deep' : 'drill';

// v0.13 — Activate Today session-mode when ?session=today&block=ID is present
// and matches a block in `chess-coach-session-v1`. Vision blocks have empty
// `ids`, so they don't restrict the queue but still flag for write-back +
// return navigation. Honours the block's mode (deep|drill) if specified.
(function activateSessionFromUrl() {
  if (urlParams.get('session') !== 'today') return;
  const blockId = urlParams.get('block');
  if (!blockId) return;
  let plan;
  try { plan = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || 'null'); } catch { plan = null; }
  if (!plan || !Array.isArray(plan.blocks)) return;
  const blockIdx = plan.blocks.findIndex((b) => b && b.id === blockId);
  if (blockIdx < 0) return;
  const block = plan.blocks[blockIdx];
  const queueIds = Array.isArray(block.ids) ? block.ids.slice() : [];
  state.sessionMode = {
    blockId, blockIdx, queueIds,
    count: typeof block.count === 'number' ? block.count : queueIds.length,
    title: block.title || blockId,
    mode: (block.mode === 'deep' || block.mode === 'drill') ? block.mode : null,
    // P0 fix (hotfix/r1.2): session start time. Block completion counts only
    // puzzles solved at/after this instant, so a drill over previously-solved
    // puzzles is not "complete" before the user starts.
    sinceMs: Date.parse(plan.createdAt) || 0,
  };
  if (state.sessionMode.mode) state.mode = state.sessionMode.mode;
})();

// v0.55 — render the persistent in-session wrapper (no-op + hidden when the
// surface is opened outside a Today session). The exit chip returns to the
// session wrapper screen.
refreshSessionWrap({ exitHref: '/session.html' });

// Rating: load cached value, refresh from Chess.com in background if stale.
const cachedRating = loadCachedRating();
if (cachedRating) state.userRating = cachedRating.rating;
const ratingStale = !cachedRating || (Date.now() - new Date(cachedRating.fetchedAt).getTime() > RATING_REFRESH_INTERVAL_MS);
if (ratingStale) refreshRatingFromChessCom(); // non-blocking
$('mode-deep').classList.toggle('active', state.mode === 'deep');
$('mode-drill').classList.toggle('active', state.mode === 'drill');

const stored = loadPuzzlesFromStorage();
if (stored.length) {
  state.puzzles = mixPuzzlesAcrossGames(stored);
  state.hasIngestedPuzzles = true;
  const lastSev = loadLastSeverity();
  state.severityFilter = ['all', 'inaccuracy', 'mistake', 'blunder'].includes(lastSev) ? lastSev : 'all';
  const lastTried = loadLastTried();
  state.triedFilter = ['all', 'tried', 'untried'].includes(lastTried) ? lastTried : 'all';
  const lastMotif = loadLastMotif();
  const validMotif = lastMotif === 'all' || lastMotif === 'untagged' || MOTIFS.includes(lastMotif);
  state.motifFilter = validMotif ? lastMotif : 'all';
  state.currentCategory = pickInitialCategory();
} else {
  state.puzzles = [DEFAULT_PUZZLE];
  state.hasIngestedPuzzles = false;
  state.severityFilter = 'all';
  state.triedFilter = 'all';
  state.motifFilter = 'all';
  state.currentCategory = 'all';
}
// ----------------------------------------------------------------------------
// Unified puzzle schema (phase 1a) — load the static endgame + recognition
// puzzle sets and merge them into state.puzzles. Additive: a page only sees
// these if it does NOT pin a different type via <meta name="puzzle-type-filter">.
// puzzle.html pins "mistake", so the merged entries are filtered out of its
// queue and the core page stays mistakes-only.
// ----------------------------------------------------------------------------
async function loadStaticPuzzleSets() {
  const existing = new Set(state.puzzles.map((p) => p && p.id).filter(Boolean));
  // Endgame curriculum lessons (data/endgames.json → { lessons: [...] }).
  try {
    const res = await fetch('/data/endgames.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const arr = (data && Array.isArray(data.lessons)) ? data.lessons : [];
      for (const item of arr) {
        if (!item || !item.id || existing.has(item.id)) continue;
        existing.add(item.id);
        state.puzzles.push(item);
      }
    }
  } catch (err) {
    console.warn('loadStaticPuzzleSets: endgames.json fetch failed', err);
  }
  // Endgame recognition positions (data/endgame-recognition.json → { positions: [...] }).
  // NOTE: these carry their puzzle-type in `puzzleType` ('recognition'); their
  // `type` field holds the material signature (e.g. 'KPvK').
  try {
    const res = await fetch('/data/endgame-recognition.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const arr = (data && Array.isArray(data.positions)) ? data.positions : [];
      for (const item of arr) {
        if (!item || !item.id || existing.has(item.id)) continue;
        existing.add(item.id);
        state.puzzles.push(item);
      }
    }
  } catch (err) {
    console.warn('loadStaticPuzzleSets: endgame-recognition.json fetch failed', err);
  }
  // Phase 3: Merge any previously-computed AI tags from chess-coach-tags-v1.
  // Tags were written by tagger.js after a curriculum puzzle was completed; we
  // merge them back here so the motif/themes/aiTaggedAt fields are present in
  // state.puzzles before the queue is built.
  const storedTags = JSON.parse(localStorage.getItem('chess-coach-tags-v1') || '{}');
  if (Object.keys(storedTags).length) {
    for (const p of state.puzzles) {
      if (p && p.id && storedTags[p.id]) {
        Object.assign(p, storedTags[p.id]);  // merge motif/themes/aiTaggedAt
      }
    }
  }
}

// Page default puzzle-type filter. puzzle.html pins "mistake" (its critical
// guard); pages with no meta leave typeFilter null (no type restriction).
(function applyPageTypeFilter() {
  const meta = document.querySelector('meta[name="puzzle-type-filter"]');
  const val = meta && meta.getAttribute('content');
  if (val) state.typeFilter = val;
})();

// Build the randomised play queue from the loaded puzzles. Phase 1a: merge the
// static endgame + recognition sets first (no-op for puzzle.html's queue,
// which is pinned to type "mistake"). Wrapped so a slow/failed fetch can't
// block the initial board render below.
await loadStaticPuzzleSets();
rebuildQueue();

// Reset restarts the same puzzle position without re-opening the CCTO gate
// (the student has already filled in their analysis for this position).
// Reset = soft reset: rewind the board to the puzzle's starting position but
// leave the coach review + result panel + comparison on screen, so the user
// can re-practise the same puzzle while the lesson is still visible.
$('reset-btn').addEventListener('click', () => resetPuzzleStateAndRender({ keepGate: true, keepReview: true }));
// "Next puzzle" replaces the old Skip button — clicking it during play advances
// the queue without recording an attempt; clicking it post-resolution does the
// same. One button, one behaviour.
$('next-btn').addEventListener('click', () => nextPuzzle());
$('nav-back').addEventListener('click', navBack);
$('nav-forward').addEventListener('click', navForward);
$('show-piece-btn').addEventListener('click', activatePieceHint);

// §30.2 — result-card actions. One dominant action per state; the buttons
// follow the card (data-action set by showResult): 'tryagain' soft-resets to the
// puzzle start (lesson kept), 'next' advances the queue.
function cardAction(e) {
  const action = e.currentTarget.dataset.action;
  if (action === 'tryagain') resetPuzzleStateAndRender({ keepGate: true, keepReview: true });
  else if (action === 'next') nextPuzzle();
}
$('card-primary').addEventListener('click', cardAction);
$('card-secondary').addEventListener('click', cardAction);
// §30.6 #3 — the quiet "Show me the answer" escape (from the 2nd miss).
$('card-showanswer').addEventListener('click', () => forceReveal());

// §29.3 — mobile progressive-disclosure accordions (comparison + coach). The
// header toggles .acc-collapsed; desktop CSS ignores the class (always open).
for (const head of document.querySelectorAll('.acc-head')) {
  head.addEventListener('click', () => {
    const card = head.closest('#comparison, .coach-card');
    if (card) card.classList.toggle('acc-collapsed');
  });
}
// AI review button — triggers the coach explanation on demand. The auto-fire
// was removed so the player only spends tokens when they actually want feedback.
$('ai-review-btn').addEventListener('click', async () => {
  const btn = $('ai-review-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  let ctx;
  try { ctx = JSON.parse(btn.dataset.pendingReview || '{}'); }
  catch { ctx = {}; }
  const grade = { tier: ctx.tier, rank: ctx.rank, cpLoss: ctx.cpLoss };
  const played = ctx.playedSan ? { san: ctx.playedSan } : null;
  try {
    await fireCoachExplanation({ grade, played, terminal: ctx.terminal });
  } finally {
    btn.disabled = false;
  }
});

// ----- Right-click annotations (Chess.com-style arrows + circle highlights) ---
// Desktop only. Right-click drag from A to B draws an arrow A→B. Right-click on
// the same square draws a circle highlight. Right-click again on an existing
// annotation removes it. ANY left-click on the board also clears every
// annotation (matches Chess.com / Lichess behaviour). All annotations clear
// automatically when a move is played or the puzzle is reset.
let rcStartSquare = null;
const boardEl = $('board');
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
// Delegated tap-to-move handler. Each renderBoard pass rebuilds the squares,
// so attaching listeners per-square (the v0.5 pattern) leaked thousands of
// closures and forced full DOM mutation. The delegated listener stays valid
// across renders and is the partner to the DocumentFragment swap above —
// together they fix the mobile-blink reported in v0.6 feedback.
boardEl.addEventListener('click', (e) => {
  const sq = e.target.closest('.square');
  if (!sq || !sq.dataset.square) return;
  onSquareTap(sq.dataset.square);
});
boardEl.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    // Right button — annotation flow.
    const sq = e.target.closest('.square');
    rcStartSquare = sq ? sq.dataset.square : null;
    return;
  }
  if (e.button === 0 && state.annotations.length) {
    // Left button — clear any drawn annotations on press (Chess.com style).
    // The click handler on the square still fires for tap-to-move.
    state.annotations = [];
    renderAnnotations();
  }
});
boardEl.addEventListener('mouseup', (e) => {
  if (e.button !== 2) return;
  if (!rcStartSquare) return;
  const sq = e.target.closest('.square');
  const endSquare = sq ? sq.dataset.square : null;
  if (endSquare) {
    if (endSquare === rcStartSquare) toggleAnnotation({ type: 'circle', square: endSquare });
    else toggleAnnotation({ type: 'arrow', from: rcStartSquare, to: endSquare });
    renderAnnotations();
  }
  rcStartSquare = null;
});

// Filters button toggles the inline filter panel.
$('filter-toggle').addEventListener('click', () => {
  const panel = $('filter-panel');
  const toggle = $('filter-toggle');
  panel.classList.toggle('hidden');
  const isOpen = !panel.classList.contains('hidden');
  toggle.classList.toggle('open', isOpen);
});

for (const tab of document.querySelectorAll('.cat-tab')) {
  tab.addEventListener('click', () => {
    const cat = tab.dataset.cat;
    // No-op if user clicks the filter that's already active — don't yank them
    // to a different puzzle just because they tapped the chip they're on.
    if (cat === state.currentCategory) return;
    if (cat !== 'all' && puzzlesByCategory(cat).length === 0) return;
    loadPuzzleAt(cat, 0);
  });
}
for (const tab of document.querySelectorAll('.filter-tab')) {
  tab.addEventListener('click', () => {
    const s = tab.dataset.sev;
    if (s === state.severityFilter) return; // already active, no-op
    if (s !== 'all' && severityCounts()[s] === 0) return;
    state.severityFilter = s;
    saveLastSeverity(s);
    const counts = categoryCounts();
    if (state.currentCategory !== 'all' && counts[state.currentCategory] === 0) state.currentCategory = 'all';
    rebuildQueue();
    resetPuzzleStateAndRender();
  });
}
for (const tab of document.querySelectorAll('.tried-tab')) {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tried;
    if (t === state.triedFilter) return; // already active, no-op
    if (t !== 'all' && triedCounts()[t] === 0) return;
    state.triedFilter = t;
    saveLastTried(t);
    rebuildQueue();
    resetPuzzleStateAndRender();
  });
}
// Spec 02 — Theme collapsible + motif pills + Drill this theme + End drill.
$('theme-toggle').addEventListener('click', () => {
  const t = $('theme-toggle');
  const p = $('theme-panel');
  const open = t.classList.toggle('open');
  p.classList.toggle('hidden', !open);
});
$('theme-pills').addEventListener('click', (e) => {
  const pill = e.target.closest('.theme-pill');
  if (!pill || pill.classList.contains('empty')) return;
  const m = pill.dataset.motif;
  if (m === state.motifFilter) return; // no-op on re-click
  state.motifFilter = m;
  saveLastMotif(m);
  rebuildQueue();
  resetPuzzleStateAndRender();
});
$('drill-cta').addEventListener('click', () => {
  if ($('drill-cta').disabled) return;
  startThemeDrill();
});
$('drill-end').addEventListener('click', () => endThemeDrill());
for (const pill of document.querySelectorAll('.mode-pill')) {
  pill.addEventListener('click', () => {
    state.mode = pill.dataset.mode;
    saveMode(state.mode);
    $('mode-deep').classList.toggle('active', state.mode === 'deep');
    $('mode-drill').classList.toggle('active', state.mode === 'drill');
    const counts = categoryCounts();
    if (counts[state.currentCategory] === 0) state.currentCategory = pickInitialCategory();
    rebuildQueue();
    resetPuzzleStateAndRender();
  });
}
$('coach-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('coach-input');
  const value = input.value;
  input.value = '';
  sendCoachMessage(value);
});

resetPuzzleStateAndRender();
initStockfish().catch((err) => setInlineStatus('Engine failed: ' + err.message, 'error'));

console.log('Puzzle page loaded.', state.hasIngestedPuzzles ? `${state.puzzles.length} puzzles in storage.` : 'default puzzle.');
