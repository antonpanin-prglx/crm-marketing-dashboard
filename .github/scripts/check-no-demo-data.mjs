#!/usr/bin/env node
// LuxOS — demo/dummy-data gate.
//
// LuxOS apps are dashboards that MUST render real data pulled from the gateway /
// upstream APIs. Shipping mock/dummy/placeholder/seed data to production is a hard
// no: it silently shows fake numbers to real users. This scanner fails CI when it
// finds demo-data markers in source, and the `deploy` job depends on it — so nothing
// with dummy data can reach production.
//
// Escape hatches (use sparingly, they are logged):
//   • Inline pragma:  add `luxos:allow-demo-data` in a comment on (or just above) the
//     line — for a genuinely dev-only, env-gated fallback that never runs in prod.
//   • Env allowlist:  DEMO_DATA_ALLOW="path/prefix,another/prefix" skips whole paths.
//
// Zero dependencies — Node built-ins only. Run: `node .github/scripts/check-no-demo-data.mjs`

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();

// Directories we never scan (build output, vendored code, VCS, tests).
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".vercel", ".turbo", "dist", "build",
  "out", "coverage", ".cache", "__tests__", "tests", "test", "e2e",
  "__mocks__", "cypress", "playwright", "playwright-report",
]);

// Only these extensions hold shippable code/data worth scanning.
const SCAN_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json",
]);

// Files that legitimately contain placeholders / examples / self-references.
const SKIP_FILES = new Set([
  ".env.example", "env.example.snippet", "package-lock.json", "pnpm-lock.yaml",
  "yarn.lock", "check-no-demo-data.mjs", "org-ruleset.json",
]);

// Test/mock files by name pattern — mock data there is expected and never shipped.
const SKIP_FILE_RE = /(\.test\.|\.spec\.|\.stories\.|\.mock\.|\.fixture\.)/i;

const ALLOW_PREFIXES = (process.env.DEMO_DATA_ALLOW || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const PRAGMA = "luxos:allow-demo-data";

// Marker patterns. Each fires per line; word-boundaried to limit false positives.
const PATTERNS = [
  {
    id: "mock-data",
    desc: "mock/dummy/fake/sample/placeholder/hardcoded data structure",
    re: /\b(?:mock|dummy|fake|sample|placeholder|hardcoded|stub|demo)[_ -]?(?:data|users?|rows?|records?|items?|response|responses|payload|payloads|db|store|dataset|datasets|values?|entries|list|lists|json|seed|content|results?|metrics|numbers?)\b/i,
  },
  { id: "lorem-ipsum", desc: "Lorem ipsum filler text", re: /lorem\s+ipsum/i },
  {
    id: "faker",
    desc: "faker / random data-generation library",
    re: /@faker-js\/faker|\bfaker\.[a-z]|(?:from|require)\s*\(?['"]faker['"]|\bchance\.[a-z]|@ngneat\/falso/i,
  },
  {
    id: "placeholder-pii",
    desc: "placeholder person / company name",
    re: /\b(?:john|jane)\s+doe\b|\bacme\s+(?:corp|corporation|inc|co)\b|\bfoo\s+bar\b/i,
  },
  {
    id: "placeholder-email",
    desc: "placeholder email address",
    re: /\b(?:test|demo|dummy|foo|bar|user\d*|admin|sample|example|noreply)@(?:test|example|demo|foo|bar|domain|email|sample|acme)\.(?:com|org|net|test|local|io)\b/i,
  },
  {
    id: "fake-phone",
    desc: "fake phone number",
    // Require separators so we don't flag bare 10-digit IDs (e.g. Meta account
    // ids) as phones. Canonical fake forms: 555-01xx, 123-456-7890, 555-1234.
    re: /\b(?:\+?1[-. ])?(?:555[-. ]01\d\d|123[-. ]456[-. ]7890|555[-. ]1234)\b/,
  },
  {
    id: "mock-mode-flag",
    desc: "mock/demo mode switch",
    re: /\b(?:USE_MOCK\w*|MOCK_MODE|DEMO_MODE|useMockData|isDemo|IS_DEMO|useFakeData|NEXT_PUBLIC_USE_MOCK\w*|NEXT_PUBLIC_DEMO\w*)\b/,
  },
];

// Filenames that are demo-data by their very name (regardless of content).
const DEMO_FILENAME_RE = /^(?:mock|dummy|fake|demo|sample|seed)[-_.].*\.(?:json|ts|js|mjs|cjs)$/i;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    let s;
    try { s = statSync(abs); } catch { continue; }
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) {
        if (entry !== ".github") continue; // scan our own workflow scripts too
      }
      walk(abs, out);
    } else if (s.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function isAllowed(rel) {
  return ALLOW_PREFIXES.some((p) => rel === p || rel.startsWith(p.endsWith("/") ? p : p + "/"));
}

const findings = [];
const allowedHits = [];

for (const abs of walk(ROOT, [])) {
  const rel = relative(ROOT, abs);
  const name = basename(abs);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  if (SKIP_FILES.has(name) || SKIP_FILE_RE.test(name)) continue;
  if (!SCAN_EXT.has(ext)) continue;
  if (isAllowed(rel)) continue;

  // Whole file is demo data by its name (e.g. mock-orders.json).
  if (DEMO_FILENAME_RE.test(name)) {
    findings.push({ rel, line: 0, id: "demo-file", desc: "file named as demo/mock data", text: name });
    continue;
  }

  let content;
  try { content = readFileSync(abs, "utf8"); } catch { continue; }
  if (/[\x00-\x08]/.test(content)) continue; // skip binary

  const lines = content.split(/\r?\n/);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    // Scan CODE only — strip comments. Comments (and JSDoc) are never shipped as
    // demo *data* to users, so matching them is pure false-positive noise.
    let code = lines[i];
    if (inBlock) {
      const end = code.indexOf("*/");
      if (end === -1) continue; // whole line still inside a /* … */ block
      code = code.slice(end + 2);
      inBlock = false;
    }
    while (true) {
      const s = code.indexOf("/*");
      if (s === -1) break;
      const e = code.indexOf("*/", s + 2);
      if (e === -1) { code = code.slice(0, s); inBlock = true; break; }
      code = code.slice(0, s) + " " + code.slice(e + 2);
    }
    // Line comment `//…` — but not `://` (URLs) so we don't truncate real code.
    const lc = code.search(/(^|[^:/])\/\//);
    if (lc !== -1) code = code.slice(0, code[lc] === "/" ? lc : lc + 1);
    if (!code.trim()) continue;

    // Pragma lives in a comment, so check the RAW line (+ line above).
    const rawNear = lines[i] + " " + (lines[i - 1] || "");
    for (const p of PATTERNS) {
      const m = p.re.exec(code);
      if (!m) continue;
      const hit = { rel, line: i + 1, id: p.id, desc: p.desc, text: m[0] };
      if (rawNear.includes(PRAGMA)) allowedHits.push(hit);
      else findings.push(hit);
    }
  }
}

const isGH = !!process.env.GITHUB_ACTIONS;
const err = (msg) => (isGH ? `::error::${msg}` : `  ✗ ${msg}`);

if (allowedHits.length) {
  console.log(`\nℹ ${allowedHits.length} demo-data marker(s) explicitly allowed via \`${PRAGMA}\`:`);
  for (const h of allowedHits) console.log(`    ${h.rel}:${h.line}  [${h.id}] ${h.text}`);
}

if (findings.length === 0) {
  console.log("\n✓ No demo/dummy data detected. Safe to ship.\n");
  process.exit(0);
}

console.log(`\nDemo/dummy-data gate FAILED — ${findings.length} finding(s):\n`);
for (const f of findings) {
  const where = f.line ? `${f.rel}:${f.line}` : f.rel;
  console.log(err(`${where}  [${f.id}] ${f.desc} → "${f.text}"`));
}
console.log(`
Real users see production data. Remove the demo/dummy/placeholder content above and
wire the app to live data (gateway / upstream APIs). If a hit is a genuine dev-only,
env-gated fallback, add \`${PRAGMA}\` in a comment on that line, or set
DEMO_DATA_ALLOW for whole paths — both are logged and reviewed.
`);
process.exit(1);
