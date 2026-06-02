# Unblock automated QA: Vercel preview bypass (Jorge, ~5 min, one-time)

Vercel puts preview deployments behind an SSO login wall. That wall blocks the CI test
runner (and me) from reaching previews. "Protection Bypass for Automation" gives you a
secret token that lets automated tools through while previews stay private to the public.

## Step 1 — generate the bypass token in Vercel
1. Open vercel.com and go to the `chess-coach-testbed` project.
2. Settings → Deployment Protection.
3. Find "Protection Bypass for Automation". Toggle it on.
4. It generates a secret string. Click to reveal, copy it. Keep it private (treat it like a password).

## Step 2 — store the token as a GitHub secret
1. Open github.com/LCirujan0/chess-coach-testbed.
2. Settings → Secrets and variables → Actions → "New repository secret".
3. Name it exactly: `VERCEL_AUTOMATION_BYPASS_SECRET`
4. Paste the token from Step 1 into the value. Save.

That name is what the workflow reads — it must match exactly.

## Step 3 — confirm it works
After Releases has committed the `qa/` folder and `.github/workflows/qa.yml`:
1. Push any branch (or open a PR).
2. In the repo's "Actions" tab, the "QA (Playwright)" workflow runs once the Vercel
   preview is ready. Green = the suite reached the preview and passed.
3. If the e2e job fails with auth/login HTML instead of your pages, the secret name or
   value is wrong — recheck Step 2.

## What this does and doesn't change
- Previews stay private to the public; only requests carrying the token get through.
- Your own browser still views previews because you're logged into Vercel — unchanged.
- Production is untouched.
- After this, the steady state is: push branch → CI runs smoke + flow + integrity on the
  preview → green/red check on the PR → you glance + a quick iPhone tap-through → merge.
  That removes the per-release manual checklist grind.
