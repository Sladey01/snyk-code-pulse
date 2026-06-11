#!/usr/bin/env node
/**
 * snyk-sast-admin — MCP server for Snyk Code (SAST) group administration.
 *
 * Env vars:
 *   SNYK_TOKEN     (required) Snyk API token / service-account PAT
 *   SNYK_GROUP_ID  (required) Group to administer
 *   SNYK_REGION    (optional) us-01 | us-02 | eu | au   (default us-01)
 *
 * Register with Claude Code:
 *   claude mcp add snyk-sast-admin -s user \
 *     -e SNYK_TOKEN=... -e SNYK_GROUP_ID=... -e SNYK_REGION=us-01 \
 *     -- node /path/to/mcp-server/dist/index.js
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SnykClient,
  type RegionId,
  type Org,
  globToRegExp,
  summarizeIssues,
} from "@snyk-code-pulse/api-client";

const token = process.env.SNYK_TOKEN;
const groupId = process.env.SNYK_GROUP_ID;
const region = (process.env.SNYK_REGION ?? "us-01") as RegionId;
if (!token || !groupId) {
  console.error("snyk-sast-admin: SNYK_TOKEN and SNYK_GROUP_ID env vars are required");
  process.exit(1);
}

const client = new SnykClient({ token, region });

const server = new McpServer({ name: "snyk-sast-admin", version: "0.1.0" });

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function md(rows: string[][], header: string[]): string {
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

async function resolveOrgs(selector: { orgs: string; org_ids?: string[] }): Promise<Org[]> {
  const all = await client.listOrgs(groupId!);
  if (selector.orgs === "all") return all;
  if (selector.orgs === "ids") {
    const ids = new Set(selector.org_ids ?? []);
    return all.filter((o) => ids.has(o.id));
  }
  // treat as name glob
  const re = globToRegExp(selector.orgs);
  return all.filter((o) => re.test(o.name) || re.test(o.slug));
}

// ---------------------------------------------------------------- list_orgs
server.registerTool(
  "list_orgs",
  {
    title: "List organizations",
    description: "List all organizations in the configured Snyk group (name, slug, id).",
    inputSchema: {},
  },
  async () => {
    const orgs = await client.listOrgs(groupId!);
    return text(
      `${orgs.length} orgs in group ${groupId}\n\n` +
        md(orgs.map((o) => [o.name, o.slug, o.id]), ["Name", "Slug", "ID"]),
    );
  },
);

// ------------------------------------------------------ audit_sast_settings
server.registerTool(
  "audit_sast_settings",
  {
    title: "Audit SAST settings",
    description:
      "Report Snyk Code (SAST) enabled/disabled status for every org in the group. " +
      "Answers 'which orgs have Code off?' and explains cryptic SNYK-CODE-0005/0006 CLI errors.",
    inputSchema: {},
  },
  async () => {
    const orgs = await client.listOrgs(groupId!);
    const rows: string[][] = [];
    let on = 0;
    for (const o of orgs) {
      try {
        const s = await client.getSastSettings(o.id);
        if (s.sastEnabled) on++;
        rows.push([o.name, s.sastEnabled ? "✅ enabled" : "❌ DISABLED", o.id]);
      } catch (e: any) {
        rows.push([o.name, `⚠️ error: ${e.message?.slice(0, 60)}`, o.id]);
      }
    }
    return text(
      `SAST enablement: ${on}/${orgs.length} orgs enabled\n\n` +
        md(rows, ["Org", "Snyk Code", "ID"]) +
        `\n\nOrgs marked DISABLED will fail \`snyk code test\` with SNYK-CODE-0006 ("unable to find supported files").`,
    );
  },
);

// -------------------------------------------------- set_sast_settings_bulk
server.registerTool(
  "set_sast_settings_bulk",
  {
    title: "Bulk enable/disable Snyk Code",
    description:
      "Enable or disable Snyk Code (SAST) across many orgs at once. " +
      "Select orgs with 'all', a name glob (e.g. 'app*'), or 'ids' + org_ids list. " +
      "SAFETY: dry_run defaults to true and only previews; pass dry_run=false to apply.",
    inputSchema: {
      enabled: z.boolean().describe("Desired Snyk Code state"),
      orgs: z
        .string()
        .describe("'all', a name/slug glob like 'app*', or 'ids' (then provide org_ids)"),
      org_ids: z.array(z.string()).optional().describe("Explicit org IDs when orgs='ids'"),
      dry_run: z
        .boolean()
        .default(true)
        .describe("Preview only (default true). Set false to actually apply changes."),
    },
  },
  async ({ enabled, orgs, org_ids, dry_run }) => {
    const targets = await resolveOrgs({ orgs, org_ids });
    if (targets.length === 0) return text("No orgs matched the selector — nothing to do.");

    // Only touch orgs whose state differs
    const work: { org: Org; current: boolean }[] = [];
    for (const o of targets) {
      try {
        const s = await client.getSastSettings(o.id);
        if (s.sastEnabled !== enabled) work.push({ org: o, current: s.sastEnabled });
      } catch {
        work.push({ org: o, current: !enabled }); // unknown -> attempt
      }
    }

    if (dry_run) {
      return text(
        `DRY RUN — would set sast_enabled=${enabled} on ${work.length}/${targets.length} matched orgs ` +
          `(${targets.length - work.length} already correct):\n\n` +
          md(work.map((w) => [w.org.name, String(w.current), String(enabled), w.org.id]), [
            "Org",
            "Current",
            "→ New",
            "ID",
          ]) +
          `\n\nRe-run with dry_run=false to apply.`,
      );
    }

    const results: string[][] = [];
    let ok = 0;
    for (const w of work) {
      try {
        const s = await client.setSastEnabled(w.org.id, enabled);
        ok++;
        results.push([w.org.name, `✅ now ${s.sastEnabled}`, w.org.id]);
      } catch (e: any) {
        results.push([w.org.name, `❌ ${e.message?.slice(0, 80)}`, w.org.id]);
      }
    }
    return text(
      `Applied sast_enabled=${enabled}: ${ok}/${work.length} succeeded ` +
        `(${targets.length - work.length} were already correct).\n\n` +
        md(results, ["Org", "Result", "ID"]),
    );
  },
);

// --------------------------------------------------------- diff_org_settings
server.registerTool(
  "diff_org_settings",
  {
    title: "Diff org SAST settings against a golden org",
    description:
      "Compare every org's SAST settings against a 'golden' reference org and list drift.",
    inputSchema: {
      golden_org_id: z.string().describe("Org ID whose settings are the desired state"),
    },
  },
  async ({ golden_org_id }) => {
    const golden = await client.getSastSettings(golden_org_id);
    const orgs = await client.listOrgs(groupId!);
    const drift: string[][] = [];
    for (const o of orgs) {
      if (o.id === golden_org_id) continue;
      try {
        const s = await client.getSastSettings(o.id);
        if (s.sastEnabled !== golden.sastEnabled) {
          drift.push([o.name, String(s.sastEnabled), String(golden.sastEnabled), o.id]);
        }
      } catch (e: any) {
        drift.push([o.name, `error: ${e.message?.slice(0, 50)}`, String(golden.sastEnabled), o.id]);
      }
    }
    return text(
      drift.length === 0
        ? `No drift — all ${orgs.length - 1} other orgs match golden org (sast_enabled=${golden.sastEnabled}).`
        : `${drift.length} org(s) drift from golden (sast_enabled=${golden.sastEnabled}):\n\n` +
            md(drift, ["Org", "Current", "Golden", "ID"]),
    );
  },
);

// -------------------------------------------------------------- audit_ignores
server.registerTool(
  "audit_ignores",
  {
    title: "Audit ignored Code issues",
    description:
      "List all ignored Snyk Code issues across the group — compliance/SOC2 evidence for what has been excluded from reporting.",
    inputSchema: {
      max: z.number().int().min(10).max(5000).default(1000).describe("Max issues to fetch"),
    },
  },
  async ({ max }) => {
    const issues = await client.listGroupCodeIssues(groupId!, { ignored: true }, max);
    if (issues.length === 0) return text("No ignored Snyk Code issues found in the group. ✅");
    const orgs = await client.listOrgs(groupId!);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const rows = issues.map((i) => [
      i.title?.slice(0, 50) ?? i.id,
      i.severity,
      orgName.get(i.orgId ?? "") ?? i.orgId ?? "?",
      i.createdAt?.slice(0, 10) ?? "",
      i.id,
    ]);
    return text(
      `${issues.length} ignored Code issue(s) across the group ` +
        `(⚠️ these are EXCLUDED from most reporting — review for compliance):\n\n` +
        md(rows, ["Issue", "Severity", "Org", "Created", "ID"]),
    );
  },
);

// ------------------------------------------------------- sast_posture_summary
server.registerTool(
  "sast_posture_summary",
  {
    title: "SAST posture summary",
    description:
      "Group-wide Snyk Code posture: severity breakdown (High/Medium/Low — Code has no Critical), open vs resolved, ignored count, top CWEs, and a per-org league table.",
    inputSchema: {
      max: z.number().int().min(10).max(20000).default(5000).describe("Max issues to aggregate"),
    },
  },
  async ({ max }) => {
    const [issues, orgs] = await Promise.all([
      client.listGroupCodeIssues(groupId!, {}, max),
      client.listOrgs(groupId!),
    ]);
    const s = summarizeIssues(issues);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const sev = Object.entries(s.bySeverity)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const topCwe = md(
      s.byCwe.slice(0, 10).map((c) => [c.cwe, String(c.count)]),
      ["CWE", "Count"],
    );
    const league = md(
      s.byOrg
        .slice(0, 25)
        .map((o) => [orgName.get(o.orgId) ?? o.orgId, String(o.count), String(o.high), String(o.medium), String(o.low)]),
      ["Org", "Total", "High", "Medium", "Low"],
    );
    return text(
      `# Snyk Code posture — group ${groupId}\n` +
        `Issues analysed: ${s.total} (open ${s.open}, resolved ${s.resolved}, ignored ${s.ignored})\n` +
        `Severity: ${sev}\n\n## Top CWEs\n${topCwe}\n\n## Org league table\n${league}`,
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`snyk-sast-admin MCP server running (group ${groupId}, region ${region})`);
