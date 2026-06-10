/* ============================================================================
 * js/streak.js, app-level session streak + freeze / forgiveness.
 *
 * Generalised from js/board-vision/boot.js's daily-completion streak into a
 * pure, dependency-free, node-testable module. ONE streak on the *meaningful*
 * action: completing today's session (today.html marks it via markSessionDone).
 *
 * Design contract (docs/retention-and-gamification.md, mechanic #2):
 *   - Completing today increments the streak; a second completion same day is
 *     a no-op (idempotent).
 *   - A missed day CONSUMES a freeze if one is available (auto-granted ~1/week,
 *     capped small) instead of breaking the streak. No freeze -> reset to 1 on
 *     the next completion.
 *   - A pre-marked REST day never breaks the streak (planned, not punished).
 *   - Framing on a miss is SUPPORTIVE, never punitive ("your freeze saved your
 *     12-day streak"). The anti-patterns list forbids streak-terror.
 *
 * Storage key (browser): chess-coach-streak-v1
 *   { current, longest, lastCompletedDay:"YYYY-MM-DD",
 *     freezesAvailable, freezeUsedDays:[…], restDays:[…] }
 *
 * Pure functions take an explicit `state` + a `todayStr` ("YYYY-MM-DD") so the
 * day boundary is injectable and the whole module is testable without a clock
 * or localStorage. The thin browser read/write wrappers (readStreak /
 * writeStreak) are the only impure parts and are tree-shaken out under node.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'chess-coach-streak-v1';

  // Auto-grant ~1 freeze per week of active completion, capped small so a freeze
  // is a genuine forgiveness affordance, not a way to fake a long streak.
  var FREEZE_GRANT_EVERY = 7;   // completions per auto-granted freeze
  var FREEZE_CAP = 3;           // max freezes a user can bank

  // ---------- date helpers (pure; "YYYY-MM-DD" lexicographic = chronological) ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return dayStr(new Date()); }
  // days BETWEEN two "YYYY-MM-DD" strings (b - a), via UTC noon to dodge DST.
  function daysBetween(a, b) {
    if (!a || !b) return null;
    var pa = a.split('-'), pb = b.split('-');
    var ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
    var tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((tb - ta) / 86400000);
  }
  // every day strictly between a and b, exclusive (the "gap" days to account for).
  function gapDays(a, b) {
    var out = [];
    var n = daysBetween(a, b);
    if (n == null || n <= 1) return out;
    var p = a.split('-');
    for (var i = 1; i < n; i++) {
      var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
      d.setUTCDate(d.getUTCDate() + i);
      out.push(d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()));
    }
    return out;
  }

  // ---------- normalisation ----------
  function normalize(v) {
    v = (v && typeof v === 'object') ? v : {};
    return {
      current: (typeof v.current === 'number' && v.current >= 0) ? v.current : 0,
      longest: (typeof v.longest === 'number' && v.longest >= 0) ? v.longest : 0,
      lastCompletedDay: (typeof v.lastCompletedDay === 'string') ? v.lastCompletedDay : null,
      freezesAvailable: (typeof v.freezesAvailable === 'number' && v.freezesAvailable >= 0) ? v.freezesAvailable : 0,
      freezeUsedDays: Array.isArray(v.freezeUsedDays) ? v.freezeUsedDays.slice() : [],
      restDays: Array.isArray(v.restDays) ? v.restDays.slice() : []
    };
  }

  // ===========================================================================
  // CORE, resolve(state, today): account for any elapsed gap WITHOUT marking a
  // completion. Consumes freezes for missed non-rest days; resets to 0 if the
  // streak has truly lapsed. Idempotent and pure. Returns { state, event } where
  // event describes what happened to the streak for honest UI framing.
  // ===========================================================================
  function resolve(state, today) {
    var s = normalize(state);
    today = today || todayStr();
    var ev = { type: 'none', freezesUsed: 0, brokeFrom: 0, savedStreak: 0 };

    if (!s.lastCompletedDay) return { state: s, event: ev };

    var gap = daysBetween(s.lastCompletedDay, today);
    // Future/equal/yesterday: nothing has lapsed yet (today is still "live").
    if (gap == null || gap <= 1) return { state: s, event: ev };

    // Days strictly between last completion and today are the "missed" candidates.
    var missed = gapDays(s.lastCompletedDay, today);
    var restSet = {};
    s.restDays.forEach(function (d) { restSet[d] = 1; });

    var needCover = missed.filter(function (d) { return !restSet[d]; });
    if (needCover.length === 0) {
      // Entire gap was planned rest, streak is fully preserved.
      ev.type = 'rest-preserved';
      return { state: s, event: ev };
    }

    if (s.freezesAvailable >= needCover.length) {
      // Freezes cover every missed active day, streak saved.
      var before = s.current;
      s.freezesAvailable -= needCover.length;
      needCover.forEach(function (d) { if (s.freezeUsedDays.indexOf(d) === -1) s.freezeUsedDays.push(d); });
      ev.type = 'freeze-saved';
      ev.freezesUsed = needCover.length;
      ev.savedStreak = before;
      return { state: s, event: ev };
    }

    // Not enough freezes, the streak has lapsed. Reset (next completion = day 1).
    ev.type = 'broken';
    ev.brokeFrom = s.current;
    s.current = 0;
    s.lastCompletedDay = null;
    return { state: s, event: ev };
  }

  // ===========================================================================
  // markSessionDone(state, today): the user completed today's session. Resolves
  // any elapsed gap first, then increments (idempotent for the same day). Auto-
  // grants a freeze on every Nth completion up to the cap. Returns { state, event }.
  // ===========================================================================
  function markSessionDone(state, today) {
    today = today || todayStr();
    var r = resolve(state, today);
    var s = r.state;
    var ev = r.event;

    if (s.lastCompletedDay === today) {
      // Already completed today, no double count.
      ev.type = (ev.type === 'none') ? 'already-done' : ev.type;
      return { state: s, event: ev };
    }

    s.current = (s.current || 0) + 1;
    s.lastCompletedDay = today;
    if (s.current > s.longest) s.longest = s.current;

    // Auto-grant: one freeze per FREEZE_GRANT_EVERY completions, capped.
    if (s.current > 0 && s.current % FREEZE_GRANT_EVERY === 0 && s.freezesAvailable < FREEZE_CAP) {
      s.freezesAvailable += 1;
      ev.freezeGranted = true;
    }

    if (ev.type === 'none' || ev.type === 'already-done') ev.type = 'incremented';
    ev.current = s.current;
    return { state: s, event: ev };
  }

  // ===========================================================================
  // markRestDay(state, day): pre-mark a planned rest day so a future gap doesn't
  // break the streak. Idempotent; only future/today rest days are meaningful.
  // ===========================================================================
  function markRestDay(state, day) {
    var s = normalize(state);
    day = day || todayStr();
    if (s.restDays.indexOf(day) === -1) s.restDays.push(day);
    return { state: s, event: { type: 'rest-marked', day: day } };
  }

  // ===========================================================================
  // describe(state, today): supportive, data-grounded framing for the UI.
  // Resolves first (read-only view), then returns { current, longest,
  // freezesAvailable, atRisk, message }. NEVER punitive.
  // ===========================================================================
  function describe(state, today) {
    today = today || todayStr();
    var r = resolve(state, today);
    var s = r.state;
    var ev = r.event;

    var doneToday = s.lastCompletedDay === today;
    // "At risk" = streak is live but today not yet completed (a gentle nudge,
    // never a countdown / terror message).
    var atRisk = s.current > 0 && !doneToday;

    var msg = '';
    if (ev.type === 'freeze-saved') {
      msg = 'Your freeze saved your ' + ev.savedStreak + '-day streak.';
    } else if (ev.type === 'rest-preserved') {
      msg = 'Rest day, your ' + s.current + '-day streak is safe.';
    } else if (s.current === 0) {
      msg = 'Finish a session to start your streak.';
    } else if (doneToday) {
      msg = s.current + '-day streak. Nice.';
    } else {
      msg = s.current + '-day streak. One session keeps it going.';
    }

    return {
      current: s.current,
      longest: s.longest,
      freezesAvailable: s.freezesAvailable,
      doneToday: doneToday,
      atRisk: atRisk,
      event: ev.type,
      message: msg
    };
  }

  // ---------- browser-only persistence (impure; absent under node tests) ----------
  function readStreak() {
    try { return normalize(JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null')); }
    catch (e) { return normalize(null); }
  }
  function writeStreak(state) {
    try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(normalize(state))); }
    catch (e) { /* non-fatal */ }
  }

  var API = {
    KEY: KEY, FREEZE_GRANT_EVERY: FREEZE_GRANT_EVERY, FREEZE_CAP: FREEZE_CAP,
    todayStr: todayStr, dayStr: dayStr, daysBetween: daysBetween, gapDays: gapDays,
    normalize: normalize, resolve: resolve,
    markSessionDone: markSessionDone, markRestDay: markRestDay, describe: describe,
    readStreak: readStreak, writeStreak: writeStreak
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Streak = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
