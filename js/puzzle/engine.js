// ============================================================================
// SECTION 5 — Position summary
// ============================================================================
import { Chess } from './lib.js';
import { FILES_STD, RANKS_STD, FILES_FLIP, RANKS_FLIP, STOCKFISH_MULTIPV, STOCKFISH_DEPTH } from './config.js';
import { state } from './state.js';
import { $, setInlineStatus } from './dom.js';
// runtime deps (called inside function bodies only — no top-level call, so cycles are safe)
import { startThinkingGate } from './gate.js';
import { renderBoard } from './board.js';

export function orientationFor(puzzle) {
  const userColor = puzzle.userColorName === 'Black' ? 'b'
                  : puzzle.userColorName === 'White' ? 'w'
                  : puzzle.fen.split(' ')[1];
  return userColor === 'b'
    ? { files: FILES_FLIP, ranks: RANKS_FLIP }
    : { files: FILES_STD, ranks: RANKS_STD };
}

export function buildPositionSummary(fen) {
  const c = new Chess(fen);
  const board = c.board();
  const matVal = { Q: 9, R: 5, B: 3, N: 3, P: 1 };
  const counts = { w: {K:0,Q:0,R:0,B:0,N:0,P:0}, b: {K:0,Q:0,R:0,B:0,N:0,P:0} };
  const locs   = { w: {K:[],Q:[],R:[],B:[],N:[],P:[]}, b: {K:[],Q:[],R:[],B:[],N:[],P:[]} };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f]; if (!p) continue;
    counts[p.color][p.type.toUpperCase()]++;
    locs[p.color][p.type.toUpperCase()].push(FILES_STD[f] + RANKS_STD[r]);
  }
  const wPts = ['Q','R','B','N','P'].reduce((s, t) => s + matVal[t] * counts.w[t], 0);
  const bPts = ['Q','R','B','N','P'].reduce((s, t) => s + matVal[t] * counts.b[t], 0);
  const fenParts = fen.split(' ');
  return {
    sideToMove: fenParts[1] === 'w' ? 'White' : 'Black',
    castling: fenParts[2] || '-',
    inCheck: c.inCheck(),
    counts, locations: locs,
    materialBalance: wPts - bPts,
    fen,
  };
}
export function summaryAsText(s) {
  if (!s) return '(no summary)';
  const pl = (color) => ['Q','R','B','N','P'].map(t => s.counts[color][t] ? `${s.counts[color][t]}${t}` : '').filter(Boolean).join(' ') || '(only king)';
  const ll = (color, type) => s.locations[color][type].join(', ') || '(none)';
  const bal = s.materialBalance === 0 ? 'equal' : s.materialBalance > 0 ? `White +${s.materialBalance}` : `Black +${-s.materialBalance}`;
  return [
    `Side to move: ${s.sideToMove}`,
    `${s.sideToMove} in check: ${s.inCheck ? 'YES' : 'no'}`,
    `Material balance: ${bal}`,
    `White pieces: ${pl('w')}  ·  Black pieces: ${pl('b')}`,
    `White king on ${ll('w','K')}, Black king on ${ll('b','K')}`,
    `White queens: ${ll('w','Q')}  ·  Black queens: ${ll('b','Q')}`,
    `White rooks: ${ll('w','R')}  ·  Black rooks: ${ll('b','R')}`,
    `White bishops: ${ll('w','B')}  ·  Black bishops: ${ll('b','B')}`,
    `White knights: ${ll('w','N')}  ·  Black knights: ${ll('b','N')}`,
    `White pawns: ${ll('w','P')}  ·  Black pawns: ${ll('b','P')}`,
  ].join('\n');
}

// ============================================================================
// SECTION 6 — Engine
// ============================================================================
const SF_URL = '/engine/stockfish-17.1-lite-single-03e3232.js';
let stockfish = null;

export function sfWaitFor(matcher, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const t = setTimeout(() => { stockfish.removeEventListener('message', onMsg); reject(new Error(`timeout waiting for "${matcher}"`)); }, timeoutMs);
    function onMsg(e) {
      const msg = typeof e.data === 'string' ? e.data : '';
      messages.push(msg);
      if (msg.includes(matcher)) {
        clearTimeout(t);
        stockfish.removeEventListener('message', onMsg);
        resolve({ matched: msg, all: messages });
      }
    }
    stockfish.addEventListener('message', onMsg);
  });
}
export function parseMultiPV(allMessages, numLines) {
  const linesByMpv = new Map();
  for (const msg of allMessages) {
    if (!msg.startsWith('info')) continue;
    const mpvMatch = msg.match(/\bmultipv\s+(\d+)/);
    if (!mpvMatch) continue;
    const scoreMatch = msg.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    const pvMatch = msg.match(/\bpv\s+(.+)$/);
    if (!scoreMatch || !pvMatch) continue;
    linesByMpv.set(parseInt(mpvMatch[1], 10), {
      scoreType: scoreMatch[1],
      scoreVal: parseInt(scoreMatch[2], 10),
      pvMoves: pvMatch[1].trim().split(/\s+/),
    });
  }
  const out = [];
  for (let i = 1; i <= numLines; i++) if (linesByMpv.has(i)) out.push(linesByMpv.get(i));
  return out;
}
export function pvToSan(fen, pvUcis) {
  const c = new Chess(fen);
  const sans = [];
  for (const uci of pvUcis) {
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      if (!m) break;
      sans.push(m.san);
    } catch { break; }
  }
  return sans;
}
export async function initStockfish() {
  setInlineStatus('Loading engine…');
  stockfish = new Worker(SF_URL);
  stockfish.postMessage('uci');
  await sfWaitFor('uciok');
  stockfish.postMessage(`setoption name MultiPV value ${STOCKFISH_MULTIPV}`);
  stockfish.postMessage('isready');
  await sfWaitFor('readyok', 10000);
  setInlineStatus('');
  state.engineReady = true;
  $('coach-send').disabled = false;
  // Don't analyse if the queue is empty.
  if (state.phase === 'empty') return;
  await analyzePosition(state.chess.fen(), STOCKFISH_DEPTH);
  if (state.phase === 'idle') {
    if (state.reviewPuzzleId || state.mode === 'drill') {
      state.phase = 'playing';
    } else {
      state.phase = 'thinking';
      startThinkingGate();
    }
  }
  setInlineStatus('');
  renderBoard();
}
export async function analyzePosition(fen, depth) {
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage('position fen ' + fen);
  stockfish.postMessage(`go depth ${depth}`);
  const { all } = await sfWaitFor('bestmove');
  const parsed = parseMultiPV(all, STOCKFISH_MULTIPV);
  state.engineLines = parsed.map((line) => {
    const evalObj = line.scoreType === 'mate' ? { mate: line.scoreVal } : { cp: line.scoreVal };
    const pvSan = pvToSan(fen, line.pvMoves);
    return { uci: line.pvMoves[0] || '', san: pvSan[0] || line.pvMoves[0] || '', eval: evalObj, pvUci: line.pvMoves, pvSan };
  });
}
export function normalizeEval(evalObj) {
  if (!evalObj) return 0;
  if (evalObj.mate !== undefined) return evalObj.mate > 0 ? 10000 : -10000;
  return evalObj.cp || 0;
}
export function evalAsHuman(evalObj) {
  if (!evalObj) return 'unknown';
  if (evalObj.mate !== undefined) return `mate in ${evalObj.mate}`;
  return `${(evalObj.cp / 100).toFixed(2)} pawns`;
}

// ============================================================================
// SECTION 7 — Lightweight engine helpers (Phase 1b)
// These exports do NOT touch state.engineLines or any puzzle-page DOM.
// They are safe to import from endgames.html and endgame-recognition.html.
// ============================================================================

/**
 * initStockfishWorker(numPV)
 * Creates the Stockfish web worker, sends uci/isready, sets the module-level
 * `stockfish` variable. Does NOT touch any DOM or state.engineLines.
 * Safe to call from pages that don't have the puzzle page's DOM.
 */
export async function initStockfishWorker(numPV = 1) {
  stockfish = new Worker(SF_URL);
  stockfish.postMessage('uci');
  await sfWaitFor('uciok');
  stockfish.postMessage(`setoption name MultiPV value ${numPV}`);
  stockfish.postMessage('isready');
  await sfWaitFor('readyok', 15000);
}

/**
 * analyzePositionFast(fen, depth)
 * Runs Stockfish at the given depth with MultiPV 1.
 * Returns { uci, san, eval, pvUci, pvSan } or null on failure.
 * Does NOT write to state.engineLines.
 */
export async function analyzePositionFast(fen, depth = 9) {
  if (!stockfish) return null;
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage('position fen ' + fen);
  stockfish.postMessage(`go depth ${depth}`);
  const { all } = await sfWaitFor('bestmove');
  const parsed = parseMultiPV(all, 1);
  if (!parsed.length) return null;
  const line = parsed[0];
  const evalObj = line.scoreType === 'mate' ? { mate: line.scoreVal } : { cp: line.scoreVal };
  const pvSan = pvToSan(fen, line.pvMoves);
  return {
    uci: line.pvMoves[0] || '',
    san: pvSan[0] || line.pvMoves[0] || '',
    eval: evalObj,
    pvUci: line.pvMoves,
    pvSan,
  };
}
