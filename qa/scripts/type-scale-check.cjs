/* ============================================================================
 * qa/scripts/type-scale-check.cjs — strict type-scale audit (v0.82).
 * Owner rule: "We use font sizes inconsistently, we need to set a strict
 * design system... audit the app for its enforcement, and ensure it's applied
 * in any future iteration."
 *
 * The scale lives in css/tokens.css (--fs-* tokens). This script sweeps every
 * stylesheet, page <style> block, and JS-injected CSS for font-size
 * declarations and fails if any px value is off-scale. var()/em/rem/% are
 * always fine (they derive from the scale or the parent).
 *
 * Run:  node qa/scripts/type-scale-check.cjs   (from repo root)
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// The strict scale. 9px is allowed ONLY for dense chart annotations + the
// tab-bar label (documented in docs/design-system.md). 10.5px is the eyebrow.
const SCALE = new Set([9, 10, 10.5, 11, 12, 12.5, 13, 13.5, 14, 15, 16, 18, 21, 24, 28, 30, 34, 36]);

const SCAN_DIRS = ['css', 'js'];
const SKIP = [/vendor/, /engine[\\/]/, /node_modules/, /qa[\\/]/, /data[\\/]/];

function files() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) out.push(path.join(ROOT, f));
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (SKIP.some((re) => re.test(p))) continue;
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(css|js|html)$/.test(f)) out.push(p);
    }
  };
  for (const d of SCAN_DIRS) { const p = path.join(ROOT, d); if (fs.existsSync(p)) walk(p); }
  return out;
}

let bad = 0, checked = 0;
for (const file of files()) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const re = /font-size\s*:\s*([0-9.]+)px/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    checked++;
    const v = parseFloat(m[1]);
    if (!SCALE.has(v)) {
      bad++;
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`OFF-SCALE  ${rel}:${line}  font-size:${v}px`);
    }
  }
}

console.log(`\n${checked} px font-size declarations checked, ${bad} off-scale.`);
if (bad > 0) {
  console.log('Scale: ' + [...SCALE].join(', ') + ' (px). Use the nearest step or a --fs-* token from css/tokens.css.');
  process.exit(1);
}
console.log('Type scale: PASS');
