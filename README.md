# pergolux-app-template

The **single source of truth** for PERGOLUX-International app engineering: the starter
scaffold new apps are created from, **plus** the LuxOS integration kit and org tooling
(previously the separate `pergolux-org-standards` repo — now merged here).

## 1 · Starter scaffold (what "Use this template" gives a new app)
Create a new repo with **"Use this template"** and you start with the standard CI security
suite, the LuxOS security gate, and a baseline `CLAUDE.md` already wired in:
- `.github/workflows/ci.yml` — Semgrep · Trivy · npm-audit · TruffleHog · OSV (advisory) ·
  **AI review (Claude)** · gated Vercel deploy.
- `.github/scripts/ai-review.mjs` — the Claude security reviewer (blocks on critical/high).
- `.github/workflows/security-gate.yml` + `luxos-scan.mjs` — posts a signed verdict to LuxOS
  `/api/security-gate`.
- `.github/dependabot.yml`, `.gitignore`, `.env.example`, `CLAUDE.md` (baseline instructions).

> A freshly-templated app also inherits the `luxos-app-kit/`, `create-app.sh`, and
> `org-ruleset.json` below (they're tracked here). They're harmless in a child repo —
> delete them from the new app if you want it lean; they live **here** as the canonical copy.

### One-time setup for a new app
1. **Secrets** (prefer org-level so every repo inherits): `ANTHROPIC_API_KEY`, `VERCEL_TOKEN`,
   `LUXOS_URL`, `SECURITY_GATE_SECRET`.
2. **Repo variable:** `VERCEL_PROJECT_ID` = this app's Vercel project id (org id is shared).
3. **Branch protection:** require the `AI review (Claude)` and `LuxOS Security Gate` status checks
   on the default branch; no direct pushes.
4. **LuxOS mount:** set `NEXT_PUBLIC_BASE_PATH=/app/<dashboard-id>` and the shared
   `VERCEL_AUTOMATION_BYPASS_SECRET`; register the app in LuxOS Admin → Dashboards.
5. Fill in the **Project-specific** section of `CLAUDE.md`.

## 2 · `luxos-app-kit/` — integrate an EXISTING app into LuxOS
Drop-in kit (SSO gateway + app-level RBAC + CI/CD gate). Hand it to a dev team; they paste
`luxos-app-kit/PROMPT.md` into Claude Code and it retrofits their app. The apply/re-sync
one-liner at the top of `luxos-app-kit/README.md` clones **this repo** to `/tmp` and audits the
app against the kit. Admin/owner go-live steps: `luxos-app-kit/05-GO-LIVE-RUNBOOK.md`.

## 3 · Org tooling
- **`create-app.sh <name>`** — scaffold a new app from this template (`gh repo create
  --template pergolux-app-template`), create + link its Vercel project, set deploy repo
  Variables. One command, fully wired.
- **`org-ruleset.json`** — the branch ruleset (required security checks + PR) applied org-wide.
  Apply/update: `gh api -X PUT /orgs/PERGOLUX-International/rulesets/<id> --input org-ruleset.json`.

The gateway/SSO itself lives in the **`luxos`** repo.

## Notes
- This template does NOT auto-update existing repos. For ongoing sync across all repos, a
  file-sync workflow (e.g. repo-file-sync-action / multi-gitter) would be added later — for now
  devs re-run the `luxos-app-kit` one-liner or copy updates manually.
