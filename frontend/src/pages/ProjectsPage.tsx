import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderGit2, Clock, Rocket, MoreVertical, Plus, Server, Search,
  CheckCircle2, AlertTriangle, Loader, X, RefreshCw, ChevronRight,
  Code, Box, Cloud, GitBranch, Shield, Activity, DollarSign,
  Cpu, Database, Layers, FileCode, ExternalLink, Terminal,
} from 'lucide-react';
import {
  listProjects, createProject, deleteProject, analyzeProject, getProject,
  streamProjectLogs, getProjectLogs,
  type Project, type DeploymentPlan, type LogEntry,
} from '@/api';

// ── Status config ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  pending:   { dot: 'bg-gray-400',                      text: 'text-gray-500',    bg: 'bg-gray-100',   label: 'Pending' },
  analyzing: { dot: 'bg-[#c9692a] animate-pulse',       text: 'text-[#c9692a]',  bg: 'bg-[#fdf3eb]',  label: 'Analyzing' },
  ready:     { dot: 'bg-emerald-500',                   text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Ready' },
  deploying: { dot: 'bg-[#1e3a7a] animate-pulse',       text: 'text-[#1e3a7a]',  bg: 'bg-[#edf3fb]',  label: 'Deploying' },
  deployed:  { dot: 'bg-emerald-500',                   text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Deployed' },
  failed:    { dot: 'bg-red-500',                       text: 'text-red-600',     bg: 'bg-red-50',     label: 'Failed' },
};

const sourceTypeLabels: Record<string, string> = { upload: 'File Upload', github: 'GitHub' };

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Artifact tabs ─────────────────────────────────────────────────────────────

const TABS: { key: keyof DeploymentPlan; label: string; icon: React.ElementType }[] = [
  { key: 'analysis',      label: 'Analysis',      icon: Cpu },
  { key: 'discovered_apps', label: 'Services',    icon: Layers },
  { key: 'docker',        label: 'Dockerfile',    icon: Box },
  { key: 'terraform',     label: 'Terraform',     icon: Cloud },
  { key: 'kubernetes',    label: 'Kubernetes',    icon: Server },
  { key: 'cicd',          label: 'CI/CD',         icon: GitBranch },
  { key: 'architecture',  label: 'Architecture',  icon: Database },
  { key: 'monitoring',    label: 'Monitoring',    icon: Activity },
  { key: 'security',      label: 'Security',      icon: Shield },
  { key: 'cost_estimate', label: 'Cost',          icon: DollarSign },
];

// ── Log level styles ──────────────────────────────────────────────────────────

const LOG_COLORS: Record<string, string> = {
  system:  'text-[#60a5fa]',   // blue
  info:    'text-gray-300',
  success: 'text-emerald-400',
  error:   'text-red-400',
};

// ── Live Terminal ─────────────────────────────────────────────────────────────

function AnalysisTerminal({ project, onDone }: { project: Project; onDone: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Seed with any already-persisted logs first
    getProjectLogs(project.id)
      .then((existing) => {
        if (!cancelled) setLogs(existing);
      })
      .catch(() => {});

    // Open SSE stream
    const cleanup = streamProjectLogs({
      projectId: project.id,
      onLog: (entry) => {
        if (!cancelled) setLogs((prev) => [...prev, entry]);
      },
      onDone: () => {
        if (!cancelled) {
          setStreaming(false);
          onDone();
        }
      },
      onError: () => {
        if (!cancelled) setStreaming(false);
      },
    });
    cleanupRef.current = cleanup;

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const formatTs = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return ts; }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Terminal header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] rounded-t-xl border-b border-[#2a2a4a]">
        <Terminal size={13} className="text-[#60a5fa]" />
        <span className="text-[#60a5fa] text-xs font-mono font-semibold">Analysis Pipeline</span>
        <div className="ml-auto flex items-center gap-2">
          {streaming ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[10px] font-mono">LIVE</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-gray-500" />
              <span className="text-gray-500 text-[10px] font-mono">DONE</span>
            </>
          )}
        </div>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto bg-[#0d0d1a] rounded-b-xl p-4 font-mono text-xs space-y-1 min-h-0">
        {logs.length === 0 && (
          <div className="flex items-center gap-2 text-gray-600">
            <Loader size={11} className="animate-spin text-[#c9692a]" />
            <span>Waiting for agents to start…</span>
          </div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 leading-relaxed">
            <span className="text-gray-600 shrink-0 select-none">{formatTs(entry.ts)}</span>
            <span className={`shrink-0 w-14 truncate ${LOG_COLORS[entry.level] ?? 'text-gray-400'} select-none`}>
              {entry.level.toUpperCase()}
            </span>
            <span className="text-[#c9692a] shrink-0 max-w-[140px] truncate">[{entry.agent}]</span>
            <span className={`flex-1 break-all ${LOG_COLORS[entry.level] ?? 'text-gray-300'}`}>
              {entry.message}
            </span>
          </div>
        ))}
        {streaming && logs.length > 0 && (
          <div className="flex items-center gap-1 text-gray-600 mt-1">
            <span className="animate-pulse">▋</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Project Detail Drawer ─────────────────────────────────────────────────────

function ProjectDrawer({ project, onClose, onRefresh }: {
  project: Project;
  onClose: () => void;
  onRefresh: (p: Project) => void;
}) {
  const [activeTab, setActiveTab] = useState<keyof DeploymentPlan>('analysis');
  const pollingRef = useRef(false);
  const plan = project.deployment_plan;
  const analysis = plan?.analysis || project.analysis_result;

  // Poll for status change while analyzing — stops as soon as status changes.
  // Keyed only on project.id so re-renders mid-poll don't restart the interval.
  useEffect(() => {
    if (project.status !== 'analyzing') return;
    if (pollingRef.current) return;
    pollingRef.current = true;

    const interval = setInterval(async () => {
      try {
        const fresh = await getProject(project.id);
        // Only update the drawer project — do NOT call load() on the parent list
        onRefresh(fresh);
        if (fresh.status !== 'analyzing') {
          clearInterval(interval);
          pollingRef.current = false;
        }
      } catch { /* ignore */ }
    }, 4000);

    return () => {
      clearInterval(interval);
      pollingRef.current = false;
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderTabContent = () => {
    if (!plan && project.status === 'analyzing') {
      return (
        <AnalysisTerminal
          project={project}
          onDone={async () => {
            try {
              const fresh = await getProject(project.id);
              onRefresh(fresh);
            } catch { /* ignore */ }
          }}
        />
      );
    }

    if (!plan && project.status === 'pending') {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Code size={24} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 text-sm font-semibold">Not analyzed yet</p>
          <p className="text-gray-400 text-xs mt-1 mb-4">Click Analyze to run the AI agent pipeline.</p>
          <button
            onClick={async () => { const u = await analyzeProject(project.id); onRefresh(u); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] cursor-pointer transition-colors"
          >
            <CheckCircle2 size={13} /> Run Analysis
          </button>
        </div>
      );
    }

    if (!plan && project.status === 'failed') {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
            <AlertTriangle size={24} className="text-red-500" />
          </div>
          <p className="text-gray-800 text-sm font-semibold">Analysis failed</p>
          <p className="text-gray-400 text-xs mt-1">Check that your backend worker is running and the LLM service is reachable.</p>
        </div>
      );
    }

    if (!plan) return <div className="py-16 text-center text-gray-400 text-sm">No analysis data available.</div>;

    // ── Tab: Analysis ──
    if (activeTab === 'analysis') {
      return (
        <div className="space-y-4">
          {analysis ? (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Language',   value: analysis.language },
                { label: 'Framework',  value: analysis.framework },
                { label: 'Complexity', value: analysis.complexity },
                { label: 'Strategy',   value: analysis.recommended_strategy || plan?.strategy },
                { label: 'Database',   value: analysis.has_database ? 'Yes' : 'No' },
                { label: 'Frontend',   value: analysis.has_frontend ? 'Yes' : 'No' },
              ].map(({ label, value }) => value && (
                <div key={label} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-gray-800 text-sm font-semibold capitalize">{String(value)}</p>
                </div>
              ))}
              {analysis.notes && (
                <div className="col-span-2 bg-[#edf3fb] rounded-xl p-3">
                  <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">AI Notes</p>
                  <p className="text-gray-700 text-xs leading-relaxed">{analysis.notes}</p>
                </div>
              )}
              {analysis.raw && (
                <div className="col-span-2">
                  <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">Raw Output</p>
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{analysis.raw}</pre>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-8">No analysis data.</p>
          )}
        </div>
      );
    }

    // ── Tab: Discovered Services ──
    if (activeTab === 'discovered_apps') {
      const apps = plan.discovered_apps || [];
      if (!apps.length) return <p className="text-gray-400 text-sm text-center py-8">No services discovered.</p>;
      return (
        <div className="space-y-3">
          {apps.map((app, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
                <Layers size={16} className="text-[#1e3a7a]" />
              </div>
              <div>
                <p className="text-gray-800 text-sm font-semibold">{app.name}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#edf3fb] text-[#1e3a7a] font-medium">{app.type}</span>
                  {app.tech && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{app.tech}</span>}
                  {app.port && <span className="text-gray-400 text-[10px]">:{app.port}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── All other tabs: code/text artifact ──
    const content = plan[activeTab];
    if (!content || (typeof content === 'object' && !Object.keys(content).length)) {
      return <p className="text-gray-400 text-sm text-center py-8">No output for this agent.</p>;
    }
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    return (
      <div className="relative">
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-white/80 text-gray-500 text-[10px] font-medium hover:bg-white border border-gray-200 cursor-pointer transition-colors z-10"
        >
          Copy
        </button>
        <pre className="text-[11px] text-gray-700 bg-gray-50 rounded-xl p-4 overflow-x-auto overflow-y-auto max-h-[460px] whitespace-pre-wrap leading-relaxed">
          {text}
        </pre>
      </div>
    );
  };

  const availableTabs = TABS.filter(({ key }) => {
    if (key === 'analysis') return true;
    if (key === 'discovered_apps') return !!(plan?.discovered_apps?.length);
    return !!(plan?.[key]);
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
              <Server size={18} className="text-[#1e3a7a]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-gray-800 font-bold text-base truncate">{project.name}</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {(() => {
                  const sc = statusConfig[project.status] || statusConfig.pending;
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                      {project.status === 'analyzing' && <Loader size={10} className="animate-spin ml-0.5" />}
                    </span>
                  );
                })()}
                <span className="text-gray-400 text-xs">{sourceTypeLabels[project.source_type] || project.source_type}</span>
                <span className="text-gray-400 text-xs flex items-center gap-1"><Clock size={10} />{timeAgo(project.created_at)}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer flex-shrink-0 ml-3">
            <X size={20} />
          </button>
        </div>

        {/* Description + github */}
        {(project.description || project.github_url) && (
          <div className="px-6 py-3 border-b border-gray-100 flex-shrink-0 bg-gray-50">
            {project.description && <p className="text-gray-600 text-xs leading-relaxed">{project.description}</p>}
            {project.github_url && (
              <a href={project.github_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#1e3a7a] hover:underline mt-1">
                <ExternalLink size={10} />{project.github_url}
              </a>
            )}
          </div>
        )}

        {/* Tabs */}
        {plan && (
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 overflow-x-auto flex-shrink-0 bg-white">
            {availableTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer flex-shrink-0 ${
                  activeTab === key
                    ? 'bg-[#1e3a7a] text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Icon size={11} />{label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 min-h-0 ${project.status === 'analyzing' && !plan ? 'overflow-hidden px-4 py-4' : 'overflow-y-auto px-6 py-5'}`}>
          {renderTabContent()}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
          <button
            onClick={async () => { try { await deleteProject(project.id); onClose(); } catch (e: any) { alert(e.message); } }}
            className="px-3 py-2 rounded-lg bg-red-50 text-red-500 text-xs font-medium hover:bg-red-100 cursor-pointer transition-colors border border-red-200"
          >
            Delete Project
          </button>
          <div className="flex items-center gap-2">
            {project.status === 'pending' && (
              <button
                onClick={async () => { const u = await analyzeProject(project.id); onRefresh(u); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1e3a7a] text-white text-xs font-semibold hover:bg-[#162d5f] cursor-pointer transition-colors"
              >
                <CheckCircle2 size={13} /> Analyze
              </button>
            )}
            {(project.status === 'ready' || project.status === 'deployed') && (
              <button
                onClick={async () => { const u = await analyzeProject(project.id); onRefresh(u); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] cursor-pointer transition-colors"
              >
                <Rocket size={13} /> Re-analyze & Deploy
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

interface NewProjectForm {
  name: string; description: string; source_type: string; github_url: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [form, setForm] = useState<NewProjectForm>({
    name: '', description: '', source_type: 'upload', github_url: '',
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await listProjects();
      setProjects(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = projects
    .filter((p) => filter === 'all' || p.status === filter)
    .filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(search.toLowerCase())
    );

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError('Project name is required.'); return; }
    if (form.source_type === 'github' && !form.github_url.trim()) {
      setFormError('GitHub URL is required.'); return;
    }
    try {
      setCreating(true);
      setFormError('');
      const created = await createProject({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        source_type: form.source_type,
        github_url: form.github_url.trim() || undefined,
      });
      setProjects((prev) => [created, ...prev]);
      setShowModal(false);
      setForm({ name: '', description: '', source_type: 'upload', github_url: '' });
    } catch (e: any) {
      setFormError(e.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedProject?.id === id) setSelectedProject(null);
    } catch (e: any) { alert(e.message); }
    setMenuOpen(null);
  };

  const handleRefresh = (updated: Project) => {
    // Update the project in the list in-place — no API refetch of the full list
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedProject(updated);
  };

  const openProject = async (project: Project) => {
    // Fetch fresh copy so drawer has latest analysis_result / deployment_plan
    try {
      const fresh = await getProject(project.id);
      setSelectedProject(fresh);
    } catch {
      setSelectedProject(project);
    }
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full bg-[#f4f6fa]">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {['all', 'pending', 'analyzing', 'ready', 'deployed', 'failed'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                filter === f ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
              }`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search projects..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-600 placeholder-gray-400 focus:outline-none focus:border-[#1e3a7a] w-48" />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('grid')} className={`px-3 py-1.5 text-xs cursor-pointer ${view === 'grid' ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500'}`}>Grid</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs cursor-pointer ${view === 'list' ? 'bg-[#1e3a7a] text-white' : 'bg-white text-gray-500'}`}>List</button>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">
            <Plus size={14} /> New Project
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader size={20} className="text-[#c9692a] animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading projects…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={load} className="ml-auto text-xs text-red-500 hover:underline cursor-pointer">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <FolderGit2 size={28} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">No projects found</p>
          <p className="text-gray-400 text-xs mt-1 mb-4">
            {search || filter !== 'all' ? 'Try a different filter or search.' : 'Create your first project to get started.'}
          </p>
          {!search && filter === 'all' && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#c9692a] text-white text-xs font-semibold hover:bg-[#b85820] transition-colors cursor-pointer">
              <Plus size={14} /> New Project
            </button>
          )}
        </div>
      )}

      {/* Grid view */}
      {!loading && !error && filtered.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project) => {
            const sc = statusConfig[project.status] || statusConfig.pending;
            return (
              <div key={project.id}
                onClick={() => openProject(project)}
                className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md hover:border-[#c9692a]/30 transition-all group cursor-pointer relative">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center">
                      <Server size={18} className="text-[#1e3a7a]" />
                    </div>
                    <div>
                      <h3 className="text-gray-800 text-sm font-bold">{project.name}</h3>
                      <p className="text-gray-400 text-xs">{sourceTypeLabels[project.source_type] || project.source_type}</p>
                    </div>
                  </div>
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setMenuOpen(menuOpen === project.id ? null : project.id)}
                      className="text-gray-300 hover:text-[#c9692a] cursor-pointer transition-colors">
                      <MoreVertical size={15} />
                    </button>
                    {menuOpen === project.id && (
                      <div className="absolute right-0 top-6 z-20 bg-white border border-gray-100 rounded-xl shadow-lg py-1 w-36">
                        <button onClick={() => { openProject(project); setMenuOpen(null); }}
                          className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">View Details</button>
                        <button onClick={() => { analyzeProject(project.id).then(handleRefresh); setMenuOpen(null); }}
                          className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">Analyze</button>
                        <button onClick={() => handleDelete(project.id)}
                          className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 cursor-pointer">Delete</button>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-gray-500 text-xs leading-relaxed mb-4 min-h-[32px]">
                  {project.description || <span className="italic text-gray-300">No description</span>}
                </p>

                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                    {project.status === 'analyzing' && <Loader size={10} className="animate-spin ml-0.5" />}
                  </span>
                  {project.deployment_plan?.analysis?.language && (
                    <span className="text-gray-400 text-xs px-2 py-0.5 rounded bg-gray-100">
                      {project.deployment_plan.analysis.language}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className="text-gray-400 text-[10px] flex items-center gap-1">
                    <Clock size={10} />{timeAgo(project.created_at)}
                  </span>
                  <span className="text-[#c9692a] text-xs font-medium flex items-center gap-1 group-hover:gap-1.5 transition-all">
                    View details <ChevronRight size={12} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {!loading && !error && filtered.length > 0 && view === 'list' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Project</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden md:table-cell">Source</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Language</th>
                <th className="text-left text-gray-300 text-xs font-semibold uppercase tracking-wider px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((project) => {
                const sc = statusConfig[project.status] || statusConfig.pending;
                return (
                  <tr key={project.id} onClick={() => openProject(project)}
                    className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#edf3fb] flex items-center justify-center">
                          <Server size={14} className="text-[#1e3a7a]" />
                        </div>
                        <div>
                          <p className="text-gray-800 text-sm font-medium">{project.name}</p>
                          <p className="text-gray-400 text-xs truncate max-w-[200px]">{project.description || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{sc.label}
                        {project.status === 'analyzing' && <Loader size={10} className="animate-spin" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-gray-600 text-xs">{sourceTypeLabels[project.source_type] || project.source_type}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-gray-500 text-xs">{project.deployment_plan?.analysis?.language || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-400 text-xs flex items-center gap-1">
                        <Clock size={11} />{timeAgo(project.created_at)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#edf3fb] flex items-center justify-center">
                  <FolderGit2 size={18} className="text-[#1e3a7a]" />
                </div>
                <div>
                  <h2 className="text-gray-800 font-bold text-sm">New Project</h2>
                  <p className="text-gray-400 text-xs">Add a project to InfraGenie</p>
                </div>
              </div>
              <button onClick={() => { setShowModal(false); setFormError(''); }} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-gray-500 text-xs font-medium block mb-1.5">Project Name <span className="text-red-500">*</span></label>
                <input type="text" placeholder="e.g. user-service" value={form.name}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(''); }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#1e3a7a]" />
              </div>
              <div>
                <label className="text-gray-500 text-xs font-medium block mb-1.5">Description</label>
                <textarea placeholder="What does this project do?" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#1e3a7a] resize-none" />
              </div>
              <div>
                <label className="text-gray-500 text-xs font-medium block mb-1.5">Source Type</label>
                <select value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value, github_url: '' })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[#1e3a7a] cursor-pointer">
                  <option value="upload">File Upload</option>
                  <option value="github">GitHub</option>
                </select>
              </div>
              {form.source_type === 'github' && (
                <div>
                  <label className="text-gray-500 text-xs font-medium block mb-1.5">GitHub URL <span className="text-red-500">*</span></label>
                  <input type="url" placeholder="https://github.com/org/repo" value={form.github_url}
                    onChange={(e) => { setForm({ ...form, github_url: e.target.value }); setFormError(''); }}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#1e3a7a]" />
                </div>
              )}
              {formError && <p className="text-red-500 text-xs">{formError}</p>}
            </div>
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => { setShowModal(false); setFormError(''); }}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 cursor-pointer transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating}
                className="px-5 py-2 rounded-lg bg-[#c9692a] text-white text-sm font-semibold hover:bg-[#b85820] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2">
                {creating && <Loader size={13} className="animate-spin" />}
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-away for context menu */}
      {menuOpen && <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />}

      {/* Project Detail Drawer */}
      {selectedProject && (
        <ProjectDrawer
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onRefresh={(updated) => {
            handleRefresh(updated);
            // also reload list so card statuses update
            load();
          }}
        />
      )}
    </div>
  );
}
