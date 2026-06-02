// qa-checklist §A — shared shell on every page, both breakpoints. Reconciled to v0.44:
// mobile is tab-bar-only (hamburger removed in v0.42); practice.html is a shell page.
import { test, expect } from '@playwright/test';
import { SHELL_PAGES } from './pages.js';

test.describe('Desktop shell (project: desktop-chromium)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 880, 'desktop only');
  for (const { path } of SHELL_PAGES) {
    test(`desktop shell: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('.nav-drawer')).toBeVisible();           // pinned sidebar
      await expect(page.locator('.tab-bar')).toBeHidden();               // mobile bar hidden on desktop
      await expect(page.locator('.version-stamp')).toContainText(/v\d+\.\d+/); // stamp present + real
      await expect(page.locator('.nav-drawer-link.active')).toHaveCount(1);    // exactly one active
    });
  }
});

test.describe('Mobile shell (project: mobile-safari)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 999) >= 880, 'mobile only');
  for (const { path } of SHELL_PAGES) {
    test(`mobile shell: ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('.tab-bar')).toBeVisible();              // bottom tab bar present
      await expect(page.locator('#hamburger-btn')).toHaveCount(0);       // v0.42 decision: tab-bar-only
      // no horizontal scroll / clipped chrome at phone width
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} has horizontal overflow`).toBeLessThanOrEqual(1);
    });
  }
});
