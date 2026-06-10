// ============================================================================
// js/openings/srs.js. PURE spaced-repetition scheduling for opening lines.
// ----------------------------------------------------------------------------
// Leitner-style boxes (1..N). A line in box B is due again INTERVALS[B] days
// after it was last reviewed. A correct recall promotes the line one box
// (longer interval); a lapse demotes it back to box 1 (see it again soon).
//
// No DOM, no fetch, no localStorage IO here, fully node-testable. boot.js owns
// reading/writing the persisted blob under 'chess-coach-openings-v1'. Times are
// epoch milliseconds so callers can inject `now` for deterministic tests.
//
// Persisted per-line record shape (one per opening line id):
//   { box, dueAt, lastSeen, streak, lapses }
// ============================================================================

// Box 1 is "learning" (same day); each higher box roughly doubles the gap.
export const INTERVAL_DAYS = [0, 1, 2, 4, 9, 21];
export const MAX_BOX = INTERVAL_DAYS.length - 1; // 5
export const DAY_MS = 24 * 60 * 60 * 1000;

// A brand-new line: box 1, due immediately, never seen.
export function freshCard(now = Date.now()) {
  return { box: 1, dueAt: now, lastSeen: 0, streak: 0, lapses: 0 };
}

// Coerce any stored value (or undefined) into a valid card.
export function normalizeCard(card, now = Date.now()) {
  if (!card || typeof card !== 'object') return freshCard(now);
  const box = clampBox(card.box);
  return {
    box,
    dueAt: Number.isFinite(card.dueAt) ? card.dueAt : now,
    lastSeen: Number.isFinite(card.lastSeen) ? card.lastSeen : 0,
    streak: Number.isFinite(card.streak) && card.streak >= 0 ? card.streak : 0,
    lapses: Number.isFinite(card.lapses) && card.lapses >= 0 ? card.lapses : 0,
  };
}

function clampBox(b) {
  const n = Math.round(Number(b));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > MAX_BOX ? MAX_BOX : n;
}

// The next due timestamp for a card at a given box, reviewed at `now`.
function dueFor(box, now) {
  return now + INTERVAL_DAYS[clampBox(box)] * DAY_MS;
}

// Grade a completed line. `passed` = the whole line was recalled without error.
// Returns a NEW card (does not mutate the input).
//   pass  -> promote one box (capped at MAX_BOX), streak++, reschedule further out
//   fail  -> demote to box 1, streak reset, lapses++, see again very soon
export function review(card, passed, now = Date.now()) {
  const c = normalizeCard(card, now);
  if (passed) {
    const box = clampBox(c.box + 1);
    return { box, dueAt: dueFor(box, now), lastSeen: now, streak: c.streak + 1, lapses: c.lapses };
  }
  return { box: 1, dueAt: dueFor(1, now), lastSeen: now, streak: 0, lapses: c.lapses + 1 };
}

// Is this card due for review at `now`?
export function isDue(card, now = Date.now()) {
  const c = normalizeCard(card, now);
  return c.dueAt <= now;
}

// Pick the next line to drill from a list of line ids, given the card map.
// Priority: due cards first (most overdue wins), then never-seen, then the
// soonest-due upcoming card so a session is never empty. Returns a line id or
// null when `lineIds` is empty. `order` (line ids in file order) breaks ties
// deterministically.
export function pickNext(lineIds, cardsById, now = Date.now()) {
  if (!Array.isArray(lineIds) || lineIds.length === 0) return null;
  let best = null;
  let bestKey = null;
  for (let i = 0; i < lineIds.length; i++) {
    const id = lineIds[i];
    const c = normalizeCard(cardsById ? cardsById[id] : null, now);
    const overdue = now - c.dueAt; // >=0 means due
    const neverSeen = c.lastSeen === 0;
    // Sort key tuple, lower = picked first:
    //   [tier, -overdue, fileIndex]
    //   tier 0 = due, tier 1 = never seen (but not yet due), tier 2 = upcoming
    let tier;
    if (overdue >= 0) tier = 0;
    else if (neverSeen) tier = 1;
    else tier = 2;
    const key = [tier, tier === 2 ? -overdue : -overdue, i];
    if (bestKey === null || lessKey(key, bestKey)) { bestKey = key; best = id; }
  }
  return best;
}

function lessKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

// How many of these lines are due right now (for the hub "N due" badge).
export function countDue(lineIds, cardsById, now = Date.now()) {
  if (!Array.isArray(lineIds)) return 0;
  let n = 0;
  for (const id of lineIds) if (isDue(cardsById ? cardsById[id] : null, now)) n++;
  return n;
}

// A coarse mastery summary for an opening's lines: how many are in each tier.
//   new (never seen), learning (box 1, 2 seen), strong (box >=3).
export function masterySummary(lineIds, cardsById, now = Date.now()) {
  const out = { total: 0, fresh: 0, learning: 0, strong: 0, due: 0 };
  if (!Array.isArray(lineIds)) return out;
  for (const id of lineIds) {
    out.total++;
    const c = normalizeCard(cardsById ? cardsById[id] : null, now);
    if (c.lastSeen === 0) out.fresh++;
    else if (c.box >= 3) out.strong++;
    else out.learning++;
    if (c.dueAt <= now) out.due++;
  }
  return out;
}
