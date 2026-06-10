import { STOCKFISH_MULTIPV } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { Chess } from './lib.js';
// ============================================================================
// SECTION 5. ENGINE (Stockfish over Web Worker)
// ----------------------------------------------------------------------------
// Same primitives as puzzle.html. We hold a single worker for the page,
// reused across many positions during ingestion.
// ============================================================================

const SF_URL = '/engine/stockfish-17.1-lite-single-03e3232.js';
let stockfish = null;

function sfWaitFor(matcher, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const t = setTimeout(() => {
      stockfish.removeEventListener('message', onMsg);
      reject(new Error(`timeout waiting for "${matcher}"`));
    }, timeoutMs);
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

function parseMultiPV(allMessages, numLines) {
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

function pvToSan(fen, pvUcis) {
  const c = new Chess(fen);
  const sans = [];
  for (const uci of pvUcis) {
    try {
      const m = c.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
      if (!m) break;
      sans.push(m.san);
    } catch { break; }
  }
  return sans;
}

async function initStockfish() {
  stockfish = new Worker(SF_URL);
  stockfish.postMessage('uci');
  await sfWaitFor('uciok');
  stockfish.postMessage(`setoption name MultiPV value ${STOCKFISH_MULTIPV}`);
  stockfish.postMessage('isready');
  await sfWaitFor('readyok', 10000);
  state.engineReady = true;
  $('ingest-btn').disabled = false;
  $('ingest-btn').textContent = 'Load and analyse';
}

async function analyzePositionMultiPV(fen, depth) {
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage('position fen ' + fen);
  stockfish.postMessage(`go depth ${depth}`);
  const { all } = await sfWaitFor('bestmove');
  const parsed = parseMultiPV(all, STOCKFISH_MULTIPV);
  return parsed.map((line) => {
    const evalObj = line.scoreType === 'mate' ? { mate: line.scoreVal } : { cp: line.scoreVal };
    const pvSan = pvToSan(fen, line.pvMoves);
    return {
      uci: line.pvMoves[0] || '',
      san: pvSan[0] || line.pvMoves[0] || '',
      eval: evalObj,
      pvUci: line.pvMoves,
      pvSan,
    };
  });
}

function normalizeEval(evalObj) {
  if (!evalObj) return 0;
  if (evalObj.mate !== undefined) return evalObj.mate > 0 ? 10000 : -10000;
  return evalObj.cp || 0;
}
export { initStockfish, analyzePositionMultiPV, normalizeEval };
