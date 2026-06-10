// calculation-check.cjs — headless invariant checks for the Spec 25 generators.
//   node qa/scripts/calculation-check.cjs   (from repo root, no server needed)
// Dynamic-imports the vendored chess.js + the pure generators module and runs
// many randomized reps of both drills, verifying every claim a question makes.
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

(async () => {
  const root = path.join(__dirname, '..', '..');
  const { Chess } = await import(pathToFileURL(path.join(root, 'js', 'vendor', 'chess-1.4.0.js')).href);
  const gen = await import(pathToFileURL(path.join(root, 'js', 'calculation', 'generators.js')).href);
  const G = gen.makeGenerators(Chess);
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'data', 'lichess-puzzles.json'), 'utf8'));

  let fail = 0;
  const ok = (name, cond) => { if (cond) return; fail++; console.error('FAIL:', name); };

  // ---- Follow the line: 60 reps across all levels ----
  for (let i = 0; i < 60; i++) {
    const level = (i % 3) + 1;
    const q = G.genLine(pack, level);
    ok('line: generator returns a question', !!q);
    if (!q) continue;
    ok('line: narrated plies match the level', q.moves.length === gen.LINE_CHAIN[level]);
    ok('line: start position is valid', (() => { try { new Chess(q.startFen); return true; } catch { return false; } })());
    ok('line: question has 2+ options incl. the answer', q.question.options.length >= 2 && q.question.options.includes(q.question.answer));
    // Re-derive the answer independently from the final position.
    const c = new Chess(q.finalFen);
    if (q.question.mode === 'tap') {
      const pc = c.get(q.question.answer);
      const last = q.moves[q.moves.length - 1];
      ok('line: the named piece really stands on the answer square', !!pc && pc.type === last.piece && pc.color === last.color);
      ok('line: tap options are unique squares', new Set(q.question.options).size === q.question.options.length);
    } else {
      ok('line: check answer matches the final position', q.question.answer === (c.inCheck() ? 'Yes' : 'No'));
    }
    // The solver moves first in the narrated line (their perspective).
    ok('line: user is to move at the start', new Chess(q.startFen).turn() === q.userColor);
    // No em dashes in any user-facing string (rule 12).
    const text = JSON.stringify(q.moves) + q.question.prompt;
    ok('line: no em/en dashes in copy', !/[—–]/.test(text));
  }

  // ---- Count the forcers: 60 reps across both kinds ----
  const fens = pack.slice(0, 300).map((p) => p.fen);
  for (let i = 0; i < 60; i++) {
    const kind = i % 2 === 0 ? 'checks' : 'captures';
    const q = G.genForcers(fens, kind);
    ok('forcers: generator returns a question', !!q);
    if (!q) continue;
    const c = new Chess(q.fen);
    const all = c.moves({ verbose: true });
    const n = kind === 'checks'
      ? all.filter((m) => /[+#]/.test(m.san)).length
      : all.filter((m) => m.flags.includes('c') || m.flags.includes('e')).length;
    ok('forcers: answer equals the true count', q.answer === String(n));
    ok('forcers: answer is among the options', q.options.includes(q.answer));
    ok('forcers: options are unique and non-negative', new Set(q.options).size === q.options.length && q.options.every((o) => +o >= 0));
    ok('forcers: prompt names the side to move', q.prompt.startsWith(c.turn() === 'w' ? 'White' : 'Black'));
    ok('forcers: grade accepts the true answer', G.grade(q, q.answer) && !G.grade(q, '99'));
  }

  console.log(fail ? `${fail} FAILED` : 'OK: all calculation generator checks passed (120 randomized reps)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
