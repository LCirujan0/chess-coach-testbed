// ============================================================================
// SECTION 13b — Post-resolution review (arrows, piece hint, comparison)
// ============================================================================
import { Chess } from './lib.js';
import { MAX_CP_LOSS_FOR_SUCCESS } from './config.js';
import { state } from './state.js';
import { $, appendCoachMessage } from './dom.js';
import { renderBoard } from './board.js';
import { getCurrentPuzzle } from './queue.js';

export function buildViewHistory() {
  const positions = [];
  if (state.attemptHistory.length === 0) return positions;
  const startFen = state.attemptHistory[0].fenBefore;
  // Starting position — navigable (userPlayed:true), no move highlight, no arrows.
  positions.push({ fen: startFen, label: 'Starting position', mover: null, san: null,
    from: null, to: null, userPlayed: true });
  let userIdx = 0;
  for (const h of state.attemptHistory) {
    if (h.mover === 'user') userIdx++;
    const tmp = new Chess(h.fenBefore);
    try { tmp.move({ from: h.uci.slice(0,2), to: h.uci.slice(2,4), promotion: h.uci.slice(4,5) || undefined }); } catch {}
    let label;
    if (h.mover === 'user') label = `After your move ${userIdx}: ${h.san}`;
    else if (h.mover === 'engine') label = `Engine reply: ${h.san}`;
    else label = `Engine continued: ${h.san}`;
    const fromSq = h.uci ? h.uci.slice(0, 2) : null;
    const toSq = h.uci ? h.uci.slice(2, 4) : null;
    if (h.mover === 'user') {
      // v0.23: store arrow data directly on the entry so annotateForViewIndex
      // reads it without recalculating from attemptHistory. Also mark as
      // navigable (userPlayed:true) for Task 3 skip logic.
      const engBestUci = h.engineBestAtPoint?.uci || null;
      const userUci4 = h.uci.slice(0, 4);
      const bestUci4 = engBestUci ? engBestUci.slice(0, 4) : null;
      positions.push({
        fen: tmp.fen(), label, mover: 'user', san: h.san, from: fromSq, to: toSq,
        userPlayed: true,
        arrowUserFrom: h.uci.slice(0, 2),  arrowUserTo: h.uci.slice(2, 4),
        arrowBestFrom: engBestUci ? engBestUci.slice(0, 2) : null,
        arrowBestTo:   engBestUci ? engBestUci.slice(2, 4) : null,
        userWasBest: !!(bestUci4 && userUci4 === bestUci4),
      });
    } else {
      // Engine reply or punishment ply — not navigable (T3).
      positions.push({ fen: tmp.fen(), label, mover: h.mover, san: h.san,
        from: fromSq, to: toSq, userPlayed: false });
    }
  }
  return positions;
}

export function updateNavLabel() {
  const total = state.viewHistory.length;
  if (!total) { $('nav-label').textContent = 'Current position'; return; }
  if (state.viewIndex === null) $('nav-label').textContent = 'Current position';
  else if (state.viewIndex === 0) $('nav-label').textContent = 'Starting position';
  else $('nav-label').textContent = state.viewHistory[state.viewIndex].label;
  $('nav-back').disabled = !total || (state.viewIndex !== null && state.viewIndex === 0);
  $('nav-forward').disabled = !total || state.viewIndex === null;
}
export function navBack() {
  if (!state.viewHistory.length) return;
  // Start from the position before current; walk back skipping engine-played entries (T3).
  let newIdx = state.viewIndex === null ? state.viewHistory.length - 1 : state.viewIndex - 1;
  while (newIdx > 0 && !state.viewHistory[newIdx]?.userPlayed) newIdx--;
  state.viewIndex = newIdx;
  annotateForViewIndex();
  updateNavLabel(); renderBoard();
}
export function navForward() {
  if (!state.viewHistory.length || state.viewIndex === null) return;
  // Walk forward skipping engine-played entries; past the end → live (null) (T3).
  let newIdx = state.viewIndex + 1;
  while (newIdx < state.viewHistory.length && !state.viewHistory[newIdx]?.userPlayed) newIdx++;
  state.viewIndex = newIdx >= state.viewHistory.length ? null : newIdx;
  annotateForViewIndex();
  updateNavLabel(); renderBoard();
}

// Rebuild review-mode arrows from the current viewHistory entry. Reads arrow
// data stored directly on the entry by buildViewHistory (T2), so there is no
// index-math needed. Engine arrows only shown when the engine has been revealed.
export function annotateForViewIndex() {
  state.annotations = [];
  state.correctSquares = null;

  // Determine which viewHistory entry to annotate.
  let entry;
  if (state.viewIndex === null) {
    // Live / final position — find the last user-move entry in history.
    for (let i = state.viewHistory.length - 1; i >= 0; i--) {
      if (state.viewHistory[i]?.mover === 'user') { entry = state.viewHistory[i]; break; }
    }
  } else if (state.viewIndex === 0) {
    return;   // starting position — no move yet, no arrows
  } else {
    entry = state.viewHistory[state.viewIndex];
  }
  if (!entry || entry.mover !== 'user') return;

  // engineRevealed gate: green engine arrow hidden until solve OR 3+ session fails.
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const puzzle = getCurrentPuzzle();
  const sessionFails = puzzle ? (state.sessionFailures[puzzle.id] || 0) : 0;
  const anyBigCpLoss = userMoves.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  const lastGrade = userMoves[userMoves.length - 1]?.grade;
  const solved = lastGrade && lastGrade.tier !== 'outside' && !anyBigCpLoss;
  const engineRevealed = solved || sessionFails >= 3;

  if (entry.userWasBest) {
    // User played the engine's best — highlight squares with .user-correct-sq
    // instead of a separate arrow (the green board highlight conveys "correct").
    state.correctSquares = { from: entry.arrowUserFrom, to: entry.arrowUserTo };
  } else {
    // Wrong / sub-optimal move — RED arrow for user's move.
    if (entry.arrowUserFrom && entry.arrowUserTo) {
      state.annotations.push({ type: 'arrow',
        from: entry.arrowUserFrom, to: entry.arrowUserTo,
        color: 'rgba(180, 60, 60, 0.85)',
      });
    }
    // GREEN arrow for engine's best — only when earned.
    if (engineRevealed && entry.arrowBestFrom && entry.arrowBestTo) {
      state.annotations.push({ type: 'arrow',
        from: entry.arrowBestFrom, to: entry.arrowBestTo,
        color: 'rgba(60, 180, 100, 0.85)',
      });
    }
  }
}

export function activatePieceHint() {
  // Per-turn behaviour: the highlight always reflects the engine's CURRENT
  // #1 move (refreshed every user turn via playEngineResponseAndRearm).
  // Button greys out for the current turn and re-enables when it's the
  // user's turn again. state.shownPiece flips true once and stays true,
  // capping the puzzle's final accuracy at 50%.
  if (state.pieceHintSquare) return;        // already showing this turn
  if (!state.engineLines.length) return;
  if (state.phase !== 'playing') return;    // never during gate/punishment
  const wasFirstUse = !state.shownPiece;
  state.shownPiece = true;
  state.pieceHintSquare = state.engineLines[0].uci.slice(0, 2);
  $('show-piece-btn').disabled = true;
  renderBoard();
  if (wasFirstUse) {
    appendCoachMessage('system', `Show piece: the highlighted square contains the piece you should move. Accuracy for this puzzle will be capped at 50%.`);
  } else {
    appendCoachMessage('system', `Show piece: highlighted square is the piece to move this turn.`);
  }
}

export function escapeHtmlPuzzle(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function renderComparison(opts) {
  // live = true while the puzzle is still in progress; hides engine/game cols.
  // live = false (default) at resolution. But: per the v0.6 no-spoiler tighten,
  // the engine column STILL hides at resolution unless the user has earned it
  // (solved the puzzle, or failed 3+ times this session). This matches the
  // AI-review-button gate (line ~2371) so a single failed attempt no longer
  // leaks the engine's move via the comparison table.
  const live = !!(opts && opts.live);
  const puzzle = getCurrentPuzzle();
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const comparisonEl = $('comparison');
  if (!userMoves.length || !puzzle) { comparisonEl.classList.add('hidden'); return; }
  // Compute the same "earned" gate used for the AI review button.
  const sessionFails = state.sessionFailures[puzzle.id] || 0;
  const anyBigCpLoss = userMoves.some((h) => (h.grade?.cpLoss || 0) > MAX_CP_LOSS_FOR_SUCCESS);
  const lastGrade = userMoves[userMoves.length - 1]?.grade;
  const solved = lastGrade && lastGrade.tier !== 'outside' && !anyBigCpLoss;
  const engineRevealed = !live && (solved || sessionFails >= 3);
  // Mode is one of: 'live' (hide engine + game cols), 'resolved-locked' (engine
  // column hidden, the rest of the resolution UI is on), or 'resolved' (full).
  comparisonEl.dataset.mode = live ? 'live' : (engineRevealed ? 'resolved' : 'resolved-locked');
  const actualCont = puzzle.actualContinuation || null;
  const actualUserSans = actualCont
    ? actualCont.filter((_, i) => i % 2 === 0).map((c) => c.san)
    : (puzzle.userMoveSan ? [puzzle.userMoveSan] : []);

  const rows = [];
  for (let i = 0; i < userMoves.length; i++) {
    const yours = userMoves[i];
    const rank = yours.grade ? yours.grade.rank : null;
    const cpLoss = yours.grade ? yours.grade.cpLoss : null;
    const rankClass = rank ? `rank-${rank}` : 'rank-off';
    const rankText = rank ? `#${rank}` : 'OFF';
    const cpHtml = (cpLoss != null && cpLoss > 0) ? `<span class="cp-loss-small">-${cpLoss}cp</span>` : '';
    const yoursHtml = `${escapeHtmlPuzzle(yours.san)} <span class="rank-badge ${rankClass}">${rankText}</span>${cpHtml}`;

    const engine = (yours.engineBestAtPoint && yours.engineBestAtPoint.san) || '—';
    rows.push(`<tr data-move-idx="${i}">
      <td>${i + 1}</td>
      <td class="col-yours">${yoursHtml}</td>
      <td class="col-engine">${escapeHtmlPuzzle(engine)}</td>
    </tr>`);
  }
  const tbody = $('comparison-rows');
  tbody.innerHTML = rows.join('');
  // Wire click handlers — each row jumps the board to the position before that
  // user move and overlays the user's move (red) + engine's preferred (green).
  // Skip in live mode (no resolved state to jump back to).
  if (!live) {
    for (const tr of tbody.querySelectorAll('tr')) {
      tr.addEventListener('click', () => {
        const idx = parseInt(tr.dataset.moveIdx, 10);
        jumpToUserMove(idx);
        // Highlight the active row.
        for (const r of tbody.querySelectorAll('tr')) r.classList.remove('active');
        tr.classList.add('active');
      });
    }
  }
  comparisonEl.classList.remove('hidden');
}

// Jump the board to the position BEFORE the user's Nth move (0-indexed) and
// overlay arrows: red = what the user played, green = engine's preferred (if
// different). Uses the existing nav viewIndex + annotations mechanisms.
export function jumpToUserMove(userMoveIdx) {
  if (!state.viewHistory.length) return;
  // B1 fix (v0.49): map the comparison-row index (which counts ONLY user moves)
  // to the real viewHistory entry by walking and counting user-played entries.
  // The old `2*idx+1` stride assumed a strict start,user,engine,user,... layout
  // and broke on wrong-move punishment plies (extra non-user entries) and on the
  // final move. Counting is layout-agnostic.
  let seen = -1, targetIdx = -1;
  for (let i = 0; i < state.viewHistory.length; i++) {
    const e = state.viewHistory[i];
    if (e && e.mover === 'user') {
      seen++;
      if (seen === userMoveIdx) { targetIdx = i; break; }
    }
  }
  if (targetIdx < 0) return;
  // Land on the REAL historical entry, never collapse to null. The old code set
  // viewIndex=null (live) whenever the target was the last entry, but the board
  // is already at the live position after resolution, so the tap did nothing
  // (the whole bug for single-move puzzles, where the only row mapped to null).
  // A real index makes renderBoard show that ply and annotateForViewIndex paint
  // THIS move's arrows; if the ply equals the live position the soft-update path
  // still repaints the arrows + last-move highlight.
  state.viewIndex = targetIdx;
  annotateForViewIndex();
  updateNavLabel();
  renderBoard();
  scrollBoardIntoViewOnMobile();
}

// Bug A (v0.48, iPhone): on mobile the board renders ABOVE the comparison
// table (side-by-side only at >=880px), so tapping a comparison row updates the
// board off-screen and reads as "nothing happened". Bring the board back into
// view after a row jump. No-op on desktop, where the board is already visible
// beside the table, and a safe no-op anywhere the APIs are missing.
function scrollBoardIntoViewOnMobile() {
  try {
    if (!window.matchMedia || !window.matchMedia('(max-width: 879px)').matches) return;
    const wrap = document.querySelector('.board-wrap');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch { /* scrolling is best-effort */ }
}
