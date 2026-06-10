// ============================================================================
// js/board-vision/tracker.js — Spec 14 hide-the-board sequence tracker.
// ----------------------------------------------------------------------------
// Procedural (no dataset): start from a small set of sparse base positions,
// play `level` random LEGAL moves via chess.js, then describe each move by
// distance/shape (never algebraic — that gives the answer away) and ask one
// verification question, all derived + graded from chess.js game state. The
// board renders through the canonical js/board-static.js with a pieces-hidden
// state during the question.
// ============================================================================
import { Chess } from '/js/vendor/chess-1.4.0.js';
import { algToRC, rcToAlg, shuffle } from './generators.js';

export const TRACKER_LEVELS = 6;
export const TRACKER_REPS = 5;
export const TRACKER_PASS = 0.8;
export const trackerShowMs = (level) => Math.max(2200, 4500 - (level - 1) * 400); // shortens per level

// Sparse, legal base positions (validated at load; invalid ones are dropped).
const RAW_BASES = [
  '4k3/8/4n3/8/3B4/8/4R3/4K3 w - - 0 1',
  '6k1/5ppp/8/8/8/5N2/5PPP/6K1 w - - 0 1',
  '2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1',
  '4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1',
  '3qk3/8/8/8/8/8/3Q4/3K4 w - - 0 1',
  '5rk1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  '2b1k3/8/8/8/4N3/8/8/2B1K3 w - - 0 1',
  '1r2k3/p4ppp/8/8/8/8/P4PPP/1R2K3 w - - 0 1',
];
const BASES = RAW_BASES.filter((f) => { try { const c = new Chess(f); return !c.isGameOver(); } catch { return false; } });

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[randInt(a.length)];
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

function dirWord(dr, dc) {
  const v = dr < 0 ? 'up' : dr > 0 ? 'down' : '';
  const h = dc < 0 ? 'left' : dc > 0 ? 'right' : '';
  return [v, h].filter(Boolean).join('-');
}
function knightVerbal(dr, dc) {
  const v = `${Math.abs(dr)} ${dr < 0 ? 'up' : 'down'}`, h = `${Math.abs(dc)} ${dc < 0 ? 'left' : 'right'}`;
  return Math.abs(dr) >= Math.abs(dc) ? `${v}, ${h}` : `${h}, ${v}`;
}
// Directional arrow glyph for the visual move panel (knights → net direction).
const ARROWS = { '-1,0': '↑', '1,0': '↓', '0,-1': '←', '0,1': '→', '-1,-1': '↖', '-1,1': '↗', '1,-1': '↙', '1,1': '↘' };
function sgn(n) { return n < 0 ? -1 : n > 0 ? 1 : 0; }
function arrowFor(from, to) {
  const A = algToRC(from), B = algToRC(to);
  return ARROWS[`${sgn(B.row - A.row)},${sgn(B.col - A.col)}`] || '•';
}
// Concise label for the visual row (no destination algebraic).
function labelFor(piece, from, to) {
  const A = algToRC(from), B = algToRC(to);
  const dr = B.row - A.row, dc = B.col - A.col;
  if (piece === 'n') return knightVerbal(dr, dc);
  const dist = Math.max(Math.abs(dr), Math.abs(dc));
  return `${dist} ${dirWord(dr, dc)}`;
}
function descMove(piece, from, to) {
  const A = algToRC(from), B = algToRC(to);
  const dr = B.row - A.row, dc = B.col - A.col;
  if (piece === 'n') return `the knight hops ${knightVerbal(dr, dc)}`;
  const dist = Math.max(Math.abs(dr), Math.abs(dc));
  const verb = (piece === 'k' || piece === 'p') ? 'steps' : 'slides';
  return `the ${NAME[piece]} ${verb} ${dist} square${dist === 1 ? '' : 's'} ${dirWord(dr, dc)}`;
}

// Distractor squares ±1/±2 from `alg`, excluding given squares + off-board.
function nearSquares(alg, exclude, n) {
  const { row, col } = algToRC(alg); const ex = new Set(exclude); const pool = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if (!dr && !dc) continue; const r = row + dr, c = col + dc; if (!inB(r, c)) continue;
    const s = rcToAlg(r, c); if (!ex.has(s)) pool.push(s);
  }
  return shuffle(pool).slice(0, n);
}

function pieceCount(chess, color) {
  let n = 0; for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color) n++;
  return n;
}

function buildQuestion(chess, moves) {
  const last = moves[moves.length - 1];
  const captures = moves.filter((m) => m.captured);
  const types = ['where', 'check', 'count'];
  if (captures.length) types.push('captured');
  const type = pick(types);

  if (type === 'where') {
    const options = shuffle([last.to, ...nearSquares(last.to, [last.to, last.from], 3)]);
    return { type, mode: 'tap', prompt: 'Tap the square the last piece landed on.', options, answer: last.to };
  }
  if (type === 'check') {
    const side = chess.turn() === 'w' ? 'White' : 'Black';
    return { type, mode: 'choice', prompt: `Is ${side} in check?`, options: ['Yes', 'No'], answer: chess.inCheck() ? 'Yes' : 'No' };
  }
  if (type === 'count') {
    const color = pick(['w', 'b']); const name = color === 'w' ? 'White' : 'Black';
    const n = pieceCount(chess, color);
    const opts = new Set([n]); while (opts.size < 4) { const d = n + (randInt(5) - 2); if (d >= 1) opts.add(d); }
    return { type, mode: 'choice', prompt: `How many ${name} pieces are on the board?`, options: shuffle([...opts].map(String)), answer: String(n) };
  }
  // captured
  const cap = pick(captures).captured;
  const opts = new Set([NAME[cap]]); const others = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
  while (opts.size < 4) opts.add(pick(others));
  return { type, mode: 'choice', prompt: 'Which piece did the moving side capture?', options: shuffle([...opts]), answer: NAME[cap] };
}

export function genTracker(level) {
  const n = Math.max(1, Math.min(TRACKER_LEVELS, level || 1));
  for (let attempt = 0; attempt < 60; attempt++) {
    const startFen = pick(BASES);
    const chess = new Chess(startFen);
    const moves = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      // Prefer "clean" moves to describe: no castling/promotion.
      let legal = chess.moves({ verbose: true }).filter((m) => !m.san.includes('O-O') && !m.promotion);
      if (!legal.length) legal = chess.moves({ verbose: true });
      if (!legal.length) { ok = false; break; }
      const mv = pick(legal);
      chess.move(mv);
      moves.push({ piece: mv.piece, color: mv.color, from: mv.from, to: mv.to, san: mv.san, captured: mv.captured || null, desc: descMove(mv.piece, mv.from, mv.to), arrow: arrowFor(mv.from, mv.to), label: labelFor(mv.piece, mv.from, mv.to) });
    }
    if (!ok || moves.length < n) continue;
    return { level: n, startFen, finalFen: chess.fen(), moves, question: buildQuestion(chess, moves), showMs: trackerShowMs(n) };
  }
  return null; // could not build (extremely rare)
}
