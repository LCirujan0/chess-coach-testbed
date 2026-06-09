/* ============================================================================
 * js/mastery.js — capability MILESTONE markers (retention #7).
 *
 * Pure, dependency-free, node-testable. Marks *competence* thresholds, not raw
 * volume/vanity — "Fork mastered", "Climbed past 1100", "30-day streak" — each
 * derived from the player's real data. The reward is the MOMENT a new one is
 * earned, so diffSeen() flags fresh markers (the caller persists the seen set).
 *
 * Consumed by today.html (a small Milestones row). On-brand: no emoji — the
 * HTML renders clean accent chips keyed by `kind`.
 * ==========================================================================*/
(function (root) {
  'use strict';

  function label(s) { return String(s || '').replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  // markers({ attempts, mistakes, rating, streak, egResults }) -> [{id,label,detail,kind}]
  function markers(input) {
    input = input || {};
    var attempts = input.attempts || {};
    var mistakes = Array.isArray(input.mistakes) ? input.mistakes : [];
    var rating = input.rating;
    var streak = input.streak || {};
    var egResults = input.egResults || {};
    var out = [];

    // 1) Motif mastery — >= 5 puzzles of a tactical motif solved.
    var motifSolved = {};
    mistakes.forEach(function (m) {
      if (!m || !m.id || !m.motif || m.motif === 'none-tactical') return;
      var a = attempts[m.id];
      if (a && a.solved) motifSolved[m.motif] = (motifSolved[m.motif] || 0) + 1;
    });
    Object.keys(motifSolved).sort().forEach(function (mo) {
      if (motifSolved[mo] >= 5) out.push({ id: 'motif:' + mo, kind: 'motif', label: label(mo) + ' mastered', detail: motifSolved[mo] + ' solved' });
    });

    // 2) Highest rating band crossed (>= 1000, in 100s).
    if (typeof rating === 'number' && rating >= 1000) {
      var band = Math.floor(rating / 100) * 100;
      out.push({ id: 'rating:' + band, kind: 'rating', label: 'Climbed past ' + band, detail: 'Chess.com rapid' });
    }

    // 3) Mistakes fixed — highest volume milestone reached.
    var fixed = mistakes.filter(function (m) { return m && m.id && attempts[m.id] && attempts[m.id].solved; }).length;
    [100, 50, 25, 10].some(function (t) { if (fixed >= t) { out.push({ id: 'fixed:' + t, kind: 'volume', label: t + ' mistakes fixed', detail: 'from your own games' }); return true; } return false; });

    // 4) Streak milestone — highest reached (current or best).
    var longest = Math.max(streak.current || 0, streak.longest || 0);
    [30, 14, 7, 3].some(function (t) { if (longest >= t) { out.push({ id: 'streak:' + t, kind: 'streak', label: t + '-day streak', detail: (streak.current || 0) >= t ? 'going now' : 'your best' }); return true; } return false; });

    // 5) First endgame converted (won or held the target).
    var converted = Object.keys(egResults).some(function (k) {
      var r = egResults[k]; var res = r && (r.lastResult || r.result || '');
      return res === 'win' || res === 'won' || res === 'draw' || res === 'drawn';
    });
    if (converted) out.push({ id: 'endgame:first', kind: 'endgame', label: 'Endgame converted', detail: 'held the technique' });

    return out;
  }

  // Diff earned markers against a persisted 'seen' id list. Returns the full set,
  // the FRESH (newly-earned) ones, and the next seen list for the caller to save.
  function diffSeen(earned, seenIds) {
    var seen = {}; (Array.isArray(seenIds) ? seenIds : []).forEach(function (id) { seen[id] = 1; });
    return { all: earned, fresh: earned.filter(function (m) { return !seen[m.id]; }), seen: earned.map(function (m) { return m.id; }) };
  }

  var API = { markers: markers, diffSeen: diffSeen };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Mastery = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
