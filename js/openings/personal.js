// ============================================================================
// js/openings/personal.js, the "personal fuel" for the Openings trainer.
// ----------------------------------------------------------------------------
// Reads the user's OWN game history (already captured by the games ingest
// pipeline) and surfaces which repertoire openings they actually play and where
// results cluster. Two stores, both maps keyed by game URL:
//   chess-coach-game-scorecards-v1 : { [gameUrl]: { eco, openingName, result, colour, ... } }
//   chess-coach-game-meta-v1       : { [gameUrl]: { eco, openingName, resultForUser,
//                                                    result, userColorName, ... } }
//
// We never write here, read-only. Degrades to an empty result when there is no
// game data (a brand-new user). Pure aside from the localStorage read, which is
// guarded so this can be unit-reasoned about.
// ============================================================================

const KEY_SCORECARDS = 'chess-coach-game-scorecards-v1';
const KEY_META = 'chess-coach-game-meta-v1';

// Read a localStorage map safely. Returns {} on any failure / missing store.
// `storage` is injectable for tests; defaults to window.localStorage.
function readMap(key, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return {};
  try {
    const raw = store.getItem(key);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

// Normalise a result token from either store into 'win' | 'loss' | 'draw' | null.
function normResult(rec) {
  // scorecards use `result`; meta uses `resultForUser` (user POV) or `result`.
  const r = rec.resultForUser || rec.result;
  if (r === 'win' || r === 'loss' || r === 'draw') return r;
  return null;
}

// Collapse an ECO code to its family letter+two-digit head (e.g. 'C28' -> 'C2x'),
// used to roughly match a repertoire opening's ECO RANGE (e.g. 'C25, C29').
function ecoNum(eco) {
  if (typeof eco !== 'string') return null;
  const m = eco.trim().match(/^([A-E])(\d{2})/i);
  if (!m) return null;
  return { letter: m[1].toUpperCase(), num: parseInt(m[2], 10) };
}

// Parse a registry ECO range like 'C25, C29' / 'C25-C29' / 'C28' into a matcher.
function ecoRangeMatcher(range) {
  if (typeof range !== 'string') return () => false;
  const parts = range.split(/[, -]/).map((s) => s.trim()).filter(Boolean);
  const lo = ecoNum(parts[0]);
  const hi = ecoNum(parts[1] || parts[0]);
  if (!lo || !hi || lo.letter !== hi.letter) return () => false;
  return (eco) => {
    const e = ecoNum(eco);
    return !!e && e.letter === lo.letter && e.num >= lo.num && e.num <= hi.num;
  };
}

// Gather every game record (scorecards ∪ meta), de-duplicated by game key, each
// carrying { eco, openingName, result }. Meta wins on conflict (richer + user POV).
export function readGames(storage) {
  const cards = readMap(KEY_SCORECARDS, storage);
  const meta = readMap(KEY_META, storage);
  const byKey = {};
  for (const [k, rec] of Object.entries(cards)) {
    if (!rec || typeof rec !== 'object') continue;
    byKey[k] = { key: k, eco: rec.eco || null, openingName: rec.openingName || null, result: normResult(rec) };
  }
  for (const [k, rec] of Object.entries(meta)) {
    if (!rec || typeof rec !== 'object') continue;
    const prev = byKey[k] || { key: k };
    byKey[k] = {
      key: k,
      eco: rec.eco || prev.eco || null,
      openingName: rec.openingName || prev.openingName || null,
      result: normResult(rec) || prev.result || null,
    };
  }
  return Object.values(byKey);
}

// Tally win/loss/draw for a set of game records.
function tally(games) {
  const t = { games: games.length, win: 0, loss: 0, draw: 0 };
  for (const g of games) { if (g.result === 'win') t.win++; else if (g.result === 'loss') t.loss++; else if (g.result === 'draw') t.draw++; }
  t.decided = t.win + t.loss;
  t.scorePct = t.games ? Math.round(((t.win + 0.5 * t.draw) / t.games) * 100) : null;
  return t;
}

// For each repertoire opening (from listOpenings()), find the user's games whose
// ECO falls in that opening's range, tally results, and flag a struggle when the
// decided-game win rate is poor over a meaningful sample. Returns an array
// aligned to `openings`, each: { id, name, eco, played, record, struggling, sample }.
// Degrades to all-zero (played:false) entries when there is no game data.
export function personalForOpenings(openings, storage) {
  const games = readGames(storage);
  const list = Array.isArray(openings) ? openings : [];
  return list.map((o) => {
    const match = ecoRangeMatcher(o.eco);
    const mine = games.filter((g) => match(g.eco));
    const record = tally(mine);
    // "Struggling" = at least 3 decided games and a sub-40% win rate among them.
    const winRate = record.decided ? record.win / record.decided : null;
    const struggling = record.decided >= 3 && winRate !== null && winRate < 0.4;
    return {
      id: o.id,
      name: o.name,
      eco: o.eco,
      played: record.games > 0,
      record,
      struggling,
      sample: record.games,
    };
  });
}

// Has the user got ANY game history at all? Drives the empty-state copy.
export function hasGameData(storage) {
  return readGames(storage).length > 0;
}
