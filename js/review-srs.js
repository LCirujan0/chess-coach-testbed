/* ============================================================================
 * js/review-srs.js, spaced-repetition scheduling for the mistake deck.
 *
 * Pure, dependency-free, node-testable. DERIVES the schedule from the existing
 * attempts store (chess-coach-attempts-v1), no new key. The point (retention
 * #8 / Woodpecker): re-expose a mistake-pattern just before it's forgotten, * failed ones resurface immediately, mastered ones space out, so the daily
 * "Review" block actually BUILDS retention instead of random re-drilling.
 *
 * Leitner boxes: a clean solve promotes a box; a fail drops back toward 0.
 * A puzzle is "due" when (now - lastAttempt) >= the interval for its box.
 *
 * Consumed by today.html (the session "Review" block) + puzzle.html.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var DAY = 86400000;
  // Interval (days) by box. Box 0 = due immediately (a recent/failed miss).
  var INTERVAL_DAYS = [0, 1, 3, 7, 16, 35];

  // Box from the attempt record: count consecutive 'solved' from the tail of the
  // attemptLog (a 'failed' breaks the streak → resets toward 0). Falls back to the
  // cumulative `solved` flag for records that predate attemptLog.
  function box(rec) {
    if (!rec) return 0;
    if (Array.isArray(rec.attemptLog) && rec.attemptLog.length) {
      var b = 0;
      for (var i = rec.attemptLog.length - 1; i >= 0; i--) {
        if (rec.attemptLog[i] && rec.attemptLog[i].outcome === 'solved') b++;
        else break;
      }
      return Math.min(b, INTERVAL_DAYS.length - 1);
    }
    return rec.solved ? 1 : 0;
  }

  function lastAtMs(rec) { var t = rec && Date.parse(rec.lastAt || ''); return isFinite(t) ? t : 0; }
  function dueAtMs(rec) { return lastAtMs(rec) + INTERVAL_DAYS[box(rec)] * DAY; }
  function isAttempted(rec) { return !!(rec && ((rec.attempts || 0) > 0 || rec.solved || (rec.attemptLog && rec.attemptLog.length))); }
  // Due = has been attempted at least once AND its spacing interval has elapsed.
  function isDue(rec, nowMs) { return isAttempted(rec) && (nowMs || Date.now()) >= dueAtMs(rec); }
  function overdueMs(rec, nowMs) { return (nowMs || Date.now()) - dueAtMs(rec); }

  // Build the review queue: due mistakes, most-urgent first (weakest box, then
  // most overdue), capped at `limit`. `puzzles` = mistake records, `attempts` =
  // the attempts store keyed by puzzle id.
  function buildQueue(puzzles, attempts, nowMs, limit) {
    nowMs = nowMs || Date.now();
    attempts = attempts || {};
    var due = (puzzles || []).filter(function (p) { return p && p.id && isDue(attempts[p.id], nowMs); });
    due.sort(function (a, b) {
      var ba = box(attempts[a.id]), bb = box(attempts[b.id]);
      if (ba !== bb) return ba - bb;                                  // weakest first
      return overdueMs(attempts[b.id], nowMs) - overdueMs(attempts[a.id], nowMs); // most overdue first
    });
    return (typeof limit === 'number' && limit > 0) ? due.slice(0, limit) : due;
  }
  function dueCount(puzzles, attempts, nowMs) { return buildQueue(puzzles, attempts, nowMs).length; }

  var API = {
    INTERVAL_DAYS: INTERVAL_DAYS,
    box: box, dueAtMs: dueAtMs, isAttempted: isAttempted, isDue: isDue, overdueMs: overdueMs,
    buildQueue: buildQueue, dueCount: dueCount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ReviewSRS = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
