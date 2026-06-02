#!/usr/bin/env node
// qa-checklist §F — data integrity. Filesystem-level, so it's a script, not a browser test.
// Catches the truncation + parse class that keeps biting:
//   - NUL padding at EOF (the sync-race truncation signature), across .js AND .html
//   - JS syntax errors via `node --check` (this also catches the smart-quote SyntaxErrors
//     that blanked today.html / coach.html). Inline-HTML script errors are caught at runtime
//     by the Playwright console sweep (e-smoke), not here.
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.argv[2] || 'chess-coach-testbed';
const files = globSync('**/*.{js,html}', { cwd: root, nodir: true })
  .filter(f => !f.includes('node_modules') && !f.startsWith('.git'));

let failures = 0;
for (const rel of files) {
  const abs = join(root, rel);
  if (readFileSync(abs).includes(0x00)) { console.error(`NUL byte / truncation: ${rel}`); failures++; }
  if (rel.endsWith('.js')) {
    try { execFileSync('node', ['--check', abs], { stdio: 'pipe' }); }
    catch (e) { console.error(`Syntax error: ${rel}\n  ${String(e.stderr || e).split('\n')[0]}`); failures++; }
  }
}
console.log(failures === 0 ? `OK: ${files.length} files clean` : `FAIL: ${failures} issue(s)`);
process.exit(failures === 0 ? 0 : 1);
