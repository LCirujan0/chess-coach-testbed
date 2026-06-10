// ============================================================================
// SECTION 1. CONFIG
// ============================================================================
// Bump APP_VERSION every meaningful change. The stamp renders in the nav
// drawer so the live Vercel deploy can be visually confirmed against the
// source. NUMBER ONLY (owner rule 2026-06-10): the what/why of each version
// lives in docs/learnings.md, never in the stamp.
export const APP_VERSION = 'v0.82';
// Inject the stamp lazily once the DOM is parsed. (Guarded so the module is
// importable under node for the qa/scripts harnesses.)
if (typeof document !== 'undefined') {
  queueMicrotask(() => { const el = document.getElementById('version-stamp'); if (el) el.textContent = APP_VERSION; });
}

// Piece rendering. Lichess Celtic set by Maurizio Monge (MIT licence).
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

// Spec 02 motif vocabulary, used by the Theme filter UI and "Drill this theme".
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

// Spec 17, themed-drilling cross-source supply (Lichess pack top-up).
// The bundled pack (data/lichess-puzzles.json, ~10.5k puzzles on the Spec 02
// 17-tag motif vocabulary, rating 800-1499). Fetched once on the first themed
// top-up, cached in memory, never written to localStorage (1.7 MB raw).
export const LICHESS_PACK_URL = '/data/lichess-puzzles.json';
// Themed drill fills to this many puzzles (own-game first, then Lichess).
export const THEME_DRILL_TARGET = 10;
// Rating window (± centred on the player's calibrated rating, Spec 01) used to
// pick supply puzzles. Widened progressively when the narrow band is thin.
export const LICHESS_RATING_WINDOW = 150;
// Solved Lichess puzzle ids (namespaced `lichess:<id>`), so the top-up skips
// puzzles the player has already cleared. Swept by the chess-coach-* clear.
export const STORAGE_KEY_LICHESS_SOLVED = 'chess-coach-lichess-solved-v1';

// Tactic-drill difficulty tiers (owner spec 2026-06-10): tier = number of
// SOLVER moves in the solution line, easy 1-move, medium 2-3, hard more than
// 3. Applies to the Lichess themed supply; own-game mistake puzzles have no
// fixed solution length, so a non-'any' tier draws library-only (every puzzle
// in the drill then genuinely matches the tier).
export const DIFFICULTY_TIERS = [
  { id: 'any',    label: 'Any difficulty', min: 1, max: 99 },
  { id: 'easy',   label: 'Easy',   min: 1, max: 1,  hint: '1-move tactics' },
  { id: 'medium', label: 'Medium', min: 2, max: 3,  hint: '2-3 move combinations' },
  { id: 'hard',   label: 'Hard',   min: 4, max: 99, hint: 'more than 3 moves deep' },
];

// Position exclusion thresholds. Puzzles where the starting position is
// already a forced mate (either side) or where the side to move is more than
// this many centipawns down are dropped, they don't make useful training
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
// v0.13. Today/in-session round-trip key (written by today.html + session.html,
// read here when puzzle.html is opened with ?session=today&block=<id>).
// Shape: { date, idx, blocks: [{id, title, sub, count, mode, done, ids:[puzzleId...]}] }
export const STORAGE_KEY_SESSION = 'chess-coach-session-v1';

// Chess.com username fallback for rating lookup, used ONLY when no synced
// username (chess-coach-username-v1) has been entered yet. Every user-facing
// surface must call getActiveChessComUsername(), never this constant directly
// (de-hardwiring, 2026-06-10 audit task 1.2).
export const CHESS_COM_USERNAME = 'LCirujano';

// The active user identity: the synced username when set, else the fallback.
// Reads lazily so a user switch applies on the next call.
export function getActiveChessComUsername() {
  try {
    const u = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY_USERNAME) : null;
    if (u && /^[a-z0-9_-]{1,64}$/i.test(u.trim())) return u.trim().toLowerCase();
  } catch { /* storage unavailable */ }
  return CHESS_COM_USERNAME.toLowerCase();
}
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
// Unified puzzle schema (phase 1a), additive. Canonical `type` discriminator
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

// ============================================================================
// Cross-device sync (v0.78), js/sync.js mirrors a subset of localStorage to
// Supabase, keyed by the user's Chess.com username. localStorage stays the
// working store; Supabase is the cross-device mirror (pull+merge on load,
// debounced push on meaningful writes). The publishable key is designed to
// ship client-side (Supabase); writes are gated by RLS on knightpath_state
// (anon: select/insert/update only, no delete). See docs/learnings.md v0.78.
// ============================================================================
export const SUPABASE_URL = 'https://gyrbbapxjqcuvcoronnt.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_llUEQtnxK0MMVkrZMdLBDQ_ROnT1T-A';
export const SUPABASE_STATE_TABLE = 'knightpath_state';
// The user's Chess.com username (lowercased), the cross-device identity key.
// Written once from the sync prompt (or a games.html ingest), then reused.
export const STORAGE_KEY_USERNAME = 'chess-coach-username-v1';
// The synced subset of chess-coach-* keys: gamification + training history.
// Deliberately EXCLUDED (local-only): filter prefs (last-category/-severity/
// -tried/-motif, mode), cached rating + rating profile/history (re-fetched
// from Chess.com on any device), game move lists + scorecards + meta (large
// blobs, re-creatable by a re-sync), ingested-games (device-local dedup),
// lichess-solved (nice-to-have, follow-up).
export const SYNC_KEYS = [
  'chess-coach-streak-v1',           // daily streak + freezes, non-negotiable
  'chess-coach-attempts-v1',         // cumulative puzzle attempt ledger (drives SRS)
  'chess-coach-mistakes-v1',         // ingested puzzles from Chess.com games
  'chess-coach-session-v1',          // today's session plan
  'chess-coach-session-complete-v1', // done-today flag (streak/done UI on device B)
  'chess-coach-daily-goal-v1',       // user-set goal tier
  'chess-coach-board-vision-v1',     // board vision ladder progress
  'chess-coach-openings-v1',         // openings SRS state
  'chess-coach-recognition-v1',      // endgame recognition results
  'chess-coach-eg-results-v1',       // endgame play-out results
  'chess-coach-tags-v1',             // puzzle motif tags
  'chess-coach-mastery-seen-v1',     // mastery "new"-chip seen markers
  'chess-coach-plan-today-v2',       // cached AI "plan today" (owner call 2026-06-10: sync it)
  'chess-coach-coach-memory-v1',     // the coach's compact per-user memory (v0.79)
  'chess-coach-profile-v1',          // onboarding profile: elo goal, time control, seriousness (v0.80)
  'chess-coach-game-scorecards-v1',  // per-game phase scores, synced so a device wipe never forces a re-ingest (v0.80)
  'chess-coach-game-meta-v1',        // per-game Chess.com enrichment, same rationale (small; move LISTS stay local)
  'chess-coach-calculation-v1',      // calculation drill levels + blitz bests + history (v0.82, spec 25)
];
// Push debounce: meaningful events (puzzle resolved, streak marked, session
// written) arrive in bursts; coalesce them into one upsert.
export const SYNC_DEBOUNCE_MS = 2500;
export const SYNC_FETCH_TIMEOUT_MS = 8000;
