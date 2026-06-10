// ============================================================================
// js/calculation/generators.js. Spec 25 calculation drill generators.
// ----------------------------------------------------------------------------
// Pure and node-testable: no DOM, no storage, and no direct chess.js import.
// makeGenerators(Chess) takes the chess.js constructor (the boot passes the
// vendored one; the qa harness dynamic-imports the same file), so every
// generator is exercised headless in qa/scripts/calculation-check.cjs.
//
// Two v1 formats (spec 25, owner approved "go ahead with your suggestions"):
//  1. Follow the line. A real Lichess-pack position, the forced sequence told
//     in plain words (verbal, NOT arrows: arrows would let the eye follow the
//     board and skip the visualisation work). Board frozen at the start.
//     Question: tap where a piece ends up, or "is the king in check?".
//  2. Count the forcers. A position from the user's own games (pack fallback),
//     20 seconds: how many checks (or captures) are available right now.
//     Trains the CCTO scan of the thinking gate as a speed skill.
// ============================================================================

export const LINE_LEVELS = 3;
export const LINE_CHAIN = { 1: 2, 2: 3, 3: 4 };   // narrated plies per level
export const LINE_REPS = 6;
export const LINE_PASS = 0.8;
export const FORCER_REPS = 8;
export const FORCER_SECS = 20;                     // per-question cap (spec)

export const shuffle = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function makeGenerators(Chess) {

  // ---- plain-words narration for one chess.js verbose move ----------------
  function describeMove(m, userColor) {
    const who = m.color === userColor ? 'Your' : 'Their';
    const pc = PIECE_WORD[m.piece] || 'piece';
    if (m.san === 'O-O') return { who, text: who.toLowerCase() === 'your' ? 'You castle short' : 'They castle short' };
    if (m.san === 'O-O-O') return { who, text: who.toLowerCase() === 'your' ? 'You castle long' : 'They castle long' };
    const takes = m.flags.includes('c') || m.flags.includes('e');
    let text = `${who} ${pc} ${takes ? 'takes on' : 'goes to'} ${m.to}`;
    if (m.flags.includes('p')) text += ` and promotes to a ${PIECE_WORD[m.promotion] || 'queen'}`;
    // piece = what stands on the square AFTER the move (a promotion leaves the
    // promoted piece there, not a pawn). The question copy uses this too.
    return { who, text, color: m.color, piece: m.flags.includes('p') ? (m.promotion || 'q') : m.piece, to: m.to };
  }

  // ---- Follow the line -----------------------------------------------------
  // pack entries: { fen, moves: 'uci uci ...' }. Lichess convention: fen is
  // BEFORE the opponent's setup move; moves[0] is that setup, the rest is the
  // forced line. We show the position after the setup and narrate `chain`
  // plies from there.
  function genLine(pack, level) {
    const chain = LINE_CHAIN[level] || 2;
    for (let tries = 0; tries < 60; tries++) {
      const p = pick(pack);
      const uci = String(p.moves || '').trim().split(/\s+/);
      if (uci.length < 1 + chain) continue;
      let c;
      try { c = new Chess(p.fen); } catch { continue; }
      const apply = (u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      try { if (!apply(uci[0])) continue; } catch { continue; }
      const startFen = c.fen();
      const userColor = c.turn();             // the solver is to move first
      const moves = [];
      let legal = true;
      for (let i = 1; i <= chain; i++) {
        let m; try { m = apply(uci[i]); } catch { m = null; }
        if (!m) { legal = false; break; }
        moves.push(describeMove(m, userColor));
      }
      if (!legal || moves.length !== chain) continue;
      const finalFen = c.fen();

      // Question. Mostly "tap where it ends up" (about the LAST mover, the
      // full line must be replayed mentally to keep the squares straight);
      // sometimes the check question, graded from the true final position.
      const last = moves[moves.length - 1];
      let question;
      if (last.to && Math.random() < 0.7) {
        const answer = last.to;
        const decoys = new Set();
        for (const m of moves) if (m.to && m.to !== answer) decoys.add(m.to);
        // pad with neighbours of the answer square
        const f = answer.charCodeAt(0) - 97, r = +answer[1];
        for (const [df, dr] of shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]])) {
          if (decoys.size >= 3) break;
          const nf = f + df, nr = r + dr;
          if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) decoys.add(String.fromCharCode(97 + nf) + nr);
        }
        question = {
          mode: 'tap',
          prompt: `At the end of the line, where does ${last.who.toLowerCase() === 'your' ? 'your' : 'their'} ${PIECE_WORD[last.piece]} stand? Tap the square.`,
          options: shuffle([answer, ...[...decoys].slice(0, 3)]),
          answer,
        };
      } else {
        const sideWord = c.turn() === 'w' ? 'White' : 'Black';
        question = {
          mode: 'choice',
          prompt: `After the last move, is ${sideWord}'s king in check?`,
          options: ['Yes', 'No'],
          answer: c.inCheck() ? 'Yes' : 'No',
        };
      }
      return { drill: 'line', level, startFen, finalFen, userColor, moves, question };
    }
    return null;
  }

  // ---- Count the forcers ---------------------------------------------------
  // fens: the supply (own-game mistake FENs first, pack FENs as fallback).
  // kind alternates between 'checks' and 'captures' per rep.
  function genForcers(fens, kind) {
    for (let tries = 0; tries < 60; tries++) {
      const fen = pick(fens);
      let c;
      try { c = new Chess(fen); } catch { continue; }
      if (c.isGameOver()) continue;
      const all = c.moves({ verbose: true });
      const n = kind === 'checks'
        ? all.filter((m) => /[+#]/.test(m.san)).length
        : all.filter((m) => m.flags.includes('c') || m.flags.includes('e')).length;
      if (n > 9) continue;                       // unreadable outliers
      if (n === 0 && Math.random() < 0.6) continue; // zeros allowed, but rare
      const sideWord = c.turn() === 'w' ? 'White' : 'Black';
      const opts = new Set([n]);
      for (const d of shuffle([1, -1, 2, -2, 3])) { if (opts.size >= 4) break; if (n + d >= 0) opts.add(n + d); }
      return {
        drill: 'forcers', fen, kind,
        sideWord,
        orientation: c.turn(),
        prompt: `${sideWord} to move. How many ${kind === 'checks' ? 'checks' : 'captures'} can ${sideWord} play right now?`,
        options: shuffle([...opts]).map(String),
        answer: String(n),
      };
    }
    return null;
  }

  function grade(q, given) { return String(given) === String(q.answer); }

  return { genLine, genForcers, grade, describeMove };
}
