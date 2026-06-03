// ============================================================================
// SECTION 11b — PENDING / in-progress feedback card (§31, v0.52)
// ============================================================================
// The feedback card occupies its slot from a "pending" state onward, so the
// board does NOT shift when a verdict appears. Before the first move there is
// no verdict: PENDING shows a calm prompt, the side to move, and an invitation
// to ask for a hint. No verdict word, no pips, no eval — nothing earned yet.
// During a multi-move puzzle (a move made but not yet resolved) it shows a
// quiet "keep going" face and lets the embedded live "You played" comparison
// show — still no answer/eval (the eval column is gated separately).
//
// This reuses the existing #result element + its sub-fields and adds ONE class
// (.result.pending) so the verdict styling (pass/warn/fail) does not apply. It
// introduces NO new localStorage key and does NOT touch the state machine in
// grade.js — it only paints the calm "before/while you move" face of the card.
import { state } from './state.js';
import { $ } from './dom.js';
import { getCurrentPuzzle } from './queue.js';
import { sideToMoveLabel } from './board.js';

// True whenever the card should show a non-verdict face: a puzzle is loaded and
// we are neither resolved nor mid-gate (the Deep CCTO gate owns the surface).
export function shouldShowPending() {
  const puzzle = getCurrentPuzzle();
  if (!puzzle) return false;
  if (state.phase === 'resolved') return false;
  if (state.phase === 'thinking') return false;   // CCTO gate owns the surface
  return true;
}

export function renderPending() {
  const result = $('result');
  if (!result) return;
  if (!shouldShowPending()) { result.classList.remove('pending'); return; }

  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const inProgress = userMoves.length > 0;   // multi-move puzzle, mid-solve

  // Reset verdict tone classes — PENDING is calm/neutral, never pass/warn/fail.
  result.classList.remove('hidden', 'pass', 'warn', 'fail');
  result.classList.add('pending');

  // Verdict row → calm prompt. No tick/cross icon, no verdict word colour.
  $('verdict-icon').textContent = '♞';          // knight glyph — neutral
  $('verdict-word').textContent = inProgress ? 'Keep going' : 'Your move';
  $('result-pips').classList.add('hidden');
  $('result-pips').innerHTML = '';

  // Sub-line: side to move (the prompt that used to live above the board).
  const sub = $('result-subline');
  let side = 'You';
  try { side = sideToMoveLabel(); } catch { side = 'You'; }
  sub.textContent = inProgress
    ? `Good, ${side.toLowerCase()} to move. Find the next move.`
    : `${side} to move. Find the best move.`;
  sub.classList.remove('hidden');

  // Nudge: a quiet invitation to get a hint (no verdict, no answer).
  const nudge = $('result-nudge');
  if (inProgress) {
    nudge.classList.add('hidden');
  } else {
    nudge.textContent = 'Stuck? Tap Hint for a nudge.';
    nudge.classList.remove('hidden');
  }

  // Everything answer/spoiler-bearing stays hidden in the pending faces.
  $('result-contrast').classList.add('hidden');
  $('result-answer').classList.add('hidden');
  $('result-motif').classList.add('hidden');
  $('result-repeat').classList.add('hidden');
  $('result-components').classList.add('hidden');

  // No card actions while pending — the play controls (Hint/Restart/Next) below
  // the board are the only affordances. Hide the result-card action row.
  $('card-primary').classList.add('hidden');
  $('card-secondary').classList.add('hidden');
  $('card-showanswer').classList.add('hidden');
  const air = $('ai-review-btn'); if (air) air.classList.add('hidden');
  const actions = $('result-actions'); if (actions) actions.classList.add('hidden');

  // The embedded comparison stays hidden until there is a move to compare;
  // once the player has moved it shows the live "You played" column (the
  // engine + eval columns remain gated by data-mode until the answer is earned).
  const cmp = $('comparison'); if (cmp && !inProgress) cmp.classList.add('hidden');
}

// Called by showResult() when a verdict is being painted, to drop the pending
// face + re-show the action row that the pending face hid.
export function clearPending() {
  const result = $('result');
  if (result) result.classList.remove('pending');
  const actions = $('result-actions'); if (actions) actions.classList.remove('hidden');
}
