import { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { summarizeIssues } from "@snyk-code-pulse/api-client";
import type { AppData } from "../App";
import { Card, Stat, SevChip, ExportButton, SendMenu, SEV_COLOR } from "../components/ui";

const PRODUCTS: Record<string, string> = { code: "SAST", package_vulnerability: "Open Source" };

export default function Overview({ data }: { data: AppData }) {
  const [sevFilter, setSevFilter] = useState<string[]>([]); // empty = all
  const [productFilter, setProductFilter] = useState<string[]>([]); // empty = all

  const filtered = useMemo(
    () =>
      data.issues.filter(
        (i) =>
          (sevFilter.length === 0 || sevFilter.includes(i.severity)) &&
          (productFilter.length === 0 || productFilter.includes(i.issueType)),
      ),
    [data.issues, sevFilter, productFilter],
  );
  const sum = useMemo(() => summarizeIssues(filtered), [filtered]);

  const donut = ["critical", "high", "medium", "low"]
    .map((s) => ({ name: s, value: sum.bySeverity[s] ?? 0 }))
    .filter((d) => d.value > 0);

  // Cumulative created-over-time trend by month
  const trend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const i of filtered) {
      const m = (i.createdAt ?? "").slice(0, 7);
      if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
    const months = [...byMonth.keys()].sort();
    let cum = 0;
    return months.map((m) => ({ month: m, issues: (cum += byMonth.get(m)!) }));
  }, [filtered]);

  const exportRows = filtered.map((i) => ({
    id: i.id, product: PRODUCTS[i.issueType] ?? i.issueType, title: i.title, severity: i.severity, status: i.status,
    ignored: i.ignored, created: i.createdAt, org: i.orgId, cwes: i.cwes.join(";"),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 font-semibold uppercase">Severity</span>
        {/* Critical applies to Open Source only — Snyk Code tops out at High */}
        {["critical", "high", "medium", "low"].map((s) => (
          <SevChip
            key={s}
            sev={s}
            active={sevFilter.includes(s)}
            onClick={() =>
              setSevFilter((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]))
            }
          />
        ))}
        <button onClick={() => setSevFilter([])} className="text-xs text-slate-500 hover:text-slate-300">
          clear
        </button>
        <span className="text-xs text-slate-400 font-semibold uppercase ml-3">Product</span>
        {Object.entries(PRODUCTS).map(([type, label]) => (
          <button
            key={type}
            onClick={() =>
              setProductFilter((f) => (f.includes(type) ? f.filter((x) => x !== type) : [...f, type]))
            }
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
              productFilter.includes(type)
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "text-slate-300 border-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={data.refresh} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold">
            ↻ Refresh
          </button>
          <ExportButton filename="snyk-code-issues" rows={exportRows} allFields={Object.keys(exportRows[0] ?? { id: "" })} />
          <SendMenu
            kind="issues"
            title={`Snyk issues export (${exportRows.length})`}
            rows={exportRows}
            columns={["product", "title", "severity", "status", "org"]}
            config={data.settings}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total issues" value={sum.total} />
        <Stat label="Open" value={sum.open} accent="#ef4444" />
        <Stat label="Resolved" value={sum.resolved} accent="#10b981" />
        <Stat label="Ignored" value={sum.ignored} accent="#f59e0b" />
        <Stat label="Orgs affected" value={sum.byOrg.length} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Severity split">
          {donut.length === 0 ? (
            <p className="text-sm text-slate-500 py-10 text-center">No issues match the filter 🎉</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4}>
                  {donut.map((d) => (
                    <Cell key={d.name} fill={SEV_COLOR[d.name]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex justify-center gap-4 text-xs">
            {donut.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEV_COLOR[d.name] }} />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </Card>

        <Card title="Issue growth over time (cumulative)">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }} />
              <Area type="monotone" dataKey="issues" stroke="#818cf8" fill="url(#g)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
