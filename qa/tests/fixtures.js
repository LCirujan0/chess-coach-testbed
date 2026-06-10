// Shared test fixture (v0.80): the onboarding gate routes anonymous visitors
// to /onboarding.html, so every page test seeds a username first. kp-qa-no-sync
// keeps the suite network-hermetic — js/sync.js skips all Supabase traffic when
// it is set (the sync layer's own behaviour is covered by scripts/sync-merge-check
// and manual QA, not by the page suite).
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('chess-coach-username-v1', 'qa-smoke-user');
        localStorage.setItem('kp-qa-no-sync', '1');
        // Fresh rating cache: the 24h refresh window keeps puzzle.html from
        // fetching chess.com /stats for the fake QA user (a 404 there logs a
        // console error and fails the smoke suite).
        localStorage.setItem('chess-coach-user-rating-v1', JSON.stringify({ rating: 1100, fetchedAt: new Date().toISOString() }));
        // Help popups (js/help.js) auto-open on first visit; QA marks them all
        // seen so page assertions and screenshots stay deterministic.
        localStorage.setItem('chess-coach-help-seen-v1', JSON.stringify({
          mistakes: 1, endgames: 1, recognition: 1, 'board-vision': 1, openings: 1,
        }));
      } catch { /* storage unavailable in some contexts */ }
    });
    await use(page);
  },
});
export { expect };
