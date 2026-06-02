// ============================================================================
// SECTION 7 — Queue
// (includes shuffleInPlace + mixPuzzlesAcrossGames, physically at §4 tail in
// the monolith but logically queue utilities — moved here per Spec 09)
// ============================================================================
import { MOTIFS, MOTIF_LABELS, isExcludedPuzzle } from './config.js';
import { state } from './state.js';
import { $ } from './dom.js';
import { saveLastCategory, loadLastCategory } from './storage.js';
// runtime deps (called inside function bodies only — live bindings handle the cycles)
import { resetPuzzleStateAndRender } from './result.js';
import { sessionModeWriteBack } from './grade.js';

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
  // v0.13 — Today/in-session round-trip. When sessionMode has a non-empty
  // queueIds list, restrict the queue to those ids in plan-order. Vision
  // blocks have queueIds: [] and fall through to the normal queue (calculation
  // drill not built yet → user gets a warm-up from the normal mistake queue).
  if (state.sessionMode && state.sessionMode.queueIds && state.sessionMode.queueIds.length) {
    const byId = new Map(state.puzzles.map((p) => [p.id, p]));
    const ordered = state.sessionMode.queueIds.map((id) => byId.get(id)).filter(Boolean);
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
  if (state.mode === 'drill') {
    return shuffleInPlace(pool);
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
//   Deep mode  — unsolved puzzles only. The mode for learning new patterns.
//   Drill mode — ALL puzzles, including solved ones, for repetition and lower-
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

// Spec 02 — Theme filter row. Renders the 17-motif vocab as a scrollable pill
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
    const ok = m && m !== 'all' && m !== 'untagged' && counts[m] > 0;
    drillBtn.disabled = !ok;
    drillBtn.textContent = ok ? `Drill this theme (${Math.min(10, counts[m])})` : 'Drill this theme';
  }
}

// Drill this theme — assemble up to 10 puzzles with the active motif and put
// them into a focused queue. Banner shows progress. End-drill returns to the
// normal queue.
export function startThemeDrill() {
  const m = state.motifFilter;
  if (!m || m === 'all' || m === 'untagged') return;
  let pool = state.puzzles.filter((p) => !isExcludedPuzzle(p) && p.motif === m);
  shuffleInPlace(pool);
  state.drillMotif = m;
  state.drillQueue = pool.slice(0, 10);
  state.drillIndex = 0;
  if (!state.drillQueue.length) return;
  updateDrillBanner();
  resetPuzzleStateAndRender();
}
export function endThemeDrill() {
  state.drillMotif = null;
  state.drillQueue = [];
  state.drillIndex = 0;
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
    $('drill-label').textContent = `Drilling: ${label} — ${state.drillIndex + 1} of ${state.drillQueue.length}`;
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
  // v0.13 — Session mode: if this block's count is reached (or queue exhausted),
  // navigate back to /session.html so the user sees the transition beat → next
  // block (or the summary). Block.count comes from the plan; we trust the
  // write-back's `done`. Falls back to "queueIndex past the end" so a partial
  // attempt list still returns once everything is played.
  if (state.sessionMode) {
    const ids = state.sessionMode.queueIds;
    const target = state.sessionMode.count || (ids ? ids.length : 0);
    // P0 fix (hotfix/r1.2): count only puzzles solved DURING this session
    // (last solve at/after sessionMode.sinceMs), not lifetime solves — so a
    // drill over already-solved puzzles does not bounce out on the first Next.
    const since = state.sessionMode.sinceMs || 0;
    const solved = ids && ids.length ? ids.filter((id) => { const a = state.attempts[id]; return !!(a && a.solved && (Date.parse(a.lastAt) || 0) >= since); }).length : 0;
    const queueExhausted = ids && ids.length && state.queueIndex >= ids.length - 1;
    if ((target && solved >= target) || queueExhausted) {
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
    // Drill complete — return to the normal queue.
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
