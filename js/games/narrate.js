import { $, escapeHtml } from './dom.js';
import { renderCoachCard, parseCoachJson, ensureCoachCardStyles } from '/js/coach-card.js';

// Render the per-game / per-session coach output through the ONE shared §17 card
// (Surface 8 + Surface 9). games.html links neither puzzle.css nor train.css, so
// ensureCoachCardStyles() injects the canonical .rv-* rules once. `extraHtml`
// (the drill buttons) is appended below the card.
function renderNarrationCard(outEl, parsed, extraHtml) {
  ensureCoachCardStyles();
  outEl.classList.remove('hidden');
  renderCoachCard(outEl, parsed, { append: false, scroll: false });
  if (extraHtml) {
    const extra = document.createElement('div');
    extra.innerHTML = extraHtml;
    outEl.appendChild(extra);
  }
}

// ---- Coach game review + drill (per-game) -------------------------------
async function reviewGameWithCoach(gameUrl, outEl, btn) {
  let all = [];
  try { all = JSON.parse(localStorage.getItem('chess-coach-mistakes-v1') || '[]') || []; } catch {}
  const ms = all.filter((m) => m.gameUrl === gameUrl || (m.id || '').startsWith(gameUrl + '|'));
  outEl.classList.remove('hidden');
  if (!ms.length) { outEl.textContent = 'No saved mistakes for this game.'; return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Reviewing…';
  outEl.textContent = 'Coach is reviewing this game…';
  // Ground each mistake in its position (FEN) — the game is over, so naming the
  // better move is the deliverable, not a spoiler. FEN lets the coach speak to
  // the actual position, not just the abstract error record.
  const digest = ms.map((m) => ({ move: m.fullmove, fen: m.fen, you: m.userMoveSan, best: m.bestMoveSan, cpLoss: m.cpLoss, severity: m.severity, phase: m.category, motif: m.motif || null }));
  // Rating calibration + coach memory (2026-06-10 coach audit: this was the
  // one LLM surface with no Elo pitch, so it could talk over the student's head).
  let ratingLine = '';
  try { const rc = JSON.parse(localStorage.getItem('chess-coach-user-rating-v1') || 'null'); if (rc && typeof rc.rating === 'number') ratingLine = `The student is rated approximately ${rc.rating} on Chess.com rapid, targeting ${(typeof KPProfile!=='undefined'?KPProfile.targetElo():1500)}. Calibrate to that band: concrete patterns, plain language, no 2000+ jargon.`; } catch {}
  let memoryNote = '';
  try { if (typeof CoachMemory !== 'undefined') memoryNote = CoachMemory.promptBlock(CoachMemory.read()); } catch {}
  const SYS = [
    "You are a warm chess coach reviewing ONE of the student's games, given the list of their mistakes (JSON, each with the position FEN).",
    ratingLine,
    'The game is OVER — there is no answer to hide. Ground every claim ONLY in the supplied data (positions, moves, cp losses); do not invent moves.',
    '',
    'Return ONLY this JSON (no markdown, no fences, no prose outside the object):',
    '{ "lead": "...", "points": [{ "label": "...", "text": "...", "tone": "bad|warn|pos|muted" }], "question": "...", "grounded": "..." }',
    '- lead: one line naming the recurring theme across these mistakes.',
    '- points: 2-3 labelled points (e.g. Recurring theme / Most costly / Work on), tones tinted by severity.',
    '- question: one reflective question to internalise the pattern.',
    '- grounded: the single most costly moment, e.g. "Move 23 lost N pawns."',
    'Plain language. No markdown, no bullet lists, no em-dashes.',
  ].join('\n');
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: SYS + memoryNote, messages: [{ role: 'user', content: 'MISTAKES:\n' + JSON.stringify(digest, null, 2) }] }) });
    const data = await r.json();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = (data.content && data.content[0] && data.content[0].text) || '';
    const parsed = parseCoachJson(txt) || reviewFallback(ms);
    const drills = '<div class="coach-review-drills">' + ms.map((m) => `<a class="btn-drill-one" href="/puzzle.html?drill=${encodeURIComponent(m.id)}">Drill move ${m.fullmove}: ${escapeHtml(m.userMoveSan)}</a>`).join('') + '</div>';
    renderNarrationCard(outEl, parsed, drills);
  } catch (e) { outEl.textContent = 'Coach unavailable right now.'; }
  finally { btn.disabled = false; btn.textContent = old; }
}

// Deterministic §17 fallback when the per-game review call fails or its JSON
// doesn't parse — keeps Surface 9 structured rather than dropping to raw text.
function reviewFallback(ms) {
  const worst = ms.slice().sort((a, b) => (b.cpLoss || 0) - (a.cpLoss || 0))[0] || {};
  return {
    lead: ms.length + ' mistake' + (ms.length === 1 ? '' : 's') + ' to learn from in this game.',
    points: [
      { label: 'Most costly', text: 'Move ' + (worst.fullmove || '?') + ': ' + (worst.userMoveSan || '?') + ' (' + (worst.cpLoss || 0) + 'cp).', tone: 'bad' },
      { label: 'Better', text: worst.bestMoveSan || 'see the engine line', tone: 'pos' },
    ],
    question: 'What did the better move do that yours did not?',
    grounded: 'From your saved mistakes for this game.',
  };
}
function wireReviewHandlers() {
  const listEl = $('mistakes-list');
  if (!listEl || listEl.dataset.reviewWired) return;
  listEl.dataset.reviewWired = '1';
  listEl.addEventListener('click', (e) => {
    const rb = e.target.closest('.btn-review-game');
    if (!rb) return;
    const gu = rb.getAttribute('data-gameurl');
    const out = listEl.querySelector('.game-review-out[data-out="' + (window.CSS && CSS.escape ? CSS.escape(gu) : gu) + '"]');
    if (out) reviewGameWithCoach(gu, out, rb);
  });
}
// ============================================================================
// SECTION 9b — Spec 05 conductor narration (per-game "how you played")
// ============================================================================

// §17 card-shaped fallback for Surface 8 — wraps the deterministic reason so the
// narration stays structured even when the LLM call fails or data is thin.
function narrativeFallbackCard(d) {
  const ATTR_NAMES = {
    tactical_patterns: 'tactics', endgame_technique: 'endgames',
    opening_principles: 'openings', king_safety: 'king safety',
    piece_activity: 'piece activity', pawn_structure: 'pawn structure',
    calculation: 'calculation',
  };
  if (!d || !d.focus_ranked || !d.focus_ranked.length) {
    return { lead: 'Still building your picture', points: [], question: 'Solve a few more puzzles and ingest a game or two so your focus sharpens.', grounded: 'Not enough data yet.' };
  }
  const top = d.focus_ranked[0];
  const name = ATTR_NAMES[top.attribute] || top.attribute;
  const points = [{ label: 'Focus', text: `${name} (${top.tier}, scoring ${Math.round(top.score)}/100).`, tone: 'warn' }];
  if (d.session) points.push({ label: 'Today', text: `${d.session.title} — ${d.session.count} puzzles queued.`, tone: 'muted' });
  return { lead: 'How you have been playing', points, question: 'What is one idea from this area you could apply in your next game?', grounded: 'Based on your game and puzzle history.' };
}

// Render Surface 8 (the "how you played" narration) through the shared card,
// honouring this surface's style.display toggle.
function renderNarrative(out, parsed) {
  ensureCoachCardStyles();
  renderCoachCard(out, parsed, { append: false, scroll: false });
  out.style.display = '';
}

// Build stores from localStorage (same as Insights), call computeCoachView()
// + buildDigest(), then fire Prompt A and render the §17 card. Falls back to
// narrativeFallbackCard() if the LLM call fails or data is thin. On-demand only.
async function handleCoachNarrative() {
  const btn = $('coach-narrative-btn');
  const out = $('coach-narrative-out');
  btn.disabled = true;
  btn.textContent = 'Asking coach…';
  out.style.display = 'none';

  if (typeof CoachStats === 'undefined') {
    out.textContent = 'CoachStats module not loaded — refresh the page and try again.';
    out.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Coach: how did you play?';
    return;
  }

  let mistakes = [], attempts = {}, scorecards = {}, rating = null;
  try { mistakes   = JSON.parse(localStorage.getItem('chess-coach-mistakes-v1')         || '[]')  || []; } catch {}
  try { attempts   = JSON.parse(localStorage.getItem('chess-coach-attempts-v1')         || '{}')  || {}; } catch {}
  try { scorecards = JSON.parse(localStorage.getItem('chess-coach-game-scorecards-v1')  || '{}')  || {}; } catch {}
  try { rating     = JSON.parse(localStorage.getItem('chess-coach-user-rating-v1')      || 'null');      } catch {}

  const view   = CoachStats.computeCoachView({ rating, mistakes, attempts, scorecards, nowMs: Date.now() });
  const digest = CoachStats.buildDigest(view);

  // No games in scorecards yet — skip the LLM call.
  if (!digest.games || digest.games < 1) {
    renderNarrative(out, narrativeFallbackCard(digest));
    btn.disabled = false;
    btn.textContent = 'Coach: how did you play?';
    return;
  }

  // Prompt A — "how you played": narrate the worst phase/pattern from numbers,
  // returned as the §17 card shape (lead + labelled points + reflective
  // question) so Surface 8 renders the same structured card as everywhere else.
  const r = digest.rating || 950;
  const PROMPT_A_SYSTEM = [
    `You are a chess coach reviewing a student's recent games. They are rated approximately ${r} on Chess.com rapid, targeting ${(typeof KPProfile!=='undefined'?KPProfile.targetElo():1500)}.`,
    '',
    'You are given a DIGEST (JSON) of structured scorecard data. Ground EVERY claim ONLY in these numbers.',
    '',
    'HARD RULES:',
    '- Do NOT re-rank priorities. The first item in focus_ranked IS the worst area.',
    '- Do NOT invent any chess fact, move, opening name, or piece name. Use only what the DIGEST provides.',
    '- Do NOT reveal a puzzle answer. There is no position here at all.',
    '- Name the ONE recurring pattern that costs the most: the phase + theme from focus_ranked.',
    '- If focus_ranked is empty (still calibrating): lead says there is not enough data yet; points empty; question suggests ingesting more games.',
    '',
    'Humanise attribute keys: tactical_patterns→tactics, endgame_technique→endgames, opening_principles→openings, king_safety→king safety, piece_activity→piece activity, pawn_structure→pawn structure, calculation→calculation.',
    '',
    'Output ONLY this JSON (no markdown, no fences, no prose outside the object):',
    '{ "lead": "...", "points": [{ "label": "...", "text": "...", "tone": "bad|warn|pos|muted" }], "question": "...", "grounded": "..." }',
    '- lead: one line naming the worst recurring pattern.',
    '- points: 2-3 labelled points (e.g. Worst area / Why it costs / What to do), tones tinted by severity.',
    '- question: one reflective question.',
    '- grounded: the source line, e.g. "Based on your last N games."',
    'Plain language. No markdown, no bullet lists, no em-dashes.',
  ].join('\n');

  try {
    const resp = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: PROMPT_A_SYSTEM + ((typeof CoachMemory !== 'undefined') ? CoachMemory.promptBlock(CoachMemory.read()) : ''),
        messages: [{ role: 'user', content: 'DIGEST:\n' + JSON.stringify(digest, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
    const raw  = (data.content && data.content[0] && data.content[0].text) || '';
    const parsed = parseCoachJson(raw) || narrativeFallbackCard(digest);
    renderNarrative(out, parsed);
    btn.textContent = 'Done';
  } catch (err) {
    // LLM failed — show deterministic structured fallback and re-enable the button.
    renderNarrative(out, narrativeFallbackCard(digest));
    btn.disabled = false;
    btn.textContent = 'Coach: how did you play?';
  }
}
export { wireReviewHandlers, handleCoachNarrative };
