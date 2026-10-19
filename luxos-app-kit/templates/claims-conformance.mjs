/**
 * The matrix every LuxOS app's identity verifier must satisfy.
 *
 * Shared because the bug it exists to catch was copied, not invented: several apps
 * gated `appRole` and `guest` on the signature version and returned `department`,
 * `level`, `country` and `groups` raw — in the same function. A genuine v1 assertion
 * plus a chosen header therefore became a Sales leader, or an admin, depending on
 * which field that app authorized on. The signature was real; it simply never said
 * anything about those fields (audit 2026-09-18: P-06, and its copies PS-19, MKT-01,
 * CR-01, CR-02, PS-01, PS-08).
 *
 * Each signature covers strictly more than the one below:
 *   v1 → email, roles          v4 → + appRole
 *   v2 → + department, level    v5 → + guest
 *   v3 → + country, groups
 *
 * Usage — point it at your app's pure version→claims function:
 *
 *   import { CONFORMANCE_CASES, runConformance } from "./claims-conformance.mjs";
 *   const failures = runConformance((ver, raw) => claimsForVersion(ver, raw));
 *   assert.deepEqual(failures, []);
 *
 * An app whose verifier is not shaped that way can still use CONFORMANCE_CASES as the
 * list of things to assert; the shape is a convenience, the matrix is the contract.
 */

const RAW = {
  department: "Sales",
  level: "leader",
  country: "DE",
  groups: "kpi-admins,everyone",
  appRole: "admin",
  guest: "1",
};

/** What must survive at each verified version, given RAW above. */
export const CONFORMANCE_CASES = [
  {
    version: 0,
    why: "nothing verified — the caller must be rejected outright, before claims matter",
    rejected: true,
  },
  {
    version: 1,
    why: "v1 signs email and roles only: every richer claim is unasserted",
    expect: { department: null, level: null, country: null, groups: [], appRole: "member", isGuest: true },
  },
  {
    version: 2,
    why: "v2 adds department and level, and nothing else",
    expect: { department: "Sales", level: "leader", country: null, groups: [], appRole: "member", isGuest: true },
  },
  {
    version: 3,
    why: "v3 adds country and groups",
    expect: { department: "Sales", level: "leader", country: "DE", groups: ["kpi-admins", "everyone"], appRole: "member", isGuest: true },
  },
  {
    version: 4,
    why: "v4 adds appRole; guest is still unasserted, so still restricted",
    expect: { department: "Sales", level: "leader", country: "DE", groups: ["kpi-admins", "everyone"], appRole: "admin", isGuest: true },
  },
  {
    version: 5,
    why: "v5 asserts guest — the only version at which isGuest:false may be believed",
    expect: { department: "Sales", level: "leader", country: "DE", groups: ["kpi-admins", "everyone"], appRole: "admin", isGuest: true },
  },
  {
    version: 5,
    raw: { ...RAW, guest: "0" },
    why: "a v5 assertion saying not-a-guest is the one case that clears the flag",
    expect: { department: "Sales", level: "leader", country: "DE", groups: ["kpi-admins", "everyone"], appRole: "admin", isGuest: false },
  },
  {
    version: 4,
    raw: { ...RAW, appRole: "superadmin" },
    why: "appRole is an allowlist — an unknown value is not a privilege",
    expect: { department: "Sales", level: "leader", country: "DE", groups: ["kpi-admins", "everyone"], appRole: "member", isGuest: true },
  },
];

export const CONFORMANCE_RAW = RAW;

/**
 * Run the matrix against a claims function. Returns a list of human-readable
 * failures — empty means conformant.
 */
export function runConformance(claimsFor) {
  const failures = [];
  for (const c of CONFORMANCE_CASES) {
    if (c.rejected) continue;   // version 0 is the caller's job, not the claims fn's
    const got = claimsFor(c.version, c.raw ?? RAW);
    for (const [k, want] of Object.entries(c.expect)) {
      const actual = got[k];
      const same = Array.isArray(want)
        ? Array.isArray(actual) && want.length === actual.length && want.every((v, i) => v === actual[i])
        : actual === want;
      if (!same) {
        failures.push(`v${c.version} ${k}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)} — ${c.why}`);
      }
    }
  }
  return failures;
}
