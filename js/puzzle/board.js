// ============================================================================
// SECTION 9 — Board + tap-to-move
// ============================================================================
import { Chess } from './lib.js';
import { FILES_STD, RANKS_STD, PIECE_IMG, PIECE_GLYPH } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { attemptsCount, failedCount, getCurrentPuzzle } from './queue.js';
// runtime dep — commitAndEvaluate is in grade.js; called from onSquareTap inside a function body
import { commitAndEvaluate } from './grade.js';

export function sideToMoveLabel() { return state.chess.turn() === 'w' ? 'White' : 'Black'; }
export function renderTitleAndMeta() {
  const puzzle = getCurrentPuzzle();
  if (!puzzle) { $('side-to-move-title').textContent = 'No puzzles in this filter.'; $('puzzle-meta').classList.add('hidden'); $('repeat-badge').classList.add('hidden'); const tpe = $('task-prompt'); if (tpe) tpe.classList.add('hidden'); return; }
  $('side-to-move-title').textContent = sideToMoveLabel() + ' to move.';
  // §29.4 — a plain task prompt above the board so a new player knows the goal.
  const tp = $('task-prompt');
  if (tp) { tp.textContent = 'Find the best move.'; tp.classList.remove('hidden'); }

  // Repeat badge: shown when this puzzle has prior attempts.
  const priorAttempts = attemptsCount(puzzle.id);
  const priorFailed = failedCount(puzzle.id);
  if (priorAttempts > 0) {
    const failedTxt = priorFailed === 0
      ? `↺ Repeat · ${priorAttempts} prior attempt${priorAttempts === 1 ? '' : 's'}`
      : `↺ Repeat · ${priorFailed} prior failed attempt${priorFailed === 1 ? '' : 's'}`;
    $('repeat-badge').textContent = failedTxt;
    $('repeat-badge').classList.remove('hidden');
  } else {
    $('repeat-badge').classList.add('hidden');
  }

  const meta = $('puzzle-meta');
  if (state.hasIngestedPuzzles) {
    const parts = [];
    if (state.reviewPuzzleId) parts.push('review');
    else parts.push(`puzzle ${state.queueIndex + 1} of ${state.queue.length}`);
    // Defensive em/en dash → middle-dot for legacy stored puzzle.source / brief
    // strings ingested before the no-em-dash rule landed.
    const clean = (s) => String(s).replace(/[—–]/g, '·');
    if (puzzle.source) parts.push(clean(puzzle.source));
    if (puzzle.severity) parts.push(puzzle.severity);
    meta.textContent = parts.join(' · ');
    meta.classList.remove('hidden');
  } else {
    meta.classList.add('hidden');
  }
}
// Compute the "last move to highlight" for the currently displayed position.
// Live position → state.lastMove (the most recent ply). Navigating prior
// positions via ◀ ▶ → the move that LANDED at that position
// (viewHistory[i].from/to, derived from attemptHistory). Returns null when
// there is no relevant move (e.g. starting position).
export function lastMoveForDisplay() {
  // §30.3 reveal auto-play: the transient overlay carries its own last-move.
  if (state.revealOverlay && state.viewIndex === null) return state.revealOverlay.lastMove || null;
  if (state.viewIndex !== null && state.viewHistory && state.viewHistory[state.viewIndex]) {
    const v = state.viewHistory[state.viewIndex];
    if (v && v.from && v.to) return { from: v.from, to: v.to };
    return null;   // starting position
  }
  return state.lastMove || null;
}

// Diff-based board render (v0.13 blink fix). The v0.6 fix swapped innerHTML='' +
// loop for DocumentFragment + replaceChildren — atomic but still recreates 32
// <img> tags on EVERY call. On mobile that reads as blink on tap-to-select
// because the browser repaints all 32 piece nodes every time. The fix: build
// the squares + pieces once per FEN change, then for pure UI state changes
// (selected square, legal-move markers, last-move highlight, piece hint) just
// toggle classes / swap markers on the existing square elements. Pieces only
// re-create when the position actually changes.
export function renderBoard() {
  const boardEl = $('board');
  if (!state.chess || !state.orientation) { boardEl.replaceChildren(); state._renderSig = null; return; }
  // Decide which Chess position to render — live unless ◀ ▶ navigated.
  let renderChess = state.chess;
  if (state.viewIndex !== null && state.viewHistory[state.viewIndex]) {
    try { renderChess = new Chess(state.viewHistory[state.viewIndex].fen); } catch {}
  } else if (state.revealOverlay && state.revealOverlay.fen) {
    // §30.3 — stop-point answer auto-play paints a transient position.
    try { renderChess = new Chess(state.revealOverlay.fen); } catch {}
  }
  const fen = renderChess.fen();
  const { files, ranks } = state.orientation;
  const locked = (state.phase !== 'playing' && state.phase !== 'punishment');
  // Signature of the static-board-state (pieces + orientation + lock). When
  // unchanged we skip the rebuild and do a soft-update only.
  const staticSig = fen + '|' + files.join('') + '|' + ranks.join('') + '|' + (locked ? 'L' : 'P');
  if (state._renderSig === staticSig && boardEl.querySelector('.square')) {
    softUpdateBoard();
    return;
  }
  state._renderSig = staticSig;
  // Full rebuild path — fragment swap (atomic) for the static parts; soft
  // update right after re-applies the dynamic class layer on the new nodes.
  const board = renderChess.board();
  const frag = document.createDocumentFragment();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = files[f] + ranks[r];
      const stdRank = RANKS_STD.indexOf(ranks[r]);
      const stdFile = FILES_STD.indexOf(files[f]);
      const piece = board[stdRank][stdFile];
      const sq = document.createElement('div');
      sq.className = 'square ' + (((stdRank + stdFile) % 2 === 0) ? 'light' : 'dark');
      if (locked) sq.classList.add('locked');
      sq.dataset.square = square;
      if (piece) sq.dataset.c = piece.color;
      if (r === 7) { const lbl = document.createElement('span'); lbl.className = 'coord file'; lbl.textContent = files[f]; sq.appendChild(lbl); }
      if (f === 0) { const lbl = document.createElement('span'); lbl.className = 'coord rank'; lbl.textContent = ranks[r]; sq.appendChild(lbl); }
      if (piece) {
        // Lichess Celtic bundled locally. `alt` is the unicode glyph so a
        // missing asset still shows a recognisable piece (graceful degrade).
        const img = document.createElement('img');
        img.className = 'pc-img';
        img.src = PIECE_IMG(piece.color, piece.type);
        img.alt = PIECE_GLYPH[piece.type] || (piece.color + piece.type);
        img.draggable = false;
        sq.appendChild(img);
      }
      frag.appendChild(sq);
    }
  }
  // Annotations SVG overlay sits on top of the squares.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'board-annotations';
  svg.setAttribute('class', 'board-annotations');
  svg.setAttribute('viewBox', '0 0 800 800');
  svg.setAttribute('preserveAspectRatio', 'none');
  frag.appendChild(svg);
  boardEl.replaceChildren(frag);
  // Apply the dynamic-state layer (last-move, selected, legal markers, hint).
  softUpdateBoard();
}

// Soft-update path — toggles classes + swaps legal-move markers on the
// existing 64 squares without recreating any DOM. No piece re-creation, no
// flicker on tap-to-select / navigate / hint-toggle.
export function softUpdateBoard() {
  const boardEl = $('board');
  const lastMove = lastMoveForDisplay();
  for (const sq of boardEl.querySelectorAll('.square')) {
    const square = sq.dataset.square;
    sq.classList.toggle('last-move', !!(lastMove && (lastMove.from === square || lastMove.to === square)));
    sq.classList.toggle('selected', state.selectedSquare === square);
    sq.classList.toggle('piece-hint', state.pieceHintSquare === square);
    // v0.23 — highlight the user's from/to squares when they played the engine's best.
    sq.classList.toggle('user-correct-sq', !!(state.correctSquares &&
      (state.correctSquares.from === square || state.correctSquares.to === square)));
    // Legal-move markers — remove any existing, then add fresh if applicable.
    const oldMarker = sq.querySelector('.legal-dot, .legal-ring');
    if (oldMarker) oldMarker.remove();
    const moveHere = state.legalMovesFromSelected.find((m) => m.to === square);
    if (moveHere) {
      const isCapture = moveHere.flags.includes('c') || moveHere.flags.includes('e');
      const marker = document.createElement('span');
      marker.className = isCapture ? 'legal-ring' : 'legal-dot';
      sq.appendChild(marker);
    }
  }
  renderAnnotations();
  renderMaterialBalance();
}

// ============================================================================
// §20 — Material balance indicator (FEN-only; no engine, §12-safe).
// Two rows flank the board: top = captured WHITE pieces (Black's gains),
// bottom = captured BLACK pieces (White's gains). Net advantage (+N) shows on
// the leading side's row, suppressed when level. Rows are ALWAYS flex and only
// their innerHTML changes — never style.display — so a capture can't reflow the
// board (the v0.41 #8 blink fix). Celtic SVG imgs match the board piece set.
// ============================================================================
const MB_STARTING = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const MB_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const MB_ORDER = ['q', 'r', 'b', 'n', 'p']; // high → low value

function mbDisplayFen() {
  if (state.viewIndex !== null && state.viewHistory[state.viewIndex]) return state.viewHistory[state.viewIndex].fen;
  return state.chess ? state.chess.fen() : '';
}

function mbRowHtml(color, captured, netScore) {
  let html = '';
  for (const t of MB_ORDER) {
    const n = captured[t] || 0;
    for (let i = 0; i < n; i++) html += `<img class="mb-piece" src="${PIECE_IMG(color, t)}" alt="" draggable="false">`;
  }
  if (netScore > 0) html += `<span class="mb-score">+${netScore}</span>`;
  return html;
}

// Captured pieces + net advantage from the visible FEN only. Exported so the
// board render path can call it; safe no-op on pages lacking the material DOM.
export function renderMaterialBalance() {
  const topEl = $('material-top'); const botEl = $('material-bottom');
  if (!topEl || !botEl) return;
  const placement = (mbDisplayFen().split(' ')[0]) || '';
  const onBoard = { w: {}, b: {} };
  for (const ch of placement) {
    const lc = ch.toLowerCase();
    if (lc === 'k' || !MB_STARTING[lc]) continue; // skip kings, digits, slashes
    const c = ch === lc ? 'b' : 'w';
    onBoard[c][lc] = (onBoard[c][lc] || 0) + 1;
  }
  const capturedWhite = {}, capturedBlack = {};
  let whiteCapVal = 0, blackCapVal = 0;
  for (const t of MB_ORDER) {
    const cw = MB_STARTING[t] - (onBoard.w[t] || 0);
    const cb = MB_STARTING[t] - (onBoard.b[t] || 0);
    if (cw > 0) { capturedWhite[t] = cw; whiteCapVal += cw * MB_VALUE[t]; }
    if (cb > 0) { capturedBlack[t] = cb; blackCapVal += cb * MB_VALUE[t]; }
  }
  const whiteAdv = blackCapVal - whiteCapVal; // + = White ahead
  topEl.innerHTML = mbRowHtml('w', capturedWhite, whiteAdv < 0 ? -whiteAdv : 0);
  botEl.innerHTML = mbRowHtml('b', capturedBlack, whiteAdv > 0 ? whiteAdv : 0);
}

// ============================================================================
// SECTION 8b — Right-click annotations (arrows + circles, Chess.com-style)
// ============================================================================
const ANNO_COLOR = 'rgba(60, 130, 90, 0.85)';
export function squareToSvgCenter(square) {
  if (!state.orientation) return { x: 400, y: 400 };
  const file = square[0];
  const rank = square[1];
  const fIdx = state.orientation.files.indexOf(file);
  const rIdx = state.orientation.ranks.indexOf(rank);
  if (fIdx < 0 || rIdx < 0) return { x: 400, y: 400 };
  return { x: (fIdx + 0.5) * 100, y: (rIdx + 0.5) * 100 };
}
export function annotationEquals(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'circle') return a.square === b.square;
  return a.from === b.from && a.to === b.to;
}
export function toggleAnnotation(anno) {
  const idx = state.annotations.findIndex((a) => annotationEquals(a, anno));
  if (idx !== -1) state.annotations.splice(idx, 1);
  else state.annotations.push(anno);
}
export function clearAnnotations() {
  state.annotations = [];
  renderAnnotations();
}
export function colorToMarkerId(color) { return 'arrowhead-' + color.replace(/[^a-z0-9]/gi, ''); }
export function renderAnnotations() {
  const svg = document.getElementById('board-annotations');
  if (!svg) return;
  // Collect unique colors needed for markers.
  const colors = new Set([ANNO_COLOR]);
  for (const a of state.annotations) if (a.color) colors.add(a.color);
  let defs = '<defs>';
  for (const c of colors) {
    const id = colorToMarkerId(c);
    defs += `<marker id="${id}" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 4 2, 0 4" fill="${c}" /></marker>`;
  }
  defs += '</defs>';
  svg.innerHTML = defs;
  for (const a of state.annotations) {
    const color = a.color || ANNO_COLOR;
    if (a.type === 'circle') {
      const c = squareToSvgCenter(a.square);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', c.x);
      circle.setAttribute('cy', c.y);
      circle.setAttribute('r', 44);
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', 6);
      circle.setAttribute('fill', 'none');
      svg.appendChild(circle);
    } else if (a.type === 'arrow') {
      const f = squareToSvgCenter(a.from);
      const t = squareToSvgCenter(a.to);
      const dx = t.x - f.x;
      const dy = t.y - f.y;
      const len = Math.hypot(dx, dy) || 1;
      const shorten = 28;
      const tx = t.x - (dx / len) * shorten;
      const ty = t.y - (dy / len) * shorten;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', f.x);
      line.setAttribute('y1', f.y);
      line.setAttribute('x2', tx);
      line.setAttribute('y2', ty);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', 12);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('marker-end', `url(#${colorToMarkerId(color)})`);
      svg.appendChild(line);
    }
  }
}
export function onSquareTap(square) {
  if (state.phase !== 'playing') return;
  if (!state.engineReady) return;
  if (!state.chess) return;
  if (!state.selectedSquare) {
    const piece = state.chess.get(square);
    if (!piece || piece.color !== state.chess.turn()) return;
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard();
    return;
  }
  if (square === state.selectedSquare) { state.selectedSquare = null; state.legalMovesFromSelected = []; renderBoard(); return; }
  const here = state.chess.get(square);
  if (here && here.color === state.chess.turn()) {
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard();
    return;
  }
  const move = state.legalMovesFromSelected.find((m) => m.to === square);
  if (move) commitAndEvaluate(move);
}
