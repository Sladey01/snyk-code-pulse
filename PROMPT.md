# Project Prompt: Snyk Code Pulse — SAST Dashboard + Admin MCP Server

Copy everything below into Claude Code (or any capable coding agent) in an empty directory.

---

Build a two-part toolkit for Snyk Code (SAST) called **Snyk Code Pulse**, in a monorepo:

```
snyk-code-pulse/
├── packages/api-client/   # shared TypeScript Snyk REST API client
├── mcp-server/            # "snyk-sast-admin" MCP server (stdio)
├── dashboard/             # React PWA + Capacitor Android app
└── README.md              # customer-facing setup for both
```

## Hard requirements

- **Snyk REST API only**, version `2026-03-25` (latest GA — keep it in ONE shared constant so it's easy to bump; the list of live versions is at `GET https://api.snyk.io/rest/openapi`).
- Auth header: `Authorization: token <API_TOKEN>`. Tokens/Group IDs are **user-supplied at runtime** — never hardcode, never log them. MCP server reads `SNYK_TOKEN`, `SNYK_GROUP_ID`, `SNYK_REGION` env vars; dashboard collects them in a Settings screen and persists locally only.
- **Multi-region**: base-URL switch for `api.snyk.io` (US-01), `api.us.snyk.io` (US-02), `api.eu.snyk.io`, `api.au.snyk.io`.
- API gotchas already verified: pagination `limit` must be ≥ 10 and a multiple of 10 (max 100); use cursor pagination via `links.next`; rate-limit politely (handle 429 with backoff).
- Key endpoints (all verified working on 2026-03-25):
  - `GET /rest/groups/{group_id}/orgs` — list orgs
  - `GET /rest/groups/{group_id}/issues?type=code` — group-wide SAST issues (filters: `effective_severity_level`, `status`, `ignored`, `created_after/before`)
  - `GET /rest/orgs/{org_id}/issues?type=code` — per-org issues
  - `GET|PATCH /rest/orgs/{org_id}/settings/sast` — read/toggle `sast_enabled`
  - `GET /rest/orgs/{org_id}/projects` — project inventory/coverage
  - Policies API for consistent ignores where available.

## Part 1 — `mcp-server/`: "snyk-sast-admin" MCP server

TypeScript, official `@modelcontextprotocol/sdk`, stdio transport. Registered via:
`claude mcp add snyk-sast-admin -s user -e SNYK_TOKEN=... -e SNYK_GROUP_ID=... -- node <path>/dist/index.js`

Tools (each with zod-validated input schemas and clear descriptions):
1. `list_orgs` — all orgs in the group (name, slug, id).
2. `audit_sast_settings` — table of every org with `sast_enabled` status; flags drift. (Solves: "which orgs have Code off?" — frequent support pain, cryptic SNYK-CODE-0005/0006 errors.)
3. `set_sast_settings_bulk` — enable/disable Snyk Code across many orgs: `orgs: "all" | name-glob | explicit id list`. **Safety rails: `dry_run` defaults to true and prints a preview; mutating run requires explicit `dry_run:false`; emits per-org success/fail report.** (Solves: customers wanting Code on/off across all orgs — org templates don't cover it, "Propagate to all orgs" is internal-only.)
4. `diff_org_settings` — compare a "golden" org's SAST settings against all others, list drift.
5. `audit_ignores` — all ignored Code issues across the group: who/when/reason/expiry; flag never-expiring ignores. (Solves: SOC2 audit blindness on excluded vulns.)
6. `sast_posture_summary` — severity counts (High/Medium/Low — Snyk Code has NO Critical), top CWEs, open-vs-resolved, per-org league table.

## Part 2 — `dashboard/`: customer-distributable SPA → Android APK

React 18 + Vite + TypeScript + Tailwind + Recharts. Dark default theme, modern glassmorphism cards, mobile-first responsive. Wrapped with **Capacitor** so `npx cap add android` produces an installable APK; in the APK use Capacitor's native HTTP plugin (no CORS); for browser dev use a Vite dev-proxy (`/snyk-api/*` → region base URL) since api.snyk.io doesn't send CORS headers.

Screens:
1. **Setup/Settings** — token, Group ID, region picker, "Test connection" button; stored in localStorage (web) / SecureStorage (Capacitor). Friendly first-run wizard so customers can self-serve.
2. **Posture Overview** — severity donut (H/M/L only), open/resolved trend over time, total projects scanned, last-scan freshness.
3. **Ignore Audit** — filterable table of ignored issues (who, why, expiry), export button. Compliance/SOC2-evidence framing.
4. **CWE Heat-map** — issues bucketed by CWE with OWASP Top 10 mapping, drill into issue lists.
5. **Org League Table** — per-org issue counts, issue density (issues/project), and a Code-enabled ✓/✗ column (adoption + coverage view).
6. **Export anywhere** — every table has pick-your-fields CSV/JSON export (mirrors the much-loved DAST CSV field-picker).

UX details: skeleton loaders, empty/error states with the actual API error surfaced, severity color tokens (high=red-500, medium=amber-500, low=sky-500), High/Medium quick-filter chips (Code-only customers asked for exactly this), pull-to-refresh on mobile.

## Definition of done
- `pnpm install && pnpm build` succeeds at repo root for all packages.
- MCP server boots over stdio and every tool runs against a real group (smoke-test script included, reading env vars).
- Dashboard runs in dev with proxy, loads real data for the configured group, and `npx cap sync android` completes.
- README: install for both parts, token-scope guidance (Group Viewer for dashboard; Group Admin for MCP mutations), region table, APK build steps, and a security note (token stays local, rotate after testing).

Work in this order: api-client → mcp-server (verify against the real API) → dashboard → README. Ask me only for: API token, Group ID, region.
