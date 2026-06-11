#!/usr/bin/env node
/**
 * Smoke test: exercises the api-client against the real Snyk API.
 * Reads SNYK_TOKEN / SNYK_GROUP_ID / SNYK_REGION from env or repo-root .env.
 * Read-only — performs no mutations.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SnykClient, summarizeIssues, SNYK_API_VERSION } from "@snyk-code-pulse/api-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { SNYK_TOKEN, SNYK_GROUP_ID, SNYK_REGION = "us-01" } = process.env;
if (!SNYK_TOKEN || !SNYK_GROUP_ID) {
  console.error("Set SNYK_TOKEN and SNYK_GROUP_ID (env or .env at repo root)");
  process.exit(1);
}

const client = new SnykClient({ token: SNYK_TOKEN, region: SNYK_REGION });
console.log(`API version: ${SNYK_API_VERSION}  region: ${SNYK_REGION}`);

const orgs = await client.listOrgs(SNYK_GROUP_ID);
console.log(`✅ listOrgs: ${orgs.length} orgs (first: ${orgs[0]?.name})`);

const s1 = await client.getSastSettings(orgs[0].id);
console.log(`✅ getSastSettings(${orgs[0].name}): sast_enabled=${s1.sastEnabled}`);

const issues = await client.listGroupCodeIssues(SNYK_GROUP_ID, {}, 300);
console.log(`✅ listGroupCodeIssues: fetched ${issues.length} (cap 300)`);

const ignored = await client.listGroupCodeIssues(SNYK_GROUP_ID, { ignored: true }, 100);
console.log(`✅ ignored filter: ${ignored.length} ignored issues`);

const sum = summarizeIssues(issues);
console.log(`✅ summarize: total=${sum.total} open=${sum.open} sev=${JSON.stringify(sum.bySeverity)}`);
console.log(`   top CWEs: ${sum.byCwe.slice(0, 5).map((c) => `${c.cwe}(${c.count})`).join(", ")}`);
console.log(`   orgs with issues: ${sum.byOrg.length}`);

console.log("\nSmoke test PASSED");
