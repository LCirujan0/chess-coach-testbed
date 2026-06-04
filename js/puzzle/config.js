// ============================================================================
// SECTION 1 — CONFIG
// ============================================================================
// Bump APP_VERSION every meaningful change. The stamp renders in the nav
// drawer so the live Vercel deploy can be visually confirmed against the
// source.
export const APP_VERSION = 'v0.57 · unified puzzle architecture (phases 1a-3) · 2026-06-04';
// Inject the stamp lazily once the DOM is parsed.
queueMicrotask(() => { const el = document.getElementById('version-stamp'); if (el) el.textContent = APP_VERSION; });

// Piece rendering — Lichess Celtic set by Maurizio Monge (MIT licence).
// Swapped from Staunty in v0.6 for commercial headroom (CC BY-NC-SA → MIT, no
// NonCommercial clause). Spec §4 + coordination.md 2026-05-31. Bundled
// locally per Design's note (PWA must work offline); the 12 Celtic SVGs live
// at /piece/celtic/{w|b}{K|Q|R|B|N|P}.svg alongside the upstream LICENSE.
// Pieces are pre-coloured by the source set; the .square[data-c] hook is only
// kept for legacy classes that might reference colour-conditional styling.
const PIECE_SET = 'celtic';
export const PIECE_IMG = (color, type) => `/piece/${PIECE_SET}/${color}${type.toUpperCase()}.svg`;
export const PIECE_GLYPH = { p:'♟', n:'♞', b:'♝', r:'♜', q:'♛', k:'♚' };

export const STOCKFISH_DEPTH = 14;
export const STOCKFISH_DEPTH_FOLLOW = 12;
export const STOCKFISH_MULTIPV = 5;
export const MAX_USER_MOVES_PER_PUZZLE = 3;
export const DECISIVE_CP = 500;
// A move in the engine's top 5 still fails the puzzle if it gives up more
// than this many centipawns vs the best move. Catches the case where #2 or
// #3 is technically "in top 5" but loses a piece outright.
//
// v0.53 grading fix: lowered 200 -> 100 so the success ceiling lines up with
// the "mistake"-tier boundary in grade.js (good<50, warn<100, mistake>=100).
// At 200 the entire 100-199cp "mistake" band counted as solved -- a move the
// comparison labelled a Mistake still passed (root cause of "passed me even
// though I lost ~250cp": anything in 100-200 slipped through). Tying the
// ceiling to 100 means a move graded "mistake" can never be "solved". The
// 50/100 tier thresholds + 0.3 accuracy multiplier are unchanged (project
// rule). Eval clamping (DECISIVE_CP / mate->+-10000 in normalizeEval) was
// checked and does NOT compress a real ~250cp loss below the ceiling -- both
// lines carry honest cp scores at the same decision point, so
// cpLoss = bestCp - userCp is faithful; the sole bug was the ceiling value.
export const MAX_CP_LOSS_PER_MOVE = 100;   // single-move budget; segment turns red above this
export const MAX_CP_LOSS_TOTAL = 200;       // cumulative 3-move budget; exceeding this = fail

// Wrong-move punishment: engine plays X plies after a wrong move so the player
// sees the consequence on the board before the coach explains.
export const PUNISHMENT_PLIES = 3;

// Dwell time floor for Deep mode by severity (seconds).
export const GATE_SECONDS = { inaccuracy: 25, mistake: 35, blunder: 50, default: 30 };

export const TRAINING_COMPONENTS = [
  'Opening principles', 'Tactical patterns', 'Calculation', 'Piece activity',
  'Pawn structure', 'King safety', 'Endgame technique',
];

export const DEFAULT_PUZZLE = {
  id: 'default-mate-in-1',
  fen: '6k1/5ppp/8/8/8/8/5PPP/3R3K w - - 0 1',
  category: 'endgame',
  severity: 'mistake',
  brief: 'Late-game position. Material is roughly equal. White has the move.',
  source: 'Default position (mate in 1)',
  userColorName: 'White',
};

export const STORAGE_KEY_MISTAKES = 'chess-coach-mistakes-v1';
export const STORAGE_KEY_LAST_CAT = 'chess-coach-last-category-v1';
export const STORAGE_KEY_LAST_SEV = 'chess-coach-last-severity-v1';
export const STORAGE_KEY_LAST_TRIED = 'chess-coach-last-tried-v1';
export const STORAGE_KEY_LAST_MOTIF = 'chess-coach-last-motif-v1';

// Spec 02 motif vocabulary — used by the Theme filter UI and "Drill this theme".
// Must match games.html MOTIF_VOCAB exactly.
export const MOTIFS = ['pin','fork','skewer','discovered-attack','removing-defender','back-rank',
  'overload','decoy','deflection','zwischenzug','mating-net','pawn-promotion',
  'simplification','prophylaxis','pawn-structure','king-attack','none-tactical'];
export const MOTIF_LABELS = {
  'pin':'Pin', 'fork':'Fork', 'skewer':'Skewer', 'discovered-attack':'Discovered attack',
  'removing-defender':'Removing the defender', 'back-rank':'Back rank',
  'overload':'Overload', 'decoy':'Decoy', 'deflection':'Deflection',
  'zwischenzug':'Zwischenzug', 'mating-net':'Mating net',
  'pawn-promotion':'Pawn promotion', 'simplification':'Simplification',
  'prophylaxis':'Prophylaxis', 'pawn-structure':'Pawn structure',
  'king-attack':'King attack', 'none-tactical':'No clear motif',
};
export const STORAGE_KEY_ATTEMPTS = 'chess-coach-attempts-v1';

// Position exclusion thresholds. Puzzles where the starting position is
// already a forced mate (either side) or where the side to move is more than
// this many centipawns down are dropped — they don't make useful training
// because the lesson has already been decided.
export const EXCLUDE_DOWN_CP = 800;
export function isExcludedPuzzle(p) {
  const ev = p && p.engineLines && p.engineLines[0] && p.engineLines[0].eval;
  if (!ev) return false;            // unknown eval → keep (don't punish older ingests)
  if (ev.mate != null) return true; // forced mate either direction
  if (typeof ev.cp === 'number' && ev.cp < -EXCLUDE_DOWN_CP) return true;
  return false;
}
export const STORAGE_KEY_MODE = 'chess-coach-mode-v1';
export const STORAGE_KEY_RATING = 'chess-coach-user-rating-v1';
// v0.13 — Today/in-session round-trip key (written by today.html + session.html,
// read here when puzzle.html is opened with ?session=today&block=<id>).
// Shape: { date, idx, blocks: [{id, title, sub, count, mode, done, ids:[puzzleId...]}] }
export const STORAGE_KEY_SESSION = 'chess-coach-session-v1';

// Chess.com username for rating lookup. Fetched once a day, cached. The coach
// calibrates its feedback to the user's current rapid rating.
export const CHESS_COM_USERNAME = 'LCirujano';
export const DEFAULT_RATING = 1100;
export const RATING_TARGET = 1500;
export const RATING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// Board geometry consts (used by engine.js §5 and board.js §9).
// Physically lived at the top of §5 in the monolith; consolidated here with
// the rest of the static config so all modules import from one place.
export const FILES_STD = ['a','b','c','d','e','f','g','h'];
export const RANKS_STD = ['8','7','6','5','4','3','2','1'];
export const FILES_FLIP = ['h','g','f','e','d','c','b','a'];
export const RANKS_FLIP = ['1','2','3','4','5','6','7','8'];

// ============================================================================
// Unified puzzle schema (phase 1a) — additive. Canonical `type` discriminator
// shared across mistake / endgame / recognition / opening / lichess puzzle
// sources. NOTE: recognition entries already use `type` for their material
// signature (e.g. 'KPvK'), so their puzzle-type lives in `puzzleType` instead;
// the queue filter checks both (p.type || p.puzzleType).
// ============================================================================
export const PUZZLE_TYPES = ['mistake', 'endgame', 'recognition', 'opening', 'lichess'];
export const PUZZLE_TYPE_LABELS = {
  mistake: 'Mistakes',
  endgame: 'Endgames',
  recognition: 'Endgame recognition',
  opening: 'Openings',
  lichess: 'Lichess puzzles',
};
// null = no type restriction (show everything in the pool). Pages opt into a
// single type via <meta name="puzzle-type-filter">.
export const DEFAULT_PUZZLE_TYPE = null;

// ============================================================================
// Play-out + classify constants (Phase 1b)
// ============================================================================
export const PLAYOUT_DEPTH         = 9;
export const PLAYOUT_MOVE_CAP      = 50;
export const PLAYOUT_WIN_FAIL_CP   = -50;   // trainee eval below this → consecutive fail
export const PLAYOUT_WIN_PASS_CP   = 100;   // eval at move cap = pass for win lessons
export const PLAYOUT_DECISIVE_CP = 9999;   // only early-pass on forced-mate (normalizeEval mate=10000); 500 fired on move 1 in any winning endgame
export const PLAYOUT_FAIL_CONSECUTIVE = 2;  // consecutive bad evals → fail
export const PLAYOUT_DRAW_PASS_CP  = -150;  // for draw lessons at cap: still holding = pass
export const STORAGE_KEY_TAGS      = 'chess-coach-tags-v1';
