// ============================================================================
// SECTION 2 — STATE
// ============================================================================
import { DEFAULT_PUZZLE, DEFAULT_RATING } from './config.js';

export const state = {
  mode: 'deep',                       // 'deep' | 'drill'
  reviewPuzzleId: null,               // when coming from completed.html?id=…

  puzzles: [DEFAULT_PUZZLE],
  hasIngestedPuzzles: false,
  currentCategory: 'all',           // 'all' | 'opening' | 'middlegame' | 'endgame'
  currentIndex: 0,                  // legacy; queueIndex is the live cursor
  severityFilter: 'all',
  triedFilter: 'all',               // 'all' | 'tried' | 'untried'
  motifFilter: 'all',               // 'all' | one of MOTIFS | 'untagged'
  // Unified puzzle schema (phase 1a). null/'all' = no type restriction; a page
  // sets this from <meta name="puzzle-type-filter"> to scope the pool to one
  // source (e.g. 'mistake' keeps puzzle.html mistakes-only).
  typeFilter: null,                 // null | 'all' | one of PUZZLE_TYPES
  // Spec 02 — "Drill this theme" focused session. When non-null, the queue is
  // overridden with up to 10 puzzles sharing the active motif; user advances
  // through them and returns to the normal queue when the drill ends.
  drillMotif: null,                 // string | null
  drillIndex: 0,                    // position within the drill queue
  drillQueue: [],                   // Array<Mistake> for this drill session

  // v0.13 — Today/in-session round-trip (per Releases-B's contract). When the
  // user arrives via /puzzle.html?session=today&block=<id> we restrict the
  // puzzle queue to that block's `ids`, honour its `mode`, write back `done`
  // on each resolved attempt, and navigate to /session.html on completion.
  // null when not in session mode; vision blocks (ids:[]) keep this null but
  // still set sessionActiveLink for the rail UI.
  sessionMode: null,                // { blockId, blockIdx, queueIds: string[], count, mode, title }
  // Explicit randomised play queue. Rebuilt on filter/category/mode change.
  // In Deep mode it interleaves unseen + previously-failed puzzles 50/50,
  // both Fisher-Yates shuffled. In Drill mode it's a single shuffled deck.
  queue: [],
  queueIndex: 0,

  chess: null,
  orientation: null,
  selectedSquare: null,
  legalMovesFromSelected: [],
  lastMove: null,
  engineReady: false,
  engineLines: [],
  positionSummary: null,

  // Lifecycle
  phase: 'idle',                      // 'idle' | 'thinking' | 'playing' | 'punishment' | 'resolved'
  userMovesMade: 0,
  attemptHistory: [],
  // v0.13 (Spec 05) — snapshot of the engine's whole line at the FIRST user
  // decision; used by the line-vs-line review prompt. { pvSan, endEvalCp } |
  // null. Reset on each new puzzle load (resetPuzzleStateAndRender).
  engineLineFromStart: null,

  // Thinking gate (Deep mode) — CCTO format
  gateAnswers: { myCcto: '', oppCcto: '', plan: '' },
  gateStartedAt: 0,
  gateUnlocked: false,
  gateInterval: null,

  // Wrong-move handling
  wrongMoveSnapshot: null,           // { fen, attemptHistorySnapshot, userMovesMade }
  punishmentPliesPlayed: 0,
  // v0.23 — gated continuation: set when a wrong move is played, cleared when
  // the user taps "Show Follow-up". runPunishment reads this and fires.
  pendingWrongMove: null,            // { grade, played } | null

  // Coach
  coachHistory: [],
  coachSending: false,

  // Attempts ledger (persisted to localStorage — cumulative across sessions)
  attempts: {},

  // Per-session failed-attempt counter (in-memory only, resets on page load).
  // Reveal mode triggers when sessionFailures[puzzleId] >= 3, so the coach
  // doesn't auto-fire on a fresh session just because the puzzle was failed
  // before. Keyed by puzzle id.
  sessionFailures: {},

  // Right-click annotations (desktop): arrows and circle highlights, like Chess.com.
  annotations: [], // [{ type: 'arrow', from, to } | { type: 'circle', square }]

  // Rating used to calibrate the coach. Loaded from cache or Chess.com.
  userRating: DEFAULT_RATING,

  // Post-resolution navigation through the played positions.
  viewHistory: [],          // [{ fen, label, mover, san }]
  viewIndex: null,          // null = live/current; 0..N-1 = historical

  // v0.23 — squares to highlight with .user-correct-sq when the user played
  // the engine's best move. Set by annotateForViewIndex, read by softUpdateBoard.
  correctSquares: null,     // { from, to } | null

  // "Show piece" hint: highlights the FROM square of the engine's CURRENT #1
  // move (refreshed every user turn). Button re-enables each turn. If used at
  // any point during the puzzle, the final accuracy is capped at 50%.
  shownPiece: false,        // true if used on ANY turn during this attempt
  pieceHintSquare: null,    // SAN coord like 'd1' when the highlight is live

  // §30.2/§30.3 (v0.50) — result-card reveal state.
  // revealForced: the player tapped the quiet "Show me the answer" escape
  // (from the 2nd miss) — reveal the answer without waiting for the 3rd fail.
  // In-memory, resets on each puzzle load. No localStorage key (§30.0).
  revealForced: false,
  // revealOverlay: a transient board position painted by the stop-point answer
  // auto-play (§30.3). When set (and viewIndex is null) renderBoard shows this
  // FEN + lastMove instead of the live position. Cleared on nav / new puzzle.
  revealOverlay: null,      // { fen, lastMove } | null
  // Last resolved attempt context, so the escape link can re-render the reveal.
  lastResolution: null,     // { grade, played, terminal } | null
};

// CCTO method (Aagaard-style calculation discipline): Checks · Captures ·
// Threats · Optimisations. The student writes the analysis themselves in three
// open-text fields. No chips, no quick-select — the act of writing IS the
// slow-down and the reflection.
