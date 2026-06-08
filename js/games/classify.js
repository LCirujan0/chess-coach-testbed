// ============================================================================
// SECTION 7b — MOTIF CLASSIFIER (Spec 02)
// ----------------------------------------------------------------------------
// One grounded Claude call per detected mistake at ingest time. Returns one
// tag from a fixed 17-tag vocabulary; output is stored on the Mistake record
// and powers the "Drill this theme" filter on Puzzles. The call runs ONLY
// at ingest (and on backfill); it never runs in front of the player, so
// there is no no-spoiler conflict with the live coach.
// ============================================================================
const MOTIF_VOCAB = [
  'pin','fork','skewer','discovered-attack','removing-defender','back-rank',
  'overload','decoy','deflection','zwischenzug','mating-net','pawn-promotion',
  'simplification','prophylaxis','pawn-structure','king-attack','none-tactical',
];
const MOTIF_VOCAB_SET = new Set(MOTIF_VOCAB);

const MOTIF_CLASSIFIER_SYSTEM = [
  'You are a chess tactics classifier. You will receive a position and Stockfish\'s',
  'top engine lines for a position where the student made a mistake. Your only job is',
  'to name the single dominant tactical motif that the best move exploits or that the',
  'student missed.',
  '',
  'Ground your choice ONLY in the supplied engine lines and the FEN of the position;',
  'do not invent pieces or moves not present in the data. Do not explain. Do not',
  'output anything except one tag.',
  '',
  'Return EXACTLY one of these tags, lowercase, no punctuation, no other text:',
  MOTIF_VOCAB.join(' · '),
  '',
  'If two motifs apply, pick the dominant one. If no clean tactical idea applies',
  '(the best move is a quiet positional improvement), return none-tactical.',
].join('\n');

function buildMotifClassifierUserMessage(mistake) {
  const lines = (mistake.engineLines || []).slice(0, 5).map((l, i) => {
    const evalStr = l.eval && l.eval.mate != null ? `M${l.eval.mate}` : (l.eval && typeof l.eval.cp === 'number' ? `${l.eval.cp}cp` : '?');
    const pv = Array.isArray(l.pvSan) ? l.pvSan.slice(0, 6).join(' ') : '';
    return `  ${i + 1}. ${l.san} (eval ${evalStr}) — ${pv}`;
  }).join('\n');
  return [
    `FEN: ${mistake.fen}`,
    `Side to move: ${mistake.userColorName}`,
    `The student played ${mistake.userMoveSan} (${mistake.cpLoss}cp below best).`,
    `Engine top lines:`,
    lines,
    `The engine preferred ${mistake.bestMoveSan}. Name the dominant motif.`,
  ].join('\n');
}

async function classifyMotif(mistake) {
  try {
    const r = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 10,
        system: MOTIF_CLASSIFIER_SYSTEM,
        messages: [{ role: 'user', content: buildMotifClassifierUserMessage(mistake) }],
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const raw = data?.content?.[0]?.text || '';
    const tag = raw.trim().toLowerCase().replace(/[^a-z\-]/g, '');
    if (MOTIF_VOCAB_SET.has(tag)) return tag;
    console.warn('Motif classifier returned off-vocab value:', JSON.stringify(raw), '→ none-tactical');
    return 'none-tactical';
  } catch (err) {
    console.warn('classifyMotif failed:', err.message);
    return 'none-tactical';
  }
}

// Classify a batch of mistakes with bounded concurrency. Keeps the API
// pressure manageable on a 6-game ingest (~15–25 mistakes).
async function classifyMotifsBatch(mistakes, onProgress) {
  const CONCURRENCY = 4;
  let done = 0;
  const total = mistakes.length;
  const queue = mistakes.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    while (queue.length) {
      const m = queue.shift();
      if (!m) return;
      m.motif = await classifyMotif(m);
      m.motifTaggedAt = new Date().toISOString();
      done++;
      if (onProgress) onProgress(done, total);
    }
  });
  await Promise.all(workers);
  return mistakes;
}
export { classifyMotifsBatch };
