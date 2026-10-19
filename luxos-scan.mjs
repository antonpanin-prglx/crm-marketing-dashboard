#!/usr/bin/env node
/**
 * LuxOS Security Gate — runs in each app's GitHub Action on every push/PR.
 * Scans the commit (secrets, dependencies/malware, AI security review), posts a
 * signed verdict to the LuxOS ingest API, and exits non-zero to BLOCK the
 * commit when checks fail or the developer is blocked.
 *
 * Env (set as repo secrets): LUXOS_URL, SECURITY_GATE_SECRET, ANTHROPIC_API_KEY
 * Provided by Actions: REPO, BRANCH, COMMIT_SHA, AUTHOR_EMAIL
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const env = process.env;
const findings = [];
const add = (check, severity, title, detail, fixPrompt) =>
  findings.push({ check, severity, title, detail, fixPrompt });

function diff() {
  try {
    return execSync("git diff --unified=2 HEAD~1...HEAD || git show --unified=2", {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

// 1) Secret leak scan (added lines only).
const SECRET_PATTERNS = [
  [/sk-ant-[a-zA-Z0-9-]{20,}/g, "Anthropic API key"],
  [/AKIA[0-9A-Z]{16}/g, "AWS access key id"],
  [/ghp_[a-zA-Z0-9]{30,}/g, "GitHub token"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, "Private key"],
  [/xox[baprs]-[0-9a-zA-Z-]{10,}/g, "Slack token"],
  [/(?:secret|password|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/gi, "Hard-coded credential"],
];
const code = diff();
const added = code
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .join("\n");
for (const [re, label] of SECRET_PATTERNS) {
  if (re.test(added)) {
    add(
      "secrets",
      "critical",
      `Possible ${label} committed`,
      `A value matching ${label} appears in the diff.`,
      `Remove the committed ${label} from the diff, move it to an environment variable, add it to .env.example, confirm .env files are gitignored, and ROTATE the leaked credential immediately.`
    );
  }
}

// 2) Dependency vulnerabilities (npm audit run by the workflow → npm-audit.json).
if (existsSync("npm-audit.json")) {
  try {
    const audit = JSON.parse(readFileSync("npm-audit.json", "utf8"));
    const v = audit.metadata?.vulnerabilities ?? {};
    const high = (v.high ?? 0) + (v.critical ?? 0);
    if (high > 0) {
      add(
        "dependencies",
        "high",
        `${high} high/critical dependency vulnerabilities`,
        "npm audit reported high or critical advisories.",
        "Run `npm audit fix` (or `npm audit fix --force` and re-test). For unfixable advisories, upgrade or replace the offending package and re-run the audit."
      );
    }
  } catch {
    /* ignore */
  }
}

// 3) AI security review (Claude) on the diff.
async function aiReview() {
  if (!env.ANTHROPIC_API_KEY || !added.trim()) return;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content:
              "You are a security reviewer. Review this code diff for injection, auth bypass, SSRF, unsafe redirects, secrets, and dangerous patterns. Respond ONLY with JSON: {\"findings\":[{\"severity\":\"critical|high|medium|low\",\"title\":\"...\",\"detail\":\"...\",\"fixPrompt\":\"a copy-paste prompt the developer runs locally to fix it\"}]}. Empty array if clean.\n\nDIFF:\n" +
              added.slice(0, 60000),
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "{}";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    for (const f of json.findings ?? []) {
      add("ai-review", f.severity ?? "medium", f.title ?? "AI finding", f.detail ?? "", f.fixPrompt);
    }
  } catch (e) {
    console.warn("AI review skipped:", e.message);
  }
}

async function main() {
  await aiReview();

  const blocking = findings.some((f) => f.severity === "critical" || f.severity === "high");
  const verdict = blocking ? "failed" : "passed";

  const body = JSON.stringify({
    repo: env.REPO,
    commit: env.COMMIT_SHA,
    branch: env.BRANCH,
    author: env.AUTHOR_EMAIL,
    verdict,
    findings,
  });

  let gate = verdict;
  if (env.LUXOS_URL && env.SECURITY_GATE_SECRET) {
    const sig = createHmac("sha256", env.SECURITY_GATE_SECRET).update(body).digest("hex");
    try {
      const res = await fetch(`${env.LUXOS_URL}/api/security-gate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-luxos-signature": sig },
        body,
      });
      const out = await res.json();
      gate = out.gate ?? verdict;
      console.log(`LuxOS gate: ${gate} — ${out.message ?? ""}`);
    } catch (e) {
      console.error("Failed to reach LuxOS:", e.message);
      process.exit(1); // fail closed
    }
  }

  if (findings.length) {
    console.log("\nFindings:");
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.title}\n    ${f.detail}`);
      if (f.fixPrompt) console.log(`    FIX PROMPT: ${f.fixPrompt}`);
    }
  }

  // Block the commit on failed/blocked; "pending" passes the scan but deploy
  // still waits for super-admin approval (enforced at deploy time — see doc).
  if (gate === "failed" || gate === "blocked") {
    console.error(`\n❌ Security gate: ${gate}. Deploy blocked.`);
    process.exit(1);
  }
  console.log(`\n✅ Scan passed (${gate}).`);
}

main();
