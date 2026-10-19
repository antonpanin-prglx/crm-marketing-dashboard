#!/usr/bin/env bash
#
# create-app.sh — scaffold a new PERGOLUX app, wired into LuxOS, in one command.
#
# Usage:  ./create-app.sh <app-name> [vercel-team]
#   e.g.  ./create-app.sh ops-dashboard
#
# Prereqs: `gh` (logged in as an org admin) + `vercel` CLI (logged in to the team).
#
# Does:    creates a PRIVATE repo from pergolux-app-template, creates + links a
#          Vercel project, and sets the VERCEL_ORG_ID / VERCEL_PROJECT_ID repo
#          Variables the gated deploy needs (no IDs hardcoded in source).
#
# Org secrets (ANTHROPIC_API_KEY, VERCEL_TOKEN) are INHERITED automatically if set
# at the org level. The steps that need admin:org / a dashboard are printed at the end.
set -euo pipefail

APP="${1:?usage: create-app.sh <app-name> [vercel-team]}"
ORG="PERGOLUX-International"
TEAM="${2:-pergolux-gmbh}"
TEMPLATE="$ORG/pergolux-app-template"

echo "→ creating $ORG/$APP from $TEMPLATE (private)…"
gh repo create "$ORG/$APP" --template "$TEMPLATE" --private --clone
cd "$APP"

echo "→ creating + linking the Vercel project…"
vercel link --yes --scope "$TEAM" --project "$APP" >/dev/null
PROJECT_ID="$(node -e "console.log(require('./.vercel/project.json').projectId)")"
ORG_ID="$(node -e "console.log(require('./.vercel/project.json').orgId)")"

echo "→ setting deploy repo Variables…"
gh variable set VERCEL_PROJECT_ID --repo "$ORG/$APP" --body "$PROJECT_ID"
gh variable set VERCEL_ORG_ID     --repo "$ORG/$APP" --body "$ORG_ID"

cat <<DONE

✓ $ORG/$APP created and linked to Vercel project "$APP" ($PROJECT_ID).

Remaining (need admin:org or a dashboard):
  1. Add "$APP" to the org ruleset scope (Org → Settings → Rules) so the security gate is required.
  2. Confirm org secrets ANTHROPIC_API_KEY + VERCEL_TOKEN exist (they inherit automatically).
  3. Set the app's runtime env in Vercel; for the LuxOS mount add NEXT_PUBLIC_BASE_PATH=/app/$APP.
  4. Nothing to do for Vercel builds: vercel.json skips them until the app has a package.json.
  5. Register "$APP" in LuxOS → Admin → Dashboards.
DONE
