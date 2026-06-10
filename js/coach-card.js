// ============================================================================
// coach-card.js, the ONE shared structured coach card (§17 review).
// ----------------------------------------------------------------------------
// Single source of truth for the gold-standard coach render across the whole
// app. Previously this card was reimplemented three times (js/puzzle/dom.js
// appendCoachReview, coach.html inline script, js/games/review.js
// renderReviewCard) and the copies drifted. Every surface now delegates here.
//
// Shape (validated by parseCoachJson):
//   {
//     lead:      string,                                   // §17 headline
//     points:    Array<{label, text, tone?: 'pos'|'warn'|'bad'|'muted'}>,
//     turn?:     { label?: string, text: string } | null,  // §17 turning-point chip
//     question:  string,                                   // §17 reflective question
//     cta?:      Array<{label, action?: function, href?: string, primary?: boolean}>,
//     grounded?: string | null,                            // muted footnote
//   }
//
// Render structure (kept identical to the legacy puzzle.html render so the
// existing `.msg.review .rv-*` CSS in puzzle.css applies unchanged):
//   <div class="msg review">
//     <div class="rv-lead">…</div>
//     <div class="rv-points"><div class="rv-point tone-*">…</div>…</div>
//     <div class="rv-turn">…</div>
//     <div class="rv-question">…</div>
//     <div class="rv-cta"><button|a>…</div>
//     <div class="rv-grounded">…</div>
//   </div>
//
// CSS: the canonical `.msg.review .rv-*` rules live in css/puzzle.css (puzzle
// page) and have been mirrored into css/train.css so the pages that link
// train.css (endgames, endgame-recognition, review.html) style the card too.
// For any page that links NEITHER stylesheet (e.g. games.html), call
// ensureCoachCardStyles() once, it injects the same rules into <head>. This
// keeps the card self-sufficient on every surface with zero new style names.
// ============================================================================

// Strip markdown bold/italic markers and em/en dashes from coach output even
// if the model ignores the style instructions. Mirrors js/puzzle/dom.js
// sanitiseCoachText (the canonical scrubber) so every surface cleans identically.
export function sanitiseCoachText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')                       // **bold** → bold
    .replace(/(^|\s)\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')   // *italic* → italic
    .replace(/[, , ]/g, ',')                                 // em/en dash → comma
    .replace(/\s{2,}/g, ' ')                               // collapse double spaces
    .replace(/\s+,/g, ',')                                 // ", " not " ,"
    .trim();
}

// Parse the LLM's response into the §17 card shape. The prompt requests strict
// JSON; we tolerate code-fence wrapping and prose preambles in case the model
// adds them. Returns null when the response isn't recognisably structured, // callers fall back to a plain bubble in that case rather than erroring.
export function parseCoachJson(text) {
  if (!text || typeof text !== 'string') return null;
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/);
  if (fence) body = fence[1].trim();
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
  if (!parsed || typeof parsed !== 'object') return null;
  // lead + question are mandatory; points may be empty (renders headline + Q only).
  if (typeof parsed.lead !== 'string' || typeof parsed.question !== 'string') return null;
  if (parsed.points && !Array.isArray(parsed.points)) return null;
  return parsed;
}

// Render the §17 card into `parentEl`. Returns the wrapper element.
// opts:
//   append:   true (default) appends to parentEl; false replaces its contents.
//   scroll:   true (default) scrolls parentEl to the new card (for coach-log panels).
export function renderCoachCard(parentEl, parsed, opts = {}) {
  if (!parentEl || !parsed) return null;
  const append = opts.append !== false;
  const scroll = opts.scroll !== false;

  const wrap = document.createElement('div');
  wrap.className = 'msg review';

  // [lead], headline verdict.
  const lead = document.createElement('div');
  lead.className = 'rv-lead';
  lead.textContent = sanitiseCoachText(parsed.lead || '');
  wrap.appendChild(lead);

  // [points], up to 4 labelled lines with optional sentiment tones.
  if (Array.isArray(parsed.points) && parsed.points.length) {
    const pts = document.createElement('div');
    pts.className = 'rv-points';
    for (const p of parsed.points.slice(0, 4)) {
      const row = document.createElement('div');
      row.className = 'rv-point' + (p.tone ? ' tone-' + p.tone : '');
      const lab = document.createElement('div');
      lab.className = 'rv-label';
      lab.textContent = String(p.label || '').slice(0, 24);
      const txt = document.createElement('div');
      txt.className = 'rv-text';
      txt.textContent = sanitiseCoachText(p.text || '');
      row.appendChild(lab); row.appendChild(txt);
      pts.appendChild(row);
    }
    wrap.appendChild(pts);
  }

  // [turn], optional turning-point / pattern chip.
  if (parsed.turn && (parsed.turn.label || parsed.turn.text)) {
    const chip = document.createElement('div');
    chip.className = 'rv-turn';
    if (parsed.turn.label) {
      const lbl = document.createElement('span');
      lbl.className = 'rv-turn-label';
      lbl.textContent = sanitiseCoachText(parsed.turn.label) + ' , ';
      chip.appendChild(lbl);
      chip.appendChild(document.createTextNode(' ' + sanitiseCoachText(parsed.turn.text || '')));
    } else {
      chip.textContent = sanitiseCoachText(parsed.turn.text);
    }
    wrap.appendChild(chip);
  }

  // [question], one reflective question.
  if (parsed.question) {
    const q = document.createElement('div');
    q.className = 'rv-question';
    q.textContent = sanitiseCoachText(parsed.question);
    wrap.appendChild(q);
  }

  // [cta], optional row of action buttons / links (Drill / Replay etc.).
  if (Array.isArray(parsed.cta) && parsed.cta.length) {
    const ctaRow = document.createElement('div');
    ctaRow.className = 'rv-cta';
    for (const c of parsed.cta.slice(0, 2)) {
      // A CTA with an href renders as a link (deep-link); otherwise a button.
      const el = document.createElement(c.href ? 'a' : 'button');
      if (c.href) {
        el.href = c.href;
      } else {
        el.type = 'button';
        if (typeof c.action === 'function') el.addEventListener('click', c.action);
      }
      el.className = c.primary ? 'primary' : '';
      el.textContent = c.label || '';
      ctaRow.appendChild(el);
    }
    wrap.appendChild(ctaRow);
  }

  // [grounded], optional muted footnote (the source line).
  if (parsed.grounded) {
    const g = document.createElement('div');
    g.className = 'rv-grounded';
    g.textContent = sanitiseCoachText(parsed.grounded);
    wrap.appendChild(g);
  }

  if (append) parentEl.appendChild(wrap);
  else parentEl.replaceChildren(wrap);
  if (scroll) parentEl.scrollTop = parentEl.scrollHeight;
  return wrap;
}

// Inject the canonical `.msg.review .rv-*` rules into <head> exactly once, for
// pages that link neither puzzle.css nor train.css (e.g. games.html). The
// selectors and values are copied verbatim from css/puzzle.css so the rendered
// card is pixel-identical to the puzzle-page review, no new style names.
let _stylesInjected = false;
export function ensureCoachCardStyles() {
  if (_stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById('coach-card-styles')) { _stylesInjected = true; return; }
  const css = `
  .msg.review { align-self: flex-start; background: var(--surface2); border-bottom-left-radius: 4px; padding: 13px 15px; max-width: 92%; font-size: 13.5px; line-height: 1.5; border-radius: 14px; }
  .msg.review .rv-lead { font-family: "Plus Jakarta Sans","Inter",system-ui,sans-serif; font-weight: 800; font-size: 15px; line-height: 1.3; color: var(--ink); margin-bottom: 11px; }
  .msg.review .rv-points { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .msg.review .rv-point { display: grid; grid-template-columns: 70px 1fr; gap: 10px; align-items: baseline; }
  .msg.review .rv-label { font-family: "Plus Jakarta Sans","Inter",system-ui,sans-serif; font-weight: 700; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); line-height: 1.3; }
  .msg.review .rv-point.tone-pos .rv-label { color: var(--pos); }
  .msg.review .rv-point.tone-warn .rv-label { color: var(--warn); }
  .msg.review .rv-point.tone-bad .rv-label { color: var(--bad); }
  .msg.review .rv-text { font-size: 13px; line-height: 1.45; color: var(--ink); }
  .msg.review .rv-turn { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font-size: 12.5px; color: var(--ink); margin-bottom: 10px; }
  .msg.review .rv-turn .rv-turn-label { font-weight: 700; color: var(--muted); margin-right: 4px; }
  .msg.review .rv-question { border-top: 1px solid var(--line); padding-top: 10px; font-style: italic; font-size: 13px; color: var(--ink); }
  .msg.review .rv-cta { display: flex; gap: 9px; margin-top: 11px; }
  .msg.review .rv-cta button, .msg.review .rv-cta a { flex: 1; padding: 8px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; transition: background-color 0.15s ease, filter 0.15s ease; }
  .msg.review .rv-cta button:hover, .msg.review .rv-cta a:hover { background: color-mix(in srgb, var(--surface2) 80%, var(--accent) 20%); }
  .msg.review .rv-cta button.primary, .msg.review .rv-cta a.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .msg.review .rv-grounded { margin-top: 10px; font-size: 11px; color: var(--muted); font-style: italic; }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'coach-card-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  _stylesInjected = true;
}

// Convenience global for classic (non-module) inline scripts. Modules should
// import the named exports above; pages that can only run a classic <script>
// can read window.CoachCard.{renderCoachCard, parseCoachJson, sanitiseCoachText,
// ensureCoachCardStyles}.
if (typeof window !== 'undefined') {
  window.CoachCard = {
    renderCoachCard,
    parseCoachJson,
    sanitiseCoachText,
    ensureCoachCardStyles,
  };
}
