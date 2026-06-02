// qa-checklist §B — Today renders + Start session routes into the session (not a bounce).
import { test, expect } from '@playwright/test';

test('today.html renders content, not a blank page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/today.html', { waitUntil: 'networkidle' });
  expect(errors).toEqual([]);
  await expect(page.locator('.page-title')).toContainText('Today');
});

test('today.html shows a sane empty state with no ingested data', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/today.html', { waitUntil: 'networkidle' });
  // never a blank screen: some onboarding/empty prompt must render
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(20);
});

// P0 REGRESSION GATE — currently broken on prod (the "1/8 flash then bounce to practice").
// Owned by R1.2. REMOVE the .fixme below the moment the R1.2 fix merges, so this guards it forever.
test.fixme('Start session routes into an active session, not back out', async ({ page }) => {
  await page.goto('/today.html', { waitUntil: 'networkidle' });
  const start = page.getByRole('link', { name: /start session/i });
  await expect(start).toBeVisible();
  await start.click();
  await page.waitForLoadState('networkidle');
  expect(page.url()).toContain('/session.html');           // landed in the session
  await expect(page.getByText(/no active session/i)).toHaveCount(0); // did NOT fall through to empty
  expect(page.url()).not.toContain('/practice.html');      // did NOT bounce
});
