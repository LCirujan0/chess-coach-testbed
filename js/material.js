// ============================================================================
// material.js — shared, self-contained material-difference indicator.
// ----------------------------------------------------------------------------
// Reads the rendered board (each piece is <img class="pc-img" src=".../wP.svg">,
// so the filename encodes colour+type) and shows the NET on-board material
// advantage in the given element, e.g. "White +3" / "Black +2" / "Even".
//
// Net on-board material is correct for ANY position (constructed endgames,
// recognition positions, real games) — unlike a captured-pieces pile, which
// only makes sense for positions derived from the full starting set.
//
// No engine/state dependency; safe no-op if elements are missing. Mounted per
// page (see docs/training-screen-pattern.md):
//   import { mountMaterial } from '/js/material.js';
//   mountMaterial(document.getElementById('board'),
//                 document.getElementById('material-top'));
// ============================================================================
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function netFromBoard(boardEl) {
  let white = 0, black = 0;
  boardEl.querySelectorAll('img.pc-img').forEach((img) => {
    const m = (img.getAttribute('src') || '').match(/([wb])([PNBRQK])\.svg(?:$|[?#])/i);
    if (!m) return;
    const v = VALUE[m[2].toLowerCase()] || 0;
    if (m[1].toLowerCase() === 'w') white += v; else black += v;
  });
  return white - black;
}

function paint(el, net) {
  if (!el) return;
  if (net > 0) el.innerHTML = '<span class="mb-score">White +' + net + '</span>';
  else if (net < 0) el.innerHTML = '<span class="mb-score">Black +' + (-net) + '</span>';
  else el.innerHTML = '<span class="mb-score mb-even">Even</span>';
}

export function mountMaterial(boardEl, targetEl) {
  if (!boardEl || !targetEl) return null;
  const update = () => paint(targetEl, netFromBoard(boardEl));
  const obs = new MutationObserver(update);
  obs.observe(boardEl, { childList: true, subtree: true });
  update();
  return { update, disconnect: () => obs.disconnect() };
}
