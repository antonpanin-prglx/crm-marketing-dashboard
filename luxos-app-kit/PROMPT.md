# 📋 Drop-in prompt for Claude Code — integrate this app into LuxOS

> **How to use:** copy everything between the `--- START ---` and `--- END ---`
> lines below and paste it into Claude Code, running inside your app's repo.
> Claude will adapt your existing app to LuxOS's gateway + RBAC model, wire up
> the CI/CD security gate, and walk you through the manual steps at the end.
>
> If you also dropped the rest of this `luxos-app-kit/` folder into your repo,
> Claude can read the companion guides (`01-`…`06-`) and `templates/` for exact
> code. The prompt works without them too.

---START---

You are integrating THIS existing app into **LuxOS**, Pergolux's SSO gateway/front
door. Do NOT rebuild the app. Adapt it to follow the exact pattern below, in small
verifiable steps. After each step, build the app and report status before moving on.
Ask me for any value you can't infer (the app id, the LuxOS URL). Never run
`vercel deploy` / `vercel --prod` — deployment happens ONLY through the gated CI/CD
pipeline (branch → PR → security gate passes → merge → auto-deploy).

## The model (read first)
- LuxOS authenticates every user (SSO) and decides who may OPEN this app.
- Users reach this app only at `https://luxos.pergolux.global/app/<APP_ID>` — LuxOS
  proxies that to this app. This app has **no login of its own** — delete/disable any.
- On every proxied request LuxOS sends trusted identity headers:
  `x-luxos-user-email`, `x-luxos-user-name`, `x-luxos-user-roles` (comma-separated),
  plus a signature: `x-luxos-gateway-ts` and `x-luxos-gateway-sig`.
- The signature is `HMAC-SHA256( "v1\n<app-id>\n<email>\n<roles>\n<ts>", LUXOS_GATEWAY_SECRET )`
  encoded base64url, where `<app-id>` is this app's slug. **You must verify it** —
  otherwise anyone could forge the identity headers and impersonate a super-admin.
  Binding `<app-id>` means a signature minted for another app (all apps share the
  secret) can't be replayed here. The shared secret never travels on the wire; only
  the signature does. Verify using THIS app's own id (derive it from
  `NEXT_PUBLIC_BASE_PATH`), never an id taken from a header.
- **Split RBAC:** LuxOS owns auth + coarse "can this person open the app". THIS app
  owns fine-grained roles (its own per-email role store + an admin UI to assign them).

## Step 0 — Decide where this app runs (do this FIRST, then pause for the human)
LuxOS proxies any HTTPS URL, so this app can run on Vercel (serverless) OR on a
long-running host (Railway/Fly/Render/container). The right answer depends on THIS
app's runtime shape. **Analyze the codebase** and look for serverless-incompatibility
signals:
- background loops / schedulers: `setInterval`, `setTimeout` loops, `node-cron`,
  any "worker that stays running"
- in-memory state used as a cache/store (module-level `Map`/object/LRU)
- local-filesystem storage: `fs.writeFile`/`readFile` used as a DB, a JSON/role file, disk uploads
- jobs that can run longer than ~300s; queues; WebSockets / long-lived SSE

Then print a short, app-specific report:
1. **What you found** (quote the files/lines: e.g. "daily cron in `src/jobs/x.ts`,
   in-memory cache in `src/cache.ts`, role file at `data/roles.json`").
2. **Recommendation** with reasoning:
   - *Stateless* (no signals above, jobs <5 min) → **Vercel** is a great fit.
   - *Stateful* (any signal above) → a **long-running host** is lower-effort and more
     reliable; going Vercel-native would require refactors (cron→Vercel Cron, file→KV,
     cache→KV) for no integration benefit.
3. **Both options with honest pros/cons** (summarize from `06-HOSTING.md` if present):
   - *Vercel:* ✅ zero-ops, autoscale, PR previews, same team as LuxOS · ⚠️ no
     background processes, no persistent memory/filesystem, ~300s function cap, cron
     refactor needed.
   - *Long-running host:* ✅ runs as-is (cron/memory/files/websockets/long jobs) ·
     ⚠️ you own uptime/scaling/cost, separate deploy target (CI/security gate is still
     identical in GitHub).
4. **STOP and ask the human to choose.** Do not assume Vercel.

Everything in Steps 1–6 is **host-agnostic** — implement them regardless of the
choice. Only the deploy/go-live (handled by the human, runbook `05-`) differs by host:
Vercel auto-deploys on merge; a long-running host deploys via its own pipeline after
the GitHub gate is green. Either way the app sets `NEXT_PUBLIC_BASE_PATH`,
`LUXOS_GATEWAY_SECRET`, `LUXOS_URL` and is registered in LuxOS by its HTTPS URL.

**If the human picks Vercel AND the app has a scheduled job**, also set up/verify the
Vercel Cron config (see `06-HOSTING.md` → "Vercel Cron"): a `crons` entry in
`vercel.json` whose `path` **includes the basePath** (`/app/<APP_ID>/api/...` — a bare
`/api/...` cron fires into a 404), a route guarded by `CRON_SECRET`
(`Authorization: Bearer`), and a job that completes within ~300s (chunk it otherwise).
Report whether each is present/correct and fix what's missing.

## Step 1 — Gateway identity (the security core)
Create `src/lib/gatewayAuth.ts` (adapt path to this app's layout). It must:
1. Read the headers above.
2. Verify the HMAC over `email\nroles\nts` with `process.env.LUXOS_GATEWAY_SECRET`
   using a **timing-safe** compare, and reject if the timestamp is older than 5
   minutes (replay protection). If `LUXOS_GATEWAY_SECRET` is unset, log a loud
   warning and (only then) skip verification — so nothing breaks before the secret
   is configured. Once set, enforce strictly.
3. Look up the user's role in THIS app's own role store by verified email. If found,
   that role WINS. If not found, fall back to a sensible default derived from their
   LuxOS roles (so first-time users aren't locked out).
4. Return `{ email, name, role }` or `null`.

Reference implementation (Next.js App Router — adapt to your framework/role model):

```ts
import { headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/roles";        // YOUR app's role union
import { getRole } from "@/lib/roleStore";       // YOUR app's per-email role lookup

const MAX_SKEW_MS = 5 * 60 * 1000;
const APP_ID = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").split("/").filter(Boolean).pop() ?? ""; // audience

/** Default role for a user with no explicit in-app assignment. Map LuxOS roles
 * (creative|marketing|sales|exec|admin|super_admin) onto YOUR app's roles. */
export function mapLuxosRoles(luxosRoles: string[]): Role {
  const s = new Set(luxosRoles.map((r) => r.trim().toLowerCase()));
  if (s.has("super_admin") || s.has("admin")) return "admin";   // adjust to your top role
  if (s.has("exec")) return "admin";
  return "viewer";                                              // safe default
}

function verified(emailHeader: string, rolesHeader: string, ts: string | null, sig: string | null): boolean {
  const secret = process.env.LUXOS_GATEWAY_SECRET;
  if (!secret) { console.warn("[gatewayAuth] LUXOS_GATEWAY_SECRET unset — identity NOT verified"); return true; }
  if (!ts || !sig) return false;
  const n = Number(ts);
  if (!Number.isFinite(n) || Math.abs(Date.now() - n) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`v1\n${APP_ID}\n${emailHeader}\n${rolesHeader}\n${ts}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type GatewayUser = { email: string; name: string; role: Role };

export async function getGatewayUser(): Promise<GatewayUser | null> {
  const h = await headers();
  const emailHeader = h.get("x-luxos-user-email") ?? "";
  const rolesHeader = h.get("x-luxos-user-roles") ?? "";
  if (!verified(emailHeader, rolesHeader, h.get("x-luxos-gateway-ts"), h.get("x-luxos-gateway-sig"))) return null;
  const email = emailHeader.trim().toLowerCase();
  if (!email) return null;
  const name = h.get("x-luxos-user-name")?.trim() || email;
  const luxosRoles = rolesHeader.split(",").map((r) => r.trim()).filter(Boolean);
  const assigned = await getRole(email);        // in-app role WINS
  return { email, name, role: assigned ?? mapLuxosRoles(luxosRoles) };
}
```

## Step 2 — Use it everywhere; remove your own auth
- At the top of every protected page/route/layout, call `getGatewayUser()`. If it
  returns `null`, render a small **"Open via LuxOS"** page linking to
  `${process.env.LUXOS_URL}/portal` (do not show app content). If it returns a user,
  gate features by `user.role` (server-side checks are authoritative).
- DELETE the app's own login/session/password code. LuxOS owns auth now.
- Keep (or add) an in-app **role-management admin screen** so an admin can set each
  person's role (your `roleStore`). This is your fine-grained RBAC.

## Step 3 — Serve under the gateway path (basePath)
This app must serve under `/app/<APP_ID>`. `<APP_ID>` is a lowercase slug (e.g.
`creative-os`) and **must exactly equal the dashboard id registered in LuxOS** — if
they differ, every request 404s.
- In `next.config.mjs` (or your framework's config), set `basePath` and `assetPrefix`
  to `process.env.NEXT_PUBLIC_BASE_PATH || ""` (empty locally, `/app/<APP_ID>` in prod).
- **Critical gotcha:** `next/link` and the router auto-prepend basePath, but **raw
  `fetch('/api/...')` does NOT.** Find every client-side `fetch("/...")` /
  `EventSource("/...")` and prefix it with `process.env.NEXT_PUBLIC_BASE_PATH ?? ""`.
  A 404 on every API call after mounting = this bug.

## Step 4 — Sign-out
Sign-out must be a **plain link/navigation** to `${LUXOS_URL}/portal` (pass the URL
from a server component as a prop, or use `NEXT_PUBLIC_LUXOS_URL`). Do NOT use a
server-action `redirect()` to the external URL — it doesn't survive the proxy and
shows an error page.

## Step 5 — Env vars (document in .env.example; I'll set real values on Vercel later)
- `NEXT_PUBLIC_BASE_PATH` = `/app/<APP_ID>` (build-time; needs a redeploy to change)
- `LUXOS_GATEWAY_SECRET` = shared HMAC secret (same value LuxOS uses) — **never commit**
- `LUXOS_URL` = `https://luxos.pergolux.global`

## Step 6 — CI/CD security gate
If `.github/workflows/ci.yml`, `.github/workflows/security-gate.yml`,
`.github/scripts/ai-review.mjs`, and `luxos-scan.mjs` are not already present, copy
them verbatim from the template repo **github.com/PERGOLUX-International/pergolux-app-template**
(or from this kit's `templates/` / `03-CICD-AND-GATE.md`). Do not weaken them.

## Step 7 — Verify locally, then open a PR
- Build the app with `NEXT_PUBLIC_BASE_PATH=/app/<APP_ID>` and a dummy
  `LUXOS_GATEWAY_SECRET` set — it must compile and the basePath must take effect.
- Create a feature branch, commit, push, open a PR. **Do not merge** and **do not
  deploy** — the human owner does that after the gate is green.

## Step 8 — Tell me exactly what the LuxOS admin must do (print this checklist)
1. In **GitHub repo settings**: add secrets `ANTHROPIC_API_KEY`, `LUXOS_URL`,
   `SECURITY_GATE_SECRET` (+ `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` if CI
   deploys), and require the gate checks on the production branch (branch protection).
2. On the app's **Vercel project** (Production): set `NEXT_PUBLIC_BASE_PATH=/app/<APP_ID>`,
   `LUXOS_URL=https://luxos.pergolux.global`, and `LUXOS_GATEWAY_SECRET` = the SAME
   value set on the LuxOS project.
3. In **LuxOS → Admin → Dashboards**: register this app — Name (its slug must equal
   `<APP_ID>`), URL = the app's stable `*.vercel.app` production alias, allowed roles,
   mark **Connected**.
4. Merge the PR (gate must be green) → it deploys via the pipeline.
5. Verify: opening the app from the LuxOS portal loads it; a direct request with
   forged `x-luxos-user-roles: super_admin` and no valid signature must hit the
   "Open via LuxOS" gate, not the app.

Work through the steps now. Start with Step 1, build, and report before continuing.

---END---
