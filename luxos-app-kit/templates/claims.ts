/**
 * Which identity claims a verified signature version actually covers.
 *
 * Its own file, with NO imports, for two reasons. It is the one piece of gateway
 * identity logic every app needs and the one that was wrong nearly everywhere — six
 * apps gated `appRole` and `guest` on the version while returning `department`,
 * `level`, `country` and `groups` raw, in the same function. And keeping it free of
 * `next/headers` means it can be imported and tested anywhere, including a scaffold
 * with nothing installed.
 *
 * Each signature covers strictly more than the one below it:
 *   v1 → email, roles          v4 → + appRole
 *   v2 → + department, level    v5 → + guest
 *   v3 → + country, groups
 *
 * Everything the matched version did not cover is erased rather than passed through.
 * Returning a raw header because some OTHER signature verified is how a genuine v1
 * assertion plus a chosen x-luxos-user-department header became a Sales leader: the
 * signature was real, it just never said anything about department
 * (audit 2026-09-18, P-06).
 *
 * The gateway sends v1…v5 on EVERY request, so a genuine caller resolves to 5 and
 * loses nothing. Only a downgraded request comes back thinner.
 *
 * Conformance matrix: claims-conformance.mjs — run it against this in your app's tests.
 */
export type VerifiedClaims = {
  department: string | null;
  level: string | null;
  country: string | null;
  groups: string[];
  appRole: "member" | "dev" | "admin";
  isGuest: boolean;
};

export type RawClaimHeaders = {
  department: string;
  level: string;
  country: string;
  groups: string;
  appRole: string;
  guest: string;
};

export function claimsForVersion(ver: number, raw: RawClaimHeaders): VerifiedClaims {
  const text = (v: string) => v.trim() || null;
  return {
    department: ver >= 2 ? text(raw.department) : null,
    level: ver >= 2 ? text(raw.level) : null,
    country: ver >= 3 ? text(raw.country) : null,
    groups: ver >= 3 ? raw.groups.split(",").map((g) => g.trim()).filter(Boolean) : [],
    appRole: ver >= 4 && (raw.appRole === "admin" || raw.appRole === "dev") ? raw.appRole : "member",
    // Unknown guest state is treated as GUEST, not as staff. Below v5 nothing has
    // asserted either way, and the safe reading of "I cannot tell" is the restricted
    // one — the opposite default let a downgraded assertion shed the guest flag.
    isGuest: ver >= 5 ? raw.guest === "1" : true,
  };
}
