import { useState, type ReactNode } from "react";
import { downloadCsv, downloadJson } from "../csv";
import {
  sendToSplunk,
  sendToLinear,
  sendToWebhook,
  type DestinationConfig,
  type SendResult,
} from "../destinations";

export const SEV_COLOR: Record<string, string> = {
  critical: "#dc2626", // red-600
  high: "#f97316", // orange-500
  medium: "#eab308", // yellow-500
  low: "#0ea5e9", // sky-500
};

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="glass p-5">
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="glass p-5 text-center">
      <div className="text-3xl font-bold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

export function SevChip({
  sev,
  active,
  onClick,
}: {
  sev: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
        active ? "text-slate-950" : "text-slate-300 border-slate-600"
      }`}
      style={active ? { backgroundColor: SEV_COLOR[sev], borderColor: SEV_COLOR[sev] } : undefined}
    >
      {sev.toUpperCase()}
    </button>
  );
}

/** Pick-your-fields export button (the DAST-CSV-field-picker pattern customers loved). */
export function ExportButton({
  filename,
  rows,
  allFields,
}: {
  filename: string;
  rows: Record<string, unknown>[];
  allFields: string[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(allFields);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold"
      >
        Export ⬇
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-20 glass p-4 w-56 space-y-2">
          <div className="text-xs text-slate-400 font-semibold mb-1">Fields to include</div>
          {allFields.map((f) => (
            <label key={f} className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={picked.includes(f)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, f] : picked.filter((x) => x !== f))
                }
              />
              {f}
            </label>
          ))}
          <div className="flex gap-2 pt-2">
            <button
              className="flex-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold"
              onClick={() => {
                downloadCsv(`${filename}.csv`, rows, picked);
                setOpen(false);
              }}
            >
              CSV
            </button>
            <button
              className="flex-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs font-semibold"
              onClick={() => {
                downloadJson(`${filename}.json`, rows);
                setOpen(false);
              }}
            >
              JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Send ⤴" menu: push the given rows to Splunk / Linear / a webhook. */
export function SendMenu({
  kind,
  title,
  rows,
  columns,
  config,
}: {
  kind: string; // e.g. "issues" | "audit_logs" — used as Splunk sourcetype suffix
  title: string; // Linear issue title
  rows: Record<string, unknown>[];
  columns: string[];
  config: DestinationConfig;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const dests = [
    { name: "Splunk", configured: Boolean(config.splunkUrl && config.splunkToken),
      run: () => sendToSplunk(rows, `snyk:codepulse:${kind}`, config) },
    { name: "Linear", configured: Boolean(config.linearApiKey && config.linearTeamId),
      run: () => sendToLinear(title, rows, columns, config) },
    { name: "Webhook", configured: Boolean(config.webhookUrl),
      run: () => sendToWebhook(kind, rows, config) },
  ];

  async function fire(d: (typeof dests)[number]) {
    setBusy(d.name);
    setResult(null);
    const r = await d.run();
    setResult(r);
    setBusy(null);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold"
      >
        Send ⤴
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-20 glass p-3 w-72 space-y-2">
          <div className="text-xs text-slate-400 font-semibold">
            Send {rows.length} record(s) to…
          </div>
          {dests.map((d) => (
            <button
              key={d.name}
              disabled={!d.configured || busy !== null}
              onClick={() => fire(d)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 flex justify-between"
            >
              <span>{busy === d.name ? `Sending to ${d.name}…` : d.name}</span>
              {!d.configured && <span className="text-slate-500 font-normal">configure in Settings</span>}
            </button>
          ))}
          {result && (
            <p className={`text-xs break-all ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
              {result.ok ? "✅" : "❌"} {result.detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export type TriStateValue = "keep" | "on" | "off";

/** Keep / On / Off selector for bulk settings changes. */
export function TriState({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriStateValue;
  onChange: (v: TriStateValue) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TriStateValue)}
        className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none bg-slate-800 ${
          value === "keep"
            ? "border-slate-700 text-slate-400"
            : value === "on"
              ? "border-emerald-500 text-emerald-400"
              : "border-red-500 text-red-400"
        }`}
      >
        <option value="keep">Keep</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded-lg bg-slate-800/70" />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="glass p-4 border-red-500/40 text-red-300 text-sm whitespace-pre-wrap">
      ⚠️ {error}
    </div>
  );
}
