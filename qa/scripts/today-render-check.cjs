// today-render-check.cjs — fresh-context render check for the v0.80 today.html
// fixes (no "undefined" in block rows; goal hint uses the profile target).
// Seeds a hikaru-like state, renders today, asserts. Run with the server up.
const { chromium } = require('@playwright/test');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('kp-qa-no-sync', '1');
    localStorage.setItem('chess-coach-username-v1', 'render-check');
    localStorage.setItem('chess-coach-profile-v1', JSON.stringify({ eloGoal: 1400, goalBy: '2026-12', timeControl: 'blitz', seriousness: 'serious', updatedAt: new Date().toISOString() }));
    localStorage.setItem('chess-coach-daily-goal-v1', JSON.stringify({ tier: 'serious', target: 10 }));
    // one mistake so the page renders the populated path; endgame focus needs
    // scorecards — instead force the optional-extra branch which also renders rows
    localStorage.setItem('chess-coach-mistakes-v1', JSON.stringify([
      { id: 'g1|2', gameUrl: 'g1', type: 'mistake', fen: '6k1/5ppp/8/8/8/8/5PPP/3R3K w - - 0 1', userMoveSan: 'Rd2', bestMoveSan: 'Rd8', cpLoss: 300, severity: 'blunder', category: 'endgame', fullmove: 2, createdAt: new Date().toISOString() },
    ]));
    // endgame focus: seed eg results store empty + recognition unseen → recognition block renders (ICON.recognition)
  });
  await page.goto(BASE + '/today.html', { waitUntil: 'networkidle' });
  const body = await page.evaluate(() => document.body.textContent);
  const hint = await page.evaluate(() => document.querySelector('.gp-hint')?.textContent || '');
  const fails = [];
  if (body.includes('undefined')) fails.push('literal "undefined" rendered on today.html');
  if (hint.includes('1500')) fails.push('goal hint still says 1500 (profile target is 1400): ' + hint);
  if (!hint.includes('1400')) fails.push('goal hint does not show the profile target: ' + hint);
  await browser.close();
  if (fails.length) { fails.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
  console.log('OK: today renders clean — no "undefined", goal hint =', JSON.stringify(hint));
})().catch((e) => { console.error(e); process.exit(1); });
