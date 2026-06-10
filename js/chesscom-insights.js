/* ============================================================================
 * js/chesscom-insights.js, derived insights from the per-game Chess.com
 * capture (chess-coach-game-meta-v1, Spec 24) (v0.80).
 *
 * The headline derivation is the per-game PERFORMANCE RATING estimate. "what
 * level did you actually play at in this game", independent of your slow-moving
 * Elo: perf = opponent rating + 400 on a win, − 400 on a loss, ±0 on a draw
 * (the standard single-game performance formula). Averaged over a window it
 * answers the owner's ask: "the estimated rating for individual games and how
 * it evolves, and what that means": perf above your current rating = your Elo
 * has not caught up yet; below = you are running hot.
 *
 * Pure + window-global (like CoachStats); no fetch, no DOM. Readers:
 * onboarding (wow insights), insights.html (performance panel), games review.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var DRAWS = { agreed: 1, repetition: 1, stalemate: 1, insufficient: 1, '50move': 1, timevsinsufficient: 1, draw: 1 };

  // 'win' | 'draw' | 'loss' | null from a meta record (defensive, fields are
  // whatever chess.com sent at capture time).
  function normResult(m) {
    if (!m) return null;
    var r = String(m.resultForUser || m.result || '').toLowerCase();
    if (r === 'win' || r === '1-0w' ) return 'win';
    if (DRAWS[r]) return 'draw';
    if (r) return 'loss';
    return null;
  }

  // Single-game performance estimate. Null when opponent rating is unknown.
  function perfOf(m) {
    var res = normResult(m);
    var opp = m && Number(m.oppRating);
    if (!res || !Number.isFinite(opp)) return null;
    return Math.round(opp + (res === 'win' ? 400 : res === 'loss' ? -400 : 0));
  }

  // The estimate is only informative when the pairing was close, beyond ±400
  // it saturates (beating a far weaker player reads as a "low" performance).
  // Display surfaces and the aggregate series use this guard.
  function fairPairing(m) {
    var mine = m && Number(m.rating), opp = m && Number(m.oppRating);
    if (!Number.isFinite(mine) || !Number.isFinite(opp)) return true; // unknown → don't exclude
    return Math.abs(opp - mine) <= 400;
  }

  // Chronological [{at(ms), perf, rating, res}] from the meta map.
  function perfSeries(metaMap) {
    var out = [];
    var map = (metaMap && typeof metaMap === 'object') ? metaMap : {};
    Object.keys(map).forEach(function (k) {
      var m = map[k];
      if (!m || typeof m.endTime !== 'number' || !fairPairing(m)) return;
      var p = perfOf(m);
      if (p == null) return;
      out.push({ at: m.endTime * 1000, perf: p, rating: Number(m.rating) || null, res: normResult(m), key: k });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  function avg(arr) { return arr.length ? Math.round(arr.reduce(function (s, v) { return s + v; }, 0) / arr.length) : null; }

  // The aggregate read across all captured games.
  function summarize(metaMap) {
    var map = (metaMap && typeof metaMap === 'object') ? metaMap : {};
    var keys = Object.keys(map);
    var s = {
      games: 0, wins: 0, draws: 0, losses: 0,
      avgPerf: null, avgOpp: null, recentPerf: null,      // recent = last 10
      accAvg: null, accCount: 0, accOppAvg: null,
      byColor: { white: { n: 0, w: 0 }, black: { n: 0, w: 0 } },
      lossTerminations: {},                                // how you LOSE
      openings: [],                                        // [{name, eco, n, wins, scorePct}]
      vsStronger: { n: 0, w: 0 }, vsWeaker: { n: 0, w: 0 },
    };
    var perfs = [], opps = [], accs = [], accOpp = [];
    var series = perfSeries(map);
    var openingsByName = {};
    keys.forEach(function (k) {
      var m = map[k]; if (!m) return;
      var res = normResult(m); if (!res) return;
      s.games++;
      if (res === 'win') s.wins++; else if (res === 'draw') s.draws++; else s.losses++;
      var p = fairPairing(m) ? perfOf(m) : null; if (p != null) perfs.push(p);
      if (Number.isFinite(Number(m.oppRating))) opps.push(Number(m.oppRating));
      if (Number.isFinite(Number(m.userAccuracy))) { accs.push(Number(m.userAccuracy)); s.accCount++; }
      if (Number.isFinite(Number(m.oppAccuracy))) accOpp.push(Number(m.oppAccuracy));
      var colName = String(m.userColorName || '').toLowerCase();
      if (colName === 'white' || colName === 'black') {
        var c = s.byColor[colName];
        c.n++; if (res === 'win') c.w++;
      }
      if (res === 'loss' && m.termination) {
        var t = String(m.termination).toLowerCase();
        s.lossTerminations[t] = (s.lossTerminations[t] || 0) + 1;
      }
      if (m.openingName || m.eco) {
        var name = m.openingName || m.eco;
        var o = openingsByName[name] || (openingsByName[name] = { name: name, eco: m.eco || null, n: 0, wins: 0, draws: 0 });
        o.n++; if (res === 'win') o.wins++; if (res === 'draw') o.draws++;
      }
      var opp = Number(m.oppRating), mine = Number(m.rating);
      if (Number.isFinite(opp) && Number.isFinite(mine)) {
        var bucket = (opp >= mine + 25) ? s.vsStronger : (opp <= mine - 25) ? s.vsWeaker : null;
        if (bucket) { bucket.n++; if (res === 'win') bucket.w++; }
      }
    });
    s.avgPerf = avg(perfs);
    s.avgOpp = avg(opps);
    s.recentPerf = avg(series.slice(-10).map(function (e) { return e.perf; }));
    s.accAvg = accs.length ? Math.round(avg(accs)) : null;
    s.accOppAvg = accOpp.length ? Math.round(avg(accOpp)) : null;
    s.openings = Object.keys(openingsByName).map(function (n) {
      var o = openingsByName[n];
      o.scorePct = Math.round(100 * (o.wins + o.draws / 2) / o.n);
      return o;
    }).sort(function (a, b) { return b.n - a.n; });
    return s;
  }

  // Plain-language read of perf vs current rating. "what it means".
  // (Number(null) is 0, so the null check must come first, caught by the
  // pure-modules harness: a missing rating must yield NO meaning, not "you
  // are 1200 points above your rating of zero".)
  function perfMeaning(recentPerf, currentRating) {
    if (recentPerf == null || currentRating == null || !Number.isFinite(Number(currentRating))) return '';
    var d = recentPerf - currentRating;
    if (d >= 60) return 'You have been playing about ' + d + ' points above your rating, your Elo has not caught up with your level yet. Keep this up and it will.';
    if (d <= -60) return 'Your recent games ran about ' + Math.abs(d) + ' points below your rating, usually a sign of rushed games or tilt, not lost skill.';
    return 'Your recent performance matches your rating, improvement now comes from removing your recurring mistakes.';
  }

  var API = { normResult: normResult, perfOf: perfOf, perfSeries: perfSeries, summarize: summarize, perfMeaning: perfMeaning };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ChesscomInsights = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
