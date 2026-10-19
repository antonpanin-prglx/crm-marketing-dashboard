# 1 · App-level RBAC + gateway identity (the security core)

## How identity reaches your app
Your app is never opened directly. LuxOS authenticates the user (WorkOS SSO),
checks they're allowed to open your app, then **proxies** the request to your
deployment, injecting:

| Header | Example | Meaning |
|---|---|---|
| `x-luxos-user-email` | `jane@pergolux.de` | verified identity (trust this for RBAC) |
| `x-luxos-user-name` | `Jane Doe` | display only |
| `x-luxos-user-roles` | `creative,marketing` | the user's LuxOS roles (7 legacy keys) |
| `x-luxos-user-department` | `Sales` | the user's **org department** (LuxOS taxonomy) |
| `x-luxos-user-level` | `senior` | **seniority level**: `associate · professional · senior · leader · c_suite` |
| `x-luxos-user-country` | `Germany` | the user's country (v3) |
| `x-luxos-user-groups` | `dach,leadership` | the user's LuxOS groups, comma-joined (v3) |
| `x-luxos-gateway-ts` | `1718635200000` | signing timestamp (ms) |
| `x-luxos-gateway-sig` | `base64url(hmac)` | v1 proof (covers email + roles) |
| `x-luxos-gateway-sig-v2` | `base64url(hmac)` | v2 proof (also covers department + level) |
| `x-luxos-gateway-sig-v3` | `base64url(hmac)` | v3 proof (also covers country + groups) |

> **Department + Level is the company RBAC taxonomy.** Use it to gate by org structure
> (e.g. "Sales, Senior+"), the same way LuxOS gates which apps a person can open. The 7
> legacy roles still flow for back-compat / per-feature mapping.

## Why you MUST verify the signature
Your app's `*.vercel.app` URL is publicly reachable (the org plan can't lock down
production deployments). Without verification, **anyone** could send
`x-luxos-user-roles: super_admin` (or `x-luxos-user-level: c_suite`) straight to your
app and get admin. The signature closes that. There are three signed payloads — the
gateway sends all three; **verify whichever covers the fields you read** (prefer the
highest you need):

```
v1 = HMAC-SHA256( "v1\n<app-id>\n<email>\n<roles>\n<ts>",                                            LUXOS_GATEWAY_SECRET )  // → x-luxos-gateway-sig
v2 = HMAC-SHA256( "v2\n<app-id>\n<email>\n<roles>\n<department>\n<level>\n<ts>",                     LUXOS_GATEWAY_SECRET )  // → x-luxos-gateway-sig-v2
v3 = HMAC-SHA256( "v3\n<app-id>\n<email>\n<roles>\n<department>\n<level>\n<country>\n<groups>\n<ts>", LUXOS_GATEWAY_SECRET )  // → x-luxos-gateway-sig-v3
```

Each version is additive: v2 binds department + level, v3 also binds country + groups,
so those headers are tamper-proof. Apps that don't need the extra fields can keep
verifying v2 (or even v1) only — all three are sent on every request. The kit's
`luxos-verify.ts` / `gatewayAuth.ts` verify v3→v2→v1 and accept the first that matches.
LuxOS and your app
share `LUXOS_GATEWAY_SECRET` (an env var on both); LuxOS sends the **signature**, never
the secret. Recompute the HMAC and compare (timing-safe). The `<app-id>` binds the
signature to *one* app — since all apps share the secret, this stops a signature
captured for app A from being replayed to app B. Verify with your OWN id (derive it
from `NEXT_PUBLIC_BASE_PATH`), never an id read from a header. If neither signature
matches, or the timestamp is older than 5 minutes (replay protection), the request is
**not** trusted → treat the user as anonymous and show "Open via LuxOS".

> Verify against the **raw** header values (exactly what LuxOS signed), then
> normalize (lowercase the email) for your own lookups.

See `templates/gatewayAuth.ts` for the full drop-in (Next.js App Router, `node:crypto`).
The logic is framework-agnostic: read headers → verify HMAC + freshness → map identity → role.

### Edge middleware variant (static/SPA or fully-gated apps)
For apps that gate at the edge instead of per-page, use `templates/middleware.ts` +
`templates/luxos-verify.ts` (WebCrypto, runs in the edge runtime). It fail-closes
unverified requests to `/open-via-luxos` before any route/`/api` runs.

> ⚠️ **Edge gotcha — import RELATIVELY, never via the `@/` alias.** `middleware.ts` runs
> in the Edge runtime, and the prebuilt Vercel deploy (`vercel build` → `vercel deploy
> --prebuilt`) does **not** resolve tsconfig path aliases for the middleware bundle —
> `import … from "@/lib/luxos-verify"` makes the **edge function fail to build/deploy**.
> Use `import … from "./lib/luxos-verify"`. This applies to every import middleware
> pulls in (and their transitive imports). (Bit creative-os-style apps; fixed in the
> live fleet 2026-06.)

## Split RBAC: two layers (this is how "users only see what's meant for them")
- **Layer 1 — LuxOS decides *whether* a person can open your app.** Coarse entry
  control, enforced centrally at the gateway: a dashboard is registered with
  `allowedRoles` and/or `allowedDepartments` + `minLevel`. If the user doesn't qualify,
  **LuxOS never proxies to your app** — it redirects them to the portal. So a user
  literally cannot reach an app that isn't meant for them, and you get this for free.
- **Layer 2 — your app decides *what they can do inside*** — your own per-email role
  store (e.g. `viewer | user | admin | superadmin`) for fine-grained features, AND/OR
  the org `department` + `level` from `getGatewayUser()` to gate by org structure
  consistently with the rest of the company (e.g. show the management view only to
  `level ≥ leader`). Use `levelAtLeast(user.level, "leader")` and `user.department`.

Both layers use the **same** Department + Level taxonomy, so access stays consistent
across every app: register the dashboard's allowed departments/level in LuxOS (Layer 1),
and gate the matching in-app features off `getGatewayUser()` (Layer 2).

`getGatewayUser()` resolves the effective role like this:
1. Look up the email in **your** role store. If assigned → **that role wins.**
2. If not assigned → fall back to `mapLuxosRoles(luxosRoles)` — a sensible default
   from their LuxOS roles, so a brand-new user isn't locked out and a LuxOS
   super-admin can bootstrap.

This is why "set someone to viewer in the app and it sticks" works — the in-app
assignment overrides the default mapping. (Getting this backwards — always trusting
the LuxOS mapping — is the "everyone is auto-admin" bug.)

## Remove the app's own login
LuxOS owns the session. Delete the app's login page, password handling, and any
self-managed session cookie. The only identity source is `getGatewayUser()`. Keep
your **role-assignment admin UI** (that's RBAC, not auth).

## The "Open via LuxOS" gate
When `getGatewayUser()` returns `null` (opened directly / unsigned / stale), don't
render app content — render a tiny page that links to `${LUXOS_URL}/portal`. It's
both good UX and a clear signal the request didn't come through the gateway.

## Sign-out
A plain link/navigation to `${LUXOS_URL}/portal`. **Not** a server-action
`redirect()` to that external URL — that errors through the proxy. Pass `LUXOS_URL`
to client components as a prop (from a server component) or via `NEXT_PUBLIC_LUXOS_URL`.
