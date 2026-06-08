// ============================================================================
// js/board-vision/boot.js — Spec 14 Board Vision UI runner.
// ----------------------------------------------------------------------------
// Drives the hub, the three foundational drills, the 6-level hide-the-board
// tracker, and the complete screen. Pure client-side: generators in
// ./generators.js + ./tracker.js, board via the canonical js/board-static.js,
// state in one localStorage key.
// ============================================================================
import { renderStaticBoard } from '/js/board-static.js';
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
  };
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
let quit = false;

// ----- foundational drill rep -----
function runRep(q, timing) {
  return new Promise((resolve) => {
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.board, { orientation: 'w' });
    $('bv-prompt').textContent = q.prompt;
    $('bv-tracker-q').classList.add('hidden');
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
  $('bv-drill-title').textContent = TITLE[name];
  show('bv-drill');
  let score = 0;
  for (let i = 0; i < REPS[name]; i++) {
    if (quit) return score;
    $('bv-drill-rep').textContent = `${i + 1} / ${REPS[name]}`;
    const r = await runRep(GEN[name](), TIMING[name]);
    if (r === null || quit) return score;
    if (r) score++;
  }
  return score;
}

// ----- tracker rep (show -> hide -> read -> answer -> replay) -----
function runTrackerRep(q) {
  return new Promise((resolve) => {
    $('bv-drill-title').textContent = `Sequence tracker · Level ${q.level}`;
    $('bv-prompt').textContent = 'Watch the position…';
    $('bv-tracker-q').classList.add('hidden');
    $('bv-tracker-q').innerHTML = '';
    $('bv-feedback').textContent = '';
    boardEl().classList.remove('bv-hidden');
    renderStaticBoard(boardEl(), q.startFen, { orientation: 'w' });

    const finish = (correct) => {
      onTap = null; abortRep = null;
      boardEl().classList.remove('bv-hidden');
      renderStaticBoard(boardEl(), q.finalFen, { orientation: 'w' });
      for (const m of q.moves) { mark(m.from, 'bv-origin'); mark(m.to, correct ? 'bv-correct' : 'bv-wrong'); }
      $('bv-feedback').textContent = correct ? 'Correct' : `Answer: ${q.question.answer}`;
      $('bv-feedback').className = 'bv-feedback ' + (correct ? 'ok' : 'bad');
      setTimeout(() => resolve(correct), 1500);
    };
    abortRep = () => { onTap = null; abortRep = null; resolve(null); };

    const ask = () => {
      boardEl().classList.add('bv-hidden'); // pieces hidden — visualise from here
      $('bv-prompt').innerHTML = q.moves.map((m, i) => `<div class="bv-mv"><b>Move ${i + 1}:</b> ${m.desc}</div>`).join('');
      const qEl = $('bv-tracker-q'); qEl.classList.remove('hidden');
      if (q.question.mode === 'tap') {
        qEl.innerHTML = `<div class="bv-q-prompt">${q.question.prompt}</div>`;
        for (const o of q.question.options) mark(o, 'bv-option');
        onTap = (sq) => { if (!q.question.options.includes(sq)) return; finish(sq === q.question.answer); };
      } else {
        qEl.innerHTML = `<div class="bv-q-prompt">${q.question.prompt}</div><div class="bv-choices">` +
          q.question.options.map((o) => `<button class="btn btn-secondary bv-choice" type="button" data-v="${o}">${o}</button>`).join('') + '</div>';
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
  if (opts.session) actions.innerHTML = '<a class="btn" href="/session.html">Continue session →</a><a class="btn btn-ghost" href="/today.html">Back to Today</a>';
  else { actions.innerHTML = '<button class="btn" id="bv-again" type="button">Back to Board Vision</button>'; $('bv-again').addEventListener('click', () => { show('bv-hub'); renderHub(); }); }
}

function coachLine(scores) {
  const pct = (k) => scores[k] == null ? 1 : scores[k] / REPS[k];
  if (pct('knight') < 0.7) return 'Knight Vision — keep practising. The L-shape gets automatic with about two weeks of daily drills.';
  if (pct('walk') < 0.7) return 'Piece Walk — 2-move chains take a few weeks to feel natural. Stick with it.';
  if (pct('coord') >= 0.8 && pct('knight') >= 0.8 && pct('walk') >= 0.8) return 'Sharp today — your board sight is solid. Keep the daily streak going.';
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
renderHub();
$('bv-start-all').addEventListener('click', () => runWarmup());
for (const card of document.querySelectorAll('.bv-card')) card.addEventListener('click', () => runSolo(card.dataset.drill));
$('bv-quit').addEventListener('click', () => { quit = true; onTap = null; if (abortRep) abortRep(); });

if (new URLSearchParams(location.search).get('session') === '1') runWarmup({ session: true });
