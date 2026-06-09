// ============================================================================
// coach-widget.js — the reusable, always-present Coach.
// ----------------------------------------------------------------------------
// Mounts a self-contained general-coach chat into any training screen's
// .coach-card elements. Talks to /api/coach (same contract as coach.html).
// Isolated: if the API errors, only a coach bubble shows the error — it never
// affects the exercise running alongside it.
//
//   import { mountCoachWidget } from '/js/coach-widget.js';
//   mountCoachWidget({
//     logEl:  document.getElementById('coach-log'),
//     formEl: document.getElementById('coach-form'),
//     inputEl:document.getElementById('coach-input'),
//     sendEl: document.getElementById('coach-send'),
//     context: 'The user is judging whether a position is winning, drawn or losing.'
//   });
//
// Quick chat replies render as plain bubbles. If the model returns the §17 JSON
// card shape (parseable by parseCoachJson), the reply renders through the ONE
// shared coach card (js/coach-card.js) instead — so a grounded structured read
// looks identical to the puzzle/coach surfaces.
// ============================================================================

import { renderCoachCard, parseCoachJson, sanitiseCoachText, ensureCoachCardStyles } from '/js/coach-card.js';

// Shared voice + style rules. Strengthened to match the puzzle/coach surfaces:
// no markdown, no bullet lists, no em-dashes. The widget never spoils — the
// host supplies position summaries / played moves only (no engine evals or
// best-move ids) via context + getLiveContext (no-spoiler rule, learnings v0.7).
const BASE_SYSTEM = [
  'You are a warm, concise chess coach inside the KnightPath training app.',
  'Guide the student with questions and hints; nudge toward the idea rather than blurting the answer.',
  '',
  'WRITING STYLE — read carefully:',
  '- Conversational. Talk like a friendly coach sitting next to the player, not a textbook.',
  '- Brief. Default to 2 to 4 short sentences. Never pad.',
  '- Use piece names (rook, knight, etc.). Square coordinates only when needed for precision.',
  '- Replace symbols: "with check" not "+", "checkmate" not "#". Never use UCI like e2e4.',
  '- NO em dashes or en dashes. Use commas, full stops, or parentheses instead.',
  '- NO markdown formatting. NO ** for bold, NO * for emphasis, NO bullet lists, NO headers. Plain prose only.',
  '- Address the player as "you", in second person.',
].join('\n');

function bubble(logEl, role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role; // role: system | coach | user | error
  // Coach copy routes through the shared sanitiser so any stray markdown /
  // em-dash the model emitted is cleaned before render. System / user / error
  // copy is our own text and is shown verbatim.
  div.textContent = (role === 'coach') ? sanitiseCoachText(text) : text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

export function mountCoachWidget({ logEl, formEl, inputEl, sendEl, context = '', model = 'claude-sonnet-4-6', getLiveContext = null } = {}) {
  if (!logEl || !formEl || !inputEl || !sendEl) return null;
  // The shared card may render here if the model returns the §17 shape — make
  // sure its styles are available on pages that link neither puzzle.css nor the
  // train.css .rv-* block (idempotent; no-op once injected).
  ensureCoachCardStyles();
  let ratingNote = '';
  try { const rc = JSON.parse(localStorage.getItem('chess-coach-user-rating-v1') || 'null'); if (rc && typeof rc.rating === 'number') ratingNote = ' The student is rated about ' + rc.rating + ' on Chess.com rapid (target 1500); pitch hints to that level.'; } catch {}
  const system = (context ? (BASE_SYSTEM + '\n\nContext: ' + context) : BASE_SYSTEM) + ratingNote;
  const history = [];
  let sending = false;

  const setSending = (v) => { sending = v; sendEl.disabled = v || !inputEl.value.trim(); };
  inputEl.addEventListener('input', () => { sendEl.disabled = sending || !inputEl.value.trim(); });
  sendEl.disabled = true;

  async function send(text) {
    if (sending || !text.trim()) return;
    history.push({ role: 'user', content: text });
    bubble(logEl, 'user', text);
    inputEl.value = '';
    setSending(true);
    const typing = bubble(logEl, 'system', '…');
    // Append a fresh snapshot of the live position/moves (if the host provides
    // one) so the coach can discuss what the student actually played. Read at
    // send time, never cached. No-spoiler rule (learnings.md v0.7): the host
    // supplies played moves + FEN only — never engine evals or best-move IDs.
    let liveSystem = system;
    if (typeof getLiveContext === 'function') {
      try { const extra = getLiveContext(); if (extra) liveSystem += extra; } catch {}
    }
    try {
      const r = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 280, system: liveSystem, messages: history })
      });
      const data = await r.json();
      typing.remove();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const reply = (data.content && data.content[0] && data.content[0].text) || '(no reply)';
      history.push({ role: 'assistant', content: reply });
      // If the model returned the §17 card shape, render the shared structured
      // card; otherwise a plain coach bubble (quick chat stays conversational).
      const parsed = parseCoachJson(reply);
      if (parsed) renderCoachCard(logEl, parsed, { append: true, scroll: true });
      else bubble(logEl, 'coach', reply);
    } catch (err) {
      typing.remove();
      bubble(logEl, 'error', 'Coach unavailable right now.');
    } finally {
      setSending(false);
      inputEl.focus();
    }
  }

  formEl.addEventListener('submit', (e) => { e.preventDefault(); send(inputEl.value); });
  return { send };
}
