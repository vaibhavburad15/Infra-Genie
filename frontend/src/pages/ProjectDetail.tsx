import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  RefreshCw, ChevronDown, ChevronUp, CheckCircle2, XCircle,
  Clock, Upload, GitBranch, Bot, Send, FileCode2, Shield,
  DollarSign, Activity, Server
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { projectsApi, deploymentsApi, streamInsights } from "../api";
import type { Project, Deployment } from "../types";
import StatusBadge from "../components/StatusBadge";
import ArtifactTabs from "../components/ArtifactTabs";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // AI chat
  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) return;
    try {
      const [pRes, dRes] = await Promise.all([
        projectsApi.get(id),
        deploymentsApi.list(id),
      ]);
      setProject(pRes.data);
      setDeployments(dRes.data);
    } catch {
      toast.error("Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [fetch]);

  const handleUpload = async () => {
    if (!uploadFile || !project) return;
    setUploading(true);
    try {
      const res = await projectsApi.upload(project.id, uploadFile);
      setProject(res.data);
      setUploadFile(null);
      toast.success("Uploaded! Analysis started.");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!project) return;
    try {
      const res = await projectsApi.analyze(project.id);
      setProject(res.data);
      toast.success("Analysis queued");
    } catch {
      toast.error("Failed to start analysis");
    }
  };

  const handleApprove = async (deploymentId: string, approved: boolean) => {
    try {
      const res = await deploymentsApi.approve(deploymentId, approved);
      setDeployments((d) => d.map((dep) => dep.id === deploymentId ? res.data : dep));
      toast.success(approved ? "Deployment approved!" : "Deployment rejected");
    } catch {
      toast.error("Action failed");
    }
  };

  const handleAsk = () => {
    if (!question.trim() || !project) return;
    setChatAnswer("");
    setChatLoading(true);
    streamInsights(
      project.id,
      question,
      (chunk) => setChatAnswer((a) => a + chunk),
      () => setChatLoading(false)
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  if (!project) {
    return <div className="text-center text-gray-400 mt-16">Project not found.</div>;
  }

  const latestDeployment = deployments[0] || null;
  const plan = project.deployment_plan as Record<string, string> | null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {project.source_type === "github" ? (
              <GitBranch className="w-5 h-5 text-gray-400" />
            ) : (
              <Upload className="w-5 h-5 text-gray-400" />
            )}
            <h1 className="text-2xl font-bold">{project.name}</h1>
          </div>
          {project.description && <p className="text-gray-400">{project.description}</p>}
        </div>
        <StatusBadge status={project.status} large />
      </div>

      {/* Upload section (only if no file uploaded yet) */}
      {project.source_type !== "github" && project.status === "pending" && (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Upload className="w-4 h-4 text-brand-400" />
            Upload Project ZIP
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".zip"
              className="input flex-1"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
            <button
              className="btn-primary whitespace-nowrap"
              disabled={!uploadFile || uploading}
              onClick={handleUpload}
            >
              {uploading ? "Uploading..." : "Upload & Analyze"}
            </button>
          </div>
        </div>
      )}

      {/* GitHub re-analyze */}
      {project.source_type === "github" && project.status === "pending" && (
        <div className="card flex items-center justify-between">
          <div>
            <p className="font-medium">Ready to analyze</p>
            <p className="text-sm text-gray-400">{project.github_url}</p>
          </div>
          <button className="btn-primary" onClick={handleAnalyze}>
            Start Analysis
          </button>
        </div>
      )}

      {/* Analysis in progress */}
      {project.status === "analyzing" && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <RefreshCw className="w-5 h-5 text-brand-400 animate-spin" />
            <span className="font-medium">AI Agents are analyzing your project...</span>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {["Docker", "Terraform", "Kubernetes", "CI/CD", "Architecture", "Monitoring", "Security", "Cost"].map((a) => (
              <div key={a} className="text-center">
                <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center mx-auto mb-1 animate-pulse">
                  <Bot className="w-5 h-5 text-brand-400" />
                </div>
                <p className="text-xs text-gray-500">{a}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analysis result + artifacts */}
      {plan && project.status !== "pending" && project.status !== "analyzing" && (
        <>
          {/* Analysis summary */}
          <div className="card">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Server className="w-4 h-4 text-brand-400" />
              Project Analysis
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(project.analysis_result || {}).map(([k, v]) => (
                typeof v === "string" || typeof v === "boolean" || typeof v === "number" ? (
                  <div key={k} className="bg-gray-800 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1 capitalize">{k.replace(/_/g, " ")}</p>
                    <p className="font-medium text-sm">{String(v)}</p>
                  </div>
                ) : null
              ))}
            </div>
          </div>

          {/* Artifact tabs */}
          <ArtifactTabs plan={plan} />
        </>
      )}

      {/* Deployment approval */}
      {latestDeployment && latestDeployment.status === "awaiting_approval" && (
        <div className="card border-yellow-700">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-yellow-400 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Awaiting Your Approval
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                The deployment plan is ready. Review the artifacts above and approve to proceed.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                onClick={() => handleApprove(latestDeployment.id, true)}
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve
              </button>
              <button
                className="flex items-center gap-1.5 bg-red-800 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                onClick={() => handleApprove(latestDeployment.id, false)}
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deployment history */}
      {deployments.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-4">Deployment History</h3>
          <div className="space-y-3">
            {deployments.map((d) => (
              <DeploymentRow key={d.id} deployment={d} />
            ))}
          </div>
        </div>
      )}

      {/* AI Chat */}
      {project.status === "ready" || project.status === "deployed" ? (
        <div className="card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4 text-brand-400" />
            Ask AI about this project
          </h3>
          <div className="flex gap-2 mb-4">
            <input
              className="input flex-1"
              placeholder="e.g. How can I reduce costs? What security improvements are needed?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            />
            <button className="btn-primary flex items-center gap-1.5" onClick={handleAsk} disabled={chatLoading}>
              <Send className="w-4 h-4" />
              Ask
            </button>
          </div>
          {(chatAnswer || chatLoading) && (
            <div className="bg-gray-800 rounded-lg p-4 text-sm prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{chatAnswer || "Thinking..."}</ReactMarkdown>
              {chatLoading && <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5" />}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const [expanded, setExpanded] = useState(false);
  const logs = (deployment.agent_logs as { deployment_steps?: { step: string; status: string; at: string }[] } | null)?.deployment_steps || [];

  const statusIcon = {
    success: <CheckCircle2 className="w-4 h-4 text-green-400" />,
    failed: <XCircle className="w-4 h-4 text-red-400" />,
    running: <RefreshCw className="w-4 h-4 text-brand-400 animate-spin" />,
    awaiting_approval: <Clock className="w-4 h-4 text-yellow-400" />,
    pending: <Clock className="w-4 h-4 text-gray-400" />,
  }[deployment.status];

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-gray-750"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          {statusIcon}
          <span className="text-sm font-medium capitalize">{deployment.status.replace("_", " ")}</span>
          <span className="text-xs text-gray-500">{deployment.environment}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {new Date(deployment.created_at).toLocaleString()}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && logs.length > 0 && (
        <div className="border-t border-gray-700 p-3 space-y-2">
          {logs.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              <span className="text-gray-300">{step.step}</span>
              <span className="text-gray-500 text-xs ml-auto">{new Date(step.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
