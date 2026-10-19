# CLAUDE.md — PERGOLUX app (baseline)

> Baseline instructions for Claude Code in any PERGOLUX-International app repo.
> Keep this section intact; add a **Project-specific** section at the bottom for this app.

## Org context
- All infra lives under the **PERGOLUX-International** GitHub org, the **pergolux-gmbh** Vercel
  team, and the **it.admin@pergolux.de** owner account — **never personal accounts**.
- Apps are served to users **through the LuxOS gateway** (`luxos.pergolux.global`), not via their
  own public domains. The app's `*.vercel.app` URL is publicly reachable, so trust is established
  per-request: LuxOS proxies in the user's identity headers **plus an HMAC signature** keyed by the
  shared `LUXOS_GATEWAY_SECRET`. **The signature — not network reachability — is what makes the
  identity trustworthy.** Vercel Deployment Protection is optional defense-in-depth only (and on
  standard plans applies to preview, not production); never rely on it for identity.

## Hard rules
- **Never commit secrets.** Use `.env.local` (gitignored) for dev, Vercel project env vars for
  runtime, and GitHub **org** secrets for CI (`ANTHROPIC_API_KEY`, `VERCEL_TOKEN`). `.env.example`
  is the only env file that may be committed (placeholders only).
- **Open-source-ready: keep ALL company-identifying data out of source.** No real emails,
  domains, person names, product names, or account/folder/project IDs hardcoded in code, configs,
  seed data, or comments. Everything specific comes from **env vars** (with generic `@example.com` /
  `example.com` / `your-org` placeholders in `.env.example`). Vercel org/project IDs go in GitHub
  **repo Variables** (`vars.VERCEL_ORG_ID` / `vars.VERCEL_PROJECT_ID`), never in `ci.yml`. The goal:
  this repo could be made public right now with nothing internal leaking.
- **Default branch is protected** — no direct pushes. All changes via PR; the CI security suite +
  AI review must pass before merge/deploy. Never weaken or bypass the security gate.
- **Commit messages** end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Commit/push only when asked. Branch first if on the default branch.

## CI / security (provided by this template)
- `.github/workflows/ci.yml` — Semgrep, Trivy, npm-audit, TruffleHog, OSV (advisory),
  **No demo/dummy data**, **AI review (Claude)**, then a gated Vercel deploy. The AI
  review blocks only on **critical/high** issues; it fail-opens if `ANTHROPIC_API_KEY`
  is unset.
- **Never ship demo/dummy/mock/placeholder data.** LuxOS apps must render real data
  from the gateway/upstream APIs. `.github/scripts/check-no-demo-data.mjs` scans source
  and **blocks deploy** on any mock/dummy/placeholder/seed markers. A genuine dev-only,
  env-gated fallback can be marked with a `luxos:allow-demo-data` comment (logged), but
  the default is: it does not go to production.
- `.github/workflows/security-gate.yml` + `luxos-scan.mjs` — posts a signed verdict to LuxOS
  `/api/security-gate`; make it a **required status check** on the default branch.
- To enable deploy: set org secret `VERCEL_TOKEN` and repo variable `VERCEL_PROJECT_ID`.

## Mounting this app into LuxOS (path-zone)
- Set `NEXT_PUBLIC_BASE_PATH=/app/<dashboard-id>` so `basePath`/`assetPrefix` line up with the
  gateway path. The `<dashboard-id>` MUST equal the id registered in LuxOS Admin → Dashboards.
- Set the shared **`LUXOS_GATEWAY_SECRET`** — the exact same value as on the LuxOS project. This
  is the secret the identity HMAC is keyed by; without it (byte-identical) you can't verify, and
  must fail closed.
- **Verify the HMAC before trusting any `x-luxos-user-*` header.** Drop in the kit's
  `luxos-app-kit/templates/` — `middleware.ts` + `luxos-verify.ts` (edge gate) or `gatewayAuth.ts`
  (per-page App Router). They verify v3→v2→v1, are audience-bound to your app id, and fail closed.
  ⚠️ `middleware.ts` and anything it imports MUST use **relative** imports, never the `@/` alias —
  the prebuilt edge bundle doesn't resolve tsconfig aliases and the deploy fails.
- Client-side `fetch('/api/…')` must be prefixed with `NEXT_PUBLIC_BASE_PATH` (basePath isn't
  applied to raw fetch) or it 404s under the gateway. Vite SPAs also need a `vercel.json` rewrite
  to serve under `/app/<id>` (Next apps don't) — see `luxos-app-kit/06-HOSTING.md`.
- Webhook endpoints external services call without a session go through LuxOS **webhook lanes**
  (provider-signature verified at the gateway) — keep those endpoints idempotent.

## Working style
- Match existing code conventions. Prefer reusing helpers over adding new ones.
- Run typecheck/build before declaring done. Report failures honestly.

---

## Project-specific
<!-- Describe THIS app: what it is, its dashboard id, key env vars, gotchas. -->
