// Vercel serverless function: POST /api/tag
//
// Accepts a batch of puzzles, calls Claude Haiku to classify motifs/themes,
// and returns structured tags. No puzzle data is logged or persisted.
//
// Body:    { puzzles: [{ id, fen, lines: [{ cp, pv: [uci,...] }] }] }
// Response: { tags: [{ id, motif, themes, aiTaggedAt }] }
//
// REQUIRED VERCEL ENV VAR:
//   ANTHROPIC_API_KEY   - never exposed to the browser

const MOTIFS = [
  'pin','fork','skewer','discovered-attack','removing-defender','back-rank',
  'overload','decoy','deflection','zwischenzug','mating-net','pawn-promotion',
  'simplification','prophylaxis','pawn-structure','king-attack','none-tactical',
];

const SYSTEM_PROMPT = `You are a chess pattern classifier. For each position, identify the primary tactical motif and any relevant themes.

Rules:
- motif must be exactly one value from this list (use the closest match, or 'none-tactical' if no tactic applies): pin, fork, skewer, discovered-attack, removing-defender, back-rank, overload, decoy, deflection, zwischenzug, mating-net, pawn-promotion, simplification, prophylaxis, pawn-structure, king-attack, none-tactical
- themes is an array of 1-3 additional descriptive labels (free-form, brief strings)
- Respond ONLY with a valid JSON array, no preamble, no markdown fences
- Format: [{"id":"...","motif":"...","themes":["..."]}]`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', detail: 'Only POST is accepted.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  const body = req.body;
  if (!body || !Array.isArray(body.puzzles) || body.puzzles.length === 0) {
    return res.status(400).json({ error: 'bad_request', detail: 'body.puzzles must be a non-empty array.' });
  }
  if (body.puzzles.length > 20) {
    return res.status(400).json({ error: 'bad_request', detail: 'body.puzzles must contain 20 or fewer items.' });
  }

  // Build user message: one block per puzzle
  const puzzleBlocks = body.puzzles.map((p, idx) => {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const lineTexts = lines.slice(0, 3).map((l, li) => {
      const cpDesc = typeof l.cp === 'number' ? `${l.cp} cp loss vs best` : 'unknown cp';
      const pvStr = Array.isArray(l.pv) ? l.pv.join(' ') : '';
      return `Engine line ${li + 1}: ${pvStr} (${cpDesc})`;
    });
    return [
      `Position ${idx + 1}:`,
      `ID: ${p.id}`,
      `FEN: ${p.fen}`,
      ...lineTexts,
    ].join('\n');
  }).join('\n\n');

  const userMessage = `Classify the following chess positions. Respond ONLY with a JSON array.\n\n${puzzleBlocks}`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: 'upstream_failure', detail: errText });
    }

    const data = await upstream.json();
    const rawText = data && data.content && data.content[0] && data.content[0].text
      ? data.content[0].text.trim()
      : '';

    // Strip markdown fences if Claude wrapped the response
    let jsonText = rawText;
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      return res.status(502).json({ error: 'parse_failure', detail: 'Claude returned non-JSON response.', raw: rawText.slice(0, 500) });
    }

    if (!Array.isArray(parsed)) {
      return res.status(502).json({ error: 'parse_failure', detail: 'Claude response was not a JSON array.' });
    }

    // Normalise: ensure motif is in the vocabulary, add aiTaggedAt
    const now = new Date().toISOString();
    const tags = parsed.map((item) => ({
      id: String(item.id || ''),
      motif: MOTIFS.includes(item.motif) ? item.motif : 'none-tactical',
      themes: Array.isArray(item.themes) ? item.themes.slice(0, 3).map(String) : [],
      aiTaggedAt: now,
    }));

    return res.status(200).json({ tags });
  } catch (err) {
    return res.status(502).json({ error: 'upstream_failure', detail: String(err && err.message ? err.message : err) });
  }
}
