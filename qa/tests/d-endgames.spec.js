// qa-checklist §D — endgame trainer + recognition load and are reachable.
import { test, expect } from './fixtures.js';

for (const path of ['/endgames.html', '/endgame-recognition.html']) {
  test(`endgame page loads clean: ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // surfaceError() on these pages writes a visible failure message — assert it didn't fire
    await expect(page.getByText(/failed to load|engine failed|js error/i)).toHaveCount(0);
    expect(errors.filter(e => !/401|favicon/i.test(e))).toEqual([]);
    await expect(page.locator('.board').first()).toBeVisible();
  });
}
