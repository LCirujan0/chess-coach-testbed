// ============================================================================
// SECTION 1. CONFIG
// ============================================================================

const STORAGE_KEY_MISTAKES = 'chess-coach-mistakes-v1';
const STORAGE_KEY_INGESTED_GAMES = 'chess-coach-ingested-games-v1';
const STOCKFISH_MULTIPV = 5;

// Thresholds, aligned roughly with Lichess defaults to keep the volume of
// puzzles manageable. Anything below MIN_CPLOSS_TO_RECORD is not saved.
//   inaccuracy: 50 .. 99 cp loss
//   mistake:   100 .. 199 cp loss
//   blunder:   200+ cp loss
const MIN_CPLOSS_TO_RECORD = 50;
const SEVERITY_THRESHOLDS = { inaccuracy: 100, mistake: 200 };

// Thinning rule: within any window of THINNING_WINDOW user moves, keep at most
// one non-blunder mistake (the one with the highest cpLoss). Blunders always
// pass through regardless of clustering. Stops the queue filling up with five
// near-identical puzzles from the same losing sequence.
const THINNING_WINDOW = 7;

export { STORAGE_KEY_MISTAKES, STORAGE_KEY_INGESTED_GAMES, STOCKFISH_MULTIPV, MIN_CPLOSS_TO_RECORD, SEVERITY_THRESHOLDS, THINNING_WINDOW };
