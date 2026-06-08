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
// ============================================================================

const BASE_SYSTEM =
  "You are a warm, concise chess coach inside the KnightPath training app. " +
  "Guide the student with questions and hints; nudge toward the idea rather " +
  "than blurting the answer. Keep replies short (2-4 sentences).";

function bubble(logEl, role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role; // role: system | coach | user | error
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

export function mountCoachWidget({ logEl, formEl, inputEl, sendEl, context = '', model = 'claude-sonnet-4-6', getLiveContext = null } = {}) {
  if (!logEl || !formEl || !inputEl || !sendEl) return null;
  let ratingNote = '';
  try { const rc = JSON.parse(localStorage.getItem('chess-coach-user-rating-v1') || 'null'); if (rc && typeof rc.rating === 'number') ratingNote = ' The student is rated about ' + rc.rating + ' on Chess.com rapid (target 1500); pitch hints to that level.'; } catch {}
  const system = (context ? (BASE_SYSTEM + ' Context: ' + context) : BASE_SYSTEM) + ratingNote;
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
      bubble(logEl, 'coach', reply);
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
