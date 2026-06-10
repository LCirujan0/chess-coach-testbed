// ============================================================================
// js/calculation/boot.js. Spec 25 Calculation drills UI runner (v0.82).
// ----------------------------------------------------------------------------
// Clones the Board Vision scaffolding deliberately (same section ids + bv-*
// visual grammar styled by css/board-vision.css): hub -> runner -> complete.
// Generators are pure in ./generators.js; positions come from the bundled
// Lichess pack + the user's own mistake FENs. No engine, no network calls
// beyond the one static pack fetch. One storage key, synced (rule 14).
// ============================================================================
import { renderStaticBoard, PIECE_IMG } from '/js/board-static.js';
import { Chess } from '/js/vendor/chess-1.4.0.js';
import { makeGenerators, LINE_LEVELS, LINE_CHAIN, LINE_REPS, LINE_PASS, FORCER_REPS, FORCER_SECS } from './generators.js';

const KEY = 'chess-coach-calculation-v1';
const $ = (id) => document.getElementById(id);
const G = makeGenerators(Chess);

// 60-second blitz reference bands (same convention as Board Vision).
const FORCER_BANDS = [[12, 'Lightning'], [8, 'Strong'], [4, 'Solid club level'], [0, 'Getting started']];
const band = (score) => { for (const [min, label] of FORCER_BANDS) if (score >= min) return label; return 'Getting started'; };

// ----- storage -----
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || ''); if (v && typeof v === 'object') return normalize(v); } catch {}
  return normalize({});
}
function normalize(v) {
  return {
    completedDate: v.completedDate || null,
    line: { level: (v.line && v.line.level) || 1, levelScores: (v.line && v.line.levelScores) || {} },
    bests: { forcers60: (v.bests && v.bests.forcers60) || 0 },
    history: Array.isArray(v.history) ? v.history.slice(-90) : [], // {d,type,score,reps} for the Insights trend
  };
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function logHistory(type, score, reps) {
  const s = load();
  s.history.push({ d: todayISO(), type, score, reps });
  s.history = s.history.slice(-90);
  save(s);
}

// ----- position supply -----
let packCache = null;
async function getPack() {
  if (packCache) return packCache;
  const res = await fetch('/data/lichess-puzzles.json');
  packCache = await res.json();
  return packCache;
}
function ownFens() {
  try {
    const m = JSON.parse(localStorage.getItem('chess-coach-mistakes-v1') || '[]');
    return (Array.isArray(m) ? m : []).map((x) => x.fen).filter(Boolean);
  } catch { return []; }
}
async function forcerSupply() {
  // Own-game positions first (more personal), pack fills out the supply.
  const own = ownFens();
  if (own.length >= 12) return own;
  const pack = await getPack();
  return own.concat(pack.slice(0, 800).map((p) => p.fen));
}

// ----- view plumbing (Board Vision grammar) -----
function show(view) { for (const v of ['bv-hub', 'bv-drill', 'bv-complete']) $(v).classList.toggle('hidden', v !== view); }
const boardEl = () => $('bv-board');
let onTap = null;
let abortRep = null;
let quit = false;
// Each flow takes a fresh token; a loop whose token went stale stops dead.
// Without this, quitting during the 1.6s feedback beat and starting another
// drill leaves the old loop alive (quit gets reset to false by the new flow).
let runToken = 0;
function wireBoardOnce() {
  boardEl().addEventListener('click', (e) => { const sq = e.target.closest('.square'); if (sq && sq.dataset.square && onTap) onTap(sq.dataset.square); });
}
function mark(alg, cls) { const sq = boardEl().querySelector(`.square[data-square="${alg}"]`); if (sq) sq.classList.add(cls); }
function fmtSquares(text) { return String(text).replace(/\b([a-h][1-8])\b/g, '<b class="bv-sq">$1</b>'); }
function panels({ prompt, moves, question }) {
  $('bv-prompt-card').classList.toggle('hidden', !prompt);
  $('bv-moves-card').classList.toggle('hidden', !moves);
  $('bv-tracker-q').classList.toggle('hidden', !question);
}
function renderLineMoves(moves) {
  $('bv-moves').innerHTML = moves.map((m, i) =>
    `<div class="bv-move"><span class="bv-move-n">${i + 1}</span>` +
    (m.piece ? `<img class="bv-move-pc" src="${PIECE_IMG(m.color, m.piece)}" alt="" draggable="false">` : '') +
    `<span class="bv-move-lb">${fmtSquares(m.text)}</span></div>`).join('');
}
function setPersp(color) {
  const head = document.querySelector('.bv-drill-head');
  let p = head && head.querySelector('.bv-pers');
  if (head && !p) { p = document.createElement('span'); p.className = 'bv-pers'; head.insertBefore(p, head.lastElementChild); }
  if (p) p.textContent = color === 'b' ? "Black's view" : "White's view";
}

// ----- Follow the line rep -----
function runLineRep(q) {
  return new Promise((resolve) => {
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.startFen, { orientation: q.userColor });
    setPersp(q.userColor);
    $('bv-prompt').innerHTML = 'Board frozen at the start. Picture the line, then answer.';
    $('bv-prompt-card').classList.remove('bv-big');
    renderLineMoves(q.moves);
    const qEl = $('bv-tracker-q');
    $('bv-feedback').textContent = '';
    panels({ prompt: true, moves: true, question: true });
    abortRep = () => { onTap = null; abortRep = null; resolve(null); };

    const finish = (correct, tappedSq) => {
      onTap = null; abortRep = null;
      // Reveal: render the true final position with the answer marked.
      renderStaticBoard(boardEl(), q.finalFen, { orientation: q.userColor });
      if (q.question.mode === 'tap') {
        mark(q.question.answer, 'bv-correct');
        if (!correct && tappedSq && tappedSq !== q.question.answer) mark(tappedSq, 'bv-wrong');
      }
      $('bv-feedback').textContent = correct ? 'Correct' : `Answer: ${q.question.answer}`;
      $('bv-feedback').className = 'bv-feedback ' + (correct ? 'ok' : 'bad');
      setTimeout(() => resolve(correct), correct ? 700 : 1600);
    };

    if (q.question.mode === 'tap') {
      qEl.innerHTML = `<div class="bv-panel-h">Now answer</div><div class="bv-q-prompt">${fmtSquares(q.question.prompt)}</div>`;
      for (const o of q.question.options) mark(o, 'bv-option');
      onTap = (sq) => { if (!q.question.options.includes(sq)) return; finish(sq === q.question.answer, sq); };
    } else {
      qEl.innerHTML = `<div class="bv-panel-h">Now answer</div><div class="bv-q-prompt">${fmtSquares(q.question.prompt)}</div><div class="bv-choices">` +
        q.question.options.map((o) => `<button class="btn bv-choice" type="button" data-v="${o}">${o}</button>`).join('') + '</div>';
      qEl.querySelectorAll('.bv-choice').forEach((b) => b.addEventListener('click', () => finish(b.dataset.v === q.question.answer)));
    }
  });
}

async function runLineDrill(reps) {
  const token = runToken;
  const level = load().line.level;
  $('bv-drill-title').textContent = `Follow the line · Level ${level} (${LINE_CHAIN[level]} moves)`;
  show('bv-drill');
  const pack = await getPack();
  let score = 0, played = 0;
  for (let i = 0; i < reps; i++) {
    if (quit || token !== runToken) break;
    const q = G.genLine(pack, level);
    if (!q) continue;
    played++;
    $('bv-drill-rep').textContent = `${i + 1} / ${reps}`;
    const r = await runLineRep(q);
    if (r === null || quit || token !== runToken) break;
    if (r) score++;
  }
  if (played && score / played >= LINE_PASS && reps >= LINE_REPS) {
    const s = load();
    s.line.levelScores[level] = score;
    if (level === s.line.level && level < LINE_LEVELS) s.line.level = level + 1;
    save(s);
  }
  if (played) logHistory('line', score, played);
  return { score, played };
}

// ----- Count the forcers rep (20s cap per question, spec) -----
function runForcerRep(q, secs) {
  return new Promise((resolve) => {
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.fen, { orientation: q.orientation });
    setPersp(q.orientation);
    $('bv-prompt').innerHTML = fmtSquares(q.prompt);
    $('bv-prompt-card').classList.remove('bv-big');
    const qEl = $('bv-tracker-q');
    $('bv-feedback').textContent = '';
    panels({ prompt: true, question: true });
    qEl.innerHTML = `<div class="bv-panel-h">Your count${secs ? ` · <span id="cd-timer">${secs}s</span>` : ''}</div><div class="bv-choices">` +
      q.options.map((o) => `<button class="btn bv-choice" type="button" data-v="${o}">${o}</button>`).join('') + '</div>';
    let timer = null, left = secs;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const finish = (correct, timedOut) => {
      stop(); abortRep = null;
      $('bv-feedback').textContent = correct ? 'Correct' : (timedOut ? `Time. It was ${q.answer}.` : `It was ${q.answer}`);
      $('bv-feedback').className = 'bv-feedback ' + (correct ? 'ok' : 'bad');
      setTimeout(() => resolve(correct), correct ? 500 : 1200);
    };
    abortRep = () => { stop(); abortRep = null; resolve(null); };
    if (secs) {
      timer = setInterval(() => {
        left--;
        const t = document.getElementById('cd-timer');
        if (t) t.textContent = left + 's';
        if (left <= 0) finish(false, true);
      }, 1000);
    }
    qEl.querySelectorAll('.bv-choice').forEach((b) => b.addEventListener('click', () => finish(G.grade(q, b.dataset.v))));
  });
}

async function runForcerDrill(reps) {
  const token = runToken;
  $('bv-drill-title').textContent = 'Count the forcers';
  show('bv-drill');
  const fens = await forcerSupply();
  let score = 0, played = 0;
  for (let i = 0; i < reps; i++) {
    if (quit || token !== runToken) break;
    const q = G.genForcers(fens, i % 2 === 0 ? 'checks' : 'captures');
    if (!q) continue;
    played++;
    $('bv-drill-rep').textContent = `${i + 1} / ${reps}`;
    const r = await runForcerRep(q, FORCER_SECS);
    if (r === null || quit || token !== runToken) break;
    if (r) score++;
  }
  if (played) logHistory('forcers', score, played);
  return { score, played };
}

// ----- 60-second forcers blitz (best mark kept, banded) -----
async function runBlitz() {
  quit = false;
  const token = ++runToken;
  $('bv-drill-title').textContent = 'Count the forcers · 60s blitz';
  show('bv-drill');
  const fens = await forcerSupply();
  const deadline = Date.now() + 60000;
  let score = 0, i = 0;
  while (Date.now() < deadline && !quit && token === runToken) {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('bv-drill-rep').textContent = `⏱ ${left}s · ${score}`;
    const q = G.genForcers(fens, i++ % 2 === 0 ? 'checks' : 'captures');
    if (!q) break;
    const r = await runForcerRep(q, 0);
    if (r === null || quit) break;
    if (r) score++;
  }
  if (quit) { show('bv-hub'); renderHub(); return; }
  const s = load();
  const prevBest = s.bests.forcers60 || 0;
  const isBest = score > prevBest;
  if (isBest) { s.bests.forcers60 = score; save(s); }
  logHistory('forcers60', score, null);
  show('bv-complete');
  $('bv-complete-h').textContent = isBest ? 'New best!' : 'Time!';
  $('bv-scores').innerHTML =
    `<div class="bv-score-row"><span>Count the forcers · 60 seconds</span><b>${score} correct</b></div>` +
    `<div class="bv-score-row"><span>Your best</span><b>${Math.max(score, prevBest)}</b></div>` +
    `<div class="bv-score-row"><span>That makes you</span><b>${band(Math.max(score, prevBest))}</b></div>`;
  $('bv-coach').textContent = isBest
    ? 'A new personal best. The CCTO scan is getting automatic.'
    : (prevBest ? `Best so far: ${prevBest}. One focused minute a day moves this fast.` : 'First mark set. Beat it tomorrow.');
  const actions = $('bv-complete-actions');
  actions.innerHTML = '<button class="btn primary" id="cd-blitz-again" type="button">Run it again ⚡</button><button class="btn ghost" id="cd-back" type="button">Back to Calculation</button>';
  $('cd-blitz-again').addEventListener('click', () => runBlitz());
  $('cd-back').addEventListener('click', () => { show('bv-hub'); renderHub(); });
}

// ----- flows -----
async function runFull(opts = {}) {
  quit = false;
  const token = ++runToken;
  const line = await runLineDrill(opts.session ? 3 : LINE_REPS);
  if (token !== runToken) return; // a newer flow took over
  if (quit) { show('bv-hub'); renderHub(); return; }
  const forcers = await runForcerDrill(opts.session ? 3 : FORCER_REPS);
  if (token !== runToken) return;
  if (quit) { show('bv-hub'); renderHub(); return; }
  const s = load();
  s.completedDate = todayISO();
  save(s);
  complete({ line, forcers }, opts);
}

async function runSolo(name) {
  quit = false;
  const token = ++runToken;
  const r = name === 'line' ? await runLineDrill(LINE_REPS) : await runForcerDrill(FORCER_REPS);
  if (token !== runToken) return; // a newer flow took over
  if (quit) { show('bv-hub'); renderHub(); return; }
  complete({ [name]: r }, { solo: true });
}

function complete(scores, opts) {
  show('bv-complete');
  $('bv-complete-h').textContent = 'Nice work';
  const rows = [];
  if (scores.line) rows.push(`<div class="bv-score-row"><span>Follow the line</span><b>${scores.line.score} / ${scores.line.played}</b></div>`);
  if (scores.forcers) rows.push(`<div class="bv-score-row"><span>Count the forcers</span><b>${scores.forcers.score} / ${scores.forcers.played}</b></div>`);
  $('bv-scores').innerHTML = rows.join('');
  const pct = (r) => r && r.played ? r.score / r.played : 1;
  $('bv-coach').textContent =
    pct(scores.line) < 0.6 ? 'Lines slip away near the end. That is normal: hold the last move in words ("knight on g5") and the square comes back.' :
    pct(scores.forcers) < 0.6 ? 'The forcer scan needs reps. Checks first, every time: scan the king, then the captures.' :
    'Sharp calculation today. Longer lines unlock as you pass levels.';
  const actions = $('bv-complete-actions');
  if (opts.session) actions.innerHTML = '<a class="btn primary" href="/session.html">Continue session →</a><a class="btn ghost" href="/today.html">Back to Today</a>';
  else { actions.innerHTML = '<button class="btn" id="cd-back" type="button">Back to Calculation</button>'; $('cd-back').addEventListener('click', () => { show('bv-hub'); renderHub(); }); }
}

// ----- hub -----
function renderHub() {
  const s = load();
  const lineCard = document.querySelector('.bv-card[data-drill="line"] .bv-card-m');
  if (lineCard) lineCard.textContent = `Level ${s.line.level}/${LINE_LEVELS}`;
  const fCard = document.querySelector('.bv-card[data-drill="forcers"]');
  if (fCard && !fCard.querySelector('.bv-blitz')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bv-blitz';
    btn.addEventListener('click', (e) => { e.stopPropagation(); runBlitz(); });
    fCard.appendChild(btn);
  }
  const btn = fCard && fCard.querySelector('.bv-blitz');
  if (btn) {
    const best = s.bests.forcers60 || 0;
    btn.innerHTML = `⚡ 60s${best ? ` <small>best ${best} · ${band(best)}</small>` : ''}`;
    btn.title = '60-second blitz: as many counts as you can. Your best mark is kept.';
  }
}

// ----- boot -----
wireBoardOnce();
renderHub();
$('bv-start-all').addEventListener('click', () => runFull());
for (const card of document.querySelectorAll('.bv-card')) {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.bv-blitz')) return;
    runSolo(card.dataset.drill);
  });
}
$('bv-quit').addEventListener('click', () => { quit = true; onTap = null; if (abortRep) abortRep(); });

if (new URLSearchParams(location.search).get('session') === '1') runFull({ session: true });
