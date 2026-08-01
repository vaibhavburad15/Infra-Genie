export interface User {
  id: string;
  email: string;
  username: string;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export type ProjectStatus = "pending" | "analyzing" | "ready" | "deploying" | "deployed" | "failed";
export type DeploymentStatus = "pending" | "running" | "success" | "failed" | "awaiting_approval";

export interface Project {
  id: string;
  name: string;
  description: string;
  source_type: string;
  github_url: string | null;
  status: ProjectStatus;
  analysis_result: Record<string, unknown> | null;
  deployment_plan: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  status: DeploymentStatus;
  environment: string;
  artifacts: Record<string, unknown> | null;
  agent_logs: Record<string, unknown> | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  project_id: string;
  deployment_id: string | null;
  report_type: string;
  content: Record<string, unknown> | null;
  insights: string | null;
  created_at: string;
}
