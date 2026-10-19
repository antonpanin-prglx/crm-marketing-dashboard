/**
 * AI security reviewer + blocker.
 *
 * Sends the commit/PR diff to Claude and asks for a strict security review.
 * Exits non-zero (blocking the pipeline, and therefore the deploy) when a
 * critical/high security issue is found. Posts a review comment on PRs.
 *
 * Fail-open by design: if the API key is missing or the API errors, it does
 * NOT block (so an Anthropic outage can't freeze your deploys). The
 * deterministic scanners (Semgrep/Trivy/npm-audit/TruffleHog) are the
 * always-on gate; this is an extra intelligent layer on top.
 */
import { execSync } from "node:child_process";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.log("ANTHROPIC_API_KEY not set — skipping AI review. Add the secret in GitHub → Settings → Secrets to enable it.");
  process.exit(0);
}

const MODEL = process.env.AI_REVIEW_MODEL || "claude-sonnet-4-6";
const event = process.env.GITHUB_EVENT_NAME;
const base = process.env.BASE_REF;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return (e.stdout || "").toString(); }
}

let diff = "";
if (event === "pull_request" && base) {
  sh(`git fetch --no-tags --depth=100 origin ${base}`);
  diff = sh(`git diff --no-color origin/${base}...HEAD`);
} else {
  const before = process.env.BEFORE_SHA;
  if (before && !/^0+$/.test(before)) diff = sh(`git diff --no-color ${before}..HEAD`);
  if (!diff.trim()) diff = sh(`git diff --no-color HEAD~1..HEAD`);
}
diff = diff.trim();
if (!diff) { console.log("No diff to review."); process.exit(0); }

const MAX = 120_000;
const truncated = diff.length > MAX;
if (truncated) diff = diff.slice(0, MAX);

const system =
  "You are a strict security and code-quality reviewer for a PRODUCTION internal SSO portal built with Next.js. " +
  "Review the git diff. Focus on: leaked secrets/API keys, authentication/authorization bypasses, injection " +
  "(SQL/command/SSRF/XSS/path traversal), unsafe deserialization, insecure crypto, disabled security controls, " +
  "obfuscated or malicious code, and serious correctness bugs. Ignore pure style nits. " +
  'Respond with ONLY minified JSON: {"verdict":"pass"|"block","summary":"<2 sentences>","issues":[{"severity":"critical"|"high"|"medium"|"low","file":"<path>","detail":"<what & why>"}]}. ' +
  'Set verdict to "block" if and only if there is at least one critical or high security issue.';

let review;
try {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: `Review this diff${truncated ? " (truncated)" : ""}:\n\n\`\`\`diff\n${diff}\n\`\`\`` }],
    }),
  });
  if (!res.ok) { console.log(`Anthropic API ${res.status} — not blocking. ${await res.text()}`); process.exit(0); }
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("").trim().replace(/^```json\s*|\s*```$/g, "");
  review = JSON.parse(text);
} catch (e) {
  console.log("AI review unavailable / unparseable — not blocking.", e.message);
  process.exit(0);
}

console.log(`AI verdict: ${review.verdict}`);
console.log(`Summary: ${review.summary}`);
for (const i of review.issues || []) console.log(`  [${i.severity}] ${i.file || ""} — ${i.detail}`);

if (prNumber && process.env.GITHUB_TOKEN) {
  const md =
    `### 🤖 Claude security review\n\n**Verdict: ${String(review.verdict).toUpperCase()}**\n\n${review.summary}\n\n` +
    ((review.issues || []).length
      ? review.issues.map((i) => `- **${i.severity}** \`${i.file || ""}\` — ${i.detail}`).join("\n")
      : "_No blocking issues found._");
  await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "content-type": "application/json", accept: "application/vnd.github+json" },
    body: JSON.stringify({ body: md }),
  }).catch(() => {});
}

const blocking = review.verdict === "block" || (review.issues || []).some((i) => ["critical", "high"].includes(i.severity));
if (blocking) { console.error("❌ AI review BLOCKED the build: critical/high security issue(s) found."); process.exit(1); }
console.log("✅ AI review passed.");
