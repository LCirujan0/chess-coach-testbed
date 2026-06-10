/* ============================================================================
 * js/profile.js — the user's training profile (v0.80, onboarding).
 *
 * WHAT: the user's own answers about their chess ambitions, captured once
 * during onboarding and used to tailor the whole app:
 *   { eloGoal, goalBy ("YYYY-MM"), timeControl ('rapid'|'blitz'|'bullet'|
 *     'classical'), seriousness ('casual'|'regular'|'serious'), updatedAt }
 *
 * Tailoring contract (readers):
 *   - targetElo() replaces the hardcoded 1500 in rings/bars/coach prompts.
 *   - timeControl() drives which Chess.com rating is preferred.
 *   - seriousness seeds chess-coach-daily-goal-v1 at onboarding (so Today
 *     never has to ask again — the picker remains for changing it).
 *
 * Storage: chess-coach-profile-v1 — SYNCED (config.js SYNC_KEYS; merge =
 * newer updatedAt), so the profile lives in Supabase per the owner ask.
 * Window-global pattern (like CoachStats): modules read via typeof guard.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'chess-coach-profile-v1';
  var TIME_CONTROLS = ['rapid', 'blitz', 'bullet', 'classical'];
  var SERIOUSNESS = ['casual', 'regular', 'serious'];
  var DEFAULT_TARGET = 1500;

  function normalize(v) {
    v = (v && typeof v === 'object') ? v : {};
    var goal = Number(v.eloGoal);
    return {
      eloGoal: (Number.isFinite(goal) && goal >= 400 && goal <= 3000) ? Math.round(goal) : null,
      goalBy: (typeof v.goalBy === 'string' && /^\d{4}-\d{2}$/.test(v.goalBy)) ? v.goalBy : null,
      timeControl: TIME_CONTROLS.indexOf(v.timeControl) !== -1 ? v.timeControl : null,
      seriousness: SERIOUSNESS.indexOf(v.seriousness) !== -1 ? v.seriousness : null,
      updatedAt: (typeof v.updatedAt === 'string') ? v.updatedAt : null
    };
  }

  function read() {
    try { return normalize(JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null')); }
    catch (e) { return normalize(null); }
  }
  function write(p) {
    var s = normalize(p);
    s.updatedAt = new Date().toISOString();
    try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* non-fatal */ }
    return s;
  }

  // The user's target rating — every "to 1500" surface should call this.
  function targetElo() { var p = read(); return p.eloGoal || DEFAULT_TARGET; }
  // Preferred time control ('rapid' default — the app's historical primary).
  function timeControl() { return read().timeControl || 'rapid'; }

  // One line for coach system prompts: the goal in the student's own words.
  // Empty when no profile yet (prompts must not carry empty headers).
  function promptLine() {
    var p = read();
    if (!p.eloGoal && !p.timeControl) return '';
    var bits = [];
    if (p.eloGoal) bits.push('their stated goal is ' + p.eloGoal + (p.goalBy ? ' by ' + p.goalBy : ''));
    if (p.timeControl) bits.push('they mainly play ' + p.timeControl);
    if (p.seriousness) bits.push('they describe their commitment as ' + p.seriousness);
    return ' The student set this up themselves: ' + bits.join('; ') + '.';
  }

  var API = {
    KEY: KEY, TIME_CONTROLS: TIME_CONTROLS, SERIOUSNESS: SERIOUSNESS, DEFAULT_TARGET: DEFAULT_TARGET,
    normalize: normalize, read: read, write: write,
    targetElo: targetElo, timeControl: timeControl, promptLine: promptLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.KPProfile = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
