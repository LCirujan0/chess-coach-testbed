// ============================================================================
// playout.js — entry-point module for endgames.html (Phase 1b)
// ============================================================================
// Handles the endgame play-out trainer. Loads endgame lessons from
// state.puzzles (merged in by boot.js Phase 1a), initialises Stockfish via
// the lightweight initStockfishWorker(), and runs the play-out evaluation
// loop. Does NOT touch state.engineLines or any puzzle.html DOM elements.
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

// ── Play-out local state ───────────────────────────────────────────────────
const po = {
  lessons: [],           // endgame lessons filtered from state.puzzles
  idx: 0,                // current lesson index
  phase: 'idle',         // 'idle' | 'playing' | 'thinking' | 'done'
  traineeMovesPlayed: 0,
  consecutiveFails: 0,
  failMoveNum: null,
  evalHistory: [],
  storage: {},           // lesson results keyed by id
  sfReady: false,
  usedTechnique: false,
};

const STORAGE_KEY = 'chess-coach-eg-results-v1';

// ── Storage ────────────────────────────────────────────────────────────────
function loadStorage() {
  try { po.storage = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { po.storage = {}; }
}
function saveStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(po.storage)); } catch {}
}
function getEntry(id) {
  return po.storage[id] || { attempts: 0, cleanInARow: 0, mastered: false, lastResult: null, lastAt: null };
}
function saveResult(id, passed, clean) {
  const e = getEntry(id);
  e.attempts++;
  e.lastResult = passed ? 'pass' : 'fail';
  e.lastAt = Date.now();
  if (passed && clean) {
    e.cleanInARow = (e.cleanInARow || 0) + 1;
    if (e.cleanInARow >= 2) e.mastered = true;
  } else {
    e.cleanInARow = 0;
  }
  po.storage[id] = e;
  saveStorage();
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(text) {
  const el = document.getElementById('status-text');
  if (!el) return;
  el.textContent = text;
}

function $ (id) { return document.getElementById(id); }

// ── Board rendering ────────────────────────────────────────────────────────
function renderBoard() {
  const boardEl = $('board');
  if (!boardEl || !state.chess || !state.orientation) return;
  const { files, ranks } = state.orientation;
  const locked = (po.phase !== 'playing');
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
      if (state.selectedSquare === square) sq.classList.add('selected');
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
      // Legal-move markers
      const move = state.legalMovesFromSelected.find((m) => m.to === square);
      if (move) {
        const isCapture = move.flags.includes('c') || move.flags.includes('e');
        const marker = document.createElement('span');
        marker.className = isCapture ? 'legal-ring' : 'legal-dot';
        sq.appendChild(marker);
      }
      frag.appendChild(sq);
    }
  }
  boardEl.replaceChildren(frag);
}

// ── Tap-to-move ────────────────────────────────────────────────────────────
function onSquareTap(square) {
  if (po.phase !== 'playing' || !po.sfReady) return;
  if (!state.selectedSquare) {
    const piece = state.chess.get(square);
    if (!piece || piece.color !== state.chess.turn()) return;
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard();
    return;
  }
  if (square === state.selectedSquare) {
    state.selectedSquare = null;
    state.legalMovesFromSelected = [];
    renderBoard();
    return;
  }
  // Tap own piece → re-select
  const here = state.chess.get(square);
  if (here && here.color === state.chess.turn()) {
    state.selectedSquare = square;
    state.legalMovesFromSelected = state.chess.moves({ square, verbose: true });
    renderBoard();
    return;
  }
  // Attempt the move
  const move = state.legalMovesFromSelected.find((m) => m.to === square);
  if (move) {
    const m = state.chess.move({ from: move.from, to: move.to, promotion: 'q' });
    if (m) {
      state.selectedSquare = null;
      state.legalMovesFromSelected = [];
      state.lastMove = { from: m.from, to: m.to };
      po.phase = 'thinking';
      renderBoard();
      handlePlayOutMove();
    }
  }
}

// ── Threshold logic ────────────────────────────────────────────────────────
function checkThreshold(lesson, evalCp) {
  if (lesson.result === 'win') {
    if (evalCp < PLAYOUT_WIN_FAIL_CP) {
      po.consecutiveFails++;
      if (po.consecutiveFails >= PLAYOUT_FAIL_CONSECUTIVE) {
        if (!po.failMoveNum) po.failMoveNum = po.traineeMovesPlayed;
        return 'fail';
      }
    } else {
      po.consecutiveFails = 0;
    }
    if (evalCp >= PLAYOUT_DECISIVE_CP) return 'pass';
  } else {
    // draw lesson
    if (evalCp < PLAYOUT_DRAW_PASS_CP) {
      po.consecutiveFails++;
      if (po.consecutiveFails >= PLAYOUT_FAIL_CONSECUTIVE) {
        if (!po.failMoveNum) po.failMoveNum = po.traineeMovesPlayed;
        return 'fail';
      }
    } else {
      po.consecutiveFails = 0;
    }
  }
  return null;
}

// ── Main move handler ──────────────────────────────────────────────────────
async function handlePlayOutMove() {
  po.traineeMovesPlayed++;
  const lesson = po.lessons[po.idx];
  setStatus('Thinking…');

  // Analyse after trainee move (from opponent perspective → flip for trainee)
  let line = await analyzePositionFast(state.chess.fen(), PLAYOUT_DEPTH);
  if (!line) { setStatus('Engine error — please retry.'); po.phase = 'playing'; return; }

  // traineeEval: opponent's eval negated = trainee's eval
  const evalCp = -normalizeEval(line.eval);
  po.evalHistory.push(evalCp);

  // Game over after trainee move?
  if (state.chess.isGameOver()) {
    if (state.chess.isCheckmate()) {
      showVerdict(lesson, 'pass', 'Checkmate — clean finish.');
    } else {
      const isDrawLesson = lesson.result === 'draw';
      showVerdict(lesson, isDrawLesson ? 'pass' : 'fail',
        isDrawLesson ? 'Draw secured.' : 'Stalemate or draw — win slipped.');
    }
    return;
  }

  // Threshold check after trainee move
  const verdict = checkThreshold(lesson, evalCp);
  if (verdict) { showVerdict(lesson, verdict, verdictDetail(lesson, verdict)); return; }

  // Move-cap check
  if (po.traineeMovesPlayed >= PLAYOUT_MOVE_CAP) {
    const finalPass = lesson.result === 'win'
      ? evalCp >= PLAYOUT_WIN_PASS_CP
      : evalCp >= PLAYOUT_DRAW_PASS_CP;
    showVerdict(lesson, finalPass ? 'pass' : 'fail', verdictDetail(lesson, finalPass ? 'pass' : 'fail'));
    return;
  }

  // Engine reply
  const engineUci = line.pvUci && line.pvUci[0];
  if (!engineUci) {
    showVerdict(lesson, 'pass', 'Position resolved.');
    return;
  }
  const from = engineUci.slice(0, 2);
  const to   = engineUci.slice(2, 4);
  const prom = engineUci.slice(4, 5) || undefined;
  const em = state.chess.move({ from, to, promotion: prom });
  if (!em) { setStatus('Engine move error.'); po.phase = 'playing'; return; }
  state.lastMove = { from: em.from, to: em.to };

  // Game over after engine move?
  if (state.chess.isGameOver()) {
    if (state.chess.isCheckmate()) {
      showVerdict(lesson, 'fail',
        lesson.result === 'draw' ? 'Checkmated — draw lost.' : 'Checkmated — win turned into a loss.');
    } else {
      const isDrawLesson = lesson.result === 'draw';
      showVerdict(lesson, isDrawLesson ? 'pass' : 'fail',
        isDrawLesson ? 'Draw secured.' : 'Stalemate — win escaped.');
    }
    return;
  }

  // Re-analyse for trainee's next position (trainee is now to move again;
  // eval is directly from trainee's PoV without flipping).
  const afterLine = await analyzePositionFast(state.chess.fen(), PLAYOUT_DEPTH);
  if (afterLine) {
    const afterEval = normalizeEval(afterLine.eval);
    po.evalHistory.push(afterEval);
  }

  po.phase = 'playing';
  renderBoard();
  setStatus('');
}

function verdictDetail(lesson, verdict) {
  if (verdict === 'pass') {
    return lesson.result === 'win' ? 'Won it — clean conversion.' : 'Drew it — held under pressure.';
  }
  if (po.failMoveNum) return 'Lost the win at move ' + po.failMoveNum + '.';
  return lesson.result === 'win' ? 'Win slipped — eval dropped too low.' : 'Draw lost — position became too bad.';
}

// ── Verdict display ────────────────────────────────────────────────────────
function showVerdict(lesson, verdict, detail) {
  po.phase = 'done';
  const passed = verdict === 'pass';
  const clean = passed && !po.usedTechnique;
  saveResult(lesson.id, passed, clean);

  const vc = $('verdict-card');
  if (vc) vc.classList.remove('hidden');

  const hl = $('verdict-headline');
  if (hl) {
    hl.className = 'verdict-headline ' + verdict;
    hl.textContent = passed
      ? (lesson.result === 'win' ? 'Won it.' : 'Drew it.')
      : (lesson.result === 'win' ? 'Win slipped.' : 'Draw lost.');
  }
  const vd = $('verdict-detail');
  if (vd) {
    vd.textContent = detail
      + (clean ? ' Clean — counts toward mastery.'
        : passed && po.usedTechnique ? ' Passed (technique shown — not clean).' : '');
  }
  const retryBtn = $('retry-btn');
  if (retryBtn) retryBtn.disabled = false;

  renderBoard();
  updateLessonList();
  setStatus('');
}

// ── Lesson loading ─────────────────────────────────────────────────────────
function loadLesson(idx) {
  if (!po.lessons.length) return;
  po.idx = Math.max(0, Math.min(idx, po.lessons.length - 1));
  const lesson = po.lessons[po.idx];

  // Reset attempt state
  state.chess = new Chess(lesson.fen);
  // Use orientationFor if the lesson has userColorName; otherwise derive from sideToMove.
  if (lesson.userColorName || lesson.sideToMove) {
    const color = lesson.userColorName
      ? (lesson.userColorName === 'Black' ? 'b' : 'w')
      : lesson.sideToMove;
    state.orientation = color === 'b'
      ? { files: FILES_FLIP, ranks: RANKS_FLIP }
      : { files: FILES_STD, ranks: RANKS_STD };
  } else {
    state.orientation = orientationFor(lesson);
  }
  state.lastMove = null;
  state.selectedSquare = null;
  state.legalMovesFromSelected = [];

  po.usedTechnique = false;
  po.evalHistory = [];
  po.consecutiveFails = 0;
  po.failMoveNum = null;
  po.traineeMovesPlayed = 0;
  po.phase = po.sfReady ? 'playing' : 'idle';

  // Update lesson header DOM
  const groupBadge = $('lesson-group-badge');
  if (groupBadge) groupBadge.textContent = lesson.group || lesson.category || '';
  const lessonTitle = $('lesson-title');
  if (lessonTitle) lessonTitle.textContent = lesson.title || '';
  const lessonStm = $('lesson-stm');
  if (lessonStm) {
    const side = lesson.sideToMove === 'b' ? 'Black' : 'White';
    const goal = lesson.result === 'win' ? 'Win' : 'Hold the draw';
    lessonStm.textContent = side + ' to move · ' + goal;
  }
  const advBadge = $('advanced-badge');
  if (advBadge) {
    lesson.advanced ? advBadge.classList.remove('hidden') : advBadge.classList.add('hidden');
  }

  // Reset technique display
  const techText = $('technique-text');
  if (techText) { techText.classList.add('hidden'); techText.textContent = ''; }
  const techBtn = $('show-technique-btn');
  if (techBtn) techBtn.textContent = 'Show technique';

  // Hide verdict card
  const vc = $('verdict-card');
  if (vc) vc.classList.add('hidden');
  const retryBtn = $('retry-btn');
  if (retryBtn) retryBtn.disabled = true;

  renderBoard();
  setStatus(po.sfReady ? '' : 'Loading engine…');
  updateLessonList();
}

// ── Lesson list ────────────────────────────────────────────────────────────
function updateLessonList() {
  const container = $('lesson-list');
  if (!container) return;
  const groups = {};
  for (const l of po.lessons) {
    const grp = l.group || l.category || 'General';
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(l);
  }
  container.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'lesson-list-header';
  hdr.textContent = 'All lessons';
  container.appendChild(hdr);
  for (const [grpName, items] of Object.entries(groups)) {
    const grpEl = document.createElement('div');
    grpEl.className = 'lesson-list-group';
    const grpLbl = document.createElement('div');
    grpLbl.className = 'lesson-list-group-label';
    grpLbl.textContent = grpName;
    grpEl.appendChild(grpLbl);
    for (const l of items) {
      const e = getEntry(l.id);
      const item = document.createElement('div');
      item.className = 'lesson-list-item' + (po.lessons[po.idx] && po.lessons[po.idx].id === l.id ? ' active' : '');
      item.addEventListener('click', () => loadLesson(po.lessons.indexOf(l)));
      const name = document.createElement('div');
      name.className = 'lesson-list-name';
      name.textContent = l.title || l.id;
      const pips = document.createElement('div');
      pips.className = 'mastery-pips';
      for (let i = 0; i < 2; i++) {
        const pip = document.createElement('span');
        pip.className = 'pip' + (e.mastered ? ' mastered' : (e.cleanInARow > i ? ' filled' : ''));
        pips.appendChild(pip);
      }
      const res = document.createElement('div');
      res.className = 'lesson-list-result';
      res.textContent = e.mastered ? '★ Mastered' : (e.lastResult ? (e.lastResult === 'pass' ? '✓ Pass' : '✗ Fail') : '');
      item.appendChild(name);
      item.appendChild(pips);
      item.appendChild(res);
      grpEl.appendChild(item);
    }
    container.appendChild(grpEl);
  }
}

// ── Board click delegation ─────────────────────────────────────────────────
function attachBoardListener() {
  const boardEl = $('board');
  if (!boardEl) return;
  boardEl.addEventListener('click', (e) => {
    const sq = e.target.closest('.square');
    if (!sq || !sq.dataset.square) return;
    onSquareTap(sq.dataset.square);
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  loadStorage();

  // Wait for DOM
  if (document.readyState === 'loading') {
    await new Promise((res) => document.addEventListener('DOMContentLoaded', res));
  }

  attachBoardListener();

  // Wire nav buttons
  const retryBtn = $('retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', () => { if (po.lessons[po.idx]) loadLesson(po.idx); });

  const prevBtn = $('prev-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (po.idx > 0) loadLesson(po.idx - 1); });

  const nextBtn = $('next-btn');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (po.idx < po.lessons.length - 1) loadLesson(po.idx + 1);
    else loadLesson(0); // wrap
  });

  const techBtn = $('show-technique-btn');
  if (techBtn) techBtn.addEventListener('click', () => {
    const techText = $('technique-text');
    const lesson = po.lessons[po.idx];
    if (!lesson || !techText) return;
    if (techText.classList.contains('hidden')) {
      techText.textContent = lesson.keyIdea || '';
      techText.classList.remove('hidden');
      techBtn.textContent = 'Hide technique';
      po.usedTechnique = true;
    } else {
      techText.classList.add('hidden');
      techBtn.textContent = 'Show technique';
    }
  });

  // Nav drawer open/close (same pattern as other pages)
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

  // Read endgame lessons from state.puzzles (loaded by Phase 1a boot.js)
  // boot.js runs first because it is imported by the page; we wait a tick
  // to allow the async loadStaticPuzzleSets() to complete.
  // If state.puzzles is still the default stub, load directly.
  await new Promise((res) => setTimeout(res, 0));

  po.lessons = state.puzzles.filter(
    (p) => p && (p.type === 'endgame' || p.puzzleType === 'endgame')
  );

  if (!po.lessons.length) {
    // Fallback: fetch directly (endgames.html opened standalone without boot.js)
    try {
      const res = await fetch('/data/endgames.json');
      if (res.ok) {
        const data = await res.json();
        po.lessons = (data && Array.isArray(data.lessons)) ? data.lessons : [];
      }
    } catch (err) {
      setStatus('Failed to load lessons: ' + err.message);
      return;
    }
  }

  if (!po.lessons.length) {
    setStatus('No endgame lessons found.');
    return;
  }

  loadLesson(0);
  setStatus('Loading engine…');

  try {
    await initStockfishWorker(1);
    po.sfReady = true;
    if (po.phase === 'idle') po.phase = 'playing';
    setStatus('');
    renderBoard();
  } catch (err) {
    setStatus('Engine failed: ' + err.message);
  }
}

boot();
