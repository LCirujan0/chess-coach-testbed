// Vercel serverless function that proxies coach requests to Anthropic.
//
// The Anthropic API key NEVER lives in client-side code. It is read from a
// Vercel environment variable at call time, so it cannot leak via "view source"
// or DevTools.
//
// PROTECTION POSTURE (2026-05-27 update):
// The previous version of this function required an `x-coach-password` header
// validated against a `COACH_PASSWORD` env var. That gate has been removed —
// it was creating onboarding friction (password prompts on first run, error
// states when a different device was used) and the real cost-protection is
// the Anthropic monthly spend cap, not the password.
//
// As a result, anyone who can reach this URL can call the function and burn
// Anthropic credit. The protections are now:
//   1. URL obscurity (chess-coach-coral.vercel.app is unshared)
//   2. Anthropic spend cap (set this on console.anthropic.com)
//
// If the URL is ever shared publicly, restore a password gate before doing so.
// See docs/learnings.md for the full reasoning.
//
// REQUIRED VERCEL ENVIRONMENT VARIABLES (set in Project Settings -> Env Vars):
//   ANTHROPIC_API_KEY   - your Anthropic key, secret, never exposed to browser
//
// Endpoint: POST /api/coach
//   headers: { 'Content-Type': 'application/json' }
//   body:    the same JSON body you would send to https://api.anthropic.com/v1/messages
//
// The function forwards the body as-is to Anthropic and returns Anthropic's
// response verbatim, including status code. No data is logged or persisted.

// Guard rails (2026-06-10 audit, task 1.3/1.4): the endpoint stays auth-free
// (see posture above) but no longer forwards ARBITRARY bodies. Validation +
// best-effort rate limiting bound the worst-case spend if the URL leaks.
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MAX_TOKENS_CAP = 1024;      // largest legitimate caller uses 600
const MAX_BODY_BYTES = 50_000;    // largest legitimate body (plan-today digest) is ~8 KB

// Best-effort per-IP sliding window. Module state survives between warm
// invocations of one serverless instance; cold starts reset it — fine, this
// is a speed bump for abuse, not a quota system (the hard stop stays the
// Anthropic spend cap).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQ = 30;
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 1000) hits.clear(); // memory backstop
  return arr.length > RATE_MAX_REQ;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', detail: 'Only POST is accepted.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'rate_limited', detail: 'Too many requests — slow down.' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'bad_request', detail: 'Body must be a JSON object.' });
  }
  if (!ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: 'bad_request', detail: 'Unsupported model.' });
  }
  if (typeof body.max_tokens !== 'number' || body.max_tokens < 1 || body.max_tokens > MAX_TOKENS_CAP) {
    return res.status(400).json({ error: 'bad_request', detail: `max_tokens must be 1-${MAX_TOKENS_CAP}.` });
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'payload_too_large', detail: 'Request body too large.' });
  }

  // Forward to Anthropic. Body is auto-parsed by Vercel for JSON requests.
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    // Mirror the upstream status and body so the client can see real errors
    // (rate limits, invalid model, etc) without losing fidelity.
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: 'upstream_failure', detail: String(err && err.message ? err.message : err) });
  }
}
