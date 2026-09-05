// src/api.ts
// InfraGenie API client — talks to the FastAPI backend at VITE_API_URL

const BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('access_token');
  }
  if (!res.ok) {
    const fallback = `API Error ${res.status}`;
    const contentType = res.headers.get('content-type') || '';
    let message = fallback;

    if (contentType.includes('application/json')) {
      const errorBody = await res.json().catch(() => null);
      const detail = errorBody?.detail;

      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail
          .map((item) => item?.msg)
          .filter(Boolean)
          .join(', ') || fallback;
      } else if (typeof errorBody?.message === 'string') {
        message = errorBody.message;
      }
    } else {
      message = (await res.text().catch(() => '')) || fallback;
    }

    throw new Error(message);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'developer' | 'devops_engineer' | 'admin';

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  current_org_id?: string | null;
}

// ── Organizations ─────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  plan_seats: number;
  plan_projects: number;
  plan_deployments_per_month: number;
}

export interface Subscription {
  plan: string;
  seats?: number;
  projects?: number;
  deployments_per_month?: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  user: User;
}

export interface EmailOtpRequestResponse {
  message: string;
  expires_in_minutes: number;
  dev_otp?: string;
}

export interface EmailOtpVerifyResponse {
  message: string;
}

export interface ProjectAnalysis {
  language?: string;
  framework?: string;
  has_database?: boolean;
  has_frontend?: boolean;
  complexity?: string;
  recommended_strategy?: string;
  notes?: string;
  raw?: string;
  fallback?: boolean;
}

export interface DiscoveredApp {
  name: string;
  type: string;
  port?: number;
  tech?: string;
}

export interface DeploymentPlan {
  analysis?: ProjectAnalysis;
  discovered_apps?: DiscoveredApp[];
  strategy?: string;
  docker?: string;
  terraform?: string;
  kubernetes?: string;
  cicd?: string;
  architecture?: string;
  monitoring?: string;
  security?: string;
  cost_estimate?: string;
}

// Shape of the rich static-analysis result attached to a project after analysis.
// Mirrors what backend/static_analysis.py emits as `analyze_repo_static()`.
export interface DetailedAnalysis {
  summary: {
    primary_language?: string;
    primary_framework?: string;
    package_manager?: string;
    total_files?: number;
    source_files?: number;
    test_files?: number;
    doc_files?: number;
    total_loc?: number;
  };
  languages: Array<{ name: string; files: number; loc: number }>;
  frameworks: Array<{ name: string; version?: string }>;
  build_tools: Array<{ name: string; version?: string }>;
  tests: Array<{ name: string; version?: string }>;
  linters_formatters: Array<{ name: string; version?: string }>;
  databases_orms: Array<{ name: string; version?: string }>;
  cloud_sdks: Array<{ name: string; version?: string }>;
  entry_points: string[];
  environment_variables_hint: string[];
  containerization: { has_dockerfile: boolean; has_docker_compose: boolean; docker_services?: string[] };
  ci_cd: { present: boolean; systems?: string[] };
  has_database_hint?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  source_type: string;
  github_url?: string;
  status: string;
  analysis_result?: ProjectAnalysis;
  deployment_plan?: DeploymentPlan;
  detailed_analysis?: DetailedAnalysis;
  logs?: LogEntry[];
  created_at: string;
  updated_at: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export async function register(payload: {
  email: string;
  username: string;
  password: string;
  role: UserRole;
}): Promise<TokenResponse> {
  const data = await request<TokenResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  localStorage.setItem('access_token', data.access_token);
  return data;
}

export async function requestEmailOtp(payload: { email: string }): Promise<EmailOtpRequestResponse> {
  return request<EmailOtpRequestResponse>('/auth/email-otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function verifyEmailOtp(payload: { email: string; otp: string }): Promise<EmailOtpVerifyResponse> {
  return request<EmailOtpVerifyResponse>('/auth/email-otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function login(payload: { email: string; password: string }): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.append('username', payload.email);
  form.append('password', payload.password);

  const data = await request<TokenResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  localStorage.setItem('access_token', data.access_token);
  return data;
}

export function logout() {
  localStorage.removeItem('access_token');
}

export async function getMe(): Promise<User> {
  return request<User>('/auth/me');
}

// ── Projects ─────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/projects');
}

export async function createProject(payload: {
  name: string;
  description?: string;
  source_type: string;
  github_url?: string;
}): Promise<Project> {
  return request<Project>('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const formData = new FormData();
  formData.append('file', file);
  return request<Project>(`/projects/${projectId}/upload`, {
    method: 'POST',
    body: formData,
  });
}

export async function analyzeProject(projectId: string) {
  return request<Project>(`/projects/${projectId}/analyze`, { method: 'POST' });
}

export interface LogEntry {
  ts: string;
  level: 'info' | 'success' | 'error' | 'system';
  agent: string;
  message: string;
  /** Extended level field used for LLM-streamed tokens. */
  kind?: string;
  /** True when the entry is a live-streamed LLM token chunk. */
  streaming?: boolean;
}

/** Fetch all persisted log lines for a project (used on drawer open). */
export async function getProjectLogs(projectId: string): Promise<LogEntry[]> {
  const data = await request<{ logs: LogEntry[] }>(`/projects/${projectId}/logs`);
  return data.logs || [];
}

/**
 * Open an SSE connection to stream live analysis logs.
 * Returns a cleanup function — call it to close the connection.
 */
export function streamProjectLogs(opts: {
  projectId: string;
  onLog: (entry: LogEntry) => void;
  onDone: () => void;
  onError?: (err: unknown) => void;
}): () => void {
  const { projectId, onLog, onDone, onError } = opts;
  const token = localStorage.getItem('access_token');
  const url = `${BASE_URL}/projects/${encodeURIComponent(projectId)}/logs/stream`;

  // SSE doesn't support custom headers natively — pass token as query param
  const fullUrl = `${url}?token=${encodeURIComponent(token || '')}`;

  // Use fetch + ReadableStream so we can pass the auth header properly
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(fullUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE connect failed: ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();
              if (!payload) continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.__done__) {
                  onDone();
                  return;
                }
                onLog(parsed as LogEntry);
              } catch {
                // ignore malformed lines / keep-alive comments
              }
            }
          }
        }
      }
      onDone();
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        onError?.(err);
      }
    }
  })();

  // Return cleanup
  return () => controller.abort();
}

// ── Deployments ──────────────────────────────────────────────────────────

export async function listDeployments(projectId: string) {
  return request(`/projects/${projectId}/deployments`);
}

export async function getDeployment(deploymentId: string) {
  return request(`/deployments/${deploymentId}`);
}

export async function approveDeployment(deploymentId: string, approved: boolean) {
  return request(`/deployments/${deploymentId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  });
}

// ── Reports ──────────────────────────────────────────────────────────────

export async function listReports(projectId: string) {
  return request(`/projects/${projectId}/reports`);
}

// ── Agents ─────────────────────────────────────────────────────────────────

export interface AgentInfo {
  agent_id: string;
  name: string;
  role: string;
  category: 'analysis' | 'artifacts' | 'operations';
  outputs: string[];
  description: string;
  optional: boolean;
  model: string;
  median_runtime_sec: number;
  enabled: boolean;
  runs: number;
  successes: number;
  last_run_at: string | null;
  updated_at: string | null;
}

export interface AgentListResponse {
  agents: AgentInfo[];
  core_agent_ids: string[];
  total: number;
  enabled: number;
}

export async function listAgents(): Promise<AgentListResponse> {
  return request<AgentListResponse>('/agents');
}

export async function getAgent(agentId: string): Promise<AgentInfo> {
  return request<AgentInfo>(`/agents/${encodeURIComponent(agentId)}`);
}

export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<AgentInfo> {
  return request<AgentInfo>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

// ── Streaming AI insights ────────────────────────────────────────────────

export async function streamInsights(opts: {
  projectId: string;
  question: string;
  onChunk?: (text: string) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}) {
  const { projectId, question, onChunk, onDone, onError } = opts;
  const token = localStorage.getItem('access_token');
  const url = `${BASE_URL}/stream/insights?project_id=${encodeURIComponent(
    projectId
  )}&question=${encodeURIComponent(question)}`;

  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok || !response.body) throw new Error(`Stream request failed: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') {
          onDone?.();
          return;
        }
        onChunk?.(payload);
      }
    }
  } catch (err) {
    onError?.(err);
  }
}

// ── Health check ─────────────────────────────────────────────────────────

export async function checkHealth() {
  return request('/health');
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Format an ISO timestamp as a human-readable "time ago" string. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Safe date parser — returns a valid Date or epoch on bad input. */
export function parseDate(iso?: string | null): Date {
  if (!iso) return new Date(0);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

// ── Metrics overview ──────────────────────────────────────────────────────────

export interface MetricsOverview {
  projects: {
    total: number;
    deployed: number;
    failed: number;
    analyzing: number;
  };
  deployments: {
    total: number;
    success: number;
    running: number;
    failed: number;
    avg_duration_seconds: number;
  };
  languages: Array<{ name: string; count: number }>;
  with_docker: number;
}

export async function getMetricsOverview(): Promise<MetricsOverview> {
  return request<MetricsOverview>('/metrics/overview');
}

// ── Organization management ───────────────────────────────────────────────────

export async function listOrgs(): Promise<Organization[]> {
  return request<Organization[]>('/orgs');
}

export async function createOrg(payload: { name: string }): Promise<Organization> {
  return request<Organization>('/orgs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function switchOrg(orgId: string): Promise<void> {
  return request<void>(`/orgs/${encodeURIComponent(orgId)}/switch`, { method: 'POST' });
}

export async function getMySubscription(): Promise<Subscription> {
  return request<Subscription>('/billing/subscription');
}

export async function getAuditLog(limit = 50): Promise<AuditLogEntry[]> {
  return request<AuditLogEntry[]>(`/audit?limit=${limit}`);
}
