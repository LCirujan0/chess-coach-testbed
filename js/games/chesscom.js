// ============================================================================
// SECTION 6 — CHESS.COM API
// ----------------------------------------------------------------------------
// Pulls the user's archive list, walks backwards through monthly archives
// until we've collected enough rapid games.
// ============================================================================

async function fetchRecentRapidGames(username, n, alreadyIngested) {
  const archResp = await fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/games/archives`);
  if (!archResp.ok) throw new Error(`Chess.com archives: HTTP ${archResp.status}`);
  const arch = await archResp.json();
  if (!arch.archives || !arch.archives.length) throw new Error('No archives for that username.');

  const out = [];
  let skipped = 0;
  for (let i = arch.archives.length - 1; i >= 0 && out.length < n; i--) {
    const monthResp = await fetch(arch.archives[i]);
    if (!monthResp.ok) continue;
    const monthData = await monthResp.json();
    const rapid = (monthData.games || []).filter((g) => g.time_class === 'rapid' && g.rules === 'chess');
    for (let j = rapid.length - 1; j >= 0 && out.length < n; j--) {
      const g = rapid[j];
      const url = g.url || g.uuid || '';
      if (url && alreadyIngested.has(url)) { skipped++; continue; }
      out.push(g);
    }
  }
  return { games: out, skipped };
}
export { fetchRecentRapidGames };
