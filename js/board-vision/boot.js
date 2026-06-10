// ============================================================================
// js/board-vision/boot.js. Spec 14 Board Vision UI runner.
// ----------------------------------------------------------------------------
// Drives the hub, the three foundational drills, the 6-level hide-the-board
// tracker, and the complete screen. Pure client-side: generators in
// ./generators.js + ./tracker.js, board via the canonical js/board-static.js,
// state in one localStorage key.
// ============================================================================
import { renderStaticBoard, PIECE_IMG } from '/js/board-static.js';
import { REPS, genCoord, genKnight, genWalk, grade } from './generators.js';
import { genTracker, TRACKER_REPS, TRACKER_PASS, TRACKER_LEVELS } from './tracker.js';

const KEY = 'chess-coach-board-vision-v1';
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEN = { coord: genCoord, knight: genKnight, walk: genWalk };
const TITLE = { coord: 'Coordinate Snap', knight: 'Knight Vision', walk: 'Piece Walk' };
const TIMING = { coord: { ok: 200, bad: 800 }, knight: { ok: 400, bad: 900 }, walk: { ok: 400, bad: 900 } };

// ----- storage -----
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || ''); if (v && typeof v === 'object') return normalize(v); } catch {}
  return normalize({});
}
function normalize(v) {
  return {
    completedDate: v.completedDate || null,
    streak: v.streak || 0,
    scores: v.scores || { coord: 0, knight: 0, walk: 0 },
    coordPerfectStreak: v.coordPerfectStreak || 0,
    tracker: { level: (v.tracker && v.tracker.level) || 1, levelScores: (v.tracker && v.tracker.levelScores) || {} },
    // v0.81: walk levels (chain length grows) + 60-second blitz best marks.
    walk: { level: (v.walk && v.walk.level) || 1, levelScores: (v.walk && v.walk.levelScores) || {} },
    bests: { coord60: (v.bests && v.bests.coord60) || 0, knight60: (v.bests && v.bests.knight60) || 0 },
  };
}

// Walk level -> moves to visualise. 3 levels, each procedurally infinite
// (well past the owner's 20-distinct-per-level floor; a per-run dedupe set
// also guarantees no repeats inside a session).
const WALK_CHAIN = { 1: 2, 2: 3, 3: 4 };
const WALK_LEVELS = 3;
const WALK_PASS = 0.8;

// 60-second blitz reference bands (correct answers in 60s) so a best mark
// MEANS something (owner ask: "a reference on how good your mark is").
const BLITZ_BANDS = {
  coord:  [[28, 'Lightning'], [18, 'Strong'], [10, 'Solid club level'], [0, 'Getting started']],
  knight: [[20, 'Lightning'], [13, 'Strong'], [7, 'Solid club level'], [0, 'Getting started']],
};
function blitzBand(name, score) { for (const [min, label] of BLITZ_BANDS[name]) if (score >= min) return label; return 'Getting started'; }

// Square references in prompts render as little board chips (visual, not a
// wall of text) + the per-run no-repeat guard.
function fmtPrompt(text) { return String(text).replace(/\b([a-h][1-8])\b/g, '<b class="bv-sq">$1</b>'); }
let seenPrompts = new Set();
function freshQuestion(genFn) {
  for (let i = 0; i < 30; i++) {
    const q = genFn();
    const key = q.prompt + '|' + q.answer;
    if (!seenPrompts.has(key)) { seenPrompts.add(key); return q; }
  }
  return genFn(); // astronomically unlikely to be needed
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// ----- view + board -----
function show(view) { for (const v of ['bv-hub', 'bv-drill', 'bv-complete']) $(v).classList.toggle('hidden', v !== view); }
const boardEl = () => $('bv-board');
let onTap = null;
let abortRep = null;
function wireBoardOnce() {
  boardEl().addEventListener('click', (e) => { const sq = e.target.closest('.square'); if (sq && sq.dataset.square && onTap) onTap(sq.dataset.square); });
}
function mark(alg, cls) { const sq = boardEl().querySelector(`.square[data-square="${alg}"]`); if (sq) sq.classList.add(cls); }
function panels({ prompt, moves, question }) {
  $('bv-prompt-card').classList.toggle('hidden', !prompt);
  $('bv-moves-card').classList.toggle('hidden', !moves);
  $('bv-tracker-q').classList.toggle('hidden', !question);
}
function renderMoves(moves) {
  $('bv-moves').innerHTML = moves.map((m, i) =>
    `<div class="bv-move"><span class="bv-move-n">${i + 1}</span>` +
    `<img class="bv-move-pc" src="${PIECE_IMG(m.color, m.piece)}" alt="" draggable="false">` +
    `<span class="bv-move-ar">${m.arrow}</span><span class="bv-move-lb">${m.label}</span></div>`).join('');
}
let quit = false;

// ----- foundational drill rep -----
function runRep(q, timing) {
  return new Promise((resolve) => {
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.board, { orientation: 'w' });
    $('bv-prompt').innerHTML = fmtPrompt(q.prompt);
    $('bv-prompt-card').classList.toggle('bv-big', q.drill === 'coord');
    panels({ prompt: true });
    $('bv-feedback').textContent = '';
    if (q.origin) mark(q.origin, 'bv-origin');
    const optionSet = q.options ? new Set(q.options) : null;
    if (optionSet) for (const o of q.options) mark(o, 'bv-option');
    abortRep = () => { onTap = null; abortRep = null; resolve(null); };
    onTap = (sq) => {
      if (optionSet && !optionSet.has(sq)) return;
      onTap = null; abortRep = null;
      const ok = grade(q, sq);
      mark(sq, ok ? 'bv-correct' : 'bv-wrong');
      if (!ok) mark(q.answer, 'bv-correct');
      $('bv-feedback').textContent = ok ? 'Correct' : `It was ${q.answer}`;
      $('bv-feedback').className = 'bv-feedback ' + (ok ? 'ok' : 'bad');
      setTimeout(() => resolve(ok), ok ? timing.ok : timing.bad);
    };
  });
}

async function runDrill(name) {
  const walkLevel = (name === 'walk') ? load().walk.level : null;
  $('bv-drill-title').textContent = TITLE[name] + (walkLevel ? ` · Level ${walkLevel}` : '');
  show('bv-drill');
  seenPrompts = new Set(); // no repeated question within a run (owner fix)
  const gen = (name === 'walk') ? () => genWalk(WALK_CHAIN[walkLevel] || 2) : GEN[name];
  let score = 0;
  for (let i = 0; i < REPS[name]; i++) {
    if (quit) return score;
    $('bv-drill-rep').textContent = `${i + 1} / ${REPS[name]}`;
    const r = await runRep(freshQuestion(gen), TIMING[name]);
    if (r === null || quit) return score;
    if (r) score++;
  }
  // Walk levels: a strong run unlocks the next chain length.
  if (name === 'walk' && walkLevel && score / REPS.walk >= WALK_PASS) {
    const s = load();
    s.walk.levelScores[walkLevel] = score;
    if (walkLevel === s.walk.level && walkLevel < WALK_LEVELS) s.walk.level = walkLevel + 1;
    save(s);
  }
  return score;
}

// 60-second blitz (owner ask): as many as possible in 60s, best mark kept,
// banded reference so the number means something.
async function runBlitz(name) {
  quit = false;
  seenPrompts = new Set();
  $('bv-drill-title').textContent = TITLE[name] + ' · 60s blitz';
  show('bv-drill');
  const deadline = Date.now() + 60000;
  let score = 0, attempted = 0;
  const timing = { ok: 120, bad: 550 }; // blitz pace: fast confirmations
  while (Date.now() < deadline && !quit) {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $('bv-drill-rep').textContent = `⏱ ${left}s · ${score}`;
    const r = await runRep(freshQuestion(GEN[name]), timing);
    if (r === null || quit) break;
    attempted++;
    if (r) score++;
  }
  if (quit) { show('bv-hub'); renderHub(); return; }
  const s = load();
  const bestKey = name + '60';
  const prevBest = s.bests[bestKey] || 0;
  const isBest = score > prevBest;
  if (isBest) { s.bests[bestKey] = score; save(s); }
  show('bv-complete');
  $('bv-complete-h').textContent = isBest ? 'New best!' : 'Time!';
  $('bv-scores').innerHTML =
    `<div class="bv-score-row"><span>${TITLE[name]} · 60 seconds</span><b>${score} correct</b></div>` +
    `<div class="bv-score-row"><span>Your best</span><b>${Math.max(score, prevBest)}</b></div>` +
    `<div class="bv-score-row"><span>That makes you</span><b>${blitzBand(name, Math.max(score, prevBest))}</b></div>`;
  $('bv-coach').textContent = isBest
    ? 'A new personal best. Tomorrow it gets one harder.'
    : (prevBest ? `Best so far: ${prevBest}. One focused minute a day moves this fast.` : 'First mark set. Beat it tomorrow.');
  const actions = $('bv-complete-actions');
  actions.innerHTML = '<button class="btn primary" id="bv-blitz-again" type="button">Run it again ⚡</button><button class="btn ghost" id="bv-again" type="button">Back to Board Vision</button>';
  $('bv-blitz-again').addEventListener('click', () => runBlitz(name));
  $('bv-again').addEventListener('click', () => { show('bv-hub'); renderHub(); });
}

// ----- tracker rep (show -> hide -> read -> answer -> replay) -----
function runTrackerRep(q) {
  return new Promise((resolve) => {
    $('bv-drill-title').textContent = `Sequence tracker · Level ${q.level}`;
    $('bv-prompt').textContent = 'Watch the position, then picture the moves.';
    $('bv-tracker-q').innerHTML = '';
    panels({ prompt: true });
    $('bv-feedback').textContent = '';
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.startFen, { orientation: 'w' });

    const finish = (correct, tappedSq) => {
      onTap = null; abortRep = null;
      boardEl().classList.remove('bv-hidden');
      renderStaticBoard(boardEl(), q.finalFen, { orientation: 'w' });
      // Replay the true path: each move's origin (amber) -> landing (green).
      for (const m of q.moves) { mark(m.from, 'bv-origin'); mark(m.to, 'bv-correct'); }
      // On a wrong tap-question, mark where the student tapped (red).
      if (!correct && tappedSq && tappedSq !== q.question.answer) mark(tappedSq, 'bv-wrong');
      $('bv-feedback').textContent = correct ? 'Correct' : `Answer: ${q.question.answer}`;
      $('bv-feedback').className = 'bv-feedback ' + (correct ? 'ok' : 'bad');
      setTimeout(() => resolve(correct), 1500);
    };
    abortRep = () => { onTap = null; abortRep = null; resolve(null); };

    const ask = () => {
      boardEl().classList.add('bv-hidden'); // pieces hidden, visualise from here
      renderMoves(q.moves);
      panels({ moves: true, question: true });
      const qEl = $('bv-tracker-q');
      // Same visual grammar as the moves card: a panel header + chip-formatted
      // squares (owner 2026-06-10: the count question card read as bare text).
      if (q.question.mode === 'tap') {
        qEl.innerHTML = `<div class="bv-panel-h">Now answer</div><div class="bv-q-prompt">${fmtPrompt(q.question.prompt)}</div>`;
        for (const o of q.question.options) mark(o, 'bv-option');
        onTap = (sq) => { if (!q.question.options.includes(sq)) return; finish(sq === q.question.answer, sq); };
      } else {
        qEl.innerHTML = `<div class="bv-panel-h">Now answer</div><div class="bv-q-prompt">${fmtPrompt(q.question.prompt)}</div><div class="bv-choices">` +
          q.question.options.map((o) => `<button class="btn bv-choice" type="button" data-v="${o}">${o}</button>`).join('') + '</div>';
        qEl.querySelectorAll('.bv-choice').forEach((b) => b.addEventListener('click', () => finish(b.dataset.v === q.question.answer)));
      }
    };
    setTimeout(ask, q.showMs);
  });
}

async function runTrackerLevel(level) {
  show('bv-drill');
  let score = 0, played = 0;
  for (let i = 0; i < TRACKER_REPS; i++) {
    if (quit) break;
    const q = genTracker(level);
    if (!q) continue;
    played++;
    $('bv-drill-rep').textContent = `${i + 1} / ${TRACKER_REPS}`;
    const r = await runTrackerRep(q);
    if (r === null || quit) break;
    if (r) score++;
  }
  return { score, played };
}

// ----- flows -----
async function runWarmup(opts = {}) {
  quit = false;
  const scores = {};
  for (const name of ['coord', 'knight', 'walk']) {
    const s = await runDrill(name);
    if (quit) { show('bv-hub'); renderHub(); return; }
    scores[name] = s;
  }
  const level = load().tracker.level;
  const t = await runTrackerLevel(level);
  if (quit) { show('bv-hub'); renderHub(); return; }
  scores.tracker = { level, score: t.score, reps: t.played || TRACKER_REPS };
  complete(scores, opts);
}

async function runSolo(name) {
  quit = false;
  const score = await runDrill(name);
  if (quit) { show('bv-hub'); renderHub(); return; }
  complete({ [name]: score }, { solo: true });
}

async function runTrackerSolo(level) {
  quit = false;
  const t = await runTrackerLevel(level);
  if (quit) { show('bv-hub'); renderHub(); return; }
  if (t.score / Math.max(1, t.played) >= TRACKER_PASS) bumpLevel(level, t.score);
  complete({ tracker: { level, score: t.score, reps: t.played || TRACKER_REPS } }, { solo: true });
}

function complete(scores, opts) {
  const full = scores.coord != null && scores.knight != null && scores.walk != null;
  if (full && !opts.solo) writeCompletion(scores);
  show('bv-complete');
  $('bv-complete-h').textContent = 'Nice work';
  const rows = [];
  for (const k of ['coord', 'knight', 'walk']) if (scores[k] != null) rows.push(`<div class="bv-score-row"><span>${TITLE[k]}</span><b>${scores[k]} / ${REPS[k]}</b></div>`);
  if (scores.tracker) rows.push(`<div class="bv-score-row"><span>Tracker · Level ${scores.tracker.level}</span><b>${scores.tracker.score} / ${scores.tracker.reps}</b></div>`);
  $('bv-scores').innerHTML = rows.join('');
  $('bv-coach').textContent = coachLine(scores);
  const actions = $('bv-complete-actions');
  if (opts.session) actions.innerHTML = '<a class="btn primary" href="/session.html">Continue session →</a><a class="btn ghost" href="/today.html">Back to Today</a>';
  else { actions.innerHTML = '<button class="btn" id="bv-again" type="button">Back to Board Vision</button>'; $('bv-again').addEventListener('click', () => { show('bv-hub'); renderHub(); }); }
}

function coachLine(scores) {
  const pct = (k) => scores[k] == null ? 1 : scores[k] / REPS[k];
  if (pct('knight') < 0.7) return 'Knight Vision, keep practising. The L-shape gets automatic with about two weeks of daily drills.';
  if (pct('walk') < 0.7) return 'Piece Walk, 2-move chains take a few weeks to feel natural. Stick with it.';
  if (pct('coord') >= 0.8 && pct('knight') >= 0.8 && pct('walk') >= 0.8) return 'Sharp today, your board sight is solid. Keep the daily streak going.';
  return 'Good warm-up. A little daily practice and these get automatic.';
}

function bumpLevel(level, score) {
  const s = load();
  if (level === s.tracker.level && level < TRACKER_LEVELS) s.tracker.level = level + 1;
  s.tracker.levelScores[level] = score;
  save(s);
}

function writeCompletion(scores) {
  const s = load();
  const today = todayISO();
  if (s.completedDate !== today) {
    const cont = s.completedDate === isoDaysAgo(1);
    s.streak = cont ? (s.streak || 0) + 1 : 1;
    s.coordPerfectStreak = (scores.coord === REPS.coord) ? (cont ? (s.coordPerfectStreak || 0) + 1 : 1) : 0;
    s.completedDate = today;
  }
  s.scores = { coord: scores.coord, knight: scores.knight, walk: scores.walk };
  if (scores.tracker && scores.tracker.reps && scores.tracker.score / scores.tracker.reps >= TRACKER_PASS && scores.tracker.level === s.tracker.level && s.tracker.level < TRACKER_LEVELS) {
    s.tracker.level += 1;
  }
  if (scores.tracker) s.tracker.levelScores[scores.tracker.level] = scores.tracker.score;
  save(s);
}

// ----- hub -----
function renderHub() {
  const s = load();
  $('bv-streak').textContent = s.streak > 0 ? `🔥 ${s.streak}` : '';
  $('bv-sharp').classList.toggle('hidden', (s.coordPerfectStreak || 0) < 3);
  // Blitz buttons + best marks on the coord/knight cards; walk level badge.
  for (const name of ['coord', 'knight']) {
    const card = document.querySelector(`.bv-card[data-drill="${name}"]`);
    if (card && !card.querySelector('.bv-blitz')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bv-blitz';
      btn.addEventListener('click', (e) => { e.stopPropagation(); runBlitz(name); });
      card.appendChild(btn);
    }
    const btn = card && card.querySelector('.bv-blitz');
    if (btn) {
      const best = s.bests[name + '60'] || 0;
      btn.innerHTML = `⚡ 60s${best ? ` <small>best ${best} · ${blitzBand(name, best)}</small>` : ''}`;
      btn.title = '60-second blitz: as many as you can. Your best mark is kept.';
    }
  }
  const walkCard = document.querySelector('.bv-card[data-drill="walk"] .bv-card-m');
  if (walkCard) walkCard.textContent = `Level ${s.walk.level}/${WALK_LEVELS}`;
  const level = s.tracker.level;
  const rungs = [];
  for (let n = 1; n <= TRACKER_LEVELS; n++) {
    const cls = n < level ? 'done' : (n === level ? 'cur' : 'lock');
    const lab = n < level ? '✓' : (n === level ? n : '🔒');
    const sc = s.tracker.levelScores[n];
    rungs.push(`<div class="bv-rung ${cls}" data-level="${n}"><span class="bv-rung-n">${lab}</span><span class="bv-rung-l">Level ${n} · ${n} move${n === 1 ? '' : 's'}</span>${sc != null ? `<span class="bv-rung-s">${sc}/${TRACKER_REPS}</span>` : ''}</div>`);
  }
  $('bv-ladder').innerHTML = rungs.join('');
  for (const r of $('bv-ladder').querySelectorAll('.bv-rung:not(.lock)')) r.addEventListener('click', () => runTrackerSolo(parseInt(r.dataset.level, 10)));
}

// ----- boot -----
wireBoardOnce();
// Coordinates are HIDDEN on the Board Vision board (owner 2026-06-10): the
// in-square labels literally spell out the answers to Coordinate Snap and
// crutch the others; the whole drill is knowing the grid without them.
boardEl().classList.add('bv-nocoords');
// All drills run from White's perspective; say so (owner: "I need to know if
// I'm playing black or white").
(() => {
  const head = document.querySelector('.bv-drill-head');
  if (head && !head.querySelector('.bv-pers')) {
    const p = document.createElement('span');
    p.className = 'bv-pers';
    p.textContent = 'White’s view';
    head.insertBefore(p, head.lastElementChild);
  }
})();
renderHub();
$('bv-start-all').addEventListener('click', () => runWarmup());
for (const card of document.querySelectorAll('.bv-card')) {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.bv-blitz')) return; // blitz button handles itself
    runSolo(card.dataset.drill);
  });
}
$('bv-quit').addEventListener('click', () => { quit = true; onTap = null; if (abortRep) abortRep(); });

if (new URLSearchParams(location.search).get('session') === '1') runWarmup({ session: true });
