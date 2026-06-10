// The shared shell must land on every one of these (qa-checklist §A, reconciled to v0.44).
// index.html is a meta-refresh redirect to /today.html; session.html is a focused in-session
// wrapper with its own minimal chrome, so neither is a "shell page".
export const SHELL_PAGES = [
  { path: '/today.html',                title: 'Today' },
  { path: '/puzzle.html',               title: 'Puzzle' },
  { path: '/practice.html',             title: 'Practice' },
  { path: '/review.html',               title: 'Game Review' },
  { path: '/games.html',                title: 'Sync games' },
  { path: '/completed.html',            title: 'Completed' },
  { path: '/insights.html',             title: 'Insights' },
  { path: '/coach.html',                title: 'Coach' },
  { path: '/endgames.html',             title: 'Endgames' },
  { path: '/endgame-recognition.html',  title: 'Recognition' },
  { path: '/board-vision.html',         title: 'Board Vision' },
  { path: '/openings.html',             title: 'Openings' },
  { path: '/roadmap.html',              title: 'Roadmap' },
];

// All deployed pages, for the broad console-clean sweep (§B console + §E smoke).
export const ALL_PAGES = [
  ...SHELL_PAGES.map(p => p.path),
  '/index.html',
  '/session.html',
  '/onboarding.html',   // v0.80 first-run flow (focused chrome, no nav)
];

// Console noise we tolerate (extend deliberately, with a reason). Keep this short:
// the whole point is that real errors are NOT here. /api 401 = the coach password gate.
export const IGNORED_CONSOLE = [
  /401 \(Unauthorized\)/,        // /api/coach password gate when no key set
  /favicon/i,
];

export function isIgnored(text) {
  return IGNORED_CONSOLE.some(re => re.test(text));
}
