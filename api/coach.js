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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', detail: 'Only POST is accepted.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'ANTHROPIC_API_KEY is not set on the server.' });
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
