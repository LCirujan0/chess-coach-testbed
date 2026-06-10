// sync-merge-check.cjs — unit checks for the cross-device merge rules
// (js/sync.js mergeKey). Browser-context via the bundled Chromium because
// sync.js is an ES module with top-level DOM access (node can't import it).
// Run with the static server up:  node scripts/sync-merge-check.cjs
// (BASE_URL env overrides the default http://127.0.0.1:4173)
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + '/today.html', { waitUntil: 'domcontentloaded' });

  const results = await page.evaluate(async () => {
    const { mergeKey } = await import('/js/sync.js');
    const t = [];
    const eq = (name, got, want) => t.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
    const ok = (name, cond) => t.push({ name, pass: !!cond });
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

    // streak: higher current wins; longest/freezes max; lists union
    const s = mergeKey('chess-coach-streak-v1',
      { current: 3, longest: 9, freezesAvailable: 0, freezeUsedDays: ['2026-06-01'], restDays: [] },
      { current: 5, longest: 6, freezesAvailable: 2, freezeUsedDays: ['2026-06-02'], restDays: ['2026-06-03'] });
    ok('streak: higher current wins', s.current === 5);
    ok('streak: longest is max', s.longest === 9);
    ok('streak: freezes max', s.freezesAvailable === 2);
    ok('streak: used-days union', s.freezeUsedDays.length === 2);

    // attempts: union, later lastAt per id
    const a = mergeKey('chess-coach-attempts-v1',
      { p1: { solved: false, lastAt: '2026-06-10T10:00:00Z' }, p2: { solved: true, lastAt: '2026-06-01T00:00:00Z' } },
      { p1: { solved: true, lastAt: '2026-06-09T10:00:00Z' }, p3: { solved: true, lastAt: '2026-06-05T00:00:00Z' } });
    ok('attempts: union of ids', Object.keys(a).sort().join() === 'p1,p2,p3');
    ok('attempts: later lastAt wins', a.p1.solved === false);

    // mistakes: union by id
    const m = mergeKey('chess-coach-mistakes-v1', [{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
    ok('mistakes: union by id', m.length === 3);

    // session: today beats stale; both-today -> more done
    const sess = mergeKey('chess-coach-session-v1',
      { date: today, blocks: [{ done: 3 }] }, { date: '2020-01-01', blocks: [{ done: 9 }] });
    ok('session: today beats stale', sess.blocks[0].done === 3);
    const sess2 = mergeKey('chess-coach-session-v1',
      { date: today, blocks: [{ done: 1 }] }, { date: today, blocks: [{ done: 4 }] });
    ok('session: both-today, more done wins', sess2.blocks[0].done === 4);

    // openings: per line later lastSeen
    const op = mergeKey('chess-coach-openings-v1',
      { l1: { box: 2, lastSeen: 100 } }, { l1: { box: 4, lastSeen: 50 }, l2: { box: 1, lastSeen: 10 } });
    ok('openings: later lastSeen wins', op.l1.box === 2 && !!op.l2);

    // null handling
    ok('null local -> remote', mergeKey('chess-coach-tags-v1', null, { x: 1 }).x === 1);
    ok('null remote -> local', mergeKey('chess-coach-tags-v1', { y: 2 }, null).y === 2);

    return t;
  });

  let fail = 0;
  for (const r of results) {
    if (!r.pass) { fail++; console.error('FAIL:', r.name, r.got !== undefined ? JSON.stringify({ got: r.got, want: r.want }) : ''); }
    else console.log('ok:', r.name);
  }
  await browser.close();
  console.log(fail ? `${fail} FAILED of ${results.length}` : `OK: ${results.length}/${results.length} merge checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
