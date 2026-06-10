// purge-emdash.cjs — owner HARD RULE (2026-06-10): no em/en dashes anywhere in
// user-facing copy. Replaces " — "/" – " with ". " when the next word starts a
// sentence (capital letter) and ", " otherwise; bare dashes become commas.
// Idempotent (no dashes left -> no-op). Skips vendor/engine/generated data.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

function fixText(s) {
  // spaced dash: sentence-ish break if next char is uppercase, else comma
  s = s.replace(/\s+[—–]\s+(?=[A-Z"“])/g, '. ');
  s = s.replace(/\s+[—–]\s+/g, ', ');
  // unspaced or trailing dashes
  s = s.replace(/[—–]/g, ', ');
  return s;
}

const targets = [];
for (const f of fs.readdirSync(root)) if (f.endsWith('.html')) targets.push(f);
const jsDirs = ['js', 'js/puzzle', 'js/games', 'js/openings', 'js/board-vision', 'js/today', 'js/onboarding'];
for (const d of jsDirs) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    if (f.endsWith('.js') && d + '/' + f !== 'js/vendor') targets.push(d + '/' + f);
  }
}
targets.push('data/endgames.json', 'data/endgame-recognition.json', 'data/openings/index.json', 'data/openings/vienna.json');

let touched = 0, total = 0;
for (const rel of targets) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp) || rel.startsWith('js/vendor')) continue;
  const before = fs.readFileSync(fp, 'utf8');
  const n = (before.match(/[—–]/g) || []).length;
  if (!n) continue;
  fs.writeFileSync(fp, fixText(before));
  touched++; total += n;
  console.log(rel + ': ' + n);
}
console.log(`done: ${total} dashes removed across ${touched} files`);
