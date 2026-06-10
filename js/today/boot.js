/* ============================================================================
 * today.html, the daily launchpad (Loop 1, rebuilt v1.0 to Design's
 * session-wrapper rethink). Spec: redesign-spec §8/§18 + design-explorations/
 * today-screen.html (2026-06-01) + engineering spec 05 (deterministic fallback).
 *
 * SESSION = BUILT BLOCKS ONLY. Only block types that actually exist are live
 * and counted: recent mistakes + review due. Endgames + board vision are shown
 * as LOCKED "coming soon" rows, never sequenced, never counted (so a block can
 * never dead-end into the open Puzzles tab). The session runs inside the wrapper
 * (session.html); puzzle.html (Releases-A v0.13) does the per-block round-trip.
 *
 * NO-SPOILER: aggregate counts + block titles only. Never a puzzle's brief /
 * bestMove / motif / eval.
 *
 * Plan contract (consumed by session.html + puzzle.html v0.13):
 *   chess-coach-session-v1 = { date, idx, estMin, framing, coming:[…],
 *     blocks:[{ id, title, sub, count, mode, done, ids:[puzzleId…] }] }
 *   blocks = LIVE blocks only; `coming` = locked rows (Today-only, ignored by puzzle.html).
 * ==========================================================================*/
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = $('today-root');


  var KEY_MISTAKES   = 'chess-coach-mistakes-v1';
  var KEY_ATTEMPTS   = 'chess-coach-attempts-v1';
  var KEY_RATING     = 'chess-coach-user-rating-v1';
  var KEY_SCORECARDS = 'chess-coach-game-scorecards-v1';
  var KEY_SESSION    = 'chess-coach-session-v1';
  var KEY_COMPLETE   = 'chess-coach-session-complete-v1';
  var KEY_GOAL       = 'chess-coach-daily-goal-v1';   // { tier, target }. SDT autonomy
  var KEY_PROFILE    = 'chess-coach-rating-profile-v1';
  var KEY_HISTORY    = 'chess-coach-rating-history-v1';
  var KEY_EG         = 'chess-coach-eg-results-v1';
  var KEY_MASTERY    = 'chess-coach-mastery-seen-v1';

  function loadJson(key, fb) {
    try { var r = localStorage.getItem(key); if (r == null) return fb; var v = JSON.parse(r); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function todayKey() {
    var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function renderError(msg, raw) {
    root.innerHTML = '<div class="ebanner"><div class="t">' + esc(msg) + '</div><div class="raw">' + esc(raw) + '</div></div>';
  }

  var ICON = {
    mistakes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="7"/><path d="M12 2v4"/></svg>',
    review:   '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>',
    // Keyed by BLOCK id, the endgame session block's id is 'endgames'
    // (v0.80 audit fix: the old 'endgame' key rendered literal "undefined"
    // in the block row whenever endgame technique was the day's focus).
    endgame:  '<svg viewBox="0 0 24 24"><path d="M5 20V9m4 11V4m4 16v-7m4 7V8"/></svg>',
    endgames: '<svg viewBox="0 0 24 24"><path d="M5 20V9m4 11V4m4 16v-7m4 7V8"/></svg>',
    vision:   '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    recognition: '<svg viewBox="0 0 24 24"><path d="M12 3v4M3 12h4m10 0h4M12 17v4"/><circle cx="12" cy="12" r="4"/></svg>',
    calculation: '<svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 1 7 7c0 2.4-1.2 3.9-2.4 5.2-.8.9-1.6 1.8-1.6 2.8h-6c0-1-.8-1.9-1.6-2.8C6.2 13.9 5 12.4 5 10a7 7 0 0 1 7-7z"/><path d="M9.5 21h5"/></svg>',
    openings: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>'
  };

  // ---- load stores ----
  var mistakes, attempts, ratingCache, scorecards, completeFlag, savedSession;
  try {
    mistakes = loadJson(KEY_MISTAKES, []);
    attempts = loadJson(KEY_ATTEMPTS, {}) || {};
    ratingCache = loadJson(KEY_RATING, null);
    scorecards = loadJson(KEY_SCORECARDS, {}) || {};
    completeFlag = loadJson(KEY_COMPLETE, null);
    savedSession = loadJson(KEY_SESSION, null);
  } catch (e) {
    renderError('Today could not read your saved data.', (e && e.stack) || String(e));
    return;
  }
  if (!Array.isArray(mistakes)) mistakes = [];

  var rating = (ratingCache && typeof ratingCache.rating === 'number') ? ratingCache.rating : null;
  var TODAY = todayKey();

  // ---- session streak (app-level, generalised from Board Vision via js/streak.js) ----
  // The streak lives on the MEANINGFUL action, completing today's session, and
  // is persisted in chess-coach-streak-v1. We resolve any elapsed gap on read so
  // the displayed value is honest; the actual increment happens on the done-today
  // path (markSessionDone), never on a mere app-open (anti-pattern guard).
  var streakInfo = { current: 0, longest: 0, freezesAvailable: 0, doneToday: false, atRisk: false, message: '' };
  try {
    if (typeof Streak !== 'undefined') {
      var resolved = Streak.resolve(Streak.readStreak(), Streak.todayStr());
      Streak.writeStreak(resolved.state);            // persist a freeze-consume / lapse on read
      streakInfo = Streak.describe(resolved.state, Streak.todayStr());
    }
  } catch (e) { /* streak is non-essential chrome, never block the page */ }
  var streak = streakInfo.current;

  // ---- daily goal (SDT autonomy. Casual / Regular / Serious) ----
  var goal = { tier: 'regular', target: 6 };
  try {
    var storedGoal = loadJson(KEY_GOAL, null);
    goal = (typeof CoachStats !== 'undefined') ? CoachStats.normalizeGoal(storedGoal) : (storedGoal || goal);
  } catch (e) { /* fall back to default */ }
  function saveGoalTier(tier) {
    try {
      var g = (typeof CoachStats !== 'undefined') ? CoachStats.normalizeGoal({ tier: tier }) : { tier: tier, target: 6 };
      localStorage.setItem(KEY_GOAL, JSON.stringify({ tier: g.tier, target: g.target }));
    } catch (e) { /* non-fatal */ }
  }

  // ---- overall tier (for the chip) + focus data (for plan sentence + endgame sequencing) ----
  var overallTier = null;
  var focusData = null;
  try {
    if (typeof CoachStats !== 'undefined') {
      var view = CoachStats.computeCoachView({ rating: rating, mistakes: mistakes, attempts: attempts, scorecards: scorecards, nowMs: Date.now() });
      overallTier = (view && view.overall && view.overall.tier) ? view.overall.tier : null;
      focusData = (view && view.focus && view.focus[0]) ? view.focus[0] : null;
    }
  } catch (e) { overallTier = null; focusData = null; }

  // =====================================================================
  // BLOCK ASSEMBLY, built block types ONLY (recent mistakes + review).
  // =====================================================================
  function isSolved(id) { var a = attempts[id]; return !!(a && a.solved); }
  function isTried(id) { return !!attempts[id]; }

  var byNewest = mistakes.slice().sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  // Block 1. Recent mistakes: newest untried, top up with unsolved-tried if thin.
  var untried = byNewest.filter(function (m) { return m && m.id && !isTried(m.id); });
  var unsolvedTried = byNewest.filter(function (m) { return m && m.id && isTried(m.id) && !isSolved(m.id); });
  var b1ids = untried.slice(0, 8).map(function (m) { return m.id; });
  if (b1ids.length < 4) {
    unsolvedTried.forEach(function (m) { if (b1ids.length < 8 && b1ids.indexOf(m.id) === -1) b1ids.push(m.id); });
  }
  var recentGames = {};
  byNewest.slice(0, 12).forEach(function (m) { if (m.gameUrl) recentGames[m.gameUrl] = 1; });
  var nGames = Object.keys(recentGames).length;

  // Block 2. Spaced review (SRS, js/review-srs.js): previously-attempted
  // mistakes that are DUE to resurface, failed ones immediately, solved ones
  // after a growing interval, so patterns are re-exposed just before they fade.
  // Excludes the fresh block (b1). Falls back to the old unsolved-tried proxy.
  var b2ids;
  if (typeof ReviewSRS !== 'undefined') {
    b2ids = ReviewSRS.buildQueue(mistakes, attempts, Date.now(), 12)
      .map(function (m) { return m.id; })
      .filter(function (id) { return b1ids.indexOf(id) === -1; })
      .slice(0, 6);
  } else {
    b2ids = unsolvedTried.filter(function (m) { return b1ids.indexOf(m.id) === -1; }).slice(0, 5).map(function (m) { return m.id; });
  }

  // Block 3. Endgame recognition (Spec 21, folded into the session host).
  // Gated behind a recognition-focus flag so it's only queued when relevant;
  // ids are the recognition bank's stable rec-<n> ids (data/endgame-recognition
  // .json, 1,001 positions: rec-0..rec-1000). Least-recently-seen first using
  // the recognition store's `seen` markers, capped small to keep a daily
  // session light. No fetch needed, the id space is fixed and contiguous.
  var RECOG_BANK_SIZE = 1001;     // data/endgame-recognition.json position count
  var RECOG_BLOCK_CAP = 4;        // positions per daily recognition block
  var recognitionStore = {};
  try { recognitionStore = JSON.parse(localStorage.getItem('chess-coach-recognition-v1') || '{}') || {}; } catch (e) {}
  var recogSeen = recognitionStore.seen || {};
  // recognition focus: surface a block when the player has a recognition
  // weakness (overall recognition accuracy < 70% with >= 6 attempts) OR has
  // never tried it (so the daily loop introduces it). O5 interim gate.
  function recognitionAccuracy() {
    var bt = recognitionStore.byType || {};
    var seen = 0, correct = 0;
    Object.keys(bt).forEach(function (k) { seen += (bt[k].seen || 0); correct += (bt[k].correct || 0); });
    return { seen: seen, pct: seen ? Math.round(correct / seen * 100) : null };
  }
  var recAcc = recognitionAccuracy();
  var recognitionInFocus = (recAcc.seen === 0) || (recAcc.seen >= 6 && recAcc.pct != null && recAcc.pct < 70);
  var b3ids = [];
  if (recognitionInFocus) {
    var allRecIds = [];
    for (var ri = 0; ri < RECOG_BANK_SIZE; ri++) allRecIds.push('rec-' + ri);
    // least-recently-seen first (unseen sort before seen; seen by oldest at).
    allRecIds.sort(function (a, b) {
      var ra = recogSeen[a], rb = recogSeen[b];
      var ta = (ra && typeof ra === 'object') ? ra.at : (typeof ra === 'number' ? ra : -1);
      var tb = (rb && typeof rb === 'object') ? rb.at : (typeof rb === 'number' ? rb : -1);
      return ta - tb;
    });
    b3ids = allRecIds.slice(0, RECOG_BLOCK_CAP);
  }

  // Block 4. Endgame play-out (Spec 21, folded into the session host).
  // Gated behind the existing endgame-focus flag (focusData.attribute ===
  // 'endgame_technique'): only queued when endgame technique is today's biggest
  // leak. ids are the 20 canonical endgame-lesson ids (data/endgames.json),
  // least-mastered / least-recently-played first using the eg-results store
  // (chess-coach-eg-results-v1, written by playout.js). Capped small to keep a
  // daily session light. No fetch, the id space is fixed.
  var ENDGAME_LESSON_IDS = ['kq','kr','2b','bn','2r','opp','rookpawn','square','outside','distopp','lucena','philidor','vancura','behindpasser','kpvr','ocb0','ocbwin','wrongb','connected','qvr'];
  var ENDGAME_BLOCK_CAP = 4;        // lessons per daily endgame block
  var endgameStore = {};
  try { endgameStore = JSON.parse(localStorage.getItem('chess-coach-eg-results-v1') || '{}') || {}; } catch (e) {}
  var endgameInFocus = !!(focusData && focusData.attribute === 'endgame_technique');
  var b4ids = [];
  if (endgameInFocus) {
    var egRank = ENDGAME_LESSON_IDS.slice();
    // unmastered before mastered; within each, least-recently-played first
    // (never-played = -1 sorts first), so a daily block surfaces the weakest.
    egRank.sort(function (a, b) {
      var ea = endgameStore[a] || {}, eb = endgameStore[b] || {};
      var ma = ea.mastered ? 1 : 0, mb = eb.mastered ? 1 : 0;
      if (ma !== mb) return ma - mb;
      var ta = (typeof ea.lastAt === 'number') ? ea.lastAt : -1;
      var tb = (typeof eb.lastAt === 'number') ? eb.lastAt : -1;
      return ta - tb;
    });
    b4ids = egRank.slice(0, ENDGAME_BLOCK_CAP);
  }

  // Block 5. Opening lines due for recall (v0.82): lines the user has STARTED
  // in the openings trainer whose SRS card is due. Read straight off the
  // synced openings store (no registry fetch needed on Today). Capped small.
  var OPENINGS_BLOCK_CAP = 3;
  var b5ids = [];
  try {
    var opStore = JSON.parse(localStorage.getItem('chess-coach-openings-v1') || '{}') || {};
    var opCards = opStore.cards || {};
    b5ids = Object.keys(opCards)
      .filter(function (id) { var c = opCards[id]; return c && typeof c.dueAt === 'number' && c.dueAt <= Date.now(); })
      .sort(function (a, b) { return (opCards[a].dueAt || 0) - (opCards[b].dueAt || 0); })
      .slice(0, OPENINGS_BLOCK_CAP);
  } catch (e) { b5ids = []; }

  // Block 6. Daily warm-up (v0.82): Board Vision and Calculation alternate by
  // calendar day so both skills get regular reps without bloating the session
  // (spec 25 answer to "replace or alternate": alternate). One unit, resolved
  // when that trainer's completedDate flips to today.
  var dayOrdinal = Math.floor(Date.now() / 86400000);
  var warmupId = (dayOrdinal % 2 === 0) ? 'vision' : 'calculation';
  var warmupDone = false;
  try {
    var wuKey = warmupId === 'vision' ? 'chess-coach-board-vision-v1' : 'chess-coach-calculation-v1';
    var wuStore = JSON.parse(localStorage.getItem(wuKey) || '{}') || {};
    warmupDone = wuStore.completedDate === TODAY;
  } catch (e) {}

  // LIVE blocks only (built types). Empty ones are dropped (never an empty row).
  // Order: warm-up first (light, primes calculation), then the core drilling.
  var blocks = [];
  if (!warmupDone) blocks.push(
    warmupId === 'vision'
      ? { id: 'vision', title: 'Board Vision warm-up', sub: 'Coordinates, knights, visualisation', count: 1, mode: 'visit', done: 0, ids: ['warmup'] }
      : { id: 'calculation', title: 'Calculation warm-up', sub: 'Follow the line + count the forcers', count: 1, mode: 'visit', done: 0, ids: ['warmup'] });
  if (b1ids.length) blocks.push({ id: 'mistakes', title: 'Recent mistakes', sub: 'From your last ' + nGames + ' game' + (nGames === 1 ? '' : 's'), count: b1ids.length, mode: 'drill', done: 0, ids: b1ids });
  if (b2ids.length) blocks.push({ id: 'review', title: 'Spaced review', sub: 'Resurfacing before you forget', count: b2ids.length, mode: 'drill', done: 0, ids: b2ids });
  if (b3ids.length) blocks.push({ id: 'recognition', title: 'Endgame recognition', sub: 'Winning, drawn, or losing?', count: b3ids.length, mode: 'drill', done: 0, ids: b3ids });
  if (b4ids.length) blocks.push({ id: 'endgames', title: 'Endgame play-out', sub: 'Convert the win, hold the draw', count: b4ids.length, mode: 'drill', done: 0, ids: b4ids });
  if (b5ids.length) blocks.push({ id: 'openings', title: 'Opening lines', sub: 'Your repertoire, due for recall', count: b5ids.length, mode: 'drill', done: 0, ids: b5ids });

  // The warm-up rotation is live (v0.82), so nothing is "coming soon" anymore.
  var coming = [];

  // endgameInFocus is computed above (block assembly) and reused here.

  var totalReps = blocks.reduce(function (s, b) { return s + b.count; }, 0);
  var estMin = Math.max(8, Math.round(totalReps * 1.1));

  // ---- coach framing line (deterministic) ----
  function coachFraming() {
    var parts = [];
    if (b1ids.length) parts.push('your <b>recent mistakes</b>');
    if (b2ids.length) parts.push('the cards <b>due for review</b>');
    var lead = parts.length ? ('Today is ' + (parts.length === 2 ? parts[0] + ' plus ' + parts[1] : parts[0]) + '.') : 'Nothing new to drill today.';
    var endgameTail = endgameInFocus ? ' <b>Endgame technique</b> is your focus today, drills queued below.' : ' Endgame practice is now available as an optional extra.';
    return lead + endgameTail;
  }

  // ---- coach’s read (retention #5, variable, data-grounded reward) ----
  // A short, specific, VARIED line tied to a real number (never empty praise).
  // Rotates day-to-day so it feels fresh; falls back to the session framing.
  function coachReadHtml() {
    if (typeof CoachStats === 'undefined' || !CoachStats.coachRead) return coachFraming();
    var pv = null;
    try { pv = CoachStats.ratingProfileView(loadJson(KEY_PROFILE, null)); } catch (e) {}
    var hist = loadJson(KEY_HISTORY, []);
    var reviewDue = (typeof ReviewSRS !== 'undefined') ? ReviewSRS.dueCount(mistakes, attempts, Date.now()) : 0;
    var r = CoachStats.coachRead({ view: view, profile: pv, history: Array.isArray(hist) ? hist : [], streak: streakInfo, reviewDue: reviewDue, dayKey: TODAY });
    return (r && r.text) ? esc(r.text) : coachFraming();
  }

  // ---- mastery milestones (retention #7), earned capability markers ----
  // Derived from real data; a freshly-earned one is dot-highlighted (the reward
  // moment), then recorded in chess-coach-mastery-seen-v1 so it's only "new" once.
  function milestonesHtml() {
    if (typeof Mastery === 'undefined') return '';
    var egResults = {};
    try { egResults = loadJson(KEY_EG, {}) || {}; } catch (e) {}
    var earned = Mastery.markers({ attempts: attempts, mistakes: mistakes, rating: rating, streak: streakInfo, egResults: egResults, calculation: loadJson('chess-coach-calculation-v1', null) });
    if (!earned.length) return '';
    var seen = [];
    try { seen = loadJson(KEY_MASTERY, []) || []; } catch (e) {}
    var d = Mastery.diffSeen(earned, seen);
    try { localStorage.setItem(KEY_MASTERY, JSON.stringify(d.seen)); } catch (e) {}
    var fresh = {}; d.fresh.forEach(function (m) { fresh[m.id] = 1; });
    var chips = earned.map(function (m) {
      return '<span class="ms-chip ms-' + esc(m.kind) + (fresh[m.id] ? ' ms-new' : '') + '" title="' + esc(m.detail) + '">' +
        (fresh[m.id] ? '<span class="ms-dot"></span>' : '') + esc(m.label) + '</span>';
    }).join('');
    return '<div class="milestones"><div class="ms-h">Milestones</div><div class="ms-row">' + chips + '</div></div>';
  }

  // ---- plan-today focus sentence (deterministic, zero tokens) ----
  function planTodaySentence() {
    if (!focusData || !focusData.attribute) {
      return '<p class="plan-focus plan-focus-muted">Ingest a few games to unlock your daily focus.</p>';
    }
    var label = focusData.attribute.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return '<p class="plan-focus">Today\'s focus: <b>' + esc(label) + '</b>, your biggest leak.</p>';
  }

  // ---- endgame block rows (for in-session and extra section) ----
  function endgameBlocksHtml() {
    return '<a class="block" href="/endgames.html">' +
      '<div class="ic">' + ICON.endgame + '</div>' +
      '<div class="bd"><b>Endgame technique</b><small>20 lessons · play it out vs Stockfish</small></div>' +
      '<span class="go">›</span></a>' +
      '<a class="block" href="/endgame-recognition.html">' +
      '<div class="ic"><svg viewBox="0 0 24 24"><path d="M12 3v4M3 12h4m10 0h4M12 17v4"/><circle cx="12" cy="12" r="4"/></svg></div>' +
      '<div class="bd"><b>Endgame recognition</b><small>1,001 positions · win or draw?</small></div>' +
      '<span class="go">›</span></a>';
  }

  // ---- progress ring ----
  function ringSvg() {
    var pct = (rating != null) ? Math.max(0, Math.min(100, Math.round((rating - 950) / ((typeof KPProfile!=='undefined'?KPProfile.targetElo():1500) - 950) * 100))) : 0;
    return '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#E9ECF1" stroke-width="4"/>' +
      '<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + pct + ' 100" transform="rotate(-90 18 18)"/></svg>';
  }

  // =====================================================================
  // STATE RESOLUTION
  // =====================================================================
  var ingestedAny = mistakes.length > 0;
  var doneToday = completeFlag && completeFlag.date === TODAY;
  var activeToday = savedSession && savedSession.date === TODAY;
  var partway = activeToday && ((savedSession.blocks || []).some(function (b) { return (b.done || 0) > 0; }));

  function greeting() {
    // De-hardwired (2026-06-10): greet the SYNCED user, never a baked-in name.
    var h = new Date().getHours();
    var base = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var name = null;
    try {
      var u = localStorage.getItem('chess-coach-username-v1');
      if (u && /^[a-z0-9_-]{1,64}$/i.test(u)) name = (typeof KPProfile !== 'undefined' && KPProfile.displayNameFor) ? KPProfile.displayNameFor(u) : (u.charAt(0).toUpperCase() + u.slice(1));
    } catch (e) { /* anonymous */ }
    return name ? base + ', ' + name : base;
  }
  function dateEyebrow() {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function headerHtml(subText) {
    var chips = '';
    if (streak > 0) chips += '<a href="/insights.html" class="chip streak" title="' + esc(streakInfo.message) + '">🔥 ' + streak + '-day streak</a>';
    if (streakInfo.freezesAvailable > 0) chips += '<span class="chip freeze" title="A freeze covers a missed day so your streak is safe.">❄ ' + streakInfo.freezesAvailable + ' freeze' + (streakInfo.freezesAvailable === 1 ? '' : 's') + '</span>';
    if (overallTier) chips += '<a href="/insights.html" class="chip tier" title="View insights">' + esc(overallTier) + '</a>';
    return '<div class="top"><div><div class="eyebrow">' + esc(dateEyebrow()) + '</div>' +
      '<div class="title">' + esc(greeting()) + '</div>' +
      (subText ? '<div class="sub">' + subText + '</div>' : '') +
      '</div><div class="chips">' + chips + '</div></div>';
  }
  function glanceHtml() {
    if (rating == null) {
      return '<a href="/insights.html" class="glance"><div><div class="num">, </div><div class="gl-sub">Sync your rating in Puzzles to see your trajectory.</div></div><span class="go">Insights ›</span></a>';
    }
    var pct = Math.max(0, Math.min(100, Math.round((rating - 950) / ((typeof KPProfile!=='undefined'?KPProfile.targetElo():1500) - 950) * 100)));
    return '<a href="/insights.html" class="glance">' + ringSvg() +
      '<div><div class="num">' + rating + '</div><div class="gl-sub">' + pct + '% of the way to ' + (typeof KPProfile!=='undefined'?KPProfile.targetElo():1500) + '</div></div>' +
      '<span class="go">Insights ›</span></a>';
  }

  // ---- session progress (goal-gradient): ring + bar that fill as items complete ----
  // `done` = items completed today; `target` = the user's daily goal. Counted in
  // training items (reps), not app-opens or raw attempts (anti-pattern guard).
  function sessionProgress() {
    var planned = totalReps;                     // items the built session offers
    var target = Math.max(1, goal.target);
    var done = 0;
    if (activeToday && savedSession && Array.isArray(savedSession.blocks)) {
      done = savedSession.blocks.reduce(function (s, b) { return s + (b.done || 0); }, 0);
    }
    if (doneToday && typeof completeFlag.reps === 'number') done = completeFlag.reps;
    return { done: done, target: target, planned: planned };
  }
  function goalBarHtml() {
    var p = sessionProgress();
    var pct = Math.max(0, Math.min(100, Math.round(p.done / p.target * 100)));
    var lift = (typeof CoachStats !== 'undefined') ? CoachStats.sessionGradientCopy(p.done, p.target) : '';
    var met = p.done >= p.target;
    var ringPct = Math.max(0, Math.min(100, pct));
    var ring = '<svg class="gb-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#E9ECF1" stroke-width="4"/>' +
      '<circle cx="18" cy="18" r="15.5" fill="none" stroke="' + (met ? 'var(--pos)' : 'var(--accent)') + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + ringPct + ' 100" transform="rotate(-90 18 18)"/>' +
      '<text class="gb-ct" x="18" y="21" text-anchor="middle">' + p.done + '/' + p.target + '</text></svg>';
    return '<div class="goalbar"><div class="gb-head">' + ring +
      '<div class="gb-main"><div class="gb-title">Today’s goal</div>' +
      '<div class="gb-lift' + (met ? ' met' : '') + '">' + esc(lift) + '</div>' +
      '<div class="gb-track"><i style="width:' + pct + '%"></i></div></div></div>' +
      goalPickHtml() +
      '<div class="gp-hint">' + esc(goal.label) + ' · ' + esc(String(goal.hint || '').replace(/1500/g, String((typeof KPProfile !== 'undefined' ? KPProfile.targetElo() : 1500)))) + '</div></div>';
  }
  function goalPickHtml() {
    var tiers = (typeof CoachStats !== 'undefined') ? CoachStats.GOAL_TIERS : [{tier:'casual',label:'Casual'},{tier:'regular',label:'Regular'},{tier:'serious',label:'Serious'}];
    var opts = tiers.map(function (t) {
      return '<button type="button" class="gp-opt' + (t.tier === goal.tier ? ' on' : '') + '" data-tier="' + t.tier + '">' + esc(t.label) + '</button>';
    }).join('');
    return '<div class="goalpick"><span class="gp-lab">Daily goal</span>' + opts + '</div>';
  }
  function wireGoalPick() {
    var btns = root.querySelectorAll('.gp-opt');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        saveGoalTier(b.getAttribute('data-tier'));
        window.location.reload();   // re-render with the new target (goal-gradient recompute)
      });
    });
  }

  // ---- macro goal-gradient toward the next rating band (honest, from cached rating) ----
  function bandBarHtml() {
    if (rating == null || typeof CoachStats === 'undefined') return '';
    var nb = CoachStats.nextBand(rating);
    if (!nb) return '';
    var top, pct;
    if (nb.atTarget) { top = 'You’ve reached <b>' + (typeof KPProfile!=='undefined'?KPProfile.targetElo():1500) + '</b>, the target.'; pct = 100; }
    else { top = '<b>' + nb.points + ' pts</b> to ' + nb.band + '.'; pct = nb.pctOfBand; }
    return '<a href="/insights.html" class="bandbar"><div class="bb-main"><div class="bb-top">' + top + '</div>' +
      '<div class="bb-track"><i style="width:' + pct + '%"></i></div></div><span class="bb-go">Insights ›</span></a>';
  }

  function liveBlockRow(b) {
    // R1.2 funnel: block rows enter the coached session WRAPPER, not puzzle.html
    // directly. session.html opens at the first incomplete block via renderBlock();
    // its "Begin block" is the only deep-link into puzzle.html?session=today&block=.
    return '<a class="block" href="/session.html">' +
      '<div class="ic">' + ICON[b.id] + '</div>' +
      '<div class="bd"><b>' + esc(b.title) + '</b><small>' + esc(b.sub) + '</small></div>' +
      '<span class="ct">' + b.count + '</span><span class="go">›</span></a>';
  }
  function lockedRow(c) {
    return '<div class="block locked"><div class="ic">' + ICON[c.id] + '</div>' +
      '<div class="bd"><b>' + esc(c.title) + '</b><small>' + esc(c.sub) + '</small></div>' +
      '<span class="ct">🔒 soon</span></div>';
  }
  function comingHtml() {
    // Board Vision is now live (Spec 14), render it as a real warm-up link, not
    // a locked row. Kept here (below the sequenced blocks) as an optional extra.
    return '<div class="coming-wrap">' + coming.map(function (c) {
      return '<a class="block" href="/board-vision.html"><div class="ic">' + ICON[c.id] + '</div>' +
        '<div class="bd"><b>Board Vision</b><small>Daily warm-up · coordinates, knights, visualisation · ~4 min</small></div>' +
        '<span class="go">›</span></a>';
    }).join('') + '</div>';
  }
  function sessionCardHtml() {
    // Spec 21, endgame play-out + recognition are now SEQUENCED session blocks
    // (built above into `blocks` when in focus), rendered as proper block rows
    // here. The old non-sequenced full-page endgame links in the session card
    // are dropped to avoid a duplicate entry; standalone access stays available
    // via the nav + the optional extra section (shown when endgame is not the
    // focus).
    var rows = blocks.map(liveBlockRow).join('');
    return '<div class="session"><div class="sh"><span class="t">Today’s session</span>' +
      '<span class="m">~' + estMin + ' min · ' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's') + '</span></div>' +
      planTodaySentence() +
      rows +
      '<a class="btn primary" href="/session.html" style="margin-top:14px;">Start session · ' + totalReps + ' puzzle' + (totalReps === 1 ? '' : 's') + '</a>' +
      comingHtml() + '</div>';
  }

  // ---- "analyse more games" nudge (v0.82): onboarding now ingests only 10
  // games so the wait stays short; this row invites the user to deepen the
  // mistake pool early, while motivation is high. Hidden once ~15 games in. ----
  function moreGamesNudgeHtml() {
    var n = 0;
    try { n = Object.keys(scorecards || {}).length; } catch (e) {}
    if (!n || n >= 15) return '';
    return '<a href="/games.html" class="coachnote" style="margin-top:10px;">' +
      '<span class="ava">♞</span><div class="txt">Your plan is built from <b>' + n +
      ' game' + (n === 1 ? '' : 's') + '</b>. Analyse a few more and the coach gets sharper about your real weaknesses.</div></a>';
  }

  // ---- optional endgame extra section (shown when endgame is NOT the focus) ----
  function endgameExtraHtml() {
    return '<div class="extra-section">' +
      '<div class="sh"><span class="t">Endgame practice</span><span class="m">20 lessons · 1,001 recognition drills</span></div>' +
      endgameBlocksHtml() +
      '</div>';
  }

  // ---- persist the assembled plan (blocks = live only; coming = locked rows) ----
  function persistPlan() {
    var plan = {
      date: TODAY, createdAt: new Date().toISOString(), idx: 0, estMin: estMin,
      framing: (typeof CoachStats !== 'undefined' ? null : null),
      blocks: blocks.map(function (b) { return { id: b.id, title: b.title, sub: b.sub, count: b.count, mode: b.mode, done: 0, ids: (b.ids || []).slice() }; }),
      coming: coming.slice()
    };
    try { localStorage.setItem(KEY_SESSION, JSON.stringify(plan)); } catch (e) { /* non-fatal */ }
  }

  // =====================================================================
  // RENDER
  // =====================================================================
  if (!ingestedAny) {
    root.innerHTML = headerHtml('') +
      '<div class="mid"><div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></div>' +
      '<h2>Let’s pull your games first</h2>' +
      '<p>Connect your Chess.com account and the coach will build your first session from your real mistakes.</p>' +
      '<a class="btn primary" href="/games.html">Connect Chess.com</a></div>';
    return;
  }

  if (doneToday) {
    var reps = (typeof completeFlag.reps === 'number') ? completeFlag.reps : null;
    var acc = (typeof completeFlag.accuracy === 'number') ? completeFlag.accuracy : null;
    var delta = (typeof completeFlag.ratingDelta === 'number') ? completeFlag.ratingDelta : null;
    var tomorrow = completeFlag.tomorrow || null;
    var detail = [];
    if (reps != null) detail.push(reps + ' rep' + (reps === 1 ? '' : 's'));
    if (acc != null) detail.push(acc + '% accuracy');
    if (delta != null) detail.push((delta >= 0 ? '+' + delta : delta) + ' toward ' + (typeof KPProfile!=='undefined'?KPProfile.targetElo():1500));
    var detailStr = detail.length ? detail.join(' · ') + '.' : '';
    if (tomorrow) detailStr += ' Tomorrow leans the same way until your endgame trainer unlocks.';
    persistPlan(); // re-arm for "one more set"

    // The session is complete today -> mark the streak (idempotent for the day).
    // This is the ONE place the streak increments: the meaningful action, not an
    // app-open. Re-read streakInfo so the secured-streak copy is honest.
    var doneMsg = 'Session done · streak secured 🔥';
    try {
      if (typeof Streak !== 'undefined') {
        var marked = Streak.markSessionDone(Streak.readStreak(), Streak.todayStr());
        Streak.writeStreak(marked.state);
        streakInfo = Streak.describe(marked.state, Streak.todayStr());
        streak = streakInfo.current;
        if (marked.event && marked.event.freezeGranted) doneMsg = 'Session done · streak secured 🔥 +1 freeze earned';
        else if (streak > 0) doneMsg = 'Session done · ' + streak + '-day streak secured 🔥';
      }
    } catch (e) { /* streak chrome only */ }

    root.innerHTML = headerHtml('') +
      '<div class="mid"><div class="ic done"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div>' +
      '<h2>' + esc(doneMsg) + '</h2>' +
      '<p>' + (detailStr || 'Nice work today.') + '</p>' +
      '<a class="btn primary" href="/session.html">One more set</a></div>' +
      '<a href="/coach.html" class="coachnote" style="margin-top:14px;"><span class="ava">♞</span><div class="txt">' + coachReadHtml() + '</div></a>' +
      bandBarHtml() +
      milestonesHtml() +
      glanceHtml();
    return;
  }

  if (partway) {
    var blocksLeft = (savedSession.blocks || []).filter(function (b) { return (b.done || 0) < (b.count || 0); }).length;
    var totalPlanned = (savedSession.blocks || []).reduce(function (s, b) { return s + (b.count || 0); }, 0);
    var done = (savedSession.blocks || []).reduce(function (s, b) { return s + (b.done || 0); }, 0);
    var minsLeft = Math.max(2, Math.round((totalPlanned - done) * 1.0 + blocksLeft * 2));
    var idxHuman = Math.min((savedSession.blocks || []).filter(function (b) { return (b.done || 0) >= (b.count || 0); }).length + 1, (savedSession.blocks || []).length);
    root.innerHTML = headerHtml('') +
      '<a href="/session.html" class="coachnote"><span class="ava">♞</span><div class="txt">You’re partway through. <b>' + blocksLeft + ' block' + (blocksLeft === 1 ? '' : 's') + ' left</b>, about ' + minsLeft + ' minutes.</div></a>' +
      goalBarHtml() +
      '<a class="btn primary" href="/session.html">Resume session · block ' + idxHuman + ' of ' + (savedSession.blocks || []).length + '</a>' +
      '<div style="margin-top:10px;"><button class="btn ghost" id="start-fresh">Start fresh instead</button></div>' +
      bandBarHtml() +
      glanceHtml();
    wireGoalPick();
    var sf = $('start-fresh');
    if (sf) sf.addEventListener('click', function () {
      try { localStorage.removeItem(KEY_SESSION); } catch (e) {}
      persistPlan();
      window.location.href = '/session.html';
    });
    return;
  }

  // No live blocks (everything cleared), caught up, not a dead end.
  if (!blocks.length) {
    persistPlan();
    root.innerHTML = headerHtml('') +
      '<div class="mid"><div class="ic done"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div>' +
      '<h2>You’re all caught up</h2>' +
      '<p>No fresh mistakes or review cards right now. Ingest a few more games, or come back tomorrow.</p>' +
      '<a class="btn primary" href="/games.html">Sync games</a></div>' +
      glanceHtml();
    return;
  }

  // POPULATED, assemble + persist a fresh plan.
  persistPlan();
  root.innerHTML = headerHtml('A pre-built session from your games. One tap to start.') +
    '<a href="/coach.html" class="coachnote"><span class="ava">♞</span><div class="txt">' + coachReadHtml() + '</div></a>' +
    goalBarHtml() +
    sessionCardHtml() +
    moreGamesNudgeHtml() +
    bandBarHtml() +
    milestonesHtml() +
    (!endgameInFocus ? endgameExtraHtml() : '') +
    glanceHtml();
  wireGoalPick();
})();
