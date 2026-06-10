// ============================================================================
// js/board-vision/generators.js. Spec 14 foundational drills (pure, no DOM).
// ----------------------------------------------------------------------------
// Three procedurally-generated board-sight drills. Each generator returns a
// self-contained question object; the grader is plain equality. No engine, no
// network, no DOM, fully node-testable (see the invariant harness in QA).
//
// Geometry convention (matches js/board-static.js parsePlacement): row 0 = the
// 8th rank (a8), col 0 = the a-file. So rcToAlg(0,0) === 'a8', rcToAlg(7,7) === 'h1'.
// ============================================================================

export const REPS = { coord: 10, knight: 8, walk: 6 };
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

// ----- geometry helpers (from design-explorations/board-vision.html §08) -----
export function rcToAlg(row, col) { return String.fromCharCode(97 + col) + (8 - row); }
export function algToRC(alg) { return { col: alg.charCodeAt(0) - 97, row: 8 - parseInt(alg[1], 10) }; }
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

export function knightMoves(row, col) {
  const d = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  return d.map(([dr, dc]) => [row + dr, col + dc]).filter(([r, c]) => inB(r, c));
}

// Build a FEN placement with a single piece on `alg` (rest empty).
export function fenOnePiece(alg, pieceChar) {
  const { row, col } = algToRC(alg);
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let s = '';
    for (let c = 0; c < 8; c++) s += (r === row && c === col) ? pieceChar : '1';
    rows.push(s.replace(/1+/g, (m) => String(m.length)));
  }
  return rows.join('/') + ' w - - 0 1';
}

// Verbal direction text for a (dr, dc) delta. row decreases upward.
function vertWord(dr) { return dr < 0 ? 'up' : 'down'; }
function horizWord(dc) { return dc < 0 ? 'left' : 'right'; }
function plural(n) { return n === 1 ? '' : 's'; }

// ----- Drill 1: Coordinate Snap -----
export function genCoord() {
  const answer = rcToAlg(randInt(8), randInt(8));
  return { drill: 'coord', prompt: 'Tap ' + answer, board: EMPTY_FEN, options: null, answer };
}

// ----- Drill 2: Knight Vision -----
export function genKnight() {
  const sr = randInt(8), sc = randInt(8);
  const origin = rcToAlg(sr, sc);
  const targets = knightMoves(sr, sc).map(([r, c]) => rcToAlg(r, c));
  const answer = pick(targets);
  const targetSet = new Set(targets);
  // Distractors: squares within Chebyshev distance 2 of the source that are
  // NOT knight-reachable and not the source itself.
  const pool = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if (dr === 0 && dc === 0) continue;
    const r = sr + dr, c = sc + dc;
    if (!inB(r, c)) continue;
    const alg = rcToAlg(r, c);
    if (targetSet.has(alg)) continue;  // never a real knight square
    pool.push(alg);
  }
  shuffle(pool);
  const distractors = pool.slice(0, 3);
  const options = shuffle([answer, ...distractors]);
  return { drill: 'knight', prompt: 'Tap the square the knight can reach.', board: fenOnePiece(origin, 'N'), origin, targets, options, answer };
}

// ----- Drill 3: Piece Walk -----
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// chainLen = number of moves to visualise (2 default; walk levels pass 3 or 4
// for the deeper rungs, v0.81 owner ask: "more levels").
export function genWalk(chainLen = 2) {
  const piece = pick(['R', 'B', 'N']);
  const n = Math.max(2, Math.min(4, chainLen | 0));
  // Resample whole chains until every step stays on the board.
  for (let attempt = 0; attempt < 300; attempt++) {
    const sr = randInt(8), sc = randInt(8);
    const cells = [[sr, sc]];
    const descs = [];
    let ok = true;
    let lastDir = null;
    for (let step = 0; step < n; step++) {
      const [r, c] = cells[cells.length - 1];
      if (piece === 'N') {
        const t = knightMoves(r, c);
        if (!t.length) { ok = false; break; }
        const m = pick(t);
        cells.push(m);
        descs.push(step === 0 ? null : knightVerbal(m[0] - r, m[1] - c));
      } else {
        const dirs = piece === 'R' ? ROOK_DIRS : BISHOP_DIRS;
        const maxD = piece === 'R' ? 5 : 4;
        const choices = lastDir ? dirs.filter((d) => !(d[0] === lastDir[0] && d[1] === lastDir[1])) : dirs;
        const d = pick(choices), dist = 2 + randInt(maxD - 1);
        const m = [r + d[0] * dist, c + d[1] * dist];
        if (!inB(m[0], m[1])) { ok = false; break; }
        cells.push(m); lastDir = d;
        descs.push(step === 0 ? null : slideVerbal(d, dist));
      }
    }
    if (!ok) continue;
    const algs = cells.map(([r, c]) => rcToAlg(r, c));
    const landing = algs[algs.length - 1];
    // landing must be distinct from every earlier square (a clean question).
    if (new Set(algs).size !== algs.length) continue;
    const distractors = walkDistractors(cells[n][0], cells[n][1], algs);
    if (distractors.length < 3) continue;
    const options = shuffle([landing, ...distractors]);
    const pieceName = { R: 'rook', B: 'bishop', N: 'knight' }[piece];
    const stepWord = piece === 'N' ? 'Hop' : 'Move';
    const parts = [`The ${pieceName} starts on ${algs[0]}.`];
    for (let s = 1; s <= n; s++) {
      parts.push(`${stepWord} ${s}: ${s === 1 ? (piece === 'N' ? 'to ' + algs[1] : 'slides to ' + algs[1]) : descs[s - 1]}.`);
    }
    parts.push('Where does it land?');
    const moves = [];
    for (let s = 0; s < n; s++) moves.push({ from: algs[s], to: algs[s + 1] });
    return { drill: 'walk', piece, start: algs[0], landing, moves, prompt: parts.join(' '), board: fenOnePiece(algs[0], piece), origin: algs[0], options, answer: landing };
  }
  // Fallback (extremely rare): a trivial in-bounds rook walk from d4.
  return { drill: 'walk', piece: 'R', start: 'd4', landing: 'f6', moves: [{ from: 'd4', to: 'd6' }, { from: 'd6', to: 'f6' }], prompt: 'The rook starts on d4. Move 1: slides to d6. Move 2: slides 2 squares right. Where does it land?', board: fenOnePiece('d4', 'R'), origin: 'd4', options: shuffle(['f6', 'e6', 'g6', 'f5']), answer: 'f6' };
}

function slideVerbal(dir, dist) {
  const [dr, dc] = dir;
  let where;
  if (dr === 0) where = horizWord(dc);
  else if (dc === 0) where = vertWord(dr);
  else where = vertWord(dr) + '-' + horizWord(dc);
  return `slides ${dist} square${plural(dist)} ${where}`;
}
function knightVerbal(dr, dc) {
  const v = `${Math.abs(dr)} ${vertWord(dr)}`;
  const h = `${Math.abs(dc)} ${horizWord(dc)}`;
  // Lead with the longer leg of the L for natural phrasing.
  return Math.abs(dr) >= Math.abs(dc) ? `${v}, ${h}` : `${h}, ${v}`;
}

// 3 distractor squares ±1/±2 rank/file from the landing, excluding the given
// squares and off-board. Returns up to 3 (fewer only near a corner).
function walkDistractors(lr, lc, exclude) {
  const ex = new Set(exclude);
  const pool = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if (dr === 0 && dc === 0) continue;
    const r = lr + dr, c = lc + dc;
    if (!inB(r, c)) continue;
    const alg = rcToAlg(r, c);
    if (ex.has(alg)) continue;
    pool.push(alg);
  }
  shuffle(pool);
  return pool.slice(0, 3);
}

// ----- shared -----
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = randInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export function grade(question, tap) { return tap === question.answer; }
