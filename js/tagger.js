// js/tagger.js
// Ephemeral AI tagger. Uses its own Stockfish worker (not the puzzle engine's).
// Safe to import from any page.
//
// Main exports:
//   tagPuzzles(puzzles)           — async, returns { mistakeTags, curriculumTags }
//   tagAndSaveMistakes()          — reads mistakes storage, tags untagged, writes back
//   tagAndSaveCurriculum(puzzles) — tags provided curriculum puzzles, writes to tags storage
//
// Tagging failure is always non-fatal: callers should .catch() and warn only.

const SF_URL = '/engine/stockfish-17.1-lite-single-03e3232.js';
const STORAGE_KEY_MISTAKES = 'chess-coach-mistakes-v1';
const STORAGE_KEY_TAGS = 'chess-coach-tags-v1';
const TAG_DEPTH = 10;
const TAG_MULTIPV = 3;

// Module-level worker — created lazily, shared across all tagPuzzles calls
// within the same page lifetime.
let sfWorker = null;
let sfReady = false;

// ── Stockfish helpers ────────────────────────────────────────────────────────

function sfWaitForTag(matcher, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const t = setTimeout(() => {
      sfWorker.removeEventListener('message', onMsg);
      reject(new Error(`tagger SF timeout waiting for "${matcher}"`));
    }, timeoutMs);
    function onMsg(e) {
      const msg = typeof e.data === 'string' ? e.data : '';
      messages.push(msg);
      if (msg.includes(matcher)) {
        clearTimeout(t);
        sfWorker.removeEventListener('message', onMsg);
        resolve({ matched: msg, all: messages });
      }
    }
    sfWorker.addEventListener('message', onMsg);
  });
}

async function initTaggerSF() {
  if (sfReady && sfWorker) return;
  sfWorker = new Worker(SF_URL);
  sfWorker.postMessage('uci');
  await sfWaitForTag('uciok');
  sfWorker.postMessage(`setoption name MultiPV value ${TAG_MULTIPV}`);
  sfWorker.postMessage('isready');
  await sfWaitForTag('readyok', 15000);
  sfReady = true;
}

// Inline parseMultiPV — does NOT import from engine.js to avoid coupling with
// the puzzle engine's module-level state (the `stockfish` variable there).
function parseMultiPVTag(allMessages, numLines) {
  const linesByMpv = new Map();
  for (const msg of allMessages) {
    if (!msg.startsWith('info')) continue;
    const mpvMatch = msg.match(/\bmultipv\s+(\d+)/);
    if (!mpvMatch) continue;
    const scoreMatch = msg.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    const pvMatch = msg.match(/\bpv\s+(.+)$/);
    if (!scoreMatch || !pvMatch) continue;
    linesByMpv.set(parseInt(mpvMatch[1], 10), {
      scoreType: scoreMatch[1],
      scoreVal: parseInt(scoreMatch[2], 10),
      pvMoves: pvMatch[1].trim().split(/\s+/),
    });
  }
  const out = [];
  for (let i = 1; i <= numLines; i++) if (linesByMpv.has(i)) out.push(linesByMpv.get(i));
  return out;
}

// Run the tagger SF worker at TAG_DEPTH with MultiPV TAG_MULTIPV.
// Returns [{ cp, pv }] where cp is score relative to side-to-move,
// and pv is array of UCI moves.
async function getLines(fen) {
  sfWorker.postMessage('ucinewgame');
  sfWorker.postMessage('position fen ' + fen);
  sfWorker.postMessage(`go depth ${TAG_DEPTH}`);
  const { all } = await sfWaitForTag('bestmove');
  const parsed = parseMultiPVTag(all, TAG_MULTIPV);
  // Best-move cp is the reference; compute loss vs best for lines 2+
  const bestCp = parsed.length > 0
    ? (parsed[0].scoreType === 'mate' ? (parsed[0].scoreVal > 0 ? 10000 : -10000) : parsed[0].scoreVal)
    : 0;
  return parsed.map((line) => {
    const lineCp = line.scoreType === 'mate'
      ? (line.scoreVal > 0 ? 10000 : -10000)
      : line.scoreVal;
    return { cp: bestCp - lineCp, pv: line.pvMoves };
  });
}

// ── API helper ───────────────────────────────────────────────────────────────

async function callTagAPI(puzzleBatch) {
  const res = await fetch('/api/tag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzles: puzzleBatch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`/api/tag ${res.status}: ${err.detail || res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data.tags) ? data.tags : [];
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * tagPuzzles(puzzles)
 * Filters to untagged puzzles, runs Stockfish on each, batches to /api/tag,
 * and returns { mistakeTags, curriculumTags } arrays of tag objects.
 *
 * The caller is responsible for writing the results to storage.
 */
export async function tagPuzzles(puzzles) {
  const untagged = (puzzles || []).filter((p) => p && p.fen && !p.motif);
  if (!untagged.length) return { mistakeTags: [], curriculumTags: [] };

  await initTaggerSF();

  // Build payload items with engine lines
  const payloadItems = [];
  for (const p of untagged) {
    let lines = [];
    try {
      lines = await getLines(p.fen);
    } catch (err) {
      console.warn('tagger: getLines failed for', p.id, err);
    }
    payloadItems.push({ id: p.id, fen: p.fen, lines, _source: p.source || '' });
  }

  // Batch into groups of ≤ 20
  const BATCH_SIZE = 20;
  const allTags = [];
  for (let i = 0; i < payloadItems.length; i += BATCH_SIZE) {
    const batch = payloadItems.slice(i, i + BATCH_SIZE).map(({ id, fen, lines }) => ({ id, fen, lines }));
    try {
      const tags = await callTagAPI(batch);
      allTags.push(...tags);
    } catch (err) {
      console.warn('tagger: callTagAPI batch failed', err);
    }
  }

  // Separate into mistake vs curriculum based on source
  const mistakeTags = [];
  const curriculumTags = [];
  for (const tag of allTags) {
    const item = payloadItems.find((p) => p.id === tag.id);
    if (item && item._source === 'mistake') {
      mistakeTags.push(tag);
    } else {
      curriculumTags.push(tag);
    }
  }

  return { mistakeTags, curriculumTags };
}

/**
 * tagAndSaveMistakes()
 * Reads chess-coach-mistakes-v1, tags untagged entries, merges back, saves.
 */
export async function tagAndSaveMistakes() {
  let mistakes = [];
  try {
    mistakes = JSON.parse(localStorage.getItem(STORAGE_KEY_MISTAKES) || '[]');
    if (!Array.isArray(mistakes)) mistakes = [];
  } catch {
    mistakes = [];
  }

  const untagged = mistakes.filter((p) => p && !p.motif);
  if (!untagged.length) return;

  // Mark source so tagPuzzles routes them correctly
  const withSource = untagged.map((p) => ({ ...p, source: 'mistake' }));
  const { mistakeTags } = await tagPuzzles(withSource);

  if (!mistakeTags.length) return;

  // Merge tags back into mistakes array
  const tagById = new Map(mistakeTags.map((t) => [t.id, t]));
  const updated = mistakes.map((m) => {
    if (!m || !m.id) return m;
    const tag = tagById.get(m.id);
    if (!tag) return m;
    return { ...m, motif: tag.motif, themes: tag.themes, aiTaggedAt: tag.aiTaggedAt };
  });

  try {
    localStorage.setItem(STORAGE_KEY_MISTAKES, JSON.stringify(updated));
  } catch (err) {
    console.warn('tagger: failed to save tagged mistakes', err);
  }
}

/**
 * tagAndSaveCurriculum(puzzles)
 * Tags the provided curriculum puzzles and merges into chess-coach-tags-v1.
 */
export async function tagAndSaveCurriculum(puzzles) {
  if (!Array.isArray(puzzles) || !puzzles.length) return;

  const { curriculumTags, mistakeTags } = await tagPuzzles(puzzles);
  const allTags = [...curriculumTags, ...mistakeTags];
  if (!allTags.length) return;

  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY_TAGS) || '{}') || {};
    if (typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }

  for (const tag of allTags) {
    if (tag && tag.id) stored[tag.id] = tag;
  }

  try {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(stored));
  } catch (err) {
    console.warn('tagger: failed to save curriculum tags', err);
  }
}
