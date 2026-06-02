// ============================================================================
// SECTION 11 — Result box
// ============================================================================
import { Chess } from './lib.js';
import {
  DEFAULT_PUZZLE, TRAINING_COMPONENTS, MOTIF_LABELS,
  MAX_CP_LOSS_FOR_SUCCESS, STOCKFISH_MULTIPV, STOCKFISH_DEPTH,
} from './config.js';
import { state } from './state.js';
import { $, appendCoachMessage, clearCoachLog, setInlineStatus } from './dom.js';
import { orientationFor, buildPositionSummary, analyzePosition } from './engine.js';
import { renderBoard, renderTitleAndMeta } from './board.js';
import { renderFilterTabs, renderCategoryTabs, getCurrentPuzzle } from './queue.js';
import { startThinkingGate } from './gate.js';
import { puzzleAccuracy, setAttemptComponent } from './grade.js';

export function pickHeadline(grade, repeated, accuracy) {
  if (repeated && grade.tier === 'outside') return 'Same move as in your game, same mistake.';
  // A "top 5" move that hemorrhaged more than MAX_CP_LOSS_FOR_SUCCESS counts
  // as a fail regardless of tier. Use the same gate for the headline so we
  // never say "Solved" when the centipawn budget was blown.
  const userMovesAll = state.attemptHistory.filter((h) => h.mover === 'user');
  const anyBigCpLoss = userMovesAll.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  const failed = grade.tier === 'outside' || anyBigCpLoss;
  // Multi-move success: use accuracy-tiered headline (only if not failed).
  if (!failed && accuracy != null) {
    if (userMovesAll.length > 1) {
      if (accuracy >= 95) return 'Excellent. Puzzle solved cleanly.';
      if (accuracy >= 85) return 'Strong. Puzzle solved.';
      if (accuracy >= 70) return 'Solved, with room to sharpen.';
      return 'Solved, but loose in places.';
    }
  }
  if (failed && anyBigCpLoss && grade.tier !== 'outside') {
    // Top-5 but blew the cp budget — explicit phrasing rather than "Mistake".
    return 'Not solved. Cost too many centipawns.';
  }
  return ({
    best: 'Best move.',
    good: 'Strong choice.',
    warn: 'Inaccuracy.',
    mistake: 'Mistake (still in top 5).',
    outside: 'Wrong move.',
  })[grade.tier] || 'Move played.';
}
export function pickBody(grade, played, accuracy) {
  if (!grade) return '';
  // Body is intentionally terse. The headline carries the verdict, the
  // comparison table below shows per-move ranks visually, and the AI review
  // gives the explanation. The body just adds one fact: the accuracy.
  if (accuracy != null) return `Puzzle accuracy: ${accuracy}%.`;
  if (grade.tier === 'outside') return `${played?.san || ''} wasn't in the engine's top 5.`;
  if (grade.tier === 'best') return `${played?.san || ''} matches the engine's top choice.`;
  if (grade.cpLoss != null) return `${played?.san || ''} loses about ${grade.cpLoss} centipawns.`;
  return '';
}
export function showResult(grade, played) {
  if (!grade) return;
  const puzzle = getCurrentPuzzle();
  // "Repeated" only makes sense if the played move is the user's FIRST move
  // of this attempt — only then does comparing against the puzzle's original
  // game move make sense. On move 2 or 3 the position is completely different.
  const userMovesSoFar = state.attemptHistory.filter((h) => h.mover === 'user').length;
  const isFirstUserMove = userMovesSoFar === 1;
  const repeated = isFirstUserMove && puzzle && puzzle.userMoveSan && played && played.san === puzzle.userMoveSan;
  const accuracy = puzzleAccuracy();

  // A "top 5" move that hemorrhaged more than MAX_CP_LOSS_FOR_SUCCESS counts
  // as a fail, not a pass — same rule that the move-flow gate uses.
  const userMovesForResult = state.attemptHistory.filter((h) => h.mover === 'user');
  const anyBigCpLossResult = userMovesForResult.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  let tier;
  if (grade.tier === 'outside' || anyBigCpLossResult) tier = 'fail';
  else if (accuracy != null && accuracy < 70) tier = 'warn';
  else tier = 'pass';

  const result = $('result');
  result.classList.remove('hidden', 'pass', 'warn', 'fail');
  result.classList.add(tier);
  $('result-headline').textContent = pickHeadline(grade, repeated, accuracy);
  $('result-body').textContent = pickBody(grade, played, accuracy);

  // Spec-02 motif chip — gated by the same earned-reveal predicate as the
  // engine column on the comparison table, so it never appears on an unsolved
  // board. Surfaces the tag once the user has either solved the puzzle within
  // budget OR failed it 3+ times this session. Before v0.7 the motif lived
  // only inside the Filters → Theme submenu and was effectively invisible.
  const motifChip = $('result-motif');
  motifChip.classList.add('hidden');
  if (puzzle && puzzle.motif) {
    const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
    const anyBigCpLossR = userMoves.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
    const lastGradeR = userMoves[userMoves.length - 1]?.grade;
    const solvedR = lastGradeR && lastGradeR.tier !== 'outside' && !anyBigCpLossR;
    const sessionFailsR = state.sessionFailures[puzzle.id] || 0;
    const engineRevealedR = solvedR || sessionFailsR >= 3;
    if (engineRevealedR && puzzle.motif !== 'none-tactical') {
      motifChip.innerHTML = `<span class="label">Theme:</span> ${MOTIF_LABELS[puzzle.motif] || puzzle.motif}`;
      motifChip.classList.remove('hidden');
    }
  }

  // Post-puzzle component picker (Deep mode only). Renders the 7-button row
  // and pre-selects whatever the user has previously tagged this puzzle as.
  // Idempotent: tapping a different pill overwrites the tag.
  const compRow = $('result-components');
  // Clear any previously-rendered pills (keep the label div, which is the
  // first child). This guards against stale buttons accumulating across
  // puzzles when the result panel is re-rendered.
  while (compRow.children.length > 1) compRow.removeChild(compRow.lastChild);
  if (state.mode === 'deep' && puzzle) {
    const tagged = state.attempts[puzzle.id]?.lastComponent || null;
    for (const c of TRAINING_COMPONENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'component-pill' + (tagged === c ? ' active' : '');
      btn.textContent = c;
      btn.dataset.component = c;
      btn.addEventListener('click', () => {
        setAttemptComponent(c);
        for (const sibling of compRow.querySelectorAll('.component-pill')) {
          sibling.classList.toggle('active', sibling.dataset.component === c);
        }
      });
      compRow.appendChild(btn);
    }
    compRow.classList.remove('hidden');
  } else {
    compRow.classList.add('hidden');
  }

  // The repeat-note is now redundant when the headline already says "same move
  // — same mistake." We only show it for nuance: when the user got the puzzle
  // RIGHT and we want to acknowledge that the original game move was different.
  const repeatEl = $('result-repeat');
  if (puzzle && puzzle.userMoveSan && isFirstUserMove && !repeated && tier !== 'fail') {
    // User passed move 1 with a different move than the game's mistake — worth noting.
    repeatEl.textContent = `In your actual game you played ${puzzle.userMoveSan} here.`;
    repeatEl.classList.remove('hidden');
  } else {
    repeatEl.classList.add('hidden');
  }
}

// ============================================================================
// SECTION 12 — Reset / load
// ============================================================================
export function resetPuzzleStateAndRender(opts) {
  const keepGate = !!(opts && opts.keepGate);
  // Soft reset: keep the coach review + result panel + comparison visible so
  // the player can re-practise the same puzzle with the lesson still on
  // screen. Only the board returns to start.
  const keepReview = !!(opts && opts.keepReview);
  const puzzle = getCurrentPuzzle();
  if (!puzzle) {
    // Empty state: no puzzles match the current mode/filter combination.
    state.chess = new Chess(DEFAULT_PUZZLE.fen);
    state.orientation = orientationFor(DEFAULT_PUZZLE);
    state.positionSummary = buildPositionSummary(DEFAULT_PUZZLE.fen);
    state.engineLines = [];
    state.lastMove = null;
    state.userMovesMade = 0;
    state.attemptHistory = [];
    state.engineLineFromStart = null;          // v0.13 — reset on new puzzle
    state.wrongMoveSnapshot = null;
    state.phase = 'empty';
    $('side-to-move-title').textContent = state.mode === 'deep'
      ? 'No Deep puzzles in this filter.'
      : 'No Drill puzzles available yet.';
    $('repeat-badge').classList.add('hidden');
    $('puzzle-meta').classList.remove('hidden');
    $('puzzle-meta').textContent = state.mode === 'drill'
      ? 'Drill mode shows puzzles you have already attempted, or inaccuracies. Solve some in Deep first.'
      : 'Try switching to Drill mode, or change the severity filter, or ingest more games.';
    $('result').classList.add('hidden');
    $('next-btn').classList.remove('hidden');
    $('ai-review-btn').classList.add('hidden');
    $('gate-card').classList.add('hidden');
    setInlineStatus('');
    clearCoachLog();
    renderFilterTabs(); renderCategoryTabs(); renderBoard();
    return;
  }
  state.chess = new Chess(puzzle.fen);
  state.orientation = orientationFor(puzzle);
  state.positionSummary = buildPositionSummary(puzzle.fen);
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];
  state.lastMove = null;
  state.userMovesMade = 0;
  state.attemptHistory = [];
  state.engineLineFromStart = null;            // v0.13 — reset on new puzzle
  state.wrongMoveSnapshot = null;
  state.pendingWrongMove = null;    // v0.23
  state.annotations = [];
  state.correctSquares = null;      // v0.23
  state.viewHistory = [];
  state.viewIndex = null;
  const sfBtn = $('show-followup-btn');
  if (sfBtn) sfBtn.classList.add('hidden');
  // Show piece: reset shownPiece on a brand-new puzzle (the 50% cap should not
  // carry forward). On soft-reset/keepReview attempts the user is repeating
  // the same puzzle to practise, so we still reset shownPiece — they get a
  // fresh attempt with the per-turn hint available again.
  state.shownPiece = false;
  state.pieceHintSquare = null;
  $('show-piece-btn').disabled = false;
  state.phase = 'idle';
  state.engineLines = [];
  // Stale post-resolution UI (comparison table, nav arrows) must be cleared
  // even on soft reset — leaving them visible during a new attempt let stale
  // click handlers jump the board back to an older FEN, which manifested as
  // "pieces went back to their original position after castling".
  $('comparison').classList.add('hidden');
  $('nav-arrows').classList.add('hidden');
  if (!keepReview) {
    $('result').classList.add('hidden');
    $('result-repeat').classList.add('hidden');
  }
  // Next puzzle is always visible (covers both "skip" and "move on").
  $('next-btn').classList.remove('hidden');
  if (!keepReview) {
    $('ai-review-btn').classList.add('hidden');
  }
  $('gate-card').classList.add('hidden');
  if (!keepReview) clearCoachLog();
  renderTitleAndMeta(); renderFilterTabs(); renderCategoryTabs(); renderBoard();
  if (state.engineReady) {
    setInlineStatus(`Computing top ${STOCKFISH_MULTIPV} lines…`);
    analyzePosition(state.chess.fen(), STOCKFISH_DEPTH).then(() => {
      state.positionSummary = buildPositionSummary(state.chess.fen());
      setInlineStatus('');
      // Choose phase: drill / review / keep-gate go straight to playing; deep
      // (fresh puzzle) opens the CCTO gate.
      if (state.reviewPuzzleId || state.mode === 'drill' || keepGate) {
        state.phase = 'playing';
      } else {
        state.phase = 'thinking';
        startThinkingGate();
      }
      renderBoard(); // re-render so .locked cursor clears once phase is 'playing'
    }).catch((err) => setInlineStatus('Engine error: ' + err.message, 'error'));
  }
}
