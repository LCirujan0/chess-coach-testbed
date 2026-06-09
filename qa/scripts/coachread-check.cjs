// Throwaway harness for CoachStats.coachRead (retention #5).
const CoachStats = require('../../js/coach-stats.js');
let pass = 0, fail = 0;
function ok(cond, msg) { (cond ? pass++ : fail++); if (!cond) console.log('  FAIL:', msg); }

// 1) Rich data → a grounded read; and daily variety across 14 days.
const view = { counts: { games: 20, puzzles: 35 }, focus: [
  { attribute: 'tactical_patterns', score: 40 }, { attribute: 'endgame_technique', score: 55 },
  { attribute: 'king_safety', score: 72 } ] };
const profile = { rapid: { current: 1080, best: 1110, record: { w: 50, l: 40, d: 10 },
  settledness: { known: true, rd: 45, settled: true } }, tactics: 1450 };
const history = Array.from({ length: 18 }, (_, i) => ({ rating: 1040 + i * 2.2, at: '2026-05-' + (i + 1) }));

const reads = new Set();
for (let d = 1; d <= 14; d++) {
  const r = CoachStats.coachRead({ view, profile, history, streak: { current: 5 }, dayKey: '2026-06-' + String(d).padStart(2, '0') });
  ok(r && typeof r.text === 'string' && r.text.length > 0, 'read has text (day ' + d + ')');
  ok(/\d/.test(r.text) || r.kind === 'strength', 'read is grounded in a number or a named strength: ' + r.text);
  reads.add(r.kind);
}
ok(reads.size >= 3, 'varies across days (distinct kinds=' + reads.size + ': ' + [...reads].join(',') + ')');
// same day = stable (not random-on-refresh)
const a = CoachStats.coachRead({ view, profile, history, streak: { current: 5 }, dayKey: '2026-06-09' });
const b = CoachStats.coachRead({ view, profile, history, streak: { current: 5 }, dayKey: '2026-06-09' });
ok(a.text === b.text, 'stable within a day');

// 2) Trajectory up is eligible and reads honestly.
const up = CoachStats.coachRead({ view, profile, history, streak: {}, dayKey: 'force' });
ok(typeof up.text === 'string', 'trajectory present');

// 3) Cold start (no games) → warm, no fake numbers.
const cold = CoachStats.coachRead({ view: { counts: { games: 0, puzzles: 0 }, focus: [] }, profile: {}, history: [], streak: {}, dayKey: 'x' });
ok(cold.kind === 'coldstart' && !/\d/.test(cold.text), 'cold-start has no fabricated numbers: ' + cold.text);

// 4) Down trajectory is constructive, not punitive.
const downHist = Array.from({ length: 12 }, (_, i) => ({ rating: 1100 - i * 3, at: '2026-05-' + (i + 1) }));
let sawDown = false;
for (let d = 1; d <= 14; d++) { const r = CoachStats.coachRead({ view: { counts: { games: 12, puzzles: 0 }, focus: [] }, profile: {}, history: downHist, streak: {}, dayKey: 'd' + d }); if (r.kind === 'trajectory-down') { sawDown = true; ok(!/lose|bad|worse|terrible/i.test(r.text), 'down read is constructive: ' + r.text); } }
ok(sawDown, 'down trajectory surfaces');

console.log('\nSample reads:');
console.log('  rich  :', CoachStats.coachRead({ view, profile, history, streak: { current: 5 }, dayKey: '2026-06-09' }).text);
console.log('  peak  :', CoachStats.coachRead({ view, profile: { rapid: { current: 1110, best: 1110 } }, history: [], streak: {}, dayKey: 'a' }).text);
console.log('  cold  :', cold.text);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
