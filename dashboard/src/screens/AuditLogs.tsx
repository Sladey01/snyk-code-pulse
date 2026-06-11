import { useEffect, useMemo, useState } from "react";
import type { AuditLogEvent } from "@snyk-code-pulse/api-client";
import type { AppData } from "../App";
import { Card, ExportButton, SendMenu, Skeleton, ErrorBox } from "../components/ui";

const COLS = ["created", "event", "org", "user_id", "content"];

/** Group audit-log viewer: who did what, when — exportable & pushable to SIEM. */
export default function AuditLogs({ data }: { data: AppData }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventFilter, setEventFilter] = useState("");
  const [logs, setLogs] = useState<AuditLogEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const orgName = useMemo(() => new Map(data.orgs.map((o) => [o.id, o.name])), [data.orgs]);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const items = await data.client.searchGroupAuditLogs(data.settings.groupId, {
        from: `${from}T00:00:00Z`,
        to: `${to}T23:59:59Z`,
        max: 2000,
      });
      setLogs(items);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = eventFilter.trim().toLowerCase();
    return (logs ?? []).filter((l) => !q || l.event.toLowerCase().includes(q));
  }, [logs, eventFilter]);

  const rows = filtered.map((l) => ({
    created: l.created,
    event: l.event,
    org: orgName.get(l.org_id ?? "") ?? l.org_id ?? "",
    user_id: l.user_id ?? "",
    content: JSON.stringify(l.content ?? {}),
  }));

  const eventCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) m.set(l.event, (m.get(l.event) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card
        title={`Audit logs — group activity`}
        right={
          <div className="flex gap-2">
            <ExportButton filename="snyk-audit-logs" rows={rows} allFields={COLS} />
            <SendMenu
              kind="audit_logs"
              title={`Snyk audit logs ${from} → ${to} (${rows.length} events)`}
              rows={rows}
              columns={["created", "event", "org", "user_id"]}
              config={data.settings}
            />
          </div>
        }
      >
        <div className="flex items-end gap-3 flex-wrap mb-4">
          <label className="text-xs text-slate-400">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="block mt-1 rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          </label>
          <label className="text-xs text-slate-400">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="block mt-1 rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          </label>
          <label className="text-xs text-slate-400 flex-1 min-w-40">
            Event filter
            <input value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} placeholder="e.g. settings, project.test, user"
              className="block mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          </label>
          <button onClick={fetchLogs} disabled={loading}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold">
            {loading ? "Loading…" : "Fetch"}
          </button>
        </div>

        {error && <ErrorBox error={error} />}
        {!logs && loading && <Skeleton rows={8} />}

        {logs && (
          <>
            <div className="flex gap-2 flex-wrap mb-3">
              {eventCounts.map(([ev, n]) => (
                <button key={ev} onClick={() => setEventFilter(ev === eventFilter ? "" : ev)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    eventFilter === ev ? "border-indigo-500 text-indigo-300 bg-indigo-500/10" : "border-slate-700 text-slate-400"
                  }`}>
                  {ev} ({n})
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mb-2">{rows.length} event(s)</p>
            <div className="overflow-x-auto max-h-[30rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Event</th>
                    <th className="py-2 pr-4">Org</th>
                    <th className="py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/40">
                      <td className="py-1.5 pr-4 text-slate-400 whitespace-nowrap">{r.created.replace("T", " ").slice(0, 19)}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.event}</td>
                      <td className="py-1.5 pr-4">{r.org}</td>
                      <td className="py-1.5 text-xs text-slate-500 max-w-md truncate" title={r.content}>{r.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
