// ============================================================================
// SECTION 6 — CHESS.COM API
// ----------------------------------------------------------------------------
// Pulls the user's archive list, walks backwards through monthly archives
// until we've collected enough games of the user's preferred time class
// (onboarding profile, v0.80 — was rapid-only; 'classical' maps to rapid,
// the closest live chess.com pool).
// ============================================================================

function preferredTimeClass() {
  try {
    const tc = (typeof KPProfile !== 'undefined') ? KPProfile.timeControl() : 'rapid';
    return { rapid: 'rapid', blitz: 'blitz', bullet: 'bullet', classical: 'rapid' }[tc] || 'rapid';
  } catch { return 'rapid'; }
}

async function fetchRecentRapidGames(username, n, alreadyIngested) {
  const archResp = await fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/games/archives`);
  if (!archResp.ok) throw new Error(`Chess.com archives: HTTP ${archResp.status}`);
  const arch = await archResp.json();
  if (!arch.archives || !arch.archives.length) throw new Error('No archives for that username.');

  const timeClass = preferredTimeClass();
  const out = [];
  let skipped = 0;
  for (let i = arch.archives.length - 1; i >= 0 && out.length < n; i--) {
    const monthResp = await fetch(arch.archives[i]);
    if (!monthResp.ok) continue;
    const monthData = await monthResp.json();
    const wanted = (monthData.games || []).filter((g) => g.time_class === timeClass && g.rules === 'chess');
    for (let j = wanted.length - 1; j >= 0 && out.length < n; j--) {
      const g = wanted[j];
      const url = g.url || g.uuid || '';
      if (url && alreadyIngested.has(url)) { skipped++; continue; }
      out.push(g);
    }
  }
  return { games: out, skipped };
}
export { fetchRecentRapidGames };
