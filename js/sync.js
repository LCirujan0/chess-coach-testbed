// ============================================================================
// js/sync.js, cross-device persistence (v0.78).
// ----------------------------------------------------------------------------
// Mirrors the SYNC_KEYS subset of localStorage to Supabase (PostgREST, plain
// fetch, no SDK, no build step), keyed by the user's Chess.com username.
//
// Lifecycle:
//   1. On load: if a username is stored, PULL the user's rows, MERGE them into
//      localStorage with per-key conflict rules (below), then PUSH anything
//      where the merged value is newer than the remote copy. If the merge
//      changed local state after the page already rendered, reload ONCE
//      (sessionStorage-guarded) so the inline page scripts re-read the stores.
//   2. After load: localStorage.setItem is wrapped so a write to any synced
//      key schedules a debounced push of the CHANGED keys only. This catches
//      every meaningful event (puzzle resolved → attempts, session done →
//      complete-flag + streak, endgame result, SRS review) without touching
//      the call sites, inline page scripts and modules alike.
//   3. On pagehide/hidden: flush pending pushes (fetch keepalive, skipped for
//      oversized payloads, the next load's pull/merge/push covers those).
//
// Conflict rules (device A vs device B):
//   streak, higher `current` wins; longest/freezes = max; day lists union.
//   attempts, union of puzzle ids; per id the later `lastAt` wins.
//   mistakes, union by id (records are effectively immutable once ingested).
//   session, today's plan beats a stale one; both-today → more progress wins.
//   maps with per-entry timestamps (openings SRS, eg-results, recognition seen,
//   tags), union; per entry the later timestamp wins. Counters (recognition
//   byType), max per counter. Everything else, remote wins on pull.
//
// Identity: no auth, by design (see learnings v0.6 password-gate removal).
// First load shows a non-blocking banner asking for the Chess.com username;
// until one is saved, NOTHING is sent anywhere (also keeps QA runs offline).
// Degrades gracefully: any fetch failure → status 'offline', app runs on
// localStorage exactly as before.
// ============================================================================
import {
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_STATE_TABLE,
  STORAGE_KEY_USERNAME, SYNC_KEYS, SYNC_DEBOUNCE_MS, SYNC_FETCH_TIMEOUT_MS,
} from '/js/puzzle/config.js';

const ENDPOINT = `${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}`;
const HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
};
const RELOAD_GUARD_KEY = 'kp-sync-reloaded-at';   // sessionStorage, never reload twice in 15s
const DISMISS_KEY = 'kp-sync-prompt-dismissed';   // sessionStorage. "Not now" lasts the tab session
const KEEPALIVE_BODY_LIMIT = 60000;               // fetch keepalive bodies are capped at 64KB

const status = { state: 'idle', lastError: null, lastPushAt: null, lastPullAt: null };
let lastPushed = {};      // key -> serialized value as last seen remotely/pushed
let pushTimer = null;
let pushing = false;

// ---------- small utils ----------
function getRaw(key) { try { return localStorage.getItem(key); } catch { return null; } }
function setRaw(key, raw) { try { localStorage.setItem(key, raw); } catch { /* quota, non-fatal */ } }
function parseRaw(raw) { if (raw == null) return null; try { return JSON.parse(raw); } catch { return null; } }
function ser(v) { return v == null ? null : JSON.stringify(v); }
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getUsername() {
  const u = getRaw(STORAGE_KEY_USERNAME);
  return (u && /^[a-z0-9_-]{1,64}$/i.test(u.trim())) ? u.trim().toLowerCase() : null;
}
async function timedFetch(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SYNC_FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ---------- merge rules ----------
function msOf(x) { // best-effort epoch ms from a number or ISO string
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') { const t = Date.parse(x); return Number.isFinite(t) ? t : 0; }
  return 0;
}
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function mergeStreak(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const win = ((r.current || 0) > (l.current || 0)) ? r : l;
  const lose = (win === r) ? l : r;
  return {
    ...win,
    longest: Math.max(l.longest || 0, r.longest || 0),
    freezesAvailable: Math.max(l.freezesAvailable || 0, r.freezesAvailable || 0),
    freezeUsedDays: [...new Set([...(l.freezeUsedDays || []), ...(r.freezeUsedDays || [])])],
    restDays: [...new Set([...(l.restDays || []), ...(r.restDays || [])])],
    lastCompletedDay: [win.lastCompletedDay, lose.lastCompletedDay].filter(Boolean).sort().pop() || null,
  };
}
function mergeByEntryTime(l, r, timeOf) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const out = { ...r };
  for (const k of Object.keys(l)) {
    if (!(k in out)) { out[k] = l[k]; continue; }
    out[k] = (timeOf(l[k]) >= timeOf(out[k])) ? l[k] : out[k];
  }
  return out;
}
function mergeMistakeArrays(l, r) {
  if (!Array.isArray(l)) return r; if (!Array.isArray(r)) return l;
  const seen = new Set();
  const out = [];
  for (const m of [...l, ...r]) {
    const id = m && m.id;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id); out.push(m);
  }
  return out;
}
function mergeSession(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const today = todayKey();
  const lToday = l.date === today, rToday = r.date === today;
  if (rToday && !lToday) return r;       // remote wins if it's from today
  if (lToday && !rToday) return l;       // local wins if remote is stale
  if (!lToday && !rToday) return (msOf(r.createdAt) >= msOf(l.createdAt)) ? r : l;
  const doneOf = (p) => (p.blocks || []).reduce((s, b) => s + (b && b.done || 0), 0);
  return doneOf(l) > doneOf(r) ? l : r;  // both today: more progress wins, tie → remote
}
function mergeComplete(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const today = todayKey();
  if (r.date === today && l.date !== today) return r;
  if (l.date === today && r.date !== today) return l;
  if (l.date === r.date) return ((r.reps || 0) >= (l.reps || 0)) ? r : l;
  return (String(r.date) > String(l.date)) ? r : l;
}
function mergeRecognition(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const seenTime = (v) => isObj(v) ? msOf(v.at) : msOf(v); // legacy bare-timestamp entries
  const seen = mergeByEntryTime(l.seen || {}, r.seen || {}, seenTime);
  const byType = { ...(r.byType || {}) };
  for (const k of Object.keys(l.byType || {})) {
    const a = l.byType[k] || {}, b = byType[k] || {};
    byType[k] = { ...b, ...a, seen: Math.max(a.seen || 0, b.seen || 0), correct: Math.max(a.correct || 0, b.correct || 0) };
  }
  return { ...r, ...l, seen, byType };
}
function mergeBoardVision(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const base = ((r.streak || 0) > (l.streak || 0)) ? r
    : ((l.streak || 0) > (r.streak || 0)) ? l
    : (String(r.completedDate || '') > String(l.completedDate || '')) ? r : l;
  const scores = { ...(l.scores || {}), ...(r.scores || {}) };
  for (const k of Object.keys(scores)) scores[k] = Math.max((l.scores || {})[k] || 0, (r.scores || {})[k] || 0);
  const tracker = { ...(base.tracker || {}), level: Math.max((l.tracker || {}).level || 1, (r.tracker || {}).level || 1) };
  return { ...base, scores, tracker, coordPerfectStreak: Math.max(l.coordPerfectStreak || 0, r.coordPerfectStreak || 0) };
}
// Calculation drills (v0.82): levels and bests are monotonic, take the max;
// histories union by day+type+score so both devices' practice survives.
function mergeCalculation(l, r) {
  if (!isObj(l)) return r; if (!isObj(r)) return l;
  const levelScores = { ...((l.line || {}).levelScores || {}), ...((r.line || {}).levelScores || {}) };
  for (const k of Object.keys(levelScores)) levelScores[k] = Math.max(((l.line || {}).levelScores || {})[k] || 0, ((r.line || {}).levelScores || {})[k] || 0);
  const seen = new Set();
  const history = [...(Array.isArray(l.history) ? l.history : []), ...(Array.isArray(r.history) ? r.history : [])]
    .filter((h) => { const k = h && (h.d + '|' + h.type + '|' + h.score); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(a.d).localeCompare(String(b.d))).slice(-90);
  return {
    completedDate: String(l.completedDate || '') > String(r.completedDate || '') ? (l.completedDate || null) : (r.completedDate || null),
    line: { level: Math.max(((l.line || {}).level) || 1, ((r.line || {}).level) || 1), levelScores },
    bests: { forcers60: Math.max(((l.bests || {}).forcers60) || 0, ((r.bests || {}).forcers60) || 0) },
    history,
  };
}
function mergeKey(key, local, remote) {
  if (remote == null) return local;
  if (local == null) return remote;
  switch (key) {
    case 'chess-coach-streak-v1': return mergeStreak(local, remote);
    case 'chess-coach-attempts-v1': return mergeByEntryTime(local, remote, (a) => msOf(a && a.lastAt));
    case 'chess-coach-mistakes-v1': return mergeMistakeArrays(local, remote);
    case 'chess-coach-session-v1': return mergeSession(local, remote);
    case 'chess-coach-session-complete-v1': return mergeComplete(local, remote);
    case 'chess-coach-plan-today-v2': return mergeComplete(local, remote); // {date,review}: today beats stale
    case 'chess-coach-coach-memory-v1':
    case 'chess-coach-profile-v1':
      return (isObj(local) && isObj(remote)) ? (msOf(remote.updatedAt) >= msOf(local.updatedAt) ? remote : local) : (remote ?? local);
    case 'chess-coach-game-scorecards-v1':
    case 'chess-coach-game-meta-v1':
      // Per-game records are immutable once written, plain union by game key.
      return (isObj(local) && isObj(remote)) ? { ...remote, ...local } : (remote ?? local);
    case 'chess-coach-openings-v1': return mergeByEntryTime(local, remote, (c) => msOf(c && c.lastSeen));
    case 'chess-coach-eg-results-v1': return mergeByEntryTime(local, remote, (e) => msOf(e && e.lastAt));
    case 'chess-coach-recognition-v1': return mergeRecognition(local, remote);
    case 'chess-coach-tags-v1': return mergeByEntryTime(local, remote, (t) => msOf(t && t.aiTaggedAt));
    case 'chess-coach-board-vision-v1': return mergeBoardVision(local, remote);
    case 'chess-coach-calculation-v1': return mergeCalculation(local, remote);
    case 'chess-coach-mastery-seen-v1':
      return (Array.isArray(local) && Array.isArray(remote)) ? [...new Set([...remote, ...local])] : remote;
    default: return remote; // gamification default: remote wins on pull
  }
}

// ---------- pull / merge / push ----------
async function pull(username) {
  const url = `${ENDPOINT}?username=eq.${encodeURIComponent(username)}&select=key,value`;
  const res = await timedFetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`pull HTTP ${res.status}`);
  const rows = await res.json();
  const remote = {};
  for (const row of rows) if (row && typeof row.key === 'string') remote[row.key] = row.value;
  return remote;
}

function collectDirty() {
  const dirty = [];
  for (const key of SYNC_KEYS) {
    const raw = getRaw(key);
    if (raw == null) continue;                 // never push deletions (clear stays local)
    if (raw !== lastPushed[key]) dirty.push({ key, raw });
  }
  return dirty;
}

async function push(username, { keepalive = false } = {}) {
  const dirty = collectDirty();
  if (!dirty.length) return true;
  const rows = [];
  for (const { key, raw } of dirty) {
    const value = parseRaw(raw);
    if (value == null && raw !== 'null') continue; // unparseable, skip, never crash
    rows.push({ username, key, value });
  }
  if (!rows.length) return true;
  const body = JSON.stringify(rows);
  if (keepalive && body.length > KEEPALIVE_BODY_LIMIT) return false; // next load covers it
  const res = await timedFetch(ENDPOINT, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body,
    keepalive,
  });
  if (!res.ok) throw new Error(`push HTTP ${res.status}`);
  for (const { key, raw } of dirty) lastPushed[key] = raw;
  status.lastPushAt = Date.now();
  return true;
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, SYNC_DEBOUNCE_MS);
}
// Bulk writers (the onboarding ingest) suspend the event-push so 20 games
// don't trigger 20 ever-growing uploads, one flush when they finish.
let pushSuspended = false;
function suspendPush(on) {
  pushSuspended = !!on;
  if (!on) flush();
}

async function flush(opts) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (qaHermetic() || pushSuspended) return;
  const username = getUsername();
  if (!username || pushing) return;
  pushing = true;
  try { await push(username, opts); status.state = 'ok'; }
  catch (err) { status.state = 'offline'; status.lastError = String(err && err.message || err); }
  finally { pushing = false; }
}

// Track whether the user has started doing something on this page, an
// auto-reload is invisible right after load but hostile mid-interaction
// (v0.80 cross-device UX audit: a reload could swallow a click/typing).
let userInteracted = false;
['pointerdown', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, () => { userInteracted = true; }, { once: true, capture: true }));

function maybeReload(localChanged) {
  if (!localChanged) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < 15000) return;     // anti-loop guard
    if (userInteracted) { showUpdatedToast(); return; }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    window.location.reload();                  // inline scripts re-read the merged stores
  } catch { /* sessionStorage unavailable, skip the reload, state is still merged */ }
}

// Mid-interaction merge: never yank the page away, offer the refresh instead.
function showUpdatedToast() {
  if (document.getElementById('kp-sync-toast') || !document.body) return;
  const el = document.createElement('div');
  el.id = 'kp-sync-toast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:400;' +
    'display:flex;align-items:center;gap:10px;background:var(--surface,#fff);border:1px solid var(--line,rgba(0,0,0,.1));' +
    'border-radius:var(--r-pill,20px);box-shadow:0 14px 34px -14px rgba(20,30,55,.4);padding:9px 9px 9px 16px;' +
    'font:600 12.5px Inter,system-ui,sans-serif;color:var(--ink,#1B1D22);max-width:90vw;';
  el.innerHTML = 'Progress updated from your other device' +
    '<button type="button" style="border:none;border-radius:var(--r-pill,20px);padding:7px 14px;background:var(--accent,#2F9E76);color:#fff;font:700 12px \'Plus Jakarta Sans\',Inter,sans-serif;cursor:pointer;">Refresh</button>';
  el.querySelector('button').addEventListener('click', () => {
    try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch { }
    window.location.reload();
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 15000);
}

async function syncOnLoad() {
  if (qaHermetic()) return; // QA runs never touch the network
  const username = getUsername();
  if (!username) return;
  status.state = 'pulling';
  let remote;
  try { remote = await pull(username); }
  catch (err) {
    status.state = 'offline';
    status.lastError = String(err && err.message || err);
    console.warn('KnightPath sync: Supabase unreachable, running local-only.', status.lastError);
    return;
  }
  status.lastPullAt = Date.now();
  let localChanged = false;
  for (const key of SYNC_KEYS) {
    const localRaw = getRaw(key);
    const merged = mergeKey(key, parseRaw(localRaw), key in remote ? remote[key] : null);
    const mergedRaw = ser(merged);
    lastPushed[key] = (key in remote) ? ser(remote[key]) : null;
    if (mergedRaw != null && mergedRaw !== localRaw) { setRaw(key, mergedRaw); localChanged = true; }
  }
  status.state = 'ok';
  await flush();                               // seed/refresh remote where local won the merge
  document.dispatchEvent(new CustomEvent('kp-sync-updated', { detail: { localChanged } }));
  maybeReload(localChanged);
}

// ---------- write interception (catches every meaningful event) ----------
// Conventions note (logged in docs/learnings.md v0.78): CLAUDE.md routes
// persistence through js/puzzle/storage.js, but in practice the inline page
// scripts, streak.js, playout.js, openings/srs.js etc. all write localStorage
// directly, so wrapping storage.js alone would miss the streak and session
// events the feature exists for. Wrapping setItem once catches them all
// without touching any call site. Writes to non-synced keys are untouched.
// NOTE: the hook must go on Storage.prototype. Storage instances intercept
// property sets (assigning localStorage.setItem stores an ITEM named "setItem"
// instead of shadowing the method), so an instance-level patch silently no-ops.
function installWriteHook() {
  if (window.__kpSyncHooked) return;
  window.__kpSyncHooked = true;
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    try {
      original.call(this, key, value);
    } catch (err) {
      // QuotaExceeded was previously swallowed by every caller's silent catch
      // (2026-06-10 audit finding: silent data loss). Surface it ONCE per
      // session, then rethrow so caller semantics are unchanged.
      if (this === window.localStorage) showQuotaWarning();
      throw err;
    }
    try {
      if (this === window.localStorage && SYNC_KEYS.includes(key) && getUsername()) schedulePush();
    } catch { /* never let sync break a write */ }
  };
}

let quotaWarned = false;
function showQuotaWarning() {
  if (quotaWarned || !document.body) return;
  quotaWarned = true;
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:400;' +
    'background:var(--bad,#D2553F);color:#fff;font:600 12.5px Inter,system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:12px;box-shadow:0 10px 26px -10px rgba(0,0,0,.4);max-width:90vw;';
  el.textContent = 'This device’s storage is full, your latest progress may not have saved locally. Synced data is safe in the cloud.';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 12000);
}

// ---------- first-run gate (v0.80) ----------
// No username → no app. The product gives a new user nothing without their
// games, so anonymous visits route to the onboarding flow (owner decision,
// replaces the v0.78 non-blocking banner). onboarding.html itself is exempt
// (it's where the username is collected). The QA suite seeds a username via
// its fixtures, plus kp-qa-no-sync to keep test runs network-hermetic.
function qaHermetic() {
  try { return localStorage.getItem('kp-qa-no-sync') === '1'; } catch { return false; }
}
function enforceOnboardingGate() {
  if (getUsername()) return false;
  if (window.location.pathname === '/onboarding.html') return false;
  window.location.replace('/onboarding.html');
  return true;
}

// ---------- nav user chip (who am I + change user) ----------
// Switching users on a shared device MUST clear local chess-coach-* state
// first: otherwise the next pull would merge user A's attempts into user B's
// cloud rows. The old data is safe, it lives under A's username in Supabase
// and comes back the moment A's name is entered again. (This also replaces
// games.html's old "clear all data" button, owner call, 2026-06-10.)
function switchUser(mode) {
  const current = getUsername();
  const msg = (mode === 'wipe')
    ? 'Wipe this device? Your training data is cleared locally only, everything stays safely synced to ' +
      (current ? `“${current}”` : 'your username') + ' and comes back the moment you sign in again. No games need re-analysing.'
    : (current ? `Signed in as ${current}. ` : '') +
      'Switch user? This clears this device’s local training data, it stays safely synced to the current username and returns when that name is entered again.';
  if (!window.confirm(msg)) return;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('chess-coach-')) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch { /* best effort */ }
  window.location.reload();
}

function renderUserChip() {
  const drawer = document.querySelector('.nav-drawer');
  if (!drawer || document.getElementById('kp-user-chip')) return;
  const username = getUsername();
  if (!username) return; // anonymous never reaches a shell page (onboarding gate)
  // Redesign (owner feedback 2026-06-10): gradient avatar with the user's
  // initial, name + a quiet "Synced" status line, and a subtle swap icon
  // instead of a bare text link. Same visual family as the coach avatar.
  const displayU = (typeof KPProfile !== 'undefined' && KPProfile.displayNameFor) ? KPProfile.displayNameFor(username) : username;
  const initial = displayU.charAt(0).toUpperCase();
  const el = document.createElement('div');
  el.id = 'kp-user-chip';
  el.title = 'Progress syncs to this Chess.com username';
  el.innerHTML = `
    <span class="kp-u-ava" aria-hidden="true">${initial}</span>
    <span class="kp-u-id"><span class="kp-u-name">${displayU}</span><span class="kp-u-sub"><i></i>Synced</span></span>
    <button type="button" class="kp-u-change" aria-label="Switch user" title="Switch user (clears this device; your data stays in the cloud)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
    </button>`;
  const style = document.createElement('style');
  style.textContent = `
    #kp-user-chip{display:flex;align-items:center;gap:9px;margin:10px 12px 0;padding:8px 9px;
      border:1px solid var(--line,rgba(0,0,0,.1));border-radius:var(--r-panel,14px);background:var(--surface2,#F2F4F7);}
    #kp-user-chip .kp-u-ava{flex-shrink:0;width:28px;height:28px;border-radius:9px;
      background:linear-gradient(140deg,var(--accent,#2F9E76),var(--accent-2,#5FB58F));color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-family:'Plus Jakarta Sans','Inter',sans-serif;font-weight:800;font-size:13px;
      box-shadow:0 3px 8px -3px var(--accent,#2F9E76);}
    #kp-user-chip .kp-u-id{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25;}
    #kp-user-chip .kp-u-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font-family:'Plus Jakarta Sans','Inter',sans-serif;font-size:12.5px;font-weight:700;color:var(--ink,#1B1D22);}
    #kp-user-chip .kp-u-sub{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--muted,#666A73);}
    #kp-user-chip .kp-u-sub i{width:5px;height:5px;border-radius:50%;background:var(--pos,#1F9D57);}
    #kp-user-chip .kp-u-change{flex-shrink:0;width:26px;height:26px;border:none;border-radius:8px;
      background:none;color:var(--muted,#666A73);cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:color .15s ease,background-color .15s ease;}
    #kp-user-chip .kp-u-change svg{width:14px;height:14px;}
    #kp-user-chip .kp-u-change:hover{color:var(--accent,#2F9E76);background:var(--surface,#fff);}
  `;
  document.head.appendChild(style);
  const stamp = drawer.querySelector('.version-stamp');
  if (stamp) drawer.insertBefore(el, stamp); else drawer.appendChild(el);
  el.querySelector('.kp-u-change').addEventListener('click', () => switchUser());
}

// ---------- boot ----------
installWriteHook();
window.addEventListener('pagehide', () => { flush({ keepalive: true }); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush({ keepalive: true });
});
if (!enforceOnboardingGate()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderUserChip);
  } else {
    renderUserChip();
  }
  syncOnLoad();
}

// Debug/console handle, not a second store, just a window into the sync layer.
// wipeDevice = the "wipe all my data" affordance (games/review pages + user
// chip): clears LOCAL chess-coach-* state only; the Supabase copy survives, so
// re-entering the username restores everything without re-ingesting.
window.KPSync = { status, flush, syncOnLoad, getUsername, wipeDevice: () => switchUser('wipe'), suspendPush };

// Exported for the qa/scripts/sync-merge-check harness (browser import via
// Playwright, node can't import this module because of the top-level DOM use).
export { mergeKey };
