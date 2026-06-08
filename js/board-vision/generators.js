// ============================================================================
// js/board-vision/generators.js — Spec 14 foundational drills (pure, no DOM).
// ----------------------------------------------------------------------------
// Three procedurally-generated board-sight drills. Each generator returns a
// self-contained question object; the grader is plain equality. No engine, no
// network, no DOM — fully node-testable (see the invariant harness in QA).
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

export function genWalk() {
  const piece = pick(['R', 'B', 'N']);
  // Resample whole chains until both moves stay on the board.
  for (let attempt = 0; attempt < 200; attempt++) {
    const sr = randInt(8), sc = randInt(8);
    let m1, m2; // [row,col] after move 1 / move 2
    let desc2, intermediate, landing;
    if (piece === 'N') {
      const t1 = knightMoves(sr, sc); if (!t1.length) continue;
      [m1] = [pick(t1)];
      const t2 = knightMoves(m1[0], m1[1]); if (!t2.length) continue;
      m2 = pick(t2);
      desc2 = knightVerbal(m2[0] - m1[0], m2[1] - m1[1]);
    } else {
      const dirs = piece === 'R' ? ROOK_DIRS : BISHOP_DIRS;
      const maxD = piece === 'R' ? 5 : 4;
      const d1 = pick(dirs), dist1 = 2 + randInt(maxD - 1);
      m1 = [sr + d1[0] * dist1, sc + d1[1] * dist1];
      if (!inB(m1[0], m1[1])) continue;
      const d2 = pick(dirs.filter((d) => !(d[0] === d1[0] && d[1] === d1[1]))), dist2 = 2 + randInt(maxD - 1);
      m2 = [m1[0] + d2[0] * dist2, m1[1] + d2[1] * dist2];
      if (!inB(m2[0], m2[1])) continue;
      desc2 = slideVerbal(d2, dist2);
    }
    intermediate = rcToAlg(m1[0], m1[1]);
    landing = rcToAlg(m2[0], m2[1]);
    const start = rcToAlg(sr, sc);
    if (landing === start || landing === intermediate) continue;
    const distractors = walkDistractors(m2[0], m2[1], [start, intermediate, landing]);
    if (distractors.length < 3) continue;
    const options = shuffle([landing, ...distractors]);
    const pieceName = { R: 'rook', B: 'bishop', N: 'knight' }[piece];
    const verb = piece === 'N' ? 'hops' : 'slides to';
    const prompt = piece === 'N'
      ? `The knight starts on ${start}. Hop 1: to ${intermediate}. Hop 2: ${desc2}. Where does it land?`
      : `The ${pieceName} starts on ${start}. Move 1: slides to ${intermediate}. Move 2: ${desc2}. Where does it land?`;
    return { drill: 'walk', piece, start, intermediate, landing, moves: [{ from: start, to: intermediate }, { from: intermediate, to: landing }], prompt, board: fenOnePiece(start, piece), origin: start, options, answer: landing };
  }
  // Fallback (extremely rare): a trivial in-bounds rook walk from d4.
  return { drill: 'walk', piece: 'R', start: 'd4', intermediate: 'd6', landing: 'f6', moves: [{ from: 'd4', to: 'd6' }, { from: 'd6', to: 'f6' }], prompt: 'The rook starts on d4. Move 1: slides to d6. Move 2: slides 2 squares right. Where does it land?', board: fenOnePiece('d4', 'R'), origin: 'd4', options: shuffle(['f6', 'e6', 'g6', 'f5']), answer: 'f6' };
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
