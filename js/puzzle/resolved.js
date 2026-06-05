// ============================================================================
// SECTION 15 — onItemResolved (the single session write-back path)
// ----------------------------------------------------------------------------
// Spec 21 §2.3. ONE normalised callback that every type calls when an item is
// resolved, so attempt + result counting is identical across types. It:
//   1. records a per-position resolved-this-session marker for the type that
//      needs one (recognition `seen`), into the type's EXISTING store (no new
//      top-level localStorage key);
//   2. recomputes the active block's `done` (= items ATTEMPTED this session)
//      and `correct` (= items resolved CORRECTLY this session) from the truth
//      stores and persists them to chess-coach-session-v1;
//   3. refreshes the persistent session-wrap bar so the pips advance live.
//
// The previous bug (Jorge, v0.58-c1 on-device): the bar only counted SOLVED
// mistakes, so a failed/attempted item never advanced `done` and nothing was
// recorded as an attempt or a result. `done` now advances on every resolved
// item of every type, and `correct` is tracked alongside for the summary.
//
// Type coverage (Spec 21 §1.4): mistake + recognition + endgame all count
// through this one path.
//   - mistake's domain write (attempts ledger, CoachStats) happens in grade.js
//     recordAttempt(); resolved-this-session is read from the attempts ledger's
//     lastAt (written on every attempt, pass or fail).
//   - recognition's domain write (byType accuracy) happens in classify.js
//     recordResult(); resolved-this-session needs an explicit marker, so this
//     module writes a `seen:{ [id]: {at,correct} }` sub-object INSIDE
//     chess-coach-recognition-v1 (no new key).
//   - endgame's domain write (attempts, cleanInARow, mastered, lastResult,
//     lastAt) happens in playout.js saveResult(); the mastery store already
//     stamps `lastAt` (epoch ms) + `lastResult` ('pass'|'fail') per lesson, so
//     resolved-this-session (lastAt >= sinceMs) and correct (lastResult==='pass')
//     are read directly from that store — NO extra marker, no new key.
// This module owns ONLY the cross-type session bookkeeping + the bar, never the
// domain stores' own logic.
// ============================================================================

import { STORAGE_KEY_SESSION } from './config.js';
import { refreshSessionWrap } from '/js/session-wrap.js';

const KEY_ATTEMPTS    = 'chess-coach-attempts-v1';
const KEY_RECOGNITION = 'chess-coach-recognition-v1';
// The endgame play-out mastery store. This is the EXISTING key playout.js
// writes via saveResult() ({ attempts, cleanInARow, mastered, lastResult,
// lastAt }) — see js/puzzle/playout.js. It is the only endgame results store
// in the tree; we read it here, we do NOT introduce a new one.
const KEY_ENDGAMES    = 'chess-coach-eg-results-v1';

function readJson(key, fb) {
  try { const r = localStorage.getItem(key); return r == null ? fb : (JSON.parse(r) ?? fb); }
  catch { return fb; }
}
function writeJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Map a block id to its resolution type. Recognition + endgame are the two
// non-mistake session types; everything else (mistakes/review) is mistake.
function blockTypeOf(block) {
  if (block && block.id === 'recognition') return 'recognition';
  if (block && block.id === 'endgames') return 'endgame';
  return 'mistake';
}

// "Resolved this session" predicates per type. Mistakes use the attempts
// ledger's lastAt (written on EVERY attempt, pass or fail). Recognition uses a
// `seen:{ [id]: lastAtMs }` sub-object kept INSIDE chess-coach-recognition-v1
// (Spec 21 §1.5 — no new key). Endgame uses the mastery store's per-lesson
// `lastAt` epoch + `lastResult` (Spec 21 §1.5 endgame branch).
function resolvedSince(type, id, sinceMs, stores) {
  if (type === 'recognition') {
    const seen = stores.recognition && stores.recognition.seen;
    const rec = seen && seen[id];
    // seen[id] is { at, correct } (current write) or a bare timestamp (legacy).
    if (rec && typeof rec === 'object') return rec.at >= sinceMs;
    return typeof rec === 'number' && rec >= sinceMs;
  }
  if (type === 'endgame') {
    const e = stores.endgames && stores.endgames[id];
    return !!(e && typeof e.lastAt === 'number' && e.lastAt >= sinceMs);
  }
  // mistake (and any attempts-ledger-backed type)
  const a = stores.attempts && stores.attempts[id];
  return !!(a && (Date.parse(a.lastAt) || 0) >= sinceMs);
}

function correctSince(type, id, sinceMs, stores) {
  if (type === 'recognition') {
    const seen = stores.recognition && stores.recognition.seen;
    const rec = seen && seen[id];
    // `seen[id]` may be a timestamp (back-compat) or { at, correct }.
    if (rec && typeof rec === 'object') return rec.correct === true && rec.at >= sinceMs;
    return false; // a bare timestamp predates the correct-tracking write
  }
  if (type === 'endgame') {
    const e = stores.endgames && stores.endgames[id];
    return !!(e && e.lastResult === 'pass' && typeof e.lastAt === 'number' && e.lastAt >= sinceMs);
  }
  const a = stores.attempts && stores.attempts[id];
  return !!(a && a.solved && (Date.parse(a.lastAt) || 0) >= sinceMs);
}

// Recompute done + correct for a single block from the truth stores. `done`
// counts ATTEMPTED-this-session items (the fix); `correct` counts those that
// resolved correctly. Both are clamped to the block count.
export function recomputeBlock(block, sinceMs, stores) {
  const ids = Array.isArray(block.ids) ? block.ids : [];
  const count = typeof block.count === 'number' ? block.count
    : (ids.length || 0);
  if (!ids.length) {
    return { done: Math.min(block.done || 0, count), correct: Math.min(block.correct || 0, count) };
  }
  const type = blockTypeOf(block);
  let done = 0, correct = 0;
  for (const id of ids) {
    if (resolvedSince(type, id, sinceMs, stores)) {
      done++;
      if (correctSince(type, id, sinceMs, stores)) correct++;
    }
  }
  return { done: Math.min(done, count), correct: Math.min(correct, count) };
}

function loadStores() {
  return {
    attempts: readJson(KEY_ATTEMPTS, {}) || {},
    recognition: readJson(KEY_RECOGNITION, {}) || {},
    endgames: readJson(KEY_ENDGAMES, {}) || {},
  };
}

// The single resolution callback. type-tags the result; routes to the type's
// resolved-marker write (recognition only — mistakes have the attempts ledger,
// endgame has the mastery store's lastAt/lastResult); recomputes the active
// block's done/correct; persists; refreshes the bar. Safe no-op outside a
// Today session.
export function onItemResolved(result) {
  const { type, refId, outcome } = result || {};

  // 1. Type-specific resolved-this-session marker (only where the domain store
  //    lacks a per-item timestamp). Recognition: write seen[id] = { at, correct }.
  //    Mistake + endgame both already stamp a per-item lastAt in their own
  //    domain store, so they need no extra marker here.
  if (type === 'recognition' && refId) {
    const store = readJson(KEY_RECOGNITION, {}) || {};
    if (!store.seen) store.seen = {};
    const isCorrect = outcome === 'correct';
    store.seen[refId] = { at: Date.now(), correct: isCorrect };
    writeJson(KEY_RECOGNITION, store);
  }

  // 2. Recompute the active block's done + correct, persist to the session plan.
  let plan = readJson(STORAGE_KEY_SESSION, null);
  const params = new URLSearchParams(window.location.search);
  const blockId = params.get('block');
  if (plan && Array.isArray(plan.blocks) && blockId) {
    const idx = plan.blocks.findIndex((b) => b && b.id === blockId);
    if (idx >= 0) {
      const stores = loadStores();
      const sinceMs = (plan.createdAt ? Date.parse(plan.createdAt) : 0) || 0;
      const { done, correct } = recomputeBlock(plan.blocks[idx], sinceMs, stores);
      plan.blocks[idx].done = done;
      plan.blocks[idx].correct = correct;
      writeJson(STORAGE_KEY_SESSION, plan);
    }
  }

  // 3. Re-render the persistent bar so the pips advance live.
  refreshSessionWrap();
}
