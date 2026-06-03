// ============================================================================
// SECTION 15 — Puzzle screen variants (§31, v0.52, PREVIEW ONLY)
// ============================================================================
// Three distinct full-screen compositions of the post-move puzzle experience,
// switchable on a SINGLE preview URL so Jorge can compare them live on desktop
// and iPhone:
//
//   ?variant=a  Card-led right column with an embedded comparison TABLE.
//   ?variant=b  Scannable move-ROWS (no table chrome); eval as chips.
//   ?variant=c  Compact verdict HERO with a nested comparison/eval panel.
//
// All three set a `data-variant` attribute on the .layout-grid wrapper; every
// variant-specific style is scoped under `[data-variant="x"]` so the variants
// never interfere. The puzzle is fully functional in every variant — this
// module only chooses a CSS skin + (for all variants) physically nests the
// existing #comparison node INSIDE #result so the move-by-move comparison lives
// in the feedback card rather than as a separate accordion. No state-machine or
// localStorage changes.
import { $ } from './dom.js';

const VALID = ['a', 'b', 'c'];

export function initVariants() {
  // 1) Read the variant once on load (default 'a').
  let v = 'a';
  try {
    const p = new URLSearchParams(window.location.search).get('variant');
    if (p && VALID.includes(p.toLowerCase())) v = p.toLowerCase();
  } catch { /* default */ }

  const grid = document.querySelector('.layout-grid');
  if (grid) grid.setAttribute('data-variant', v);

  // 2) Physically nest #comparison inside #result (after the action row) so the
  //    move-by-move comparison is embedded in the feedback card in every
  //    variant. All comparison handlers/ids are preserved (we move the node, we
  //    don't rebuild it), so the click-to-jump + eval gate keep working.
  const result = $('result');
  const comparison = $('comparison');
  if (result && comparison && comparison.parentElement !== result) {
    result.appendChild(comparison);
    // The standalone mobile accordion header is redundant once embedded; the
    // comparison now lives inside the card and shows/hides with it.
    comparison.classList.remove('acc-collapsed');
    const head = comparison.querySelector('.acc-head');
    if (head) head.style.display = 'none';
  }

  // 3) On-screen switcher so a single preview URL toggles all three live.
  buildSwitcher(grid, v);
}

function buildSwitcher(grid, current) {
  if (document.getElementById('variant-switcher')) return;
  const bar = document.createElement('div');
  bar.id = 'variant-switcher';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Preview variant');
  bar.innerHTML =
    '<span class="vs-label">Variant</span>' +
    VALID.map((k) =>
      `<button type="button" class="vs-btn${k === current ? ' active' : ''}" data-v="${k}">${k.toUpperCase()}</button>`
    ).join('');
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.vs-btn');
    if (!btn) return;
    const k = btn.dataset.v;
    if (grid) grid.setAttribute('data-variant', k);
    for (const b of bar.querySelectorAll('.vs-btn')) b.classList.toggle('active', b.dataset.v === k);
    // Keep the URL shareable/refresh-stable without reloading.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', k);
      window.history.replaceState({}, '', url);
    } catch { /* history is best-effort */ }
  });
  document.body.appendChild(bar);
}
