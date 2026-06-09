// ============================================================================
// review.js — Spec 11 interactive game review.
// ----------------------------------------------------------------------------
// Turns the Games page's "Review" surface into a ply-by-ply board replay. At
// each SAVED mistake a severity badge + "Why?" affordance appears; tapping it
// asks the coach to explain that one move (grounded in the stored mistake
// record — the game is over, so naming the better move is the deliverable, NOT
// a spoiler; §12 NAMING_RULES deliberately do not apply here). If the mistake
// is tagged, a "Drill this motif" CTA deep-links into a focused puzzle session.
//
// Reuses the canonical static board (js/board-static.js renderStaticBoard) and
// the Chess pin (games/lib.js). The §17 review card is rendered through the ONE
// shared renderer (js/coach-card.js renderCoachCard); ensureCoachCardStyles()
// injects the canonical .rv-* rules so review.html needs no extra stylesheet.
// ============================================================================
import { renderStaticBoard } from '/js/board-static.js';
import { Chess } from './lib.js';
import { $, escapeHtml } from './dom.js';
import { MOTIF_LABELS } from '/js/puzzle/config.js';
import { renderCoachCard, parseCoachJson, ensureCoachCardStyles } from '/js/coach-card.js';

const KEY_MOVES = 'chess-coach-game-moves-v1';
const KEY_MISTAKES = 'chess-coach-mistakes-v1';
const KEY_RATING = 'chess-coach-user-rating-v1';

function loadJson(key, fb) {
  try { const v = JSON.parse(localStorage.getItem(key) || ''); return v == null ? fb : v; }
  catch { return fb; }
}

// Group the game's saved mistakes by ply index, parsed from the record id
// (`${gameKey}|${plyIndex}`). Exact join — the id encodes the history index.
function mistakesByPlyFor(gameKey) {
  const all = loadJson(KEY_MISTAKES, []) || [];
  const out = {};
  for (const m of all) {
    const key = m.gameUrl || (m.id || '').split('|')[0];
    if (key !== gameKey) continue;
    const ply = parseInt((m.id || '').split('|')[1], 10);
    if (!Number.isNaN(ply)) out[ply] = m;
  }
  return out;
}

const reviewState = {
  gameKey: null,
  moves: [],
  userIsWhite: true,
  plyIndex: 0,
  mistakesByPly: {},
  lastMove: null,
};
const explainCache = new Map(); // mistake id -> rendered review object

// ---------------------------------------------------------------------------
// Review list (only games with a captured move list are replayable — option b)
// ---------------------------------------------------------------------------
export function renderReviewList() {
  const host = $('review-list');
  if (!host) return;
  const moves = loadJson(KEY_MOVES, {}) || {};
  const keys = Object.keys(moves);
  if (!keys.length) {
    host.innerHTML = '<div class="sub" style="padding:4px 0;">No replayable games yet. Ingest games above, then review them here.</div>';
    return;
  }
  const allMistakes = loadJson(KEY_MISTAKES, []) || [];
  const countFor = (k) => allMistakes.filter((m) => (m.gameUrl || (m.id || '').split('|')[0]) === k).length;
  const rows = keys
    .map((k) => ({ k, ...moves[k], n: countFor(k) }))
    .sort((a, b) => String(b.dateStr || '').localeCompare(String(a.dateStr || '')));
  host.innerHTML = rows.map((g) => {
    const colour = g.userIsWhite ? 'White' : 'Black';
    const res = resultLabel(g.result, g.userIsWhite);
    return `<div class="review-row" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">vs ${escapeHtml(g.opponent || 'opponent')}</div>
        <div class="sub" style="margin:0;">${escapeHtml(g.dateStr || '')} · ${colour} · ${res} · ${g.n} saved mistake${g.n === 1 ? '' : 's'}</div>
      </div>
      <button class="btn btn-secondary" data-review-open="${escapeHtml(g.k)}" type="button" style="flex:none;">Review →</button>
    </div>`;
  }).join('');
}

function resultLabel(result, userIsWhite) {
  if (result === '1-0') return userIsWhite ? 'Win' : 'Loss';
  if (result === '0-1') return userIsWhite ? 'Loss' : 'Win';
  if (result === '1/2-1/2') return 'Draw';
  return result || '—';
}

// ---------------------------------------------------------------------------
// Review mode — open / replay / close
// ---------------------------------------------------------------------------
function openReview(gameKey) {
  const moves = loadJson(KEY_MOVES, {}) || {};
  const entry = moves[gameKey];
  if (!entry || !Array.isArray(entry.moves)) return;
  reviewState.gameKey = gameKey;
  reviewState.moves = entry.moves;
  reviewState.userIsWhite = entry.userIsWhite !== false;
  reviewState.plyIndex = 0;
  reviewState.mistakesByPly = mistakesByPlyFor(gameKey);
  reviewState.lastMove = null;
  $('review-panel').classList.add('hidden');
  $('review-mode').classList.remove('hidden');
  renderPly();
}

function closeReview() {
  $('review-mode').classList.add('hidden');
  $('review-panel').classList.remove('hidden');
  $('review-coach').innerHTML = '';
  $('review-badge').innerHTML = '';
}

function renderPly() {
  const { moves, plyIndex } = reviewState;
  const c = new Chess();
  let lm = null;
  for (let k = 0; k < plyIndex; k++) {
    try { lm = c.move(moves[k]); } catch { lm = null; break; }
  }
  reviewState.lastMove = lm ? { from: lm.from, to: lm.to } : null;
  renderStaticBoard($('review-board'), c.fen(), {
    orientation: reviewState.userIsWhite ? 'w' : 'b',
    lastMove: reviewState.lastMove,
  });
  $('review-ply').textContent = `Move ${plyIndex} of ${moves.length}`;
  $('review-prev').disabled = plyIndex <= 0;
  $('review-next').disabled = plyIndex >= moves.length;

  // A saved mistake is keyed by the ply index of the move that produced this
  // position, i.e. plyIndex - 1.
  const mistake = plyIndex > 0 ? reviewState.mistakesByPly[plyIndex - 1] : null;
  const badge = $('review-badge');
  const coach = $('review-coach');
  coach.innerHTML = '';
  if (mistake) {
    badge.innerHTML = `<span class="sev ${escapeHtml(mistake.severity)}">${escapeHtml(mistake.severity)}</span>
      <button class="btn btn-secondary" id="review-why" type="button" style="margin-left:8px;">Why?</button>`;
    $('review-why').addEventListener('click', () => explainMistake(mistake));
  } else {
    badge.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
// Per-mistake coach explanation (on-demand, grounded, cached, §12 carve-out)
// ---------------------------------------------------------------------------
function reviewRating() {
  const rc = loadJson(KEY_RATING, null);
  return (rc && typeof rc.rating === 'number') ? rc.rating : 950;
}

function buildUserMessage(m) {
  const pvs = (m.engineLines || []).slice(0, 5).map((l, i) => {
    const ev = l.eval && l.eval.mate != null ? `M${l.eval.mate}` : (l.eval && typeof l.eval.cp === 'number' ? `${l.eval.cp}cp` : '?');
    return `  ${i + 1}. ${l.san} (${ev}) ${Array.isArray(l.pvSan) ? l.pvSan.slice(0, 6).join(' ') : ''}`;
  }).join('\n');
  const cont = Array.isArray(m.actualContinuation) ? m.actualContinuation.map((p) => p.san).join(' ') : '';
  return [
    `FEN: ${m.fen}`,
    `Side to move: ${m.userColorName}`,
    `Move ${m.fullmove}: the student played ${m.userMoveSan} (${m.cpLoss}cp below best).`,
    `Engine preferred ${m.bestMoveSan}. Top lines:`,
    pvs,
    `Tactical motif: ${m.motif || 'none'}.`,
    cont ? `What actually happened next: ${cont}.` : '',
  ].filter(Boolean).join('\n');
}

const REVIEW_SYSTEM = (rating) => [
  `You are a chess coach reviewing one move from a game the student has ALREADY played.`,
  `The student is rated approximately ${rating} on Chess.com rapid, targeting 1500. Calibrate`,
  `to that band: concrete patterns and one-move-ahead ideas, not advanced structural vocabulary.`,
  ``,
  `You are given the position, the move the student played, the engine's preferred move and`,
  `lines, the centipawn cost, and the tactical motif. The game is over — there is no answer to`,
  `hide. Explain plainly what they played, what was better, and WHY, grounded ONLY in the`,
  `supplied data. Do not invent moves, pieces, or evaluations not present in the data.`,
  ``,
  `Return ONLY this JSON (no markdown, no fences):`,
  `{ "lead": "...", "points": [{ "label": "...", "text": "...", "tone": "bad|warn|pos|muted" }], "question": "...", "grounded": "..." }`,
  `- lead: one line naming the mistake in plain terms.`,
  `- points: 2-3 labelled points (You played / Better / Why), tones tinted by severity.`,
  `- question: one reflective question to internalise the pattern.`,
  `- grounded: the source line, e.g. "Engine: ${'$'}{bestMove} was N pawns better."`,
].join('\n');

async function explainMistake(m) {
  const coach = $('review-coach');
  if (explainCache.has(m.id)) { renderReviewCard(coach, explainCache.get(m.id)); return; }
  coach.innerHTML = '<div class="sub" style="padding:8px 0;">Coach is looking at this move…</div>';
  try {
    const r = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: REVIEW_SYSTEM(reviewRating()),
        messages: [{ role: 'user', content: buildUserMessage(m) }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const review = parseCoachJson(text) || fallbackReview(m);
    explainCache.set(m.id, review);
    renderReviewCard(coach, review);
  } catch (e) {
    renderReviewCard(coach, fallbackReview(m));
  }
}

// Deterministic fallback when the call fails or the JSON doesn't parse.
function fallbackReview(m) {
  return {
    lead: `${m.userMoveSan} let the advantage slip (${m.cpLoss}cp).`,
    points: [
      { label: 'You played', text: m.userMoveSan, tone: 'bad' },
      { label: 'Better', text: m.bestMoveSan, tone: 'pos' },
      m.motif && m.motif !== 'none-tactical' ? { label: 'Theme', text: MOTIF_LABELS[m.motif] || m.motif, tone: 'muted' } : null,
    ].filter(Boolean),
    question: 'What did the better move do that yours did not?',
    grounded: `Engine: ${m.bestMoveSan} was ${(m.cpLoss / 100).toFixed(1)} pawns better.`,
  };
}

// Render one per-mistake review through the ONE shared §17 card
// (js/coach-card.js). The game is over so naming the better move is the
// deliverable, not a spoiler (§12 carve-out). The "Drill this motif" deep-link
// is passed as a card CTA (href) when the mistake is tagged. review.html links
// train.css but not the .rv-* block, so ensureCoachCardStyles() injects the
// canonical rules once on first render.
function renderReviewCard(container, review) {
  ensureCoachCardStyles();
  const cta = currentMotifCta();
  const parsed = cta ? { ...review, cta: [cta] } : review;
  renderCoachCard(container, parsed, { append: false, scroll: false });
}

// "Drill this motif" CTA descriptor for the currently-displayed mistake (if
// tagged) — shaped for the shared card's cta[] (label + href).
function currentMotifCta() {
  const m = reviewState.plyIndex > 0 ? reviewState.mistakesByPly[reviewState.plyIndex - 1] : null;
  if (!m || !m.motif || m.motif === 'none-tactical') return null;
  const label = MOTIF_LABELS[m.motif] || m.motif;
  return { label: `Drill ${label} mistakes →`, href: `/puzzle.html?motif=${encodeURIComponent(m.motif)}&source=review`, primary: true };
}

// ---------------------------------------------------------------------------
// Mount — wire controls once + render the list. Idempotent.
// ---------------------------------------------------------------------------
let wired = false;
export function initReview() {
  renderReviewList();
  if (wired) return;
  wired = true;
  const list = $('review-list');
  if (list) list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-review-open]');
    if (btn) openReview(btn.getAttribute('data-review-open'));
  });
  const back = $('review-back'); if (back) back.addEventListener('click', closeReview);
  const next = $('review-next'); if (next) next.addEventListener('click', () => { if (reviewState.plyIndex < reviewState.moves.length) { reviewState.plyIndex++; renderPly(); } });
  const prev = $('review-prev'); if (prev) prev.addEventListener('click', () => { if (reviewState.plyIndex > 0) { reviewState.plyIndex--; renderPly(); } });
}
