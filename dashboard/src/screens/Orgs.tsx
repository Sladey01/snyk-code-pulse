import { useEffect, useMemo, useState } from "react";
import {
  summarizeIssues,
  SCM_INTEGRATION_TYPES,
  type IntegrationSettings,
  type OrgIntegration,
} from "@snyk-code-pulse/api-client";
import type { AppData } from "../App";
import { Card, ExportButton, TriState, type TriStateValue } from "../components/ui";

/**
 * Org admin console: league table + multi-select bulk settings editor.
 * Settings covered: Snyk Code (SAST, REST API) and the SCM-integration settings
 * customers manage most — PR checks (OS/Code), auto fix PRs (new/backlog),
 * auto dependency-upgrade PRs (V1 integrations API).
 */

const SCM_SET = new Set<string>(SCM_INTEGRATION_TYPES);

interface BulkSpec {
  sast: TriStateValue;
  prChecksOs: TriStateValue;
  prChecksCode: TriStateValue;
  fixPrsFresh: TriStateValue;
  fixPrsBacklog: TriStateValue;
  upgradePrs: TriStateValue;
}
const KEEP_ALL: BulkSpec = {
  sast: "keep",
  prChecksOs: "keep",
  prChecksCode: "keep",
  fixPrsFresh: "keep",
  fixPrsBacklog: "keep",
  upgradePrs: "keep",
};

const BULK_FIELDS: Array<{ key: keyof BulkSpec; label: string }> = [
  { key: "sast", label: "Snyk Code (SAST)" },
  { key: "prChecksOs", label: "PR checks — Open Source" },
  { key: "prChecksCode", label: "PR checks — Code" },
  { key: "fixPrsFresh", label: "Auto fix PRs (new issues)" },
  { key: "fixPrsBacklog", label: "Auto fix PRs (backlog)" },
  { key: "upgradePrs", label: "Auto upgrade PRs" },
];

function integrationPatch(spec: BulkSpec): IntegrationSettings | null {
  const p: IntegrationSettings = {};
  const arp: NonNullable<IntegrationSettings["autoRemediationPrs"]> = {};
  if (spec.prChecksOs !== "keep") p.pullRequestTestEnabled = spec.prChecksOs === "on";
  if (spec.prChecksCode !== "keep") p.pullRequestTestCodeEnabled = spec.prChecksCode === "on";
  if (spec.upgradePrs !== "keep") p.autoDepUpgradeEnabled = spec.upgradePrs === "on";
  if (spec.fixPrsFresh !== "keep") arp.freshPrsEnabled = spec.fixPrsFresh === "on";
  if (spec.fixPrsBacklog !== "keep") arp.backlogPrsEnabled = spec.fixPrsBacklog === "on";
  if (Object.keys(arp).length > 0) p.autoRemediationPrs = arp;
  return Object.keys(p).length > 0 ? p : null;
}

interface OrgDetail {
  loading: boolean;
  error?: string;
  integrations: Array<{ type: string; id: string; settings: IntegrationSettings }>;
}

type ApplyRow = { org: string; action: string; result: "ok" | "fail"; detail?: string };

function chip(label: string, on: boolean | undefined) {
  return (
    <span
      key={label}
      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
        on === undefined
          ? "border-slate-700 text-slate-500"
          : on
            ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
            : "border-slate-600 text-slate-400"
      }`}
    >
      {label} {on === undefined ? "?" : on ? "✓" : "✗"}
    </span>
  );
}

export default function Orgs({ data }: { data: AppData }) {
  const [sastState, setSastState] = useState<Map<string, boolean | "error">>(new Map());
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, OrgDetail>>(new Map());
  const [spec, setSpec] = useState<BulkSpec>(KEEP_ALL);
  const [phase, setPhase] = useState<"idle" | "preview" | "applying" | "done">("idle");
  const [applyRows, setApplyRows] = useState<ApplyRow[]>([]);

  const sum = useMemo(() => summarizeIssues(data.issues), [data.issues]);
  const counts = useMemo(() => new Map(sum.byOrg.map((o) => [o.orgId, o])), [sum]);

  // SAST status for all orgs, 8 workers
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const queue = [...data.orgs];
      const out = new Map<string, boolean | "error">();
      const workers = Array.from({ length: 8 }, async () => {
        while (queue.length > 0 && !cancelled) {
          const org = queue.shift()!;
          try {
            const s = await data.client.getSastSettings(org.id);
            out.set(org.id, s.sastEnabled);
          } catch {
            out.set(org.id, "error");
          }
          if (!cancelled) {
            setSastState(new Map(out));
            setProgress(out.size);
          }
        }
      });
      await Promise.all(workers);
    })();
    return () => {
      cancelled = true;
    };
  }, [data.orgs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data.orgs.filter(
      (o) => !q || o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
    return rows
      .map((o) => ({ org: o, count: counts.get(o.id) }))
      .sort((a, b) => (b.count?.count ?? 0) - (a.count?.count ?? 0));
  }, [data.orgs, counts, search]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.org.id));

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.org.id));
      else filtered.forEach((r) => next.add(r.org.id));
      return next;
    });
  }

  async function loadDetail(orgId: string, force = false) {
    if (!force && details.get(orgId)) return;
    setDetails((m) => new Map(m).set(orgId, { loading: true, integrations: [] }));
    try {
      const all = await data.client.listIntegrations(orgId);
      const scm = all.filter((i: OrgIntegration) => SCM_SET.has(i.type));
      const integrations = await Promise.all(
        scm.map(async (i) => ({
          ...i,
          settings: await data.client.getIntegrationSettings(orgId, i.id),
        })),
      );
      setDetails((m) => new Map(m).set(orgId, { loading: false, integrations }));
    } catch (e: any) {
      setDetails((m) =>
        new Map(m).set(orgId, { loading: false, error: e.message, integrations: [] }),
      );
    }
  }

  function toggleExpand(orgId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else {
        next.add(orgId);
        void loadDetail(orgId);
      }
      return next;
    });
  }

  const activeChanges = BULK_FIELDS.filter((f) => spec[f.key] !== "keep");
  const intPatch = integrationPatch(spec);

  async function apply() {
    setPhase("applying");
    const rows: ApplyRow[] = [];
    const targets = data.orgs.filter((o) => selected.has(o.id));
    const queue = [...targets];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length > 0) {
        const org = queue.shift()!;
        if (spec.sast !== "keep") {
          try {
            await data.client.setSastEnabled(org.id, spec.sast === "on");
            rows.push({ org: org.name, action: `Snyk Code → ${spec.sast}`, result: "ok" });
          } catch (e: any) {
            rows.push({ org: org.name, action: "Snyk Code", result: "fail", detail: e.message?.slice(0, 100) });
          }
        }
        if (intPatch) {
          try {
            const all = await data.client.listIntegrations(org.id);
            const scm = all.filter((i: OrgIntegration) => SCM_SET.has(i.type));
            if (scm.length === 0) {
              rows.push({ org: org.name, action: "integration settings", result: "ok", detail: "no SCM integrations — skipped" });
            }
            for (const i of scm) {
              try {
                await data.client.updateIntegrationSettings(org.id, i.id, intPatch);
                rows.push({ org: org.name, action: `${i.type} settings`, result: "ok" });
              } catch (e: any) {
                rows.push({ org: org.name, action: `${i.type} settings`, result: "fail", detail: e.message?.slice(0, 100) });
              }
            }
          } catch (e: any) {
            rows.push({ org: org.name, action: "list integrations", result: "fail", detail: e.message?.slice(0, 100) });
          }
        }
        setApplyRows([...rows]);
        // refresh caches for this org
        if (spec.sast !== "keep") {
          try {
            const s = await data.client.getSastSettings(org.id);
            setSastState((m) => new Map(m).set(org.id, s.sastEnabled));
          } catch {}
        }
        if (details.get(org.id)) void loadDetail(org.id, true);
      }
    });
    await Promise.all(workers);
    setApplyRows([...rows]);
    setPhase("done");
  }

  const exportRows = filtered.map(({ org: o, count: c }) => ({
    org: o.name,
    sastEnabled: String(sastState.get(o.id) ?? ""),
    total: c?.count ?? 0,
    critical: c?.critical ?? 0,
    high: c?.high ?? 0,
    medium: c?.medium ?? 0,
    low: c?.low ?? 0,
    id: o.id,
  }));

  const enabled = [...sastState.values()].filter((v) => v === true).length;
  const disabled = [...sastState.values()].filter((v) => v === false).length;

  return (
    <div className="space-y-4 pb-40">
      <Card
        title={`Org admin console — ${data.orgs.length} orgs`}
        right={
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orgs…"
              className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs w-44 focus:border-indigo-500 outline-none"
            />
            <ExportButton
              filename="snyk-org-league"
              rows={exportRows}
              allFields={["org", "sastEnabled", "total", "critical", "high", "medium", "low", "id"]}
            />
          </div>
        }
      >
        <p className="text-xs text-slate-400 mb-3">
          SAST coverage: <span className="text-emerald-400">{enabled} enabled</span> ·{" "}
          <span className="text-red-400">{disabled} disabled</span>
          {progress < data.orgs.length && ` · checking ${progress}/${data.orgs.length}…`}
          {" · "}
          <span className="text-slate-500">
            select orgs (☑) to bulk-edit settings · ▸ expands integration detail
          </span>
        </p>
        <div className="overflow-x-auto max-h-[34rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="py-2 pr-2 w-8">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                </th>
                <th className="py-2 pr-2 w-6"></th>
                <th className="py-2 pr-4">Org</th>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4 text-right text-red-500">Crit</th>
                <th className="py-2 pr-4 text-right text-orange-400">High</th>
                <th className="py-2 pr-4 text-right text-amber-400">Med</th>
                <th className="py-2 text-right text-sky-400">Low</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ org: o, count: c }) => {
                const sast = sastState.get(o.id);
                const isOpen = expanded.has(o.id);
                const det = details.get(o.id);
                return (
                  <FragmentRow
                    key={o.id}
                    checked={selected.has(o.id)}
                    onCheck={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(o.id)) next.delete(o.id);
                        else next.add(o.id);
                        return next;
                      })
                    }
                    isOpen={isOpen}
                    onExpand={() => toggleExpand(o.id)}
                    cells={[
                      o.name,
                      sast === undefined ? "…" : sast === "error" ? "⚠️" : sast ? "✅" : "❌",
                      String(c?.count ?? 0),
                      String(c?.critical ?? 0),
                      String(c?.high ?? 0),
                      String(c?.medium ?? 0),
                      String(c?.low ?? 0),
                    ]}
                    detail={
                      isOpen ? (
                        <div className="px-3 py-2 space-y-2 bg-slate-900/60 rounded-lg my-1">
                          {det?.loading && <p className="text-xs text-slate-500">Loading integrations…</p>}
                          {det?.error && <p className="text-xs text-red-400">⚠️ {det.error}</p>}
                          {det && !det.loading && !det.error && det.integrations.length === 0 && (
                            <p className="text-xs text-slate-500">No SCM integrations configured.</p>
                          )}
                          {det?.integrations.map((i) => (
                            <div key={i.id} className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-indigo-300 w-40">{i.type}</span>
                              {chip("PR checks OS", i.settings.pullRequestTestEnabled)}
                              {chip("PR checks Code", i.settings.pullRequestTestCodeEnabled)}
                              {chip("Fix PRs", i.settings.autoRemediationPrs?.freshPrsEnabled)}
                              {chip("Backlog PRs", i.settings.autoRemediationPrs?.backlogPrsEnabled)}
                              {chip("Upgrade PRs", i.settings.autoDepUpgradeEnabled)}
                            </div>
                          ))}
                        </div>
                      ) : null
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-700 bg-slate-950/95 backdrop-blur-lg">
          <div className="max-w-6xl mx-auto px-4 py-3 space-y-3">
            {phase === "idle" && (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-bold text-indigo-400">{selected.size} org(s) selected</span>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-slate-300">
                    clear selection
                  </button>
                  <div className="ml-auto flex gap-2">
                    <button
                      disabled={activeChanges.length === 0}
                      onClick={() => setPhase("preview")}
                      className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold"
                    >
                      Preview changes
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-2">
                  {BULK_FIELDS.map((f) => (
                    <TriState
                      key={f.key}
                      label={f.label}
                      value={spec[f.key]}
                      onChange={(v) => setSpec((s) => ({ ...s, [f.key]: v }))}
                    />
                  ))}
                </div>
              </>
            )}

            {phase === "preview" && (
              <div className="space-y-2">
                <p className="text-xs text-amber-400 font-semibold">
                  PREVIEW — about to change {activeChanges.length} setting(s) on {selected.size} org(s):
                </p>
                <ul className="text-xs text-slate-300 flex flex-wrap gap-x-5 gap-y-1">
                  {activeChanges.map((f) => (
                    <li key={f.key}>
                      {f.label} → <strong className={spec[f.key] === "on" ? "text-emerald-400" : "text-red-400"}>{spec[f.key]}</strong>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500">
                  Integration settings apply to every SCM integration in each selected org. SAST applies once per org.
                </p>
                <div className="flex gap-2">
                  <button onClick={apply} className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold">
                    Apply now
                  </button>
                  <button onClick={() => setPhase("idle")} className="px-4 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold">
                    Back
                  </button>
                </div>
              </div>
            )}

            {(phase === "applying" || phase === "done") && (
              <div className="space-y-2">
                <p className="text-xs font-semibold">
                  {phase === "applying" ? "Applying…" : "Done"} — {applyRows.filter((r) => r.result === "ok").length} ok,{" "}
                  <span className="text-red-400">{applyRows.filter((r) => r.result === "fail").length} failed</span>
                </p>
                <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
                  {applyRows.map((r, idx) => (
                    <div key={idx} className={r.result === "ok" ? "text-slate-400" : "text-red-400"}>
                      {r.result === "ok" ? "✅" : "❌"} {r.org} — {r.action}
                      {r.detail ? ` (${r.detail})` : ""}
                    </div>
                  ))}
                </div>
                {phase === "done" && (
                  <button
                    onClick={() => {
                      setPhase("idle");
                      setSpec(KEEP_ALL);
                      setSelected(new Set());
                      setApplyRows([]);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold"
                  >
                    Close
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Table row + optional full-width detail row. */
function FragmentRow({
  checked,
  onCheck,
  isOpen,
  onExpand,
  cells,
  detail,
}: {
  checked: boolean;
  onCheck: () => void;
  isOpen: boolean;
  onExpand: () => void;
  cells: string[];
  detail: React.ReactNode;
}) {
  const [name, code, total, crit, high, med, low] = cells;
  return (
    <>
      <tr className="border-t border-slate-800 hover:bg-slate-800/40">
        <td className="py-1.5 pr-2">
          <input type="checkbox" checked={checked} onChange={onCheck} />
        </td>
        <td className="py-1.5 pr-2">
          <button onClick={onExpand} className="text-slate-500 hover:text-slate-200 text-xs">
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td className="py-1.5 pr-4">{name}</td>
        <td className="py-1.5 pr-4">{code}</td>
        <td className="py-1.5 pr-4 text-right font-semibold">{total}</td>
        <td className="py-1.5 pr-4 text-right">{crit}</td>
        <td className="py-1.5 pr-4 text-right">{high}</td>
        <td className="py-1.5 pr-4 text-right">{med}</td>
        <td className="py-1.5 text-right">{low}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={9}>{detail}</td>
        </tr>
      )}
    </>
  );
}
