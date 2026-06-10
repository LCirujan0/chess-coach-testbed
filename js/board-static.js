// ============================================================================
// js/board-static.js — canonical STATIC board renderer (redesign-spec §22).
//
// One shared component for every NON-interactive board: endgame Judge it
// (endgame-recognition.html), board vision, game review (Spec 11), onboarding.
// Emits exactly the same markup contract as the interactive renderer in
// js/puzzle/board.js (.square / .light|.dark / .pc-img / .coord) so a single
// stylesheet — css/board.css — styles them all. No page renders its own board.
//
// Pure FEN → DOM. No engine, no Stockfish, no localStorage, no prompt surface
// (§12-safe). Depends on nothing but the DOM and the Celtic piece assets.
// ============================================================================

const FILES_STD = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS_STD = ['8', '7', '6', '5', '4', '3', '2', '1'];
const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Canonical Celtic SVG path — identical to js/puzzle/config.js PIECE_IMG.
export const PIECE_IMG = (color, type) => `/piece/celtic/${color}${type.toUpperCase()}.svg`;

// Parse the placement field of a FEN into board[rank][file] where rank 0 = the
// 8th rank (a8..h8) and file 0 = the a-file. Mirrors chess.js board() ordering
// so the light/dark parity below matches js/puzzle/board.js exactly.
function parsePlacement(fen) {
  const placement = String(fen || '').split(' ')[0];
  const rows = placement.split('/');
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    const rank = rows[r] || '';
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        for (let n = 0; n < parseInt(ch, 10); n++) row.push(null);
      } else {
        const color = ch === ch.toLowerCase() ? 'b' : 'w';
        row.push({ color, type: ch.toLowerCase() });
      }
    }
    while (row.length < 8) row.push(null);
    board.push(row);
  }
  return board;
}

// Render a static position into boardEl. opts:
//   orientation : 'w' (default, white at bottom) | 'b'
//   lastMove    : { from, to } squares to highlight (optional)
// The element should be a <div class="board"> styled by css/board.css.
export function renderStaticBoard(boardEl, fen, opts = {}) {
  if (!boardEl) return;
  const orientation = opts.orientation === 'b' ? 'b' : 'w';
  const lastMove = opts.lastMove || null;
  const files = orientation === 'b' ? [...FILES_STD].reverse() : FILES_STD;
  const ranks = orientation === 'b' ? [...RANKS_STD].reverse() : RANKS_STD;
  const board = parsePlacement(fen);

  const frag = document.createDocumentFragment();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = files[f] + ranks[r];
      const stdRank = RANKS_STD.indexOf(ranks[r]);
      const stdFile = FILES_STD.indexOf(files[f]);
      const piece = board[stdRank][stdFile];

      const sq = document.createElement('div');
      sq.className = 'square ' + (((stdRank + stdFile) % 2 === 0) ? 'light' : 'dark');
      sq.dataset.square = square;
      if (piece) sq.dataset.c = piece.color;
      // A11y (2026-06-10 audit): name every square for screen readers —
      // "e4, white knight" / "e5, empty". Display is unchanged.
      sq.setAttribute('role', 'img');
      sq.setAttribute('aria-label', square + (piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAME[piece.type] || piece.type}` : ', empty'));
      if (lastMove && (lastMove.from === square || lastMove.to === square)) sq.classList.add('last-move');

      // In-square coordinates: files on the bottom rank, ranks on the left file.
      if (r === 7) { const lbl = document.createElement('span'); lbl.className = 'coord file'; lbl.textContent = files[f]; sq.appendChild(lbl); }
      if (f === 0) { const lbl = document.createElement('span'); lbl.className = 'coord rank'; lbl.textContent = ranks[r]; sq.appendChild(lbl); }

      if (piece) {
        const img = document.createElement('img');
        img.className = 'pc-img';
        img.src = PIECE_IMG(piece.color, piece.type);
        img.alt = PIECE_GLYPH[piece.type] || (piece.color + piece.type);
        img.draggable = false;
        sq.appendChild(img);
      }
      frag.appendChild(sq);
    }
  }
  boardEl.replaceChildren(frag);
  // Spec 19 — when this render reflects a single played move (animate + lastMove),
  // slide the moved piece from its origin to its destination instead of teleporting.
  if (opts.animate && lastMove && lastMove.from && lastMove.to) {
    animateMoveFLIP(boardEl, lastMove.from, lastMove.to);
  }
}

// ============================================================================
// Spec 19 — FLIP piece-slide animation (shared by the static board AND the
// interactive puzzle board). Pure presentation: no engine, no state, §12-safe.
// Computes purely from the NEW DOM (both squares exist post-render), so it needs
// no snapshot of the prior position — the grid is fixed, only pieces move.
// ============================================================================
const SLIDE_MS = 210;

export function animateMoveFLIP(boardEl, from, to) {
  if (!boardEl || !from || !to || from === to) return;
  // Respect the user's reduced-motion preference — no slide, instant render.
  if (typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fromSq = boardEl.querySelector(`.square[data-square="${from}"]`);
  const toSq = boardEl.querySelector(`.square[data-square="${to}"]`);
  if (!fromSq || !toSq) return;
  const img = toSq.querySelector('.pc-img');
  if (!img) return;
  const fr = fromSq.getBoundingClientRect();
  const tr = toSq.getBoundingClientRect();
  const dx = fr.left - tr.left;
  const dy = fr.top - tr.top;
  if (!dx && !dy) return;
  // First/Invert: place the moved piece visually back on its origin square.
  img.style.transition = 'none';
  img.style.transform = `translate(${dx}px, ${dy}px)`;
  img.style.zIndex = '5';
  img.style.willChange = 'transform';
  void img.offsetWidth; // force reflow so the inverted transform is committed
  // Play: next frame, transition to the real (destination) position.
  requestAnimationFrame(() => {
    // Smooth ease-out glide (decelerate into the destination square).
    img.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2,.72,.24,1)`;
    img.style.transform = 'translate(0, 0)';
  });
  const cleanup = () => {
    img.style.transition = '';
    img.style.transform = '';
    img.style.zIndex = '';
    img.style.willChange = '';
    img.removeEventListener('transitionend', cleanup);
  };
  img.addEventListener('transitionend', cleanup);
  // Safety net in case transitionend doesn't fire (e.g. element re-rendered).
  setTimeout(cleanup, SLIDE_MS + 80);
}
