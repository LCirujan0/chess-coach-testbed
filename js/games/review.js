// ============================================================================
// review.js. Spec 11 interactive game review.
// ----------------------------------------------------------------------------
// Turns the Games page's "Review" surface into a ply-by-ply board replay. At
// each SAVED mistake a severity badge + "Why?" affordance appears; tapping it
// asks the coach to explain that one move (grounded in the stored mistake
// record, the game is over, so naming the better move is the deliverable, NOT
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
const KEY_SCORECARDS = 'chess-coach-game-scorecards-v1';
const KEY_META = 'chess-coach-game-meta-v1';

function loadJson(key, fb) {
  try { const v = JSON.parse(localStorage.getItem(key) || ''); return v == null ? fb : v; }
  catch { return fb; }
}

// Group the game's saved mistakes by ply index, parsed from the record id
// (`${gameKey}|${plyIndex}`). Exact join, the id encodes the history index.
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
// Review list. Bug fix (2026-06-10, owner report "review pulls no games"):
// this listed ONLY chess-coach-game-moves-v1, but games ingested before
// move-capture existed (or on another origin) live only in the scorecard /
// meta / mistakes stores, so the list looked empty while "Saved games" showed
// data. Now the list is the UNION of all per-game stores; games without a
// captured move list appear with an honest "re-sync to enable replay" CTA
// instead of being silently invisible.
// ---------------------------------------------------------------------------
export function renderReviewList() {
  const host = $('review-list');
  if (!host) return;
  const moves = loadJson(KEY_MOVES, {}) || {};
  const scorecards = loadJson(KEY_SCORECARDS, {}) || {};
  const meta = loadJson(KEY_META, {}) || {};
  const allMistakes = loadJson(KEY_MISTAKES, []) || [];
  const keys = new Set([...Object.keys(moves), ...Object.keys(scorecards), ...Object.keys(meta)]);
  // Mistake records carry their gameUrl, surface games known ONLY from mistakes too.
  for (const m of allMistakes) { const k = m.gameUrl || (m.id || '').split('|')[0]; if (k) keys.add(k); }
  if (!keys.size) {
    host.innerHTML = '<div class="sub" style="padding:4px 0;">No games yet. Sync your Chess.com games first, then review them here.</div>';
    return;
  }
  const countFor = (k) => allMistakes.filter((m) => (m.gameUrl || (m.id || '').split('|')[0]) === k).length;
  const dateOf = (k, mv) => mv?.dateStr
    || (meta[k] && typeof meta[k].endTime === 'number' ? new Date(meta[k].endTime * 1000).toISOString().slice(0, 10) : '');
  const rows = [...keys]
    .map((k) => {
      const mv = moves[k] || null;
      const mt = meta[k] || null;
      return {
        k,
        replayable: !!(mv && Array.isArray(mv.moves) && mv.moves.length),
        opponent: mv?.opponent || mt?.opponent || null,
        userIsWhite: mv ? mv.userIsWhite !== false : (mt ? String(mt.userColorName).toLowerCase() === 'white' : null),
        result: mv?.result || mt?.result || null,
        dateStr: dateOf(k, mv),
        n: countFor(k),
        meta: mt,
      };
    })
    .sort((a, b) => String(b.dateStr || '').localeCompare(String(a.dateStr || '')));
  host.innerHTML = rows.map((g) => {
    const colour = g.userIsWhite == null ? '' : (g.userIsWhite ? ' · White' : ' · Black');
    const res = g.result ? ' · ' + resultLabel(g.result, g.userIsWhite !== false) : '';
    const action = g.replayable
      ? `<button class="btn btn-secondary" data-review-open="${escapeHtml(g.k)}" type="button" style="flex:none;">Review →</button>`
      : `<a class="btn btn-secondary" href="/games.html" style="flex:none;text-decoration:none;" title="This game predates replay capture, one re-sync makes it replayable.">Re-sync to replay</a>`;
    // Chess.com enrichment (v0.80): opening, per-game performance estimate, and
    // accuracy (present only when a chess.com Game Review ran on the game).
    const bits = [];
    const cci = (typeof ChesscomInsights !== 'undefined') ? ChesscomInsights : null;
    if (g.meta) {
      if (g.meta.openingName || g.meta.eco) bits.push(escapeHtml((cci && cci.openingDisplayName(g.meta)) || g.meta.openingName || g.meta.eco));
      // Per-game performance only when the pairing was close enough for the
      // estimate to mean anything (within ±400 the formula is informative;
      // beyond that it saturates and just confuses).
      const perf = cci ? cci.perfOf(g.meta) : null;
      const fair = typeof g.meta.rating === 'number' && typeof g.meta.oppRating === 'number' && Math.abs(g.meta.oppRating - g.meta.rating) <= 400;
      if (perf != null && fair) bits.push(`played like <b>${perf}</b>`);
      if (typeof g.meta.userAccuracy === 'number') bits.push(`${Math.round(g.meta.userAccuracy)}% accuracy${typeof g.meta.oppAccuracy === 'number' ? ` (opp ${Math.round(g.meta.oppAccuracy)}%)` : ''}`);
    }
    const enrich = bits.length ? `<div class="sub" style="margin:2px 0 0;font-size:11px;">${bits.join(' · ')}</div>` : '';
    return `<div class="review-row" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">vs ${escapeHtml(g.opponent || 'opponent')}</div>
        <div class="sub" style="margin:0;">${escapeHtml(g.dateStr || '')}${colour}${res} · ${g.n} saved mistake${g.n === 1 ? '' : 's'}</div>
        ${enrich}
      </div>
      ${action}
    </div>`;
  }).join('');
}

function resultLabel(result, userIsWhite) {
  if (result === '1-0') return userIsWhite ? 'Win' : 'Loss';
  if (result === '0-1') return userIsWhite ? 'Loss' : 'Win';
  if (result === '1/2-1/2') return 'Draw';
  return result || ', ';
}

// ---------------------------------------------------------------------------
// Review mode, open / replay / close
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
  reviewState.meta = (loadJson(KEY_META, {}) || {})[gameKey] || null;
  reviewState.lastMove = null;
  $('review-panel').classList.add('hidden');
  $('review-mode').classList.remove('hidden');
  renderMoments();
  renderPly();
}

// ---------------------------------------------------------------------------
// Key-moments walkthrough (2026-06-10, owner ask): the game's saved mistakes
// as a jumpable strip + a "Next key moment" control, so review WALKS the user
// through what mattered instead of leaving them to step 80 plies blind.
// Jumping to a moment auto-asks the coach about it (the jump IS the explicit
// user action, rule 5 holds; responses are cached per mistake id).
// ---------------------------------------------------------------------------
function momentPlies() {
  return Object.keys(reviewState.mistakesByPly).map(Number).sort((a, b) => a - b);
}
function gameMetaLine() {
  const m = reviewState.meta;
  if (!m) return '';
  const cci = (typeof ChesscomInsights !== 'undefined') ? ChesscomInsights : null;
  const bits = [];
  if (m.openingName || m.eco) bits.push(escapeHtml((cci && cci.openingDisplayName(m)) || m.openingName || m.eco));
  // Same close-pairing guard as the list (lopsided pairings make the single-
  // game estimate meaningless).
  const perf = cci ? cci.perfOf(m) : null;
  const fair = typeof m.rating === 'number' && typeof m.oppRating === 'number' && Math.abs(m.oppRating - m.rating) <= 400;
  if (perf != null && fair) {
    const d = perf - m.rating;
    bits.push(`you played like <b>${perf}</b> (${d >= 0 ? '+' : ''}${d} vs your ${m.rating})`);
  }
  if (typeof m.userAccuracy === 'number') bits.push(`${Math.round(m.userAccuracy)}% accuracy`);
  if (!bits.length) return '';
  return `<div class="sub" style="margin:0 0 8px;font-size:12px;">${bits.join(' · ')}</div>`;
}

function renderMoments() {
  const host = $('review-moments');
  if (!host) return;
  const plies = momentPlies();
  if (!plies.length) { host.innerHTML = gameMetaLine() + '<div class="sub" style="margin:0 0 10px;">No saved mistakes in this game, a clean one. Step through at your own pace.</div>'; return; }
  const worst = plies.reduce((w, p) => {
    const m = reviewState.mistakesByPly[p];
    return (!w || (m.cpLoss || 0) > (w.cpLoss || 0)) ? m : w;
  }, null);
  const head = `${plies.length} key moment${plies.length === 1 ? '' : 's'}` +
    (worst ? ` · worst at move ${worst.fullmove} (${((worst.cpLoss || 0) / 100).toFixed(1)} pawns)` : '');
  host.innerHTML = gameMetaLine() + `<div class="rm-head">${escapeHtml(head)}</div><div class="rm-row">` +
    plies.map((p) => {
      const m = reviewState.mistakesByPly[p];
      const on = reviewState.plyIndex === p + 1 ? ' on' : '';
      return `<button type="button" class="rm-chip${on}" data-moment="${p}" title="${escapeHtml(m.severity || '')}">` +
        `<span class="rm-dot ${escapeHtml(m.severity || 'mistake')}"></span>Move ${m.fullmove}</button>`;
    }).join('') + '</div>';
}
function jumpToMoment(ply) {
  const m = reviewState.mistakesByPly[ply];
  if (!m) return;
  reviewState.plyIndex = ply + 1; // show the position AFTER the mistake move
  renderPly();
  renderMoments();
  explainMistake(m); // cached per id, repeat jumps are free
}
function nextKeyMoment() {
  const plies = momentPlies();
  if (!plies.length) return;
  const next = plies.find((p) => p + 1 > reviewState.plyIndex);
  jumpToMoment(next != null ? next : plies[0]); // wrap to the first
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
  // Slide the piece only on a single forward step (▶), back/jumps render instantly.
  const animate = (reviewState._prevPly != null && plyIndex === reviewState._prevPly + 1 && !!reviewState.lastMove);
  reviewState._prevPly = plyIndex;
  renderStaticBoard($('review-board'), c.fen(), {
    orientation: reviewState.userIsWhite ? 'w' : 'b',
    lastMove: reviewState.lastMove,
    animate,
  });
  $('review-ply').textContent = `Move ${plyIndex} of ${moves.length}`;
  // Visual position track: fill + mistake markers (built once per game).
  const track = $('review-progress');
  if (track) {
    const fill = track.querySelector('i');
    if (fill) fill.style.width = (moves.length ? Math.round(100 * plyIndex / moves.length) : 0) + '%';
    if (track.dataset.game !== reviewState.gameKey) {
      track.dataset.game = reviewState.gameKey;
      track.querySelectorAll('.rp-mark').forEach((m) => m.remove());
      for (const p of Object.keys(reviewState.mistakesByPly)) {
        const m = reviewState.mistakesByPly[p];
        const dot = document.createElement('span');
        dot.className = 'rp-mark ' + (m.severity || 'mistake');
        dot.style.left = (moves.length ? ((Number(p) + 1) / moves.length) * 100 : 0) + '%';
        dot.title = `Move ${m.fullmove}: ${m.severity}`;
        track.appendChild(dot);
      }
    }
  }
  $('review-prev').disabled = plyIndex <= 0;
  $('review-next').disabled = plyIndex >= moves.length;

  // A saved mistake is keyed by the ply index of the move that produced this
  // position, i.e. plyIndex - 1.
  const mistake = plyIndex > 0 ? reviewState.mistakesByPly[plyIndex - 1] : null;
  const badge = $('review-badge');
  const coach = $('review-coach');
  coach.innerHTML = '';
  if (mistake) {
    // Always name the player's own move (owner 2026-06-11: "it doesn't tell
    // me which was my move") before the severity + coach affordance.
    badge.innerHTML = `<span style="font-size:13px;font-weight:600;">You played <b>${escapeHtml(mistake.userMoveSan || '?')}</b></span>
      <span class="sev ${escapeHtml(mistake.severity)}" style="margin-left:8px;">${escapeHtml(mistake.severity)}</span>
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
  `The student is rated approximately ${rating} on Chess.com rapid, targeting ${(typeof KPProfile!=='undefined'?KPProfile.targetElo():1500)}. Calibrate`,
  `to that band: concrete patterns and one-move-ahead ideas, not advanced structural vocabulary.`,
  ``,
  `You are given the position, the move the student played, the engine's preferred move and`,
  `lines, the centipawn cost, and the tactical motif. The game is over, there is no answer to`,
  `hide. Explain plainly what they played, what was better, and WHY, grounded ONLY in the`,
  `supplied data. Do not invent moves, pieces, or evaluations not present in the data.`,
  ``,
  `Return ONLY this JSON (no markdown, no fences):`,
  `{ "lead": "...", "points": [{ "label": "...", "text": "...", "tone": "bad|warn|pos|muted" }], "question": "...", "grounded": "..." }`,
  `- lead: one line naming the mistake in plain terms.`,
  `- points: 2-3 labelled points (You played / Better / Why), tones tinted by severity.`,
  `- question: one reflective question to internalise the pattern.`,
  `- grounded: the source line, e.g. "Engine: ${'$'}{bestMove} was N pawns better."`,
].join('\n') + coachMemoryBlock();

// The coach's per-user memory (js/coach-memory.js window global), the same
// teacher remembering this student across surfaces. Empty when none.
function coachMemoryBlock() {
  try { if (typeof CoachMemory !== 'undefined') return CoachMemory.promptBlock(CoachMemory.read()); } catch { /* optional */ }
  return '';
}

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
// tagged), shaped for the shared card's cta[] (label + href).
function currentMotifCta() {
  const m = reviewState.plyIndex > 0 ? reviewState.mistakesByPly[reviewState.plyIndex - 1] : null;
  if (!m || !m.motif || m.motif === 'none-tactical') return null;
  const label = MOTIF_LABELS[m.motif] || m.motif;
  return { label: `Drill ${label} mistakes →`, href: `/puzzle.html?motif=${encodeURIComponent(m.motif)}&source=review`, primary: true };
}

// ---------------------------------------------------------------------------
// Mount, wire controls once + render the list. Idempotent.
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
  const next = $('review-next'); if (next) next.addEventListener('click', () => { if (reviewState.plyIndex < reviewState.moves.length) { reviewState.plyIndex++; renderPly(); renderMoments(); } });
  const prev = $('review-prev'); if (prev) prev.addEventListener('click', () => { if (reviewState.plyIndex > 0) { reviewState.plyIndex--; renderPly(); renderMoments(); } });
  const moment = $('review-next-moment'); if (moment) moment.addEventListener('click', nextKeyMoment);
  const moments = $('review-moments'); if (moments) moments.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-moment]');
    if (chip) jumpToMoment(parseInt(chip.getAttribute('data-moment'), 10));
  });
  // Wipe this device (v0.80): local-only, the Supabase copy survives, so
  // signing back in restores everything without re-ingesting.
  const wipe = $('wipe-device-btn');
  if (wipe) wipe.addEventListener('click', () => { if (window.KPSync) window.KPSync.wipeDevice(); });
}
