import { useState } from "react";
import { REGIONS, SnykClient, type RegionId } from "@snyk-code-pulse/api-client";
import { Capacitor } from "@capacitor/core";
import type { Settings } from "../settings";
import { Card } from "../components/ui";

export default function Setup({
  initial,
  onSave,
  onClear,
}: {
  initial?: Settings;
  onSave: (s: Settings) => void;
  onClear?: () => void;
}) {
  const [token, setToken] = useState(initial?.token ?? "");
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [region, setRegion] = useState<RegionId>(initial?.region ?? "us-01");
  const [splunkUrl, setSplunkUrl] = useState(initial?.splunkUrl ?? "");
  const [splunkToken, setSplunkToken] = useState(initial?.splunkToken ?? "");
  const [linearApiKey, setLinearApiKey] = useState(initial?.linearApiKey ?? "");
  const [linearTeamId, setLinearTeamId] = useState(initial?.linearTeamId ?? "");
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [webhookAuthHeader, setWebhookAuthHeader] = useState(initial?.webhookAuthHeader ?? "");

  const destinations = { splunkUrl, splunkToken, linearApiKey, linearTeamId, webhookUrl, webhookAuthHeader };
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  async function testConnection() {
    setTestState("testing");
    try {
      const client = new SnykClient({
        token,
        baseUrl: Capacitor.isNativePlatform() ? REGIONS[region] : `/snyk-api/${region}`,
      });
      const orgs = await client.listOrgs(groupId, 10);
      setTestState("ok");
      setTestMsg(`Connected — found ${orgs.length}${orgs.length === 10 ? "+" : ""} org(s), e.g. "${orgs[0]?.name}"`);
    } catch (e: any) {
      setTestState("fail");
      setTestMsg(e.message ?? String(e));
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <Card title="Connect to Snyk">
        <p className="text-sm text-slate-400 mb-4">
          Enter your own Snyk API token and Group ID. Credentials are stored{" "}
          <strong className="text-slate-200">only on this device</strong> and sent only to Snyk's API.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">API token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              placeholder="Service-account token (Group Viewer is enough)"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Group ID</span>
            <input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value.trim())}
              placeholder="e.g. 00000000-0000-0000-0000-000000000000"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Region</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionId)}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
            >
              <option value="us-01">US-01 (api.snyk.io)</option>
              <option value="us-02">US-02 (api.us.snyk.io)</option>
              <option value="eu">EU (api.eu.snyk.io)</option>
              <option value="au">AU (api.au.snyk.io)</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={testConnection}
            disabled={!token || !groupId || testState === "testing"}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm font-semibold"
          >
            {testState === "testing" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={() => onSave({ token, groupId, region, ...destinations })}
            disabled={!token || !groupId}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-semibold"
          >
            Save & open dashboard
          </button>
          {onClear && (
            <button onClick={onClear} className="ml-auto text-xs text-red-400 hover:text-red-300">
              Forget credentials
            </button>
          )}
        </div>
        {testState === "ok" && <p className="mt-3 text-sm text-emerald-400">✅ {testMsg}</p>}
        {testState === "fail" && <p className="mt-3 text-sm text-red-400 break-all">❌ {testMsg}</p>}
      </Card>

      <Card title="Destinations (optional) — Send ⤴ targets">
        <p className="text-xs text-slate-400 mb-4">
          Configure where the <strong>Send ⤴</strong> buttons push issue &amp; audit-log data.
          Credentials stay on this device. Browser tabs may hit CORS for Splunk/webhooks — the
          Android app sends natively without CORS.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Splunk HEC URL</span>
            <input value={splunkUrl} onChange={(e) => setSplunkUrl(e.target.value.trim())}
              placeholder="https://splunk.example.com:8088"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Splunk HEC token</span>
            <input type="password" value={splunkToken} onChange={(e) => setSplunkToken(e.target.value.trim())}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Linear API key</span>
            <input type="password" value={linearApiKey} onChange={(e) => setLinearApiKey(e.target.value.trim())}
              placeholder="lin_api_…"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Linear team ID</span>
            <input value={linearTeamId} onChange={(e) => setLinearTeamId(e.target.value.trim())}
              placeholder="UUID from Linear team settings"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Webhook URL</span>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value.trim())}
              placeholder="https://hooks.example.com/snyk (Zapier, n8n, Tines, Jira middleware…)"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Webhook auth header</span>
            <input value={webhookAuthHeader} onChange={(e) => setWebhookAuthHeader(e.target.value)}
              placeholder="Authorization: Bearer xyz (optional)"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" />
          </label>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Remember to hit <strong>Save &amp; open dashboard</strong> above to persist destination changes.
        </p>
      </Card>
    </div>
  );
}
