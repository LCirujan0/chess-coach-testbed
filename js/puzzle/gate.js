// ============================================================================
// SECTION 8 — Thinking gate (Deep mode)
// ============================================================================
import { GATE_SECONDS } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { getCurrentPuzzle } from './queue.js';
// runtime dep — renderBoard called inside event listener body
import { renderBoard } from './board.js';

export function severitySeconds() {
  const p = getCurrentPuzzle();
  if (!p) return GATE_SECONDS.default;
  return GATE_SECONDS[p.severity] || GATE_SECONDS.default;
}
export function syncGateAnswers() {
  // Read the three textarea values into state.
  state.gateAnswers.myCcto = $('gate-q1').value.trim();
  state.gateAnswers.oppCcto = $('gate-q2').value.trim();
  state.gateAnswers.plan = $('gate-q3').value.trim();
}
export function updateGateSubmit() {
  syncGateAnswers();
  const remaining = secondsRemaining();
  // Q1 and Q2 (CCTO from both sides) are required. Q3 (plan) optional.
  const answered = state.gateAnswers.myCcto.length > 0 && state.gateAnswers.oppCcto.length > 0;
  $('gate-submit').disabled = !answered || remaining > 0;
  $('gate-submit').textContent = remaining > 0
    ? `Submit and unlock (${remaining}s)`
    : (answered ? 'Submit and unlock the board' : 'Fill in your CCTO and opponent\'s CCTO first');
}
export function secondsRemaining() {
  return Math.max(0, severitySeconds() - Math.floor((Date.now() - state.gateStartedAt) / 1000));
}
export function tickGateTimer() {
  const rem = secondsRemaining();
  $('gate-timer').textContent = rem > 0 ? `⏱ Sit with it: ${rem}s remaining` : '✓ Minimum thinking time done. Answer the questions when ready.';
  updateGateSubmit();
  if (rem === 0 && state.gateInterval) {
    clearInterval(state.gateInterval);
    state.gateInterval = null;
  }
}
export function startThinkingGate() {
  if (state.mode !== 'deep' || state.reviewPuzzleId) {
    // Drill or review skips the gate.
    state.phase = 'playing';
    $('gate-card').classList.add('hidden');
    return;
  }
  state.phase = 'thinking';
  state.gateAnswers = { myCcto: '', oppCcto: '', plan: '' };
  state.gateStartedAt = Date.now();
  state.gateUnlocked = false;
  $('gate-q1').value = '';
  $('gate-q2').value = '';
  $('gate-q3').value = '';
  $('gate-card').classList.remove('hidden');
  tickGateTimer();
  if (state.gateInterval) clearInterval(state.gateInterval);
  state.gateInterval = setInterval(tickGateTimer, 1000);
}
// Re-check the submit button each time the student types into a CCTO textarea.
['gate-q1', 'gate-q2', 'gate-q3'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', updateGateSubmit);
});
$('gate-submit')?.addEventListener('click', async () => {
  syncGateAnswers();
  state.gateUnlocked = true;
  state.phase = 'playing';
  if (state.gateInterval) { clearInterval(state.gateInterval); state.gateInterval = null; }
  $('gate-card').classList.add('hidden');
  renderBoard(); // re-render so square locked-cursor goes away
  // v0.7: the auto-fired pre-move CCTO coach feedback used to land here. It's
  // been removed for two reasons: (1) it was an auto-generated message mid-solve,
  // which violates Jorge's "coach panel = coach + Jorge only" rule from v0.6
  // validation; (2) it injected the full engine top-5 lines into its system
  // prompt to "validate against engine truth", which is exactly the no-spoiler
  // class of leak the P1 fix in this release closes (`Brief: ...`). If we want
  // CCTO feedback back, it must be SOCRATIC, opt-in (button-triggered), and
  // grounded only in POSITION SUMMARY — never engine lines. See
  // `docs/learnings.md` v0.7 entry for the rationale.
});
