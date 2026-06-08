import { $, escapeHtml } from './dom.js';
import { THINNING_WINDOW } from './config.js';
import { wireReviewHandlers } from './narrate.js';
// ============================================================================
// SECTION 9 — UI RENDERING
// ============================================================================

function renderMistakeList(mistakes, perGameSummary) {
  const listEl = $('mistakes-list');
  listEl.innerHTML = '';

  // Per-game summary header (helps spot games with 0 moves analysed etc.)
  if (perGameSummary && perGameSummary.length) {
    for (const g of perGameSummary) {
      const div = document.createElement('div');
      div.className = 'mistake-item';
      const thinning = (typeof g.candidates === 'number' && g.candidates > g.mistakes)
        ? ` · thinned from ${g.candidates}`
        : '';
      const ratingTxt = (typeof g.rating === 'number') ? ` · ${g.rating}` : '';
      div.innerHTML = `
        <div class="top">
          <span class="src">vs ${escapeHtml(g.opponent)} (${escapeHtml(g.dateStr)}, ${escapeHtml(g.userColorName)}, result ${escapeHtml(g.result)}${ratingTxt})</span>
          <span class="cat">${g.analysed} moves · ${g.mistakes} saved${thinning}</span>
        </div>
        ${g.mistakes ? `<div class="game-review-actions">
            <button class="btn-review-game" data-gameurl="${escapeHtml(g.gameUrl)}">Review with coach</button>
            <a class="btn-drill-game" href="/puzzle.html?drill=${encodeURIComponent(g.gameUrl)}|all">Drill all ${g.mistakes}</a>
          </div>
          <div class="game-review-out hidden" data-out="${escapeHtml(g.gameUrl)}"></div>` : ''}
      `;
      listEl.appendChild(div);
    }
    const sep = document.createElement('div');
    sep.className = 'mistake-item';
    sep.innerHTML = `<div class="cat">Mistakes saved this run (≤1 non-blunder per ${THINNING_WINDOW}-move window, blunders always kept)</div>`;
    listEl.appendChild(sep);
  }

  for (const m of mistakes) {
    const div = document.createElement('div');
    div.className = 'mistake-item';
    div.innerHTML = `
      <div class="top">
        <span class="src">${escapeHtml(m.source)}</span>
        <span class="sev ${m.severity}">${m.severity}</span>
      </div>
      <div class="moves">you: ${escapeHtml(m.userMoveSan)} (${m.cpLoss}cp loss)</div>
      <div class="cat">${m.category}</div>
      <a class="btn-drill-one" href="/puzzle.html?drill=${encodeURIComponent(m.id)}">Drill this →</a>
    `;
    listEl.appendChild(div);
  }
  $('list-panel').classList.remove('hidden');
  wireReviewHandlers();
  const counts = {
    opening: mistakes.filter((m) => m.category === 'opening').length,
    middlegame: mistakes.filter((m) => m.category === 'middlegame').length,
    endgame: mistakes.filter((m) => m.category === 'endgame').length,
  };
  $('list-summary').textContent =
    `${mistakes.length} new mistakes found — ${counts.opening} opening, ${counts.middlegame} middlegame, ${counts.endgame} endgame.`;
}
// Persistent "Your games" list (from stored mistakes) so review + drill are
// always available, not only right after an ingest run.
function renderSavedGames() {
  let all = [];
  try { all = JSON.parse(localStorage.getItem('chess-coach-mistakes-v1') || '[]') || []; } catch {}
  if (!all.length) return;
  const groups = new Map();
  for (const m of all) {
    const k = m.gameUrl || (m.id || '').split('|')[0] || 'unknown';
    if (!groups.has(k)) groups.set(k, { gameUrl: k, opponent: m.opponent || 'opponent', dateStr: m.dateStr || '', userColorName: m.userColorName || '', n: 0 });
    groups.get(k).n++;
  }
  const listEl = $('mistakes-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'mistake-item';
  head.innerHTML = '<div class="cat">Your games — tap “Review with coach” for the coach’s take, or drill the mistakes.</div>';
  listEl.appendChild(head);
  const arr = Array.from(groups.values()).sort((a, b) => (b.dateStr || '').localeCompare(a.dateStr || ''));
  for (const gm of arr) {
    const div = document.createElement('div');
    div.className = 'mistake-item';
    div.innerHTML = `
      <div class="top">
        <span class="src">vs ${escapeHtml(gm.opponent)} (${escapeHtml(gm.dateStr)}, ${escapeHtml(gm.userColorName)})</span>
        <span class="cat">${gm.n} mistake${gm.n === 1 ? '' : 's'}</span>
      </div>
      <div class="game-review-actions">
        <button class="btn-review-game" data-gameurl="${escapeHtml(gm.gameUrl)}">Review with coach</button>
        <a class="btn-drill-game" href="/puzzle.html?drill=${encodeURIComponent(gm.gameUrl)}|all">Drill all ${gm.n}</a>
      </div>
      <div class="game-review-out hidden" data-out="${escapeHtml(gm.gameUrl)}"></div>`;
    listEl.appendChild(div);
  }
  $('list-panel').classList.remove('hidden');
  const sum = $('list-summary');
  if (sum) sum.textContent = `${arr.length} game${arr.length === 1 ? '' : 's'} with saved mistakes — pick one to review or drill.`;
  wireReviewHandlers();
}
export { renderMistakeList, renderSavedGames };
