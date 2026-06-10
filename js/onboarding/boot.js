// ============================================================================
// js/onboarding/boot.js, the first-run experience (v0.80, owner spec).
//
// Flow: username → (returning user? skip straight ahead) → auto-ingest 20
// games with profile questions asked WHILE the engine works → 3 personal
// "wow" insights + a coach welcome card → 8-step skippable tour → first
// session CTA. Anonymous visitors land here via the js/sync.js gate; there is
// no other way into the app without a username (the product is worthless
// without your games, owner decision).
//
// Reuses the real pipeline: js/games/ingest.js + analysis.js (the page hosts
// the #progress/#progress-text/#progress-bar/#ingest-btn nodes they expect)
// and persistGameIncrementally from js/games/storage.js. Insights derive from
// js/chesscom-insights.js + CoachStats; the welcome card is ONE /api/coach
// call with a deterministic fallback.
// ============================================================================
import { ingest } from '/js/games/ingest.js';
import { initStockfish } from '/js/games/analysis.js';
import { persistGameIncrementally, loadMistakes } from '/js/games/storage.js';
import { tagAndSaveMistakes } from '/js/tagger.js';
import { renderCoachCard, parseCoachJson, ensureCoachCardStyles } from '/js/coach-card.js';
import { STORAGE_KEY_USERNAME } from '/js/puzzle/config.js';

const card = document.getElementById('ob-card');
const ONBOARD_GAMES = 20;
const ONBOARD_DEPTH = 12;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function loadJson(key, fb) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; } catch { return fb; } }
function getUsername() {
  try { const u = localStorage.getItem(STORAGE_KEY_USERNAME); return (u && /^[a-z0-9_-]{1,64}$/i.test(u)) ? u.toLowerCase() : null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Step 1, username (validated against the live Chess.com API)
// ---------------------------------------------------------------------------
function stepUsername() {
  card.innerHTML = `
    <h1>Welcome to KnightPath</h1>
    <div class="sub">Your personal chess coach. It studies the games you actually play, turns your real mistakes into training, and coaches you toward your goal, every day, a little better.</div>
    <input class="name" id="ob-name" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Your Chess.com username" aria-label="Chess.com username">
    <div class="err" id="ob-err"></div>
    <button class="btn primary" id="ob-go" type="button">Let’s look at your games</button>`;
  const input = document.getElementById('ob-name');
  const err = document.getElementById('ob-err');
  const go = document.getElementById('ob-go');
  const submit = async () => {
    const v = input.value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(v)) { err.textContent = 'Letters, numbers, - and _ only.'; err.style.display = 'block'; return; }
    go.disabled = true; go.textContent = 'Checking Chess.com…';
    try {
      const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(v)}`);
      if (r.status === 404) { err.textContent = 'No Chess.com account with that username, check the spelling.'; err.style.display = 'block'; go.disabled = false; go.textContent = 'Let’s look at your games'; return; }
    } catch { /* offline: accept and let sync/ingest surface it later */ }
    try { localStorage.setItem(STORAGE_KEY_USERNAME, v); } catch { }
    // Returning user? Pull their cloud state first, if their puzzles come
    // back, there is nothing to re-ingest (the whole point of keeping wiped
    // data in Supabase).
    go.textContent = 'Looking for synced training…';
    try { if (window.KPSync) await window.KPSync.syncOnLoad(); } catch { }
    if (loadMistakes().length >= 5) { stepInsights(true); return; }
    stepIngestIntro(v);
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

// ---------------------------------------------------------------------------
// Step 2, ingest 20 games (knight animation + real progress) while the
// profile questions are answered. Both must finish before moving on.
// ---------------------------------------------------------------------------
function stepIngestIntro(username) {
  // Time control is asked HERE (not during the wait) because the ingest itself
  // honours it, js/games/chesscom.js filters archives by the profile's
  // preferred time class, so it must be saved before the fetch starts.
  card.innerHTML = `
    <h1>Time to study your games</h1>
    <div class="sub">I’ll pull your last <b>${ONBOARD_GAMES} games</b> from Chess.com and analyse every move you played with a real chess engine. It takes <b>about two minutes</b>, and while the engine works, I have a few questions so I can coach <i>you</i>, not a generic student.</div>
    <div class="q" style="margin:0 0 16px;"><div class="qh">What do you mostly play?</div><div class="opts" id="ob-tc">
      <button type="button" class="opt on" data-v="rapid">Rapid</button>
      <button type="button" class="opt" data-v="blitz">Blitz</button>
      <button type="button" class="opt" data-v="bullet">Bullet</button>
      <button type="button" class="opt" data-v="classical">Classical</button>
    </div></div>
    <button class="btn primary" id="ob-start" type="button">Start the analysis</button>`;
  const tcHost = document.getElementById('ob-tc');
  tcHost.addEventListener('click', (e) => {
    const b = e.target.closest('.opt'); if (!b) return;
    tcHost.querySelectorAll('.opt').forEach((o) => o.classList.remove('on'));
    b.classList.add('on');
  });
  document.getElementById('ob-start').addEventListener('click', () => {
    const tc = tcHost.querySelector('.opt.on')?.dataset.v || 'rapid';
    try { if (typeof KPProfile !== 'undefined') KPProfile.write({ ...KPProfile.read(), timeControl: tc }); } catch { }
    stepIngestRun(username);
  });
}

const QUESTIONS = [
  { id: 'eloGoal', title: 'What rating are you aiming for?', opts: [
    { v: 1000, label: '1000' }, { v: 1200, label: '1200' }, { v: 1400, label: '1400' }, { v: 1600, label: '1600+' }] },
  { id: 'goalMonths', title: 'When do you want to get there?', opts: [
    { v: 3, label: 'In 3 months', small: 'ambitious' }, { v: 6, label: 'In 6 months', small: 'steady' }, { v: 12, label: 'Within a year', small: 'patient' }] },
  { id: 'seriousness', title: 'How serious are you about this?', opts: [
    { v: 'casual', label: 'Casual', small: 'a few minutes a day' }, { v: 'regular', label: 'Regular', small: 'a daily session' }, { v: 'serious', label: 'Serious', small: 'I want results' }] },
];

function stepIngestRun(username) {
  card.innerHTML = `
    <img class="knightpulse" src="/brand-icons/knight-mark-sm.png" alt="" aria-hidden="true">
    <h1 style="text-align:center;font-size:20px;">Analysing your games…</h1>
    <div class="sub" style="text-align:center;">Every move you played, checked by Stockfish. Keep this page open, it takes a couple of minutes.</div>
    <div class="progress" id="progress"><div id="progress-text">Warming the engine up…</div><div class="bar"><div class="bar-fill" id="progress-bar"></div></div></div>
    <div id="ob-questions"></div>
    <div class="stepfoot"><button class="btn primary hidden" id="ob-continue" type="button">See what I found →</button></div>`;

  const answers = {};
  let qIdx = 0;
  let ingestDone = false, ingestFailed = null;
  const qHost = document.getElementById('ob-questions');

  function renderQuestion() {
    if (qIdx >= QUESTIONS.length) {
      saveProfile(answers);
      qHost.innerHTML = `<div class="q-done">✓ Got it, your plan will be built around ${answers.eloGoal ? 'reaching ' + answers.eloGoal : 'your goal'}.</div>`;
      maybeContinue();
      return;
    }
    const q = QUESTIONS[qIdx];
    qHost.innerHTML = `<div class="q"><div class="qh">${esc(q.title)}</div><div class="opts">` +
      q.opts.map((o, i) => `<button type="button" class="opt" data-i="${i}">${esc(o.label)}${o.small ? `<small>${esc(o.small)}</small>` : ''}</button>`).join('') +
      `</div></div>`;
    qHost.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      answers[q.id] = q.opts[Number(b.dataset.i)].v;
      qIdx++; renderQuestion();
    }));
  }
  function maybeContinue() {
    const btn = document.getElementById('ob-continue');
    if (!btn) return;
    if (ingestFailed && qIdx >= QUESTIONS.length) {
      btn.classList.remove('hidden');
      btn.textContent = 'Continue anyway →';
      btn.onclick = () => stepInsights(false);
    } else if (ingestDone && qIdx >= QUESTIONS.length) {
      btn.classList.remove('hidden');
      btn.onclick = () => stepInsights(false);
    }
  }
  renderQuestion();

  (async () => {
    try {
      // One upload at the end instead of a growing push per persisted game.
      try { if (window.KPSync) window.KPSync.suspendPush(true); } catch { }
      await initStockfish();
      await ingest(username, ONBOARD_GAMES, ONBOARD_DEPTH, (done, total, label) => {
        const pct = total > 0 ? (done / total) * 100 : 0;
        const pt = document.getElementById('progress-text');
        const pb = document.getElementById('progress-bar');
        if (pt) pt.textContent = `${label || 'Analysing your moves'}, ${done}/${total}`;
        if (pb) pb.style.width = Math.max(2, Math.min(100, pct)) + '%';
      }, persistGameIncrementally);
      // Motif tagging rides the consolidated batched path; fire-and-forget so
      // the user is never stuck waiting on it.
      tagAndSaveMistakes().catch(() => { });
      ingestDone = true;
      const pt = document.getElementById('progress-text');
      if (pt) { pt.textContent = 'Done, your games are in.'; document.getElementById('progress').classList.add('ok'); }
    } catch (err) {
      ingestFailed = err;
      const p = document.getElementById('progress');
      const pt = document.getElementById('progress-text');
      if (pt) pt.textContent = 'Could not analyse games: ' + (err && err.message || err) + ' You can sync later from the app.';
      if (p) p.classList.add('error');
    }
    try { if (window.KPSync) window.KPSync.suspendPush(false); } catch { } // resumes + flushes once
    maybeContinue();
  })();
}

function saveProfile(answers) {
  try {
    const d = new Date();
    if (answers.goalMonths) d.setMonth(d.getMonth() + Number(answers.goalMonths));
    const existing = (typeof KPProfile !== 'undefined') ? KPProfile.read() : {};
    const profile = {
      eloGoal: answers.eloGoal || null,
      goalBy: answers.goalMonths ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null,
      timeControl: existing.timeControl || null,   // asked at the intro step (steers the ingest)
      seriousness: answers.seriousness || null,
    };
    if (typeof KPProfile !== 'undefined') KPProfile.write(profile);
    // Seriousness pre-answers Today's daily-goal question (owner ask): seed the
    // existing goal key so today.html never has to ask.
    if (answers.seriousness && typeof CoachStats !== 'undefined') {
      const g = CoachStats.normalizeGoal({ tier: answers.seriousness });
      localStorage.setItem('chess-coach-daily-goal-v1', JSON.stringify({ tier: g.tier, target: g.target }));
    }
  } catch { /* profile is enrichment, never block onboarding */ }
}

// ---------------------------------------------------------------------------
// Step 3, three personal insights + the coach welcome card
// ---------------------------------------------------------------------------
function computeInsights() {
  const out = [];
  const meta = loadJson('chess-coach-game-meta-v1', {});
  const mistakes = loadMistakes();
  const attempts = loadJson('chess-coach-attempts-v1', {});
  const scorecards = loadJson('chess-coach-game-scorecards-v1', {});
  const ratingCache = loadJson('chess-coach-user-rating-v1', null);
  const rating = ratingCache && ratingCache.rating;
  const cci = (typeof ChesscomInsights !== 'undefined') ? ChesscomInsights : null;
  const sum = cci ? cci.summarize(meta) : null;

  // 1. Performance vs rating, the "estimated game rating" read.
  if (sum && sum.recentPerf != null && Number.isFinite(Number(rating))) {
    out.push({ label: 'Your real level', text: `Across your recent games you performed like a <b>${sum.recentPerf}</b>-rated player. ${cci.perfMeaning(sum.recentPerf, rating)}` });
  }
  // 2. The biggest leak, in rating points (CoachStats phase view).
  try {
    if (typeof CoachStats !== 'undefined') {
      const view = CoachStats.computeCoachView({ rating: rating || null, mistakes, attempts, scorecards, nowMs: Date.now() });
      const f = view && view.focus && view.focus[0];
      if (f && f.attribute) {
        const name = String(f.attribute).replace(/_/g, ' ');
        out.push({ label: 'Your biggest leak', text: `Your <b>${esc(name)}</b> is where you lose the most, it scores ${Math.round(f.score)}/100 against the rest of your game. That is exactly what your first sessions will target.` });
      }
    }
  } catch { }
  // 3. What the engine found, mistakes turned into personal puzzles.
  if (mistakes.length) {
    const blunders = mistakes.filter((m) => m.severity === 'blunder').length;
    const worst = mistakes.slice().sort((a, b) => (b.cpLoss || 0) - (a.cpLoss || 0))[0];
    out.push({ label: 'Found in your games', text: `The engine found <b>${mistakes.length} moments</b> that cost you real material or position${blunders ? `, ${blunders} of them lost two pawns’ worth or more` : ''}. The worst single moment cost ~${((worst.cpLoss || 0) / 100).toFixed(1)} pawns. Every one is now a personal puzzle.` });
  }
  // 4/5. Fallbacks so there are always three: how you lose / vs-stronger record.
  if (out.length < 3 && sum && sum.losses) {
    const terms = Object.entries(sum.lossTerminations).sort((a, b) => b[1] - a[1]);
    if (terms.length && terms[0][1] >= 2) {
      const how = { checkmated: 'by getting checkmated', timeout: 'on time', resigned: 'by resigning', abandoned: 'by abandoning' }[terms[0][0]] || `by ${terms[0][0]}`;
      out.push({ label: 'How you lose', text: `${terms[0][1]} of your ${sum.losses} recent losses ended <b>${esc(how)}</b>. Patterns like this are fixable, and worth knowing about yourself.` });
    }
  }
  if (out.length < 3 && sum && (sum.vsStronger.n >= 3 || sum.vsWeaker.n >= 3)) {
    const vs = sum.vsStronger.n >= 3 ? sum.vsStronger : sum.vsWeaker;
    const who = vs === sum.vsStronger ? 'stronger' : 'weaker';
    out.push({ label: `Against ${who} players`, text: `You scored <b>${vs.w} of ${vs.n}</b> against ${who}-rated opponents recently. ${who === 'stronger' && vs.w > 0 ? 'You already beat players above you, consistency is what is missing, not ability.' : 'Your sessions will train exactly the patterns that flip these games.'}` });
  }
  if (out.length < 3) {
    out.push({ label: 'Your coach', text: 'From here, every game you sync becomes training: your mistakes come back as puzzles, and the coach guides you to find the right idea yourself, it never just gives you the answer.' });
  }
  return out.slice(0, 3);
}

async function coachWelcome(host) {
  ensureCoachCardStyles();
  const ratingCache = loadJson('chess-coach-user-rating-v1', null);
  const rating = (ratingCache && ratingCache.rating) || null;
  const profile = (typeof KPProfile !== 'undefined') ? KPProfile.read() : {};
  const meta = loadJson('chess-coach-game-meta-v1', {});
  const sum = (typeof ChesscomInsights !== 'undefined') ? ChesscomInsights.summarize(meta) : null;
  const fallback = {
    lead: 'I have read your games. Let’s get to work.',
    points: [
      { label: 'The plan', text: `Short daily sessions built from your own mistakes${profile.eloGoal ? `, aimed at ${profile.eloGoal}` : ''}.`, tone: 'pos' },
      { label: 'My role', text: 'I guide you to the idea with questions, you find the move. That is how it sticks.', tone: 'muted' },
    ],
    question: 'Ready for your first session?',
    grounded: 'Based on the games just analysed.',
  };
  renderCoachCard(host, fallback, { append: false, scroll: false });
  try {
    const digest = {
      rating, games: sum ? sum.games : 0, record: sum ? `${sum.wins}W-${sum.draws}D-${sum.losses}L` : null,
      recentPerformance: sum ? sum.recentPerf : null, mistakesFound: loadMistakes().length,
      goal: profile.eloGoal || null, goalBy: profile.goalBy || null, timeControl: profile.timeControl || null, seriousness: profile.seriousness || null,
    };
    const SYS = [
      'You are the student’s personal chess coach, welcoming them after analysing their recent games for the first time.',
      `They are rated approximately ${rating || 'unknown'} on Chess.com. Plain language for a sub-1500 player, warm but specific, every claim tied to a number from the DIGEST. Never invent data.`,
      'Acknowledge THEIR stated goal and make the path feel concrete. Do not reveal any specific puzzle answer.',
      'Return ONLY this JSON (no fences): { "lead": "...", "points": [{ "label": "...", "text": "...", "tone": "bad|warn|pos|muted" }], "question": "...", "grounded": "..." }',
      '- 2-3 points (e.g. What I saw / The plan / My role). No markdown, no em-dashes.',
    ].join('\n');
    const r = await fetch('/api/coach', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: SYS, messages: [{ role: 'user', content: 'DIGEST:\n' + JSON.stringify(digest) }] }),
    });
    const data = await r.json();
    if (!r.ok) return;
    const parsed = parseCoachJson((data.content && data.content[0] && data.content[0].text) || '');
    if (parsed) renderCoachCard(host, parsed, { append: false, scroll: false });
  } catch { /* fallback card already rendered */ }
}

// Phase strip: how each phase of YOUR game plays, as an estimated ELO
// (CoachStats acplToElo over the per-phase ACPL from the just-built
// scorecards). With only ~20 games this is an early estimate; labelled so.
function phaseStripHtml() {
  try {
    if (typeof CoachStats === 'undefined') return '';
    const scorecards = loadJson('chess-coach-game-scorecards-v1', {}) || {};
    if (!Object.keys(scorecards).length) return '';
    const phases = CoachStats.phaseScores(scorecards);
    const cells = [];
    let bestElo = -1, bestPh = null;
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const p = phases && phases[ph];
      if (p && typeof p.acpl === 'number') {
        const elo = CoachStats.acplToElo(p.acpl);
        if (elo > bestElo) { bestElo = elo; bestPh = ph; }
        cells.push({ ph, elo, score: (typeof p.score === 'number') ? p.score : null });
      } else {
        cells.push({ ph, elo: null, score: null });
      }
    }
    if (bestPh == null) return '';
    const label = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };
    return '<div class="ph-strip">' + cells.map((c) =>
      `<div class="ph-cell${c.ph === bestPh ? ' best' : ''}">
        <div class="pn">${label[c.ph]}</div>
        <div class="pe">${c.elo != null ? '~' + c.elo : '?'}</div>
        <div class="ps">${c.elo != null ? (c.ph === bestPh ? 'your strongest' : 'est. level') : 'not enough data'}</div>
        ${c.score != null ? `<div class="bar"><i style="width:${Math.max(4, Math.min(100, Math.round(c.score)))}%"></i></div>` : ''}
      </div>`).join('') + '</div>';
  } catch { return ''; }
}

// The openings you actually play, from the game meta (top 3 by count).
function openingsHtml() {
  try {
    if (typeof ChesscomInsights === 'undefined') return '';
    const sum = ChesscomInsights.summarize(loadJson('chess-coach-game-meta-v1', {}) || {});
    const top = (sum.openings || []).slice(0, 3);
    if (!top.length) return '';
    return '<div class="insight" style="background:var(--surface);"><div class="il">Openings you play most</div><div class="op-list">' +
      top.map((o) => `<div class="op-row"><span class="on2">${esc(o.name)}</span><span class="om">${o.n} game${o.n === 1 ? '' : 's'} · ${o.scorePct}% score</span></div>`).join('') +
      '</div></div>';
  } catch { return ''; }
}

function stepInsights(returning) {
  const insights = computeInsights();
  card.innerHTML = `
    <h1>${returning ? 'Welcome back, your training is synced' : 'What I found in your games'}</h1>
    <div class="sub">${returning ? 'Your puzzles, streak and history came straight back from the cloud, nothing to re-analyse.' : 'How each phase of your game plays, and three things Chess.com will not tell you:'}</div>
    ${phaseStripHtml()}
    ${insights.map((i) => `<div class="insight"><div class="il">${esc(i.label)}</div><div class="it">${i.text}</div></div>`).join('')}
    ${openingsHtml()}
    <div id="ob-coach-card"></div>
    <div class="stepfoot"><button class="btn primary" id="ob-tour" type="button">Show me around →</button></div>
    <button class="skiplink" id="ob-skip-all" type="button">Skip the tour, take me to training</button>`;
  coachWelcome(document.getElementById('ob-coach-card'));
  document.getElementById('ob-tour').addEventListener('click', () => stepTour(0));
  document.getElementById('ob-skip-all').addEventListener('click', finish);
}

// ---------------------------------------------------------------------------
// Step 4, the tour (8 steps, skippable)
// ---------------------------------------------------------------------------
const TOUR = [
  { t: 'Today is home', p: 'One tap starts a session built for you: your recent mistakes, the patterns due for review, and your weakest area first.', icon: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>' },
  { t: 'Solve your own mistakes', p: 'Each puzzle is a position from YOUR games where a better move existed. Find it now, and you will find it in your next game.', icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/>' },
  { t: 'The coach never spoils', p: 'Stuck? Ask the coach. It answers with questions and nudges, pitched to your level, finding the move yourself is the whole point.', icon: '<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5z"/>' },
  { t: 'Keep your streak', p: 'Finish a session a day. Miss a day? A freeze saves your streak, earned, never bought. Goals adapt to how serious you said you are.', icon: '<path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-2-1-3-1-3s3 1 3 5a5 5 0 0 1-10 0c0-5 4-7 5-11z"/>' },
  { t: 'Review every game', p: 'Game Review jumps you to the key moments of each game and the coach explains what happened, then you drill that exact theme.', icon: '<path d="M3 5h13M3 10h13M3 15h8"/><circle cx="18.5" cy="16" r="3.2"/><path d="M21 18.5l2 2"/>' },
  { t: 'Watch yourself improve', p: 'Insights shows where you leak rating, how you perform game by game, and your mastery over time, honest numbers, no confetti.', icon: '<path d="M3.5 20.5h17"/><path d="M7 20.5v-6M12 20.5v-10M17 20.5v-13.5"/>' },
  { t: 'Go deeper when ready', p: 'Endgames, openings with the why of every move, board-vision warm-ups, and tactic drills by difficulty, all under Practice.', icon: '<path d="M4 4h6v6H4zm10 0h6v6h-6zm-10 10h6v6H4zm10 0h6v6h-6z"/>' },
  { t: 'It follows you', p: 'Your username is your key: streak, puzzles and progress sync to every device. Sync new games whenever you have played.', icon: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>' },
];
function stepTour(i) {
  const s = TOUR[i];
  card.innerHTML = `
    <div class="tour-step">
      <div class="tic"><svg viewBox="0 0 24 24">${s.icon}</svg></div>
      <h2>${esc(s.t)}</h2><p>${esc(s.p)}</p>
      <div class="tour-dots">${TOUR.map((_, d) => `<i class="${d === i ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn primary" id="ob-next" type="button">${i === TOUR.length - 1 ? 'Start training →' : 'Next'}</button>
      ${i < TOUR.length - 1 ? '<button class="skiplink" id="ob-skip" type="button">Skip tour</button>' : ''}
    </div>`;
  document.getElementById('ob-next').addEventListener('click', () => (i === TOUR.length - 1 ? finish() : stepTour(i + 1)));
  const sk = document.getElementById('ob-skip');
  if (sk) sk.addEventListener('click', finish);
}

// ---------------------------------------------------------------------------
// Finish, straight into the first Today task.
// ---------------------------------------------------------------------------
function finish() {
  try { localStorage.setItem('chess-coach-onboarded-v1', new Date().toISOString()); } catch { }
  window.location.href = '/today.html';
}

// ---------------------------------------------------------------------------
// Boot: already-onboarded users with data don't belong here.
// ---------------------------------------------------------------------------
if (getUsername() && loadMistakes().length >= 1) {
  window.location.replace('/today.html');
} else if (getUsername()) {
  stepIngestIntro(getUsername());
} else {
  stepUsername();
}
