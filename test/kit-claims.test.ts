/**
 * The canonical kit must satisfy the matrix it ships (audit 2026-09-18, P-06).
 *
 * The kit already gated appRole on v4 and guest on v5 — and returned department,
 * level, country and groups raw, in the same function. Apps scaffolded from it
 * inherited that, and the gating example directly below it recommends authorizing on
 * `u.department` and `u.level`: the two fields it did not gate.
 *
 * This runs the kit's own claimsForVersion against claims-conformance.mjs, which is
 * the same matrix the apps are expected to run against theirs. If the template drifts
 * from the contract it publishes, this fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runConformance, CONFORMANCE_CASES, CONFORMANCE_RAW } from "../luxos-app-kit/templates/claims-conformance.mjs";
import { claimsForVersion } from "../luxos-app-kit/templates/claims.ts";

test("the kit conforms to the matrix it publishes", () => {
  assert.deepEqual(runConformance(claimsForVersion), []);
});

test("an unverified caller is rejected before claims are considered", () => {
  const zero = CONFORMANCE_CASES.find((c) => c.version === 0);
  assert.ok(zero?.rejected, "v0 is the caller's job — getGatewayUser returns null");
  const src = readFileSync(new URL("../luxos-app-kit/templates/gatewayAuth.ts", import.meta.url), "utf8");
  assert.match(src, /if \(ver === 0\) return null/);
});

test("a downgraded assertion cannot carry a richer claim", () => {
  // The finding, stated as an assertion: a real v1 proof plus forged leader/country.
  const got = claimsForVersion(1, CONFORMANCE_RAW);
  assert.equal(got.department, null, "v1 never signed department");
  assert.equal(got.level, null, "v1 never signed level");
  assert.equal(got.country, null);
  assert.deepEqual(got.groups, []);
  assert.equal(got.appRole, "member");
  assert.equal(got.isGuest, true, "unknown guest state must restrict, not admit");
});

test("getGatewayUser returns the shared decision, not its own copy", () => {
  const src = readFileSync(new URL("../luxos-app-kit/templates/gatewayAuth.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ claimsForVersion \} from "\.\/claims"/, "must import the shared decision");
  const fn = src.slice(src.indexOf("export async function getGatewayUser"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /claimsForVersion\(ver, \{/, "must delegate to it");
  assert.doesNotMatch(body, /department: deptHeader\.trim\(\) \|\| null/,
    "an inline copy is exactly what drifted across six apps");
});

test("the shared decision has no framework imports, so any app can test it", () => {
  const src = readFileSync(new URL("../luxos-app-kit/templates/claims.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import /m, "claims.ts must stay dependency-free");
});
