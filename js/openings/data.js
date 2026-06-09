// ============================================================================
// js/openings/data.js — Openings registry + per-opening loaders.
// ----------------------------------------------------------------------------
// Fetches and caches data/openings/index.json (the registry) and each
// per-opening file (e.g. data/openings/vienna.json). Adding a new opening to
// the trainer is pure DATA: drop a file in data/openings/ and add one registry
// entry — no code change here.
//
// Pure fetch + in-memory cache. No DOM, no chess.js, no localStorage.
// ============================================================================

const INDEX_URL = '/data/openings/index.json';
const FILE_URL = (file) => `/data/openings/${file}`;

let _indexPromise = null;
const _openingCache = new Map(); // id -> opening object

// Fetch + cache the registry. Returns { version, openings: [...] }.
export async function getIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch(INDEX_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`openings index ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        _indexPromise = null; // allow a retry on a later call
        throw err;
      });
  }
  return _indexPromise;
}

// List the registry entries (the lightweight cards): [{ id, name, eco, side, file, blurb }].
export async function listOpenings() {
  const idx = await getIndex();
  return Array.isArray(idx.openings) ? idx.openings : [];
}

// Fetch + cache a single opening's full file by id. Returns the opening object
// with its `lines`, or throws if the id is unknown or the file is missing.
export async function getOpening(id) {
  if (_openingCache.has(id)) return _openingCache.get(id);
  const entry = (await listOpenings()).find((o) => o.id === id);
  if (!entry) throw new Error(`unknown opening: ${id}`);
  const res = await fetch(FILE_URL(entry.file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`opening ${id} ${res.status}`);
  const data = await res.json();
  // Merge the registry blurb so the drill header always has a one-liner.
  if (!data.blurb && entry.blurb) data.blurb = entry.blurb;
  _openingCache.set(id, data);
  return data;
}
