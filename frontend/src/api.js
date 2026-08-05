// src/api.ts
// InfraGenie API client — talks to the FastAPI backend at VITE_API_URL

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const api = axios.create({ baseURL: BASE_URL });

// ── Attach the JWT to every request automatically ──────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── If the token is invalid/expired, clear it (AuthContext handles the redirect) ─
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
    }
    return Promise.reject(error);
  }
);

// ── Types (mirroring your Pydantic schemas) ─────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  user: User;
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
}): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/register', payload);
  localStorage.setItem('access_token', data.access_token);
  return data;
}

export async function login(payload: { email: string; password: string }): Promise<TokenResponse> {
  // /auth/login uses OAuth2PasswordRequestForm -> form-encoded body,
  // and the field is called "username" even though we're sending an email.
  const form = new URLSearchParams();
  form.append('username', payload.email);
  form.append('password', payload.password);

  const { data } = await api.post<TokenResponse>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  localStorage.setItem('access_token', data.access_token);
  return data;
}

export function logout() {
  localStorage.removeItem('access_token');
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

// ── Projects ─────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const { data } = await api.get<Project[]>('/projects');
  return data;
}

export async function createProject(payload: {
  name: string;
  description?: string;
  source_type: string;
  github_url?: string;
}): Promise<Project> {
  const { data } = await api.post<Project>('/projects', payload);
  return data;
}

export async function getProject(projectId: string): Promise<Project> {
  const { data } = await api.get<Project>(`/projects/${projectId}`);
  return data;
}

export async function deleteProject(projectId: string) {
  const { data } = await api.delete(`/projects/${projectId}`);
  return data;
}

export async function uploadProjectFile(projectId: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<Project>(`/projects/${projectId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function analyzeProject(projectId: string) {
  const { data } = await api.post<Project>(`/projects/${projectId}/analyze`);
  return data;
}

// ── Deployments ──────────────────────────────────────────────────────────

export async function listDeployments(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/deployments`);
  return data;
}

export async function getDeployment(deploymentId: string) {
  const { data } = await api.get(`/deployments/${deploymentId}`);
  return data;
}

export async function approveDeployment(deploymentId: string, approved: boolean) {
  const { data } = await api.post(`/deployments/${deploymentId}/approve`, { approved });
  return data;
}

// ── Reports ──────────────────────────────────────────────────────────────

export async function listReports(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/reports`);
  return data;
}

// ── Streaming AI insights (SSE via fetch — EventSource can't send auth headers) ─

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
  const { data } = await api.get('/health');
  return data;
}