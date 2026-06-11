import { useEffect, useState } from "react";
import type { CodeIssue, Org, SnykClient } from "@snyk-code-pulse/api-client";
import { loadSettings, saveSettings, clearSettings, type Settings } from "./settings";
import { makeClient } from "./api";
import Setup from "./screens/Setup";
import Overview from "./screens/Overview";
import Ignores from "./screens/Ignores";
import Cwe from "./screens/Cwe";
import Orgs from "./screens/Orgs";
import AuditLogs from "./screens/AuditLogs";
import { ErrorBox, Skeleton } from "./components/ui";

const TABS = ["Overview", "Ignore Audit", "CWE Map", "Orgs", "Audit Logs", "Settings"] as const;
type Tab = (typeof TABS)[number];

export interface AppData {
  client: SnykClient;
  settings: Settings;
  orgs: Org[];
  issues: CodeIssue[];
  refresh: () => void;
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined); // undefined = loading
  const [tab, setTab] = useState<Tab>("Overview");
  const [data, setData] = useState<{ orgs: Org[]; issues: CodeIssue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);

  useEffect(() => {
    loadSettings().then((s) => setSettings(s));
  }, []);

  const FIRST_PAINT_AT = 5000;

  async function fetchAll(s: Settings) {
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setFetchProgress(0);
    try {
      const client = makeClient(s);
      const orgs = await client.listOrgs(s.groupId);
      // Progressive load: paint the dashboard at FIRST_PAINT_AT issues, keep
      // streaming the remainder in the background with a visible counter.
      const buffer: CodeIssue[] = [];
      let painted = false;
      const issues = await client.listGroupIssues(
        s.groupId,
        ["code", "package_vulnerability"],
        {},
        Infinity,
        (n, issue) => {
          buffer.push(issue);
          if (n % 200 === 0) setFetchProgress(n);
          if (!painted && buffer.length >= FIRST_PAINT_AT) {
            painted = true;
            setData({ orgs, issues: [...buffer] });
            setLoading(false);
            setLoadingMore(true);
          } else if (painted && buffer.length % 2000 === 0) {
            setData({ orgs, issues: [...buffer] });
          }
        },
      );
      setData({ orgs, issues });
      setFetchProgress(issues.length);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (settings) fetchAll(settings);
  }, [settings]);

  if (settings === undefined) return null;

  if (!settings) {
    return (
      <Shell tab="Settings" setTab={() => {}} hideNav>
        <Setup
          onSave={async (s) => {
            await saveSettings(s);
            setSettings(s);
            setTab("Overview");
          }}
        />
      </Shell>
    );
  }

  const appData: AppData | null = data
    ? { client: makeClient(settings), settings, orgs: data.orgs, issues: data.issues, refresh: () => fetchAll(settings) }
    : null;

  return (
    <Shell tab={tab} setTab={setTab}>
      {error && <ErrorBox error={error} />}
      {loading && !data && (
        <>
          <p className="text-xs text-slate-400">
            Loading first {FIRST_PAINT_AT.toLocaleString()} issues…{" "}
            {fetchProgress > 0 ? `${fetchProgress.toLocaleString()} fetched` : ""}
          </p>
          <Skeleton rows={8} />
        </>
      )}
      {loadingMore && (
        <div className="fixed top-16 right-4 z-50 glass px-3 py-2 text-xs text-slate-300 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          Loading more issues… {fetchProgress.toLocaleString()} so far
        </div>
      )}
      {tab === "Settings" && (
        <Setup
          initial={settings}
          onSave={async (s) => {
            await saveSettings(s);
            setSettings({ ...s });
            setTab("Overview");
          }}
          onClear={async () => {
            await clearSettings();
            setSettings(null);
            setData(null);
          }}
        />
      )}
      {appData && tab === "Overview" && <Overview data={appData} />}
      {appData && tab === "Ignore Audit" && <Ignores data={appData} />}
      {appData && tab === "CWE Map" && <Cwe data={appData} />}
      {appData && tab === "Orgs" && <Orgs data={appData} />}
      {appData && tab === "Audit Logs" && <AuditLogs data={appData} />}
    </Shell>
  );
}

function Shell({
  tab,
  setTab,
  hideNav,
  children,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  hideNav?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen text-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <header className="sticky top-0 z-30 backdrop-blur-lg bg-slate-950/70 border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <h1 className="font-bold tracking-tight">
              Snyk <span className="text-indigo-400">Code Pulse</span>
            </h1>
          </div>
          {!hideNav && (
            <nav className="flex gap-1 ml-auto overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    tab === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">{children}</main>
      <footer className="max-w-6xl mx-auto px-4 pb-8 text-center text-xs text-slate-600">
        Snyk Code Pulse — your token never leaves this device.
      </footer>
    </div>
  );
}
