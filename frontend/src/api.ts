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

export interface Project {
  id: string;
  name: string;
  description: string;
  source_type: string;
  github_url?: string;
  status: string;
  created_at: string;
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
