/* ============================================================================
 * js/coach-memory.js — the coach's compact per-user memory (v0.79).
 *
 * WHAT: a small, capped set of plain-language notes the coach has learned
 * about THIS student ("rushes recaptures under pressure", "strong on back-rank
 * patterns, weak on pins", "prefers aggressive lines"). Injected into every
 * coach system prompt so each surface talks like the same teacher who has
 * watched this student before.
 *
 * EFFICIENCY CONTRACT (the whole point — owner ask 2026-06-10): the memory can
 * NEVER grow unbounded into the context window. Hard caps: at most MAX_NOTES
 * notes, each at most NOTE_MAX_CHARS chars, newest-first. The single WRITER is
 * the end-of-session debrief (js/session-wrap.js renderSummary path): the
 * debrief model returns a full replacement set of notes (it sees the old set
 * and the new session), so the memory is consolidated on every write instead
 * of appended to. One writer, many readers — no drift.
 *
 * Storage: chess-coach-coach-memory-v1 = { notes:[{t,at}], updatedAt }
 * Synced cross-device (js/puzzle/config.js SYNC_KEYS; merge = newer updatedAt).
 *
 * Pure/normalising core is node-testable; localStorage wrappers are guarded.
 * Window-global pattern (like CoachStats/Streak): modules read via
 * `typeof CoachMemory !== 'undefined'`, never import it.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'chess-coach-coach-memory-v1';
  var MAX_NOTES = 12;
  var NOTE_MAX_CHARS = 140;

  function normalize(v) {
    v = (v && typeof v === 'object') ? v : {};
    var notes = Array.isArray(v.notes) ? v.notes : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < notes.length && out.length < MAX_NOTES; i++) {
      var n = notes[i];
      var t = (n && typeof n.t === 'string') ? n.t.trim() : (typeof n === 'string' ? n.trim() : '');
      if (!t) continue;
      t = t.slice(0, NOTE_MAX_CHARS);
      var k = t.toLowerCase();
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ t: t, at: (n && typeof n.at === 'number') ? n.at : 0 });
    }
    return {
      notes: out,
      updatedAt: (typeof v.updatedAt === 'string') ? v.updatedAt : null
    };
  }

  // Replace the note set with the debrief model's consolidated output.
  // `now` injectable for tests. Strings or {t} objects accepted.
  function applyUpdate(state, newNotes, now) {
    var s = normalize(state);
    if (!Array.isArray(newNotes)) return s;
    var stamped = newNotes.map(function (n) {
      var t = (typeof n === 'string') ? n : (n && n.t);
      return { t: String(t || '').trim(), at: now || Date.now() };
    }).filter(function (n) { return n.t; });
    return normalize({ notes: stamped, updatedAt: new Date(now || Date.now()).toISOString() });
  }

  // The prompt block readers append to their system prompt. Empty string when
  // there is nothing remembered yet (prompts must not carry an empty header).
  function promptBlock(state) {
    var s = normalize(state);
    if (!s.notes.length) return '';
    return '\n\nWHAT YOU ALREADY KNOW ABOUT THIS STUDENT (from previous sessions; weave in naturally, never recite the list):\n' +
      s.notes.map(function (n) { return '- ' + n.t; }).join('\n');
  }

  // The block handed to the debrief WRITER so it can consolidate rather than
  // append: it must return the full new set (max MAX_NOTES, short).
  function writerBlock(state) {
    var s = normalize(state);
    return '\n\nCURRENT MEMORY NOTES (consolidate: keep what still holds, merge duplicates, drop what this session disproved, add at most 2 new observations; return the FULL new set, max ' +
      MAX_NOTES + ' notes, each under ' + NOTE_MAX_CHARS + ' characters):\n' +
      (s.notes.length ? s.notes.map(function (n) { return '- ' + n.t; }).join('\n') : '(none yet)');
  }

  // ---------- browser-only persistence (guarded; absent under node) ----------
  function read() {
    try { return normalize(JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null')); }
    catch (e) { return normalize(null); }
  }
  function write(state) {
    try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(normalize(state))); }
    catch (e) { /* non-fatal */ }
  }

  var API = {
    KEY: KEY, MAX_NOTES: MAX_NOTES, NOTE_MAX_CHARS: NOTE_MAX_CHARS,
    normalize: normalize, applyUpdate: applyUpdate,
    promptBlock: promptBlock, writerBlock: writerBlock,
    read: read, write: write
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CoachMemory = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
