// ============================================================================
// SECTION 4 — Storage
// ============================================================================
import {
  STORAGE_KEY_MISTAKES, STORAGE_KEY_ATTEMPTS,
  STORAGE_KEY_LAST_CAT, STORAGE_KEY_LAST_SEV,
  STORAGE_KEY_LAST_TRIED, STORAGE_KEY_LAST_MOTIF,
  STORAGE_KEY_MODE, STORAGE_KEY_RATING,
  getActiveChessComUsername,
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
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(getActiveChessComUsername())}/stats`);
    if (!r.ok) return;
    const data = await r.json();
    // Prefer the user's own time control (onboarding profile, v0.80), then the
    // historical default order rapid → blitz → bullet. Chess.com has no live
    // "classical" pool — that preference maps to rapid (the closest).
    const pref = (typeof KPProfile !== 'undefined') ? KPProfile.timeControl() : 'rapid';
    const byControl = {
      rapid: data?.chess_rapid?.last?.rating,
      blitz: data?.chess_blitz?.last?.rating,
      bullet: data?.chess_bullet?.last?.rating,
      classical: data?.chess_rapid?.last?.rating,
    };
    const rating = byControl[pref]
                || data?.chess_rapid?.last?.rating
                || data?.chess_blitz?.last?.rating
                || data?.chess_bullet?.last?.rating;
    if (typeof rating === 'number') {
      state.userRating = rating;
      saveCachedRating(rating);
      console.log('Coach calibrated to Chess.com rating:', rating);
    }
    // Spec 24 — capture the richer rating profile (peak, RD/settledness, W/L/D
    // record, tactics rating) alongside the back-compat user-rating-v1. Each
    // sub-object is null when the API omits that section (a feature never used).
    saveRatingProfile(data);
  } catch (err) {
    console.warn('Chess.com rating fetch failed:', err.message);
  }
}

// Spec 24 — richer rating profile from the /stats endpoint. Additive companion
// to chess-coach-user-rating-v1; powers the settledness-aware Insights block and
// the macro goal-gradient (peak/record). Defensive: every field is optional.
export function saveRatingProfile(data) {
  try {
    const rapidLast = data?.chess_rapid?.last;
    const rapidBest = data?.chess_rapid?.best;
    const rapidRec = data?.chess_rapid?.record;
    const tactics = data?.chess_tactics?.highest || data?.tactics?.highest;
    const profile = {
      rapid: rapidLast ? {
        current: (typeof rapidLast.rating === 'number') ? rapidLast.rating : null,
        rd: (typeof rapidLast.rd === 'number') ? rapidLast.rd : null,
        date: (typeof rapidLast.date === 'number') ? rapidLast.date : null,
        best: (rapidBest && typeof rapidBest.rating === 'number') ? rapidBest.rating : null,
        bestDate: (rapidBest && typeof rapidBest.date === 'number') ? rapidBest.date : null,
        // Keys match the coach-stats.js ratingProfileView reader (rec.w/l/d).
        record: rapidRec ? {
          w: rapidRec.win ?? null, l: rapidRec.loss ?? null, d: rapidRec.draw ?? null,
        } : null,
      } : null,
      blitz: (data?.chess_blitz?.last && typeof data.chess_blitz.last.rating === 'number')
        ? { current: data.chess_blitz.last.rating } : null,
      // Reader expects profile.tactics.current.
      tactics: (tactics && typeof tactics.rating === 'number')
        ? { current: tactics.rating, date: tactics.date ?? null } : null,
      fetchedAt: new Date().toISOString(),
    };
    localStorage.setItem('chess-coach-rating-profile-v1', JSON.stringify(profile));
  } catch (err) {
    console.warn('saveRatingProfile failed:', err.message);
  }
}

export function loadRatingProfile() {
  try {
    const raw = localStorage.getItem('chess-coach-rating-profile-v1');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
