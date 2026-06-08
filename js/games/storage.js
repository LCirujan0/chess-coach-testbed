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
export { loadMistakes, saveMistakes, mergeMistakes, loadIngestedGameUrls, saveIngestedGameUrls, renderSavedStats };
