// InfraGenie v3 API client (multi-tenant SaaS).
const BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

function getAuthHeaders(): Record<string, string> {
  const t = localStorage.getItem('access_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) localStorage.removeItem('access_token');
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let msg = `API Error ${res.status}`;
    if (ct.includes('application/json')) {
      const b = await res.json().catch(() => null);
      const d = b?.detail;
      if (typeof d === 'string') msg = d;
      else if (Array.isArray(d)) msg = d.map(x => x?.msg).filter(Boolean).join(', ') || msg;
      else if (typeof b?.message === 'string') msg = b.message;
    } else { msg = (await res.text().catch(() => '')) || msg; }
    throw new Error(msg);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────
export type UserRole = 'user' | 'developer' | 'devops_engineer' | 'admin';

export interface User {
  id: string; email: string; username: string;
  role: UserRole; is_active: boolean; current_org_id?: string | null; created_at: string;
}
export interface Organization {
  id: string; name: string; slug: string; plan: string;
  plan_seats?: number | null; plan_projects?: number | null;
  plan_deployments_per_month?: number | null; created_at: string;
}
export interface Membership {
  id: string; user_id: string; org_id: string; role: string; joined_at?: string | null;
}
export interface AuditLogEntry {
  id: string; actor_id?: string | null; action: string;
  target_type?: string | null; target_id?: string | null;
  metadata_json?: Record<string, unknown> | null; created_at: string;
}
export interface Subscription {
  plan: string; status: string; current_period_end?: string | null;
  seats?: number | null; projects?: number | null;
  deployments_per_month?: number | null;
}
export interface TokenResponse {
  access_token: string; token_type?: string;
  user: User; current_org?: Organization | null;
}
// Detailed analysis shape returned by static_analysis.analyze_repo_static
export interface LanguageStat { name: string; files: number; loc: number; }
export interface NamedTool { name: string; version?: string | null; }
export interface DetailedAnalysis {
  summary: {
    total_files: number; source_files: number; config_files: number;
    doc_files: number; test_files: number; total_loc: number;
    primary_language: string | null; primary_framework: string | null;
    package_manager: string;
  };
  languages: LanguageStat[];
  frameworks: NamedTool[]; build_tools: NamedTool[];
  tests: NamedTool[]; linters_formatters: NamedTool[];
  databases_orms: NamedTool[]; cloud_sdks: NamedTool[];
  containerization: {
    has_dockerfile: boolean; has_docker_compose: boolean;
    docker_services: string[]; databases_detected_from_compose: string[];
  };
  ci_cd: { present: boolean; systems: string[]; };
  entry_points: string[]; environment_variables_hint: string[];
  has_database_hint: boolean; has_dockerfile: boolean;
}
export interface LogEntry {
  ts: string; level: 'info' | 'success' | 'error' | 'llm' | 'system';
  kind?: 'info' | 'success' | 'error' | 'llm' | 'system';
  agent: string; message: string;
  streaming?: boolean;
  structured?: Record<string, unknown>;
}
export interface MetricsOverview {
  projects: { total: number; deployed: number; failed: number; analyzing: number; };
  deployments: { total: number; success: number; failed: number; running: number;
                 avg_duration_seconds: number; };
  languages: { name: string; count: number; }[];
  frameworks: { name: string; count: number; }[];
  databases: number; with_docker: number; reports_total: number;
  tier: { plan: string; seats?: number | null; projects?: number | null;
          deployments_per_month?: number | null; };
}
export interface ProjectAnalysis {
  language?: string; framework?: string;
  has_database?: boolean; has_frontend?: boolean;
  complexity?: string; recommended_strategy?: string;
  notes?: string; raw?: string; fallback?: boolean;
}
export interface DiscoveredApp {
  name: string; type: string; port?: number; tech?: string;
}
export interface DeploymentPlan {
  analysis?: ProjectAnalysis; discovered_apps?: DiscoveredApp[];
  strategy?: string; docker?: string; terraform?: string;
  kubernetes?: string; cicd?: string; architecture?: string;
  monitoring?: string; security?: string; cost_estimate?: string;
  detailed_analysis?: DetailedAnalysis;
}
export interface Project {
  id: string; name: string; description: string;
  source_type: string; github_url?: string;
  status: string; analysis_result?: ProjectAnalysis;
  detailed_analysis?: DetailedAnalysis | null;
  deployment_plan?: DeploymentPlan;
  logs?: LogEntry[]; created_at: string; updated_at: string;
}

// ── Auth / Org / Audit / Subscription ────────────────────────────────────────
export async function register(payload: { email: string; username: string;
                                          password: string; role: UserRole;
                                          org_name?: string; }): Promise<TokenResponse> {
  const data = await request<TokenResponse>('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  localStorage.setItem('access_token', data.access_token);
  return data;
}
export async function requestEmailOtp(payload: { email: string; }): Promise<{ message: string; dev_otp?: string }> {
  return request<{ message: string; dev_otp?: string }>('/auth/email-otp/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function verifyEmailOtp(payload: { email: string; otp: string; }): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/email-otp/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function login(payload: { email: string; password: string; }): Promise<TokenResponse> {
  const fd = new URLSearchParams();
  fd.append('username', payload.email);
  fd.append('password', payload.password);
  const data = await request<TokenResponse>('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fd.toString(),
  });
  localStorage.setItem('access_token', data.access_token);
  return data;
}
export function logout() { localStorage.removeItem('access_token'); }
export async function getMe(): Promise<User> { return request<User>('/auth/me'); }

export async function listOrgs(): Promise<Organization[]> { return request<Organization[]>('/orgs'); }
export async function createOrg(payload: { name: string; slug?: string; }): Promise<Organization> {
  return request<Organization>('/orgs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function switchOrg(orgId: string) {
  return request(`/orgs/${encodeURIComponent(orgId)}/switch`, { method: 'POST' });
}
export async function getMySubscription(): Promise<Subscription> {
  return request<Subscription>('/subscription/me');
}
export async function getAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  return request<AuditLogEntry[]>(`/audit-log?limit=${limit}`);
}
export async function getMetricsOverview(): Promise<MetricsOverview> {
  return request<MetricsOverview>('/metrics/overview');
}

// ── Projects ────────────────────────────────────────────────────────────────
export async function listProjects(): Promise<Project[]> { return request<Project[]>('/projects'); }
export async function createProject(payload: { name: string; description?: string;
                                               source_type: string; github_url?: string; }) {
  return request<Project>('/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function getProject(projectId: string): Promise<Project> {
  return request<Project>(`/projects/${projectId}`);
}
export async function deleteProject(projectId: string) {
  return request(`/projects/${projectId}`, { method: 'DELETE' });
}
export async function uploadProjectFile(projectId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return request<Project>(`/projects/${projectId}/upload`, { method: 'POST', body: fd });
}
export async function analyzeProject(projectId: string) {
  return request<Project>(`/projects/${projectId}/analyze`, { method: 'POST' });
}
export async function getProjectLogs(projectId: string): Promise<LogEntry[]> {
  const data = await request<{ logs: LogEntry[] }>(`/projects/${projectId}/logs`);
  return data.logs || [];
}
export function streamProjectLogs(opts: { projectId: string;
                                          onLog: (e: LogEntry) => void;
                                          onDone: (info?: { deploymentId?: string;
                                                            error?: string }) => void;
                                          onError?: (e: unknown) => void; }): () => void {
  const token = localStorage.getItem('access_token');
  const url = `${BASE_URL}/projects/${encodeURIComponent(opts.projectId)}/logs/stream`;
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) { opts.onError?.(new Error(`SSE ${res.status}`)); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) for (const ln of p.split('\n')) {
          if (ln.startsWith('data: ')) {
            const payload = ln.slice(6).trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.__done__) {
                opts.onDone({ error: parsed.error, deploymentId: parsed.deployment_id });
                return;
              }
              opts.onLog(parsed as LogEntry);
            } catch {}
          }
        }
      }
      opts.onDone();
    } catch (e: unknown) {
      if ((e as any)?.name !== 'AbortError') opts.onError?.(e);
    }
  })();
  return () => controller.abort();
}

// ── Deployments / Reports ────────────────────────────────────────────────────
export async function listDeployments(projectId: string) {
  return request(`/projects/${projectId}/deployments`);
}
export async function approveDeployment(deploymentId: string, approved: boolean) {
  return request(`/deployments/${deploymentId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  });
}
export async function listReports(projectId: string) {
  return request(`/projects/${projectId}/reports`);
}
export async function streamInsights(opts: { projectId: string; question: string;
                                            onChunk?: (t: string) => void;
                                            onDone?: () => void;
                                            onError?: (e: unknown) => void; }) {
  const token = localStorage.getItem('access_token');
  const url = `${BASE_URL}/stream/insights?project_id=${encodeURIComponent(opts.projectId)}&question=${encodeURIComponent(opts.question)}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop() || '';
      for (const ln of parts) {
        if (!ln.startsWith('data: ')) continue;
        const payload = ln.slice(6);
        if (payload === '[DONE]') { opts.onDone?.(); return; }
        opts.onChunk?.(payload);
      }
    }
  } catch (e) { opts.onError?.(e); }
}

export async function checkHealth() { return request('/health'); }

// ── Date Helpers ─────────────────────────────────────────────────────────────

export function parseDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  let normalized = dateStr.trim();
  if (!normalized) return new Date();
  if (normalized.includes(' ') && !normalized.includes('T')) {
    normalized = normalized.replace(' ', 'T');
  }
  if (normalized.includes('T') && !normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date(dateStr) : d;
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - parseDate(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}