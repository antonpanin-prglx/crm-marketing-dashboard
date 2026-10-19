# 3 · CI/CD security gate + AI code review

Every app ships **only** through the gated pipeline: branch → PR → all security
checks pass → merge → auto-deploy. **Never** `vercel deploy` from a laptop.

## What runs on every PR
- **Semgrep** — static analysis (security-audit, secrets, OWASP, injection, JS/TS/React)
- **Trivy** — dependency vulns, secrets, misconfig (HIGH/CRITICAL fail)
- **npm audit** — fails on high/critical advisories
- **TruffleHog** — verified committed secrets
- **No demo/dummy data** — fails if mock/dummy/placeholder/seed data is found in
  shippable source (real users must never see fake numbers). **Blocks deploy.**
- **OSV-Scanner** — advisory (non-blocking)
- **AI review (Claude)** — reviews the diff, **blocks** on critical/high findings
- **LuxOS Security Gate** — posts a signed verdict to LuxOS and blocks on failure

## Fastest path: copy the 5 files from the template repo
The canonical, maintained versions live in
**`github.com/PERGOLUX-International/pergolux-app-template`**. Copy these into your repo
unchanged:

```
.github/workflows/ci.yml
.github/workflows/security-gate.yml
.github/scripts/ai-review.mjs
.github/scripts/check-no-demo-data.mjs
luxos-scan.mjs
```

(`ai-review.mjs` and `luxos-scan.mjs` are non-trivial scripts — take them from the
template rather than hand-writing them.) The two workflow files are also reproduced
below so you can sanity-check what you copied.

## Required GitHub repo secrets
Add under **Settings → Secrets and variables → Actions** (org-level secrets cover all
repos if your org admin set them up):
- `ANTHROPIC_API_KEY` — for the AI review
- `LUXOS_URL` — `https://luxos.pergolux.global`
- `SECURITY_GATE_SECRET` — shared with LuxOS (signs the gate verdict)
- If CI deploys to Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## Branch protection (make the gate real)
**Settings → Branches → add rule** for your production branch (`main`/`master`):
- Require a pull request before merging
- Require status checks to pass: **AI review (Claude)**, **Semgrep**, **Trivy**,
  **npm audit**, **TruffleHog**, **No demo/dummy data**, **LuxOS Security Gate**
- (Org owners can keep an admin bypass; ideally remove it so nobody merges red.)

## Deployment
Two acceptable patterns — match whatever the org standard is:
1. **Vercel Git integration** auto-deploys `main` after checks (simplest), or
2. a **deploy job in `ci.yml`** that runs only on `main` after all gates pass
   (needs the `VERCEL_*` secrets).

Either way: code reaches production **only** by merging a green PR. If you want a
manual approval as an extra gate, protect the production environment in GitHub or
require a second reviewer.

---

### Reference: `.github/workflows/ci.yml` (verify your copy matches)
```yaml
name: CI
on:
  push:
    branches: [main, master]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  semgrep:
    name: Semgrep — static analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install --quiet semgrep
      - name: Scan
        run: |
          semgrep scan --error --metrics=off \
            --config p/security-audit --config p/secrets --config p/owasp-top-ten \
            --config p/command-injection --config p/javascript --config p/typescript --config p/react
  trivy:
    name: Trivy — vulns, secrets & misconfig
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aquasecurity/trivy-action@0.35.0
        with:
          scan-type: fs
          scan-ref: .
          scanners: vuln,secret,misconfig
          severity: HIGH,CRITICAL
          ignore-unfixed: true
          exit-code: "1"
          format: table
  npm-audit:
    name: npm audit — dependencies
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci --ignore-scripts
      - run: npm audit --audit-level=high
  trufflehog:
    name: TruffleHog — verified secrets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          docker run --rm -v "$PWD:/repo" trufflesecurity/trufflehog:latest \
            filesystem /repo --only-verified --fail --no-update
  osv-scanner:
    name: OSV-Scanner (advisory)
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - run: |
          docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner:latest \
            scan source --lockfile=/src/package-lock.json || true
  no-demo-data:
    name: No demo/dummy data
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: 20 }
      - name: Scan for demo/dummy data
        run: node .github/scripts/check-no-demo-data.mjs
  ai-review:
    name: AI review (Claude)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Claude security review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_EVENT_NAME: ${{ github.event_name }}
          BASE_REF: ${{ github.base_ref }}
          BEFORE_SHA: ${{ github.event.before }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node .github/scripts/ai-review.mjs
```

### Reference: `.github/workflows/security-gate.yml`
```yaml
name: LuxOS Security Gate
on:
  push:
    branches: ["**"]
  pull_request:
jobs:
  security-gate:
    name: LuxOS Security Gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Dependency audit
        run: npm audit --json > npm-audit.json || true
      - name: Semgrep
        continue-on-error: true
        run: |
          pip install semgrep >/dev/null 2>&1 || true
          semgrep --config=auto --error --json --output=semgrep.json . || true
      - name: LuxOS scan + gate
        run: node luxos-scan.mjs
        env:
          LUXOS_URL: ${{ secrets.LUXOS_URL }}
          SECURITY_GATE_SECRET: ${{ secrets.SECURITY_GATE_SECRET }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          REPO: ${{ github.repository }}
          BRANCH: ${{ github.ref_name }}
          COMMIT_SHA: ${{ github.sha }}
          AUTHOR_EMAIL: ${{ github.event.head_commit.author.email || github.actor }}
```
