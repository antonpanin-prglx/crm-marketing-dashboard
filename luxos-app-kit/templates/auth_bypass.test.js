'use strict';
// templates/auth_bypass.test.js — CRITICAL security regression test. Ship this in every
// LuxOS-mounted app (adapted from PERGOLUX-International/performancedashboard).
//
// The invariant it defends: when LUXOS_GATEWAY_SECRET is unset or empty there is NOTHING
// to verify the identity headers against, so the app MUST fail CLOSED (resolver returns
// null → your "Open via LuxOS" page / 401). Trusting the headers in that state lets anyone
// who can reach this deployment's URL send `x-luxos-user-roles: super_admin` and be an
// admin. This has shipped as a real bug more than once — hence a test, not a comment.
//
// Deliberately dependency-free: `node test/auth_bypass.test.js`. Add it to your
// package.json "test" script so CI runs it on every PR.
//
// ── ADAPT THIS BLOCK ONLY ────────────────────────────────────────────────────────────
// Provide `resolve(headers)` → the user object your gateway resolver returns, or null.
// `headers` is a plain lowercase-keyed object.
//
//   Express / Node (req.get):
//     const { getGatewayUser } = require('../gatewayAuth');
//     const resolve = (h) => getGatewayUser({ get: (k) => h[String(k).toLowerCase()] ?? '' });
//
//   Next.js App Router (next/headers): getGatewayUser() reads an ambient store, so export
//   the pure inner function alongside it and test that:
//     export async function resolveFromHeaders(h: Headers) { … }   // in gatewayAuth.ts
//     export async function getGatewayUser() { return resolveFromHeaders(await headers()); }
//   then here:
//     const { resolveFromHeaders } = require('../src/lib/gatewayAuth');
//     const resolve = (h) => resolveFromHeaders(new Headers(h));
//
// If your resolver is async, `await` is already handled below.
const { getGatewayUser } = require('../gatewayAuth');
const resolve = (h) => getGatewayUser({ get: (k) => h[String(k).toLowerCase()] ?? '' });

// Your app's LuxOS id (the /app/<id> mount) — the signature audience.
const APP_ID = process.env.LUXOS_APP_ID || 'your-app-id';
// ── END ADAPT ────────────────────────────────────────────────────────────────────────

const assert = require('node:assert');
const { createHmac } = require('node:crypto');

const saved = {
  e: process.env.NODE_ENV,
  s: process.env.LUXOS_GATEWAY_SECRET,
  a: process.env.ALLOW_DEV_NO_SECRET,
  b: process.env.NEXT_PUBLIC_BASE_PATH,
  i: process.env.LUXOS_APP_ID,
};
const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
const env = (nodeEnv, secret, allowDev) => {
  set('NODE_ENV', nodeEnv);
  set('LUXOS_GATEWAY_SECRET', secret);
  set('ALLOW_DEV_NO_SECRET', allowDev);
};
// The resolver derives its audience from one of these; set both so it can't fail for the
// wrong reason (an empty APP_ID is also required to fail closed — see the canonical template).
set('NEXT_PUBLIC_BASE_PATH', `/app/${APP_ID}`);
set('LUXOS_APP_ID', APP_ID);

/** Signed identity headers exactly as the LuxOS gateway sends them (v1 payload). */
function signedHeaders(secret, { email, roles, tsOffsetMs = 0 }) {
  const ts = String(Date.now() + tsOffsetMs);
  const sig = createHmac('sha256', secret)
    .update(`v1\n${APP_ID}\n${email}\n${roles}\n${ts}`)
    .digest('base64url');
  return {
    'x-luxos-user-email': email,
    'x-luxos-user-roles': roles,
    'x-luxos-user-name': email,
    'x-luxos-gateway-ts': ts,
    'x-luxos-gateway-sig': sig,
  };
}

/** Forged headers: the exact payload an attacker sends at the bare deployment URL. */
const FORGED = {
  'x-luxos-user-email': 'attacker@example.com',
  'x-luxos-user-roles': 'super_admin,admin,exec',
  'x-luxos-user-name': 'Attacker',
};

const REAL_SECRET = 'test-only-not-a-real-secret-0123456789';
let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failures++; console.error(`  ✗ ${label}\n      ${e.message}`); }
}

(async () => {
  console.log('auth_bypass.test.js — gateway must fail CLOSED without a secret');

  // ── 1-3) NO SECRET → always null, in every NODE_ENV. This is the critical finding. ──
  for (const nodeEnv of ['production', undefined, 'development']) {
    await check(`no secret + NODE_ENV=${nodeEnv ?? '(unset)'} → forged headers rejected`, async () => {
      env(nodeEnv, undefined, undefined);
      assert.strictEqual(await resolve(FORGED), null,
        'MISSING SECRET MUST FAIL CLOSED — this is a full authentication bypass');
    });
  }

  // 4) An EMPTY secret is the same hole as an unset one (an empty HMAC key still "works").
  await check('empty-string secret → forged headers rejected', async () => {
    env('production', '', undefined);
    assert.strictEqual(await resolve(FORGED), null, 'empty secret must fail closed');
  });

  // 5) A dev bypass, if the app has one at all, must never fire outside local development
  //    even when its opt-in flag is on.
  await check('production + ALLOW_DEV_NO_SECRET=true → still rejected', async () => {
    env('production', undefined, 'true');
    assert.strictEqual(await resolve(FORGED), null,
      'no flag may grant access in production');
  });

  // ── 6-8) SECRET SET → only a valid, fresh, correctly-bound signature is accepted. ──
  await check('secret set + unsigned request → rejected', async () => {
    env('production', REAL_SECRET, undefined);
    assert.strictEqual(await resolve(FORGED), null, 'unsigned request must be rejected');
  });

  await check('secret set + wrong signature → rejected', async () => {
    env('production', REAL_SECRET, undefined);
    const h = signedHeaders('a-different-secret', { email: 'a@b.com', roles: 'super_admin' });
    assert.strictEqual(await resolve(h), null, 'signature from the wrong key must be rejected');
  });

  await check('secret set + stale timestamp (>5 min) → rejected', async () => {
    env('production', REAL_SECRET, undefined);
    const h = signedHeaders(REAL_SECRET, { email: 'a@b.com', roles: 'viewer', tsOffsetMs: -10 * 60 * 1000 });
    assert.strictEqual(await resolve(h), null, 'stale signature must be rejected (replay window)');
  });

  // 9) POSITIVE CONTROL — without this the whole file passes even if the resolver is
  //    broken and returns null unconditionally.
  await check('secret set + valid fresh signature → accepted', async () => {
    env('production', REAL_SECRET, undefined);
    const h = signedHeaders(REAL_SECRET, { email: 'real.user@example.com', roles: 'viewer' });
    const u = await resolve(h);
    assert.ok(u && u.email === 'real.user@example.com',
      'a genuine LuxOS request must be accepted — otherwise these tests prove nothing');
  });

  env(saved.e, saved.s, saved.a);
  set('NEXT_PUBLIC_BASE_PATH', saved.b);
  set('LUXOS_APP_ID', saved.i);

  if (failures) { console.error(`\n${failures} check(s) FAILED — do not deploy.`); process.exit(1); }
  console.log('\nauth_bypass.test.js — gateway fails closed without a secret ✓');
})();
