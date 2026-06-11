import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { summarizeIssues } from "@snyk-code-pulse/api-client";
import type { AppData } from "../App";
import { Card, ExportButton } from "../components/ui";

/** OWASP Top 10 (2021) mapping for the most common Snyk Code CWEs. */
const OWASP: Record<string, string> = {
  "CWE-79": "A03 Injection (XSS)",
  "CWE-89": "A03 Injection (SQLi)",
  "CWE-78": "A03 Injection (OS cmd)",
  "CWE-23": "A01 Broken Access Control (Path traversal)",
  "CWE-22": "A01 Broken Access Control (Path traversal)",
  "CWE-352": "A01 Broken Access Control (CSRF)",
  "CWE-798": "A07 Identification & Auth Failures (Hardcoded creds)",
  "CWE-259": "A07 Identification & Auth Failures (Hardcoded password)",
  "CWE-327": "A02 Cryptographic Failures",
  "CWE-326": "A02 Cryptographic Failures",
  "CWE-916": "A02 Cryptographic Failures (Weak hash)",
  "CWE-547": "A05 Security Misconfiguration",
  "CWE-770": "A04 Insecure Design (No rate limit)",
  "CWE-918": "A10 SSRF",
  "CWE-611": "A05 Security Misconfiguration (XXE)",
  "CWE-502": "A08 Software & Data Integrity (Deserialization)",
};

export default function Cwe({ data }: { data: AppData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sum = useMemo(() => summarizeIssues(data.issues), [data.issues]);
  const top = sum.byCwe.slice(0, 15);

  const drill = selected ? data.issues.filter((i) => i.cwes.includes(selected)) : [];
  const exportRows = top.map((c) => ({ cwe: c.cwe, count: c.count, owasp: OWASP[c.cwe] ?? "" }));

  return (
    <div className="space-y-5">
      <Card
        title="Top CWE categories"
        right={<ExportButton filename="snyk-code-cwe-breakdown" rows={exportRows} allFields={["cwe", "count", "owasp"]} />}
      >
        <ResponsiveContainer width="100%" height={Math.max(260, top.length * 28)}>
          <BarChart data={top} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke="#64748b" fontSize={11} />
            <YAxis type="category" dataKey="cwe" stroke="#94a3b8" fontSize={11} width={80} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
              formatter={(v: any, _n: any, p: any) => [`${v} issues — ${OWASP[p.payload.cwe] ?? "unmapped"}`, p.payload.cwe]}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} onClick={(d: any) => setSelected(d.cwe)} cursor="pointer">
              {top.map((c) => (
                <Cell key={c.cwe} fill={c.cwe === selected ? "#f59e0b" : "#6366f1"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-500 mt-1">Click a bar to drill into its issues. OWASP Top-10 mapping shown in tooltip.</p>
      </Card>

      {selected && (
        <Card title={`${selected} — ${OWASP[selected] ?? "issues"} (${drill.length})`}>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase">
                  <th className="py-2 pr-4">Issue</th>
                  <th className="py-2 pr-4">Severity</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {drill.map((i) => (
                  <tr key={i.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4">{i.title}</td>
                    <td className="py-2 pr-4 capitalize">{i.severity}</td>
                    <td className="py-2">{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
