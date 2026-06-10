// ============================================================================
// SECTION 7. Queue
// (includes shuffleInPlace + mixPuzzlesAcrossGames, physically at §4 tail in
// the monolith but logically queue utilities, moved here per Spec 09)
// ============================================================================
import { MOTIFS, MOTIF_LABELS, isExcludedPuzzle, THEME_DRILL_TARGET, DIFFICULTY_TIERS } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { saveLastCategory, loadLastCategory } from './storage.js';
// runtime deps (called inside function bodies only, live bindings handle the cycles)
import { resetPuzzleStateAndRender } from './result.js';
import { sessionModeWriteBack } from './grade.js';
import { topUpMotif } from './lichess.js';

export function isSolved(puzzleId) { const a = state.attempts[puzzleId]; return !!(a && a.solved); }
export function attemptsCount(puzzleId) { const a = state.attempts[puzzleId]; return a ? (a.attempts || 0) : 0; }
export function failedCount(puzzleId) { const a = state.attempts[puzzleId]; return a ? (a.failedAttempts || 0) : 0; }

// Build the randomised play queue for the current mode + filters.
// - Deep mode: split unsolved puzzles into "unseen" (no prior attempts) and
//   "previously-failed" (attempts > 0, not solved). Shuffle each pool. Interleave
//   50/50: first unseen, first failed, second unseen, second failed, etc. When
//   one pool runs out the other continues.
// - Drill mode: single Fisher-Yates shuffled deck of all puzzles matching the
//   current category + severity filter.
export function buildQueue() {
  if (state.reviewPuzzleId) {
    const found = state.puzzles.find((p) => p.id === state.reviewPuzzleId);
    return found ? [found] : [];
  }
  // v0.13. Today/in-session round-trip. When sessionMode has a non-empty
  // queueIds list, restrict the queue to those ids in plan-order. Vision
  // blocks have queueIds: [] and fall through to the normal queue (calculation
  // drill not built yet → user gets a warm-up from the normal mistake queue).
  if (state.sessionMode && state.sessionMode.queueIds && state.sessionMode.queueIds.length) {
    const byId = new Map(state.puzzles.map((p) => [p.id, p]));
    // Owner fix (2026-06-10): re-entering a block must NEVER re-serve an item
    // already resolved this session. Unresolved items first (plan order),
    // resolved ones pushed to the back so the cursor lands on real work.
    const since = state.sessionMode.sinceMs || 0;
    const isResolved = (id) => { const a = state.attempts[id]; return !!(a && (Date.parse(a.lastAt) || 0) >= since); };
    const ids = state.sessionMode.queueIds;
    const ordered = [...ids.filter((id) => !isResolved(id)), ...ids.filter(isResolved)]
      .map((id) => byId.get(id)).filter(Boolean);
    return ordered;
  }
  let pool = state.puzzles.slice();
  // No ingested puzzles → just the default puzzle.
  if (!state.hasIngestedPuzzles) return pool;
  // Drop puzzles whose starting position is already mate or hopelessly lost.
  pool = pool.filter((p) => !isExcludedPuzzle(p));
  if (state.severityFilter && state.severityFilter !== 'all') pool = pool.filter((p) => p.severity === state.severityFilter);
  if (state.currentCategory && state.currentCategory !== 'all') pool = pool.filter((p) => p.category === state.currentCategory);
  if (state.triedFilter === 'tried') pool = pool.filter((p) => attemptsCount(p.id) > 0);
  else if (state.triedFilter === 'untried') pool = pool.filter((p) => attemptsCount(p.id) === 0);
  if (state.motifFilter === 'untagged') pool = pool.filter((p) => !p.motif);
  else if (state.motifFilter && state.motifFilter !== 'all') pool = pool.filter((p) => p.motif === state.motifFilter);
  // Unified puzzle schema (phase 1a), filter by puzzle type. Recognition
  // entries carry their puzzle-type in `puzzleType` (their `type` is the
  // material signature), so check both fields.
  if (state.typeFilter && state.typeFilter !== 'all') { pool = pool.filter((p) => (p.type || p.puzzleType) === state.typeFilter); }
  if (state.mode === 'drill') {
    // Drill keeps solved puzzles AVAILABLE (repetition is the point of the
    // mode) but serves the unsolved ones first (owner fix 2026-06-10: a fresh
    // queue must not open on something you just completed).
    const fresh = pool.filter((p) => !isSolved(p.id));
    const done = pool.filter((p) => isSolved(p.id));
    shuffleInPlace(fresh);
    shuffleInPlace(done);
    return fresh.concat(done);
  }
  // Deep mode: unsolved only, 50/50 unseen vs previously-failed.
  const unsolved = pool.filter((p) => !isSolved(p.id));
  const unseen = unsolved.filter((p) => attemptsCount(p.id) === 0);
  const failed = unsolved.filter((p) => attemptsCount(p.id) > 0);
  shuffleInPlace(unseen);
  shuffleInPlace(failed);
  const out = [];
  const longer = Math.max(unseen.length, failed.length);
  for (let i = 0; i < longer; i++) {
    if (i < unseen.length) out.push(unseen[i]);
    if (i < failed.length) out.push(failed[i]);
  }
  return out;
}

export function rebuildQueue() {
  state.queue = buildQueue();
  state.queueIndex = 0;
}

// Routing rule:
//   Deep mode, unsolved puzzles only. The mode for learning new patterns.
//   Drill mode. ALL puzzles, including solved ones, for repetition and lower-
//                energy sessions. Solved puzzles keep their star rating but
//                are available to re-attempt.
export function filteredPuzzles() {
  let arr = state.puzzles;
  if (state.reviewPuzzleId) return arr.filter((p) => p.id === state.reviewPuzzleId);
  // If no ingested puzzles, the default puzzle is shown in both modes so the
  // user can always interact with something.
  if (!state.hasIngestedPuzzles) return arr;
  arr = arr.filter((p) => !isExcludedPuzzle(p));
  if (state.severityFilter !== 'all') arr = arr.filter((p) => p.severity === state.severityFilter);
  if (state.triedFilter === 'tried') arr = arr.filter((p) => attemptsCount(p.id) > 0);
  else if (state.triedFilter === 'untried') arr = arr.filter((p) => attemptsCount(p.id) === 0);
  if (state.mode === 'deep') {
    // Deep: focus on unsolved patterns.
    arr = arr.filter((p) => !isSolved(p.id));
  }
  // Drill: keep all puzzles, including solved, for repetition.
  return arr;
}
export function puzzlesByCategory(cat) { return filteredPuzzles().filter((p) => p.category === cat); }
export function getCurrentPuzzle() {
  if (state.reviewPuzzleId) {
    const found = state.puzzles.find((p) => p.id === state.reviewPuzzleId);
    if (found) return found;
  }
  // Drill queue takes precedence over the normal queue when active.
  if (state.drillMotif && state.drillQueue.length) {
    return state.drillQueue[state.drillIndex] || null;
  }
  return state.queue[state.queueIndex] || null;
}

// Add motif-aware counts for the Theme filter UI.
export function motifCounts() {
  let base = state.puzzles.filter((p) => !isExcludedPuzzle(p));
  if (state.severityFilter !== 'all') base = base.filter((p) => p.severity === state.severityFilter);
  if (state.currentCategory && state.currentCategory !== 'all') base = base.filter((p) => p.category === state.currentCategory);
  if (state.triedFilter === 'tried') base = base.filter((p) => attemptsCount(p.id) > 0);
  else if (state.triedFilter === 'untried') base = base.filter((p) => attemptsCount(p.id) === 0);
  if (state.mode === 'deep') base = base.filter((p) => !isSolved(p.id));
  const counts = { all: base.length, untagged: base.filter((p) => !p.motif).length };
  for (const m of MOTIFS) counts[m] = base.filter((p) => p.motif === m).length;
  return counts;
}
export function severityCounts() {
  // Counts of available severities AFTER excluding mate/lost positions. We
  // don't dock the count by the tried/untried or category filter because that
  // would make the severity tabs go to zero when the user picks a narrow combo
  // and they'd have no way to step back.
  const base = state.puzzles.filter((p) => !isExcludedPuzzle(p));
  return {
    all: base.length,
    inaccuracy: base.filter((p) => p.severity === 'inaccuracy').length,
    mistake: base.filter((p) => p.severity === 'mistake').length,
    blunder: base.filter((p) => p.severity === 'blunder').length,
  };
}
export function categoryCounts() {
  const f = filteredPuzzles();
  return {
    all: f.length,
    opening: f.filter((p) => p.category === 'opening').length,
    middlegame: f.filter((p) => p.category === 'middlegame').length,
    endgame: f.filter((p) => p.category === 'endgame').length,
  };
}
export function triedCounts() {
  // Same exclude-then-count pattern: base on severity + category + exclusion,
  // but NOT on tried/untried itself.
  let base = state.puzzles.filter((p) => !isExcludedPuzzle(p));
  if (state.severityFilter !== 'all') base = base.filter((p) => p.severity === state.severityFilter);
  if (state.currentCategory && state.currentCategory !== 'all') base = base.filter((p) => p.category === state.currentCategory);
  if (state.mode === 'deep') base = base.filter((p) => !isSolved(p.id));
  return {
    all: base.length,
    tried: base.filter((p) => attemptsCount(p.id) > 0).length,
    untried: base.filter((p) => attemptsCount(p.id) === 0).length,
  };
}
export function renderFilterTabs() {
  const sc = severityCounts();
  $('count-all').textContent = sc.all;
  $('count-inaccuracy').textContent = sc.inaccuracy;
  $('count-mistake').textContent = sc.mistake;
  $('count-blunder').textContent = sc.blunder;
  for (const tab of document.querySelectorAll('.filter-tab')) {
    const s = tab.dataset.sev;
    tab.classList.toggle('active', s === state.severityFilter);
    tab.classList.toggle('empty', sc[s] === 0 && s !== 'all');
  }
  // Show the Filters toggle (which contains the severity panel) only when
  // ingested puzzles exist.
  $('filter-toggle').style.display = state.hasIngestedPuzzles ? 'flex' : 'none';
  updateFilterBadge();
}
export function renderCategoryTabs() {
  const counts = categoryCounts();
  $('count-cat-all').textContent = counts.all;
  $('count-opening').textContent = counts.opening;
  $('count-middlegame').textContent = counts.middlegame;
  $('count-endgame').textContent = counts.endgame;
  for (const tab of document.querySelectorAll('.cat-tab')) {
    const cat = tab.dataset.cat;
    tab.classList.toggle('active', cat === state.currentCategory);
    tab.classList.toggle('empty', counts[cat] === 0 && cat !== 'all');
  }
  renderTriedTabs();
  renderThemePills();
  updateDrillBanner();
  updateFilterBadge();
}
export function renderTriedTabs() {
  const counts = triedCounts();
  $('count-tried-all').textContent = counts.all;
  $('count-tried').textContent = counts.tried;
  $('count-untried').textContent = counts.untried;
  for (const tab of document.querySelectorAll('.tried-tab')) {
    const t = tab.dataset.tried;
    tab.classList.toggle('active', t === state.triedFilter);
    tab.classList.toggle('empty', counts[t] === 0 && t !== 'all');
  }
}
export function updateFilterBadge() {
  const parts = [];
  if (state.severityFilter !== 'all') parts.push(capitalize(state.severityFilter));
  if (state.currentCategory && state.currentCategory !== 'all') parts.push(capitalize(state.currentCategory));
  if (state.triedFilter === 'tried') parts.push('Tried');
  else if (state.triedFilter === 'untried') parts.push('Untried');
  if (state.motifFilter && state.motifFilter !== 'all') parts.push(MOTIF_LABELS[state.motifFilter] || state.motifFilter);
  $('filter-badge').textContent = parts.length ? parts.join(' · ') : 'All puzzles';
}

// Spec 02. Theme filter row. Renders the 17-motif vocab as a scrollable pill
// group inside the collapsible "Theme" control, drives the Drill this theme
// CTA, and shows the active selection in the collapsed summary.
export function renderThemePills() {
  const counts = motifCounts();
  const pillsHost = $('theme-pills');
  if (!pillsHost) return;
  const pills = [];
  // "Any theme" reset pill
  pills.push(`<button class="theme-pill ${state.motifFilter === 'all' ? 'active' : ''}" data-motif="all">Any <span class="count">${counts.all}</span></button>`);
  for (const m of MOTIFS) {
    const c = counts[m] || 0;
    const cls = ['theme-pill'];
    if (state.motifFilter === m) cls.push('active');
    if (c === 0) cls.push('empty');
    pills.push(`<button class="${cls.join(' ')}" data-motif="${m}">${MOTIF_LABELS[m]} <span class="count">${c}</span></button>`);
  }
  if (counts.untagged > 0) {
    pills.push(`<button class="theme-pill ${state.motifFilter === 'untagged' ? 'active' : ''}" data-motif="untagged">Untagged <span class="count">${counts.untagged}</span></button>`);
  }
  pillsHost.innerHTML = pills.join('');
  // Difficulty pills (owner spec 2026-06-10): tier by solver-move count. The
  // tier governs the LIBRARY supply of "Drill this theme"; own-game mistakes
  // have no fixed line length, so a non-'any' tier makes the drill library-only.
  const diffHost = $('difficulty-pills');
  if (diffHost) {
    if (!state.drillDifficulty) state.drillDifficulty = 'any';
    diffHost.innerHTML = DIFFICULTY_TIERS.map((t) =>
      `<button class="theme-pill ${state.drillDifficulty === t.id ? 'active' : ''}" data-difficulty="${t.id}"` +
      (t.hint ? ` title="${t.hint}"` : '') + `>${t.label}</button>`).join('');
  }
  // Update collapsed-state label.
  const current = $('theme-current');
  if (current) {
    if (state.motifFilter && state.motifFilter !== 'all') current.textContent = MOTIF_LABELS[state.motifFilter] || state.motifFilter;
    else current.textContent = 'Any theme';
  }
  // Drill button: enabled only when a specific motif is selected and >0 puzzles available.
  const drillBtn = $('drill-cta');
  if (drillBtn) {
    const m = state.motifFilter;
    // none-tactical has no library supply (topUpMotif rejects it), so a drill
    // would never fill to target, disable the CTA for it like all/untagged.
    const ok = m && m !== 'all' && m !== 'untagged' && m !== 'none-tactical' && counts[m] > 0;
    drillBtn.disabled = !ok;
    drillBtn.textContent = ok ? `Drill this theme (${Math.min(10, counts[m])})` : 'Drill this theme';
  }
}

// Drill this theme, assemble up to 10 puzzles with the active motif and put
// them into a focused queue. Banner shows progress. End-drill returns to the
// normal queue.
export async function startThemeDrill() {
  const m = state.motifFilter;
  if (!m || m === 'all' || m === 'untagged') return;
  // Difficulty tier: 'any' keeps the own-game-first behaviour; a specific tier
  // draws library-only so every drilled puzzle genuinely matches the tier
  // (own-game mistakes have no fixed solution length to classify by).
  const tier = DIFFICULTY_TIERS.find((t) => t.id === (state.drillDifficulty || 'any')) || DIFFICULTY_TIERS[0];
  const tierOnly = tier.id !== 'any';
  // 1) Own-game pool: current behaviour, same-motif mistakes, shuffled. Tag
  //    each with source 'mine' so the grader/Completed route correctly.
  let pool = tierOnly ? [] : state.puzzles.filter((p) => !isExcludedPuzzle(p) && p.motif === m);
  shuffleInPlace(pool);
  const own = pool.slice(0, THEME_DRILL_TARGET);
  for (const p of own) { if (p.source == null) p.source = 'mine'; }
  state.drillMotif = m;
  state.drillQueue = own.slice();
  state.drillIndex = 0;
  state.drillSourceSplit = { mine: own.length, lichess: 0 };
  // Render the own-game queue first so the drill is interactive immediately,
  // even before the (lazy, possibly slow) Lichess pack resolves.
  if (state.drillQueue.length) {
    updateDrillBanner();
    resetPuzzleStateAndRender();
  }
  // 2) Supply top-up: if the own-game pool is below target, fill from the
  //    Lichess pack (same motif, rating ±window around the calibrated rating),
  //    skipping already-solved/queued ids. Own-game first, then Lichess.
  const need = THEME_DRILL_TARGET - state.drillQueue.length;
  if (need > 0) {
    const excludeIds = state.drillQueue.map((p) => p.id);
    let topUp = [];
    try {
      topUp = await topUpMotif(m, { ratingCenter: state.userRating, count: need, excludeIds, difficulty: tierOnly ? tier : null });
    } catch (err) { console.warn('themed-drill top-up failed:', err && err.message); }
    // Guard against a stale resolve: only apply if the user is still drilling
    // the same motif (they may have ended/switched while the pack loaded).
    if (topUp.length && state.drillMotif === m) {
      const wasEmpty = own.length === 0;
      state.drillQueue = state.drillQueue.concat(topUp);
      state.drillSourceSplit = { mine: own.length, lichess: topUp.length };
      updateDrillBanner();
      // If there was no own-game puzzle to render at the start, the board is
      // still on the normal queue, load the first (Lichess) drill puzzle now.
      if (wasEmpty) resetPuzzleStateAndRender();
    }
  }
  // If the own-game pool was empty AND the top-up also came up empty, there is
  // nothing to drill, clear the drill so the banner hides cleanly.
  if (!state.drillQueue.length) {
    state.drillMotif = null;
    state.drillSourceSplit = null;
    updateDrillBanner();
  }
}
export function endThemeDrill() {
  state.drillMotif = null;
  state.drillQueue = [];
  state.drillIndex = 0;
  state.drillSourceSplit = null;
  updateDrillBanner();
  rebuildQueue();
  resetPuzzleStateAndRender();
}
export function updateDrillBanner() {
  const banner = $('drill-banner');
  if (!banner) return;
  if (state.drillMotif && state.drillQueue.length) {
    banner.classList.remove('hidden');
    const label = MOTIF_LABELS[state.drillMotif] || state.drillMotif;
    const diff = (state.drillDifficulty && state.drillDifficulty !== 'any')
      ? ' · ' + (DIFFICULTY_TIERS.find((t) => t.id === state.drillDifficulty) || {}).label : '';
    let text = `Drilling: ${label}${diff}, ${state.drillIndex + 1} of ${state.drillQueue.length}`;
    // Spec 17, honest supply note when the drill was topped up from the
    // library. Only shown when both sources contributed (don't add noise to a
    // pure own-game or pure-library drill where the total already tells it).
    const split = state.drillSourceSplit;
    if (split && split.lichess > 0 && split.mine > 0) {
      text += ` · ${split.mine} from your games + ${split.lichess} from the library`;
    } else if (split && split.lichess > 0 && split.mine === 0) {
      text += ` · ${split.lichess} from the library`;
    }
    $('drill-label').textContent = text;
  } else {
    banner.classList.add('hidden');
  }
}
export function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function pickInitialCategory() {
  // Default is "all" now that the Phase filter has an All tab. Honour the
  // user's last explicit pick if it still has puzzles.
  const counts = categoryCounts();
  const last = loadLastCategory();
  if (last === 'all') return 'all';
  if (last && counts[last] > 0) return last;
  return 'all';
}
export function loadPuzzleAt(category, index) {
  state.currentCategory = category;
  saveLastCategory(category);
  rebuildQueue();
  state.queueIndex = Math.max(0, Math.min(index, state.queue.length - 1));
  resetPuzzleStateAndRender();
}
export function nextPuzzle() {
  state.reviewPuzzleId = null;
  // v0.13. Session mode: if this block's count is reached (or queue exhausted),
  // navigate back to /session.html so the user sees the transition beat → next
  // block (or the summary). Block.count comes from the plan; we trust the
  // write-back's `done`. Falls back to "queueIndex past the end" so a partial
  // attempt list still returns once everything is played.
  if (state.sessionMode) {
    const ids = state.sessionMode.queueIds;
    const target = state.sessionMode.count || (ids ? ids.length : 0);
    // The block completes when every item has been RESOLVED (attempted) this
    // session, pass OR fail, not only when all are solved (v0.58-c1 fix:
    // failed items used to never advance the block, stranding the player).
    // Count only resolutions at/after sessionMode.sinceMs so a drill over
    // already-seen items doesn't bounce out on the first Next.
    const since = state.sessionMode.sinceMs || 0;
    const resolved = ids && ids.length ? ids.filter((id) => { const a = state.attempts[id]; return !!(a && (Date.parse(a.lastAt) || 0) >= since); }).length : 0;
    const queueExhausted = ids && ids.length && state.queueIndex >= ids.length - 1;
    if ((target && resolved >= target) || queueExhausted) {
      // One last write-back so session.html reads the final count.
      sessionModeWriteBack();
      window.location.href = '/session.html';
      return;
    }
  }
  // Drill takes precedence: advance through the focused theme queue, then
  // auto-end the drill back into normal flow when finished.
  if (state.drillMotif && state.drillQueue.length) {
    if (state.drillIndex < state.drillQueue.length - 1) {
      state.drillIndex++;
      updateDrillBanner();
      resetPuzzleStateAndRender();
      return;
    }
    // Drill complete, return to the normal queue.
    endThemeDrill();
    return;
  }
  if (!state.queue.length) rebuildQueue();
  if (!state.queue.length) {
    // Fallback chain: try other phases, then relax to "all" phases + "all"
    // tried so the queue isn't empty just because the filter combo is narrow.
    for (const c of ['all', 'opening', 'middlegame', 'endgame']) {
      if (c === state.currentCategory) continue;
      state.currentCategory = c;
      saveLastCategory(c);
      rebuildQueue();
      if (state.queue.length) { resetPuzzleStateAndRender(); return; }
    }
    resetPuzzleStateAndRender();
    return;
  }
  state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  resetPuzzleStateAndRender();
}

// ---- straddler functions (physically §4 tail in the monolith, logically queue utilities) ----
export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function mixPuzzlesAcrossGames(puzzles) {
  const groups = new Map();
  for (const p of puzzles) {
    const k = p.gameUrl || p.source || p.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const groupArr = Array.from(groups.values());
  for (const g of groupArr) shuffleInPlace(g);
  shuffleInPlace(groupArr);
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const g of groupArr) { if (g.length) { out.push(g.shift()); added = true; } }
  }
  return out;
}
