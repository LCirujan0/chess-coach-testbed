import { $, setProgress } from './dom.js';
import { state } from './state.js';
import { loadMistakes, saveMistakes, mergeMistakes, loadIngestedGameUrls, saveIngestedGameUrls, renderSavedStats, persistGameIncrementally } from './storage.js';
import { initStockfish } from './analysis.js';
import { ingest } from './ingest.js';
import { renderMistakeList, renderSavedGames } from './list.js';
import { handleCoachNarrative } from './narrate.js';
import { initReview, renderReviewList } from './review.js';
import { tagAndSaveMistakes } from '/js/tagger.js';
// ============================================================================
// SECTION 10. BOOT
// ============================================================================

window.addEventListener('error', (e) => {
  setProgress('Window error: ' + (e.message || e.error || String(e)), 100, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  setProgress('Unhandled rejection: ' + (e.reason?.message || String(e.reason)), 100, 'error');
});
// persistGameIncrementally moved to ./storage.js (v0.80) so onboarding.html can
// reuse the per-game persistence without this page's DOM wiring.

async function handleIngestSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  const username = $('username').value.trim();
  if (!username) { alert('Enter a username.'); return; }
  const numGames = parseInt($('num-games').value, 10);
  const depth = parseInt($('depth').value, 10);

  // Capture identity: an ingest IS a statement of who you are. If no synced
  // username exists yet, adopt this one (same key + validation as js/sync.js).
  try {
    const norm = username.toLowerCase();
    if (/^[a-z0-9_-]{1,64}$/.test(norm) && !localStorage.getItem('chess-coach-username-v1')) {
      localStorage.setItem('chess-coach-username-v1', norm);
    }
  } catch (e) { /* anonymous */ }

  state.busy = true;
  $('ingest-btn').disabled = true;
  $('ingest-btn').textContent = 'Analysing…';
  setProgress('Fetching games… keep this page open while it syncs.', 5);
  // Sync is client-side, it can't continue in the background, so warn before
  // leaving. Finished games persist incrementally, so a re-sync resumes.
  const warnLeave = (ev) => { ev.preventDefault(); ev.returnValue = ''; return ''; };
  window.addEventListener('beforeunload', warnLeave);

  try {
    const { mistakes: fresh, perGameSummary, scorecards, moves, meta } = await ingest(username, numGames, depth, (done, total, label) => {
      const pct = total > 0 ? (done / total) * 100 : 0;
      const prefix = label || `Analysing positions`;
      setProgress(`${prefix}, ${done}/${total} · keep this page open`, pct);
    }, persistGameIncrementally);

    // Persist mistakes (de-duplicated by id).
    const merged = mergeMistakes(loadMistakes(), fresh);
    saveMistakes(merged);

    // Fire-and-forget AI tagging of newly ingested mistakes (Phase 3).
    // Non-blocking: tagging failure must never affect the ingest flow.
    tagAndSaveMistakes().catch(err => console.warn('Tagging failed (non-blocking):', err));

    // Spec 06, persist this run's per-game scorecards under the new key.
    // Idempotent merge: a re-ingest of the same gameUrl overwrites the older
    // scorecard with the fresh one.
    if (scorecards && Object.keys(scorecards).length) {
      const KEY_SCORECARDS = 'chess-coach-game-scorecards-v1';
      let existingCards = {};
      try { existingCards = JSON.parse(localStorage.getItem(KEY_SCORECARDS) || '{}') || {}; }
      catch { existingCards = {}; }
      for (const k of Object.keys(scorecards)) existingCards[k] = scorecards[k];
      try { localStorage.setItem(KEY_SCORECARDS, JSON.stringify(existingCards)); }
      catch (e) { console.warn('saveScorecards failed:', e.message); }
    }

    // Spec 11, persist this run's SAN move lists for the game-review replay.
    // Idempotent merge by game key; a re-ingest overwrites the entry.
    if (moves && Object.keys(moves).length) {
      const KEY_MOVES = 'chess-coach-game-moves-v1';
      let existingMoves = {};
      try { existingMoves = JSON.parse(localStorage.getItem(KEY_MOVES) || '{}') || {}; } catch { existingMoves = {}; }
      for (const k of Object.keys(moves)) existingMoves[k] = moves[k];
      try { localStorage.setItem(KEY_MOVES, JSON.stringify(existingMoves)); }
      catch (e) { console.warn('saveMoves failed:', e.message); }
    }

    // Spec 24, persist this run's per-game Chess.com enrichment (rating,
    // accuracy, rated flag, time control, termination). Same idempotent merge.
    if (meta && Object.keys(meta).length) {
      const KEY_META = 'chess-coach-game-meta-v1';
      let existingMeta = {};
      try { existingMeta = JSON.parse(localStorage.getItem(KEY_META) || '{}') || {}; } catch { existingMeta = {}; }
      for (const k of Object.keys(meta)) existingMeta[k] = meta[k];
      try { localStorage.setItem(KEY_META, JSON.stringify(existingMeta)); }
      catch (e) { console.warn('saveGameMeta failed:', e.message); }
    }

    // Chess.com rating time-series -> populates the EXISTING Insights rating
    // strip + trajectory (which previously had nothing writing to it). Uses the
    // established shapes: user-rating-v1 {rating,fetchedAt}; rating-history-v1 [{rating,at}].
    try {
      const ratedRun = perGameSummary.filter((g) => typeof g.rating === 'number' && g.endTime);
      if (ratedRun.length) {
        const KEY_RH = 'chess-coach-rating-history-v1';
        let hist = [];
        try { hist = JSON.parse(localStorage.getItem(KEY_RH) || '[]') || []; } catch {}
        const seen = new Set(hist.map((p) => p.at));
        for (const g of ratedRun) {
          const at = new Date(g.endTime * 1000).toISOString();
          if (!seen.has(at)) { hist.push({ rating: g.rating, at }); seen.add(at); }
        }
        hist.sort((a, b) => new Date(a.at) - new Date(b.at));
        localStorage.setItem(KEY_RH, JSON.stringify(hist));
        const latest = hist[hist.length - 1];
        if (latest && typeof latest.rating === 'number') {
          localStorage.setItem('chess-coach-user-rating-v1', JSON.stringify({ rating: latest.rating, fetchedAt: new Date().toISOString() }));
        }
      }
    } catch (e) { console.warn('rating history capture failed:', e.message); }

    // Persist the game URLs so they're skipped on the next run.
    const ingested = loadIngestedGameUrls();
    for (const g of perGameSummary) if (g.gameUrl) ingested.add(g.gameUrl);
    saveIngestedGameUrls(ingested);

    state.thisRunMistakes = fresh;
    renderMistakeList(fresh, perGameSummary);
    renderSavedStats();
    renderReviewList(); // Spec 11, freshly-ingested games become replayable
    setProgress(`Done. ${fresh.length} new mistakes saved across ${perGameSummary.length} game(s). Open Puzzles to review.`, 100, 'ok');
    // Spec 05, reveal the on-demand Coach narrative button for this run.
    const crp = $('coach-review-panel');
    if (crp) {
      crp.style.display = '';
      $('coach-narrative-out').style.display = 'none';
      $('coach-narrative-btn').disabled = false;
      $('coach-narrative-btn').textContent = 'Coach: how did you play?';
    }
  } catch (err) {
    setProgress('Error: ' + err.message, 100, 'error');
  } finally {
    window.removeEventListener('beforeunload', warnLeave);
    state.busy = false;
    $('ingest-btn').disabled = !state.engineReady;
    $('ingest-btn').textContent = 'Load and analyse';
  }
}
// "Clear all saved" removed 2026-06-10 (owner call): with cross-device sync a
// local wipe just re-pulls on the next load, so the reset affordance moved to
// the nav user chip's "Change" action (js/sync.js switchUser), which clears
// local state as part of switching identity.
// Spec 02, backfill motifs for any already-ingested mistakes that don't have
// a `motif` tag (the existing deck pre-dates the classifier). Idempotent.
async function handleBackfillMotifs() {
  // Consolidated (2026-06-10): backfill now rides the SAME batched Haiku path
  // as post-ingest tagging (js/tagger.js → /api/tag), one classifier, one
  // prompt, ~10x cheaper than the retired per-mistake Sonnet calls.
  const all = loadMistakes();
  const untagged = all.filter((m) => !m.motif);
  if (!untagged.length) {
    alert('All ingested mistakes already have a motif tag, nothing to backfill.');
    return;
  }
  if (!confirm(`Backfill ${untagged.length} mistake${untagged.length === 1 ? '' : 's'} with motif tags?\n\nRuns batched Claude Haiku classification (fractions of a cent).`)) return;
  $('backfill-btn').disabled = true;
  setProgress(`Backfilling motifs for ${untagged.length} mistake${untagged.length === 1 ? '' : 's'}…`, 30, '');
  try {
    await tagAndSaveMistakes();
    setProgress('Done. Motifs backfilled.', 100, 'ok');
    renderSavedStats();
  } catch (err) {
    setProgress('Backfill error: ' + err.message, 100, 'error');
  } finally {
    $('backfill-btn').disabled = false;
  }
}
// ----- event wiring + boot -----
$('ingest-form').addEventListener('submit', handleIngestSubmit);
$('coach-narrative-btn').addEventListener('click', handleCoachNarrative);
$('backfill-btn').addEventListener('click', handleBackfillMotifs);
// Wipe this device (v0.80, owner ask): local-only wipe, the Supabase copy
// survives, so signing back in restores everything without re-ingesting.
const wipeBtn = $('wipe-btn');
if (wipeBtn) wipeBtn.addEventListener('click', () => { if (window.KPSync) window.KPSync.wipeDevice(); });
// Prefill the form with the synced identity (chess-coach-username-v1).
try {
  const u = localStorage.getItem('chess-coach-username-v1');
  if (u && !$('username').value) $('username').value = u;
} catch (e) { /* anonymous */ }
initStockfish().catch((err) => {
  setProgress('Engine init failed: ' + err.message, 100, 'error');
});
renderSavedStats();
renderSavedGames();
initReview(); // Spec 11, render the review list + wire replay controls
