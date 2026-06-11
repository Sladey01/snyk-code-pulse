/**
 * Shared Snyk REST API client for Snyk Code Pulse.
 * Works in Node 18+ (global fetch) and in browsers (via a baseUrl proxy override).
 */

export const SNYK_API_VERSION = "2026-03-25";

export const REGIONS = {
  "us-01": "https://api.snyk.io",
  "us-02": "https://api.us.snyk.io",
  "eu": "https://api.eu.snyk.io",
  "au": "https://api.au.snyk.io",
} as const;

export type RegionId = keyof typeof REGIONS;

export type Severity = "high" | "medium" | "low" | "critical";
export type IssueStatus = "open" | "resolved";

export interface Org {
  id: string;
  name: string;
  slug: string;
}

export type IssueType = "code" | "package_vulnerability" | "license" | "config" | "cloud" | "custom";

export interface CodeIssue {
  id: string;
  /** Issue type: "code" (SAST) or "package_vulnerability" (Open Source), etc. */
  issueType: string;
  orgId?: string;
  title: string;
  severity: Severity;
  status: IssueStatus;
  ignored: boolean;
  createdAt: string;
  updatedAt?: string;
  cwes: string[];
  projectId?: string;
  key: string;
}

export interface SastSettings {
  orgId: string;
  sastEnabled: boolean;
  raw?: unknown;
}

export interface Project {
  id: string;
  name: string;
  type: string;
  origin?: string;
}

export interface IssueFilters {
  severities?: Severity[];
  status?: IssueStatus[];
  ignored?: boolean;
  createdAfter?: string; // ISO 8601
  createdBefore?: string;
  limit?: number;
}

export interface SnykClientOptions {
  token: string;
  region?: RegionId;
  /** Full base URL override (e.g. "/snyk-api" behind a dev proxy, or a custom instance). Wins over region. */
  baseUrl?: string;
  /** Custom fetch implementation (e.g. Capacitor native HTTP wrapper). */
  fetchFn?: typeof fetch;
  /** REST API version; defaults to SNYK_API_VERSION. */
  version?: string;
}

interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<string, any>;
}

interface JsonApiPage {
  data: JsonApiResource[];
  links?: { next?: string };
}

export class SnykApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string,
  ) {
    super(message ?? `Snyk API error ${status}: ${body.slice(0, 300)}`);
    this.name = "SnykApiError";
  }
}

/** Clamp to the API's pagination rules: min 10, max 100, multiple of 10. */
export function clampLimit(n: number | undefined): number {
  const v = Math.min(100, Math.max(10, Math.round((n ?? 100) / 10) * 10));
  return v;
}

export class SnykClient {
  private readonly base: string;
  private readonly token: string;
  private readonly version: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: SnykClientOptions) {
    if (!opts.token) throw new Error("SnykClient: token is required");
    this.base = (opts.baseUrl ?? REGIONS[opts.region ?? "us-01"]).replace(/\/$/, "");
    this.token = opts.token;
    this.version = opts.version ?? SNYK_API_VERSION;
    // Bind to globalThis: storing bare `fetch` detaches it from window and
    // browsers throw "Illegal invocation" when it's called as a property.
    this.fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  async request<T = any>(
    path: string,
    opts: {
      method?: string;
      query?: Record<string, string | number | boolean | string[] | undefined>;
      body?: unknown;
      retries?: number;
      /** Call the V1 API (/v1) instead of REST (/rest) — needed for integration settings. */
      v1?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(
      path.startsWith("http") ? path : `${this.base}${opts.v1 ? "/v1" : "/rest"}${path}`,
      // base for relative paths in browsers
      typeof window === "undefined" ? undefined : window.location.origin,
    );
    if (!opts.v1 && !url.searchParams.has("version")) url.searchParams.set("version", this.version);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }

    const maxRetries = opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url.toString(), {
        method: opts.method ?? "GET",
        headers: {
          Authorization: `token ${this.token}`,
          "Content-Type": opts.v1 ? "application/json" : "application/vnd.api+json",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 429 && attempt < maxRetries) {
        const wait = Number(res.headers.get("retry-after") ?? 2 ** attempt) * 1000;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
        continue;
      }
      if (!res.ok) throw new SnykApiError(res.status, await res.text());
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }

  /** Follow JSON:API cursor pagination (`links.next`) until exhausted or `max` items collected. */
  async *paginate(
    path: string,
    query: Record<string, any> = {},
    max = Infinity,
  ): AsyncGenerator<JsonApiResource> {
    let next: string | undefined = undefined;
    let count = 0;
    do {
      const page: JsonApiPage = next
        ? await this.request(next.startsWith("/rest") ? next.slice(5) : next)
        : await this.request(path, { query: { ...query, limit: clampLimit(query.limit) } });
      for (const item of page.data ?? []) {
        yield item;
        if (++count >= max) return;
      }
      next = page.links?.next;
    } while (next);
  }

  // ---------- Orgs ----------

  async listOrgs(groupId: string, max = Infinity): Promise<Org[]> {
    const out: Org[] = [];
    for await (const r of this.paginate(`/groups/${groupId}/orgs`, {}, max)) {
      out.push({ id: r.id, name: r.attributes.name, slug: r.attributes.slug });
    }
    return out;
  }

  // ---------- SAST settings ----------

  async getSastSettings(orgId: string): Promise<SastSettings> {
    const res = await this.request<{ data: JsonApiResource }>(`/orgs/${orgId}/settings/sast`);
    return {
      orgId,
      sastEnabled: Boolean(res.data.attributes.sast_enabled),
      raw: res.data.attributes,
    };
  }

  async setSastEnabled(orgId: string, enabled: boolean): Promise<SastSettings> {
    const res = await this.request<{ data: JsonApiResource }>(`/orgs/${orgId}/settings/sast`, {
      method: "PATCH",
      body: {
        data: {
          id: orgId,
          type: "sast_settings",
          attributes: { sast_enabled: enabled },
        },
      },
    });
    return {
      orgId,
      sastEnabled: Boolean(res.data.attributes.sast_enabled),
      raw: res.data.attributes,
    };
  }

  // ---------- Issues ----------

  private static toIssue(r: JsonApiResource): CodeIssue {
    const a = r.attributes;
    const cwes: string[] = (a.classes ?? [])
      .filter((c: any) => (c.source ?? "").toUpperCase() === "CWE")
      .map((c: any) => c.id);
    return {
      id: r.id,
      issueType: a.type,
      orgId: r.relationships?.organization?.data?.id,
      title: a.title,
      severity: a.effective_severity_level,
      status: a.status,
      ignored: Boolean(a.ignored),
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      cwes,
      projectId: r.relationships?.scan_item?.data?.id,
      key: a.key,
    };
  }

  private static issueQuery(f: IssueFilters, type: string): Record<string, any> {
    return {
      type,
      effective_severity_level: f.severities,
      status: f.status,
      ignored: f.ignored,
      created_after: f.createdAfter,
      created_before: f.createdBefore,
      limit: f.limit,
    };
  }

  /** Fetch issues of several types (the API only accepts ONE type per request, so we fan out and merge). */
  async listGroupIssues(
    groupId: string,
    types: IssueType[],
    f: IssueFilters = {},
    maxPerType = Infinity,
    onProgress?: (fetched: number, issue: CodeIssue) => void,
  ): Promise<CodeIssue[]> {
    let fetched = 0;
    const batches = await Promise.all(
      types.map(async (t) => {
        const out: CodeIssue[] = [];
        for await (const r of this.paginate(`/groups/${groupId}/issues`, SnykClient.issueQuery(f, t), maxPerType)) {
          const issue = SnykClient.toIssue(r);
          out.push(issue);
          onProgress?.(++fetched, issue);
        }
        return out;
      }),
    );
    return batches.flat();
  }

  async listGroupCodeIssues(groupId: string, f: IssueFilters = {}, max = 5000): Promise<CodeIssue[]> {
    return this.listGroupIssues(groupId, ["code"], f, max);
  }

  async listOrgIssues(
    orgId: string,
    types: IssueType[],
    f: IssueFilters = {},
    maxPerType = 5000,
  ): Promise<CodeIssue[]> {
    const batches = await Promise.all(
      types.map(async (t) => {
        const out: CodeIssue[] = [];
        for await (const r of this.paginate(`/orgs/${orgId}/issues`, SnykClient.issueQuery(f, t), maxPerType)) {
          out.push(SnykClient.toIssue(r));
        }
        return out;
      }),
    );
    return batches.flat();
  }

  async listOrgCodeIssues(orgId: string, f: IssueFilters = {}, max = 5000): Promise<CodeIssue[]> {
    return this.listOrgIssues(orgId, ["code"], f, max);
  }

  // ---------- Audit logs ----------

  /**
   * Search the group audit log. Response is NOT standard JSON:API — items live in
   * `data.items` and pagination uses `links.next`.
   */
  async searchGroupAuditLogs(
    groupId: string,
    opts: { from?: string; to?: string; events?: string[]; max?: number } = {},
  ): Promise<AuditLogEvent[]> {
    const out: AuditLogEvent[] = [];
    const max = opts.max ?? 1000;
    let path: string | undefined = `/groups/${groupId}/audit_logs/search`;
    let query: Record<string, any> | undefined = {
      size: 100,
      from: opts.from,
      to: opts.to,
      events: opts.events?.length ? opts.events : undefined,
    };
    while (path && out.length < max) {
      const res: { data?: { items?: AuditLogEvent[] }; links?: { next?: string } } =
        await this.request(path, query ? { query } : {});
      const items = res.data?.items ?? [];
      if (items.length === 0) break;
      for (const item of items) {
        out.push(item);
        if (out.length >= max) break;
      }
      const next = res.links?.next;
      path = next ? (next.startsWith("/rest") ? next.slice(5) : next) : undefined;
      query = undefined; // the next link already carries its params
    }
    return out;
  }

  // ---------- Integrations (V1 API) ----------

  /** List an org's integrations as {type, id} pairs. */
  async listIntegrations(orgId: string): Promise<OrgIntegration[]> {
    const res = await this.request<Record<string, string>>(`/org/${orgId}/integrations`, { v1: true });
    return Object.entries(res).map(([type, id]) => ({ type, id }));
  }

  async getIntegrationSettings(orgId: string, integrationId: string): Promise<IntegrationSettings> {
    return this.request(`/org/${orgId}/integrations/${integrationId}/settings`, { v1: true });
  }

  /** Read-merge-write so nested objects (autoRemediationPrs) aren't clobbered. */
  async updateIntegrationSettings(
    orgId: string,
    integrationId: string,
    patch: IntegrationSettings,
  ): Promise<IntegrationSettings> {
    const current = await this.getIntegrationSettings(orgId, integrationId);
    const merged: IntegrationSettings = {
      ...current,
      ...patch,
      autoRemediationPrs: { ...(current.autoRemediationPrs ?? {}), ...(patch.autoRemediationPrs ?? {}) },
    };
    return this.request(`/org/${orgId}/integrations/${integrationId}/settings`, {
      v1: true,
      method: "PUT",
      body: merged,
    });
  }

  // ---------- Projects ----------

  async listProjects(orgId: string, max = Infinity): Promise<Project[]> {
    const out: Project[] = [];
    for await (const r of this.paginate(`/orgs/${orgId}/projects`, {}, max)) {
      out.push({
        id: r.id,
        name: r.attributes.name,
        type: r.attributes.type,
        origin: r.attributes.origin,
      });
    }
    return out;
  }
}

// ---------- Integration settings (V1 API — PR checks, fix PRs, upgrade PRs) ----------

/** SCM integration types that support PR checks / fix-PR settings. */
export const SCM_INTEGRATION_TYPES = [
  "github",
  "github-enterprise",
  "github-cloud-app",
  "gitlab",
  "bitbucket-cloud",
  "bitbucket-server",
  "bitbucket-connect-app",
  "azure-repos",
] as const;

export interface IntegrationSettings {
  pullRequestTestEnabled?: boolean;
  pullRequestTestCodeEnabled?: boolean;
  pullRequestFailOnAnyVulns?: boolean;
  pullRequestFailOnlyForHighSeverity?: boolean;
  pullRequestFailOnlyForIssuesWithFix?: boolean;
  autoDepUpgradeEnabled?: boolean;
  autoRemediationPrs?: {
    freshPrsEnabled?: boolean;
    backlogPrsEnabled?: boolean;
    usePatchRemediation?: boolean;
  };
  [k: string]: unknown;
}

export interface OrgIntegration {
  type: string;
  id: string;
}

export interface AuditLogEvent {
  group_id?: string;
  org_id?: string;
  user_id?: string;
  project_id?: string;
  event: string;
  content?: Record<string, unknown>;
  created: string;
}

// ---------- Aggregation helpers (shared by MCP server + dashboard) ----------

export interface PostureSummary {
  total: number;
  open: number;
  resolved: number;
  ignored: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  byCwe: Array<{ cwe: string; count: number }>;
  byOrg: Array<{ orgId: string; count: number; critical: number; high: number; medium: number; low: number }>;
}

export function summarizeIssues(issues: CodeIssue[]): PostureSummary {
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const cwe = new Map<string, number>();
  const org = new Map<string, { count: number; critical: number; high: number; medium: number; low: number }>();
  let open = 0,
    resolved = 0,
    ignored = 0;
  for (const i of issues) {
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    byType[i.issueType] = (byType[i.issueType] ?? 0) + 1;
    if (i.status === "open") open++;
    if (i.status === "resolved") resolved++;
    if (i.ignored) ignored++;
    for (const c of i.cwes) cwe.set(c, (cwe.get(c) ?? 0) + 1);
    if (i.orgId) {
      const o = org.get(i.orgId) ?? { count: 0, critical: 0, high: 0, medium: 0, low: 0 };
      o.count++;
      if (i.severity === "critical") o.critical++;
      else if (i.severity === "high") o.high++;
      else if (i.severity === "medium") o.medium++;
      else if (i.severity === "low") o.low++;
      org.set(i.orgId, o);
    }
  }
  return {
    total: issues.length,
    open,
    resolved,
    ignored,
    bySeverity,
    byType,
    byCwe: [...cwe.entries()]
      .map(([cwe, count]) => ({ cwe, count }))
      .sort((a, b) => b.count - a.count),
    byOrg: [...org.entries()]
      .map(([orgId, v]) => ({ orgId, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Simple glob → RegExp for org name matching in bulk operations ("app*", "*-prod"). */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}
