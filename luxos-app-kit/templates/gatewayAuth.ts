// Drop-in gateway identity + RBAC for a LuxOS-mounted app (Next.js App Router).
// Adapt the two imports marked TODO to your app's role model + role store.
//
// What it does: verifies the LuxOS HMAC signature over the identity headers
// (so they can't be spoofed), then resolves the user's effective identity:
//   - role        — your in-app assignment wins; the LuxOS-role mapping is the default
//   - department  — the user's org department (LuxOS taxonomy), e.g. "Sales"
//   - level       — seniority: associate | professional | senior | leader | c_suite
//   - country     — the user's country (v3), or null
//   - groups      — the user's LuxOS groups (v3), [] if none
//   - appRole     — this user's role ON THIS APP (v4): admin | dev | member
//   - isGuest     — true for an EXTERNAL guest (v5): partner/contractor, not staff
// department + level (+ country/groups/appRole/isGuest) let every app apply the SAME
// org RBAC LuxOS uses. Gate features on them (see the examples at the bottom).

import { headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

// TODO: your app's role union, e.g. "superadmin" | "admin" | "user" | "viewer"
import type { Role } from "@/lib/roles";
// TODO: your per-email role lookup → Promise<Role | null> (null = not assigned)
import { getRole } from "@/lib/roleStore";

/** Reject signatures older than this — replay protection. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** This app's id (audience) — the segment after /app/ in the basePath. LuxOS
 * binds the signature to it so a signature minted for another app that shares
 * the secret can't be replayed here. */
const APP_ID = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").split("/").filter(Boolean).pop() ?? "";

/** LuxOS seniority levels, lowest → highest. Use `levelAtLeast` to gate by a minimum. */
export const LEVEL_RANK: Record<string, number> = {
  associate: 1,
  professional: 2,
  senior: 3,
  leader: 4,
  c_suite: 5,
};
export function levelAtLeast(userLevel: string | null | undefined, minLevel: string): boolean {
  return (LEVEL_RANK[userLevel ?? ""] ?? 0) >= (LEVEL_RANK[minLevel] ?? 0);
}

/**
 * Default role for a user who has NO explicit in-app assignment yet.
 * Map LuxOS roles (creative|marketing|sales|exec|admin|super_admin) onto YOUR roles.
 * Keep the default conservative; promote people via your in-app admin UI.
 *
 * NOTE: external guests (partner/contractor allowlist) arrive with an EMPTY role set
 * (and null department/level) — so `[]` MUST fall through to your least-privileged role.
 * Keep the `return "viewer"` last line; never grant access for an empty set.
 */
export function mapLuxosRoles(luxosRoles: string[]): Role {
  const s = new Set(luxosRoles.map((r) => r.trim().toLowerCase()));
  if (s.has("super_admin") || s.has("admin")) return "superadmin"; // TODO adjust
  if (s.has("exec")) return "admin";
  if (s.has("creative")) return "admin";
  if (s.has("marketing")) return "user";
  return "viewer"; // guests (empty roles) + unmapped staff land here — least privilege
}

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
function eq(expected: string, sig: string): boolean {
  const x = Buffer.from(expected);
  const y = Buffer.from(sig);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Fields = {
  email: string; roles: string; department: string; level: string; country: string;
  groups: string; appRole: string; guest: string; ts: string | null;
  sigV1: string | null; sigV2: string | null; sigV3: string | null; sigV4: string | null; sigV5: string | null;
};

/**
 * Returns the HIGHEST LuxOS signature version present AND valid (0 = none/invalid).
 * The gateway sends v1–v5 on every request; we accept the highest that verifies, so a
 * newer field is trustworthy only when its version verified. Each version adds fields:
 *   v1 `…\n<email>\n<roles>\n<ts>`                 v2 `…\n<department>\n<level>\n<ts>`
 *   v3 `…\n<country>\n<groups>\n<ts>`              v4 `…\n<appRole>\n<ts>`  (per-app role)
 *   v5 `…\n<appRole>\n<guest>\n<ts>`               (external-guest flag)
 * Headers: v1 `x-luxos-gateway-sig`, v2–v5 `x-luxos-gateway-sig-v{n}`.
 */
function verifiedVersion(f: Fields): number {
  const secret = process.env.LUXOS_GATEWAY_SECRET;
  // Fail CLOSED whenever the secret is unset/empty — NEVER verify without it. An empty
  // key would otherwise compute a "valid" HMAC for forged headers, and keying the
  // decision off NODE_ENV is fragile (a misconfigured prod env would fail open). Set the
  // secret in every environment you want the gate to work in (it's required anyway).
  if (!secret) {
    console.warn("[gatewayAuth] LUXOS_GATEWAY_SECRET unset — refusing (set it on LuxOS and here).");
    return 0;
  }
  const { email, roles, department, level, country, groups, appRole, guest, ts } = f;
  if (!ts || !(f.sigV1 || f.sigV2 || f.sigV3 || f.sigV4 || f.sigV5)) return 0;
  const n = Number(ts); // freshness / replay window
  if (!Number.isFinite(n) || Math.abs(Date.now() - n) > MAX_SKEW_MS) return 0;
  // Fail closed if our audience id is missing (NEXT_PUBLIC_BASE_PATH misconfigured).
  if (!APP_ID) { console.error("[gatewayAuth] APP_ID empty — NEXT_PUBLIC_BASE_PATH not set; refusing."); return 0; }
  // Field-injection guard: fields are "\n"-delimited in the signed payload, so reject any
  // value containing a line break (\n or \r) before verifying — prevents field-boundary
  // shifting. (HTTP headers can't carry raw line breaks; this is defense-in-depth.)
  if ([email, roles, department, level, country, groups, appRole, guest].some((v) => /[\r\n]/.test(v))) return 0;
  const id = APP_ID;
  // Prefer the richest that verifies (v5 → v1).
  if (f.sigV5 && eq(hmac(secret, `v5\n${id}\n${email}\n${roles}\n${department}\n${level}\n${country}\n${groups}\n${appRole}\n${guest}\n${ts}`), f.sigV5)) return 5;
  if (f.sigV4 && eq(hmac(secret, `v4\n${id}\n${email}\n${roles}\n${department}\n${level}\n${country}\n${groups}\n${appRole}\n${ts}`), f.sigV4)) return 4;
  if (f.sigV3 && eq(hmac(secret, `v3\n${id}\n${email}\n${roles}\n${department}\n${level}\n${country}\n${groups}\n${ts}`), f.sigV3)) return 3;
  if (f.sigV2 && eq(hmac(secret, `v2\n${id}\n${email}\n${roles}\n${department}\n${level}\n${ts}`), f.sigV2)) return 2;
  if (f.sigV1 && eq(hmac(secret, `v1\n${id}\n${email}\n${roles}\n${ts}`), f.sigV1)) return 1;
  return 0;
}

export type GatewayUser = {
  email: string;
  name: string;
  role: Role;
  /** Org department (e.g. "Sales"), or null if the user has none set in LuxOS. */
  department: string | null;
  /** Seniority level (associate…c_suite), or null. Compare with `levelAtLeast`. */
  level: string | null;
  /** Country (v3), or null if unset / the gateway only sent v1/v2. */
  country: string | null;
  /** LuxOS groups (v3), [] if none / the gateway only sent v1/v2. */
  groups: string[];
  /** This user's role ON THIS APP (v4): "admin"/"dev" for the app's board admins/devs,
   * else "member". "member" if only v1–v3 verified. */
  appRole: "admin" | "dev" | "member";
  /** True for an EXTERNAL guest (v5) — partner/contractor, not staff. false for staff
   * OR when only v1–v4 verified (unverified → treated as non-guest; guests still land on
   * your least-privileged role via mapLuxosRoles([]), so this only ADDS restriction). */
  isGuest: boolean;
};

/** The current user as asserted by the trusted LuxOS gateway, or null. */
export async function getGatewayUser(): Promise<GatewayUser | null> {
  const h = await headers();
  // Verify against the RAW header values (exactly what LuxOS signed).
  const emailHeader = h.get("x-luxos-user-email") ?? "";
  const rolesHeader = h.get("x-luxos-user-roles") ?? "";
  const deptHeader = h.get("x-luxos-user-department") ?? "";
  const levelHeader = h.get("x-luxos-user-level") ?? "";
  const countryHeader = h.get("x-luxos-user-country") ?? "";
  const groupsHeader = h.get("x-luxos-user-groups") ?? "";
  const appRoleHeader = h.get("x-luxos-app-role") ?? "";
  const guestHeader = h.get("x-luxos-user-guest") ?? "";
  const ver = verifiedVersion({
    email: emailHeader, roles: rolesHeader, department: deptHeader, level: levelHeader,
    country: countryHeader, groups: groupsHeader, appRole: appRoleHeader, guest: guestHeader,
    ts: h.get("x-luxos-gateway-ts"),
    sigV1: h.get("x-luxos-gateway-sig"),
    sigV2: h.get("x-luxos-gateway-sig-v2"),
    sigV3: h.get("x-luxos-gateway-sig-v3"),
    sigV4: h.get("x-luxos-gateway-sig-v4"),
    sigV5: h.get("x-luxos-gateway-sig-v5"),
  });
  if (ver === 0) return null; // spoofed / unsigned / stale → not trusted
  const email = emailHeader.trim().toLowerCase();
  if (!email) return null;
  const name = h.get("x-luxos-user-name")?.trim() || email;
  const luxosRoles = rolesHeader.split(",").map((r) => r.trim()).filter(Boolean);

  // A field is only trustworthy once ITS version verified: appRole needs v4+, guest v5.
  const appRole: GatewayUser["appRole"] =
    ver >= 4 && (appRoleHeader === "admin" || appRoleHeader === "dev") ? appRoleHeader : "member";
  const isGuest = ver >= 5 && guestHeader === "1";

  // Split RBAC: your in-app assignment WINS; LuxOS mapping is the default.
  const assigned = await getRole(email);
  return {
    email,
    name,
    role: assigned ?? mapLuxosRoles(luxosRoles),
    department: deptHeader.trim() || null,
    level: levelHeader.trim() || null,
    country: countryHeader.trim() || null,
    groups: groupsHeader.split(",").map((g) => g.trim()).filter(Boolean),
    appRole,
    isGuest,
  };
}

// ── Gating examples ─────────────────────────────────────────────────────────
// Coarse "can this user even open the app" is ALREADY enforced by LuxOS — the
// gateway won't proxy here unless the dashboard's allowedRoles / allowedDepartments
// + minLevel let them in. Inside the app, gate FEATURES off the verified identity:
//
//   const u = await getGatewayUser();
//   if (!u) return <OpenViaLuxOS />;                  // not signed in via LuxOS
//   if (u.isGuest) return <ReadOnlyView />;           // external guest → e.g. no editing
//   const isSales  = u.department === "Sales";
//   const isLeader = levelAtLeast(u.level, "leader"); // leader or C-Suite
//   if (u.appRole === "admin" || u.role === "admin" || (isSales && isLeader)) { /* privileged view */ }
