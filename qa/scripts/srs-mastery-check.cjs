// Throwaway harness for ReviewSRS + Mastery (pure modules).
const SRS = require('../../js/review-srs.js');
const Mastery = require('../../js/mastery.js');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };
const DAY = 86400000, now = Date.parse('2026-06-09T12:00:00Z');
const ago = (d) => new Date(now - d * DAY).toISOString();

// ---- ReviewSRS ----
ok(SRS.box({ attemptLog: [{ outcome: 'solved' }, { outcome: 'solved' }, { outcome: 'solved' }] }) === 3, 'box counts consecutive solves');
ok(SRS.box({ attemptLog: [{ outcome: 'solved' }, { outcome: 'failed' }] }) === 0, 'a fail resets the box');
ok(SRS.box({ solved: true }) === 1, 'falls back to solved flag (no log)');
ok(SRS.box(undefined) === 0, 'no record -> box 0');

// failed yesterday -> due now (box 0, interval 0)
ok(SRS.isDue({ attempts: 1, attemptLog: [{ outcome: 'failed' }], lastAt: ago(1) }, now) === true, 'failed miss is due');
// solved once, 0 days ago -> box 1 interval 1d -> NOT due
ok(SRS.isDue({ attempts: 1, solved: true, attemptLog: [{ outcome: 'solved' }], lastAt: ago(0) }, now) === false, 'just-solved not due yet');
// solved once, 2 days ago -> box1 interval 1d -> due
ok(SRS.isDue({ attempts: 1, solved: true, attemptLog: [{ outcome: 'solved' }], lastAt: ago(2) }, now) === true, 'solved>interval is due');
// never attempted -> never due
ok(SRS.isDue(undefined, now) === false, 'unattempted is not "review"');
// box 3 (interval 7d) solved 3 days ago -> NOT due (spaced out)
ok(SRS.isDue({ attempts: 3, solved: true, attemptLog: [{ outcome: 'solved' }, { outcome: 'solved' }, { outcome: 'solved' }], lastAt: ago(3) }, now) === false, 'mastered pattern spaced out');

const puzzles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const attempts = {
  a: { attempts: 1, attemptLog: [{ outcome: 'failed' }], lastAt: ago(1) },          // due, box0
  b: { attempts: 2, solved: true, attemptLog: [{ outcome: 'solved' }], lastAt: ago(5) }, // due, box1
  c: { attempts: 1, solved: true, attemptLog: [{ outcome: 'solved' }], lastAt: ago(0) }, // not due
  // d: never attempted -> excluded
};
const q = SRS.buildQueue(puzzles, attempts, now, 10);
ok(q.length === 2, 'queue has the 2 due (excludes unattempted + not-yet-due): ' + q.length);
ok(q[0].id === 'a', 'weakest box (failed) surfaces first');

// ---- Mastery ----
const mistakes = [];
for (let i = 0; i < 6; i++) mistakes.push({ id: 'f' + i, motif: 'fork' });
for (let i = 0; i < 3; i++) mistakes.push({ id: 'p' + i, motif: 'pin' });
const att = {};
mistakes.filter(m => m.motif === 'fork').forEach(m => att[m.id] = { solved: true });
mistakes.filter(m => m.motif === 'pin').forEach(m => att[m.id] = { solved: true });
const M = Mastery.markers({ attempts: att, mistakes, rating: 1085, streak: { current: 8, longest: 8 }, egResults: { e1: { lastResult: 'win' } } });
const ids = M.map(m => m.id);
ok(ids.includes('motif:fork'), 'fork mastered (>=5 solved)');
ok(!ids.includes('motif:pin'), 'pin NOT mastered (only 3): ' + ids.join(','));
ok(ids.includes('rating:1000'), 'climbed past 1000');
ok(ids.includes('streak:7'), '7-day streak milestone');
ok(ids.includes('endgame:first'), 'endgame converted');
ok(ids.includes('fixed:10') === false && ids.some(x => x.startsWith('fixed:')) === false, 'only 9 fixed -> no 10+ milestone');

const diff = Mastery.diffSeen(M, ['rating:1000']);
ok(diff.fresh.length === M.length - 1, 'diffSeen flags the new ones (' + diff.fresh.length + ')');
ok(diff.seen.length === M.length, 'next seen set covers all earned');

console.log('\nSample milestones:', M.map(m => m.label).join(' · '));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
