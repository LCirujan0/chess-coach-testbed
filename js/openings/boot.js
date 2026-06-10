// ============================================================================
// js/openings/boot.js. Openings trainer UI runner (hub + drill loop).
// ----------------------------------------------------------------------------
// Two surfaces:
//   HUB, list repertoire openings from the registry as cards, plus a "Your
//           openings" panel (personal.js) showing which the user actually plays
//           and where results cluster. Each card opens that opening's drill.
//   DRILL, spaced-repetition recall of one curated line. We replay the book
//           moves so far, render the position via the canonical static board,
//           and the user inputs the next BOOK move by tapping origin then
//           destination (delegated tap, mirroring Board Vision). chess.js
//           validates the move and confirms it matches the book SAN. On a
//           completed line the SRS card updates and a complete screen shows.
//
// Reuses: renderStaticBoard (js/board-static.js), .layout-grid (screen.css),
// .btn/.btn.primary/.btn.ghost (train.css), tokens. Page layout in openings.css.
// Persists SRS state under 'chess-coach-openings-v1'.
// ============================================================================
import { Chess } from '/js/vendor/chess-1.4.0.js';
import { renderStaticBoard } from '/js/board-static.js';
import { listOpenings, getOpening } from './data.js';
import { freshCard, normalizeCard, review, pickNext, countDue, masterySummary } from './srs.js';
import { personalForOpenings, hasGameData } from './personal.js';

const KEY = 'chess-coach-openings-v1';
const $ = (id) => document.getElementById(id);

// ----- storage (the persisted blob: { version, cards: { [lineId]: card } }) ---
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '');
    if (v && typeof v === 'object' && v.cards) return { version: 1, cards: v.cards };
  } catch {}
  return { version: 1, cards: {} };
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
function cardFor(store, lineId) { return store.cards[lineId] ? normalizeCard(store.cards[lineId]) : freshCard(); }

// ----- view switching -----
function show(view) { for (const v of ['op-hub', 'op-drill', 'op-complete']) $(v).classList.toggle('hidden', v !== view); }

// ----- escaping -----
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ============================================================================
// HUB
// ============================================================================
let OPENINGS = []; // registry entries

async function renderHub() {
  show('op-hub');
  let openings = [];
  try { openings = await listOpenings(); } catch {}
  OPENINGS = openings;
  const store = load();

  // We need each opening's line ids to compute due counts. Lazily load the
  // files (cached) so the badges are accurate; degrade if a file is missing.
  const lineIdsByOpening = {};
  await Promise.all(openings.map(async (o) => {
    try { const data = await getOpening(o.id); lineIdsByOpening[o.id] = (data.lines || []).map((l) => l.id); }
    catch { lineIdsByOpening[o.id] = []; }
  }));

  // Repertoire cards.
  const cardsHtml = openings.map((o) => {
    const ids = lineIdsByOpening[o.id] || [];
    const m = masterySummary(ids, store.cards);
    const due = countDue(ids, store.cards);
    const dueChip = due > 0 ? `<span class="op-due">${due} due</span>` : (m.total && m.strong === m.total ? '<span class="op-due op-strong">Sharp</span>' : '');
    return `<button class="op-card" type="button" data-open="${esc(o.id)}">
      <div class="op-card-ic">♟</div>
      <div class="op-card-bd">
        <b>${esc(o.name)} ${dueChip}</b>
        <small>${esc(o.blurb || '')}</small>
        <span class="op-card-meta">${esc(o.eco)} · ${ids.length} line${ids.length === 1 ? '' : 's'}${m.total ? ` · ${m.strong}/${m.total} sharp` : ''}</span>
      </div>
      <span class="op-card-go">›</span>
    </button>`;
  }).join('');
  $('op-list').innerHTML = cardsHtml || '<p class="op-empty">No openings available.</p>';
  for (const b of $('op-list').querySelectorAll('.op-card')) b.addEventListener('click', () => startDrill(b.dataset.open));

  // Personal panel.
  renderPersonal(openings);
}

function renderPersonal(openings) {
  const panel = $('op-personal');
  if (!hasGameData()) {
    panel.innerHTML = `<div class="op-panel-h">Your openings</div>
      <p class="op-personal-empty">Sync your Chess.com games and we'll show which of these openings you actually play, and where your results need work.
      <a href="/games.html">Sync games →</a></p>`;
    return;
  }
  const rows = personalForOpenings(openings).filter((p) => p.played);
  if (!rows.length) {
    panel.innerHTML = `<div class="op-panel-h">Your openings</div>
      <p class="op-personal-empty">None of your synced games match these repertoire openings yet. As you play them, your real results will show up here.</p>`;
    return;
  }
  const rowsHtml = rows.map((p) => {
    const r = p.record;
    const wl = `${r.win}W · ${r.loss}L · ${r.draw}D`;
    const flag = p.struggling ? '<span class="op-flag">Needs work</span>' : '';
    return `<button class="op-personal-row" type="button" data-open="${esc(p.id)}">
      <div class="op-personal-bd"><b>${esc(p.name)} ${flag}</b><small>${r.games} game${r.games === 1 ? '' : 's'} · ${esc(wl)}${r.scorePct != null ? ` · ${r.scorePct}%` : ''}</small></div>
      <span class="op-card-go">Drill ›</span>
    </button>`;
  }).join('');
  panel.innerHTML = `<div class="op-panel-h">Your openings</div>
    <p class="op-personal-lede">From your synced games, where your repertoire shows up in real play.</p>
    <div class="op-personal-list">${rowsHtml}</div>`;
  for (const b of panel.querySelectorAll('.op-personal-row')) b.addEventListener('click', () => startDrill(b.dataset.open));
}

// ============================================================================
// DRILL
// ============================================================================
// drill state for the active line
let D = null;

async function startDrill(openingId) {
  let data;
  try { data = await getOpening(openingId); } catch { renderHub(); return; }
  const lines = data.lines || [];
  if (!lines.length) { renderHub(); return; }
  const store = load();
  const order = lines.map((l) => l.id);
  const pickedId = pickNext(order, store.cards) || order[0];
  const line = lines.find((l) => l.id === pickedId) || lines[0];
  beginLine(data, line);
}

// Set up the chess.js game and the per-line cursor, then render the first prompt.
function beginLine(opening, line) {
  const chess = new Chess();
  // Precompute the side-to-move at each ply so we know which plies the user
  // (White) must input. The user plays White: input on even plies (0,2,4,...).
  D = {
    opening,
    line,
    chess,
    moves: line.moves,        // SAN strings from the start
    whys: line.whys || [],    // per-move coach explanation (the WHY), parallel to moves
    idx: 0,                   // index of the next move to be played
    side: opening.side === 'b' ? 'b' : 'w',
    sel: null,                // selected origin square (algebraic) or null
    perfect: true,            // did the user recall every required move?
    boardEl: $('op-board'),
  };
  show('op-drill');
  $('op-line-name').textContent = `${opening.name}, ${line.name}`;
  $('op-idea').textContent = line.idea || '';
  advance();
}

// Auto-play any leading opponent moves, then render the board + prompt for the
// user's move. If the line is exhausted, finish.
function advance() {
  // Play forward through any moves that are NOT the user's to input
  // (opponent's replies) so the user is only ever asked for THEIR book move.
  while (D.idx < D.moves.length && sideToMoveIsOpponent()) {
    D.chess.move(D.moves[D.idx]);
    D.idx++;
  }
  if (D.idx >= D.moves.length) { finishLine(); return; }
  D.sel = null;
  renderBoard();
  showWhy(D.idx - 1); // explain the move that led to this position (opponent's reply)
  const ply = D.idx; // user's move number for display
  const moveNo = Math.floor(ply / 2) + 1;
  $('op-prompt').innerHTML = `Your move, find <b>${esc(D.side === 'w' ? 'White' : 'Black')}</b>'s book move (move ${moveNo}). Tap the piece, then its destination.`;
  $('op-feedback').textContent = '';
  $('op-feedback').className = 'op-feedback';
  updateProgress();
}

function sideToMoveIsOpponent() {
  return D.chess.turn() !== D.side;
}

function updateProgress() {
  const total = D.moves.length;
  $('op-progress').textContent = `${Math.min(D.idx, total)} / ${total}`;
}

// Render the current position. `highlight` optionally tints selected/target sqs.
function renderBoard(lastMove) {
  // Slide the piece when this render reflects a just-played move (book move or
  // opponent reply); a fresh line/position load passes no lastMove → instant.
  renderStaticBoard(D.boardEl, D.chess.fen(), { orientation: D.side, lastMove: lastMove || null, animate: !!lastMove });
  if (D.sel) markSquare(D.sel, 'op-sel');
}
function markSquare(alg, cls) { const sq = D.boardEl.querySelector(`.square[data-square="${alg}"]`); if (sq) sq.classList.add(cls); }

// Show the coach's "why" for the move at `ply` (the one that produced the current
// position). Hidden when there's no note (e.g. the very first prompt). This is the
// ChessReps-style per-move explanation, understanding the WHY, not just the move.
function showWhy(ply) {
  const card = $('op-why-card'); if (!card) return;
  const why = (ply >= 0 && D && Array.isArray(D.whys) && D.whys[ply]) ? D.whys[ply] : '';
  if (why) { $('op-why').textContent = why; card.classList.remove('hidden'); }
  else { card.classList.add('hidden'); }
}

// Delegated tap on the static board: first tap selects an origin with a friendly
// piece; second tap attempts the move origin->destination. We validate with
// chess.js AND require the SAN to equal the book move.
function onBoardTap(alg) {
  if (!D || D.idx >= D.moves.length) return;
  if (sideToMoveIsOpponent()) return; // not the user's turn (shouldn't happen)
  const piece = D.chess.get(alg);
  if (!D.sel) {
    // Select an origin only if it holds a friendly piece.
    if (piece && piece.color === D.side) { D.sel = alg; renderBoard(); }
    return;
  }
  // Second tap.
  if (alg === D.sel) { D.sel = null; renderBoard(); return; } // tap same square = deselect
  if (piece && piece.color === D.side) { D.sel = alg; renderBoard(); return; } // reselect another friendly piece
  attemptMove(D.sel, alg);
}

// Try origin->dest as the next book move. Promotions default to queen (none of
// the curated opening lines promote, but we stay safe). We compare by the
// resolved FROM/TO squares of the book move, not its SAN string, so an
// over-disambiguated book SAN (e.g. "Nge2" where only one knight can reach e2,
// which chess.js renders as "Ne2") still matches the correct origin->dest tap.
function attemptMove(from, to) {
  const expectedSan = D.moves[D.idx];
  // Resolve the book move's from/to in this exact position (a clone, untouched).
  const book = new Chess(D.chess.fen());
  let bookMv = null;
  try { bookMv = book.move(expectedSan); } catch { bookMv = null; }

  // Probe the user's tap on a CLONE so a wrong-but-legal move never desyncs the line.
  const probe = new Chess(D.chess.fen());
  let mv = null;
  try { mv = probe.move({ from, to, promotion: 'q' }); } catch { mv = null; }

  const correct = !!(mv && bookMv && mv.from === bookMv.from && mv.to === bookMv.to);
  if (correct) {
    D.chess.move({ from, to, promotion: 'q' });
    D.idx++;
    renderBoard({ from, to });
    showWhy(D.idx - 1); // explain the move the user just found
    flash(true, `${expectedSan}, correct`);
    setTimeout(advance, 1200);
  } else {
    D.perfect = false;
    D.sel = null;
    renderBoard();
    flash(false, mv ? `${mv.san} isn't the book move. The line plays ${expectedSan}.` : `Not a legal move there. The book move is ${expectedSan}.`);
    // Reveal: play the correct move so the user sees it, then continue.
    setTimeout(() => {
      const m = D.chess.move(D.moves[D.idx]);
      D.idx++;
      renderBoard(m ? { from: m.from, to: m.to } : null);
      showWhy(D.idx - 1); // explain the correct move now that it's revealed
      setTimeout(advance, 1100);
    }, 1100);
  }
}

function flash(ok, msg) {
  $('op-feedback').textContent = msg;
  $('op-feedback').className = 'op-feedback ' + (ok ? 'ok' : 'bad');
  updateProgress();
}

function finishLine() {
  // SRS update on completion.
  const store = load();
  const next = review(cardFor(store, D.line.id), D.perfect);
  store.cards[D.line.id] = next;
  save(store);
  renderComplete(next);
}

// ============================================================================
// COMPLETE
// ============================================================================
function renderComplete(card) {
  show('op-complete');
  $('op-complete-h').textContent = D.perfect ? 'Line complete, clean recall' : 'Line complete';
  $('op-complete-line').textContent = `${D.opening.name}, ${D.line.name}`;
  $('op-complete-idea').textContent = D.line.idea || '';
  $('op-complete-coach').textContent = coachLine(D.perfect, card);
  const next = pickNextSummary(D.opening, D.line);
  const actions = $('op-complete-actions');
  actions.innerHTML =
    `<button class="btn primary" id="op-next" type="button">${next ? 'Next line →' : 'Drill again →'}</button>` +
    `<button class="btn ghost" id="op-back" type="button">Back to openings</button>`;
  $('op-next').addEventListener('click', () => startDrill(D.opening.id));
  $('op-back').addEventListener('click', () => renderHub());
}

// Deterministic encouraging line (no AI, no randomness in the message).
function coachLine(perfect, card) {
  if (perfect && card.box >= 4) return 'Locked in. This line is well into long-term memory, it will only resurface occasionally now.';
  if (perfect) return 'Clean recall. We pushed this line further out; keep showing up and it becomes automatic.';
  if (card.lapses >= 2) return 'This one keeps slipping, that is exactly the line worth drilling. We reset it so you see it again soon.';
  return 'Good rep. The miss is logged, so this line comes back sooner until it sticks.';
}

function pickNextSummary(opening, justDone) {
  const store = load();
  const ids = (opening.lines || []).map((l) => l.id);
  const next = pickNext(ids, store.cards);
  return next && next !== justDone.id ? next : (ids.length > 1 ? next : null);
}

// ============================================================================
// BOOT
// ============================================================================
function wireBoard() {
  $('op-board').addEventListener('click', (e) => {
    const sq = e.target.closest('.square');
    if (sq && sq.dataset.square) onBoardTap(sq.dataset.square);
  });
}

wireBoard();
$('op-quit').addEventListener('click', () => renderHub());
renderHub();
