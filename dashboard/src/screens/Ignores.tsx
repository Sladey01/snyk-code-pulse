import { useEffect, useMemo, useState } from "react";
import type { CodeIssue } from "@snyk-code-pulse/api-client";
import type { AppData } from "../App";
import { Card, ExportButton, Skeleton, ErrorBox } from "../components/ui";

/**
 * Ignore Audit — every ignored Snyk Code issue in the group.
 * Built for the SOC2/compliance pain: ignored issues are EXCLUDED from most
 * reporting, and auditors need to see what was excluded.
 */
export default function Ignores({ data }: { data: AppData }) {
  const [ignored, setIgnored] = useState<CodeIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    data.client
      .listGroupIssues(data.settings.groupId, ["code", "package_vulnerability"], { ignored: true }, Infinity)
      .then(setIgnored)
      .catch((e) => setError(e.message));
  }, [data.settings.groupId]);

  const orgName = useMemo(() => new Map(data.orgs.map((o) => [o.id, o.name])), [data.orgs]);

  if (error) return <ErrorBox error={error} />;
  if (!ignored) return <Skeleton rows={6} />;

  const rows = ignored.map((i) => ({
    title: i.title,
    product: i.issueType === "code" ? "SAST" : "Open Source",
    severity: i.severity,
    org: orgName.get(i.orgId ?? "") ?? i.orgId ?? "?",
    status: i.status,
    created: i.createdAt?.slice(0, 10),
    id: i.id,
  }));

  return (
    <Card
      title={`Ignore audit (SAST + Open Source) — ${ignored.length} ignored issue(s)`}
      right={<ExportButton filename="snyk-code-ignore-audit" rows={rows} allFields={["title", "product", "severity", "org", "status", "created", "id"]} />}
    >
      <p className="text-xs text-amber-400/90 mb-3">
        ⚠️ Ignored issues are excluded from most Snyk reporting. Export this view as compliance
        evidence (SOC2 auditors will ask).
      </p>
      {ignored.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          No ignored issues in this group — nothing hidden from reporting. ✅
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="py-2 pr-4">Issue</th>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Severity</th>
                <th className="py-2 pr-4">Org</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-4">{r.title}</td>
                  <td className="py-2 pr-4">{r.product}</td>
                  <td className="py-2 pr-4 capitalize">{r.severity}</td>
                  <td className="py-2 pr-4">{r.org}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                  <td className="py-2 text-slate-400">{r.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
