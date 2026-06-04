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
import { bestMoveAnswerText } from './review.js';
import { renderPending, clearPending } from './pending.js';

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
  const userMovesArr = state.attemptHistory.filter((h) => h.mover === 'user');
  const isFirstUserMove = userMovesArr.length === 1;
  const repeated = isFirstUserMove && puzzle && puzzle.userMoveSan && played && played.san === puzzle.userMoveSan;
  const accuracy = puzzleAccuracy();

  // A "top 5" move that hemorrhaged more than MAX_CP_LOSS_FOR_SUCCESS counts
  // as a fail, not a pass — same rule the move-flow gate uses.
  const anyBigCpLoss = userMovesArr.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  let tier;
  if (grade.tier === 'outside' || anyBigCpLoss) tier = 'fail';
  else if (accuracy != null && accuracy < 70) tier = 'warn';
  else tier = 'pass';
  const solved = tier !== 'fail';

  // §30.0: recordAttempt has already run (finishPuzzle calls it first), so this
  // count INCLUDES the just-resolved attempt. The reveal opens on the 3rd fail
  // OR the quiet escape (state.revealForced) OR a solve.
  const puzzleId = puzzle?.id;
  const sessionFails = state.sessionFailures[puzzleId] || 0;
  const triesLeft = Math.max(0, 3 - sessionFails);
  const revealed = solved || sessionFails >= 3 || state.revealForced;

  // SAN of the player's first move + the engine's best at that decision.
  const firstUser = userMovesArr[0] || null;
  const userSan = firstUser ? firstUser.san : (played ? played.san : null);
  const bestSan = firstUser && firstUser.engineBestAtPoint ? firstUser.engineBestAtPoint.san : null;

  const result = $('result');
  clearPending();   // §31 — leave the calm pre-move face before painting a verdict
  result.classList.remove('hidden', 'pass', 'warn', 'fail', 'pending');
  result.classList.add(tier);

  // --- Verdict banner (binary, §29.1) ---
  $('verdict-icon').textContent = solved ? '\u2713' : '\u2715';
  $('verdict-word').textContent = solved ? 'Solved' : 'Not solved';

  // --- Attempt pips (§29.2) — only on the fail track ---
  const pipsEl = $('result-pips');
  if (!solved) {
    pipsEl.classList.remove('hidden');
    let pips = '';
    for (let i = 0; i < 3; i++) pips += `<span class="pip${i < sessionFails ? ' spent' : ''}"></span>`;
    pipsEl.innerHTML = pips;
  } else {
    pipsEl.classList.add('hidden');
    pipsEl.innerHTML = '';
  }

  // --- Sub-line (quiet nuance) ---
  const sub = $('result-subline');
  if (solved) {
    if (accuracy != null && userMovesArr.length > 1) sub.textContent = `Solved \u00b7 ${accuracy}% accuracy`;
    else if (bestSan) sub.textContent = `Best move \u00b7 ${bestSan}`;
    else sub.textContent = 'Solved';
    sub.classList.remove('hidden');
  } else if (revealed) {
    sub.textContent = "That wasn't the move.";
    sub.classList.remove('hidden');
  } else {
    sub.classList.add('hidden');
  }

  // --- Nudge (TRYING only) ---
  const nudge = $('result-nudge');
  if (!solved && !revealed) {
    nudge.textContent = triesLeft > 1 ? 'Try once or twice more.' : 'One try left.';
    nudge.classList.remove('hidden');
  } else {
    nudge.classList.add('hidden');
  }

  // --- One-line contrast (§29.3) — only once the answer is earned ---
  const contrast = $('result-contrast');
  if ((revealed || solved) && bestSan) {
    if (solved && userSan === bestSan) {
      contrast.innerHTML = `You found it \u00b7 <span class="c-best">${escapeResult(bestSan)}</span>`;
    } else {
      contrast.innerHTML = `You <span class="c-you">${escapeResult(userSan || '\u2014')}</span> \u00b7 Best <span class="c-best">${escapeResult(bestSan)}</span>`;
    }
    contrast.classList.remove('hidden');
  } else {
    contrast.classList.add('hidden');
  }

  // --- Best line at the stop point (§30.3 + US-13, v0.55a) ---
  // The "You X · Best Y" contrast line above already names the best FIRST
  // move, so the old "The best move was Y." sentence here was redundant (it
  // duplicated the contrast). Instead, when the answer is earned on a miss,
  // show the engine's CONTINUATION from the first decision (the principal
  // variation) so the player sees the whole line, not just the first move.
  // Data comes from the existing MultiPV snapshot (state.engineLineFromStart /
  // firstUser.engineBestAtPoint.pvSan) — no extra engine call. Gated to the
  // earned reveal, so it never spoils during retries.
  const answerEl = $('result-answer');
  if (!solved && revealed) {
    const line = bestLineSans();
    if (line.length > 1) {
      answerEl.innerHTML = `<span class="answer-label">Best line</span> <span class="answer-line">${escapeResult(line.join(' '))}</span>`;
    } else if (line.length === 1) {
      // Only the first ply is known — show it rather than nothing, and flag in
      // the markup that the continuation isn't stored yet (US-13 partial data).
      answerEl.innerHTML = `<span class="answer-label">Best line</span> <span class="answer-line">${escapeResult(line[0])}</span>`;
    } else if (bestSan) {
      answerEl.innerHTML = `<span class="answer-label">Best line</span> <span class="answer-line">${escapeResult(bestSan)}</span>`;
    } else {
      answerEl.textContent = '';
    }
    answerEl.classList.toggle('hidden', !answerEl.textContent && !answerEl.children.length);
  } else {
    answerEl.classList.add('hidden');
  }

  // --- Card actions: one dominant action per state, but "Try again" is ALWAYS
  // available in every post-move state (§53). Compact icon buttons:
  //   • TRYING   — dominant Try again (refresh) · secondary Next (forward)
  //   • SOLVED   — dominant Next (forward)      · secondary Try again (refresh)
  //   • REVEALED — dominant Next (forward)      · secondary Try again (refresh)
  // The old behaviour hid the secondary on solved, leaving no retry affordance.
  const primary = $('card-primary');
  const secondary = $('card-secondary');
  const escape = $('card-showanswer');
  // Both actions get an icon; the data-action drives the click handler in boot.
  if (solved) {
    setBtn(primary, 'next', 'Next puzzle'); primary.dataset.action = 'next';
    setBtn(secondary, 'retry', 'Try again'); secondary.dataset.action = 'tryagain';
    secondary.classList.remove('hidden');   // §53 — retry always surfaced on solved
    escape.classList.add('hidden');
  } else if (revealed) {
    // STOP / ANSWER — the answer is shown; Next is dominant, Try again secondary.
    setBtn(primary, 'next', 'Next puzzle'); primary.dataset.action = 'next';
    setBtn(secondary, 'retry', 'Try again'); secondary.dataset.action = 'tryagain';
    secondary.classList.remove('hidden');   // §53 — retry always surfaced when revealed
    escape.classList.add('hidden');
  } else {
    // TRYING — send them back to think; the answer stays hidden.
    setBtn(primary, 'retry', 'Try again'); primary.dataset.action = 'tryagain';
    setBtn(secondary, 'next', 'Next puzzle'); secondary.dataset.action = 'next';
    secondary.classList.remove('hidden');
    // Quiet escape from the 2nd miss (§30.6 #3).
    escape.classList.toggle('hidden', sessionFails < 2);
  }
  // AI review label gets the lightbulb icon (visibility/disabled is set by
  // applyResolutionUI's earned-reveal gate; we only paint the label here).
  setBtn($('ai-review-btn'), 'bulb', 'AI review');

  // --- Motif chip (gated by the earned reveal) ---
  const motifChip = $('result-motif');
  motifChip.classList.add('hidden');
  if (puzzle && puzzle.motif && revealed && puzzle.motif !== 'none-tactical') {
    motifChip.innerHTML = `<span class="label">Theme:</span> ${MOTIF_LABELS[puzzle.motif] || puzzle.motif}`;
    motifChip.classList.remove('hidden');
  }

  // --- Post-puzzle component picker (Deep mode only) ---
  const compRow = $('result-components');
  while (compRow.children.length > 1) compRow.removeChild(compRow.lastChild);
  if (state.mode === 'deep' && puzzle && revealed) {
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

  // Repeat note (nuance, solved-and-different-from-game only).
  const repeatEl = $('result-repeat');
  if (puzzle && puzzle.userMoveSan && isFirstUserMove && !repeated && solved) {
    repeatEl.textContent = `In your actual game you played ${puzzle.userMoveSan} here.`;
    repeatEl.classList.remove('hidden');
  } else {
    repeatEl.classList.add('hidden');
  }
}

// §53 — inline action-button icons in the app's nav-icon idiom (viewBox 0 0 24
// 24, stroke=currentColor, ~16px) so they inherit the button's text colour and
// disabled/hover states. Returned as a label builder: icon + text in one go.
const ICON = {
  // circular refresh / rotate — "Try again"
  retry: '<svg class="btn-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/></svg>',
  // lightbulb — "AI review"
  bulb: '<svg class="btn-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.1V16h6v-.4c0-.8.4-1.5 1-2.1A6 6 0 0 0 12 3Z"/></svg>',
  // forward arrow — "Next puzzle"
  next: '<svg class="btn-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
};
// Paint an icon + label into a button. Uses textContent for the label (no HTML
// injection) and an SVG span for the glyph.
function setBtn(btn, iconKey, label) {
  if (!btn) return;
  btn.innerHTML = (ICON[iconKey] || '') + '<span class="btn-label"></span>';
  const lbl = btn.querySelector('.btn-label');
  if (lbl) lbl.textContent = label;
}

// US-13 (v0.55a) — the engine's best LINE (principal variation) from the FIRST
// user decision, in SAN. Uses the snapshot captured at move time
// (state.engineLineFromStart.pvSan) and falls back to the first user move's
// stored PV, then to the single best move. Capped at 6 plies (the depth the
// snapshot stores). Returns [] when nothing is available.
function bestLineSans() {
  const fromStart = state.engineLineFromStart && Array.isArray(state.engineLineFromStart.pvSan)
    ? state.engineLineFromStart.pvSan : null;
  if (fromStart && fromStart.length) return fromStart.filter(Boolean).slice(0, 6);
  const firstUser = state.attemptHistory.find((h) => h.mover === 'user');
  const pv = firstUser && firstUser.engineBestAtPoint && Array.isArray(firstUser.engineBestAtPoint.pvSan)
    ? firstUser.engineBestAtPoint.pvSan : null;
  if (pv && pv.length) return pv.filter(Boolean).slice(0, 6);
  const bestSan = firstUser && firstUser.engineBestAtPoint ? firstUser.engineBestAtPoint.san : null;
  return bestSan ? [bestSan] : [];
}

// Minimal HTML escape for SAN strings rendered via innerHTML in the card.
function escapeResult(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
    $('result').classList.remove('pending');
    $('controls').classList.remove('hidden');
    $('next-btn').classList.remove('hidden');
    $('ai-review-btn').classList.add('hidden');
    $('gate-card').classList.add('hidden');
    state.revealForced = false;
    state.revealOverlay = null;
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
  state.revealForced = false;       // §30 — fresh attempt, no forced reveal
  state.revealOverlay = null;       // §30.3 — clear any stop-point auto-play
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
  // §30.2 — the result card is a post-attempt surface; a fresh OR retried
  // attempt always clears it and restores the play controls (Hint/Restart/Next).
  $('result').classList.add('hidden');
  $('result-repeat').classList.add('hidden');
  $('controls').classList.remove('hidden');
  // Next puzzle is always visible (covers both "skip" and "move on").
  $('next-btn').classList.remove('hidden');
  if (!keepReview) {
    $('ai-review-btn').classList.add('hidden');
  }
  $('gate-card').classList.add('hidden');
  if (!keepReview) clearCoachLog();
  renderTitleAndMeta(); renderFilterTabs(); renderCategoryTabs(); renderBoard();
  // §31 — the feedback card occupies its slot from a PENDING state so the board
  // never shifts when a verdict later appears.
  renderPending();
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
      renderPending(); // §31 — refresh PENDING once phase settles (gate→playing, idle→playing)
    }).catch((err) => setInlineStatus('Engine error: ' + err.message, 'error'));
  }
}
