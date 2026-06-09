// Stockfish verification for the curated opening lines (data/openings/*.json).
// Loads the bundled engine + chess.js in a headless page; for every line it
// replays the moves (legality) and evaluates each WHITE repertoire move with
// MultiPV — flagging any move that is not in the engine's top 5 OR loses more
// than THRESHOLD cp vs the engine's best. Run with the static server on :4173.
//   node qa/scripts/verify-openings.cjs [path-to-json]
const { chromium } = require('playwright');
const path = require('path');
const jsonPath = process.argv[2] || path.join(__dirname, '../../data/openings/vienna.json');
const data = require(jsonPath);
const SF = '/engine/stockfish-17.1-lite-single-03e3232.js';
const DEPTH = 13, MULTIPV = 5, THRESHOLD = 80;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/openings.html', { waitUntil: 'domcontentloaded' });

  await page.evaluate(async (SF) => {
    const sf = new Worker(SF);
    window.__sf = sf;
    const msgText = (e) => (typeof e.data === 'string') ? e.data : (e.data && typeof e.data.data === 'string' ? e.data.data : '');
    await new Promise((res) => {
      const on = (e) => { const t = msgText(e); if (t.includes('uciok')) sf.postMessage('isready'); if (t.includes('readyok')) { sf.removeEventListener('message', on); res(); } };
      sf.addEventListener('message', on); sf.postMessage('uci');
    });
    const { Chess } = await import('https://esm.sh/chess.js@1.4.0');
    window.__Chess = Chess;
    window.__eval = (fen, depth, multipv) => new Promise((resolve) => {
      const lines = {};
      const on = (e) => {
        const t = msgText(e); if (!t) return;
        if (t.startsWith('info') && t.includes('multipv') && t.includes(' pv ')) {
          const mpv = +(t.match(/multipv (\d+)/) || [])[1];
          const mcp = t.match(/score cp (-?\d+)/), mm = t.match(/score mate (-?\d+)/);
          let cp = null;
          if (mcp) cp = +mcp[1]; else if (mm) cp = (+mm[1] > 0 ? 100000 - +mm[1] : -100000 - +mm[1]);
          const pv = (t.match(/ pv (\S+)/) || [])[1];
          if (mpv && pv) lines[mpv] = { move: pv, cp };
        } else if (t.startsWith('bestmove')) {
          sf.removeEventListener('message', on);
          resolve(Object.keys(lines).sort((a, b) => +a - +b).map((k) => lines[k]));
        }
      };
      sf.addEventListener('message', on);
      sf.postMessage('setoption name MultiPV value ' + multipv);
      sf.postMessage('position fen ' + fen);
      sf.postMessage('go depth ' + depth);
    });
  }, SF);

  const illegal = [], dubious = [];
  for (const line of data.lines) {
    const r = await page.evaluate(async ({ moves, depth, multipv }) => {
      const Chess = window.__Chess; const c = new Chess(); const out = { illegalAt: -1, checks: [] };
      for (let i = 0; i < moves.length; i++) {
        const fenBefore = c.fen(); const turn = c.turn();
        let mv = null; try { mv = c.move(moves[i]); } catch { mv = null; }
        if (!mv) { out.illegalAt = i; break; }
        if (turn === 'w') {
          const top = await window.__eval(fenBefore, depth, multipv);
          const playedKey = (mv.from + mv.to);
          const best = top[0];
          const found = top.find((t) => t.move && t.move.slice(0, 4) === playedKey);
          let playedCp = found ? found.cp : null;
          if (!found) {
            // Played move is outside the top-5 — eval the position AFTER it and
            // negate (now it's Black to move) to get the move's TRUE eval.
            const after = await window.__eval(c.fen(), depth, 1);
            if (after[0] && typeof after[0].cp === 'number') playedCp = -after[0].cp;
          }
          const loss = (best && playedCp != null) ? (best.cp - playedCp) : null;
          out.checks.push({ ply: i, san: moves[i], bestUci: best && best.move, bestCp: best && best.cp, playedCp, inTop: !!found, loss });
        }
      }
      return out;
    }, { moves: line.moves, depth: DEPTH, multipv: MULTIPV });

    if (r.illegalAt >= 0) illegal.push({ line: line.id, ply: r.illegalAt, san: line.moves[r.illegalAt] });
    for (const ch of r.checks) {
      if (!ch.inTop || (ch.loss != null && ch.loss > THRESHOLD)) {
        dubious.push({ line: line.id, ply: ch.ply, san: ch.san, best: ch.bestUci, bestCp: ch.bestCp, playedCp: ch.playedCp, loss: ch.loss, inTop: ch.inTop });
      }
    }
    console.log(line.id.padEnd(26), '— ' + r.checks.length + ' white moves', r.illegalAt >= 0 ? ('  ILLEGAL @ply ' + r.illegalAt + ' (' + line.moves[r.illegalAt] + ')') : '');
  }
  console.log('\n===== ILLEGAL MOVES =====');
  console.log(illegal.length ? JSON.stringify(illegal, null, 2) : '  none — all lines fully legal');
  console.log('\n===== DUBIOUS (not in engine top ' + MULTIPV + ', or loses >' + THRESHOLD + 'cp) =====');
  console.log(dubious.length ? JSON.stringify(dubious, null, 2) : '  none — every White move is engine-approved');
  await browser.close();
  process.exit(illegal.length ? 1 : 0);
})();
