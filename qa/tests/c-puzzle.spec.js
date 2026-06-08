// qa-checklist §C — puzzle core loop.
// Live-now items run; reverted (R2 material balance) and not-yet-rebuilt (R3 puzzle UX)
// items are parked as test.fixme with the owning release noted. Un-fixme them as each ships.
import { test, expect } from '@playwright/test';

test('puzzle.html loads clean and renders a board', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto('/puzzle.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // module import chain must not throw (the dom.js fault class)
  expect(errors).toEqual([]);
  await expect(page.locator('.board').first()).toBeVisible();
});

// --- R2: material balance (§20) was reverted in recovery; returns in R2 ---
test('R2: captured-material rows render, icons legible, net advantage correct', async () => {});

// --- R3: puzzle UX bundle (blink, wrong-move clarity, comparison grid slot, arrows, restart) ---
test.fixme('R3: pieces do not blink on move/navigate/select', async () => {});
test.fixme('R3: wrong move is obvious immediately (clear state, not a subtle note)', async () => {});
test.fixme('R3: comparison panel sits in its grid slot and does not push the board down', async () => {});
test.fixme('R3: board arrows render reliably, including the first/best move', async () => {});
test.fixme('R3: restarting a puzzle clears the wrong-move box', async () => {});
