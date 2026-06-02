# Chess Coach — automated QA

Playwright + GitHub Actions, encoding `docs/qa-checklist.md` as runnable tests. Free, open source.
Runs against the Vercel **preview** so it slots into your branch -> preview -> merge gate.

## Install location

Drop this folder into the testbed repo as `qa/` (sibling of the `.html` pages), and the
workflow at `.github/workflows/qa.yml` at the repo root. The config serves `../chess-coach-testbed`
locally and reads `BASE_URL` in CI.

> **Vercel gotcha (must do on commit):** adding `qa/package.json` can make Vercel try to build.
> Keep `qa/` out of the deploy: add `qa` to `.vercelignore`, and confirm `vercel.json` has no
> `buildCommand` (static deploy). The QA tooling must never change what ships.

## Run it

```bash
cd qa && npm install && npx playwright install chromium webkit
npm test            # full suite, both breakpoints, local static server
npm run test:smoke  # just the console-clean sweep (fastest signal)
npm run integrity   # §F filesystem check (NUL + node --check), no browser
BASE_URL=https://<preview>.vercel.app npm test   # against a deployed preview
```

## What's automated vs not (reconciled to v0.44)

| Checklist | Automated | Where | Notes |
|---|---|---|---|
| §A shell/nav, both breakpoints | Yes | `a-shell-nav.spec.js` | Reconciled: mobile = tab-bar-only (hamburger removed v0.42); `practice.html` added. The "9 pages" list + "hamburger decision pending" rows are **stale** in the doc. |
| §B Today renders / empty state / console-clean | Yes | `b-today.spec.js`, `e-smoke.spec.js` | |
| §B Start session routes in | **Parked (`fixme`)** | `b-today.spec.js` | The live P0. Un-fixme when **R1.2** merges; it then guards the fix permanently. |
| §C puzzle loads clean, board renders | Yes | `c-puzzle.spec.js` | |
| §C material balance (§20) | **Parked (`fixme`)** | `c-puzzle.spec.js` | Reverted in recovery. Un-fixme when **R2** ships. |
| §C blink / wrong-move clarity / comparison slot / arrows / restart | **Parked (`fixme`)** | `c-puzzle.spec.js` | Un-fixme per item as **R3** lands. |
| §C no-spoiler coach | Not yet | — | Automatable later (assert `/api/coach` replies contain no square/SAN/eval), but semantically fuzzy + costs API calls. Keep manual for now. |
| §D endgames load + reachable + no surfaced error | Yes | `d-endgames.spec.js` | |
| §E other surfaces smoke | Yes | `e-smoke.spec.js` | Every page, zero console/page errors. **This is the test that would have caught the whole firefight.** |
| §F NUL bytes + JS syntax | Yes | `scripts/integrity-check.mjs` | Uses `node --check` (also catches the smart-quote SyntaxErrors). |
| §F deployed build matches source | Partial | — | The preview-targeted run tests the *deployed* artifact, which covers most of this intent. |
| Real iPhone touch / safe-area / Safari quirks | No | — | WebKit project is a strong proxy; keep a short manual iPhone pass for the last 10%. |
| "Boards look identical across screens" | Stub | (see below) | Visual regression is the right tool: `toHaveScreenshot()` per board. Add once Design's canonical board spec lands and R3 consolidates to one renderer, else snapshots churn. |

## Maintaining it

- A parked test carries the owning release in its name (`R1.2:`, `R2:`, `R3:`). When that release
  merges, delete `.fixme` so the test activates and the regression can never silently return.
- Tolerated console noise lives in `tests/pages.js` (`IGNORED_CONSOLE`). Keep it short and reasoned.
- The doc `docs/qa-checklist.md` stays the human source; this suite is its executable subset.
