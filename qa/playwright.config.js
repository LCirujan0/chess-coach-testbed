import { defineConfig, devices } from '@playwright/test';

// BASE_URL strategy:
//  - CI against a Vercel preview: set BASE_URL to the preview URL; no local server starts.
//  - Local: leave BASE_URL unset; a static server serves the testbed from ./chess-coach-testbed.
const BASE_URL = process.env.BASE_URL;
const LOCAL_PORT = 4173;

// Vercel preview deployments sit behind SSO ("deployment protection"). To let CI reach them,
// enable "Protection Bypass for Automation" in Vercel and store the token as a GitHub secret.
// Playwright sends it on every request as a header; Vercel then serves the preview to CI only.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL || `http://localhost:${LOCAL_PORT}`,
    extraHTTPHeaders: BYPASS
      ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'samesitenone' }
      : {},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: BASE_URL ? undefined : {
    command: `npx -y serve .. -l ${LOCAL_PORT} -s`,
    url: `http://localhost:${LOCAL_PORT}/today.html`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
