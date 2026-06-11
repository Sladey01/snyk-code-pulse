# 🛡️ Snyk Code Pulse

A modern SAST posture toolkit for Snyk Code, built on the **Snyk REST API (v2026-03-25)**:

1. **Dashboard** — a dark, glassmorphic web app (and Android APK) where you enter *your own*
   Snyk API token + Group ID and get instant Code-security posture: severity split,
   ignore audit (SOC2 evidence), CWE/OWASP heat-map, per-org league table with
   SAST-coverage flags, and pick-your-fields CSV/JSON export on every view.
2. **`snyk-sast-admin` MCP server** — drive group-wide SAST admin from Claude Code:
   bulk-enable/disable Snyk Code across orgs, audit enablement drift, audit ignores,
   posture summaries.

Your token **never leaves your device** — it's stored locally and sent only to Snyk's API.

---

## Quick start

```bash
npm install
npm run build          # builds api-client → mcp-server → dashboard
```

### Dashboard (web)

```bash
npm run dev -w dashboard      # http://localhost:5173
```

Open it, enter your **API token**, **Group ID**, and **region**, hit *Test connection*, save.

> Browser dev mode routes API calls through a local Vite proxy because `api.snyk.io`
> doesn't send CORS headers. The Android app talks to the API directly (native HTTP).

**Token scope:** a service-account token with **Group Viewer** is enough for the dashboard.

**Finding your Group ID:** Snyk UI → your Group → Settings → General.

| Region | API base |
|---|---|
| US-01 (default) | api.snyk.io |
| US-02 | api.us.snyk.io |
| EU | api.eu.snyk.io |
| AU | api.au.snyk.io |

### Dashboard (Android APK)

```bash
cd dashboard
npm run build && npx cap sync android   # already verified
npx cap open android                    # opens Android Studio
# Build > Build APK(s)  — or:  cd android && ./gradlew assembleDebug
```

Requires Android Studio (or the Android SDK + JDK 17) installed locally.

### MCP server (Claude Code)

```bash
claude mcp add snyk-sast-admin -s user \
  -e SNYK_TOKEN=<service-account-token> \
  -e SNYK_GROUP_ID=<group-id> \
  -e SNYK_REGION=us-01 \
  -- node /absolute/path/to/snyk-code-pulse/mcp-server/dist/index.js
```

**Token scope:** mutations (`set_sast_settings_bulk`) need **Group Admin**; everything else
works with Viewer.

| Tool | What it does |
|---|---|
| `list_orgs` | All orgs in the group |
| `audit_sast_settings` | Which orgs have Snyk Code on/off (decodes SNYK-CODE-0006) |
| `set_sast_settings_bulk` | Enable/disable Code across many orgs — **dry-run by default** |
| `diff_org_settings` | Drift report vs a "golden" org |
| `audit_ignores` | Every ignored Code issue (compliance/SOC2 evidence) |
| `sast_posture_summary` | Severity/CWE/org-league posture summary |

Example prompts once registered:

> "Audit SAST settings across my group" ·
> "Dry-run enabling Snyk Code on all orgs matching `app*`" ·
> "Show me every ignored Code issue"

### Smoke test

```bash
# .env at repo root: SNYK_TOKEN=… SNYK_GROUP_ID=… SNYK_REGION=us-01
npm run smoke
```

Read-only; verifies orgs, settings, issues, filters and pagination against your real group.

---

## Security notes

- Tokens are runtime inputs: env vars (MCP) or device-local storage (dashboard). Nothing is hardcoded or logged.
- Use limited-scope service accounts; rotate any token that's been shared in chat/email.
- `set_sast_settings_bulk` previews by default (`dry_run=true`) and reports per-org results when applied.

## Architecture

```
packages/api-client/   TypeScript client: regions, version pinning (2026-03-25),
                       429 backoff, cursor pagination (limit 10–100, multiple of 10),
                       typed issues/orgs/settings + shared aggregation helpers
mcp-server/            stdio MCP server (@modelcontextprotocol/sdk + zod)
dashboard/             React 18 + Vite + Tailwind v4 + Recharts + Capacitor 7
```
