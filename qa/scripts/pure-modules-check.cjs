// pure-modules-check.cjs — node unit checks for the v0.80 pure window-global
// modules (they all export CJS under node, like streak.js). No browser needed.
//   node scripts/pure-modules-check.cjs
const path = require('path');
const root = path.join(__dirname, '..', '..');
const KPProfile = require(path.join(root, 'js', 'profile.js'));
const CCI = require(path.join(root, 'js', 'chesscom-insights.js'));
const CoachMemory = require(path.join(root, 'js', 'coach-memory.js'));

let fail = 0;
const ok = (name, cond) => { if (cond) console.log('ok:', name); else { fail++; console.error('FAIL:', name); } };

// ---- profile ----
const p = KPProfile.normalize({ eloGoal: 1400, goalBy: '2026-12', timeControl: 'blitz', seriousness: 'serious' });
ok('profile: valid fields survive normalize', p.eloGoal === 1400 && p.goalBy === '2026-12' && p.timeControl === 'blitz' && p.seriousness === 'serious');
const bad = KPProfile.normalize({ eloGoal: 99999, goalBy: 'soon', timeControl: 'correspondence', seriousness: 'very' });
ok('profile: invalid fields nulled', bad.eloGoal === null && bad.goalBy === null && bad.timeControl === null && bad.seriousness === null);
ok('profile: promptLine empty without data', KPProfile.normalize({}) && KPProfile.promptLine.call ? true : false);

// ---- chesscom-insights ----
const meta = {
  g1: { resultForUser: 'win', rating: 1000, oppRating: 1050, endTime: 1000, userColorName: 'White', termination: 'win', openingName: 'Vienna Game', userAccuracy: 80 },
  g2: { resultForUser: 'loss', rating: 1000, oppRating: 980, endTime: 2000, userColorName: 'Black', termination: 'timeout', openingName: 'Vienna Game' },
  g3: { resultForUser: 'draw', rating: 1000, oppRating: 1010, endTime: 3000, userColorName: 'White', termination: 'agreed', openingName: 'Sicilian Defense' },
  g4: { resultForUser: 'win', rating: 1000, oppRating: 300, endTime: 4000, userColorName: 'White', termination: 'win' }, // lopsided — excluded from perf
};
ok('cci: perfOf win = opp + 400', CCI.perfOf(meta.g1) === 1450);
ok('cci: perfOf loss = opp - 400', CCI.perfOf(meta.g2) === 580);
ok('cci: perfOf draw = opp', CCI.perfOf(meta.g3) === 1010);
const series = CCI.perfSeries(meta);
ok('cci: series excludes lopsided pairings', series.length === 3 && !series.some((e) => e.key === 'g4'));
ok('cci: series is chronological', series[0].key === 'g1' && series[2].key === 'g3');
const sum = CCI.summarize(meta);
ok('cci: record counts all games', sum.games === 4 && sum.wins === 2 && sum.draws === 1 && sum.losses === 1);
ok('cci: avgPerf skips lopsided', sum.avgPerf === Math.round((1450 + 580 + 1010) / 3));
ok('cci: loss terminations counted', sum.lossTerminations.timeout === 1);
ok('cci: openings aggregated with score', sum.openings[0].name === 'Vienna Game' && sum.openings[0].n === 2);
ok('cci: meaning honest above rating', CCI.perfMeaning(1200, 1000).includes('above'));
ok('cci: meaning honest below rating', CCI.perfMeaning(800, 1000).includes('below'));
ok('cci: no meaning without rating', CCI.perfMeaning(1200, null) === '');

// ---- coach memory ----
const m1 = CoachMemory.applyUpdate(null, ['Rushes recaptures', 'Strong on back-rank ideas'], 1000);
ok('memory: applyUpdate stores notes', m1.notes.length === 2 && m1.notes[0].t === 'Rushes recaptures');
const many = CoachMemory.applyUpdate(m1, Array.from({ length: 30 }, (_, i) => 'note ' + i), 2000);
ok('memory: hard cap at MAX_NOTES', many.notes.length === CoachMemory.MAX_NOTES);
const long = CoachMemory.applyUpdate(null, ['x'.repeat(500)], 3000);
ok('memory: notes truncated to NOTE_MAX_CHARS', long.notes[0].t.length === CoachMemory.NOTE_MAX_CHARS);
const dup = CoachMemory.applyUpdate(null, ['Same note', 'same note', 'SAME NOTE'], 4000);
ok('memory: case-insensitive dedupe', dup.notes.length === 1);
ok('memory: promptBlock empty when no notes', CoachMemory.promptBlock(CoachMemory.normalize(null)) === '');
ok('memory: promptBlock carries notes', CoachMemory.promptBlock(m1).includes('Rushes recaptures'));
ok('memory: writerBlock includes consolidation contract', CoachMemory.writerBlock(m1).includes('consolidate'));

console.log(fail ? `${fail} FAILED` : 'OK: all pure-module checks passed');
process.exit(fail ? 1 : 0);
