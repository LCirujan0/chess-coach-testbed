// ============================================================================
// SECTION 3 — DOM helpers + Nav drawer
// ============================================================================
import { state } from './state.js';

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
// asks for clean prose, but this guarantees it.
export function sanitiseCoachText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/(^|\s)\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2') // *italic* → italic
    .replace(/[—–]/g, ',')              // em/en dash → comma
    .replace(/\s{2,}/g, ' ')             // collapse double spaces left behind
    .replace(/\s+,/g, ',')               // ", " not " ,"
    .trim();
}

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
export function appendCoachReview(review) {
  const log = $('coach-log');
  const placeholders = log.querySelectorAll('.msg.system, .typing-indicator');
  placeholders.forEach(p => p.remove());
  const wrap = document.createElement('div');
  wrap.className = 'msg review';
  // [lead] — headline verdict (sanitised against accidental markdown).
  const lead = document.createElement('div');
  lead.className = 'rv-lead';
  lead.textContent = sanitiseCoachText(review.lead || '');
  wrap.appendChild(lead);
  // [points] — 2–4 labelled lines. Labels come from the parser (varies by
  // review type: per-puzzle / per-game / aggregated per §17). Sentiment tones
  // apply when supplied; default = --muted.
  if (Array.isArray(review.points) && review.points.length) {
    const pts = document.createElement('div');
    pts.className = 'rv-points';
    for (const p of review.points.slice(0, 4)) {           // hard cap at 4 per §17
      const row = document.createElement('div');
      row.className = 'rv-point' + (p.tone ? ' tone-' + p.tone : '');
      const lab = document.createElement('div');
      lab.className = 'rv-label';
      lab.textContent = String(p.label || '').slice(0, 24);  // protect column
      const txt = document.createElement('div');
      txt.className = 'rv-text';
      txt.textContent = sanitiseCoachText(p.text || '');
      row.appendChild(lab); row.appendChild(txt);
      pts.appendChild(row);
    }
    wrap.appendChild(pts);
  }
  // [turn] — optional turning-point / pattern chip.
  if (review.turn && (review.turn.label || review.turn.text)) {
    const chip = document.createElement('div');
    chip.className = 'rv-turn';
    if (review.turn.label) {
      const lbl = document.createElement('span');
      lbl.className = 'rv-turn-label';
      lbl.textContent = sanitiseCoachText(review.turn.label) + ' —';
      chip.appendChild(lbl);
      chip.appendChild(document.createTextNode(' ' + sanitiseCoachText(review.turn.text || '')));
    } else {
      chip.textContent = sanitiseCoachText(review.turn.text);
    }
    wrap.appendChild(chip);
  }
  // [question] — one reflective question.
  if (review.question) {
    const q = document.createElement('div');
    q.className = 'rv-question';
    q.textContent = sanitiseCoachText(review.question);
    wrap.appendChild(q);
  }
  // [cta] — optional row of action buttons (Drill / Replay etc.).
  if (Array.isArray(review.cta) && review.cta.length) {
    const ctaRow = document.createElement('div');
    ctaRow.className = 'rv-cta';
    for (const c of review.cta.slice(0, 2)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = c.primary ? 'primary' : '';
      b.textContent = c.label || '';
      if (typeof c.action === 'function') b.addEventListener('click', c.action);
      ctaRow.appendChild(b);
    }
    wrap.appendChild(ctaRow);
  }
  // Optional grounded footnote (§17 muted 11px).
  if (review.grounded) {
    const g = document.createElement('div');
    g.className = 'rv-grounded';
    g.textContent = sanitiseCoachText(review.grounded);
    wrap.appendChild(g);
  }
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}

// Parse the LLM's response into the §17 review shape. The prompt requests
// strict JSON; we tolerate code-fence wrapping and prose preambles in case the
// model adds them. Returns null when the response isn't recognisably structured
// — callers fall back to the plain bubble in that case rather than erroring.
export function parseReviewMessage(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip a leading ```json … ``` or ``` … ``` fence if present.
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/);
  if (fence) body = fence[1].trim();
  // Find the outermost JSON object — first '{' to its matching '}'.
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  let parsed;
  try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  // Sanity-check the shape. lead + question are mandatory; points may be empty
  // (the review will still render with just a headline + question).
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.lead !== 'string' || typeof parsed.question !== 'string') return null;
  if (parsed.points && !Array.isArray(parsed.points)) return null;
  return parsed;
}

export function clearCoachLog() {
  $('coach-log').innerHTML = '<div class="msg system">Type a question below or tap Hint for a nudge.</div>';
  state.coachHistory = [];
}
