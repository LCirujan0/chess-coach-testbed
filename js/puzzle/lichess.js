// ============================================================================
// SECTION 17 — Lichess supply loader (Spec 17 — themed-drilling cross-source
// supply). Lazy-fetch + in-memory cache of the bundled Lichess puzzle pack;
// normalise entries into the puzzle-record shape the queue/board expect; expose
// topUpMotif() so startThemeDrill() can fill a thin own-game pool to target.
//
// ISOLATION: this module is only ever reached from the themed-drill top-up path
// and the source==='lichess' grading branch. The own-game (mistake) solve +
// MultiPV grade path never imports or runs any of this.
// ============================================================================
import { Chess } from './lib.js';
import {
  LICHESS_PACK_URL, LICHESS_RATING_WINDOW, MOTIFS,
  STORAGE_KEY_LICHESS_SOLVED,
} from './config.js';

// In-memory cache of the raw pack + the lazy fetch promise (so concurrent
// top-ups share one network request). Never persisted to localStorage.
let _packPromise = null;
let _pack = null;

// Lazy-fetch the bundled pack once; cache the parsed array in memory. Returns
// [] (never throws) when the asset is absent or malformed so a missing pack
// degrades to "own-game only" rather than breaking the drill (Spec 17 §risks).
export async function loadLichessPack() {
  if (_pack) return _pack;
  if (_packPromise) return _packPromise;
  _packPromise = (async () => {
    try {
      const res = await fetch(LICHESS_PACK_URL, { cache: 'force-cache' });
      if (!res.ok) { console.warn('lichess pack fetch failed:', res.status); return []; }
      const data = await res.json();
      _pack = Array.isArray(data) ? data : [];
      return _pack;
    } catch (err) {
      console.warn('lichess pack load error:', err && err.message);
      _pack = [];
      return _pack;
    }
  })();
  return _packPromise;
}

// ---- Solved-id ledger (fast exclusion set for the top-up draw) -------------
// Solved Lichess puzzles are ALSO recorded in the existing attempts ledger
// under their namespaced `lichess:<id>` id (via the normal recordAttempt path);
// this dedicated set is a lean, queryable mirror so the loader doesn't have to
// scan the whole attempts object. Swept by the chess-coach-* clear.
export function loadSolvedLichessIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LICHESS_SOLVED);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
export function markLichessSolved(packId) {
  if (!packId) return;
  try {
    const set = loadSolvedLichessIds();
    set.add(packId);
    localStorage.setItem(STORAGE_KEY_LICHESS_SOLVED, JSON.stringify(Array.from(set)));
  } catch {}
}

// ---- Move-convention adapter + normaliser ----------------------------------
// Lichess convention: `fen` is the position BEFORE the opponent's setup move;
// `moves[0]` is that setup move. The puzzle the solver sees starts AFTER
// moves[0] is applied, with the solver to move. We bake moves[0] into the
// stored FEN here so the board/orientation/render path is identical to an
// own-game puzzle (just a normal FEN with the solver to move). The remaining
// moves (the solver's line, opponent replies interleaved) are kept on
// `solutionLine` for the solution-line grader. `solverMoves` is the solver's
// own moves only (odd indices of the original line), for reference.
//
// Returns null when the entry is malformed or moves[0] is illegal (defensive —
// a bad row is skipped, never queued).
export function normalizeLichessPuzzle(entry) {
  if (!entry || !entry.id || !entry.fen || typeof entry.moves !== 'string') return null;
  const uciList = entry.moves.trim().split(/\s+/).filter(Boolean);
  if (uciList.length < 2) return null; // need at least setup + one solver move
  let chess;
  try { chess = new Chess(entry.fen); } catch { return null; }
  const setup = uciList[0];
  const setupMove = applyUci(chess, setup);
  if (!setupMove) return null; // illegal setup move → skip this entry
  const startFen = chess.fen();
  // solutionLine = everything after the setup move, in play order:
  //   [solverMove1, oppReply1, solverMove2, oppReply2, ...]
  const solutionLine = uciList.slice(1);
  return {
    id: `lichess:${entry.id}`,
    packId: `lichess:${entry.id}`,
    source: 'lichess',
    type: 'lichess',
    fen: startFen,                 // post-setup position; solver to move
    category: entry.cat || null,   // 'opening' | 'middlegame' | 'endgame'
    motif: entry.motif || null,
    rating: typeof entry.rating === 'number' ? entry.rating : null,
    solutionLine,                  // UCI moves from the solver's first move on
    // userColorName drives any "your move" copy; orient to side-to-move.
    userColorName: chess.turn() === 'w' ? 'White' : 'Black',
  };
}

// Apply a UCI string to a chess.js instance; returns the move object or null
// when illegal. Handles promotions (5-char UCI).
function applyUci(chess, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
  } catch { return null; }
}

// ---- Top-up draw ------------------------------------------------------------
// Pull up to `count` normalised Lichess puzzles for `motif`, within the rating
// window centred on `ratingCenter`, excluding ids in `excludeIds` and any
// already-solved Lichess ids. Widens the rating window in steps when the narrow
// band is thin (Spec 17 §thin-pool: widen, then queue what exists). Returns an
// array (possibly shorter than `count`, possibly empty) — never throws.
export async function topUpMotif(motif, opts) {
  const o = opts || {};
  const count = Math.max(0, o.count | 0);
  if (!count || !motif || !MOTIFS.includes(motif) || motif === 'none-tactical') return [];
  const pack = await loadLichessPack();
  if (!pack.length) return [];

  const center = (typeof o.ratingCenter === 'number') ? o.ratingCenter : null;
  const solved = loadSolvedLichessIds();
  const exclude = new Set(o.excludeIds || []);

  // Difficulty tier (owner spec 2026-06-10): bound the number of SOLVER moves
  // in the line. entry.moves = "setup s1 o1 s2 o2 ..." so solver moves =
  // ceil((total - 1) / 2). No tier passed → no length restriction.
  const minSolver = (o.difficulty && typeof o.difficulty.min === 'number') ? o.difficulty.min : 1;
  const maxSolver = (o.difficulty && typeof o.difficulty.max === 'number') ? o.difficulty.max : 99;

  // Candidate pool: same motif, in-tier, not excluded, not already solved.
  const candidates = [];
  for (const e of pack) {
    if (!e || e.motif !== motif) continue;
    const nid = `lichess:${e.id}`;
    if (solved.has(nid) || exclude.has(nid)) continue;
    if (typeof e.moves === 'string') {
      const solverMoves = Math.ceil((e.moves.trim().split(/\s+/).length - 1) / 2);
      if (solverMoves < minSolver || solverMoves > maxSolver) continue;
    }
    candidates.push(e);
  }
  if (!candidates.length) return [];

  // Rating selection: progressively widen the window until we have enough, then
  // fall back to the whole motif pool (sorted by closeness to center) so a thin
  // band still yields a full-ish drill rather than a dead end.
  let chosen;
  if (center == null) {
    chosen = candidates.slice();
    shuffle(chosen);
  } else {
    chosen = null;
    for (let mult = 1; mult <= 4 && (!chosen || chosen.length < count); mult++) {
      const win = LICHESS_RATING_WINDOW * mult;
      const band = candidates.filter((e) => typeof e.rating === 'number' && Math.abs(e.rating - center) <= win);
      if (band.length >= count || mult === 4) { chosen = band; break; }
    }
    if (!chosen || chosen.length < count) {
      // Still short — take everything, ordered by rating proximity.
      chosen = candidates.slice().sort((a, b) =>
        Math.abs((a.rating ?? center) - center) - Math.abs((b.rating ?? center) - center));
    } else {
      shuffle(chosen);
    }
  }

  const out = [];
  for (const e of chosen) {
    if (out.length >= count) break;
    const norm = normalizeLichessPuzzle(e);
    if (norm) out.push(norm);
  }
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
