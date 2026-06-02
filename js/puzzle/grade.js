// ============================================================================
// SECTION 10 — Grading + move flow + wrong-move punishment
// ============================================================================
import {
  MAX_CP_LOSS_FOR_SUCCESS, MAX_USER_MOVES_PER_PUZZLE, PUNISHMENT_PLIES,
  STOCKFISH_DEPTH_FOLLOW, STORAGE_KEY_SESSION,
} from './config.js';
import { state } from './state.js';
import { $, appendCoachMessage, setInlineStatus } from './dom.js';
import { saveAttempts } from './storage.js';
import { analyzePosition, normalizeEval, buildPositionSummary } from './engine.js';
import { renderBoard, renderTitleAndMeta } from './board.js';
import { renderFilterTabs, renderCategoryTabs, isSolved, getCurrentPuzzle } from './queue.js';
// runtime deps — called inside function bodies only; live bindings handle the cycles
import { showResult } from './result.js';
import { buildViewHistory, updateNavLabel, renderComparison, annotateForViewIndex } from './review.js';
import { fireCoachExplanation } from './coach.js';

export function gradeMove(userUci) {
  const userKey = userUci.slice(0, 4);
  const idx = state.engineLines.findIndex((l) => l.uci.slice(0, 4) === userKey);
  if (idx === -1) return { rank: null, tier: 'outside', cpLoss: null };
  const bestEval = normalizeEval(state.engineLines[0].eval);
  const userEval = normalizeEval(state.engineLines[idx].eval);
  const cpLoss = Math.max(0, bestEval - userEval);
  // Thresholds aligned with Lichess game-review conventions:
  //   < 50cp loss   = good (top engine moves, no annotation)
  //   50-99cp loss  = inaccuracy (?!)
  //   100-199cp     = mistake (?)
  //   200+cp        = blunder (??)
  // Previously this app used 30/80 which was stricter than Lichess.
  if (idx === 0) return { rank: 1, tier: 'best', cpLoss: 0 };
  if (cpLoss < 50) return { rank: idx + 1, tier: 'good', cpLoss };
  if (cpLoss < 100) return { rank: idx + 1, tier: 'warn', cpLoss };
  return { rank: idx + 1, tier: 'mistake', cpLoss };
}

export function snapshotForRewind() {
  // Snapshot we can restore to retry from before a wrong move.
  return {
    fen: state.chess.fen(),
    attemptHistory: state.attemptHistory.slice(),
    userMovesMade: state.userMovesMade,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    engineLines: state.engineLines.slice(),
  };
}

export async function commitAndEvaluate(move) {
  const fenBefore = state.chess.fen();
  const preWrongSnapshot = snapshotForRewind();

  const played = state.chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
  state.lastMove = { from: move.from, to: move.to };
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];

  // Clear right-click annotations once the player commits a move — they belong
  // to the thinking phase, not the post-move state.
  state.annotations = [];
  // Clear the piece hint after the move is made (the hint stays once-per-puzzle
  // for scoring, but the visual cue goes away after the move).
  state.pieceHintSquare = null;

  const userUci = move.from + move.to + (move.promotion || '');
  const grade = gradeMove(userUci);
  // v0.13 (Spec 05 §"Per-puzzle multi-move review — corrected"): capture the
  // engine's full intended line from the START on the first user decision,
  // and per-step engine PV + before/after evals on every user move. Used by
  // the rewritten review prompt to compare whole-user-line vs whole-engine-
  // line. All data is already in state.engineLines from the existing MultiPV
  // pass — no extra Stockfish.
  const evalToCp = (ev) => {
    if (!ev) return null;
    if (typeof ev.cp === 'number') return ev.cp;
    if (typeof ev.mate === 'number') return ev.mate > 0 ? 10000 : -10000;
    return null;
  };
  if (state.userMovesMade === 0 && state.engineLines[0]) {
    // First user decision — snapshot the engine's whole line as ground truth
    // for the line-vs-line comparison. Captured BEFORE the user move so the
    // PV reflects "what the engine would have played from the puzzle start".
    state.engineLineFromStart = {
      pvSan: Array.isArray(state.engineLines[0].pvSan) ? state.engineLines[0].pvSan.slice(0, 6) : [],
      endEvalCp: evalToCp(state.engineLines[0].eval),
    };
  }
  state.userMovesMade++;
  // Capture the engine's preferred move AT THIS DECISION POINT for the
  // post-resolution comparison view + the AI review prompt's per-step trace.
  const engineBestAtPoint = state.engineLines[0]
    ? {
        san: state.engineLines[0].san,
        uci: state.engineLines[0].uci,
        pvSan: Array.isArray(state.engineLines[0].pvSan) ? state.engineLines[0].pvSan.slice(0, 6) : [],
      }
    : null;
  const evalBeforeCp = state.engineLines[0] ? evalToCp(state.engineLines[0].eval) : null;
  // userEvalAfterCp = evalBeforeCp − cpLoss, from the user's perspective.
  // grade.cpLoss is null for the engine's #1 move (loss = 0 vs best), so
  // default to 0 in that case. When evalBeforeCp is unknown, keep both null.
  const cpLossUser = (grade && typeof grade.cpLoss === 'number') ? grade.cpLoss : 0;
  const userEvalAfterCp = (evalBeforeCp != null) ? (evalBeforeCp - cpLossUser) : null;
  state.attemptHistory.push({
    mover: 'user', fenBefore, san: played.san, uci: userUci, grade,
    engineBestAtPoint,
    evalBeforeCp,
    userEvalAfterCp,
    ply: state.attemptHistory.length,
  });
  renderTitleAndMeta();
  renderBoard();
  // Live comparison — shows the "You played" column from move 1, with engine
  // and original-game columns hidden until the puzzle resolves.
  renderComparison({ live: true });

  // Continue conditions: a top-5 move keeps the puzzle going UP TO the move
  // cap, BUT only if it doesn't give up more than MAX_CP_LOSS_FOR_SUCCESS
  // centipawns. A #2 that loses 500cp (e.g. hanging a piece) is treated as
  // a wrong move, not a passable continuation.
  const inTop5 = grade.rank !== null;
  const cpLossOK = (grade.cpLoss || 0) <= MAX_CP_LOSS_FOR_SUCCESS;
  const passesGate = inTop5 && cpLossOK;
  if (passesGate && state.userMovesMade < MAX_USER_MOVES_PER_PUZZLE) {
    await playEngineResponseAndRearm();
    return;
  }

  if (passesGate) {
    // Move cap reached, all moves in top 5 AND within cp-loss budget.
    await finishPuzzle({ grade, played });
    return;
  }

  // v0.23 — wrong move: show a non-intrusive notification and gate the engine
  // continuation behind "Show Follow-up →". Board stays at the failed-move
  // position until the user taps the button (Task 4).
  state.wrongMoveSnapshot = preWrongSnapshot;
  state.punishmentPliesPlayed = 0;
  state.phase = 'punishment';
  state.pendingWrongMove = { grade, played };
  setInlineStatus('Not the sharpest move — tap Show Follow-up to see why.', 'thinking');
  setTimeout(() => { if (state.pendingWrongMove) setInlineStatus(''); }, 3000);
  const sfBtn = $('show-followup-btn');
  if (sfBtn) { sfBtn.classList.remove('hidden'); sfBtn.disabled = false; }
}

export async function playEngineResponseAndRearm() {
  setInlineStatus('Engine thinking…', 'thinking');
  try {
    await analyzePosition(state.chess.fen(), STOCKFISH_DEPTH_FOLLOW);
  } catch (err) { setInlineStatus('Engine error: ' + err.message, 'error'); return; }
  if (!state.engineLines.length) { await finishPuzzle({ grade: { tier: 'best', rank: 1, cpLoss: 0 }, played: null, terminal: 'engine_no_moves' }); return; }
  const eng = state.engineLines[0];
  const engineFenBefore = state.chess.fen();
  const engObj = state.chess.move({ from: eng.uci.slice(0,2), to: eng.uci.slice(2,4), promotion: eng.uci.slice(4,5) || undefined });
  state.lastMove = { from: eng.uci.slice(0,2), to: eng.uci.slice(2,4) };
  state.attemptHistory.push({ mover: 'engine', fenBefore: engineFenBefore, san: engObj ? engObj.san : eng.san, uci: eng.uci, ply: state.attemptHistory.length });
  renderTitleAndMeta(); renderBoard();
  // v0.7: the per-move "Move N: <san> ✓  ·  engine replied <san>" chatter that
  // used to fire here has been removed. The coach log now contains only coach
  // turns and Jorge's typed messages — no auto-generated mid-solve noise. The
  // engine's reply is already visible on the board itself (lastMove highlight
  // + the piece in its new square), so the SAN was redundant duplication too.
  setInlineStatus('Computing top 5 lines…');
  try { await analyzePosition(state.chess.fen(), STOCKFISH_DEPTH_FOLLOW); }
  catch (err) { setInlineStatus('Engine error: ' + err.message, 'error'); return; }
  setInlineStatus('');
  state.positionSummary = buildPositionSummary(state.chess.fen());
  state.phase = 'playing';
  // Re-arm the Show piece button for the new user turn. The state.shownPiece
  // flag stays sticky (for the 50% accuracy cap), but the button itself goes
  // active again so the player can ask for a hint on this fresh decision.
  state.pieceHintSquare = null;
  $('show-piece-btn').disabled = false;
}

export async function runPunishment(initialGrade, initialPlayed) {
  // Play PUNISHMENT_PLIES plies of engine-vs-engine continuation so the user
  // sees the consequence of their wrong move. Each ply: re-analyse and play
  // line 1. The puzzle is locked during this time (phase = punishment).
  for (let i = 0; i < PUNISHMENT_PLIES; i++) {
    setInlineStatus(`Engine playing out the line (${i + 1}/${PUNISHMENT_PLIES})…`, 'thinking');
    try {
      await analyzePosition(state.chess.fen(), STOCKFISH_DEPTH_FOLLOW);
    } catch (err) { break; }
    if (!state.engineLines.length) break;
    const line = state.engineLines[0];
    const fenBefore = state.chess.fen();
    const obj = state.chess.move({ from: line.uci.slice(0,2), to: line.uci.slice(2,4), promotion: line.uci.slice(4,5) || undefined });
    if (!obj) break;
    state.lastMove = { from: line.uci.slice(0,2), to: line.uci.slice(2,4) };
    state.attemptHistory.push({ mover: 'punishment', fenBefore, san: obj.san, uci: line.uci, ply: state.attemptHistory.length });
    state.punishmentPliesPlayed++;
    renderBoard();
    // small pause so the user can see each move
    await new Promise((r) => setTimeout(r, 700));
  }
  setInlineStatus('');
  // RESTORE the analysis of the original (pre-wrong-move) position so the
  // coach explanation gets the right ground truth. Without this, state.engineLines
  // would still be the analysis of the LAST punishment position and Claude
  // would confabulate moves that have nothing to do with the player's mistake.
  state.positionSummary = buildPositionSummary(state.wrongMoveSnapshot.fen);
  state.engineLines = state.wrongMoveSnapshot.engineLines.slice();
  await finishPuzzle({ grade: initialGrade, played: initialPlayed, terminal: 'wrong_move' });
}

export async function finishPuzzle({ grade, played, terminal }) {
  state.phase = 'resolved';
  setInlineStatus('');
  showResult(grade, played);
  recordAttempt(grade);
  renderFilterTabs();
  renderCategoryTabs();
  // Build navigation history + show arrows. Render move-by-move comparison.
  state.viewHistory = buildViewHistory();
  state.viewIndex = null;
  $('nav-arrows').classList.remove('hidden');
  // v0.19: populate state.annotations for the final position so the correct-
  // move arrows appear immediately on resolution (without requiring the user
  // to tap ◀ ▶ or a comparison row first). annotateForViewIndex honours the
  // engineRevealed gate — green engine arrow only shown if earned.
  annotateForViewIndex();
  updateNavLabel();
  renderComparison();
  // Repaint the board with the fresh annotations. staticSig is unchanged vs
  // the showResult() render above (same FEN + locked state), so this takes the
  // soft-update path → softUpdateBoard() → renderAnnotations().
  renderBoard();
  // Cache the explanation context on the button so the handler can use it.
  $('ai-review-btn').dataset.pendingReview = JSON.stringify({
    tier: grade && grade.tier, rank: grade && grade.rank, cpLoss: grade && grade.cpLoss,
    terminal: terminal || null,
    playedSan: played ? played.san : null,
  });

  const acc = puzzleAccuracy();
  const puzzleId = getCurrentPuzzle()?.id;
  const sessionFails = state.sessionFailures[puzzleId] || 0;
  // AI review eligibility: the engine's intent stays hidden until the player
  // has earned it. They earn it by (a) solving the puzzle, or (b) failing
  // it 3+ times in this session. Auto-reveal only fires on case (b).
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const anyBigCpLoss = userMoves.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  const solved = grade && grade.tier !== 'outside' && !anyBigCpLoss;
  const reviewEarned = solved || sessionFails >= 3;
  if (reviewEarned) {
    $('ai-review-btn').classList.remove('hidden');
    $('ai-review-btn').disabled = false;
  } else {
    $('ai-review-btn').classList.add('hidden');
  }

  const shouldAutoReveal = !solved && sessionFails >= 3;
  if (shouldAutoReveal) {
    appendCoachMessage('system', `Failed ${sessionFails} times this session. Showing the answer now.`);
    $('ai-review-btn').classList.add('hidden');
    fireCoachExplanation({ grade, played, terminal }).catch((err) => {
      appendCoachMessage('error', 'Auto-review error: ' + err.message);
    });
    return;
  }

  // Inline status messages — kept light and friendly, no engine hints.
  if (!solved) {
    const remaining = Math.max(0, 3 - sessionFails);
    appendCoachMessage('system', `That one didn't land. Hit Restart and have another go. ${remaining > 0 ? `${remaining} more tr${remaining === 1 ? 'y' : 'ies'} this session and I'll walk you through it.` : ''}`);
  } else if (acc != null) {
    appendCoachMessage('system', `Nice work — ${acc}% accuracy. Tap AI review for a breakdown if you want one.`);
  } else {
    appendCoachMessage('system', 'Nice work. Tap AI review for a breakdown if you want one.');
  }
}

// Accuracy 0-100 across the user moves played in this attempt.
// Per-move score: max(0, 100 - cpLoss * 0.3). Outside-top-5 moves count as 0.
// The 0.3 multiplier matches Lichess's per-move accuracy curve more closely
// than the prior 0.5 (which over-penalised small-to-mid inaccuracies).
// Average across all user moves played.
// If the "show piece" hint was used, the final score is capped at 50%.
export function puzzleAccuracy() {
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user' && h.grade);
  if (!userMoves.length) return null;
  let sum = 0;
  for (const m of userMoves) {
    const g = m.grade;
    if (g.rank === null) { sum += 0; continue; }
    const cpLoss = g.cpLoss || 0;
    sum += Math.max(0, 100 - cpLoss * 0.3);
  }
  let acc = Math.round(sum / userMoves.length);
  if (state.shownPiece) acc = Math.min(acc, 50);
  return acc;
}

export function recordAttempt(grade) {
  const puzzle = getCurrentPuzzle();
  if (!puzzle) return;
  const cur = state.attempts[puzzle.id] || { attempts: 0, failedAttempts: 0, solved: false, attemptLog: [] };
  if (!cur.attemptLog) cur.attemptLog = []; // back-compat for old records
  cur.attempts = (cur.attempts || 0) + 1;
  cur.lastGrade = grade.tier;
  cur.lastAt = new Date().toISOString();
  if (!cur.firstGrade) cur.firstGrade = grade.tier;
  if (state.shownPiece) cur.shownPieceUsed = true;
  // "Solved" means every user move stayed within engine top 5 AND no single
  // move gave up more than MAX_CP_LOSS_FOR_SUCCESS. A blunder that happens
  // to be ranked #2-#5 (e.g. losing a piece in a tactical sequence) still
  // counts as a failure.
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const anyBigCpLoss = userMoves.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  const isSuccess = grade.tier !== 'outside' && !anyBigCpLoss;
  const accuracy = puzzleAccuracy();
  if (isSuccess) {
    cur.solved = true;
    if (typeof cur.firstAccuracy !== 'number' && accuracy !== null) cur.firstAccuracy = accuracy;
    if (accuracy !== null) cur.lastAccuracy = accuracy;
  } else {
    cur.failedAttempts = (cur.failedAttempts || 0) + 1;
    // Per-session counter — drives reveal mode independent of historical fails.
    state.sessionFailures[puzzle.id] = (state.sessionFailures[puzzle.id] || 0) + 1;
  }
  // Capture this attempt's move sequence so future reviews can spot patterns.
  const userMoveLog = state.attemptHistory
    .filter((h) => h.mover === 'user' && h.grade)
    .map((h) => ({
      san: h.san,
      rank: h.grade.rank,           // null if outside top 5
      cpLoss: h.grade.cpLoss,
      engineBestSan: h.engineBestAtPoint ? h.engineBestAtPoint.san : null,
    }));
  // Capture #2 (Spec 04 §"Required captures", v0.7): per-attempt mode +
  // gateCompleted are captured at the moment of attempt resolution. `component`
  // starts null and is filled by setAttemptComponent() when the user taps a
  // component pill on the post-puzzle reflection row (Deep mode only — Drill
  // skips reflection per coaching-style.md). These three fields unlock the
  // high-fidelity component tiers in Insights once enough data accrues.
  cur.attemptLog.push({
    at: new Date().toISOString(),
    outcome: isSuccess ? 'solved' : 'failed',
    accuracy: accuracy != null ? accuracy : null,
    shownPiece: !!state.shownPiece,
    userMoves: userMoveLog,
    mode: state.mode,                                 // 'deep' | 'drill'
    gateCompleted: state.mode === 'deep' && state.gateUnlocked === true,
    component: null,                                  // set later via setAttemptComponent
  });
  // Cap the log at the last 10 attempts to keep storage bounded.
  if (cur.attemptLog.length > 10) cur.attemptLog = cur.attemptLog.slice(-10);
  state.attempts[puzzle.id] = cur;
  saveAttempts(state.attempts);
  // v0.13 — session-mode write-back. When this attempt resolves inside a
  // Today block, recompute `done` from the count of solved ids and persist.
  // Always derive from the truth (attempts store) rather than incrementing
  // so partial re-runs / retries don't double-count.
  if (state.sessionMode) sessionModeWriteBack();
}

// Recompute the active block's `done` from solved attempts on its queueIds,
// persist to localStorage. Called after each resolved attempt. Vision blocks
// (queueIds=[]) use the normal queue, so we count solved-ids in attempts that
// belong to whatever the user just played — harmless no-op if nothing matches.
export function sessionModeWriteBack() {
  if (!state.sessionMode) return;
  let plan;
  try { plan = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || 'null'); } catch { plan = null; }
  if (!plan || !Array.isArray(plan.blocks)) return;
  const block = plan.blocks[state.sessionMode.blockIdx];
  if (!block || block.id !== state.sessionMode.blockId) return; // plan changed under us
  const ids = Array.isArray(block.ids) ? block.ids : [];
  if (!ids.length) return; // vision-style block: no per-id progress
  // P0 fix (hotfix/r1.2): count only puzzles solved DURING this session
  // (last solve at/after the plan's createdAt), not lifetime solves.
  const since = (plan.createdAt ? Date.parse(plan.createdAt) : 0) || 0;
  block.done = ids.filter((id) => { const a = state.attempts[id]; return !!(a && a.solved && (Date.parse(a.lastAt) || 0) >= since); }).length;
  try { localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(plan)); } catch {}
}

// Tag the just-finished attempt with the training component the student
// believes the puzzle was about. Called from the result-panel component
// picker (Deep mode). Writes to the LAST attemptLog entry and to a rollup
// field on the puzzle's attempt record. Idempotent — re-tapping just
// overwrites with the new choice.
export function setAttemptComponent(componentName) {
  const puzzle = getCurrentPuzzle();
  if (!puzzle) return;
  const cur = state.attempts[puzzle.id];
  if (!cur || !cur.attemptLog || !cur.attemptLog.length) return;
  cur.attemptLog[cur.attemptLog.length - 1].component = componentName;
  cur.lastComponent = componentName;
  state.attempts[puzzle.id] = cur;
  saveAttempts(state.attempts);
}

// v0.23 — Task 4: called when the user taps "Show Follow-up →". Clears the
// pending state, hides the button, and runs the continuation.
export async function triggerFollowup() {
  if (!state.pendingWrongMove) return;
  const { grade, played } = state.pendingWrongMove;
  state.pendingWrongMove = null;
  const sfBtn = $('show-followup-btn');
  if (sfBtn) sfBtn.classList.add('hidden');
  setInlineStatus('Engine playing out the line…', 'thinking');
  await runPunishment(grade, played);
}

// The standalone "Retry from wrong move" handler was removed. The single
// Retry button (id #reset-btn, see SECTION 14) is now the only way to rewind:
// it does a soft reset to the puzzle's starting position while keeping the
// coach review and result panel on screen.
