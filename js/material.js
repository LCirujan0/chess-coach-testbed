// ============================================================================
// material.js, shared material-difference indicator. Renders captured pieces
// + net advantage IDENTICALLY to the mistakes screen (board.js mbRowHtml), so
// every training screen shows material the same way. Reads the rendered board
// (<img class="pc-img" src=".../wP.svg">); no engine/state dependency.
//   import { mountMaterial } from '/js/material.js';
//   mountMaterial(boardEl, materialTopEl, materialBottomEl);
// ============================================================================
const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const ORDER = ['q', 'r', 'b', 'n', 'p']; // high -> low value

function scan(boardEl) {
  const onBoard = { w: {}, b: {} };
  let prefix = '/piece/celtic/';
  boardEl.querySelectorAll('img.pc-img').forEach((img) => {
    const m = (img.getAttribute('src') || '').match(/(.*\/)([wb])([PNBRQK])\.svg/i);
    if (!m) return;
    prefix = m[1];
    const c = m[2].toLowerCase(), t = m[3].toLowerCase();
    onBoard[c][t] = (onBoard[c][t] || 0) + 1;
  });
  return { onBoard, prefix };
}

function rowHtml(color, captured, net, prefix) {
  let html = '';
  for (const t of ORDER) {
    const n = captured[t] || 0;
    for (let i = 0; i < n; i++) html += `<img class="mb-piece" src="${prefix}${color}${t.toUpperCase()}.svg" alt="" draggable="false">`;
  }
  if (net > 0) html += `<span class="mb-score">+${net}</span>`;
  return html;
}

function render(boardEl, topEl, botEl) {
  const { onBoard, prefix } = scan(boardEl);
  const capW = {}, capB = {};
  let wCapVal = 0, bCapVal = 0;
  for (const t of ORDER) {
    const cw = START[t] - (onBoard.w[t] || 0); // white pieces missing
    const cb = START[t] - (onBoard.b[t] || 0); // black pieces missing
    if (cw > 0) { capW[t] = cw; wCapVal += cw * VALUE[t]; }
    if (cb > 0) { capB[t] = cb; bCapVal += cb * VALUE[t]; }
  }
  const whiteAdv = bCapVal - wCapVal; // + => White ahead (mirrors board.js)
  topEl.innerHTML = rowHtml('w', capW, whiteAdv < 0 ? -whiteAdv : 0, prefix);
  botEl.innerHTML = rowHtml('b', capB, whiteAdv > 0 ? whiteAdv : 0, prefix);
}

export function mountMaterial(boardEl, topEl, botEl) {
  if (!boardEl || !topEl || !botEl) return null;
  const update = () => render(boardEl, topEl, botEl);
  const obs = new MutationObserver(update);
  obs.observe(boardEl, { childList: true, subtree: true });
  update();
  return { update, disconnect: () => obs.disconnect() };
}
