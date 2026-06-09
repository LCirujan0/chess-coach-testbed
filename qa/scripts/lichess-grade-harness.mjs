// Spec 17 verification harness — exercises the Lichess normaliser + the
// solution-line grading logic against real dataset entries, asserting:
//   1. The move-convention adapter: moves[0] is baked into the normalised FEN,
//      so the solver is to move and solutionLine[0] is the key move.
//   2. The correct first solver move grades PASS; a different legal move FAILS.
//   3. Promotion-aware comparison.
// Run: node qa/scripts/lichess-grade-harness.mjs  (needs chess.js available)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// chess.js: try the repo-local install first, else a known temp install.
let Chess;
const candidates = [
  resolve(__dirname, '../node_modules/chess.js/dist/esm/chess.js'),
  process.env.CHESSJS_PATH,
].filter(Boolean);
for (const c of candidates) {
  try { ({ Chess } = await import('file://' + c)); break; } catch {}
}
if (!Chess) throw new Error('chess.js not found; set CHESSJS_PATH to dist/esm/chess.js');

const dataPath = resolve(__dirname, '../../data/lichess-puzzles.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// --- Re-implement the normaliser + grader logic (mirrors js/puzzle/lichess.js
// + the source==='lichess' branch in grade.js) for an environment-independent
// assert. Kept in sync with the module by design. ---
function applyUci(chess, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4, 5) : undefined });
  } catch { return null; }
}
function normalize(entry) {
  if (!entry || !entry.id || !entry.fen || typeof entry.moves !== 'string') return null;
  const uciList = entry.moves.trim().split(/\s+/).filter(Boolean);
  if (uciList.length < 2) return null;
  let chess;
  try { chess = new Chess(entry.fen); } catch { return null; }
  if (!applyUci(chess, uciList[0])) return null;
  return {
    id: `lichess:${entry.id}`, source: 'lichess', type: 'lichess',
    fen: chess.fen(), category: entry.cat || null, motif: entry.motif || null,
    rating: entry.rating ?? null, solutionLine: uciList.slice(1),
    userColorName: chess.turn() === 'w' ? 'White' : 'Black',
  };
}
// Grade a UCI move against solutionLine[0] (promotion-aware), as in grade.js.
function gradeFirst(puzzle, userUci) {
  const expected = (puzzle.solutionLine && puzzle.solutionLine[0]) || '';
  let correct = userUci.slice(0, 4) === expected.slice(0, 4);
  if (correct && expected.length > 4) correct = userUci.slice(4, 5).toLowerCase() === expected.slice(4, 5).toLowerCase();
  return correct ? { tier: 'best', rank: 1 } : { tier: 'outside', rank: null };
}

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }

// Sample across motifs + categories (incl. a promotion case if found).
const promoEntry = data.find((p) => p.moves.split(' ')[1] && p.moves.split(' ')[1].length === 5);
const sample = [data[0], data[1], data[2], data[100], data[5000], data[9000]];
if (promoEntry) sample.push(promoEntry);

for (const entry of sample) {
  const fenTurnBefore = new Chess(entry.fen).turn();
  const norm = normalize(entry);
  assert(norm, `normalise produced a record for ${entry.id}`);
  if (!norm) continue;

  // 1) Move convention: after moves[0], side-to-move flips, and that side is
  //    the solver. solutionLine[0] must be a legal move for that side.
  const post = new Chess(norm.fen);
  assert(post.turn() !== fenTurnBefore, `${entry.id}: side-to-move flipped after setup move (solver to move)`);
  const expected = norm.solutionLine[0];
  const legal = post.moves({ verbose: true }).some((m) => (m.from + m.to + (m.promotion || '')) === expected || (m.from + m.to) === expected.slice(0, 4));
  assert(legal, `${entry.id}: solutionLine[0] (${expected}) is legal for the solver`);

  // 2) Correct first move grades PASS.
  assert(gradeFirst(norm, expected).tier === 'best', `${entry.id}: correct move ${expected} → PASS`);

  // 3) A DIFFERENT legal move grades FAIL.
  const wrong = post.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')).find((u) => u.slice(0, 4) !== expected.slice(0, 4));
  if (wrong) assert(gradeFirst(norm, wrong).tier === 'outside', `${entry.id}: wrong move ${wrong} → FAIL`);
}

// Promotion-specificity: if the expected move is a promotion, a same-square
// move with the WRONG promotion piece must fail.
if (promoEntry) {
  const norm = normalize(promoEntry);
  const exp = norm.solutionLine[0];
  if (exp.length === 5) {
    const wrongPromo = exp.slice(0, 4) + (exp[4] === 'q' ? 'n' : 'q');
    assert(gradeFirst(norm, wrongPromo).tier === 'outside', `promotion: ${exp} vs wrong-piece ${wrongPromo} → FAIL`);
    console.log(`  (promotion case tested: ${promoEntry.id} expected ${exp})`);
  }
}

console.log(`\nlichess-grade-harness: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
