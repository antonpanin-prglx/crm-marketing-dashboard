# LuxOS App Integration Kit

Everything a team needs to retrofit an **already-built** app so it plugs into
**LuxOS** the same way Creative OS does: SSO handled by LuxOS, fine-grained RBAC
owned by the app, spoof-proof identity, and the gated CI/CD security pipeline.

Built for teams "vibe-coding" with Claude Code — hand them this folder, they paste
one prompt, Claude does the work and prints the manual steps at the end.

## ⚡ Apply / re-sync — paste this into Claude Code (in your app's repo)
This pulls the latest kit, audits your app, and acts **only if something's missing or
broken** (otherwise it stops and reports — no wasted tokens). Re-run it anytime to
pick up kit updates. It only ever commits to a branch — never merges, deploys, or
touches secrets. Requires `gh auth login` as a PERGOLUX-International member.

```
Fetch the latest LuxOS integration kit and apply only what's needed: run `rm -rf /tmp/luxos-kit && gh repo clone PERGOLUX-International/pergolux-app-template /tmp/luxos-kit -- --depth=1 -q`, then read /tmp/luxos-kit/luxos-app-kit/ (PROMPT.md first, then 01–06). AUDIT this app against it: if it's ALREADY fully integrated — a getGatewayUser-style file that HMAC-verifies x-luxos-gateway-sig, basePath set + all client fetches basePath-prefixed, no app-owned login, sign-out links to LuxOS, in-app role store wins over the LuxOS mapping, and the CI + LuxOS security-gate workflow files present — AND a production build passes, then STOP and report "already integrated — nothing to do" without changing anything. Otherwise implement ONLY the missing or broken pieces exactly as the kit's PROMPT.md says (do Step 0 host analysis first and pause for my choice), build to verify after each change, and commit to a branch named luxos-integration — do NOT merge, deploy, or touch secrets.
```

(No `gh`? Swap the clone for `git clone https://github.com/PERGOLUX-International/pergolux-app-template /tmp/luxos-kit`.)

## What's in here
| File | For whom | Purpose |
|---|---|---|
| **`PROMPT.md`** | the app's dev | The drop-in Claude Code prompt. **This is the main thing.** |
| `01-RBAC-AND-GATEWAY.md` | dev | How app-level RBAC + gateway identity verification works, in depth |
| `02-MOUNT-INTO-LUXOS.md` | dev | basePath, the dashboard-id rule, the client-fetch gotcha, env vars |
| `03-CICD-AND-GATE.md` | dev | The CI/CD security gate + AI review + how to add it |
| `04-CHECKLIST.md` | dev **and** the LuxOS admin/owner | End-to-end checklist + verification commands |
| `05-GO-LIVE-RUNBOOK.md` | the LuxOS admin/owner | Deploy on your Vercel account + register in LuxOS, step by step |
| `06-HOSTING.md` | dev + admin | **Vercel vs a long-running host** — signals, pros/cons, how each connects to LuxOS |
| `templates/` | dev | Copy-paste-ready code: `gatewayAuth.ts`, basePath fetch helper, config + env snippets |

> The prompt's **Step 0** makes Claude analyze the app's code (crons, in-memory
> state, local files, long jobs) and recommend Vercel vs a long-running host — with
> honest pros/cons — then pause for the human to choose. LuxOS proxies either
> identically, so the integration is the same; only the deploy target changes.

## How to roll this out (the admin/owner — e.g. IT)
1. Drop this whole `luxos-app-kit/` folder into the app's repo (or just hand the dev `PROMPT.md`).
2. Tell the dev: *"Open Claude Code in the repo and paste the prompt from `PROMPT.md`."*
3. Claude adapts the app + opens a PR. It will NOT merge or deploy.
4. You (admin) do the LuxOS-side steps in `04-CHECKLIST.md`:
   - set GitHub secrets + branch protection,
   - set the app's Vercel env vars (incl. the shared `LUXOS_GATEWAY_SECRET`),
   - register the app in LuxOS → Admin → Dashboards,
   - merge the green PR (deploys via the pipeline).
5. Verify (commands in `04-CHECKLIST.md`).

## Non-negotiables (why this exists)
- **No direct Vercel deploys.** Everything ships through the gated pipeline
  (branch → PR → security gate → merge → auto-deploy). Never `vercel deploy`.
- **The app never trusts identity headers without verifying the LuxOS HMAC
  signature.** That's what makes it safe even though the app's `*.vercel.app` URL
  is publicly reachable.
- **The LuxOS dashboard id must equal the app's basePath segment** (`/app/<id>`),
  or the gateway 404s.
- **LuxOS owns auth; the app owns its own roles.** Don't add a login to the app.

Reference implementation: **Creative OS** (`PERGOLUX-International/creative-os`) — this
kit is a generalization of exactly what it does.
