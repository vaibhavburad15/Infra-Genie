/**
 * Axios API client — all backend calls go through here.
 * Token is automatically injected from localStorage.
 */
import axios from "axios";
import type { TokenResponse, User, Project, Deployment, Report } from "./types";

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

// Inject auth token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post<TokenResponse>("/auth/register", { email, username, password }),

  login: async (email: string, password: string) => {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    return api.post<TokenResponse>("/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  },

  me: () => api.get<User>("/auth/me"),
};

// ── Projects ──────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: () => api.get<Project[]>("/projects"),

  create: (data: { name: string; description?: string; source_type?: string; github_url?: string }) =>
    api.post<Project>("/projects", data),

  get: (id: string) => api.get<Project>(`/projects/${id}`),

  delete: (id: string) => api.delete(`/projects/${id}`),

  upload: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<Project>(`/projects/${projectId}/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  analyze: (projectId: string) => api.post<Project>(`/projects/${projectId}/analyze`),
};

// ── Deployments ───────────────────────────────────────────────────────────────

export const deploymentsApi = {
  list: (projectId: string) => api.get<Deployment[]>(`/projects/${projectId}/deployments`),

  get: (id: string) => api.get<Deployment>(`/deployments/${id}`),

  approve: (id: string, approved: boolean) =>
    api.post<Deployment>(`/deployments/${id}/approve`, { approved }),
};

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  list: (projectId: string) => api.get<Report[]>(`/projects/${projectId}/reports`),
};

// ── Streaming AI insights ─────────────────────────────────────────────────────

export function streamInsights(
  projectId: string,
  question: string,
  onChunk: (chunk: string) => void,
  onDone: () => void
): () => void {
  const token = localStorage.getItem("token");
  const url = `/api/stream/insights?project_id=${encodeURIComponent(projectId)}&question=${encodeURIComponent(question)}`;

  const evtSource = new EventSource(url);

  // EventSource doesn't support custom headers, so we use fetch with SSE manually
  evtSource.close(); // Close the EventSource

  const controller = new AbortController();

  fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onDone();
            return;
          }
          onChunk(data);
        }
      }
    }
    onDone();
  }).catch(() => onDone());

  return () => controller.abort();
}

export default api;
