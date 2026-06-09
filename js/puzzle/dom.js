// ============================================================================
// SECTION 3 — DOM helpers + Nav drawer
// ============================================================================
import { state } from './state.js';
import { renderCoachCard, parseCoachJson, sanitiseCoachText as sharedSanitise } from '/js/coach-card.js';

export const $ = (id) => document.getElementById(id);

export function setInlineStatus(text, cls = '') {
  const el = $('inline-status');
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.className = 'inline-status' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

// Strip markdown bold/italic markers and em dashes from coach output even if
// the model ignores the style instructions. Belt-and-braces: the system prompt
// asks for clean prose, but this guarantees it. The implementation now lives in
// js/coach-card.js (the shared coach renderer) — re-exported here so existing
// importers (puzzle/dom.js consumers) keep working unchanged.
export const sanitiseCoachText = sharedSanitise;

export function appendCoachMessage(role, text) {
  const log = $('coach-log');
  const placeholders = log.querySelectorAll('.msg.system, .typing-indicator');
  // Remove placeholders when a real coach/user/error message arrives
  if (role !== 'system' && role !== 'typing') {
    placeholders.forEach(p => p.remove());
  }
  
  if (role === 'typing') {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return;
  }

  const div = document.createElement('div');
  div.className = 'msg ' + role;
  // System / error messages are our own copy and don't need scrubbing; coach
  // and user messages route through the sanitiser so any stray markdown is
  // cleaned before render.
  div.textContent = (role === 'coach') ? sanitiseCoachText(text) : text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// §17 structured review bubble. Renders headline + labelled points + optional
// turning-point chip + reflective question + optional CTAs into a single coach
// turn. Used by the post-puzzle review (puzzle.html) and — when Spec 05 lands —
// the per-game "how you played" + aggregated read in coach.html / games.html.
// Shape (validated upstream by parseReviewMessage):
//   {
//     lead:      string,                                   // §17 [lead]
//     points:    Array<{label, text, tone?: 'pos'|'warn'|'bad'}>,
//     turn?:     { label: string, text: string } | null,   // §17 [turn] chip
//     question:  string,                                   // §17 [question]
//     cta?:      Array<{label, action: function}> | null,
//     grounded?: string | null,                            // muted footnote
//   }
// Renders into the coach-log so it lives inside the height-capped panel
// (auto-scrolls to the new bubble).
// Delegates the actual card render to the shared renderer in js/coach-card.js
// (the single source of truth) while preserving puzzle.html's Surface-2 coach
// panel behaviour: clear the "system" placeholder + typing indicator first,
// then append the card into #coach-log and auto-scroll to it.
export function appendCoachReview(review) {
  const log = $('coach-log');
  const placeholders = log.querySelectorAll('.msg.system, .typing-indicator');
  placeholders.forEach(p => p.remove());
  return renderCoachCard(log, review, { append: true, scroll: true });
}

// Parse the LLM's response into the §17 review shape. Delegates to the shared
// parser in js/coach-card.js so puzzle.html and every other surface validate
// identically. Returns null when the response isn't recognisably structured —
// callers fall back to the plain bubble in that case rather than erroring.
export function parseReviewMessage(text) {
  return parseCoachJson(text);
}

export function clearCoachLog() {
  $('coach-log').innerHTML = '<div class="msg system">Type a question below or tap Hint for a nudge.</div>';
  state.coachHistory = [];
}
