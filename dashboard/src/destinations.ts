/**
 * Outbound destinations: push issue/audit data to Splunk (HEC), Linear, or a
 * generic webhook. All credentials are user-supplied and stored device-local.
 *
 * Browser note: Splunk HEC and some webhooks don't send CORS headers, so in a
 * regular browser these may be blocked; the Android app uses Capacitor's native
 * HTTP (no CORS). Linear's GraphQL API supports browser calls.
 */

export interface DestinationConfig {
  splunkUrl?: string; // e.g. https://splunk.example.com:8088
  splunkToken?: string; // HEC token
  linearApiKey?: string;
  linearTeamId?: string;
  webhookUrl?: string;
  webhookAuthHeader?: string; // e.g. "Authorization: Bearer xyz"
}

export interface SendResult {
  ok: boolean;
  detail: string;
}

function corsHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("Failed to fetch")
    ? `${msg} — likely CORS-blocked in the browser; this works in the Android app (native HTTP) or enable CORS on the receiver.`
    : msg;
}

/** Send records to Splunk HTTP Event Collector as batched NDJSON events. */
export async function sendToSplunk(
  records: Record<string, unknown>[],
  sourcetype: string,
  cfg: DestinationConfig,
): Promise<SendResult> {
  if (!cfg.splunkUrl || !cfg.splunkToken) return { ok: false, detail: "Splunk HEC not configured (Settings)." };
  const base = cfg.splunkUrl.replace(/\/$/, "");
  const url = base.includes("/services/collector") ? base : `${base}/services/collector/event`;
  const body = records
    .map((r) => JSON.stringify({ event: r, sourcetype, source: "snyk-code-pulse" }))
    .join("\n");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Splunk ${cfg.splunkToken}` },
      body,
    });
    if (!res.ok) return { ok: false, detail: `Splunk HEC ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true, detail: `Sent ${records.length} event(s) to Splunk (${sourcetype}).` };
  } catch (e) {
    return { ok: false, detail: corsHint(e) };
  }
}

/** Create ONE Linear issue containing a markdown summary of the records (avoids issue spam). */
export async function sendToLinear(
  title: string,
  records: Record<string, unknown>[],
  columns: string[],
  cfg: DestinationConfig,
): Promise<SendResult> {
  if (!cfg.linearApiKey || !cfg.linearTeamId) return { ok: false, detail: "Linear not configured (Settings)." };
  const cap = 50;
  const rows = records.slice(0, cap);
  const md = [
    `Exported from **Snyk Code Pulse** at ${new Date().toISOString()} — ${records.length} record(s)${records.length > cap ? ` (showing first ${cap})` : ""}.`,
    "",
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${columns.map((c) => String(r[c] ?? "")).join(" | ")} |`),
  ].join("\n");
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: cfg.linearApiKey },
      body: JSON.stringify({
        query: `mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { identifier url } }
        }`,
        variables: { input: { teamId: cfg.linearTeamId, title, description: md } },
      }),
    });
    const json = await res.json();
    if (json.errors?.length) return { ok: false, detail: `Linear: ${json.errors[0].message}` };
    const issue = json.data?.issueCreate?.issue;
    return issue
      ? { ok: true, detail: `Created Linear issue ${issue.identifier}: ${issue.url}` }
      : { ok: false, detail: "Linear: issueCreate did not return an issue." };
  } catch (e) {
    return { ok: false, detail: corsHint(e) };
  }
}

/** POST the full payload as JSON to a generic webhook (Jira middleware, Tines, Zapier, n8n…). */
export async function sendToWebhook(
  kind: string,
  records: Record<string, unknown>[],
  cfg: DestinationConfig,
): Promise<SendResult> {
  if (!cfg.webhookUrl) return { ok: false, detail: "Webhook not configured (Settings)." };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.webhookAuthHeader?.includes(":")) {
    const idx = cfg.webhookAuthHeader.indexOf(":");
    headers[cfg.webhookAuthHeader.slice(0, idx).trim()] = cfg.webhookAuthHeader.slice(idx + 1).trim();
  }
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "snyk-code-pulse",
        kind,
        exported_at: new Date().toISOString(),
        count: records.length,
        records,
      }),
    });
    if (!res.ok) return { ok: false, detail: `Webhook ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true, detail: `Posted ${records.length} record(s) to webhook.` };
  } catch (e) {
    return { ok: false, detail: corsHint(e) };
  }
}
