import { SEVERITY_THRESHOLDS } from './config.js';
// ============================================================================
// SECTION 7 — CATEGORIZATION
// ----------------------------------------------------------------------------
// opening:    fullmove <= 15
// endgame:    no queens on the board OR fullmove >= 35
// middlegame: everything else
// ============================================================================

function categorize(fullmove, fen) {
  if (fullmove <= 15) return 'opening';
  const placement = fen.split(' ')[0];
  const hasQueens = placement.includes('Q') || placement.includes('q');
  if (!hasQueens) return 'endgame';
  if (fullmove >= 35) return 'endgame';
  return 'middlegame';
}

function severityFor(cpLoss) {
  if (cpLoss < SEVERITY_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (cpLoss < SEVERITY_THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

// Greedy thinning: sort non-blunders by cpLoss desc, keep one at a time if
// no kept entry is within THINNING_WINDOW user moves. Blunders are kept
// unconditionally. Output is sorted back into move order.
function thinMistakesByWindow(mistakes, windowSize) {
  const blunders = mistakes.filter((m) => m.severity === 'blunder');
  const others = mistakes
    .filter((m) => m.severity !== 'blunder')
    .slice()
    .sort((a, b) => b.cpLoss - a.cpLoss);
  const kept = [];
  for (const m of others) {
    const tooClose = kept.some((k) => Math.abs(k.fullmove - m.fullmove) < windowSize);
    if (!tooClose) kept.push(m);
  }
  return [...blunders, ...kept].sort((a, b) => a.fullmove - b.fullmove);
}
export { categorize, severityFor, thinMistakesByWindow };
