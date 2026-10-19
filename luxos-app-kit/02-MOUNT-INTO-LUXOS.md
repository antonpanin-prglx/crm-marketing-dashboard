# 2 · Mounting your app under the LuxOS gateway

Users reach your app at **`https://luxos.pergolux.global/app/<APP_ID>`**. LuxOS
proxies that to your deployment's `/app/<APP_ID>` path. Three things have to line up.

## 2.1 Pick an APP_ID (a slug) — and keep it consistent everywhere
`<APP_ID>` is a lowercase, hyphenated slug, e.g. `creative-os`, `sales-room`,
`ops-board`. It appears in **three** places that **must match exactly**:
1. your `NEXT_PUBLIC_BASE_PATH` = `/app/<APP_ID>`
2. the **dashboard id** registered in LuxOS (LuxOS derives the id from the
   dashboard *Name* via slugify — name it so the slug equals `<APP_ID>`)
3. the gateway URL `…/app/<APP_ID>`

> ⚠️ **#1 cause of a post-mount 404:** the LuxOS dashboard id ≠ your basePath
> segment. LuxOS proxies to `<your-origin>/app/<dashboard-id>`; your app only serves
> `/app/<APP_ID>`. If `<dashboard-id>` is `creativeos` but your basePath is
> `creative-os`, every request 404s. They must be byte-for-byte identical.

## 2.2 basePath + assetPrefix
Serve the whole app under the basePath. In `next.config.mjs`:

```js
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""; // "" locally, "/app/<APP_ID>" in prod
const nextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // ...your existing config
};
export default nextConfig;
```

`basePath` is **build-time** — changing the env var requires a redeploy.

## 2.3 The client-`fetch` gotcha (very common)
Next prepends basePath to `next/link`, the router, and `next/image` — but **NOT** to
raw `fetch()`/`EventSource()`. So `fetch('/api/admin/x')` from the browser, when the
app is mounted at `/app/<APP_ID>`, hits `luxos.pergolux.global/api/admin/x` (no
prefix) → **404**. Fix every client-side absolute path:

```ts
// templates/basePath-fetch.ts
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const apiUrl = (path: string) => `${BASE_PATH}${path}`;
// usage: fetch(apiUrl("/api/admin/x"))   // works standalone AND mounted
```

Search your code for `fetch("/`, `` fetch(`/ ``, `EventSource("/` and prefix them.
Server-side fetches that build absolute URLs are fine — this is only client-side
root-relative requests.

## 2.4 Frame/proxy notes
LuxOS proxies server-side (it is **not** an iframe), so `X-Frame-Options: DENY` and a
strict CSP are fine — keep them. Don't add redirects to absolute external URLs from
server actions (they don't survive the proxy); use plain links.

## 2.5 Env vars your app needs (prod)
| Var | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | `/app/<APP_ID>` | build-time; redeploy to change |
| `LUXOS_GATEWAY_SECRET` | shared HMAC secret | **same value as LuxOS**; never commit |
| `LUXOS_URL` | `https://luxos.pergolux.global` | for sign-out / "open via LuxOS" links |

(Plus whatever your app already needs.) The admin sets these on Vercel — see
`04-CHECKLIST.md`. Document them in `.env.example` (see `templates/env.example.snippet`).

## 2.6 Vercel Deployment Protection (optional, defense-in-depth)
The HMAC signature is the real protection, so you don't *need* a paid Vercel plan.
If you're on a plan that supports it, also enable Deployment Protection → "Vercel
Authentication" with **Protection Bypass for Automation** (LuxOS passes the bypass).
On free/standard plans this isn't available for production — the HMAC covers you.
