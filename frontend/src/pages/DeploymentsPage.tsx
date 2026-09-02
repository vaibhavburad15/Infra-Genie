import { useEffect, useState } from 'react';
import {
  Rocket, CheckCircle2, XCircle, Clock, Loader, ChevronRight,
  AlertTriangle, RefreshCw,
} from 'lucide-react';
import { listProjects, listDeployments, approveDeployment, timeAgo, parseDate, type Project } from '@/api';

interface Deployment {
  id: string;
  project_id: string;
  status: string;
  environment: string;
  artifacts: any;
  agent_logs: any;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const statusBadge: Record<string, string> = {
  success:           'bg-emerald-50 text-emerald-600 border-emerald-200',
  running:           'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  failed:            'bg-red-50 text-red-600 border-red-200',
  pending:           'bg-gray-100 text-gray-500 border-gray-200',
  awaiting_approval: 'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
};

const envColors: Record<string, string> = {
  production:  'bg-[#fdf3eb] text-[#c9692a] border-[#f0bc98]',
  staging:     'bg-[#edf3fb] text-[#1e3a7a] border-[#a8c1ea]',
  development: 'bg-gray-100 text-gray-500 border-gray-200',
};

export default function DeploymentsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const ps = await listProjects();
      setProjects(ps);
      const map: Record<string, string> = {};
      ps.forEach((p) => { map[p.id] = p.name; });
      setProjectMap(map);

      // Fetch deployments for all projects
      const all: Deployment[] = [];
      await Promise.all(
        ps.map(async (p) => {
          try {
            const deps = await listDeployments(p.id) as Deployment[];
            all.push(...deps);
          } catch {
            // Project may have no deployments
          }
        })
      );
      // Sort by created_at descending
      all.sort((a, b) => parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime());
      setDeployments(all);
    } catch (e: any) {
      setError(e.message || 'Failed to load deployments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: string, approved: boolean) => {
    try {
      const updated = await approveDeployment(id, approved) as Deployment;
      setDeployments((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (e: any) {
      alert(e.message || 'Failed to update deployment');
    }
  };

  const successCount = deployments.filter((d) => d.status === 'success').length;
  const runningCount = deployments.filter((d) => d.status === 'running').length;
  const failedCount  = deployments.filter((d) => d.status === 'failed').length;

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full bg-[#f4f6fa]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total',       value: String(deployments.length), icon: Rocket,       color: '#1e3a7a', bg: 'bg-[#edf3fb]', spin: false },
          { label: 'Successful',  value: String(successCount),       icon: CheckCircle2, color: '#059669', bg: 'bg-emerald-50', spin: false },
          { label: 'In Progress', value: String(runningCount),        icon: Loader,       color: '#c9692a', bg: 'bg-[#fdf3eb]', spin: true },
          { label: 'Failed',      value: String(failedCount),         icon: XCircle,      color: '#ef4444', bg: 'bg-red-50',     spin: false },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bg}`} style={{ color: s.color }}>
                <Icon size={18} className={s.spin ? 'animate-spin' : ''} />
              </div>
              <div>
                <p className="text-gray-800 text-xl font-bold">{s.value}</p>
                <p className="text-gray-400 text-xs">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-gray-800 font-semibold text-sm">All Deployments</h3>
        <button onClick={load} className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1e3a7a] cursor-pointer transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader size={20} className="text-[#c9692a] animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading deployments…</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={load} className="ml-auto text-xs text-red-500 hover:underline cursor-pointer">Retry</button>
        </div>
      )}

      {!loading && !error && deployments.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#edf3fb] flex items-center justify-center mb-4">
            <Rocket size={24} className="text-[#1e3a7a]" />
          </div>
          <p className="text-gray-800 font-semibold text-sm">No deployments yet</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs">
            {projects.length === 0
              ? 'Create a project first, then trigger a deployment from the Projects page.'
              : 'Analyze a project to trigger your first deployment.'}
          </p>
        </div>
      )}

      {!loading && !error && deployments.map((dep) => (
        <div key={dep.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#edf3fb] flex items-center justify-center flex-shrink-0">
                <Rocket size={16} className="text-[#1e3a7a]" />
              </div>
              <div>
                <h3 className="text-gray-800 text-sm font-bold">{projectMap[dep.project_id] || dep.project_id}</h3>
                <p className="text-gray-400 text-xs font-mono">{dep.id.slice(0, 8)}…</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${envColors[dep.environment] || envColors.development}`}>
                {dep.environment}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge[dep.status] || statusBadge.pending}`}>
                {dep.status.replace('_', ' ')}
              </span>
              <span className="text-gray-400 text-xs flex items-center gap-1">
                <Clock size={11} />{timeAgo(dep.created_at)}
              </span>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Started</p>
                <p className="text-gray-600">{timeAgo(dep.started_at)}</p>
              </div>
              <div>
                <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Completed</p>
                <p className="text-gray-600">{timeAgo(dep.completed_at)}</p>
              </div>
              <div>
                <p className="text-gray-300 text-[10px] uppercase tracking-wider mb-0.5">Approved</p>
                <p className="text-gray-600">{timeAgo(dep.approved_at)}</p>
              </div>
            </div>

            {dep.status === 'awaiting_approval' && (
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 px-3 py-2 rounded-xl bg-[#edf3fb] border border-[#a8c1ea] flex items-center gap-2">
                  <Clock size={13} className="text-[#1e3a7a]" />
                  <p className="text-[#1e3a7a] text-xs font-medium">This deployment is awaiting your approval.</p>
                </div>
                <button
                  onClick={() => handleApprove(dep.id, true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 cursor-pointer transition-colors"
                >
                  <CheckCircle2 size={13} /> Approve
                </button>
                <button
                  onClick={() => handleApprove(dep.id, false)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 cursor-pointer transition-colors border border-red-200"
                >
                  <XCircle size={13} /> Reject
                </button>
              </div>
            )}

            {dep.status === 'running' && (
              <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#fdf3eb] border border-[#f0bc98]">
                <Loader size={12} className="text-[#c9692a] animate-spin" />
                <p className="text-[#c9692a] text-xs">Deployment in progress…</p>
              </div>
            )}

            {dep.status === 'failed' && (
              <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
                <XCircle size={12} className="text-red-500" />
                <p className="text-red-600 text-xs">Deployment failed. Check agent logs for details.</p>
              </div>
            )}

            {dep.agent_logs && (
              <details className="mt-4">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 flex items-center gap-1">
                  <ChevronRight size={12} /> View agent logs
                </summary>
                <pre className="mt-2 text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-40">
                  {JSON.stringify(dep.agent_logs, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
