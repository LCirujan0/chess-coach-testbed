import { $, escapeHtml } from './dom.js';
// ---- Coach game review + drill (per-game) -------------------------------
async function reviewGameWithCoach(gameUrl, outEl, btn) {
  let all = [];
  try { all = JSON.parse(localStorage.getItem('chess-coach-mistakes-v1') || '[]') || []; } catch {}
  const ms = all.filter((m) => m.gameUrl === gameUrl || (m.id || '').startsWith(gameUrl + '|'));
  outEl.classList.remove('hidden');
  if (!ms.length) { outEl.textContent = 'No saved mistakes for this game.'; return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Reviewing…';
  outEl.textContent = 'Coach is reviewing this game…';
  const digest = ms.map((m) => ({ move: m.fullmove, you: m.userMoveSan, best: m.bestMoveSan, cpLoss: m.cpLoss, severity: m.severity, phase: m.category, motif: m.motif || null }));
  const SYS = [
    "You are a warm chess coach reviewing ONE of the student's games, given the list of their mistakes (JSON).",
    'Give a short review (3-5 sentences): name the recurring theme across these mistakes, the single most costly moment, and one thing to work on next.',
    'Refer to moves by their move number and SAN. Use only the data given; do not invent moves. Plain prose only — no markdown, no lists, no em-dashes.',
  ].join('\n');
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, system: SYS, messages: [{ role: 'user', content: 'MISTAKES:\n' + JSON.stringify(digest, null, 2) }] }) });
    const data = await r.json();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = ((data.content && data.content[0] && data.content[0].text) || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[—–]/g, ',').trim();
    const drills = ms.map((m) => `<a class="btn-drill-one" href="/puzzle.html?drill=${encodeURIComponent(m.id)}">Drill move ${m.fullmove}: ${escapeHtml(m.userMoveSan)}</a>`).join('');
    outEl.innerHTML = `<div class="coach-review-text">${escapeHtml(txt || '(no review)')}</div><div class="coach-review-drills">${drills}</div>`;
  } catch (e) { outEl.textContent = 'Coach unavailable right now.'; }
  finally { btn.disabled = false; btn.textContent = old; }
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

// Deterministic fallback — zero tokens. Reads focus_ranked[0] and returns a
// plain-English reason string. Shown immediately when data is thin OR when
// the LLM call fails.
function fallbackReason(d) {
  const ATTR_NAMES = {
    tactical_patterns: 'tactics', endgame_technique: 'endgames',
    opening_principles: 'openings', king_safety: 'king safety',
    piece_activity: 'piece activity', pawn_structure: 'pawn structure',
    calculation: 'calculation',
  };
  if (!d || !d.focus_ranked || !d.focus_ranked.length) {
    return 'Not enough data yet to call your biggest weakness. Solve a few more puzzles and ingest a game or two, and your focus will sharpen.';
  }
  const top = d.focus_ranked[0];
  const name = ATTR_NAMES[top.attribute] || top.attribute;
  const sess = d.session ? ` Today: ${d.session.title} (${d.session.count} puzzles).` : '';
  return `Your weakest area right now is ${name} (${top.tier}, scoring ${Math.round(top.score)}/100).${sess}`;
}

// Build stores from localStorage (same as Insights), call computeCoachView()
// + buildDigest(), then fire Prompt A. Falls back to fallbackReason() if the
// LLM call fails or data is thin. On-demand only — never auto-fires.
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
    out.textContent = fallbackReason(digest);
    out.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Coach: how did you play?';
    return;
  }

  // Prompt A — "how you played": narrate the worst phase/pattern from numbers.
  const r = digest.rating || 950;
  const PROMPT_A_SYSTEM = [
    `You are a chess coach reviewing a student's recent games. They are rated approximately ${r} on Chess.com rapid, targeting 1500.`,
    '',
    'You are given a DIGEST (JSON) of structured scorecard data. Ground EVERY claim ONLY in these numbers.',
    '',
    'HARD RULES:',
    '- Do NOT re-rank priorities.',
    '- Do NOT invent any chess fact, move, opening name, or piece name. Use only what the DIGEST provides.',
    '- Do NOT reveal a puzzle answer. There is no position here at all.',
    '- Name the ONE recurring pattern that costs the most: the phase + theme from focus_ranked.',
    '- Say plainly what it is and why it loses points. 3-5 sentences.',
    '- If focus_ranked is empty (still calibrating): say there is not enough data yet, suggest ingesting more games.',
    '',
    'Humanise attribute keys: tactical_patterns→tactics, endgame_technique→endgames, opening_principles→openings, king_safety→king safety, piece_activity→piece activity, pawn_structure→pawn structure, calculation→calculation.',
    '',
    'Output: plain prose only. No markdown, no lists, no em-dashes, no preamble.',
  ].join('\n');

  try {
    const resp = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: PROMPT_A_SYSTEM,
        messages: [{ role: 'user', content: 'DIGEST:\n' + JSON.stringify(digest, null, 2) }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
    const raw  = (data.content && data.content[0] && data.content[0].text) || '';
    const text = raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[—–]/g, ',').replace(/\s{2,}/g, ' ').trim();
    out.textContent = text || fallbackReason(digest);
    out.style.display = '';
    btn.textContent = 'Done';
  } catch (err) {
    // LLM failed — show deterministic fallback and re-enable the button.
    out.textContent = fallbackReason(digest);
    out.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Coach: how did you play?';
  }
}
export { wireReviewHandlers, handleCoachNarrative };
