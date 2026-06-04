// ============================================================================
// session-wrap.js — render the PERSISTENT in-session Today wrapper (v0.55)
// ----------------------------------------------------------------------------
// Shared component. Renders the "Mistake 3 of 8 · Block 1 of 2" progress band
// (css/session-wrap.css) INSIDE a training surface so the Today block progress
// stays visible for the whole block, instead of vanishing the moment the player
// deep-links out of session.html.
//
// Drive: the EXISTING session plan in localStorage (chess-coach-session-v1) +
// the ?session=today&block=<id> URL params. NO new storage key. When the
// surface is opened directly (no ?session=today, or no matching block), the
// render is a no-op and the element stays hidden -> the surface shows the plain
// canonical screen.
//
// Usage (any surface):
//   import { renderSessionWrap } from '/js/session-wrap.js';
//   renderSessionWrap(document.getElementById('session-wrap'));
// The element should be the FIRST/empty `.session-wrap` band inside
// `.layout-grid` (css/screen.css orders it as the full-width row above the
// board). The helper fills it and unhides it only when a block is active.
// ============================================================================

const STORAGE_KEY_SESSION = 'chess-coach-session-v1';
// Mirror session.html's noun map so the readout reads identically.
const BLOCK_NOUN = { mistakes: 'Mistake', review: 'Card', vision: 'Position' };
const BLOCK_SHORT = { mistakes: 'Mistakes', review: 'Review', vision: 'Vision' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function loadPlan() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION) || 'null'); }
  catch { return null; }
}

// Count items in a block solved DURING this session (mirrors grade.js /
// session.html: lastAt at/after the plan's createdAt), so a drill over
// previously-solved puzzles is not pre-counted.
function solvedInBlock(block, attempts, sinceMs) {
  const ids = Array.isArray(block.ids) ? block.ids : [];
  if (!ids.length) return Math.max(0, block.done || 0);
  return ids.filter((id) => {
    const a = attempts[id];
    return !!(a && a.solved && (Date.parse(a.lastAt) || 0) >= sinceMs);
  }).length;
}

/**
 * Render the in-session wrapper into `el` if (and only if) the page is in a
 * Today session with a matching active block. Returns true if it rendered
 * (and was shown), false if it stayed hidden (opened directly / no match).
 *
 * @param {HTMLElement|null} el  the `.session-wrap` band element
 * @param {object} [opts]
 * @param {URLSearchParams} [opts.params]  defaults to window.location.search
 * @param {string} [opts.exitHref]         where the exit chip returns (default /session.html)
 */
export function renderSessionWrap(el, opts = {}) {
  if (!el) return false;
  el.classList.add('hidden');
  el.replaceChildren();

  const params = opts.params || new URLSearchParams(window.location.search);
  if (params.get('session') !== 'today') return false;
  const blockId = params.get('block');
  if (!blockId) return false;

  const plan = loadPlan();
  if (!plan || !Array.isArray(plan.blocks) || !plan.blocks.length) return false;
  const activeIdx = plan.blocks.findIndex((b) => b && b.id === blockId);
  if (activeIdx < 0) return false;

  let attempts = {};
  try { attempts = JSON.parse(localStorage.getItem('chess-coach-attempts-v1') || '{}') || {}; } catch {}
  const sinceMs = (plan.createdAt ? Date.parse(plan.createdAt) : 0) || 0;

  const block = plan.blocks[activeIdx];
  const noun = BLOCK_NOUN[block.id] || 'Item';
  const count = typeof block.count === 'number' ? block.count : (Array.isArray(block.ids) ? block.ids.length : 0);
  const done = Math.min(solvedInBlock(block, attempts, sinceMs), count);
  // "Mistake 3 of 8" -> the item currently being worked is done+1 (clamped).
  const cursor = Math.min(done + 1, Math.max(count, 1));

  const nowText = block.title || (BLOCK_SHORT[block.id] || 'Block');
  const ofText = count ? (noun + ' ' + cursor + ' of ' + count + ' · Block ' + (activeIdx + 1) + ' of ' + plan.blocks.length) : ('Block ' + (activeIdx + 1) + ' of ' + plan.blocks.length);
  const mode = (block.mode === 'deep') ? 'Deep' : (block.mode === 'drill') ? 'Drill' : '';

  // segmented rail: one segment per block, a pip per item, current block lit.
  let rail = '';
  plan.blocks.forEach((b, i) => {
    const bCount = typeof b.count === 'number' ? b.count : (Array.isArray(b.ids) ? b.ids.length : 0);
    const bDone = (i < activeIdx) ? bCount : (i === activeIdx ? done : 0);
    let pips = '';
    const pipN = Math.max(bCount, 1);
    for (let p = 0; p < pipN; p++) {
      let cls = '';
      if (p < bDone) cls = 'done';
      else if (i === activeIdx && p === bDone) cls = 'cur';
      pips += '<span class="sw-pip ' + cls + '"></span>';
    }
    const lbl = BLOCK_SHORT[b.id] || ('B' + (i + 1));
    rail += '<div class="sw-seg"><div class="sw-pips">' + pips + '</div><div class="sw-seglabel">' + esc(lbl) + '</div></div>';
  });

  const exitHref = opts.exitHref || '/session.html';
  el.innerHTML =
    '<a class="sw-exit" href="' + esc(exitHref) + '" title="Back to session" aria-label="Back to session">✕</a>' +
    '<div class="sw-body">' +
      '<div class="sw-line"><span class="sw-now">' + esc(nowText) + '</span>' +
        '<span class="sw-of">' + esc(ofText) + '</span></div>' +
      '<div class="sw-rail">' + rail + '</div>' +
    '</div>' +
    (mode ? '<span class="sw-mode">' + esc(mode) + '</span>' : '');

  el.classList.remove('hidden');
  return true;
}

// Re-render the persistent bar in place. Call after a session write-back so the
// pips advance live as the player moves through a block (the bar element is
// owned by the host shell and lives OUTSIDE the per-puzzle swap region, so it
// is never unmounted mid-session). No-op outside a Today session.
let _lastWrapOpts = {};
export function refreshSessionWrap(opts) {
  if (opts) _lastWrapOpts = opts;
  const el = document.getElementById('session-wrap');
  if (!el) return false;
  return renderSessionWrap(el, _lastWrapOpts);
}
