import { $, setProgress } from './dom.js';
import { state } from './state.js';
import { loadMistakes, saveMistakes, mergeMistakes, loadIngestedGameUrls, saveIngestedGameUrls, renderSavedStats } from './storage.js';
import { initStockfish } from './analysis.js';
import { ingest } from './ingest.js';
import { classifyMotifsBatch } from './classify.js';
import { renderMistakeList, renderSavedGames } from './list.js';
import { handleCoachNarrative } from './narrate.js';
import { initReview, renderReviewList } from './review.js';
import { tagAndSaveMistakes } from '/js/tagger.js';
// ============================================================================
// SECTION 10 — BOOT
// ============================================================================

window.addEventListener('error', (e) => {
  setProgress('Window error: ' + (e.message || e.error || String(e)), 100, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  setProgress('Unhandled rejection: ' + (e.reason?.message || String(e.reason)), 100, 'error');
});
async function handleIngestSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  const username = $('username').value.trim();
  if (!username) { alert('Enter a username.'); return; }
  const numGames = parseInt($('num-games').value, 10);
  const depth = parseInt($('depth').value, 10);

  state.busy = true;
  $('ingest-btn').disabled = true;
  $('ingest-btn').textContent = 'Analysing…';
  setProgress('Fetching games from Chess.com…', 5);

  try {
    const { mistakes: fresh, perGameSummary, scorecards, moves, meta } = await ingest(username, numGames, depth, (done, total, label) => {
      const pct = total > 0 ? (done / total) * 100 : 0;
      const prefix = label || `Analysing positions`;
      setProgress(`${prefix} — ${done}/${total} positions`, pct);
    });

    // Persist mistakes (de-duplicated by id).
    const merged = mergeMistakes(loadMistakes(), fresh);
    saveMistakes(merged);

    // Fire-and-forget AI tagging of newly ingested mistakes (Phase 3).
    // Non-blocking: tagging failure must never affect the ingest flow.
    tagAndSaveMistakes().catch(err => console.warn('Tagging failed (non-blocking):', err));

    // Spec 06 — persist this run's per-game scorecards under the new key.
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

    // Spec 11 — persist this run's SAN move lists for the game-review replay.
    // Idempotent merge by game key; a re-ingest overwrites the entry.
    if (moves && Object.keys(moves).length) {
      const KEY_MOVES = 'chess-coach-game-moves-v1';
      let existingMoves = {};
      try { existingMoves = JSON.parse(localStorage.getItem(KEY_MOVES) || '{}') || {}; } catch { existingMoves = {}; }
      for (const k of Object.keys(moves)) existingMoves[k] = moves[k];
      try { localStorage.setItem(KEY_MOVES, JSON.stringify(existingMoves)); }
      catch (e) { console.warn('saveMoves failed:', e.message); }
    }

    // Spec 24 — persist this run's per-game Chess.com enrichment (rating,
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
    renderReviewList(); // Spec 11 — freshly-ingested games become replayable
    setProgress(`Done. ${fresh.length} new mistakes saved across ${perGameSummary.length} game(s). Open Puzzles to review.`, 100, 'ok');
    // Spec 05 — reveal the on-demand Coach narrative button for this run.
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
    state.busy = false;
    $('ingest-btn').disabled = !state.engineReady;
    $('ingest-btn').textContent = 'Load and analyse';
  }
}
function handleClear() {
  if (!confirm('Wipe all saved puzzles, ingested-games tracking, AND your puzzle attempts? This cannot be undone.')) return;
  // Sweep every chess-coach-* key. Previously this only removed three keys,
  // which left the puzzle and completed pages still showing old data after
  // a "clear all". Now anything namespaced to the app is gone.
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('chess-coach-')) toRemove.push(k);
  }
  for (const k of toRemove) localStorage.removeItem(k);
  renderSavedStats();
  $('list-panel').classList.add('hidden');
  alert('All puzzle data cleared. Reload the Puzzles and Completed tabs to see them empty.');
}
// Spec 02 — backfill motifs for any already-ingested mistakes that don't have
// a `motif` tag (the existing deck pre-dates the classifier). Idempotent.
async function handleBackfillMotifs() {
  const all = loadMistakes();
  const untagged = all.filter((m) => !m.motif);
  if (!untagged.length) {
    alert('All ingested mistakes already have a motif tag — nothing to backfill.');
    return;
  }
  const estCost = (untagged.length * 0.0026).toFixed(2);
  if (!confirm(`Backfill ${untagged.length} mistake${untagged.length === 1 ? '' : 's'} with motif tags?\n\nEstimated Anthropic cost: ~$${estCost}.\nThis runs one Claude classifier call per mistake.`)) return;
  $('backfill-btn').disabled = true;
  setProgress(`Backfilling motifs… 0/${untagged.length}`, 0, '');
  try {
    await classifyMotifsBatch(untagged, (done, total) => {
      setProgress(`Backfilling motifs… ${done}/${total}`, Math.round(100 * done / total), '');
    });
    saveMistakes(all);
    setProgress(`Done. ${untagged.length} mistake${untagged.length === 1 ? '' : 's'} tagged.`, 100, 'ok');
  } catch (err) {
    setProgress('Backfill error: ' + err.message, 100, 'error');
  } finally {
    $('backfill-btn').disabled = false;
  }
}
// ----- event wiring + boot -----
$('ingest-form').addEventListener('submit', handleIngestSubmit);
$('clear-btn').addEventListener('click', handleClear);
$('coach-narrative-btn').addEventListener('click', handleCoachNarrative);
$('backfill-btn').addEventListener('click', handleBackfillMotifs);
initStockfish().catch((err) => {
  setProgress('Engine init failed: ' + err.message, 100, 'error');
});
renderSavedStats();
renderSavedGames();
initReview(); // Spec 11 — render the review list + wire replay controls
