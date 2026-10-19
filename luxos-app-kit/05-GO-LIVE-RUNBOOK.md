# 5 · Go-live runbook (LuxOS admin / owner)

What YOU do once a team's PR is green, to deploy their app on your Vercel account
and make it live in LuxOS. `<APP_ID>` = the app's slug (e.g. `sales-room`); it must
be identical in the basePath, the Vercel env, and the LuxOS dashboard id.

> Order matters: set env + secrets **before** the merge (the build reads them), then
> register in LuxOS **after** the first deploy (you need the stable URL).

## 0. Confirm the PR is green
On the app repo's PR: all required checks pass — AI review (Claude), Semgrep, Trivy,
npm audit, TruffleHog, LuxOS Security Gate. Don't merge yet.

## 1. Create the Vercel project (under *Pergolux GmbH*, your account)
Vercel → **Add New… → Project → Import Git Repository** → pick the app repo
(`PERGOLUX-International/<repo>`). On the import screen:
- **Team/scope:** Pergolux GmbH (not a personal account)
- Framework preset: auto-detected (Next.js)
- **Don't deploy yet** — add env vars first (next step), or let the first import
  build fail and just redeploy after env is set.

(If the project already exists, skip to step 2.)

## 2. Set the app's Production env vars (Vercel → project → Settings → Environment Variables)
- `NEXT_PUBLIC_BASE_PATH` = `/app/<APP_ID>`  ← build-time; must equal the LuxOS id
- `LUXOS_URL` = `https://luxos.pergolux.global`
- `LUXOS_GATEWAY_SECRET` = **the exact same value as on the LuxOS project**
  (generate once with `openssl rand -base64 32` and reuse it for every app)
- Plus whatever the app itself needs (DB, API keys — ask the dev / copy from their `.env.example`)

All on the **Production** environment.

## 3. Set the GitHub repo secrets + branch protection (one-time per repo)
Repo → **Settings → Secrets and variables → Actions**:
- `ANTHROPIC_API_KEY`, `LUXOS_URL`, `SECURITY_GATE_SECRET`
- (org-level secrets cover all repos if you set them at the org)

Repo → **Settings → Branches → protect `main`**: require PRs + require the checks
(AI review, Semgrep, Trivy, npm audit, TruffleHog, LuxOS Security Gate) to pass.

## 4. Merge the PR → it deploys
Squash-merge the green PR. Vercel's Git integration auto-builds `main` and deploys to
Production (picking up the env from step 2). Watch the build in the Vercel dashboard.
**Never** `vercel deploy` from a laptop — merging the green PR is the only path.

> Optional extra gate: Vercel → Settings → Git → enable **"Only deploy production
> when promoted"** (or require a GitHub environment approval) if you want to click
> "Promote" manually after reviewing the preview. Not required — the security gate
> already runs before merge.

## 5. Get the stable production URL
Vercel → project → **Domains** (or the latest Production deployment). Use the stable
project alias: `https://<repo>-pergolux-gmbh.vercel.app` — **not** a one-off
`…-<hash>-…` deployment URL (those get superseded and 404 later).

## 6. Register in LuxOS → Admin → Dashboards
- **Name:** human name; choose it so its slug == `<APP_ID>` (LuxOS derives the id
  from the name). The id MUST equal the basePath segment or the gateway 404s.
- **URL:** the stable alias from step 5
- **Allowed roles:** who may open it
- **Connected:** ✅
- (Optional) **Webhook lanes** if the app receives Slack/Jira/etc. callbacks.

## 7. Verify (2 minutes)
```bash
# A) Spoof test — forged super-admin, no signature → must be BLOCKED (gate page)
curl -s -L -H "x-luxos-user-email: a@evil.com" -H "x-luxos-user-roles: super_admin" \
  "https://<repo>-pergolux-gmbh.vercel.app/app/<APP_ID>" | grep -ci "open via luxos"   # expect 1
```
- B) From the LuxOS portal (logged in), click the app tile → URL bar shows
  `luxos.pergolux.global/app/<APP_ID>` and the app loads.
  - If you get "Open via LuxOS" *while logged in* → the two `LUXOS_GATEWAY_SECRET`
    values differ. Re-set them identically and redeploy.
- C) Assign roles to the people who need it (in LuxOS and/or the app's admin).
  Grants take effect on their **next sign-in**.

## Done
The app is live in LuxOS at `luxos.pergolux.global/app/<APP_ID>`, deployed from your
Vercel account, secured by the gateway HMAC, and gated by the CI/CD pipeline.

### If something's off — see the triage table in `04-CHECKLIST.md`.
