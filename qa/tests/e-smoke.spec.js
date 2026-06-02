// qa-checklist §B (console) + §E (smoke). THE highest-value test.
// A zero-console-error sweep would have caught every firefight regression automatically:
// the today.html / coach.html smart-quote SyntaxErrors AND the dom.js null addEventListener
// throw that killed puzzle + endgames. This is your dominant failure mode, made automatic.
import { test, expect } from '@playwright/test';
import { ALL_PAGES, isIgnored } from './pages.js';

for (const path of ALL_PAGES) {
  test(`loads with no console/page errors: ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error' && !isIgnored(msg.text())) errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // let deferred module imports throw if they're going to

    expect(errors, `Errors on ${path}:\n${errors.join('\n')}`).toEqual([]);
    // not a blank page
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, `${path} rendered blank`).toBeGreaterThan(0);
  });
}
