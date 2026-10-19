// LuxOS edge gate — Next.js middleware. Runs in the EDGE runtime in front of every
// page and API route: it verifies the LuxOS HMAC and fail-closes (rewrites unverified
// /spoofed/stale requests to the "Open via LuxOS" page) so no route or /api runs for
// an untrusted request. Use this for static/SPA or fully-gated apps. (App-Router apps
// that gate per-page server-side can instead use gatewayAuth.ts and skip middleware.)
//
// ⚠️  IMPORT RELATIVELY, NOT VIA THE "@/" ALIAS.
//     middleware runs in the Edge runtime, and the prebuilt Vercel deploy
//     (`vercel build` → `vercel deploy --prebuilt`) does NOT resolve tsconfig path
//     aliases for the middleware bundle → the deploy FAILS to build the edge function.
//     Relative imports (`./lib/...`) always bundle correctly. This applies to EVERY
//     import middleware.ts pulls in (and anything those pull in transitively).
import { NextRequest, NextResponse } from "next/server";
import { verifyGateway } from "./lib/luxos-verify"; // ← relative, NOT "@/lib/luxos-verify"

export async function middleware(req: NextRequest) {
  const h = req.headers;
  const email = h.get("x-luxos-user-email") ?? "";
  const roles = h.get("x-luxos-user-roles") ?? "";
  const department = h.get("x-luxos-user-department") ?? "";
  const level = h.get("x-luxos-user-level") ?? "";
  // v3 identity (country + groups). Safe to read even if you don't use them — the
  // verifier falls back to v2/v1 when sigV3 is absent.
  const country = h.get("x-luxos-user-country") ?? "";
  const groups = h.get("x-luxos-user-groups") ?? "";
  const ok =
    Boolean(email) &&
    (await verifyGateway(
      email,
      roles,
      department,
      level,
      {
        ts: h.get("x-luxos-gateway-ts"),
        sigV1: h.get("x-luxos-gateway-sig"),
        sigV2: h.get("x-luxos-gateway-sig-v2"),
        sigV3: h.get("x-luxos-gateway-sig-v3"),
      },
      country,
      groups,
    ));

  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/open-via-luxos"; // your gate page
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

// Gate everything except Next internals, static assets, and the gate page itself.
// NOTE: Next PREPENDS basePath to matchers, so include "/" to gate the basePath root
// (a bare /app/<id> would otherwise slip through ungated). Exempt any cron/webhook
// routes that verify their own secret (they don't carry LuxOS identity headers).
export const config = {
  matcher: ["/", "/((?!_next/static|_next/image|open-via-luxos|api/cron|favicon.ico|.*\\.[\\w]+$).*)"],
};
