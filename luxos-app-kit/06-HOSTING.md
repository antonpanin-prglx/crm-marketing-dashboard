# 6 · Where should this app run? (Vercel vs a long-running host)

LuxOS does **not** care where your app runs — its gateway proxies to **any HTTPS
URL** and verifies identity with the shared HMAC. So pick the host that fits the
app's *runtime shape*, not the integration. Both options use the same RBAC,
gateway, and CI/CD gate from this kit; only the **deploy target** differs.

## How to decide — scan your code for these signals
If your app has **any** of these, it's a poor fit for Vercel's serverless model and
a long-running host is usually the lower-effort, more reliable choice:

| Signal in the code | Why it breaks on Vercel serverless |
|---|---|
| `setInterval` / `node-cron` / a process that "stays running" | functions are invoked per-request and then frozen/killed — nothing runs in the background |
| In-memory cache / state held in a module variable (`const cache = new Map()`) | each invocation may be a fresh instance; memory isn't shared or persisted |
| Reads/writes a local file as storage (a JSON "db", a role file, uploads to disk) | the filesystem is read-only / ephemeral on serverless |
| A job that runs **longer than ~300s** | function max duration is ~300s (Fluid Compute) |
| WebSockets / long-lived SSE / streaming workers | serverless connections are short-lived |
| Heavy cold-start-sensitive work, large in-memory models | cold starts + no warm state |

If it's **stateless request/response** (talks to a DB/KV, no background loops, no
local files, jobs < 5 min), Vercel is a great fit.

## Option A — Vercel (serverless)
**Good for:** stateless apps; teams that want zero-ops + preview deploys; staying in
the same team/billing as LuxOS.

✅ Pros
- Zero infra to run; autoscales to zero; cheap/free
- Git-integrated: PR previews, auto-deploy on merge (fits our pipeline cleanly)
- Same Vercel team as LuxOS; simple env management

⚠️ Cons / what you must change
- **No background processes.** Cron must become **Vercel Cron** (a scheduled hit to
  an API route), and the job must finish in ~300s (chunk it if longer; Hobby cron is
  once/day, Pro any frequency).
- **No persistent memory or local files.** Move any file "db" / role file and any
  in-memory cache to **KV / Postgres / Redis** (a marketplace store).
- Net: expect to refactor cron → Vercel Cron, file/cache → KV. Worth it only if the
  app is otherwise serverless-friendly.

### Vercel Cron — get these three right (mounted apps trip on #1)
If you go Vercel AND keep a scheduled job, verify in `vercel.json`:
1. **The `path` includes the basePath.** The app is mounted at `/app/<APP_ID>`, so an
   API route lives at `/app/<APP_ID>/api/...`. A cron pointed at `/api/cron` will fire
   into a **404** (same gotcha as client `fetch`). Use:
   ```json
   { "crons": [{ "path": "/app/<APP_ID>/api/cron/daily", "schedule": "0 6 * * *" }] }
   ```
2. **The route is protected.** Set a `CRON_SECRET` env var; Vercel sends it as
   `Authorization: Bearer $CRON_SECRET` on cron runs — verify it at the top of the
   route and return 401 otherwise (it's a public URL, so randoms could hit it).
3. **The job fits ~300s** (function max). If longer: make it idempotent and process a
   batch per run, use Vercel Queues, or move just that worker to a long-running host.
   Remember Hobby allows one cron, once/day; Pro any frequency.

## Option B — Long-running host (Railway / Fly.io / Render / a container)
**Good for:** apps with crons, in-memory caches, local files, long jobs, websockets,
or anything that expects a process that stays up.

✅ Pros
- Run the app **as-is** — real background jobs/cron, persistent memory + filesystem,
  no function timeout, websockets all work
- No serverless refactor

⚠️ Cons
- You own uptime/scaling/monitoring (a always-on instance costs more than scale-to-zero)
- A separate deploy target from LuxOS (but **the GitHub CI/security gate is identical** —
  it's host-agnostic)
- It must serve HTTPS and verify the LuxOS HMAC (it won't have Vercel Deployment
  Protection — which is fine, the HMAC is the real protection)

## What's identical either way
- App-level RBAC + `getGatewayUser()` HMAC verification (`01-`)
- Serving under `/app/<APP_ID>` (basePath) + the client-`fetch` prefix (`02-`)
- The CI/CD security gate + AI review (`03-`) — runs in GitHub regardless of host
- Registering in LuxOS → Admin → Dashboards with the app's HTTPS URL (`04-`/`05-`)

## What differs: deploy + go-live
- **Vercel:** import the repo into the Pergolux Vercel team; merge → auto-deploy;
  register the `*.vercel.app` URL. (Runbook `05-GO-LIVE-RUNBOOK.md`.)
- **Long-running host:** deploy on the host (its own pipeline, triggered after the
  GitHub gate is green); set `NEXT_PUBLIC_BASE_PATH`, `LUXOS_GATEWAY_SECRET`,
  `LUXOS_URL` there; then register the host's HTTPS URL in LuxOS exactly the same way.

> Rule of thumb: **stateless → Vercel; stateful/cron/long-running → a long-running
> host.** Don't refactor a working stateful app onto serverless just to use Vercel —
> there's no integration benefit, LuxOS proxies both identically.
