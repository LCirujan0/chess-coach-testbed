import { STORAGE_KEY_MISTAKES, STORAGE_KEY_INGESTED_GAMES } from './config.js';
import { $ } from './dom.js';
// ============================================================================
// SECTION 4 — STORAGE
// ============================================================================

function loadMistakes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MISTAKES);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveMistakes(arr) {
  localStorage.setItem(STORAGE_KEY_MISTAKES, JSON.stringify(arr));
}

function mergeMistakes(existing, fresh) {
  const byId = new Map();
  for (const m of existing) byId.set(m.id, m);
  for (const m of fresh) byId.set(m.id, m); // overwrite by ID
  return Array.from(byId.values());
}

function loadIngestedGameUrls() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INGESTED_GAMES);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveIngestedGameUrls(set) {
  localStorage.setItem(STORAGE_KEY_INGESTED_GAMES, JSON.stringify(Array.from(set)));
}

function renderSavedStats() {
  const all = loadMistakes();
  $('stat-opening').textContent = all.filter((m) => m.category === 'opening').length;
  $('stat-middlegame').textContent = all.filter((m) => m.category === 'middlegame').length;
  $('stat-endgame').textContent = all.filter((m) => m.category === 'endgame').length;
  const ingestedCount = loadIngestedGameUrls().size;
  const ingestedEl = $('stat-ingested');
  if (ingestedEl) ingestedEl.textContent = ingestedCount;
}

// Persist ONE game's results as it finishes (called per-game from ingest) so a
// mid-sync navigation keeps finished games and a re-sync resumes. Best-effort —
// every step is guarded so a storage hiccup never breaks the run. Moved here
// from boot.js (v0.80) so onboarding.html can reuse the pipeline without the
// games-page DOM wiring.
function persistGameIncrementally(g) {
  if (!g) return;
  try { if (Array.isArray(g.mistakes) && g.mistakes.length) saveMistakes(mergeMistakes(loadMistakes(), g.mistakes)); } catch (e) {}
  const mergeOne = (key, val) => {
    if (!val || !g.key) return;
    try { const o = JSON.parse(localStorage.getItem(key) || '{}') || {}; o[g.key] = val; localStorage.setItem(key, JSON.stringify(o)); } catch (e) {}
  };
  mergeOne('chess-coach-game-scorecards-v1', g.scorecard);
  mergeOne('chess-coach-game-moves-v1', g.moves);
  mergeOne('chess-coach-game-meta-v1', g.meta);
  if (typeof g.rating === 'number' && g.endTime) {
    try {
      const KEY = 'chess-coach-rating-history-v1';
      let h = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(h)) h = [];
      const at = new Date(g.endTime * 1000).toISOString();
      if (!h.some((p) => p && p.at === at)) {
        h.push({ rating: g.rating, at });
        h.sort((a, b) => new Date(a.at) - new Date(b.at));
        localStorage.setItem(KEY, JSON.stringify(h));
        const latest = h[h.length - 1];
        if (latest) localStorage.setItem('chess-coach-user-rating-v1', JSON.stringify({ rating: latest.rating, fetchedAt: new Date().toISOString() }));
      }
    } catch (e) {}
  }
  if (g.gameUrl) { try { const set = loadIngestedGameUrls(); set.add(g.gameUrl); saveIngestedGameUrls(set); } catch (e) {} }
  // Storage cap (2026-06-10 audit): keep the most recent 100 games' move
  // lists. Ordered by the game's actual endTime from the meta store — NOT
  // insertion order, which is newest-first during an ingest run and would
  // evict the wrong end (v0.80 review fix).
  try {
    const KEY_MV = 'chess-coach-game-moves-v1';
    const mv = JSON.parse(localStorage.getItem(KEY_MV) || '{}') || {};
    const ks = Object.keys(mv);
    if (ks.length > 100) {
      const meta = JSON.parse(localStorage.getItem('chess-coach-game-meta-v1') || '{}') || {};
      const timeOf = (k) => (meta[k] && typeof meta[k].endTime === 'number') ? meta[k].endTime : 0;
      ks.sort((a, b) => timeOf(a) - timeOf(b));            // oldest first
      ks.slice(0, ks.length - 100).forEach((k) => { delete mv[k]; });
      localStorage.setItem(KEY_MV, JSON.stringify(mv));
    }
  } catch (e) { /* best effort */ }
}

export { loadMistakes, saveMistakes, mergeMistakes, loadIngestedGameUrls, saveIngestedGameUrls, renderSavedStats, persistGameIncrementally };
