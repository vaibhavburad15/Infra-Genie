// src/api.ts
// InfraGenie API client — talks to the FastAPI backend at VITE_API_URL

const BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown when the API returns 403 — usually means the user has no org membership. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
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

    if (res.status === 403) throw new ForbiddenError(message);
    throw new Error(message);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'organization' | 'developer' | 'devops_engineer' | 'admin';

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

// Mirrors the `StaticAnalysis` shape embedded inside deployment_plan.analysis.static
export interface StaticAnalysisData {
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

export interface ProjectAnalysis {
  language?: string;
  framework?: string;
  has_database?: boolean;
  has_frontend?: boolean;
  complexity?: string;
  recommended_strategy?: string;
  notes?: string;
  raw?: string;
  /** Rich static-analysis payload now embedded directly on the analysis object. */
  static?: StaticAnalysisData;
}

export interface DiscoveredApp {
  name: string;
  type: string;
  port?: number;
  tech?: string;
}

// ── Architecture diagram types ───────────────────────────────────────────────

export interface ArchNode {
  id: string;
  label: string;
  /** Semantic category used for icon / colour in the diagram */
  type:
    | 'service'
    | 'database'
    | 'cache'
    | 'queue'
    | 'gateway'
    | 'storage'
    | 'frontend'
    | 'cdn'
    | 'auth'
    | 'monitoring';
  description?: string;
}

export interface ArchEdge {
  source: string;
  target: string;
  label?: string;
}

export interface ArchitectureGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** Scalability / resilience recommendations */
  notes: string[];
}

export interface DeploymentPlan {
  analysis?: ProjectAnalysis;
  discovered_apps?: DiscoveredApp[];
  strategy?: string;
  docker?: string;
  terraform?: string;
  kubernetes?: string;
  cicd?: string;
  /** Structured graph (new) or plain-text string (legacy projects) */
  architecture?: ArchitectureGraph | string;
  monitoring?: string;
  security?: string;
  cost_estimate?: string;
}

// Shape of the rich static-analysis result attached to a project after analysis.
// Mirrors what backend/static_analysis.py emits as `analyze_repo_static()`.
// Kept for backwards compatibility — new code should read from
// deployment_plan.analysis.static instead.
/** @deprecated Use `deployment_plan.analysis.static` (StaticAnalysisData) instead. */
export type DetailedAnalysis = StaticAnalysisData;

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
  org_name?: string;
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

export interface DeploymentResourceChange {
  address: string;
  type: string;
  name: string;
  action: 'create' | 'modify' | 'destroy' | 'replace' | string;
  actions: string[];
}

export interface DeploymentPlanSummary {
  resources: DeploymentResourceChange[];
  create: number;
  modify: number;
  destroy: number;
  replace: number;
  has_destructive_changes: boolean;
  estimated_cost?: number | null;
}

export interface Deployment {
  id: string;
  project_id: string;
  cloud_account_id?: string | null;
  status: string;
  environment: string;
  region?: string | null;
  artifacts?: Record<string, unknown> | null;
  agent_logs?: Record<string, unknown> | null;
  plan_summary?: DeploymentPlanSummary | null;
  terraform_plan?: string | null;
  plan_created_at?: string | null;
  error_message?: string | null;
  deployment_outputs?: Record<string, unknown> | null;
  approved_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface DeploymentPlanReview {
  deployment_id: string;
  status: string;
  account_id: string | null;
  region: string | null;
  environment?: string | null;
  project_name?: string | null;
  summary: DeploymentPlanSummary | null;
  terraform_plan: string | null;
  plan_created_at?: string | null;
  error_message: string | null;
}

export async function createDeployment(payload: {
  project_id: string;
  cloud_account_id: string;
  environment?: string;
  region?: string;
}): Promise<Deployment> {
  return request<Deployment>('/api/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getDeployment(deploymentId: string): Promise<Deployment> {
  return request<Deployment>(`/api/deployments/${encodeURIComponent(deploymentId)}`);
}

export async function getDeploymentPlan(deploymentId: string): Promise<DeploymentPlanReview> {
  return request<DeploymentPlanReview>(`/api/deployments/${encodeURIComponent(deploymentId)}/plan`);
}

export async function approveDeployment(deploymentId: string, approved: boolean): Promise<Deployment> {
  return request<Deployment>(`/api/deployments/${encodeURIComponent(deploymentId)}/approve`, {
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

export async function getAuditLog(limit = 50): Promise<AuditLogEntry[]> {
  return request<AuditLogEntry[]>(`/audit-log?limit=${limit}`);
}

// ── Cloud Accounts (AWS cross-account connection) ─────────────────────────────

export type CloudAccountStatus = 'PENDING' | 'VERIFYING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';

export interface CloudAccountConnectRequest {
  account_id: string;
  region: string;
}

export interface CloudFormationTemplate {
  AWSTemplateFormatVersion: string;
  Description: string;
  Parameters: Record<string, unknown>;
  Resources: Record<string, unknown>;
  Outputs: Record<string, unknown>;
}

export interface CloudAccountConnectResponse {
  connection_id: string;
  provider: string;
  account_id: string;
  region: string;
  external_id: string;
  role_name: string;
  status: CloudAccountStatus;
  infragenie_account_id: string;
  cloudformation_template: CloudFormationTemplate;
}

export interface CloudAccountOut {
  id: string;
  provider: string;
  account_id: string;
  role_arn: string | null;
  region: string;
  status: CloudAccountStatus;
  connection_error: string | null;
  created_at: string;
  updated_at: string | null;
  last_verified_at: string | null;
  // Discovery metadata
  discovery_ran_at: string | null;
  discovery_summary: DiscoverySummary | null;
}

export interface CloudAccountVerifyRequest {
  role_arn: string;
}

export interface CloudAccountVerifyResponse {
  status: 'CONNECTED' | 'FAILED';
  account_id?: string;
  region?: string;
  role_arn?: string;
  last_verified_at?: string | null;
  message?: string;
  error_code?: string;
}

export interface CloudAccountDisconnectResponse {
  status: 'DISCONNECTED';
  message: string;
}

/** Step 1 — register the intent to connect and get the CFN template. */
export async function connectAWSAccount(
  payload: CloudAccountConnectRequest,
): Promise<CloudAccountConnectResponse> {
  return request<CloudAccountConnectResponse>('/api/cloud/aws/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Step 2 — provide the Role ARN and trigger STS verification. */
export async function verifyAWSConnection(
  connectionId: string,
  payload: CloudAccountVerifyRequest,
): Promise<CloudAccountVerifyResponse> {
  return request<CloudAccountVerifyResponse>(
    `/api/cloud/aws/${encodeURIComponent(connectionId)}/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/** List all AWS accounts the current user has connected. */
export async function listAWSConnections(): Promise<CloudAccountOut[]> {
  return request<CloudAccountOut[]>('/api/cloud/aws');
}

/** Soft-disconnect — removes the Infra Genie record, does NOT delete the IAM role. */
export async function disconnectAWSAccount(
  connectionId: string,
): Promise<CloudAccountDisconnectResponse> {
  return request<CloudAccountDisconnectResponse>(
    `/api/cloud/aws/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE' },
  );
}

// ── AWS Discovery ─────────────────────────────────────────────────────────────

export interface DiscoverySummary {
  vpc_count: number;
  subnet_count: number;
  security_group_count: number;
  ec2_instance_count: number;
  ec2_by_state: Record<string, number>;
  load_balancer_count: number;
  lb_by_type: Record<string, number>;
  eks_cluster_count: number;
  rds_instance_count: number;
  rds_by_engine: Record<string, number>;
  s3_bucket_count: number;
  ecr_repo_count: number;
  iam_role_count: number;
  nat_gateway_count: number;
  igw_count: number;
}

export interface DiscoveryVpc {
  vpc_id: string;
  cidr: string;
  is_default: boolean;
  state: string;
  name: string;
}

export interface DiscoverySubnet {
  subnet_id: string;
  vpc_id: string;
  cidr: string;
  availability_zone: string;
  available_ip_count: number;
  map_public_ip_on_launch: boolean;
  state: string;
  name: string;
}

export interface DiscoverySecurityGroup {
  sg_id: string;
  name: string;
  description: string;
  vpc_id: string;
  inbound: Array<{ protocol: string; from_port: number | null; to_port: number | null; cidr_ranges: string[] }>;
  outbound: Array<{ protocol: string; from_port: number | null; to_port: number | null; cidr_ranges: string[] }>;
}

export interface DiscoveryEC2Instance {
  instance_id: string;
  instance_type: string;
  state: string;
  vpc_id: string;
  subnet_id: string;
  private_ip: string;
  public_ip: string;
  name: string;
  launch_time: string;
}

export interface DiscoveryEKSCluster {
  cluster_name: string;
  arn: string;
  status: string;
  kubernetes_version: string;
  endpoint: string;
  vpc_id: string;
  subnet_ids: string[];
  endpoint_public_access: boolean;
  endpoint_private_access: boolean;
}

export interface DiscoveryRDSInstance {
  db_identifier: string;
  db_class: string;
  engine: string;
  engine_version: string;
  status: string;
  multi_az: boolean;
  endpoint_address: string;
  endpoint_port: number;
  publicly_accessible: boolean;
  storage_encrypted: boolean;
}

export interface DiscoveryLoadBalancer {
  name: string;
  type: string;
  scheme: string;
  state: string;
  dns_name: string;
  vpc_id: string;
}

export interface DiscoveryS3Bucket {
  name: string;
  created_at: string;
  region: string | null;
}

export interface DiscoveryIAMRole {
  role_name: string;
  role_arn: string;
  path: string;
  description: string;
}

export interface DiscoveryResult {
  account_id: string;
  region: string;
  discovered_at: string;
  vpcs: DiscoveryVpc[];
  subnets: DiscoverySubnet[];
  route_tables: unknown[];
  internet_gateways: unknown[];
  nat_gateways: unknown[];
  security_groups: DiscoverySecurityGroup[];
  ec2_instances: DiscoveryEC2Instance[];
  load_balancers: DiscoveryLoadBalancer[];
  eks_clusters: DiscoveryEKSCluster[];
  rds_instances: DiscoveryRDSInstance[];
  s3_buckets: DiscoveryS3Bucket[];
  ecr_repositories: unknown[];
  iam_roles: DiscoveryIAMRole[];
  summary: DiscoverySummary;
}

export interface DiscoveryResponse {
  status: 'SUCCESS' | 'FAILED';
  connection_id: string;
  discovered_at: string | null;
  result: DiscoveryResult;
}

export interface DiscoverySummaryResponse {
  status: 'SUCCESS';
  connection_id: string;
  account_id: string;
  region: string;
  discovered_at: string | null;
  summary: DiscoverySummary;
}

/** Trigger a full read-only AWS infrastructure discovery scan. */
export async function runAWSDiscovery(connectionId: string): Promise<DiscoveryResponse> {
  return request<DiscoveryResponse>(
    `/api/cloud/aws/${encodeURIComponent(connectionId)}/discover`,
    { method: 'POST' },
  );
}

/** Fetch the last cached discovery result (no AWS calls). */
export async function getAWSDiscoveryResult(connectionId: string): Promise<DiscoveryResponse> {
  return request<DiscoveryResponse>(
    `/api/cloud/aws/${encodeURIComponent(connectionId)}/discover`,
  );
}

/** Fetch only the lightweight summary counts from the last discovery. */
export async function getAWSDiscoverySummary(connectionId: string): Promise<DiscoverySummaryResponse> {
  return request<DiscoverySummaryResponse>(
    `/api/cloud/aws/${encodeURIComponent(connectionId)}/discover/summary`,
  );
}
