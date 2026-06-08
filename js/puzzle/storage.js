// ============================================================================
// SECTION 4 — Storage
// ============================================================================
import {
  STORAGE_KEY_MISTAKES, STORAGE_KEY_ATTEMPTS,
  STORAGE_KEY_LAST_CAT, STORAGE_KEY_LAST_SEV,
  STORAGE_KEY_LAST_TRIED, STORAGE_KEY_LAST_MOTIF,
  STORAGE_KEY_MODE, STORAGE_KEY_RATING,
  CHESS_COM_USERNAME,
} from './config.js';
import { state } from './state.js';

export function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || ''); return v ?? fallback; }
  catch { return fallback; }
}
export function loadPuzzlesFromStorage() {
  const v = loadJson(STORAGE_KEY_MISTAKES, []);
  if (!Array.isArray(v)) return [];
  // Unified puzzle schema (phase 1a) added a `type` discriminator, and
  // puzzle.html pins its queue to type 'mistake' (queue.js typeFilter). Every
  // record in the mistakes store is, by definition, a mistake — but ingests
  // that predate the discriminator carry no `type`, so the pinned filter would
  // drop them all (the "mistakes not loading" bug). Stamp it on load so existing
  // data surfaces without a re-ingest. games.html now also stamps it at source.
  return v.map((p) => (p && typeof p === 'object' && !p.type && !p.puzzleType) ? { ...p, type: 'mistake' } : p);
}
export function loadAttempts() { const v = loadJson(STORAGE_KEY_ATTEMPTS, {}); return (v && typeof v === 'object') ? v : {}; }
export function saveAttempts(a) { try { localStorage.setItem(STORAGE_KEY_ATTEMPTS, JSON.stringify(a)); } catch {} }
export function saveLastCategory(cat) { try { localStorage.setItem(STORAGE_KEY_LAST_CAT, cat); } catch {} }
export function loadLastCategory() { try { return localStorage.getItem(STORAGE_KEY_LAST_CAT); } catch { return null; } }
export function saveLastSeverity(s) { try { localStorage.setItem(STORAGE_KEY_LAST_SEV, s); } catch {} }
export function loadLastSeverity() { try { return localStorage.getItem(STORAGE_KEY_LAST_SEV); } catch { return null; } }
export function saveLastTried(t) { try { localStorage.setItem(STORAGE_KEY_LAST_TRIED, t); } catch {} }
export function loadLastTried() { try { return localStorage.getItem(STORAGE_KEY_LAST_TRIED); } catch { return null; } }
export function saveLastMotif(m) { try { localStorage.setItem(STORAGE_KEY_LAST_MOTIF, m); } catch {} }
export function loadLastMotif() { try { return localStorage.getItem(STORAGE_KEY_LAST_MOTIF); } catch { return null; } }
export function saveMode(m) { try { localStorage.setItem(STORAGE_KEY_MODE, m); } catch {} }
export function loadMode() { try { return localStorage.getItem(STORAGE_KEY_MODE); } catch { return null; } }

// ----- Rating (Chess.com link) -----
export function loadCachedRating() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RATING);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.rating === 'number') ? parsed : null;
  } catch { return null; }
}
export function saveCachedRating(rating) {
  try {
    localStorage.setItem(STORAGE_KEY_RATING, JSON.stringify({
      rating,
      fetchedAt: new Date().toISOString(),
    }));
  } catch {}
}
export async function refreshRatingFromChessCom() {
  try {
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(CHESS_COM_USERNAME.toLowerCase())}/stats`);
    if (!r.ok) return;
    const data = await r.json();
    // Prefer rapid since that's what Jorge plays. Fall back to blitz, then bullet.
    const rating = data?.chess_rapid?.last?.rating
                || data?.chess_blitz?.last?.rating
                || data?.chess_bullet?.last?.rating;
    if (typeof rating === 'number') {
      state.userRating = rating;
      saveCachedRating(rating);
      console.log('Coach calibrated to Chess.com rating:', rating);
    }
  } catch (err) {
    console.warn('Chess.com rating fetch failed:', err.message);
  }
}
