// Edge-runtime verifier for the LuxOS identity HMAC. Pairs with middleware.ts.
// Uses WebCrypto (crypto.subtle), so it runs in BOTH the edge middleware and Node
// route handlers — unlike node:crypto (which gatewayAuth.ts uses for App-Router-only
// apps). Keep this importable RELATIVELY from middleware.ts (never via "@/").
//
// Verifies the gateway HMAC, fail-closed. This is a boolean PROVENANCE gate for the
// edge middleware ("did this request really come from LuxOS?") — it accepts v1/v2/v3,
// which is sufficient because the gateway sends ALL signature versions on every request
// (so v3 always verifies). Payloads:
//   v3 — `v3\n<id>\n<email>\n<roles>\n<department>\n<level>\n<country>\n<groups>\n<ts>` (adds country+groups)
//   v2 — `v2\n<id>\n<email>\n<roles>\n<department>\n<level>\n<ts>`                      (dept+level)
//   v1 — `v1\n<id>\n<email>\n<roles>\n<ts>`                                            (back-compat fallback)
// The gateway ALSO sends v4 (per-app role) and v5 (external-guest flag). To READ and
// trust those fields (appRole / isGuest), use `gatewayAuth.ts` per-page — this edge
// gate deliberately doesn't need them (coarse access is already enforced by LuxOS).
// <id> (audience) = the segment after /app/ in LUXOS_BASE_PATH; bind to YOUR own id
// so a signature minted for another app that shares the secret can't be replayed here.

const MAX_SKEW_MS = 5 * 60 * 1000;

/** Hardcode your app id and allow an env override — DON'T rely on a Sensitive env var
 * alone (the prebuilt CI build can't read Sensitive values → empty audience → fail-close
 * everyone). Replace "your-app-id" with your LuxOS dashboard id. */
const APP_ID =
  ((process.env.LUXOS_BASE_PATH ?? "/app/your-app-id").split("/").filter(Boolean).pop()) ?? "";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export type GatewaySig = {
  ts: string | null;
  sigV1: string | null;
  sigV2: string | null;
  sigV3?: string | null;
};

/** True if the request genuinely came from LuxOS (valid, fresh signature).
 * `country`/`groups` are only needed to verify the v3 signature — leave them ""
 * if you don't use them (verification falls back to v2/v1, which the gateway also
 * sends). `groups` is the comma-joined header value, verified verbatim. */
export async function verifyGateway(
  email: string,
  roles: string,
  department: string,
  level: string,
  sig: GatewaySig,
  country = "",
  groups = "",
): Promise<boolean> {
  const secret = process.env.LUXOS_GATEWAY_SECRET;
  if (!secret) {
    // Pre-rollout only: with no secret we cannot verify. Fail CLOSED in production.
    if (process.env.NODE_ENV === "production") {
      console.warn("[luxos-verify] LUXOS_GATEWAY_SECRET unset — refusing (set it on LuxOS + here).");
    }
    return false;
  }
  const { ts, sigV1, sigV2, sigV3 } = sig;
  if (!ts || (!sigV1 && !sigV2 && !sigV3)) return false;
  const n = Number(ts);
  if (!Number.isFinite(n) || Math.abs(Date.now() - n) > MAX_SKEW_MS) return false;
  if (!APP_ID) {
    console.error("[luxos-verify] APP_ID empty — set LUXOS_BASE_PATH / the hardcoded id; refusing.");
    return false;
  }
  // Field-injection guard: fields are "\n"-delimited in the signed payload, so a value
  // containing a line break (\n or \r) could shift field boundaries (canonicalization
  // attack). HTTP headers can't carry raw line breaks, but reject defensively first.
  if ([email, roles, department, level, country, groups].some((f) => /[\r\n]/.test(f))) return false;
  if (sigV3 && timingSafeEqual(await hmac(secret, `v3\n${APP_ID}\n${email}\n${roles}\n${department}\n${level}\n${country}\n${groups}\n${ts}`), sigV3)) {
    return true;
  }
  if (sigV2 && timingSafeEqual(await hmac(secret, `v2\n${APP_ID}\n${email}\n${roles}\n${department}\n${level}\n${ts}`), sigV2)) {
    return true;
  }
  if (sigV1 && timingSafeEqual(await hmac(secret, `v1\n${APP_ID}\n${email}\n${roles}\n${ts}`), sigV1)) {
    return true;
  }
  return false;
}
