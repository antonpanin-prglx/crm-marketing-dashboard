# 4 · End-to-end checklist + verification

`<APP_ID>` = your app's slug (e.g. `creative-os`). It MUST be identical in the
basePath, the LuxOS dashboard id, and the gateway URL.

## A. Developer (in the app repo, via Claude Code + `PROMPT.md`)
- [ ] `getGatewayUser()` added — verifies the HMAC signature + 5-min freshness
- [ ] Every protected page/route calls it; `null` → "Open via LuxOS" page
- [ ] App's own login / session / passwords **removed**
- [ ] In-app per-email role store + admin UI to assign roles; **in-app role wins**
- [ ] `basePath` + `assetPrefix` = `NEXT_PUBLIC_BASE_PATH` in the framework config
- [ ] Every client-side `fetch("/…")` / `EventSource("/…")` prefixed with `NEXT_PUBLIC_BASE_PATH`
- [ ] Sign-out is a plain link to `${LUXOS_URL}/portal` (not a server-action redirect)
- [ ] `.env.example` documents `NEXT_PUBLIC_BASE_PATH`, `LUXOS_GATEWAY_SECRET`, `LUXOS_URL`
- [ ] CI files present (`ci.yml`, `security-gate.yml`, `ai-review.mjs`, `luxos-scan.mjs`)
- [ ] Builds locally with `NEXT_PUBLIC_BASE_PATH=/app/<APP_ID>` set
- [ ] Branch + PR opened — **not merged, not deployed**

## B. LuxOS admin / owner
**GitHub (app repo):**
- [ ] Secrets: `ANTHROPIC_API_KEY`, `LUXOS_URL`, `SECURITY_GATE_SECRET` (+ `VERCEL_*` if CI deploys)
- [ ] Branch protection requires: AI review (Claude), Semgrep, Trivy, npm audit, TruffleHog, LuxOS Security Gate

**Vercel (app project, Production):**
- [ ] `NEXT_PUBLIC_BASE_PATH` = `/app/<APP_ID>`
- [ ] `LUXOS_URL` = `https://luxos.pergolux.global`
- [ ] `LUXOS_GATEWAY_SECRET` = **the exact same value** as on the LuxOS project
      (generate once with `openssl rand -base64 32`; reuse the same value across all apps)

**LuxOS → Admin → Dashboards:**
- [ ] Add dashboard — **Name** chosen so its slug == `<APP_ID>`
- [ ] **URL** = the app's stable production alias, e.g. `https://<app>-pergolux-gmbh.vercel.app`
      (the stable project alias, NOT a one-off `…-<hash>-…` deployment URL)
- [ ] Allowed roles set; mark **Connected**

**Ship:**
- [ ] Merge the green PR → deploys via the pipeline
- [ ] Roles a user should have are assigned in LuxOS; remind them grants take effect
      on their **next sign-in** (LuxOS caches roles in the session)

## C. Verify it works (run these)
Replace `<APP>` with the app's stable alias and `<APP_ID>` accordingly.

```bash
# 1) Direct, forged super-admin headers, NO valid signature → must be BLOCKED
#    (should return the "Open via LuxOS" gate, NOT app content)
curl -s -L -H "x-luxos-user-email: a@evil.com" -H "x-luxos-user-roles: super_admin" \
  "https://<APP>.vercel.app/app/<APP_ID>" | grep -ci "open via luxos"   # expect 1

# 2) Through LuxOS (you, logged in): open the app tile in the portal.
#    URL bar must read  luxos.pergolux.global/app/<APP_ID>  and the app must load.
#    If you get the "Open via LuxOS" gate while logged in → the two
#    LUXOS_GATEWAY_SECRET values don't match. Re-sync them.

# 3) Role check: set a teammate to viewer/user in the app's admin → it sticks
#    (they don't silently become admin).

# 4) Sign-out returns to the LuxOS portal with no error page.
```

### Ship the fail-closed regression test (required)
Curl #1 above only proves the gate holds *right now, with the secret set*. It says
nothing about the case that has actually bitten us: the secret going **missing** (a new
environment, a typo, a rollback, or a Vercel **Sensitive** var the prebuilt CI build
can't read). Copy `templates/auth_bypass.test.js` into the app's `test/` directory, wire
up the one marked ADAPT block, and add it to `package.json`:

```json
"scripts": { "test": "node test/auth_bypass.test.js" }
```

- [ ] `templates/auth_bypass.test.js` copied in and passing (`npm test`)
- [ ] It runs in CI on every PR, so a regression fails the build

It asserts the resolver returns `null` when `LUXOS_GATEWAY_SECRET` is unset or empty in
**every** `NODE_ENV`, rejects unsigned / wrongly-signed / stale requests, and — as a
positive control — still accepts a genuine signed request, so the suite can't pass
vacuously by rejecting everything.

## Common failures (fast triage)
| Symptom | Cause | Fix |
|---|---|---|
| 404 on the whole app via LuxOS | dashboard id ≠ basePath segment | make LuxOS id == `<APP_ID>` (delete+re-add dashboard) |
| 404 on every API call / sub-tab | client `fetch('/api/…')` not basePath-prefixed | prefix with `NEXT_PUBLIC_BASE_PATH` |
| "Open via LuxOS" even when logged in | `LUXOS_GATEWAY_SECRET` mismatch (or unset on one side) | set the identical value on both Vercel projects + redeploy |
| App refuses every request ("Open via LuxOS" for everyone) | `LUXOS_GATEWAY_SECRET` unset on the app — verification fails **closed**, as it must | set it (byte-identical to LuxOS) + redeploy. The secret is **required**, never optional: with no key there is nothing to verify, so the app must reject rather than trust the headers |
| Everyone is admin | in-app role not consulted (LuxOS mapping always used) | in-app `getRole(email)` must win over `mapLuxosRoles` |
| Sign-out shows an error page | server-action redirect to external URL through the proxy | use a plain link to `${LUXOS_URL}/portal` |
| Root `*.vercel.app/` 404 | basePath moved the app to `/app/<APP_ID>` | expected — that's not the user path; test via LuxOS |
