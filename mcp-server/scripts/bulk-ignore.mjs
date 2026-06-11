#!/usr/bin/env node
/**
 * Bulk-ignore issues in an org by severity/status filter.
 *
 * Usage:
 *   node bulk-ignore.mjs --org <orgId> --severity low [--days 90] [--reason "..."] [--dry-run]
 *
 * Reads SNYK_TOKEN / SNYK_REGION from env or repo-root .env.
 * Uses the V1 ignore endpoint (one POST per project × problem), deduped so one
 * ignore covers all paths of the same problem in a project (ignorePath "").
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SnykClient } from "@snyk-code-pulse/api-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const orgId = get("--org");
const severity = get("--severity", "low");
const days = Number(get("--days", "90"));
const dryRun = args.includes("--dry-run");
const reason = get(
  "--reason",
  `Bulk de-prioritisation of ${severity}-severity issues (${days}-day review) — Snyk Code Pulse`,
);
if (!orgId) {
  console.error("--org <orgId> is required");
  process.exit(1);
}

const client = new SnykClient({ token: process.env.SNYK_TOKEN, region: process.env.SNYK_REGION ?? "us-01" });
const expires = new Date(Date.now() + days * 864e5).toISOString();

console.log(`Fetching open ${severity} issues for org ${orgId}…`);
const issues = await client.listOrgIssues(orgId, ["code", "package_vulnerability"], {
  severities: [severity],
  status: ["open"],
});
console.log(`Fetched ${issues.length} open ${severity} issue rows`);

// Dedupe: one ignore per (project, problem key) covers all paths.
const targets = new Map();
let skipped = 0;
for (const i of issues) {
  if (!i.projectId || !i.key) {
    skipped++;
    continue;
  }
  targets.set(`${i.projectId}::${i.key}`, { projectId: i.projectId, key: i.key, type: i.issueType });
}
console.log(`${targets.size} unique (project × problem) ignores to create (${skipped} rows lacked project/key)`);
console.log(`Reason: "${reason}" — expires ${expires.slice(0, 10)}`);

if (dryRun) {
  console.log("DRY RUN — no ignores created.");
  process.exit(0);
}

const queue = [...targets.values()];
const stats = { ok: 0, fail: 0, byType: {}, errors: new Map() };
const workers = Array.from({ length: 8 }, async () => {
  while (queue.length > 0) {
    const t = queue.shift();
    try {
      await client.request(`/org/${orgId}/project/${t.projectId}/ignore/${encodeURIComponent(t.key)}`, {
        v1: true,
        method: "POST",
        body: {
          ignorePath: "",
          reason,
          reasonType: "wont-fix",
          disregardIfFixable: false,
          expires,
        },
      });
      stats.ok++;
      stats.byType[t.type] = (stats.byType[t.type] ?? 0) + 1;
    } catch (e) {
      stats.fail++;
      const k = String(e.message).slice(0, 80);
      stats.errors.set(k, (stats.errors.get(k) ?? 0) + 1);
    }
    const done = stats.ok + stats.fail;
    if (done % 100 === 0) console.log(`progress: ${done}/${targets.size} (ok ${stats.ok}, fail ${stats.fail})`);
  }
});
await Promise.all(workers);

console.log(`\nDONE: ${stats.ok} ignored, ${stats.fail} failed, byType=${JSON.stringify(stats.byType)}`);
for (const [err, n] of [...stats.errors.entries()].slice(0, 5)) console.log(`  error ×${n}: ${err}`);
