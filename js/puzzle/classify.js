// ============================================================================
// classify.js — entry-point module for endgame-recognition.html (Phase 1b)
// ============================================================================
// Handles the endgame recognition drill. Loads recognition positions from
// state.puzzles (merged in by boot.js Phase 1a), renders a static board,
// prompts the user to classify the position (Winning / Drawn / Losing),
// reveals the verdict + keyFactor, and optionally lets them play it out.
// Does NOT touch state.engineLines or any puzzle.html DOM elements.
// ============================================================================

import { Chess } from './lib.js';
import {
  PIECE_IMG,
  PLAYOUT_DEPTH,
  PLAYOUT_MOVE_CAP,
  PLAYOUT_WIN_FAIL_CP,
  PLAYOUT_WIN_PASS_CP,
  PLAYOUT_DECISIVE_CP,
  PLAYOUT_FAIL_CONSECUTIVE,
  PLAYOUT_DRAW_PASS_CP,
  FILES_STD, RANKS_STD, FILES_FLIP, RANKS_FLIP,
  PIECE_GLYPH,
} from './config.js';
import { state } from './state.js';
import { initStockfishWorker, analyzePositionFast, normalizeEval, orientationFor } from './engine.js';

// ── Classify local state ───────────────────────────────────────────────────
const cl = {
  positions: [],       // recognition positions from state.puzzles
  idx: 0,
  phase: 'classify',  // 'classify' | 'verdict' | 'playout'
  traineeMovesPlayed: 0,
  consecutiveFails: 0,
  failMoveNum: null,
  sfReady: false,
  sessionCorrect: 0,
  sessionTotal: 0,
};

const STORAGE_KEY = 'chess-coach-recognition-v1';

// ── Storage helpers ────────────────────────────────────────────────────────
function loadJson(key, fb) {
  try { const r = localStorage.getItem(key); return r == null ? fb : (JSON.parse(r) ?? fb); } catch { return fb; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function recordResult(pos, correct) {
  cl.sessionTotal++;
  if (correct) cl.sessionCorrect++;
  const storage = loadJson(STORAGE_KEY, { byType: {}, recent: [], seenFens: [] });
  if (!storage.byType) storage.byType = {};
  if (!storage.recent) storage.recent = [];
  if (!storage.seenFens) storage.seenFens = [];
  if (!storage.byType[pos.type]) storage.byType[pos.type] = { seen: 0, correct: 0 };
  storage.byType[pos.type].seen++;
  if (correct) storage.byType[pos.type].correct++;
  storage.recent.push({ id: pos.fen || pos.id, guess: correct, at: new Date().toISOString() });
  if (storage.recent.length > 50) storage.recent = storage.recent.slice(-50);
  if (pos.fen) {
    storage.seenFens.push(pos.fen);
    if (storage.seenFens.length > 500) storage.seenFens = storage.seenFens.slice(-500);
  }
  saveJson(STORAGE_KEY, storage);
  updateScorePill();
}

function updateScorePill() {
  const pill = document.getElementById('score-pill');
  if (pill) pill.textContent = cl.sessionCorrect + ' / ' + cl.sessionTotal;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

// ── Board rendering (static — no click handler unless playout phase) ───────
function renderBoard(interactive) {
  const boardEl = document.getElementById('board');
  if (!boardEl || !state.chess || !state.orientation) return;
  const { files, ranks } = state.orientation;
  const locked = !interactive || (cl.phase !== 'playout');
  const board = state.chess.board();
  const frag = document.createDocumentFragment();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = files[f] + ranks[r];
      const stdRank = RANKS_STD.indexOf(ranks[r]);
      const stdFile = FILES_STD.indexOf(files[f]);
      const piece = board[stdRank][stdFile];
      const sq = document.createElement('div');
      sq.className = 'square ' + ((stdRank + stdFile) % 2 === 0 ? 'light' : 'dark');
      if (locked) sq.classList.add('locked');
      if (cl.phase === 'playout' && state.selectedSquare === square) sq.classList.add('selected');
      if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) sq.classList.add('last-move');
      sq.dataset.square = square;
      if (r === 7) {
        const lbl = document.createElement('span');
        lbl.className = 'coord file';
        lbl.textContent = files[f];
        sq.appendChild(lbl);
      }
      if (f === 0) {
        const lbl = document.createElement('span');
        lbl.className = 'coord rank';
        lbl.textContent = ranks[r];
        sq.appendChild(lbl);
      }
      if (piece) {
        const img = document.createElement('img');
        img.className = 'pc-img';
        img.src = PIECE_IMG(piece.color, piece.type);
        img.alt = PIECE_GLYPH[piece.type] || (piece.color + piece.type);
        img.draggable = false;
        sq.appendChild(img);
      }
      if (cl.phase === 'playout') {
        const move = state.legalMovesFromSelected.find((m) => m.to === square);
        if (move) {
          const isCapture = move.flags.includes('c') || move.flags.includes('e');
          const marker = document.createElement('span');
          marker.className = isCapture ? 'legal-ring' : 'legal-dot';
          sq.appendChild(marker);
        }
      }
      frag.appendChild(sq);
    }
  }
  boardEl.replaceChildren(frag);
}

// ── Playout tap-to-move ────────────────────────────────────────────────────
function onSquareTap(square) {
  if (cl.phase !== 'playout' || !cl.sfReady) return;
  if (!state.selectedSquare) {
    const piece = state.chess.get(square);
    if (!piece || piece.color !== state.chess.turn()) return;
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard(true);
    return;
  }
  if (square === state.selectedSquare) {
    state.selectedSquare = null;
    state.legalMovesFromSelected = [];
    renderBoard(true);
    return;
  }
  const here = state.chess.get(square);
  if (here && here.color === state.chess.turn()) {
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard(true);
    return;
  }
  const move = state.legalMovesFromSelected.find((m) => m.to === square);
  if (move) {
    const m = state.chess.move({ from: move.from, to: move.to, promotion: 'q' });
    if (m) {
      state.selectedSquare = null;
      state.legalMovesFromSelected = [];
      state.lastMove = { from: m.from, to: m.to };
      renderBoard(true);
      handlePlayOutMove();
    }
  }
}

// ── Playout threshold logic ────────────────────────────────────────────────
function checkThreshold(pos, evalCp) {
  if (pos.result === 'win') {
    if (evalCp < PLAYOUT_WIN_FAIL_CP) {
      cl.consecutiveFails++;
      if (cl.consecutiveFails >= PLAYOUT_FAIL_CONSECUTIVE) {
        if (!cl.failMoveNum) cl.failMoveNum = cl.traineeMovesPlayed;
        return 'fail';
      }
    } else {
      cl.consecutiveFails = 0;
    }
    if (evalCp >= PLAYOUT_DECISIVE_CP) return 'pass';
  } else {
    if (evalCp < PLAYOUT_DRAW_PASS_CP) {
      cl.consecutiveFails++;
      if (cl.consecutiveFails >= PLAYOUT_FAIL_CONSECUTIVE) {
        if (!cl.failMoveNum) cl.failMoveNum = cl.traineeMovesPlayed;
        return 'fail';
      }
    } else {
      cl.consecutiveFails = 0;
    }
  }
  return null;
}

async function handlePlayOutMove() {
  cl.traineeMovesPlayed++;
  const pos = cl.positions[cl.idx];
  setStatus('Thinking…');

  let line = await analyzePositionFast(state.chess.fen(), PLAYOUT_DEPTH);
  if (!line) { setStatus('Engine error.'); return; }

  const evalCp = -normalizeEval(line.eval);

  if (state.chess.isGameOver()) {
    if (state.chess.isCheckmate()) {
      showPlayoutVerdict(pos, 'pass', 'Checkmate — clean finish.');
    } else {
      const isDraw = pos.result === 'draw';
      showPlayoutVerdict(pos, isDraw ? 'pass' : 'fail',
        isDraw ? 'Draw secured.' : 'Stalemate — win slipped.');
    }
    return;
  }

  const verdict = checkThreshold(pos, evalCp);
  if (verdict) { showPlayoutVerdict(pos, verdict, verdictDetail(pos, verdict)); return; }

  if (cl.traineeMovesPlayed >= PLAYOUT_MOVE_CAP) {
    const finalPass = pos.result === 'win'
      ? evalCp >= PLAYOUT_WIN_PASS_CP
      : evalCp >= PLAYOUT_DRAW_PASS_CP;
    showPlayoutVerdict(pos, finalPass ? 'pass' : 'fail', verdictDetail(pos, finalPass ? 'pass' : 'fail'));
    return;
  }

  const engineUci = line.pvUci && line.pvUci[0];
  if (!engineUci) { showPlayoutVerdict(pos, 'pass', 'Position resolved.'); return; }
  const from = engineUci.slice(0, 2);
  const to   = engineUci.slice(2, 4);
  const prom = engineUci.slice(4, 5) || undefined;
  const em = state.chess.move({ from, to, promotion: prom });
  if (!em) { setStatus('Engine move error.'); return; }
  state.lastMove = { from: em.from, to: em.to };

  if (state.chess.isGameOver()) {
    if (state.chess.isCheckmate()) {
      showPlayoutVerdict(pos, 'fail',
        pos.result === 'draw' ? 'Checkmated — draw lost.' : 'Checkmated — loss.');
    } else {
      const isDraw = pos.result === 'draw';
      showPlayoutVerdict(pos, isDraw ? 'pass' : 'fail',
        isDraw ? 'Draw secured.' : 'Stalemate — win escaped.');
    }
    return;
  }

  cl.phase = 'playout';
  renderBoard(true);
  setStatus('');
}

function verdictDetail(pos, verdict) {
  if (verdict === 'pass') return pos.result === 'win' ? 'Won it.' : 'Drew it.';
  if (cl.failMoveNum) return 'Lost at move ' + cl.failMoveNum + '.';
  return pos.result === 'win' ? 'Win slipped.' : 'Draw lost.';
}

function showPlayoutVerdict(pos, verdict, detail) {
  cl.phase = 'verdict';
  const playoutVerdictArea = document.getElementById('playout-verdict-area');
  if (playoutVerdictArea) {
    const passed = verdict === 'pass';
    playoutVerdictArea.innerHTML =
      '<div class="verdict-badge ' + (passed ? 'correct' : 'wrong') + '">' +
      (passed ? '✓ ' : '✗ ') + (passed ? 'Passed' : 'Failed') +
      '</div>' +
      '<div style="font-size:13px;color:var(--muted);margin-top:6px;">' + detail + '</div>';
    playoutVerdictArea.classList.remove('hidden');
  }
  renderBoard(false);
  setStatus('');
}

// ── Position loading ───────────────────────────────────────────────────────
function loadPosition(idx) {
  if (!cl.positions.length) return;
  cl.idx = Math.max(0, Math.min(idx, cl.positions.length - 1));
  const pos = cl.positions[cl.idx];

  state.chess = new Chess(pos.fen);
  // Recognition positions: orient to the side that can win/draw (pos.side or FEN turn)
  const color = pos.side || state.chess.turn();
  state.orientation = color === 'b'
    ? { files: FILES_FLIP, ranks: RANKS_FLIP }
    : { files: FILES_STD, ranks: RANKS_STD };
  state.lastMove = null;
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];

  cl.phase = 'classify';
  cl.traineeMovesPlayed = 0;
  cl.consecutiveFails = 0;
  cl.failMoveNum = null;

  // Update side-to-move label
  const sideLabel = document.getElementById('side-to-move-label');
  if (sideLabel) {
    const sideStr = color === 'b' ? 'Black' : 'White';
    sideLabel.textContent = 'Side to move: ' + sideStr;
  }

  // Show classify buttons, hide playout + verdict areas
  const classifyArea = document.getElementById('classify-area');
  if (classifyArea) classifyArea.classList.remove('hidden');
  const verdictArea = document.getElementById('verdict-area');
  if (verdictArea) verdictArea.classList.add('hidden');
  const playoutArea = document.getElementById('playout-area');
  if (playoutArea) playoutArea.classList.add('hidden');
  const playoutVerdictArea = document.getElementById('playout-verdict-area');
  if (playoutVerdictArea) playoutVerdictArea.classList.add('hidden');

  // Re-enable classify buttons
  for (const id of ['btn-winning', 'btn-drawn', 'btn-losing']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  }

  renderBoard(false);
}

// ── Classify button handler ────────────────────────────────────────────────
function onClassify(userVerdict) {
  if (cl.phase !== 'classify') return;
  cl.phase = 'verdict';

  const pos = cl.positions[cl.idx];
  // Map user verdict to canonical
  // pos.result: 'win' | 'draw' | 'loss'
  const correct = (
    (userVerdict === 'win'  && pos.result === 'win') ||
    (userVerdict === 'draw' && pos.result === 'draw') ||
    (userVerdict === 'loss' && (pos.result === 'loss' || pos.result === 'lose'))
  );
  recordResult(pos, correct);

  // Disable classify buttons
  for (const id of ['btn-winning', 'btn-drawn', 'btn-losing']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  }

  // Show verdict area
  const verdictArea = document.getElementById('verdict-area');
  if (verdictArea) {
    const verdictLabel = pos.result === 'win' ? 'Winning' : pos.result === 'draw' ? 'Drawn' : 'Losing';
    const badgeClass = correct ? 'correct' : 'wrong';
    const badgeText = correct ? '✓ Correct — ' + verdictLabel : '✗ Wrong — it\'s ' + verdictLabel;
    verdictArea.innerHTML =
      '<div class="verdict-badge ' + badgeClass + '">' + badgeText + '</div>' +
      '<div class="keyfactor"><strong>' + escHtml(pos.type || '') + ':</strong> ' +
      escHtml(pos.keyFactor || '') + '</div>';
    verdictArea.classList.remove('hidden');
  }

  // Show "Play it out" button only for win-result + correct classification
  const playoutBtn = document.getElementById('playout-btn');
  if (playoutBtn) {
    if (correct && pos.result === 'win') {
      playoutBtn.classList.remove('hidden');
    } else {
      playoutBtn.classList.add('hidden');
    }
  }

  // Show next button
  const nextArea = document.getElementById('next-area');
  if (nextArea) {
    const isLast = cl.idx >= cl.positions.length - 1;
    nextArea.innerHTML = '<button class="btn primary" id="next-btn" style="margin-top:8px;">'
      + (isLast ? 'Start over' : 'Next position →') + '</button>';
    document.getElementById('next-btn').addEventListener('click', () => {
      loadPosition(isLast ? 0 : cl.idx + 1);
    });
  }
}

// ── "Play it out" activation ───────────────────────────────────────────────
async function activatePlayout() {
  const pos = cl.positions[cl.idx];
  cl.phase = 'playout';
  cl.traineeMovesPlayed = 0;
  cl.consecutiveFails = 0;
  cl.failMoveNum = null;

  // Reset chess to starting FEN for this position
  state.chess = new Chess(pos.fen);
  state.lastMove = null;
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];

  // Show playout area
  const playoutArea = document.getElementById('playout-area');
  if (playoutArea) playoutArea.classList.remove('hidden');

  // Hide playout button
  const playoutBtn = document.getElementById('playout-btn');
  if (playoutBtn) playoutBtn.classList.add('hidden');

  if (!cl.sfReady) {
    setStatus('Loading engine…');
    try {
      await initStockfishWorker(1);
      cl.sfReady = true;
      setStatus('');
    } catch (err) {
      setStatus('Engine failed: ' + err.message);
      return;
    }
  }

  renderBoard(true);
  setStatus('Your turn — play to win.');
}

// ── Utility ────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  if (document.readyState === 'loading') {
    await new Promise((res) => document.addEventListener('DOMContentLoaded', res));
  }

  // Board click delegation (only active in playout phase)
  const boardEl = document.getElementById('board');
  if (boardEl) {
    boardEl.addEventListener('click', (e) => {
      const sq = e.target.closest('.square');
      if (!sq || !sq.dataset.square) return;
      onSquareTap(sq.dataset.square);
    });
  }

  // Classify buttons
  const btnWin  = document.getElementById('btn-winning');
  const btnDraw = document.getElementById('btn-drawn');
  const btnLose = document.getElementById('btn-losing');
  if (btnWin)  btnWin.addEventListener('click', () => onClassify('win'));
  if (btnDraw) btnDraw.addEventListener('click', () => onClassify('draw'));
  if (btnLose) btnLose.addEventListener('click', () => onClassify('loss'));

  // Play it out button
  const playoutBtn = document.getElementById('playout-btn');
  if (playoutBtn) playoutBtn.addEventListener('click', () => activatePlayout());

  // Nav drawer
  const hamburger = document.getElementById('hamburger');
  const navDrawer = document.getElementById('nav-drawer');
  const navBackdrop = document.getElementById('nav-backdrop');
  if (hamburger && navDrawer && navBackdrop) {
    hamburger.addEventListener('click', () => {
      navDrawer.classList.toggle('open');
      navBackdrop.classList.toggle('open');
    });
    navBackdrop.addEventListener('click', () => {
      navDrawer.classList.remove('open');
      navBackdrop.classList.remove('open');
    });
  }

  // Wait a tick for boot.js async puzzle load
  await new Promise((res) => setTimeout(res, 0));

  // Load positions from state.puzzles (merged by Phase 1a)
  cl.positions = state.puzzles.filter(
    (p) => p && (p.puzzleType === 'recognition' || p.type === 'recognition')
  );

  // Fallback: direct fetch
  if (!cl.positions.length) {
    try {
      const res = await fetch('/data/endgame-recognition.json');
      if (res.ok) {
        const data = await res.json();
        cl.positions = (data && Array.isArray(data.positions)) ? data.positions : [];
      }
    } catch (err) {
      const root = document.getElementById('board');
      if (root) root.textContent = 'Failed to load positions: ' + err.message;
      return;
    }
  }

  if (!cl.positions.length) {
    setStatus('No recognition positions found.');
    return;
  }

  // Shuffle
  for (let i = cl.positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cl.positions[i], cl.positions[j]] = [cl.positions[j], cl.positions[i]];
  }

  updateScorePill();
  loadPosition(0);
}

boot();
