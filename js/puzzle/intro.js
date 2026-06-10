// ============================================================================
// SECTION 11b. Mistake intro ("what happened in your game" → then solve)
// ----------------------------------------------------------------------------
// For own-game MISTAKE puzzles, the solve is preceded by a short intro that
// replays the move sequence the player actually played, names the move and how
// many centipawns it cost, then hands the (pre-mistake) position over to be
// solved.
//
// NO-SPOILER: the intro shows only what the player DID, their move, the real
// game continuation, the cp cost, the severity. It NEVER shows the engine's
// better move, eval lines, or motif. The answer stays hidden until the player
// solves the position themselves (the existing thinking-gate + solve flow).
// ============================================================================
import { Chess } from './lib.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { renderBoard } from './board.js';
import { getCurrentPuzzle } from './queue.js';
import { buildPositionSummary } from './engine.js';
import { startThinkingGate } from './gate.js';
import { renderCpBar } from './grade.js';
import { renderPending } from './pending.js';

const SEV_LABEL = { inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'blunder' };
const REPLAY_STEP_MS = 620;
let replaying = false;

// Show the intro only for a FRESH own-game mistake puzzle that has a recorded
// continuation. Retries (keepReview/keepGate), review mode, the "Solve it"
// re-entry (skipIntro), and non-mistake sources (Lichess supply, etc.) skip
// straight to the solve.
export function shouldShowIntro(puzzle, opts) {
  if (!puzzle) return false;
  if (opts && (opts.skipIntro || opts.keepReview || opts.keepGate)) return false;
  if (state.reviewPuzzleId) return false;
  const src = puzzle.source || puzzle.type;
  const isOwnMistake = (src === 'mistake' || src == null);
  if (!isOwnMistake) return false;
  return !!puzzle.userMoveSan
    && Array.isArray(puzzle.actualContinuation)
    && puzzle.actualContinuation.length > 0;
}

export function showIntro(puzzle) {
  state.phase = 'intro';
  state.introLinesReady = false;
  $('controls').classList.add('hidden');
  $('cp-bar').classList.add('hidden');
  $('result').classList.add('hidden');
  $('gate-card').classList.add('hidden');
  $('nav-arrows').classList.add('hidden');
  const card = $('intro-card');
  if (!card) return;

  const sev = SEV_LABEL[puzzle.severity] || 'mistake';
  const moveNo = puzzle.fullmove ? `Move ${puzzle.fullmove}: ` : '';
  $('intro-move').innerHTML =
    `${escapeIntro(moveNo)}you played <span class="intro-san">${escapeIntro(puzzle.userMoveSan)}</span>`;

  const cp = (typeof puzzle.cpLoss === 'number') ? puzzle.cpLoss : null;
  const tone = (puzzle.severity === 'inaccuracy') ? 'warn' : 'bad';
  let costHtml = `<span class="intro-sev intro-sev--${tone}">${cap(sev)}</span>`;
  if (cp != null) costHtml += `<span class="intro-cp">cost ~${(cp / 100).toFixed(cp >= 100 ? 1 : 2)} pawns</span>`;
  $('intro-cost').innerHTML = costHtml;

  $('intro-analysis').textContent =
    'Replay the sequence to see what your move led to, then study the starting position and find the move you should have played.';

  const solveBtn = $('intro-solve');
  if (solveBtn) {
    solveBtn.disabled = !state.introLinesReady;
    solveBtn.textContent = state.introLinesReady ? 'Solve it from here →' : 'Preparing…';
  }
  const replayBtn = $('intro-replay');
  if (replayBtn) { replayBtn.disabled = false; replayBtn.textContent = '▶ Replay the sequence'; }

  card.classList.remove('hidden');
  resetIntroBoard(puzzle);
}

// Called from result.js once the engine lines for the solve position are ready.
export function markIntroLinesReady() {
  state.introLinesReady = true;
  const b = $('intro-solve');
  if (b) { b.disabled = false; b.textContent = 'Solve it from here →'; }
}

function resetIntroBoard(puzzle) {
  try { state.chess = new Chess(puzzle.fen); } catch {}
  state.lastMove = null;
  state.animateMove = null;
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];
  state._renderSig = null; // force a clean rebuild
  renderBoard();
}

// Replay the player's actual game continuation from the pre-mistake position,
// animating each ply. Pure presentation, never touches the attempt/grade flow.
export async function replayContinuation() {
  const puzzle = getCurrentPuzzle();
  if (!puzzle || replaying) return;
  const seq = puzzle.actualContinuation;
  if (!Array.isArray(seq) || !seq.length) return;
  replaying = true;
  const btn = $('intro-replay');
  if (btn) btn.disabled = true;
  resetIntroBoard(puzzle);
  await sleep(360);
  for (const ply of seq) {
    if (state.phase !== 'intro') break; // user advanced to solving, stop
    let m = null;
    try { m = state.chess.move(ply.san); } catch { m = null; }
    if (!m) break;
    state.lastMove = { from: m.from, to: m.to };
    state.animateMove = { from: m.from, to: m.to };
    renderBoard();
    await sleep(REPLAY_STEP_MS);
  }
  if (btn) { btn.disabled = false; btn.textContent = '↺ Replay again'; }
  replaying = false;
}

// Dismiss the intro and start the normal solve from the pre-mistake position.
// The engine lines were already computed (on puzzle.fen) during the intro, so
// no re-analysis is needed; we just restore the board + open the solve phase.
export function beginSolveFromIntro() {
  const puzzle = getCurrentPuzzle();
  if (!puzzle || !state.introLinesReady) return;
  $('intro-card').classList.add('hidden');
  resetIntroBoard(puzzle);
  state.positionSummary = buildPositionSummary(puzzle.fen);
  $('controls').classList.remove('hidden');
  $('cp-bar').classList.remove('hidden');
  renderCpBar();
  // Drill goes straight to play; Deep opens the CCTO thinking gate (the
  // "understand the position, no spoilers" step the user asked for).
  if (state.mode === 'drill') {
    state.phase = 'playing';
  } else {
    state.phase = 'thinking';
    startThinkingGate();
  }
  renderBoard();
  renderPending();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escapeIntro(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
